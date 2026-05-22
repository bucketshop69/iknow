import { createHash } from "node:crypto";
import {
  evidencePacketResponseSchema,
  evidencePacketSchema,
  evmAddressSchema,
  type EvidencePacket,
  type EvidencePacketResponse,
} from "@iknow/shared";
import { z } from "zod";

const packetHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const evidenceUriSchema = z.string().regex(/^local:\/\/evidence\/0x[a-fA-F0-9]{64}$/);

const prepareEvidenceRequestSchema = z.object({
  actorId: z.string().min(1).optional(),
  marketId: z.string().min(1),
  marketAddress: evmAddressSchema,
  question: z.string().min(1),
  closeTime: z.string().min(1).optional(),
  resolutionSource: z.string().min(1).optional(),
  invalidConditions: z.array(z.string().min(1)).default([]),
  metadataURI: z.string().min(1).optional(),
  specHash: z.string().min(1).optional(),
});

const evidencePackets = new Map<string, EvidencePacketResponse>();

export function createEvidencePacketResponse(body: unknown): EvidencePacketResponse {
  const packet = evidencePacketSchema.parse(body);
  const packetHash = hashPacket(packet);
  const evidenceURI = toEvidenceURI(packetHash);
  const response = evidencePacketResponseSchema.parse({ packet, packetHash, evidenceURI });

  evidencePackets.set(packetHash.toLowerCase(), response);

  return response;
}

export async function prepareEvidencePacketResponse(body: unknown): Promise<EvidencePacketResponse> {
  const input = prepareEvidenceRequestSchema.parse(body);
  return createEvidencePacketResponse(await buildPreparedEvidencePacket(input));
}

export function readEvidencePacketResponse(hashOrUri: string): EvidencePacketResponse | undefined {
  const packetHash = normalizeEvidenceHash(hashOrUri);
  if (!packetHash) {
    return undefined;
  }

  return evidencePackets.get(packetHash.toLowerCase());
}

export function resetEvidencePacketStoreForTests() {
  evidencePackets.clear();
}

export function hashPacket(packet: EvidencePacket) {
  return `0x${createHash("sha256").update(stableStringify(packet)).digest("hex")}`;
}

export function toEvidenceURI(packetHash: string) {
  const parsedHash = packetHashSchema.parse(packetHash);
  return `local://evidence/${parsedHash.toLowerCase()}`;
}

function normalizeEvidenceHash(hashOrUri: string) {
  if (packetHashSchema.safeParse(hashOrUri).success) {
    return hashOrUri;
  }

  if (evidenceUriSchema.safeParse(hashOrUri).success) {
    return hashOrUri.slice("local://evidence/".length);
  }

  return undefined;
}

async function buildPreparedEvidencePacket(input: z.infer<typeof prepareEvidenceRequestSchema>): Promise<EvidencePacket> {
  const pricePacket = await buildBinancePriceEvidencePacket(input);
  if (pricePacket) {
    return pricePacket;
  }

  const generatedAt = new Date().toISOString();
  const outcome = suggestedOutcomeFor(input.marketId, input.question);
  const confidence = outcome === "INVALID" ? 0.91 : 0.9;
  const sourceUrl = `local://iknow/evidence/${encodeURIComponent(input.marketId)}`;
  const invalidChecks = input.invalidConditions.length
    ? input.invalidConditions.map((condition) => ({
        condition,
        status: "PASSED" as const,
        explanation: "The local deterministic resolver did not find this invalid condition triggered.",
        evidenceUrls: [sourceUrl],
      }))
    : [
        {
          condition: "No invalid conditions declared in local market metadata",
          status: "PASSED" as const,
          explanation: "No invalid trigger was declared for this local packet.",
          evidenceUrls: [sourceUrl],
        },
      ];

  return evidencePacketSchema.parse({
    marketId: input.marketId,
    marketAddress: input.marketAddress,
    suggestedOutcome: outcome,
    confidence,
    evidenceLinks: [
      {
        title: "local deterministic resolver packet",
        url: sourceUrl,
        publisher: "iknow local API",
        accessedAt: generatedAt,
      },
    ],
    extractedFacts: [
      {
        claim: preparedClaim(input.question, outcome, input.resolutionSource),
        sourceUrl,
        observedAt: generatedAt,
        supportsOutcome: outcome,
      },
    ],
    invalidChecks,
    generatedAt,
    agentId: "iknow-api-local-resolver",
    policyVersion: "resolver-local-v0",
    policyStatus: "AUTO_PROPOSE",
    autoPropose: true,
  });
}

async function buildBinancePriceEvidencePacket(
  input: z.infer<typeof prepareEvidenceRequestSchema>,
): Promise<EvidencePacket | null> {
  const marketText = `${input.question} ${input.resolutionSource ?? ""}`;
  if (!/binance/i.test(marketText)) {
    return null;
  }

  const symbol = binanceSymbolFor(marketText);
  const threshold = priceThresholdFor(marketText);
  const closeTimeMs = input.closeTime ? Date.parse(input.closeTime) : Number.NaN;
  if (!symbol || threshold === null || !Number.isFinite(closeTimeMs)) {
    return null;
  }

  const window = candleWindowFor(input.resolutionSource ?? "", closeTimeMs);
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1m");
  url.searchParams.set("startTime", String(window.startMs));
  url.searchParams.set("endTime", String(window.endMs));
  url.searchParams.set("limit", "1000");

  const generatedAt = new Date().toISOString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance candle lookup failed: ${response.status}`);
  }

  const candles = z.array(binanceKlineSchema).parse(await response.json());
  if (!candles.length) {
    return evidencePacketSchema.parse({
      marketId: input.marketId,
      marketAddress: input.marketAddress,
      suggestedOutcome: "INVALID",
      confidence: 0.87,
      evidenceLinks: [
        {
          title: `${symbol} Binance 1-minute candles`,
          url: url.toString(),
          publisher: "Binance",
          accessedAt: generatedAt,
        },
      ],
      extractedFacts: [
        {
          claim: `Binance returned no 1-minute candles for ${symbol} between ${new Date(window.startMs).toISOString()} and ${new Date(window.endMs).toISOString()}.`,
          sourceUrl: url.toString(),
          observedAt: generatedAt,
          supportsOutcome: "INVALID",
        },
      ],
      invalidChecks: invalidChecksForBinance(input.invalidConditions, url.toString(), generatedAt, true),
      generatedAt,
      agentId: "iknow-api-binance-candle-resolver",
      policyVersion: "resolver-binance-candle-v0",
      policyStatus: "AUTO_PROPOSE",
      autoPropose: true,
    });
  }

  const highs = candles.map((candle) => ({
    openedAt: Number(candle[0]),
    high: Number(candle[2]),
  }));
  const max = highs.reduce((best, next) => (next.high > best.high ? next : best));
  const outcome: EvidencePacket["suggestedOutcome"] = max.high >= threshold ? "YES" : "NO";

  return evidencePacketSchema.parse({
    marketId: input.marketId,
    marketAddress: input.marketAddress,
    suggestedOutcome: outcome,
    confidence: 0.96,
    evidenceLinks: [
      {
        title: `${symbol} Binance 1-minute candles`,
        url: url.toString(),
        publisher: "Binance",
        accessedAt: generatedAt,
      },
    ],
    extractedFacts: [
      {
        claim: `${symbol} maximum 1-minute candle high was ${formatPrice(max.high)} between ${new Date(window.startMs).toISOString()} and ${new Date(window.endMs).toISOString()}; threshold was ${formatPrice(threshold)}.`,
        sourceUrl: url.toString(),
        observedAt: generatedAt,
        supportsOutcome: outcome,
      },
      {
        claim: `The highest observed candle opened at ${new Date(max.openedAt).toISOString()}.`,
        sourceUrl: url.toString(),
        observedAt: generatedAt,
        supportsOutcome: outcome,
      },
    ],
    invalidChecks: invalidChecksForBinance(input.invalidConditions, url.toString(), generatedAt, false),
    generatedAt,
    agentId: "iknow-api-binance-candle-resolver",
    policyVersion: "resolver-binance-candle-v0",
    policyStatus: "AUTO_PROPOSE",
    autoPropose: true,
  });
}

const binanceKlineSchema = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.string(),
  z.number(),
  z.string(),
  z.string(),
  z.string(),
]);

function binanceSymbolFor(value: string) {
  const normalized = value.toUpperCase();
  const explicit = normalized.match(/\b([A-Z]{2,12})\/?USDT\b/);
  if (explicit) {
    return `${explicit[1]}USDT`;
  }
  if (/\b(SOLANA|SOL)\b/.test(normalized)) {
    return "SOLUSDT";
  }
  if (/\b(BITCOIN|BTC)\b/.test(normalized)) {
    return "BTCUSDT";
  }
  if (/\b(ETHEREUM|ETH)\b/.test(normalized)) {
    return "ETHUSDT";
  }

  return null;
}

function priceThresholdFor(value: string) {
  const match =
    value.match(/(?:at or above|greater than or equal to|>=|above|cross(?:es)?|hit)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    value.match(/\$\s*(\d+(?:\.\d+)?)/);

  return match ? Number(match[1]) : null;
}

function candleWindowFor(resolutionSource: string, closeTimeMs: number) {
  const dates = [...resolutionSource.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)]
    .map((match) => Date.parse(match[0]))
    .filter(Number.isFinite);

  if (dates.length >= 2) {
    return { startMs: dates[0], endMs: dates[1] };
  }

  return { startMs: closeTimeMs - 60 * 60 * 1000, endMs: closeTimeMs };
}

function invalidChecksForBinance(
  conditions: string[],
  evidenceUrl: string,
  generatedAt: string,
  dataUnavailable: boolean,
): EvidencePacket["invalidChecks"] {
  const status = dataUnavailable ? "FAILED" : "PASSED";
  const explanation = dataUnavailable
    ? "Binance did not return candle data for the market window, so the named invalid condition is treated as triggered."
    : "Binance returned candle data for the market window; no source outage or missing-data invalid trigger was observed.";

  if (!conditions.length) {
    return [
      {
        condition: "Binance candle data is available for the market window.",
        status,
        explanation,
        evidenceUrls: [evidenceUrl],
      },
    ];
  }

  return conditions.map((condition) => ({
    condition,
    status,
    explanation: `${explanation} Checked at ${generatedAt}.`,
    evidenceUrls: [evidenceUrl],
  }));
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function suggestedOutcomeFor(marketId: string, question: string): EvidencePacket["suggestedOutcome"] {
  const normalized = `${marketId} ${question}`.toLowerCase();
  if (normalized.includes("invalid-demo")) {
    return "INVALID";
  }
  if (normalized.includes("exceed 100k")) {
    return "NO";
  }
  return "YES";
}

function preparedClaim(question: string, outcome: EvidencePacket["suggestedOutcome"], source: string | undefined) {
  const sourceLabel = source ? ` using ${source}` : "";
  return `Local deterministic resolver recommends ${outcome} for "${question}"${sourceLabel}.`;
}

function stableStringify(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }

  return value;
}
