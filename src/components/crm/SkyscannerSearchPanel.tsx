import { useState, useRef, useEffect, useCallback } from "react";
import { Search, MapPin, Building2, Globe, Hash, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { US_CITIES, NICHE_CATEGORIES, type UsCity } from "@/lib/us-cities";

interface SearchFilters {
  country: string;
  countryFlag: string;
  city: string;
  niche: string;
  websiteStatus: "no_website" | "needs_upgrade" | "all";
  leadLimit: number;
}

interface SkyscannerSearchPanelProps {
  onSearch: (filters: SearchFilters) => void;
  isSearching: boolean;
}

const WEBSITE_STATUS_OPTIONS = [
  { value: "no_website" as const, label: "No Website", priority: true },
  { value: "needs_upgrade" as const, label: "Needs Upgrade" },
  { value: "all" as const, label: "All" },
];

export function SkyscannerSearchPanel({ onSearch, isSearching }: SkyscannerSearchPanelProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    country: "United States",
    countryFlag: "🇺🇸",
    city: "",
    niche: "",
    websiteStatus: "no_website",
    leadLimit: 20,
  });

  const [citySearch, setCitySearch] = useState("");
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [filteredCities, setFilteredCities] = useState<UsCity[]>([]);
  const [nicheSearch, setNicheSearch] = useState("");
  const [showNicheDropdown, setShowNicheDropdown] = useState(false);
  const cityRef = useRef<HTMLDivElement>(null);
  const nicheRef = useRef<HTMLDivElement>(null);

  // Filter cities based on search
  useEffect(() => {
    if (citySearch.length === 0) {
      setFilteredCities(US_CITIES.slice(0, 20));
    } else {
      const search = citySearch.toLowerCase();
      const filtered = US_CITIES.filter(
        (city) =>
          city.name.toLowerCase().includes(search) || city.state.toLowerCase().includes(search),
      ).slice(0, 20);
      setFilteredCities(filtered);
    }
  }, [citySearch]);

  // Filter niches based on search
  const filteredNiches = NICHE_CATEGORIES.filter((niche) =>
    niche.toLowerCase().includes(nicheSearch.toLowerCase()),
  );

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cityRef.current && !cityRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
      if (nicheRef.current && !nicheRef.current.contains(event.target as Node)) {
        setShowNicheDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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

  return (
    <div className="rounded-2xl border border-border bg-surface-2/60 p-6 shadow-lg">
      {/* Country Selector */}
      <div className="mb-4">
        <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Globe className="size-3.5" />
          Country
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-4 py-3">
          <span className="text-lg">{filters.countryFlag}</span>
          <span className="text-sm font-medium">{filters.country}</span>
        </div>
      </div>

      {/* City Autocomplete */}
      <div className="mb-4" ref={cityRef}>
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
            className="w-full rounded-xl border border-border bg-surface-2/60 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
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

      {/* Niche Selector */}
      <div className="mb-4" ref={nicheRef}>
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
            className="w-full rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none transition focus:border-primary/60"
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
      <div className="mb-4">
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
                    ? "bg-badge-orange-bg text-badge-orange border border-badge-orange/30"
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
      <div className="mb-6">
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

      {/* Search Button */}
      <button
        onClick={handleSearch}
        disabled={isSearching || !filters.city || !filters.niche}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold transition",
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

export type { SearchFilters };
