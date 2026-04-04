"use client";

import { useState, useRef, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { Search, X, Loader2, MapPin } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

// Common US locations for autocomplete
const COMMON_LOCATIONS = [
  "Portland, OR",
  "Portland, ME",
  "Seattle, WA",
  "San Francisco, CA",
  "Los Angeles, CA",
  "New York, NY",
  "Chicago, IL",
  "Austin, TX",
  "Denver, CO",
  "Boston, MA",
  "Washington, DC",
  "Atlanta, GA",
  "Miami, FL",
  "Dallas, TX",
  "Houston, TX",
  "Minneapolis, MN",
  "Phoenix, AZ",
  "San Diego, CA",
  "Nashville, TN",
  "Portland metro",
  "Hillsboro, OR",
  "Beaverton, OR",
];

const STATE_ABBREVIATIONS = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

function normalizeLocations(input: string): string[] {
  const tokens = input
    .split(/\n|;/g)
    .flatMap((line) => line.split(","))
    .map((part) => part.trim())
    .filter(Boolean);

  const normalized: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const part = tokens[i];

    if (STATE_ABBREVIATIONS.has(part.toUpperCase()) && normalized.length > 0) {
      const prev = normalized[normalized.length - 1];
      if (!prev.toUpperCase().endsWith(part.toUpperCase())) {
        normalized[normalized.length - 1] = `${prev}, ${part.toUpperCase()}`;
      }
      continue;
    }

    normalized.push(part);
  }

  const unique = Array.from(new Set(normalized.map((loc) => loc.replace(/\s+/g, " ").trim())));
  return unique.filter((loc) => loc.length > 0);
}

function getActiveLocationToken(input: string, mode: "single" | "multiple") {
  if (mode === "single") return input.trim();

  const tokens = input
    .split(/\n|;/g)
    .flatMap((line) => line.split(","))
    .map((part) => part.trim())
    .filter(Boolean);

  return tokens.length > 0 ? tokens[tokens.length - 1] : "";
}

type Props = {
  onSuccess: () => void;
};

export function FindLeadsButton({ onSuccess }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors shadow-sm"
      >
        <Search size={14} />
        Find Leads
      </button>

      {open && (
        <FindLeadsModal
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            onSuccess();
          }}
        />
      )}
    </>
  );
}

function FindLeadsModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { getToken } = useAuth();
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [searchMode, setSearchMode] = useState<"single" | "multiple">("single");
  const [radius, setRadius] = useState(25);
  const [maxResults, setMaxResults] = useState(10);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Filter location suggestions based on active token (single or multiple input fields)
  const locationSuggestions = useMemo(() => {
    const token = getActiveLocationToken(location, searchMode);
    if (!token) return COMMON_LOCATIONS;

    return COMMON_LOCATIONS.filter((loc) =>
      loc.toLowerCase().includes(token.toLowerCase()),
    );
  }, [location, searchMode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setToast(null);

    try {
      const token = await getToken();
      
      // Prepare location data based on search mode
      let locationData: string | { locations: string[]; radius?: number };
      
      if (searchMode === "single") {
        locationData = {
          locations: [location],
          radius: radius,
        };
      } else {
        const locations = normalizeLocations(location);

        if (locations.length === 0) {
          setToast({ type: "error", message: "Please enter at least one location" });
          setLoading(false);
          return;
        }

        setLocation(locations.join(", "));

        locationData = {
          locations,
        };
      }

      console.log("Sending lead discovery request:", { niche, locationData, maxResults });
      
      const res = await fetch(`${API_URL}/api/leads/ingest`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          niche, 
          location: searchMode === "single" ? location : locationData,
          maxResults 
        }),
      });

      const json = await res.json();
      console.log("API response:", { status: res.status, data: json });

      if (!json?.data || typeof json.data.leadsQueued !== "number") {
        setToast({
          type: "error",
          message: "Unable to queue leads. Check API auth config and API_URL / NEXT_PUBLIC_API_URL settings.",
        });
        return;
      }

      if (!res.ok) {
        setToast({ 
          type: "error", 
          message: json.message ?? json.error ?? "Failed to search for leads. Please try again." 
        });
        return;
      }

      const queued: number = json.data?.leadsQueued ?? 0;

      if (queued === 0) {
        setToast({
          type: "error",
          message: "No leads found for this niche/location. Try a broader search or different locations.",
        });
        return; // keep modal open for retry
      }

      setToast({
        type: "success",
        message: `${queued} lead${queued === 1 ? "" : "s"} queued for research`,
      });

      setTimeout(() => {
        onSuccess();
      }, 1200);
    } catch (err) {
      console.error("Search error:", err);
      setToast({ 
        type: "error", 
        message: err instanceof Error ? err.message : "Network error. Please check your connection." 
      });
    } finally {
      setLoading(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  function selectLocation(loc: string) {
    if (searchMode === "multiple") {
      const normalized = normalizeLocations(location);
      if (normalized.length > 0) {
        normalized[normalized.length - 1] = loc;
        setLocation(normalized.join(", "));
      } else {
        setLocation(loc);
      }
    } else {
      setLocation(loc);
    }
    setShowLocationSuggestions(false);
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-md bg-white rounded-[16px] shadow-xl border border-[#E8E6E1] p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Find Leads</h2>
            <p className="text-xs text-stone-400 mt-0.5">Discover businesses via Apollo + Google Places</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 px-3 py-2.5 rounded-lg text-sm font-medium ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}
          >
            {toast.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1.5">
              Niche
            </label>
            <input
              type="text"
              placeholder="e.g. medspa, auto repair, dental, plumber"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg border border-[#E8E6E1] bg-[#FAFAF8] text-sm text-stone-800 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-stone-400">E.g., healthcare service, business type, or industry</p>
          </div>

          {/* Search Mode Toggle */}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-2">
              Search Mode
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchMode("single");
                  setLocation("");
                }}
                disabled={loading}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  searchMode === "single"
                    ? "bg-amber-100 text-amber-700 border border-amber-300"
                    : "bg-stone-100 text-stone-600 border border-[#E8E6E1] hover:bg-stone-50"
                } disabled:opacity-50`}
              >
                Single Location + Radius
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchMode("multiple");
                  setLocation("");
                }}
                disabled={loading}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  searchMode === "multiple"
                    ? "bg-amber-100 text-amber-700 border border-amber-300"
                    : "bg-stone-100 text-stone-600 border border-[#E8E6E1] hover:bg-stone-50"
                } disabled:opacity-50`}
              >
                Multiple Locations
              </button>
            </div>
          </div>

          {/* Location Input - Single with Radius */}
          {searchMode === "single" && (
            <>
              <div className="relative">
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  Location
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" size={14} />
                  <input
                    type="text"
                    placeholder="Search location..."
                    value={location}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      setShowLocationSuggestions(true);
                    }}
                    onFocus={(e) => {
                      if (e.target.value) setShowLocationSuggestions(true);
                    }}
                    required
                    disabled={loading}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E8E6E1] bg-[#FAFAF8] text-sm text-stone-800 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 disabled:opacity-50"
                  />
                </div>

                {/* Location Suggestions */}
                {showLocationSuggestions && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E8E6E1] rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {locationSuggestions.length > 0 ? (
                      locationSuggestions.map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => selectLocation(loc)}
                          className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 transition-colors border-b border-[#F5F4F1] last:border-b-0 flex items-center gap-2"
                        >
                          <MapPin size={12} className="text-stone-400" />
                          {loc}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-stone-400">No matching locations</div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-2">
                  Search Radius: <span className="text-amber-600 font-semibold">{radius} miles</span>
                </label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value, 10))}
                  disabled={loading}
                  className="w-full h-2 bg-[#E8E6E1] rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-[11px] text-stone-400 mt-1">
                  <span>5 miles</span>
                  <span>100 miles</span>
                </div>
              </div>
            </>
          )}

          {/* Location Input - Multiple */}
          {searchMode === "multiple" && (
            <div className="relative">
              <label className="block text-xs font-medium text-stone-600 mb-1.5">
                Locations
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 text-stone-400 pointer-events-none" size={14} />
                <textarea
                  placeholder="Enter locations (comma or line separated)&#10;e.g. Portland OR, Seattle WA&#10;or&#10;Portland OR&#10;Seattle WA"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setShowLocationSuggestions(true);
                  }}
                  onFocus={() => setShowLocationSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 200)}
                  required
                  disabled={loading}
                  rows={3}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E8E6E1] bg-[#FAFAF8] text-sm text-stone-800 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 disabled:opacity-50 resize-none"
                />
              </div>

              {/* Location Suggestions for Multiple */}
              {showLocationSuggestions && locationSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E8E6E1] rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {locationSuggestions.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => selectLocation(loc)}
                      className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 transition-colors border-b border-[#F5F4F1] last:border-b-0 flex items-center gap-2"
                    >
                      <MapPin size={12} className="text-stone-400" />
                      {loc}
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-1 text-[11px] text-stone-400">You can add multiple locations separated by commas or line breaks</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1.5">
              Max Results
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxResults}
              onChange={(e) => setMaxResults(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg border border-[#E8E6E1] bg-[#FAFAF8] text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-stone-400">Maximum 50 results per search</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg border border-[#E8E6E1] text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !niche.trim() || !location.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Searching…
                </>
              ) : (
                "Find Leads"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
