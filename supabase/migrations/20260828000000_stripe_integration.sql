-- Stripe Customers linked to organizations
CREATE TABLE IF NOT EXISTS public.stripe_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    stripe_customer_id text NOT NULL UNIQUE,
    email text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT stripe_customers_pkey PRIMARY KEY (id),
    CONSTRAINT stripe_customers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

-- Stripe Payment Intents / Transactions
CREATE TABLE IF NOT EXISTS public.stripe_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    stripe_payment_intent_id text NOT NULL UNIQUE,
    stripe_customer_id text,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'EUR' NOT NULL,
    status text NOT NULL,
    payment_method_type text,
    description text,
    metadata jsonb DEFAULT '{}',
    occurred_on date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT stripe_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT stripe_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT stripe_transactions_amount_check CHECK (amount >= 0)
);

-- Stripe Subscriptions (for recurring revenue tracking)
CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    stripe_subscription_id text NOT NULL UNIQUE,
    stripe_customer_id text NOT NULL,
    stripe_price_id text NOT NULL,
    status text NOT NULL,
    current_period_start timestamptz NOT NULL,
    current_period_end timestamptz NOT NULL,
    cancel_at_period_end boolean DEFAULT false,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'EUR' NOT NULL,
    interval text NOT NULL,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT stripe_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT stripe_subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS stripe_customers_organization_idx ON public.stripe_customers(organization_id);
CREATE INDEX IF NOT EXISTS stripe_transactions_organization_date_idx ON public.stripe_transactions(organization_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS stripe_subscriptions_organization_idx ON public.stripe_subscriptions(organization_id);

-- RLS Policies
ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read stripe customers" ON public.stripe_customers FOR SELECT TO authenticated
    USING (private.is_organization_member(organization_id, auth.uid()));
CREATE POLICY "Service role manages stripe customers" ON public.stripe_customers FOR ALL TO service_role USING (true);

CREATE POLICY "Members can read stripe transactions" ON public.stripe_transactions FOR SELECT TO authenticated
    USING (private.is_organization_member(organization_id, auth.uid()));
CREATE POLICY "Service role manages stripe transactions" ON public.stripe_transactions FOR ALL TO service_role USING (true);

CREATE POLICY "Members can read stripe subscriptions" ON public.stripe_subscriptions FOR SELECT TO authenticated
    USING (private.is_organization_member(organization_id, auth.uid()));
CREATE POLICY "Service role manages stripe subscriptions" ON public.stripe_subscriptions FOR ALL TO service_role USING (true);

-- Grants
GRANT ALL ON public.stripe_customers TO service_role;
GRANT SELECT ON public.stripe_customers TO authenticated;
GRANT ALL ON public.stripe_transactions TO service_role;
GRANT SELECT ON public.stripe_transactions TO authenticated;
GRANT ALL ON public.stripe_subscriptions TO service_role;
GRANT SELECT ON public.stripe_subscriptions TO authenticated;

-- Updated at triggers
CREATE TRIGGER set_stripe_customers_updated_at
    BEFORE UPDATE ON public.stripe_customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_stripe_transactions_updated_at
    BEFORE UPDATE ON public.stripe_transactions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_stripe_subscriptions_updated_at
    BEFORE UPDATE ON public.stripe_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();