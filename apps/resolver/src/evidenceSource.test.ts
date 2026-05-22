import assert from "node:assert/strict";
import test from "node:test";
import type { DeployedMarket } from "@iknow/shared";
import { buildEvidencePacket } from "./evidenceSource.js";
import type { MarketSnapshot } from "./types.js";

test("builds deterministic EPL evidence", () => {
  const market = marketFixture({
    id: "epl-arsenal-chelsea",
    question: "Will Arsenal beat Chelsea?",
  });
  const packet = buildEvidencePacket(market, snapshotFixture(market), "test-agent", "2026-05-16T00:00:00.000Z");

  assert.equal(packet?.suggestedOutcome, "YES");
  assert.equal(packet?.confidence, 0.97);
  assert.equal(packet?.extractedFacts[0]?.sourceUrl, "local://epl/results/arsenal-vs-chelsea");
});

test("builds deterministic NO evidence for losing EPL wording", () => {
  const market = marketFixture({
    id: "epl-chelsea-arsenal",
    question: "Will Chelsea beat Arsenal?",
  });
  const packet = buildEvidencePacket(market, snapshotFixture(market), "test-agent", "2026-05-16T00:00:00.000Z");

  assert.equal(packet?.suggestedOutcome, "NO");
  assert.equal(packet?.confidence, 0.97);
});

test("builds deterministic draw evidence", () => {
  const market = marketFixture({
    id: "epl-liverpool-city-draw",
    question: "Will Liverpool vs Manchester City end in a draw?",
  });
  const packet = buildEvidencePacket(market, snapshotFixture(market), "test-agent", "2026-05-16T00:00:00.000Z");

  assert.equal(packet?.suggestedOutcome, "YES");
  assert.equal(packet?.extractedFacts[0]?.claim, "Liverpool 1-1 Manchester City on 2026-05-11T19:00:00.000Z.");
});

test("builds deterministic Arc smoke evidence with local invalid check", () => {
  const market = marketFixture({
    id: "arc-smoke-test",
    question: "Will this Arc testnet smoke market resolve YES?",
    invalidConditions: ["Resolve INVALID only if the test market was created with malformed metadata."],
  });
  const packet = buildEvidencePacket(market, snapshotFixture(market), "test-agent", "2026-05-16T00:00:00.000Z");

  assert.equal(packet?.suggestedOutcome, "YES");
  assert.equal(packet?.confidence, 0.99);
  assert.equal(packet?.invalidChecks[0]?.status, "PASSED");
});

test("refuses packets when invalid checks cannot be verified", () => {
  const market = marketFixture({
    id: "epl-invalid-condition",
    question: "Will Arsenal beat Chelsea?",
    invalidConditions: ["Match is postponed beyond the market resolution window."],
  });

  assert.equal(buildEvidencePacket(market, snapshotFixture(market), "test-agent"), null);
});

test("returns null for unsupported ambiguous markets", () => {
  const market = marketFixture({
    id: "arc-testnet-volume",
    question: "Will Arc testnet daily transaction volume exceed 100k next week?",
  });

  assert.equal(buildEvidencePacket(market, snapshotFixture(market), "test-agent"), null);
});

function marketFixture(overrides: Partial<DeployedMarket>): DeployedMarket {
  return {
    id: "fixture",
    address: "0x0000000000000000000000000000000000000001",
    specHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    metadataURI: "urn:fixture",
    question: "Will Arsenal beat Chelsea?",
    closeTime: 1,
    creationBond: "1",
    initialLiquidity: "1",
    yesTokenId: "1",
    noTokenId: "2",
    ...overrides,
  };
}

function snapshotFixture(market: DeployedMarket): MarketSnapshot {
  return {
    id: market.id,
    address: market.address as `0x${string}`,
    question: market.question,
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
