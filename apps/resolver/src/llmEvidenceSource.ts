import type { DeployedMarket } from "@iknow/shared";
import { RESOLVER_AGENT_SYSTEM_PROMPT } from "./agentPrompt.js";
import { extractJson } from "./jsonUtils.js";
import { callMinimax, extractText } from "./minimax.js";
import { evidencePacketSchema, type EvidencePacket, type MarketSnapshot } from "./types.js";

type LlmEvidencePayload = Pick<
  EvidencePacket,
  "suggestedOutcome" | "confidence" | "evidenceLinks" | "extractedFacts" | "invalidChecks"
>;

export async function buildLlmEvidencePacket(
  market: DeployedMarket,
  snapshot: MarketSnapshot,
  agentId: string,
  generatedAt = new Date().toISOString(),
): Promise<EvidencePacket> {
  const response = await callMinimax(
    [
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Resolve this iknow market using the required evidence packet JSON shape.",
            generatedAt,
            market: {
              id: market.id,
              address: market.address,
              question: market.question,
              closeTime: new Date(market.closeTime * 1000).toISOString(),
              resolutionSource: market.resolutionSource ?? "Local deployment metadata did not include a resolution source.",
              invalidConditions: market.invalidConditions ?? [],
              metadataURI: market.metadataURI,
              specHash: market.specHash,
            },
            chainSnapshot: {
              state: snapshot.stateName,
              proposedOutcome: snapshot.proposedOutcomeName,
              finalOutcome: snapshot.finalOutcomeName,
              finalizeAfter: snapshot.finalizeAfter.toString(),
              evidenceURI: snapshot.evidenceURI,
              creatorFeePool: snapshot.creatorFeePool.toString(),
              blockTimestamp: snapshot.blockTimestamp.toString(),
            },
          },
          bigintReplacer,
          2,
        ),
      },
    ],
    RESOLVER_AGENT_SYSTEM_PROMPT,
    {
      maxTokens: Number(process.env.RESOLVER_LLM_MAX_TOKENS ?? 4096),
      temperature: Number(process.env.RESOLVER_LLM_TEMPERATURE ?? 0.1),
    },
  );
  const text = extractText(response);
  const parsed = extractJson<LlmEvidencePayload>(text);
  if (!parsed) {
    throw new Error(`Resolver LLM did not return parseable JSON: ${text.slice(0, 300)}`);
  }

  const normalized = normalizeLlmPayload(parsed, market, snapshot, generatedAt);

  return evidencePacketSchema.parse({
    marketId: market.id,
    marketAddress: market.address,
    suggestedOutcome: normalized.suggestedOutcome,
    confidence: normalized.confidence,
    evidenceLinks: normalized.evidenceLinks,
    extractedFacts: normalized.extractedFacts,
    invalidChecks: normalized.invalidChecks,
    generatedAt,
    agentId,
    policyVersion: "resolver-llm-v0",
  });
}

function normalizeLlmPayload(
  payload: LlmEvidencePayload,
  market: DeployedMarket,
  snapshot: MarketSnapshot,
  generatedAt: string,
): LlmEvidencePayload {
  const fallbackSourceUrl = `local://resolver/llm-context/${market.id}`;
  const suggestedOutcome = payload.suggestedOutcome;
  const evidenceLinks =
    payload.evidenceLinks?.length > 0
      ? payload.evidenceLinks
      : [
          {
            title: "resolver LLM local context",
            url: fallbackSourceUrl,
            publisher: "iknow resolver",
            accessedAt: generatedAt,
          },
        ];
  const extractedFacts =
    payload.extractedFacts?.length > 0
      ? payload.extractedFacts
      : [
          {
            claim: `The LLM did not cite external evidence. It reviewed local market "${market.id}" at chain state ${snapshot.stateName}.`,
            sourceUrl: fallbackSourceUrl,
            observedAt: generatedAt,
            supportsOutcome: suggestedOutcome,
          },
        ];
  const invalidChecks =
    payload.invalidChecks?.length > 0
      ? payload.invalidChecks
      : (market.invalidConditions ?? []).map((condition) => ({
          condition,
          status: "UNKNOWN" as const,
          explanation: "The LLM did not provide a determinate invalid-condition check.",
          evidenceUrls: [fallbackSourceUrl],
        }));

  return {
    suggestedOutcome,
    confidence: payload.confidence,
    evidenceLinks,
    extractedFacts,
    invalidChecks,
  };
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
