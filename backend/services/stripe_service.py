from __future__ import annotations

from datetime import date
from typing import Optional

try:
    import stripe
except ModuleNotFoundError:  # pragma: no cover - optional dependency in local dev
    stripe = None
from backend.config import settings


class StripeService:
    def __init__(self):
        if stripe is None:
            self.available = False
            self.webhook_secret = settings.STRIPE_WEBHOOK_SECRET
            return
        self.available = True
        if settings.STRIPE_SECRET_KEY:
            stripe.api_key = settings.STRIPE_SECRET_KEY
        self.webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    def _require_stripe(self) -> None:
        if stripe is None or not self.available:
            raise RuntimeError("Stripe is not installed or not configured")

    def create_customer(self, email: str, organization_id: str, metadata: dict = None) -> stripe.Customer:
        """Create a Stripe customer for an organization."""
        self._require_stripe()
        customer = stripe.Customer.create(
            email=email,
            metadata={
                "organization_id": organization_id,
                **(metadata or {})
            }
        )
        return customer

    def get_or_create_customer(self, email: str, organization_id: str) -> stripe.Customer:
        """Get existing customer or create new one."""
        self._require_stripe()
        customers = stripe.Customer.list(email=email, limit=1)
        if customers.data:
            return customers.data[0]
        return self.create_customer(email, organization_id)

    def create_payment_intent(
        self,
        amount: int,  # in cents
        currency: str,
        customer_id: str,
        metadata: dict = None,
        description: str = None
    ) -> stripe.PaymentIntent:
        """Create a PaymentIntent for one-time payments."""
        self._require_stripe()
        intent = stripe.PaymentIntent.create(
            amount=amount,
            currency=currency.lower(),
            customer=customer_id,
            automatic_payment_methods={"enabled": True},
            metadata=metadata or {},
            description=description
        )
        return intent

    def create_subscription(
        self,
        customer_id: str,
        price_id: str,
        metadata: dict = None
    ) -> stripe.Subscription:
        """Create a recurring subscription."""
        self._require_stripe()
        subscription = stripe.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            expand=["latest_invoice.payment_intent"],
            metadata=metadata or {}
        )
        return subscription

    def cancel_subscription(self, subscription_id: str) -> stripe.Subscription:
        """Cancel a subscription at period end."""
        self._require_stripe()
        return stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=True
        )

    def construct_webhook_event(self, payload: bytes, sig_header: str) -> stripe.Event:
        """Verify and construct webhook event."""
        self._require_stripe()
        return stripe.Webhook.construct_event(
            payload, sig_header, self.webhook_secret
        )

    def sync_customer_to_db(self, customer: stripe.Customer, organization_id: str):
        """Sync Stripe customer to Supabase."""
        from backend.services.supabase_client import supabase_service
        
        supabase_service.client.table("stripe_customers").upsert({
            "organization_id": organization_id,
            "stripe_customer_id": customer.id,
            "email": customer.email,
        }, on_conflict="organization_id").execute()

    def sync_transaction_to_db(self, payment_intent: stripe.PaymentIntent, organization_id: str):
        """Sync successful payment to Supabase."""
        from backend.services.supabase_client import supabase_service
        
        supabase_service.client.table("stripe_transactions").upsert({
            "organization_id": organization_id,
            "stripe_payment_intent_id": payment_intent.id,
            "stripe_customer_id": payment_intent.customer if isinstance(payment_intent.customer, str) else payment_intent.customer.id if payment_intent.customer else None,
            "amount": payment_intent.amount / 100,  # convert from cents
            "currency": payment_intent.currency.upper(),
            "status": payment_intent.status,
            "payment_method_type": payment_intent.payment_method_types[0] if payment_intent.payment_method_types else None,
            "description": payment_intent.description,
            "metadata": payment_intent.metadata,
            "occurred_on": date.today().isoformat(),
        }, on_conflict="stripe_payment_intent_id").execute()

    def sync_subscription_to_db(self, subscription: stripe.Subscription, organization_id: str):
        """Sync subscription to Supabase."""
        from backend.services.supabase_client import supabase_service
        
        price = subscription.items.data[0].price if subscription.items.data else None
        if not price:
            return
            
        supabase_service.client.table("stripe_subscriptions").upsert({
            "organization_id": organization_id,
            "stripe_subscription_id": subscription.id,
            "stripe_customer_id": subscription.customer if isinstance(subscription.customer, str) else subscription.customer.id,
            "stripe_price_id": price.id,
            "status": subscription.status,
            "current_period_start": subscription.current_period_start,
            "current_period_end": subscription.current_period_end,
            "cancel_at_period_end": subscription.cancel_at_period_end,
            "amount": price.unit_amount / 100 if price.unit_amount else 0,
            "currency": price.currency.upper(),
            "interval": price.recurring.interval if price.recurring else "month",
            "metadata": subscription.metadata,
        }, on_conflict="stripe_subscription_id").execute()


stripe_service = StripeService()
