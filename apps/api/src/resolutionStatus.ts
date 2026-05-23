import type { DeployedMarket, EvidencePacketResponse, LocalDeployment } from "@iknow/shared";
import { createPublicClient, http, parseAbi, type Address, type Chain } from "viem";
import type { TestnetDeployment } from "./deployment.js";
import { readEvidencePacketResponse } from "./evidence.js";

const marketLifecycleAbi = parseAbi([
  "function state() view returns (uint8)",
  "function proposedOutcome() view returns (uint8)",
  "function finalOutcome() view returns (uint8)",
  "function finalizeAfter() view returns (uint256)",
  "function evidenceURI() view returns (string)",
  "function closeTime() view returns (uint256)",
]);

const stateNames = ["Open", "Closed", "Proposed", "Resolved"] as const;
const outcomeNames = ["Unresolved", "Yes", "No", "Invalid"] as const;
const outcomeValues = ["UNRESOLVED", "YES", "NO", "INVALID"] as const;

export type DeploymentScope = "local" | "testnet";
export type MarketStateName = (typeof stateNames)[number];
export type OutcomeName = (typeof outcomeNames)[number];
export type OutcomeValue = (typeof outcomeValues)[number];
export type TimelineStatus = "complete" | "active" | "waiting" | "missing" | "error";

export type MarketLifecycleSnapshot = {
  state: number;
  stateName: MarketStateName;
  proposedOutcome: number;
  proposedOutcomeName: OutcomeName;
  proposedOutcomeValue: OutcomeValue;
  finalOutcome: number;
  finalOutcomeName: OutcomeName;
  finalOutcomeValue: OutcomeValue;
  evidenceURI: string;
  closeTime: string;
  closeTimeIso: string;
  finalizeAfter: string;
  finalizeAfterIso: string | null;
  latestBlockTimestamp: string;
  latestBlockTimestampIso: string;
};

export type ChainReadSummary =
  | {
      status: "fresh";
    }
  | {
      status: "unavailable";
      error: string;
    };

export type EvidencePacketSummary =
  | {
      status: "found";
      packetHash: string;
      evidenceURI: string;
      suggestedOutcome: string;
      confidence: number;
      generatedAt: string;
      agentId: string;
      policyStatus?: string;
      policyVersion?: string;
      evidenceLinks: Array<{
        title?: string;
        publisher?: string;
        url: string;
        accessedAt: string;
      }>;
      extractedFacts: Array<{
        claim: string;
        sourceUrl: string;
        supportsOutcome?: string;
      }>;
      invalidChecks: Array<{
        condition: string;
        status: string;
        explanation: string;
      }>;
    }
  | {
      status: "not-local" | "missing" | "not-posted" | "unavailable";
      evidenceURI?: string;
      error?: string;
    };

export type ResolutionTimelineItem = {
  id: string;
  title: string;
  status: TimelineStatus;
  timestamp?: string;
  description: string;
};

export type MarketResolutionStatus = {
  scope: DeploymentScope;
  market: DeployedMarket;
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
  };
  chainRead: ChainReadSummary;
  lifecycle: MarketLifecycleSnapshot;
  timeline: ResolutionTimelineItem[];
  evidence: EvidencePacketSummary;
};

type DeploymentForStatus = LocalDeployment | TestnetDeployment;

export async function createMarketResolutionStatus({
  scope,
  deployment,
  market,
}: {
  scope: DeploymentScope;
  deployment: DeploymentForStatus;
  market: DeployedMarket;
}): Promise<MarketResolutionStatus> {
  const fallbackTimestamp = Math.floor(Date.now() / 1000);
  const fallbackSnapshot = fallbackLifecycleSnapshot(market, fallbackTimestamp);
  let lifecycle = fallbackSnapshot;
  let chainRead: ChainReadSummary = { status: "fresh" };

  try {
    lifecycle = await readMarketLifecycle(deployment, market);
  } catch (error) {
    chainRead = {
      status: "unavailable",
      error: error instanceof Error ? error.message : "Unable to read market lifecycle from chain",
    };
  }

  const evidence = evidenceSummaryFor(lifecycle.evidenceURI);

  return {
    scope,
    market,
    chain: {
      id: deployment.chain.id,
      name: deployment.chain.name,
      rpcUrl: deployment.chain.rpcUrl,
    },
    chainRead,
    lifecycle,
    timeline: buildResolutionTimeline({ market, lifecycle, evidence }),
    evidence,
  };
}

export function findDeploymentMarket(deployment: DeploymentForStatus, marketId: string): DeployedMarket | undefined {
  const normalized = marketId.toLowerCase();
  return deployment.markets.find(
    (market) => market.id === marketId || market.address.toLowerCase() === normalized || market.specHash.toLowerCase() === normalized,
  );
}

export function buildResolutionTimeline({
  market,
  lifecycle,
  evidence,
}: {
  market: DeployedMarket;
  lifecycle: MarketLifecycleSnapshot;
  evidence: EvidencePacketSummary;
}): ResolutionTimelineItem[] {
  const closeTime = Number(lifecycle.closeTime);
  const latestBlockTimestamp = Number(lifecycle.latestBlockTimestamp);
  const finalizeAfter = Number(lifecycle.finalizeAfter);
  const closeTimePassed = latestBlockTimestamp >= closeTime;
  const proposed = lifecycle.stateName === "Proposed" || lifecycle.stateName === "Resolved" || lifecycle.proposedOutcomeValue !== "UNRESOLVED";
  const finalized = lifecycle.stateName === "Resolved";
  const challengeWindowKnown = proposed && finalizeAfter > 0;
  const challengeWindowPassed = challengeWindowKnown && latestBlockTimestamp >= finalizeAfter;
  const evidencePosted = Boolean(lifecycle.evidenceURI);

  return [
    {
      id: "market-opened",
      title: "Market opened",
      status: "complete",
      timestamp: secondsToIso(Math.min(closeTime, latestBlockTimestamp)),
      description: `${market.question} is deployed at ${market.address}.`,
    },
    {
      id: "close-time",
      title: closeTimePassed ? "Close time passed" : "Waiting for close time",
      status: closeTimePassed ? "complete" : "waiting",
      timestamp: lifecycle.closeTimeIso,
      description: closeTimePassed
        ? "The market is eligible for resolver evidence."
        : `Resolver evidence can be proposed after ${lifecycle.closeTimeIso}.`,
    },
    {
      id: "evidence",
      title: evidencePosted ? "Evidence posted" : "Evidence missing",
      status: evidencePosted ? "complete" : closeTimePassed ? "missing" : "waiting",
      timestamp: evidence.status === "found" ? evidence.generatedAt : undefined,
      description: evidenceDescription(evidence, closeTimePassed),
    },
    {
      id: "outcome-proposed",
      title: proposed ? `${lifecycle.proposedOutcomeName} proposed` : "Outcome not proposed",
      status: proposed ? "complete" : closeTimePassed ? "active" : "waiting",
      description: proposed
        ? `Resolver proposed ${lifecycle.proposedOutcomeName} with evidence URI ${lifecycle.evidenceURI || "not recorded"}.`
        : "No resolver proposal is visible on-chain yet.",
    },
    {
      id: "challenge-window",
      title: challengeWindowPassed ? "Challenge window elapsed" : "Challenge window",
      status: finalized || challengeWindowPassed ? "complete" : proposed ? "active" : "waiting",
      timestamp: lifecycle.finalizeAfterIso ?? undefined,
      description: challengeWindowDescription({ proposed, finalized, challengeWindowKnown, challengeWindowPassed, lifecycle }),
    },
    {
      id: "finalized",
      title: finalized ? `${lifecycle.finalOutcomeName} finalized` : "Not finalized",
      status: finalized ? "complete" : challengeWindowPassed ? "active" : "waiting",
      description: finalized
        ? `Market resolved on-chain as ${lifecycle.finalOutcomeName}.`
        : "Final resolution has not been recorded on-chain yet.",
    },
  ];
}

async function readMarketLifecycle(
  deployment: DeploymentForStatus,
  market: DeployedMarket,
): Promise<MarketLifecycleSnapshot> {
  const client = createPublicClient({
    chain: chainFor(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
  const address = market.address as Address;
  const [block, state, proposedOutcome, finalOutcome, finalizeAfter, evidenceURI, closeTime] = await Promise.all([
    client.getBlock(),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "state" }),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "proposedOutcome" }),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "finalOutcome" }),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "finalizeAfter" }),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "evidenceURI" }),
    client.readContract({ address, abi: marketLifecycleAbi, functionName: "closeTime" }),
  ]);

  return lifecycleSnapshot({
    state: Number(state),
    proposedOutcome: Number(proposedOutcome),
    finalOutcome: Number(finalOutcome),
    evidenceURI,
    closeTime,
    finalizeAfter,
    latestBlockTimestamp: block.timestamp,
  });
}

function fallbackLifecycleSnapshot(market: DeployedMarket, latestBlockTimestamp: number) {
  return lifecycleSnapshot({
    state: latestBlockTimestamp >= market.closeTime ? 1 : 0,
    proposedOutcome: 0,
    finalOutcome: 0,
    evidenceURI: "",
    closeTime: BigInt(market.closeTime),
    finalizeAfter: 0n,
    latestBlockTimestamp: BigInt(latestBlockTimestamp),
  });
}

function lifecycleSnapshot({
  state,
  proposedOutcome,
  finalOutcome,
  evidenceURI,
  closeTime,
  finalizeAfter,
  latestBlockTimestamp,
}: {
  state: number;
  proposedOutcome: number;
  finalOutcome: number;
  evidenceURI: string;
  closeTime: bigint;
  finalizeAfter: bigint;
  latestBlockTimestamp: bigint;
}): MarketLifecycleSnapshot {
  return {
    state,
    stateName: stateNames[state] ?? "Open",
    proposedOutcome,
    proposedOutcomeName: outcomeNames[proposedOutcome] ?? "Unresolved",
    proposedOutcomeValue: outcomeValues[proposedOutcome] ?? "UNRESOLVED",
    finalOutcome,
    finalOutcomeName: outcomeNames[finalOutcome] ?? "Unresolved",
    finalOutcomeValue: outcomeValues[finalOutcome] ?? "UNRESOLVED",
    evidenceURI,
    closeTime: closeTime.toString(),
    closeTimeIso: secondsToIso(Number(closeTime)),
    finalizeAfter: finalizeAfter.toString(),
    finalizeAfterIso: finalizeAfter > 0n ? secondsToIso(Number(finalizeAfter)) : null,
    latestBlockTimestamp: latestBlockTimestamp.toString(),
    latestBlockTimestampIso: secondsToIso(Number(latestBlockTimestamp)),
  };
}

function evidenceSummaryFor(evidenceURI: string): EvidencePacketSummary {
  if (!evidenceURI) {
    return { status: "not-posted" };
  }

  if (!evidenceURI.startsWith("local://evidence/")) {
    return { status: "not-local", evidenceURI };
  }

  try {
    const response = readEvidencePacketResponse(evidenceURI);
    return response ? summarizeEvidencePacket(response) : { status: "missing", evidenceURI };
  } catch (error) {
    return {
      status: "unavailable",
      evidenceURI,
      error: error instanceof Error ? error.message : "Unable to read local evidence packet",
    };
  }
}

function summarizeEvidencePacket(response: EvidencePacketResponse): EvidencePacketSummary {
  return {
    status: "found",
    packetHash: response.packetHash,
    evidenceURI: response.evidenceURI,
    suggestedOutcome: response.packet.suggestedOutcome,
    confidence: response.packet.confidence,
    generatedAt: response.packet.generatedAt,
    agentId: response.packet.agentId,
    policyStatus: response.packet.policyStatus,
    policyVersion: response.packet.policyVersion,
    evidenceLinks: response.packet.evidenceLinks,
    extractedFacts: response.packet.extractedFacts.map((fact) => ({
      claim: fact.claim,
      sourceUrl: fact.sourceUrl,
      supportsOutcome: fact.supportsOutcome,
    })),
    invalidChecks: response.packet.invalidChecks.map((check) => ({
      condition: check.condition,
      status: check.status,
      explanation: check.explanation,
    })),
  };
}

function evidenceDescription(evidence: EvidencePacketSummary, closeTimePassed: boolean) {
  if (evidence.status === "found") {
    return `${evidence.agentId} recommends ${evidence.suggestedOutcome} with ${Math.round(
      evidence.confidence * 100,
    )}% confidence from ${evidence.evidenceLinks.length} source link(s).`;
  }
  if (evidence.status === "not-local") {
    return `On-chain evidence URI points outside local API storage: ${evidence.evidenceURI}.`;
  }
  if (evidence.status === "missing") {
    return `On-chain evidence URI was recorded, but the local API does not have packet ${evidence.evidenceURI}.`;
  }
  if (evidence.status === "unavailable") {
    return evidence.error ?? "Local evidence lookup failed.";
  }
  return closeTimePassed ? "No evidence URI is posted on-chain yet." : "Evidence is expected after the market closes.";
}

function challengeWindowDescription({
  proposed,
  finalized,
  challengeWindowKnown,
  challengeWindowPassed,
  lifecycle,
}: {
  proposed: boolean;
  finalized: boolean;
  challengeWindowKnown: boolean;
  challengeWindowPassed: boolean;
  lifecycle: MarketLifecycleSnapshot;
}) {
  if (finalized) {
    return "The market has already finalized.";
  }
  if (!proposed) {
    return "Challenge window begins once the resolver proposes an outcome.";
  }
  if (!challengeWindowKnown) {
    return "The proposal is visible, but finalizeAfter is not recorded.";
  }
  if (challengeWindowPassed) {
    return `Finalization is available after ${lifecycle.finalizeAfterIso}.`;
  }
  return `Waiting until ${lifecycle.finalizeAfterIso} before finalization.`;
}

function chainFor(deployment: DeploymentForStatus): Chain {
  return {
    id: deployment.chain.id,
    name: deployment.chain.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: {
      default: { http: [deployment.chain.rpcUrl] },
    },
  };
}

function secondsToIso(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}
