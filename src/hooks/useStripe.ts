import { useCallback, useEffect, useState } from "react";
import { loadStripe, Stripe, StripeElements } from "@stripe/stripe-js";
import { useCrm } from "@/lib/crm-store";

let stripePromise: Promise<Stripe | null>;

export function useStripe() {
  const { organization, stripeCustomer } = useCrm();
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);

  useEffect(() => {
    if (!organization) return;

    if (!stripePromise) {
      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        console.warn("VITE_STRIPE_PUBLISHABLE_KEY not configured");
        return;
      }
      stripePromise = loadStripe(publishableKey);
    }

    stripePromise.then((loadedStripe) => {
      if (loadedStripe) {
        setStripe(loadedStripe);
        setElements(loadedStripe.elements({
          customer: stripeCustomer?.stripeCustomerId || undefined,
        }));
      }
    });
  }, [organization, stripeCustomer]);

  return { stripe, elements };
}

export async function createPaymentIntent(
  organizationId: string,
  amount: number,
  currency = "EUR",
  metadata?: Record<string, string>,
) {
  const response = await fetch("/api/backend/api/stripe/payment-intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: organizationId, amount: amount * 100, currency, metadata }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to create payment intent" }));
    throw new Error(error.detail || "Failed to create payment intent");
  }
  return response.json();
}

export async function createSubscription(
  organizationId: string,
  priceId: string,
  metadata?: Record<string, string>,
) {
  const response = await fetch("/api/backend/api/stripe/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: organizationId, price_id: priceId, metadata }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to create subscription" }));
    throw new Error(error.detail || "Failed to create subscription");
  }
  return response.json();
}
