import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-search")({
  server: {
    handlers: {
      POST: ({ request }) => handleLeadSearch(request),
    },
  },
});

interface LeadResult {
  id: string;
  business_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  category: string;
  rating: number;
  reviews: number;
  source: string;
  google_maps_url: string;
}

const GEOCODE_CACHE = new Map<string, { lat: number; lon: number }>();

async function geocodeLocation(place: string): Promise<{ lat: number; lon: number } | null> {
  if (GEOCODE_CACHE.has(place)) return GEOCODE_CACHE.get(place) ?? null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "orbit-crm-lead-search/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.length) return null;
    const result = { lat: parseFloat(data[0].lat as string), lon: parseFloat(data[0].lon as string) };
    GEOCODE_CACHE.set(place, result);
    return result;
  } catch {
    return null;
  }
}

async function searchGoogleMaps(
  niche: string,
  city: string,
  country: string,
  limit: number,
): Promise<LeadResult[]> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (apiKey) {
    try {
      const location = `${city}, ${country}`;
      const coords = await geocodeLocation(location);
      if (coords) return await searchWithGoogleAPI(apiKey, niche, coords, limit);
    } catch (e) {
      console.warn("[lead-search] Google API failed, trying fallback:", e);
    }
  }

  try {
    const location = `${city}, ${country}`;
    const coords = await geocodeLocation(location);
    if (coords) {
      const results = await searchWithOverpass(niche, coords, limit);
      if (results.length > 0) return results;
    }
  } catch (e) {
    console.warn("[lead-search] Overpass failed, trying browser:", e);
  }

  try {
    return await searchWithBrowser(niche, city, country, limit);
  } catch (e) {
    console.error("[lead-search] Browser search failed:", e);
    throw new Error(
      `All search methods failed. Last error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function searchWithGoogleAPI(
  apiKey: string,
  niche: string,
  coords: { lat: number; lon: number },
  limit: number,
): Promise<LeadResult[]> {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${niche} near ${coords.lat},${coords.lon}`)}&key=${apiKey}&radius=50000`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Google Maps API error: ${resp.status}`);
  const data = await resp.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Maps API status: ${data.status as string}`);
  }

  const leads: LeadResult[] = [];
  for (const place of (data.results as Array<Record<string, unknown>> || []).slice(0, limit)) {
    const placeId = String(place["place_id"] || "");
    const details = await fetchPlaceDetails(apiKey, placeId);
    leads.push({
      id: placeId || `gmaps-${leads.length}`,
      business_name: String(place["name"] || ""),
      address: String(place["formatted_address"] || ""),
      phone: details?.international_phone_number || "",
      email: "",
      website: details?.website || "",
      category: Array.isArray(place["types"]) ? String(place["types"][0] || "").replace(/_/g, " ") : "",
      rating: Number(place["rating"] || 0),
      reviews: Number(place["user_ratings_total"] || 0),
      source: "google_maps",
      google_maps_url: `https://maps.google.com/maps?q=${encodeURIComponent(String(place["name"] || ""))}`,
    });
  }
  return leads;
}

async function fetchPlaceDetails(
  apiKey: string,
  placeId: string,
): Promise<{ international_phone_number?: string; website?: string } | null> {
  if (!placeId) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=international_phone_number,website&key=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.result as { international_phone_number?: string; website?: string }) || null;
  } catch {
    return null;
  }
}

async function searchWithOverpass(
  niche: string,
  coords: { lat: number; lon: number },
  limit: number,
): Promise<LeadResult[]> {
  const amenityMap: Record<string, string> = {
    restaurant: "restaurant",
    cafe: "cafe",
    bar: "bar",
    pub: "pub",
    coffee: "cafe",
    bakery: "bakery",
    gym: "gym",
    fitness: "gym",
    salon: "beauty_salon",
    hair: "hairdresser",
    dentist: "dentist",
    doctor: "doctor",
    pharmacy: "pharmacy",
    hotel: "hotel",
    store: "shop",
    shop: "shop",
    market: "supermarket",
    grocery: "supermarket",
    mechanic: "car_repair",
    auto: "car_repair",
    lawyer: "lawyer",
    attorney: "lawyer",
    insurance: "insurance",
    bank: "bank",
    realty: "estate_agent",
    realtor: "estate_agent",
    cleaning: "cleaning",
    plumber: "plumber",
    electrician: "electrician",
    painter: "painter",
    roofing: "roofer",
    landscaping: "landscaping",
  };

  const queryWord = niche.toLowerCase().split(/\s+/)[0] ?? "";
  const amenity = amenityMap[queryWord] || "shop";

  const query = `
    [out:json][timeout:30];
    (
      node["amenity"="${amenity}"](around:50000,${coords.lat},${coords.lon});
      way["amenity"="${amenity}"](around:50000,${coords.lat},${coords.lon});
    );
    out center body;
  `;

  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
  const data = await resp.json();
  const elements = (data.elements as Array<Record<string, unknown>> || []).slice(0, limit);

  const leads: LeadResult[] = [];
  for (const el of elements) {
    const tags = (el["tags"] as Record<string, string>) || {};
    const lat = el["lat"] as number | undefined;
    const lon = el["lon"] as number | undefined;
    const center = el["center"] as { lat?: number; lon?: number } | undefined;
    const elLat = lat ?? center?.lat;
    const elLon = lon ?? center?.lon;
    leads.push({
      id: `osm-${String(el["id"])}`,
      business_name: tags["name"] || tags["name:en"] || tags["name:uk"] || "",
      address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]]
        .filter(Boolean)
        .join(" ") || "",
      phone: tags["phone"] || tags["contact:phone"] || tags["contact:mobile"] || "",
      email: tags["email"] || tags["contact:email"] || "",
      website: tags["website"] || tags["contact:website"] || "",
      category: tags["amenity"] || tags["shop"] || "",
      rating: 0,
      reviews: 0,
      source: "openstreetmap",
      google_maps_url:
        elLat && elLon
          ? `https://www.openstreetmap.org/?mlat=${elLat}&mlon=${elLon}#map=16/${elLat}/${elLon}`
          : "",
    });
  }
  return leads;
}

async function enrichLeadsWithWebScraping(leads: LeadResult[]): Promise<LeadResult[]> {
  const enriched = [...leads];

  for (let i = 0; i < enriched.length; i++) {
    const lead = enriched[i];
    if (!lead || lead.email || !lead.website) continue;

    try {
      const url = lead.website.startsWith("http") ? lead.website : `https://${lead.website}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (!resp.ok) continue;

      const html = await resp.text();
      const emailMatch = html.match(
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      );
      if (emailMatch?.[1]) {
        enriched[i] = { ...lead, email: emailMatch[1] };
      }

      const phoneMatch = html.match(
        /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/,
      );
      if (phoneMatch?.[0] && !lead.phone) {
        enriched[i] = { ...lead, phone: phoneMatch[0] };
      }
    } catch {
      // Skip failed scraping attempts
    }
  }

  return enriched;
}

async function searchWithBrowser(
  niche: string,
  city: string,
  country: string,
  limit: number,
): Promise<LeadResult[]> {
  const backendUrl =
    process.env["AI_WORKFLOW_BACKEND_URL"] ||
    process.env["RENDER_BACKEND_URL"] ||
    process.env["VITE_API_URL"] ||
    "";

  if (!backendUrl) {
    throw new Error("Backend URL not configured for browser search");
  }

  const resp = await fetch(`${backendUrl.replace(/\/$/, "")}/api/leads/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "lead-search-api",
      organization_id: "lead-search-api",
      city,
      niche,
      max_results: limit,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    throw new Error(`Backend browser search failed: ${resp.status}`);
  }

  const data = await resp.json() as { job_id: string };
  const jobId = data.job_id;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusResp = await fetch(
      `${backendUrl.replace(/\/$/, "")}/api/leads/search/${jobId}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!statusResp.ok) continue;
    const status = await statusResp.json() as {
      status: string;
      leads?: Array<Record<string, unknown>>;
      error?: string;
    };
    if (status.status === "completed") {
      return (status.leads || []).map((l) => ({
        id: String(l["id"] || Math.random()),
        business_name: String(l["business_name"] || l["title"] || ""),
        address: String(l["address"] || ""),
        phone: String(l["phone"] || l["contact_phone"] || ""),
        email: String(l["email"] || ""),
        website: String(l["website"] || l["website_url"] || ""),
        category: String(l["category"] || ""),
        rating: Number(l["rating"] || 0),
        reviews: Number(l["reviews"] || 0),
        source: "google_maps_browser",
        google_maps_url: String(l["google_maps_url"] || ""),
      }));
    }
    if (status.status === "failed") {
      throw new Error(status.error || "Browser search failed");
    }
  }

  throw new Error("Browser search timed out after 3 minutes");
}

async function handleLeadSearch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      niche?: string;
      city?: string;
      country?: string;
      limit?: number;
    };
    const { niche, city, country, limit = 20 } = body;

    if (!niche || !city || !country) {
      return Response.json(
        { error: "niche, city, and country are required" },
        { status: 400 },
      );
    }

    const cappedLimit = Math.min(Math.max(1, limit), 100);

    const leads = await searchGoogleMaps(niche, city, country, cappedLimit);
    const enrichedLeads = await enrichLeadsWithWebScraping(leads);

    return Response.json({
      leads: enrichedLeads,
      total: enrichedLeads.length,
      query: { niche, city, country, limit: cappedLimit },
    });
  } catch (error) {
    console.error("[lead-search]", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Lead search failed",
        leads: [],
        total: 0,
      },
      { status: 500 },
    );
  }
}
