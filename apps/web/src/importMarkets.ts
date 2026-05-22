import { apiBaseUrl } from "./data";
import type { MarketImportCandidate, MarketImportTag } from "./types";

export const curatedMarketTags: MarketImportTag[] = [
  { slug: "politics", label: "Politics", id: 2 },
  { slug: "geopolitics", label: "Geopolitics", id: 100265 },
  { slug: "crypto", label: "Crypto", id: 21 },
  { slug: "elections", label: "Elections", id: 144 },
  { slug: "fed", label: "Fed", id: 159 },
  { slug: "ai", label: "AI", id: 439 },
  { slug: "oscars", label: "Oscars", id: 1000 },
  { slug: "sports", label: "Sports", id: 1 },
  { slug: "soccer", label: "Soccer", id: 100350 },
  { slug: "cricket", label: "Cricket", id: 517 },
  { slug: "ipl", label: "IPL", id: 101988 },
  { slug: "nba", label: "NBA", id: 745 },
  { slug: "nfl", label: "NFL", id: 450 },
  { slug: "macro", label: "Macro", id: 102973 },
];

export const marketIdeaSuggestions = [
  { label: "BTC above $110k this Friday", query: "Will BTC close above $110k this Friday?", tagSlug: "crypto" },
  { label: "Fed rate cut next meeting", query: "Will the Fed cut rates at its next meeting?", tagSlug: "fed" },
  { label: "Arsenal vs Chelsea", query: "Will Arsenal beat Chelsea in their next league match?", tagSlug: "soccer" },
  { label: "Major AI model launch", query: "Will a major AI model launch this month?", tagSlug: "ai" },
  { label: "Best Picture favorite", query: "Will the current favorite win Best Picture?", tagSlug: "oscars" },
] as const;

const fallbackCandidates: MarketImportCandidate[] = [
  {
    id: "fallback-fed",
    externalId: "fallback-fed",
    tagSlug: "fed",
    tagLabel: "Fed",
    question: "Will the next announced Fed target rate change be a cut?",
    closeTime: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check the official Federal Reserve target rate announcement.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The announcement is cancelled, materially changed, or has no clear final result.",
    ],
    description:
      "Resolves to Yes if the next announced Federal Reserve target rate change is a cut. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
  {
    id: "fallback-crypto",
    externalId: "fallback-crypto",
    tagSlug: "crypto",
    tagLabel: "Crypto",
    question: "Will BTC close above $110k this Friday?",
    closeTime: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check the named price source at the listed close time.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The named price source is unavailable or has no clear closing value.",
    ],
    description: "Resolves to Yes if BTC closes above $110k this Friday. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
  {
    id: "fallback-ai",
    externalId: "fallback-ai",
    tagSlug: "ai",
    tagLabel: "AI",
    question: "Will a major AI model launch this month?",
    closeTime: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check official company announcements and credible reporting named in the market details.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The announcement is withdrawn, materially changed, or has no clear final result.",
    ],
    description: "Resolves to Yes if a major AI model release is officially announced this month. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
  {
    id: "fallback-elections",
    externalId: "fallback-elections",
    tagSlug: "elections",
    tagLabel: "Elections",
    question: "Will the listed candidate win the next announced race?",
    closeTime: new Date(Date.now() + 75 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check official election results and credible public reporting.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The race is cancelled, postponed beyond the review window, or has no certified result.",
    ],
    description: "Resolves to Yes if the named candidate wins the race in the market details. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
  {
    id: "fallback-arsenal-chelsea",
    externalId: "fallback-arsenal-chelsea",
    tagSlug: "soccer",
    tagLabel: "Soccer",
    question: "Will Arsenal beat Chelsea in their next league match?",
    closeTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check the official league result and credible scoreboard records.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The match is cancelled, abandoned, or does not produce a clear final winner.",
    ],
    description: "Resolves to Yes if Arsenal beat Chelsea in their next scheduled league match. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
  {
    id: "fallback-oscars",
    externalId: "fallback-oscars",
    tagSlug: "oscars",
    tagLabel: "Oscars",
    question: "Will the current favorite win Best Picture?",
    closeTime: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Agents check the official Academy Awards winner announcement.",
    invalidConditions: [
      "The result cannot be objectively checked from the market details.",
      "The award category is cancelled, renamed in a material way, or has no winner.",
    ],
    description: "Resolves to Yes if the current Best Picture favorite wins the award. Otherwise, it resolves to No.",
    sourceProvider: "iknow-demo",
  },
];

export async function fetchImportCandidates(tagSlug: string | null, query: string): Promise<MarketImportCandidate[]> {
  const params = new URLSearchParams({ limit: "24" });
  if (tagSlug) {
    params.set("tag", tagSlug);
  }
  if (query.trim()) {
    params.set("q", query.trim());
  }

  try {
    const response = await fetch(`${apiBaseUrl}/market-import/candidates?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Market ideas unavailable");
    }

    const payload = (await response.json()) as { candidates?: MarketImportCandidate[] };
    if (payload.candidates?.length) {
      return payload.candidates;
    }
  } catch {
    // Keep Create usable in local dev even when the API wrapper or upstream catalog is down.
  }

  const normalizedQuery = query.trim().toLowerCase();
  return fallbackCandidates.filter((candidate) => {
    const matchesTag = !tagSlug || candidate.tagSlug === tagSlug;
    const matchesQuery =
      !normalizedQuery ||
      `${candidate.question} ${candidate.description} ${candidate.tagLabel}`.toLowerCase().includes(normalizedQuery);

    return matchesTag && matchesQuery;
  });
}
