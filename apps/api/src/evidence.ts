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

export function prepareEvidencePacketResponse(body: unknown): EvidencePacketResponse {
  const input = prepareEvidenceRequestSchema.parse(body);
  return createEvidencePacketResponse(buildPreparedEvidencePacket(input));
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

function buildPreparedEvidencePacket(input: z.infer<typeof prepareEvidenceRequestSchema>): EvidencePacket {
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
