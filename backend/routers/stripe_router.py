from __future__ import annotations

import logging
from fastapi import APIRouter, Request, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional

from backend.config import settings
from backend.services.stripe_service import stripe_service
from backend.auth import require_workflow_actor, require_workflow_permission, WorkflowActor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stripe", tags=["stripe"])


# ===== Request/Response Models =====

class CreateCustomerRequest(BaseModel):
    email: str
    organization_id: str
    metadata: Optional[dict] = None


class CreatePaymentIntentRequest(BaseModel):
    organization_id: str
    amount: int  # in cents
    currency: str = "EUR"
    description: Optional[str] = None
    metadata: Optional[dict] = None


class CreateSubscriptionRequest(BaseModel):
    organization_id: str
    price_id: str
    metadata: Optional[dict] = None


class StripeConfigResponse(BaseModel):
    publishable_key: str


class PaymentIntentResponse(BaseModel):
    client_secret: str
    payment_intent_id: str


class CustomerResponse(BaseModel):
    customer_id: str
    email: str


class SubscriptionResponse(BaseModel):
    subscription_id: str
    status: str
    client_secret: Optional[str] = None
    current_period_end: int


# ===== Frontend-facing endpoints (require user auth) =====

@router.get("/config", response_model=StripeConfigResponse)
async def get_stripe_config(actor: WorkflowActor = Depends(require_workflow_actor)):
    """Get Stripe publishable key for frontend."""
    if not stripe_service.available:
        raise HTTPException(status_code=503, detail="Stripe is not installed or configured")
    if not settings.STRIPE_PUBLISHABLE_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    return StripeConfigResponse(publishable_key=settings.STRIPE_PUBLISHABLE_KEY)


@router.post("/customers", response_model=CustomerResponse)
async def create_customer(
    request: CreateCustomerRequest,
    actor: WorkflowActor = Depends(require_workflow_actor)
):
    """Create or get Stripe customer for current organization."""
    try:
        if not stripe_service.available:
            raise HTTPException(status_code=503, detail="Stripe is not installed or configured")
        await require_workflow_permission(request.organization_id, actor, "workflow.create")
        customer = stripe_service.get_or_create_customer(
            email=request.email,
            organization_id=request.organization_id
        )
        stripe_service.sync_customer_to_db(customer, request.organization_id)
        return CustomerResponse(customer_id=customer.id, email=customer.email or "")
    except Exception as e:
        logger.error(f"Failed to create customer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/payment-intents", response_model=PaymentIntentResponse)
async def create_payment_intent(
    request: CreatePaymentIntentRequest,
    actor: WorkflowActor = Depends(require_workflow_actor)
):
    """Create a PaymentIntent for one-time payment."""
    try:
        if not stripe_service.available:
            raise HTTPException(status_code=503, detail="Stripe is not installed or configured")
        await require_workflow_permission(request.organization_id, actor, "workflow.create")
        # Get or create customer
        from backend.services.supabase_client import supabase_service
        profile = supabase_service.client.table("profiles").select("email").eq("id", actor.user_id).single().execute()
        email = profile.data.get("email") if profile.data else None
        
        if not email:
            raise HTTPException(status_code=400, detail="User email not found")
        
        customer = stripe_service.get_or_create_customer(email, request.organization_id)
        
        intent = stripe_service.create_payment_intent(
            amount=request.amount,
            currency=request.currency,
            customer_id=customer.id,
            description=request.description,
            metadata={
                "organization_id": request.organization_id,
                **(request.metadata or {})
            }
        )
        
        return PaymentIntentResponse(
            client_secret=intent.client_secret,
            payment_intent_id=intent.id
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create payment intent: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/subscriptions", response_model=SubscriptionResponse)
async def create_subscription(
    request: CreateSubscriptionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor)
):
    """Create a subscription for recurring billing."""
    try:
        if not stripe_service.available:
            raise HTTPException(status_code=503, detail="Stripe is not installed or configured")
        await require_workflow_permission(request.organization_id, actor, "workflow.create")
        from backend.services.supabase_client import supabase_service
        profile = supabase_service.client.table("profiles").select("email").eq("id", actor.user_id).single().execute()
        email = profile.data.get("email") if profile.data else None
        
        if not email:
            raise HTTPException(status_code=400, detail="User email not found")
        
        customer = stripe_service.get_or_create_customer(email, request.organization_id)
        
        subscription = stripe_service.create_subscription(
            customer_id=customer.id,
            price_id=request.price_id,
            metadata={"organization_id": request.organization_id, **(request.metadata or {})}
        )
        
        stripe_service.sync_subscription_to_db(subscription, request.organization_id)
        
        latest_invoice = subscription.latest_invoice
        client_secret = None
        if latest_invoice and hasattr(latest_invoice, 'payment_intent') and latest_invoice.payment_intent:
            client_secret = latest_invoice.payment_intent.client_secret
        
        return SubscriptionResponse(
            subscription_id=subscription.id,
            status=subscription.status,
            client_secret=client_secret,
            current_period_end=subscription.current_period_end
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create subscription: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Webhook endpoint (no auth, verified by signature) =====

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature")
):
    """Handle Stripe webhook events."""
    if not stripe_service.available:
        raise HTTPException(status_code=503, detail="Stripe is not installed or configured")
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook secret not configured")
    
    payload = await request.body()
    
    try:
        event = stripe_service.construct_webhook_event(payload, stripe_signature)
    except Exception as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    logger.info(f"Received Stripe event: {event.type}")
    
    try:
        # Handle different event types
        if event.type == "payment_intent.succeeded":
            await _handle_payment_succeeded(event.data.object)
        elif event.type == "payment_intent.payment_failed":
            await _handle_payment_failed(event.data.object)
        elif event.type == "customer.subscription.created":
            await _handle_subscription_created(event.data.object)
        elif event.type == "customer.subscription.updated":
            await _handle_subscription_updated(event.data.object)
        elif event.type == "customer.subscription.deleted":
            await _handle_subscription_deleted(event.data.object)
        elif event.type == "invoice.payment_succeeded":
            await _handle_invoice_payment_succeeded(event.data.object)
        elif event.type == "invoice.payment_failed":
            await _handle_invoice_payment_failed(event.data.object)
        else:
            logger.info(f"Unhandled event type: {event.type}")
    
    except Exception as e:
        logger.error(f"Error processing webhook {event.type}: {e}")
        # Don't raise - return 200 to prevent Stripe retries for unhandled events
        # Only raise for events we explicitly want to retry
    
    return {"received": True}


# ===== Webhook Handlers =====

async def _handle_payment_succeeded(payment_intent):
    """Handle successful payment."""
    metadata = payment_intent.metadata
    organization_id = metadata.get("organization_id")
    
    if organization_id:
        stripe_service.sync_transaction_to_db(payment_intent, organization_id)
        logger.info(f"Synced payment {payment_intent.id} for org {organization_id}")


async def _handle_payment_failed(payment_intent):
    """Handle failed payment."""
    metadata = payment_intent.metadata
    organization_id = metadata.get("organization_id")
    
    if organization_id:
        stripe_service.sync_transaction_to_db(payment_intent, organization_id)
        logger.warning(f"Payment failed: {payment_intent.id} for org {organization_id}")


async def _handle_subscription_created(subscription):
    """Handle subscription creation."""
    metadata = subscription.metadata
    organization_id = metadata.get("organization_id")
    
    if organization_id:
        stripe_service.sync_subscription_to_db(subscription, organization_id)
        logger.info(f"Synced subscription {subscription.id} for org {organization_id}")


async def _handle_subscription_updated(subscription):
    """Handle subscription updates."""
    metadata = subscription.metadata
    organization_id = metadata.get("organization_id")
    
    if organization_id:
        stripe_service.sync_subscription_to_db(subscription, organization_id)
        logger.info(f"Updated subscription {subscription.id} for org {organization_id}")


async def _handle_subscription_deleted(subscription):
    """Handle subscription cancellation."""
    metadata = subscription.metadata
    organization_id = metadata.get("organization_id")
    
    if organization_id:
        stripe_service.sync_subscription_to_db(subscription, organization_id)
        logger.info(f"Canceled subscription {subscription.id} for org {organization_id}")


async def _handle_invoice_payment_succeeded(invoice):
    """Handle successful invoice payment (for subscriptions)."""
    subscription_id = invoice.subscription
    if subscription_id:
        subscription = stripe.Subscription.retrieve(subscription_id)
        metadata = subscription.metadata
        organization_id = metadata.get("organization_id")
        
        if organization_id:
            stripe_service.sync_subscription_to_db(subscription, organization_id)
            logger.info(f"Invoice payment succeeded for subscription {subscription_id}")


async def _handle_invoice_payment_failed(invoice):
    """Handle failed invoice payment."""
    subscription_id = invoice.subscription
    if subscription_id:
        subscription = stripe.Subscription.retrieve(subscription_id)
        metadata = subscription.metadata
        organization_id = metadata.get("organization_id")
        
        if organization_id:
            stripe_service.sync_subscription_to_db(subscription, organization_id)
            logger.warning(f"Invoice payment failed for subscription {subscription_id}")
