import type { DeployedMarket, LocalDeployment } from "@iknow/shared";
import { finalizeResolution, proposeResolution, readMarketSnapshot } from "./chain.js";
import { localEvidenceURI, postEvidencePacket } from "./api.js";
import { buildEvidencePacket, explainAmbiguity } from "./evidenceSource.js";
import { buildLlmEvidencePacket } from "./llmEvidenceSource.js";
import { canFinalizeResolution, canPrepareEvidence, canProposeResolution, defaultPolicy, outcomeToContractValue } from "./policy.js";
import type { PolicyOptions } from "./policy.js";
import type { EvidenceDecision, PrepareResult } from "./types.js";

export type ResolverBrainMode = "auto" | "mock" | "llm";

export type RunnerOptions = Partial<PolicyOptions> & {
  agentId?: string;
  apiBaseUrl?: string;
  postEvidence?: boolean;
  marketId?: string;
  brainMode?: ResolverBrainMode;
};

export async function prepareMarkets(deployment: LocalDeployment, options: RunnerOptions = {}): Promise<PrepareResult[]> {
  const results: PrepareResult[] = [];
  for (const market of selectMarkets(deployment, options.marketId)) {
    const snapshot = await readMarketSnapshot(deployment, market);
    const decision = await prepareMarket(deployment, market, snapshot, options);
    results.push({ ...decision, stateName: snapshot.stateName, blockTimestamp: snapshot.blockTimestamp.toString() });
  }
  return results;
}

export async function proposeMarkets(deployment: LocalDeployment, options: RunnerOptions = {}): Promise<string[]> {
  const hashes: string[] = [];
  for (const market of selectMarkets(deployment, options.marketId)) {
    const snapshot = await readMarketSnapshot(deployment, market);
    const prepared = await prepareMarket(deployment, market, snapshot, options);
    if (prepared.kind === "refusal") continue;

    const policy = canProposeResolution(prepared.packet, snapshot, {
      allowPropose: options.allowPropose ?? defaultPolicy.allowPropose,
      minConfidence: options.minConfidence ?? defaultPolicy.minConfidence,
    });
    if (!policy.allowed) continue;

    const hash = await proposeResolution(deployment, market, outcomeToContractValue(prepared.packet.suggestedOutcome), prepared.evidenceURI);
    hashes.push(`${market.id}:${hash}`);
  }
  return hashes;
}

export async function finalizeMarkets(deployment: LocalDeployment, options: RunnerOptions = {}): Promise<string[]> {
  const hashes: string[] = [];
  for (const market of selectMarkets(deployment, options.marketId)) {
    const snapshot = await readMarketSnapshot(deployment, market);
    const policy = canFinalizeResolution(snapshot, {
      allowFinalize: options.allowFinalize ?? defaultPolicy.allowFinalize,
    });
    if (!policy.allowed) continue;

    const hash = await finalizeResolution(deployment, market);
    hashes.push(`${market.id}:${hash}`);
  }
  return hashes;
}

async function prepareMarket(
  _deployment: LocalDeployment,
  market: DeployedMarket,
  snapshot: Awaited<ReturnType<typeof readMarketSnapshot>>,
  options: RunnerOptions,
): Promise<EvidenceDecision> {
  if (snapshot.stateName === "Resolved") {
    return refusal(market, "market already resolved", 1);
  }

  if (snapshot.stateName === "Open" && snapshot.blockTimestamp < snapshot.closeTime) {
    return refusal(market, "market is not closable yet", 1);
  }

  if (snapshot.stateName === "Proposed") {
    return refusal(market, "market already has a proposed resolution", 1);
  }

  const agentId = options.agentId ?? agentIdFor(options.brainMode);
  const packet = await buildPacket(market, snapshot, agentId, options.brainMode ?? "auto");
  if (!packet) {
    const ambiguous = explainAmbiguity(market, snapshot);
    return refusal(
      market,
      ambiguous.status === "ambiguous" ? ambiguous.reason : "evidence source did not return a packet",
      ambiguous.confidence,
    );
  }

  const policy = canPrepareEvidence(packet, options.minConfidence ?? defaultPolicy.minConfidence);
  if (!policy.allowed) {
    return refusal(market, policy.reasons.join("; "), packet.confidence);
  }

  let evidenceURI = localEvidenceURI(packet);
  let postStatus: "posted" | "failed" | "skipped" = "skipped";
  let postStatusCode: number | undefined;
  let postMessage: string | undefined;
  if (options.postEvidence ?? true) {
    try {
      const posted = await postEvidencePacket(packet, options.apiBaseUrl ?? "http://localhost:8787");
      evidenceURI = posted.evidenceURI;
      postStatus = posted.ok ? "posted" : "failed";
      postStatusCode = posted.status;
      if (!posted.ok) postMessage = posted.message;
    } catch (error) {
      evidenceURI = localEvidenceURI(packet);
      postStatus = "failed";
      postMessage = error instanceof Error ? error.message : "Unable to post evidence packet";
    }
  }

  return { kind: "packet", packet, evidenceURI, postStatus, postStatusCode, postMessage };
}

function selectMarkets(deployment: LocalDeployment, marketId: string | undefined): DeployedMarket[] {
  if (!marketId) return deployment.markets;
  return deployment.markets.filter((market) => market.id === marketId || market.address.toLowerCase() === marketId.toLowerCase());
}

async function buildPacket(
  market: DeployedMarket,
  snapshot: Awaited<ReturnType<typeof readMarketSnapshot>>,
  agentId: string,
  brainMode: ResolverBrainMode,
) {
  if (brainMode === "llm" || (brainMode === "auto" && process.env.MINIMAX_API_KEY)) {
    return buildLlmEvidencePacket(market, snapshot, agentId);
  }

  return buildEvidencePacket(market, snapshot, agentId);
}

function agentIdFor(brainMode: ResolverBrainMode | undefined) {
  if (brainMode === "llm" || ((brainMode === undefined || brainMode === "auto") && process.env.MINIMAX_API_KEY)) {
    return "iknow-resolver-minimax";
  }

  return "iknow-resolver-local";
}

function refusal(market: DeployedMarket, reason: string, confidence: number): EvidenceDecision {
  return {
    kind: "refusal",
    marketId: market.id,
    marketAddress: market.address as `0x${string}`,
    reason,
    confidence,
  };
}
