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
  const [rates, setRates] = useState<Record<DisplayCurrency, number>>(DEFAULT_RATES);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Failed to load exchange rates");
      const xml = await response.text();
      const document = new DOMParser().parseFromString(xml, "application/xml");
      const cubes = [...document.querySelectorAll("Cube[currency][rate]")];
      const nextRates: Record<DisplayCurrency, number> = { ...DEFAULT_RATES };

      for (const cube of cubes) {
        const currencyCode = cube.getAttribute("currency") as DisplayCurrency | null;
        const rate = normalizeRate(cube.getAttribute("rate"));
        if (!currencyCode || !rate || !(currencyCode in nextRates)) continue;
        nextRates[currencyCode] = rate;
      }

      setRates(nextRates);
      setStatus("ready");
      setUpdatedAt(new Date().toLocaleString("ru-RU"));
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rates, status, updatedAt, reload };
}
