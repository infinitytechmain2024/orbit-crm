"use client";

import { useState, FormEvent } from "react";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useStripe as useStripeHook } from "@/hooks/useStripe";
import { useCrm } from "@/lib/crm-store";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentFormProps {
  amount: number;
  currency?: string;
  description?: string;
  onSuccess?: (paymentIntentId: string) => void;
  onError?: (error: string) => void;
}

export function StripePaymentForm({
  amount,
  currency = "EUR",
  description,
  onSuccess,
  onError,
}: PaymentFormProps) {
  const { stripe, elements } = useStripeHook();
  const { organization } = useCrm();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (!organization) {
      setError("Организация ещё загружается");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const { client_secret, payment_intent_id } = await createPaymentIntent(
        organization.id,
        amount,
        currency,
        { description: description || "Оплата через Orbit CRM" }
      );

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        client_secret,
        {
          payment_method: {
            card: elements.getElement(CardElement)!,
          },
        }
      );

      if (stripeError) {
        setError(stripeError.message || "Ошибка оплаты");
        onError?.(stripeError.message || "Ошибка оплаты");
      } else if (paymentIntent?.status === "succeeded") {
        setSucceeded(true);
        onSuccess?.(payment_intent_id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка при обработке платежа";
      setError(message);
      onError?.(message);
    } finally {
      setIsProcessing(false);
    }
  };

  if (succeeded) {
    return (
      <div className="panel p-6 text-center">
        <CheckCircle className="size-12 text-acc-1 mx-auto mb-4" />
        <h3 className="text-lg font-semibold">Оплата прошла успешно!</h3>
        <p className="text-muted-foreground mt-1">{description}</p>
        <p className="text-2xl font-display font-bold mt-2">{amount.toLocaleString("ru-RU")} {currency}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-6 space-y-4" disabled={!stripe || !elements}>
      {description && (
        <div className="text-sm text-muted-foreground">
          {description}
        </div>
      )}

      <div className="text-3xl font-display font-bold text-center">
        {amount.toLocaleString("ru-RU")} {currency}
      </div>

      <div className="relative">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "var(--foreground)",
                fontFamily: "var(--font-montserrat)",
                "::placeholder": { color: "var(--muted-foreground)" },
              },
              invalid: { color: "var(--destructive)" },
            },
          }}
          className={cn(
            "w-full rounded-lg border border-border bg-surface px-4 py-3",
            "focus-within:ring-2 focus-within:ring-primary"
          )}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={isProcessing || !stripe || !elements}
      >
        {isProcessing ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Обработка...
          </>
        ) : (
          <>
            <CreditCard className="size-4 mr-2" />
            Оплатить {amount.toLocaleString("ru-RU")} {currency}
          </>
        )}
      </Button>
    </form>
  );
}
