import assert from "node:assert/strict";
import test from "node:test";
import { canPrepareEvidence, canProposeResolution } from "./policy.js";
import type { EvidencePacket, MarketSnapshot } from "./types.js";

test("refuses low confidence evidence", () => {
  const packet = packetFixture({ confidence: 0.5 });
  const decision = canPrepareEvidence(packet, 0.85);

  assert.equal(decision.allowed, false);
  assert.match(decision.reasons[0] ?? "", /confidence/);
});

test("requires explicit allow-propose policy", () => {
  const packet = packetFixture({ confidence: 0.95 });
  const decision = canProposeResolution(packet, snapshotFixture(), { allowPropose: false, minConfidence: 0.85 });

  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join(" "), /proposal disabled/);
});

test("allows proposal for closed confident packet when enabled", () => {
  const packet = packetFixture({ confidence: 0.95 });
  const decision = canProposeResolution(packet, snapshotFixture(), { allowPropose: true, minConfidence: 0.85 });

  assert.equal(decision.allowed, true);
});

function packetFixture(overrides: Partial<EvidencePacket>): EvidencePacket {
  return {
    marketId: "fixture",
    marketAddress: "0x0000000000000000000000000000000000000001",
    suggestedOutcome: "YES",
    confidence: 0.95,
    evidenceLinks: [{ title: "fixture", url: "local://fixture", accessedAt: "2026-05-16T00:00:00.000Z" }],
    extractedFacts: [
      {
        claim: "Arsenal beat Chelsea 2-1.",
        sourceUrl: "local://fixture",
        observedAt: "2026-05-16T00:00:00.000Z",
        supportsOutcome: "YES",
      },
    ],
    invalidChecks: [
      {
        condition: "No invalid conditions declared",
        status: "PASSED",
        explanation: "No invalid trigger found.",
        evidenceUrls: [],
      },
    ],
    generatedAt: "2026-05-16T00:00:00.000Z",
    agentId: "test-agent",
    policyVersion: "test",
    ...overrides,
  };
}

function snapshotFixture(): MarketSnapshot {
  return {
    id: "fixture",
    address: "0x0000000000000000000000000000000000000001",
    question: "Will Arsenal beat Chelsea?",
    closeTime: 1n,
    state: 1,
    stateName: "Closed",
    proposedOutcome: 0,
    proposedOutcomeName: "Unresolved",
    finalOutcome: 0,
    finalOutcomeName: "Unresolved",
    finalizeAfter: 0n,
    evidenceURI: "",
    creatorFeePool: 0n,
    blockTimestamp: 2n,
  };
}
