const GAMMA_API_BASE_URL = "https://gamma-api.polymarket.com";
const MIN_IMPORT_CLOSE_BUFFER_MS = 24 * 60 * 60 * 1000;
const MARKET_DISCOVERY_ORDER = "volume24hr,liquidityNum";

export const MARKET_IMPORT_TAGS = [
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
] as const;

export type MarketImportTag = (typeof MARKET_IMPORT_TAGS)[number];

export type MarketImportCandidate = {
  id: string;
  externalId: string;
  tagSlug: string;
  tagLabel: string;
  question: string;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string[];
  description: string;
  imageUrl?: string;
  sourceUrl?: string;
  sourceProvider?: string;
  liquidity?: string;
  volume?: string;
  volume24hr?: string;
};

type GammaRecord = Record<string, unknown>;

export async function listMarketImportCandidates({
  tagSlug,
  query = "",
  limit = 24,
}: {
  tagSlug?: string;
  query?: string;
  limit?: number;
} = {}) {
  const tag = tagSlug ? tagBySlug(tagSlug) : undefined;
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.round(limit))) : 24;
  const searchText = query.trim();
  const payload = searchText
    ? await fetchGamma(
        `/public-search?q=${encodeURIComponent(searchText)}&limit_per_type=${boundedLimit}&search_profiles=false&sort=volume&ascending=false`,
      )
    : await fetchGamma(
        tag
          ? `/markets/keyset?tag_id=${tag.id}&active=true&closed=false&limit=${boundedLimit}&include_tag=true&order=${MARKET_DISCOVERY_ORDER}&ascending=false`
          : `/markets/keyset?active=true&closed=false&limit=${boundedLimit}&include_tag=true&order=${MARKET_DISCOVERY_ORDER}&ascending=false`,
      );

  return collectMarketImportCandidates(payload, tag, boundedLimit, searchText, Boolean(searchText));
}

export function collectMarketImportCandidates(
  payload: unknown,
  tag?: MarketImportTag,
  limit = 24,
  query = "",
  trustSearchRanking = false,
) {
  const seen = new Set<string>();
  const candidates: MarketImportCandidate[] = [];
  const searchText = query.trim().toLowerCase();

  for (const market of extractMarketRecords(payload)) {
    if (tag && !recordMatchesTag(market, tag)) {
      continue;
    }
    if (searchText && !trustSearchRanking && !recordMatchesQuery(market, searchText)) {
      continue;
    }

    const candidate = normalizeMarketImportCandidate(market, tag ?? tagForRecord(market) ?? MARKET_IMPORT_TAGS[0]);
    if (!candidate || seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    candidates.push(candidate);
  }

  return candidates.sort(compareMarketImportCandidates).slice(0, limit);
}

export function normalizeMarketImportCandidate(
  market: GammaRecord,
  tag: MarketImportTag,
  now = new Date(),
): MarketImportCandidate | null {
  if (market.active !== true || market.closed === true) {
    return null;
  }

  const closeTime = parseDateString(stringValue(market, "endDate") ?? stringValue(market, "endDateIso"));
  if (!closeTime || Date.parse(closeTime) <= now.getTime() + MIN_IMPORT_CLOSE_BUFFER_MS) {
    return null;
  }

  const outcomes = parseOutcomes(market.outcomes);
  if (outcomes.length !== 2 || outcomes[0] !== "yes" || outcomes[1] !== "no") {
    return null;
  }

  const question = cleanText(stringValue(market, "question"));
  const description = cleanText(stringValue(market, "description") ?? stringValue(market, "rules"));
  if (!question || question.length < 8 || !description || description.length < 20) {
    return null;
  }

  const externalId = cleanText(stringValue(market, "id") ?? stringValue(market, "conditionId") ?? question);
  const resolutionSource = resolutionSourceFor(market, description);
  const slug = cleanText(stringValue(market, "slug"));

  return {
    id: `${tag.slug}-${slugify(externalId || question)}`,
    externalId: externalId || question,
    tagSlug: tag.slug,
    tagLabel: tag.label,
    question,
    closeTime,
    resolutionSource,
    invalidConditions: invalidConditionsFor(description),
    description,
    imageUrl: cleanText(stringValue(market, "image") ?? stringValue(market, "icon")) || undefined,
    sourceUrl: slug ? `https://polymarket.com/market/${slug}` : undefined,
    sourceProvider: "polymarket",
    liquidity: cleanText(stringValue(market, "liquidityNum") ?? stringValue(market, "liquidity")) || undefined,
    volume: cleanText(stringValue(market, "volumeNum") ?? stringValue(market, "volume")) || undefined,
    volume24hr: cleanText(stringValue(market, "volume24hr")) || undefined,
  };
}

function tagBySlug(slug: string) {
  return MARKET_IMPORT_TAGS.find((tag) => tag.slug === slug);
}

function tagForRecord(record: GammaRecord) {
  const tagValues = [...recordsFrom(record.tags), ...recordsFrom(record.__eventTags)];
  return tagValues
    .map((candidate) => {
      const id = stringValue(candidate, "id");
      const slug = stringValue(candidate, "slug");
      const label = stringValue(candidate, "label");

      return MARKET_IMPORT_TAGS.find(
        (tag) => id === String(tag.id) || slug === tag.slug || label?.toLowerCase() === tag.label.toLowerCase(),
      );
    })
    .find(Boolean);
}

async function fetchGamma(path: string) {
  const response = await fetch(`${GAMMA_API_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Market idea fetch failed with ${response.status}`);
  }

  return response.json();
}

function extractMarketRecords(payload: unknown): GammaRecord[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  return [
    ...recordsFrom(root.markets),
    ...recordsFrom(root.events).flatMap((event) =>
      recordsFrom(event.markets).map((market) => ({ ...market, __eventTags: event.tags, __eventTitle: event.title })),
    ),
  ];
}

function recordsFrom(value: unknown): GammaRecord[] {
  return Array.isArray(value)
    ? value.reduce<GammaRecord[]>((records, entry) => {
        const record = asRecord(entry);
        return record ? [...records, record] : records;
      }, [])
    : [];
}

function parseOutcomes(value: unknown) {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  return Array.isArray(parsed)
    ? parsed.flatMap((entry) => (typeof entry === "string" ? [entry.trim().toLowerCase()] : []))
    : [];
}

function recordMatchesTag(record: GammaRecord, tag: MarketImportTag) {
  const tagValues = [...recordsFrom(record.tags), ...recordsFrom(record.__eventTags)];
  return tagValues.some((candidate) => {
    const id = stringValue(candidate, "id");
    const slug = stringValue(candidate, "slug");
    const label = stringValue(candidate, "label");

    return id === String(tag.id) || slug === tag.slug || label?.toLowerCase() === tag.label.toLowerCase();
  });
}

function recordMatchesQuery(record: GammaRecord, searchText: string) {
  return [
    stringValue(record, "question"),
    stringValue(record, "description"),
    stringValue(record, "slug"),
    stringValue(record, "groupItemTitle"),
    stringValue(record, "__eventTitle"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(searchText);
}

function compareMarketImportCandidates(a: MarketImportCandidate, b: MarketImportCandidate) {
  return numericMarketScore(b) - numericMarketScore(a);
}

function numericMarketScore(candidate: MarketImportCandidate) {
  return Number(candidate.volume24hr ?? candidate.volume ?? 0) * 1_000 + Number(candidate.liquidity ?? 0);
}

function resolutionSourceFor(market: GammaRecord, description: string) {
  const explicitSource = cleanText(stringValue(market, "resolutionSource"));
  if (explicitSource) {
    return explicitSource;
  }

  const sourceSentence = description
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => /resolution source|source for this market|primary source/i.test(sentence));

  return (
    cleanText(sourceSentence) ||
    "Agents check the public sources named in the market details and other credible reporting if needed."
  );
}

function invalidConditionsFor(description: string) {
  const cancellationSentence = description
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => /cancel|postpone|abandon|materially change|will not qualify|not be considered/i.test(sentence));

  return [
    "The result cannot be objectively checked from the market details.",
    cleanText(cancellationSentence) ||
      "The underlying event is cancelled, materially changed, or has no clear final result.",
  ];
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseDateString(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringValue(record: GammaRecord, key: string) {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function asRecord(value: unknown): GammaRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as GammaRecord) : undefined;
}
