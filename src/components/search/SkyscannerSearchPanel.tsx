import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, MapPin, Building2, Globe, Hash, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { US_CITIES, NICHE_CATEGORIES, type UsCity } from "@/lib/us-cities";
import type { SearchFilters } from "@/types/search";

interface SkyscannerSearchPanelProps {
  onSearch: (filters: SearchFilters) => void;
  isSearching: boolean;
  initialFilters?: SearchFilters | undefined;
}

const COUNTRIES = [
  { name: "United States", flag: "🇺🇸", code: "US" },
  { name: "Ukraine", flag: "🇺🇦", code: "UA" },
  { name: "United Kingdom", flag: "🇬🇧", code: "GB" },
  { name: "Germany", flag: "🇩🇪", code: "DE" },
  { name: "France", flag: "🇫🇷", code: "FR" },
  { name: "Canada", flag: "🇨🇦", code: "CA" },
  { name: "Australia", flag: "🇦🇺", code: "AU" },
];

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

const WEBSITE_STATUS_OPTIONS = [
  { value: "no_website" as const, label: "No Website", priority: true },
  { value: "needs_upgrade" as const, label: "Needs Upgrade" },
  { value: "all" as const, label: "All" },
];

export function SkyscannerSearchPanel({
  onSearch,
  isSearching,
  initialFilters,
}: SkyscannerSearchPanelProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    country: initialFilters?.country ?? "United States",
    countryFlag: initialFilters?.countryFlag ?? "🇺🇸",
    state: initialFilters?.state ?? "",
    city: initialFilters?.city ?? "",
    niche: initialFilters?.niche ?? "",
    websiteStatus: initialFilters?.websiteStatus ?? "no_website",
    leadLimit: initialFilters?.leadLimit ?? 20,
  });

  const [citySearch, setCitySearch] = useState(initialFilters?.city ?? "");
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [filteredCities, setFilteredCities] = useState<UsCity[]>([]);
  const [nicheSearch, setNicheSearch] = useState(initialFilters?.niche ?? "");
  const [showNicheDropdown, setShowNicheDropdown] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showStateDropdown, setShowStateDropdown] = useState(false);
  const cityRef = useRef<HTMLDivElement>(null);
  const nicheRef = useRef<HTMLDivElement>(null);
  const countryRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLDivElement>(null);

  const availableStates = useMemo(() => {
    if (filters.country !== "United States") return [];
    const states = [...new Set(US_CITIES.map((c) => c.state))].sort();
    return states;
  }, [filters.country]);

  useEffect(() => {
    let cities = US_CITIES;
    if (filters.state) {
      cities = cities.filter((c) => c.state === filters.state);
    }
    if (citySearch.length === 0) {
      setFilteredCities(cities.slice(0, 20));
    } else {
      const search = citySearch.toLowerCase();
      const filtered = cities
        .filter(
          (city) =>
            city.name.toLowerCase().includes(search) || city.state.toLowerCase().includes(search),
        )
        .slice(0, 20);
      setFilteredCities(filtered);
    }
  }, [citySearch, filters.state]);

  const filteredNiches = NICHE_CATEGORIES.filter((niche) =>
    niche.toLowerCase().includes(nicheSearch.toLowerCase()),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cityRef.current && !cityRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
      if (nicheRef.current && !nicheRef.current.contains(event.target as Node)) {
        setShowNicheDropdown(false);
      }
      if (countryRef.current && !countryRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false);
      }
      if (stateRef.current && !stateRef.current.contains(event.target as Node)) {
        setShowStateDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCountrySelect = useCallback((country: (typeof COUNTRIES)[number]) => {
    setFilters((prev) => ({
      ...prev,
      country: country.name,
      countryFlag: country.flag,
      state: "",
      city: "",
    }));
    setCitySearch("");
    setShowCountryDropdown(false);
  }, []);

  const handleStateSelect = useCallback((state: string) => {
    setFilters((prev) => ({ ...prev, state, city: "" }));
    setCitySearch("");
    setShowStateDropdown(false);
  }, []);

  const handleCitySelect = useCallback((city: UsCity) => {
    setFilters((prev) => ({ ...prev, city: `${city.name}, ${city.state}` }));
    setCitySearch(`${city.name}, ${city.state}`);
    setShowCityDropdown(false);
  }, []);

  const handleNicheSelect = useCallback((niche: string) => {
    setFilters((prev) => ({ ...prev, niche }));
    setNicheSearch(niche);
    setShowNicheDropdown(false);
  }, []);

  const handleSearch = () => {
    onSearch(filters);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const currentCountry = COUNTRIES.find((c) => c.name === filters.country) ?? COUNTRIES[0]!;

  return (
    <div className="rounded-2xl border border-border bg-surface-2/60 p-6 shadow-lg">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Country + State + City */}
        <div className="space-y-5">
          {/* Country Selector */}
          <div ref={countryRef}>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Globe className="size-3.5" />
              Country
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none transition focus:border-primary/60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{currentCountry.flag}</span>
                  <span className="font-medium">{currentCountry.name}</span>
                </div>
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>

              {showCountryDropdown && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 shadow-lg">
                  {COUNTRIES.map((country) => (
                    <button
                      key={country.code}
                      onClick={() => handleCountrySelect(country)}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-2.5 text-sm transition hover:bg-primary/10",
                        filters.country === country.name && "bg-primary/5",
                      )}
                    >
                      <span className="text-lg">{country.flag}</span>
                      <span className="font-medium">{country.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* State Selector (US only) */}
          {filters.country === "United States" && (
            <div ref={stateRef}>
              <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MapPin className="size-3.5" />
                State
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowStateDropdown(!showStateDropdown)}
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none transition focus:border-primary/60"
                >
                  <span className={cn("font-medium", !filters.state && "text-muted-foreground")}>
                    {filters.state || "Select state..."}
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>

                {showStateDropdown && (
                  <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 shadow-lg">
                    <button
                      onClick={() => handleStateSelect("")}
                      className={cn(
                        "flex w-full items-center px-4 py-2.5 text-sm transition hover:bg-primary/10",
                        !filters.state && "bg-primary/5",
                      )}
                    >
                      <span className="text-muted-foreground">All states</span>
                    </button>
                    {availableStates.map((state) => (
                      <button
                        key={state}
                        onClick={() => handleStateSelect(state)}
                        className={cn(
                          "flex w-full items-center px-4 py-2.5 text-sm transition hover:bg-primary/10",
                          filters.state === state && "bg-primary/5",
                        )}
                      >
                        <span className="font-medium">{state}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* City Autocomplete */}
          <div ref={cityRef}>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MapPin className="size-3.5" />
              City / Location
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={citySearch}
                onChange={(e) => {
                  setCitySearch(e.target.value);
                  setShowCityDropdown(true);
                  setFilters((prev) => ({ ...prev, city: e.target.value }));
                }}
                onFocus={() => setShowCityDropdown(true)}
                onKeyDown={handleKeyDown}
                placeholder="Search any US city, town, or county..."
                className="w-full rounded-xl border border-border bg-surface-2/60 py-3 pl-10 pr-10 text-sm outline-none transition focus:border-primary/60"
              />
              {filters.city && (
                <button
                  onClick={() => {
                    setFilters((prev) => ({ ...prev, city: "" }));
                    setCitySearch("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}

              {showCityDropdown && filteredCities.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 shadow-lg">
                  {filteredCities.map((city, idx) => (
                    <button
                      key={`${city.name}-${city.state}-${idx}`}
                      onClick={() => handleCitySelect(city)}
                      className={cn(
                        "flex w-full items-center justify-between px-4 py-2.5 text-sm transition hover:bg-primary/10",
                        filters.city === `${city.name}, ${city.state}` && "bg-primary/5",
                      )}
                    >
                      <span className="font-medium">{city.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {city.state} · {(city.population / 1000).toFixed(0)}k
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Niche + Website Status + Lead Limit */}
        <div className="space-y-5">
          {/* Niche Selector */}
          <div ref={nicheRef}>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Building2 className="size-3.5" />
              Industry / Niche
            </label>
            <div className="relative">
              <input
                type="text"
                value={nicheSearch || filters.niche}
                onChange={(e) => {
                  setNicheSearch(e.target.value);
                  setShowNicheDropdown(true);
                  setFilters((prev) => ({ ...prev, niche: e.target.value }));
                }}
                onFocus={() => setShowNicheDropdown(true)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Dental, Cleaning, Auto Repair..."
                className="w-full rounded-xl border border-border bg-surface-2/60 px-4 py-3 pr-10 text-sm outline-none transition focus:border-primary/60"
              />
              <ChevronDown className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              {showNicheDropdown && filteredNiches.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 shadow-lg">
                  {filteredNiches.map((niche) => (
                    <button
                      key={niche}
                      onClick={() => handleNicheSelect(niche)}
                      className={cn(
                        "flex w-full items-center px-4 py-2.5 text-sm transition hover:bg-primary/10",
                        filters.niche === niche && "bg-primary/5",
                      )}
                    >
                      <span className="font-medium">{niche}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Website Status */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Website Status
            </label>
            <div className="flex gap-2">
              {WEBSITE_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilters((prev) => ({ ...prev, websiteStatus: opt.value }))}
                  className={cn(
                    "flex-1 rounded-xl px-3 py-2.5 text-xs font-medium transition",
                    filters.websiteStatus === opt.value
                      ? opt.priority
                        ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                        : "bg-primary text-primary-foreground"
                      : "border border-border bg-surface-2/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lead Limit */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Hash className="size-3.5" />
              Lead Limit
            </label>
            <input
              type="number"
              value={filters.leadLimit}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  leadLimit: Math.max(1, Math.min(100, Number(e.target.value))),
                }))
              }
              min={1}
              max={100}
              className="w-full rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none transition focus:border-primary/60"
            />
          </div>
        </div>
      </div>

      {/* Search Button */}
      <button
        onClick={handleSearch}
        disabled={isSearching || !filters.city || !filters.niche}
        className={cn(
          "mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold transition",
          isSearching || !filters.city || !filters.niche
            ? "bg-primary/50 text-primary-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {isSearching ? (
          <>
            <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Searching...
          </>
        ) : (
          <>
            <Search className="size-4" />
            Find Leads
          </>
        )}
      </button>
    </div>
  );
}
