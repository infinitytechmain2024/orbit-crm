import { useCallback, useEffect, useState } from "react";

export const DISPLAY_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "TRY", "UAH"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const DEFAULT_RATES: Record<DisplayCurrency, number> = {
  EUR: 1,
  USD: 1,
  GBP: 1,
  CHF: 1,
  PLN: 1,
  TRY: 1,
  UAH: 1,
};

const RATES_CACHE_KEY = "crm-exchange-rates";
const RATES_UPDATED_AT_KEY = "crm-exchange-rates-updated-at";

function normalizeRate(rate: unknown): number | null {
  const value = typeof rate === "string" ? Number(rate) : typeof rate === "number" ? rate : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function convertEurToDisplay(valueInEUR: number, currency: DisplayCurrency, rate: number) {
  return currency === "EUR" ? valueInEUR : valueInEUR * rate;
}

export function convertDisplayToEur(valueInDisplayCurrency: number, currency: DisplayCurrency, rate: number) {
  return currency === "EUR" ? valueInDisplayCurrency : valueInDisplayCurrency / rate;
}

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function useExchangeRates() {
  const [rates, setRates] = useState<Record<DisplayCurrency, number>>(() => {
    if (typeof window === "undefined") return DEFAULT_RATES;
    try {
      const saved = localStorage.getItem(RATES_CACHE_KEY);
      if (!saved) return DEFAULT_RATES;
      const parsed = JSON.parse(saved) as Partial<Record<DisplayCurrency, unknown>>;
      const nextRates: Record<DisplayCurrency, number> = { ...DEFAULT_RATES };
      for (const code of DISPLAY_CURRENCIES) {
        const rate = normalizeRate(parsed[code]);
        if (rate) nextRates[code] = rate;
      }
      return nextRates;
    } catch {
      return DEFAULT_RATES;
    }
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(RATES_UPDATED_AT_KEY);
  });
  const refreshIntervalMs = 60_000;

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const nextRates: Record<DisplayCurrency, number> = { ...DEFAULT_RATES };

      const ecbResponse = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
        signal: AbortSignal.timeout(8000),
      });
      if (!ecbResponse.ok) throw new Error("Failed to load exchange rates");
      const xml = await ecbResponse.text();
      const document = new DOMParser().parseFromString(xml, "application/xml");
      const cubes = [...document.querySelectorAll("Cube[currency][rate]")];
      for (const cube of cubes) {
        const currencyCode = cube.getAttribute("currency") as DisplayCurrency | null;
        const rate = normalizeRate(cube.getAttribute("rate"));
        if (!currencyCode || !rate || !(currencyCode in nextRates)) continue;
        nextRates[currencyCode] = rate;
      }

      const missingCurrencies = DISPLAY_CURRENCIES.filter((code) => nextRates[code] === 1 && code !== "EUR");
      if (missingCurrencies.length) {
        const fallbackResponse = await fetch("https://open.er-api.com/v6/latest/EUR", {
          signal: AbortSignal.timeout(8000),
        });
        if (fallbackResponse.ok) {
          const fallbackData: unknown = await fallbackResponse.json();
          const ratesMap =
            typeof fallbackData === "object" && fallbackData && "rates" in fallbackData
              ? (fallbackData as { rates?: Record<string, unknown> }).rates
              : null;

          if (ratesMap) {
            for (const code of missingCurrencies) {
              const rate = normalizeRate(ratesMap[code]);
              if (rate) nextRates[code] = rate;
            }
          }
        }
      }

      setRates(nextRates);
      setStatus("ready");
      const nextUpdatedAt = new Date().toLocaleString("ru-RU");
      setUpdatedAt(nextUpdatedAt);
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(nextRates));
      localStorage.setItem(RATES_UPDATED_AT_KEY, nextUpdatedAt);
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void reload();
    }, refreshIntervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void reload();
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reload]);

  return { rates, status, updatedAt, reload };
}
