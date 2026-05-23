import assert from "node:assert/strict";
import test from "node:test";
import type { DeployedMarket } from "@iknow/shared";
import { buildResolutionTimeline, type EvidencePacketSummary, type MarketLifecycleSnapshot } from "./resolutionStatus.js";

const market: DeployedMarket = {
  id: "arc-demo",
  address: "0x00000000000000000000000000000000000000AA",
  specHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  metadataURI: "urn:iknow:market:arc-demo",
  question: "Will iknow make resolver evidence visible by the hackathon demo?",
  closeTime: 1_800_000_000,
  resolutionSource: "Demo source",
  invalidConditions: [],
  creationBond: "5000000",
  initialLiquidity: "10000000",
  yesTokenId: "1",
  noTokenId: "2",
};

test("builds waiting resolution timeline before market close", () => {
  const timeline = buildResolutionTimeline({
    market,
    lifecycle: lifecycle({
      state: 0,
      closeTime: 1_800_000_000,
      latestBlockTimestamp: 1_799_999_900,
    }),
    evidence: { status: "not-posted" },
  });

  assert.deepEqual(
    timeline.map((item) => [item.id, item.status]),
    [
      ["market-opened", "complete"],
      ["close-time", "waiting"],
      ["evidence", "waiting"],
      ["outcome-proposed", "waiting"],
      ["challenge-window", "waiting"],
      ["finalized", "waiting"],
    ],
  );
});

test("builds impressive proposed timeline with local evidence summary", () => {
  const evidence: EvidencePacketSummary = {
    status: "found",
    packetHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    evidenceURI: "local://evidence/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    suggestedOutcome: "YES",
    confidence: 0.96,
    generatedAt: "2026-05-23T10:00:00.000Z",
    agentId: "iknow-api-binance-candle-resolver",
    policyStatus: "AUTO_PROPOSE",
    policyVersion: "resolver-binance-candle-v0",
    evidenceLinks: [
      {
        title: "Source result",
        publisher: "Official source",
        url: "https://example.com/result",
        accessedAt: "2026-05-23T10:00:00.000Z",
      },
    ],
    extractedFacts: [
      {
        claim: "The official source supports YES.",
        sourceUrl: "https://example.com/result",
        supportsOutcome: "YES",
      },
    ],
    invalidChecks: [
      {
        condition: "Source is available.",
        status: "PASSED",
        explanation: "The source responded.",
      },
    ],
  };

  const timeline = buildResolutionTimeline({
    market,
    lifecycle: lifecycle({
      state: 2,
      proposedOutcome: 1,
      evidenceURI: evidence.evidenceURI,
      closeTime: 1_800_000_000,
      finalizeAfter: 1_800_003_600,
      latestBlockTimestamp: 1_800_001_000,
    }),
    evidence,
  });

  assert.equal(timeline.find((item) => item.id === "evidence")?.status, "complete");
  assert.match(timeline.find((item) => item.id === "evidence")?.description ?? "", /96% confidence/);
  assert.equal(timeline.find((item) => item.id === "outcome-proposed")?.title, "Yes proposed");
  assert.equal(timeline.find((item) => item.id === "challenge-window")?.status, "active");
  assert.equal(timeline.find((item) => item.id === "finalized")?.status, "waiting");
});

function lifecycle({
  state,
  proposedOutcome = 0,
  finalOutcome = 0,
  evidenceURI = "",
  closeTime,
  finalizeAfter = 0,
  latestBlockTimestamp,
}: {
  state: number;
  proposedOutcome?: number;
  finalOutcome?: number;
  evidenceURI?: string;
  closeTime: number;
  finalizeAfter?: number;
  latestBlockTimestamp: number;
}): MarketLifecycleSnapshot {
  const stateNames = ["Open", "Closed", "Proposed", "Resolved"] as const;
  const outcomeNames = ["Unresolved", "Yes", "No", "Invalid"] as const;
  const outcomeValues = ["UNRESOLVED", "YES", "NO", "INVALID"] as const;

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
    closeTime: String(closeTime),
    closeTimeIso: new Date(closeTime * 1000).toISOString(),
    finalizeAfter: String(finalizeAfter),
    finalizeAfterIso: finalizeAfter > 0 ? new Date(finalizeAfter * 1000).toISOString() : null,
    latestBlockTimestamp: String(latestBlockTimestamp),
    latestBlockTimestampIso: new Date(latestBlockTimestamp * 1000).toISOString(),
  };
}
