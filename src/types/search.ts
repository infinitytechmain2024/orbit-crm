export interface SearchFilters {
  country: string;
  countryFlag: string;
  city: string;
  niche: string;
  websiteStatus: "no_website" | "needs_upgrade" | "all";
  leadLimit: number;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  country: "United States",
  countryFlag: "🇺🇸",
  city: "",
  niche: "",
  websiteStatus: "no_website",
  leadLimit: 20,
};
