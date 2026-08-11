export interface SearchFilters {
  country: string;
  countryFlag: string;
  state: string;
  city: string;
  niche: string;
  websiteStatus: "no_website" | "needs_upgrade" | "all";
  leadLimit: number;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  country: "United States",
  countryFlag: "🇺🇸",
  state: "",
  city: "",
  niche: "",
  websiteStatus: "no_website",
  leadLimit: 20,
};
