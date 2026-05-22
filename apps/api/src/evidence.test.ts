import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./index.js";
import { resetEvidencePacketStoreForTests } from "./evidence.js";

const validPacket = {
  marketId: "local-market-1",
  marketAddress: "0x0000000000000000000000000000000000000001",
  outcome: "YES",
  suggestedOutcome: "YES",
  confidence: 0.92,
  evidence: [
    {
      source: "Official league table",
      url: "https://example.com/table",
      summary: "The final table shows the team finished first.",
    },
  ],
  evidenceLinks: [
    {
      url: "https://example.com/table",
      title: "Official league table",
      accessedAt: "2026-05-16T00:00:00.000Z",
    },
  ],
  extractedFacts: [
    {
      claim: "The final table shows the team finished first.",
      sourceUrl: "https://example.com/table",
      supportsOutcome: "YES",
    },
  ],
  invalidChecks: [],
  generatedAt: "2026-05-16T00:00:00.000Z",
  agentId: "local-agent",
  rationale: "The listed source satisfies the market resolution rule.",
};

test("creates and reads deterministic local evidence packets", async () => {
  resetEvidencePacketStoreForTests();

  const createResponse = await app.request("/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPacket),
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  assert.match(created.packetHash, /^0x[a-f0-9]{64}$/);
  assert.equal(created.evidenceURI, `local://evidence/${created.packetHash}`);
  assert.equal(created.packet.marketId, validPacket.marketId);
  assert.equal(created.packet.suggestedOutcome, "YES");

  const createAgainResponse = await app.request("/local/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPacket),
  });
  const createdAgain = await createAgainResponse.json();

  assert.equal(createdAgain.packetHash, created.packetHash);
  assert.equal(createdAgain.evidenceURI, created.evidenceURI);

  const readResponse = await app.request(`/evidence/${created.packetHash}`);

  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), created);

  const readByUriResponse = await app.request(`/local/evidence?uri=${encodeURIComponent(created.evidenceURI)}`);

  assert.equal(readByUriResponse.status, 200);
  assert.deepEqual(await readByUriResponse.json(), created);
});

test("prepares and stores local evidence packets for market detail", async () => {
  resetEvidencePacketStoreForTests();

  const prepareResponse = await app.request("/evidence/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actorId: "resolver",
      marketId: "ship-mvp",
      marketAddress: "0x0000000000000000000000000000000000000001",
      question: "Will iknow ship a local trading MVP this month?",
      resolutionSource: "Local demo source",
      invalidConditions: [],
    }),
  });

  assert.equal(prepareResponse.status, 201);
  const prepared = await prepareResponse.json();

  assert.equal(prepared.packet.marketId, "ship-mvp");
  assert.equal(prepared.packet.suggestedOutcome, "YES");
  assert.equal(prepared.packet.policyStatus, "AUTO_PROPOSE");
  assert.match(prepared.evidenceURI, /^local:\/\/evidence\/0x[a-f0-9]{64}$/);

  const readResponse = await app.request(`/evidence/${prepared.packetHash}`);

  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), prepared);
});

test("prepares Binance candle evidence for price markets", async () => {
  resetEvidencePacketStoreForTests();
  const originalFetch = globalThis.fetch;
  const start = "2026-05-22T03:00:00.000Z";
  const close = "2026-05-22T04:00:00.000Z";

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.binance.com");
    assert.equal(url.searchParams.get("symbol"), "SOLUSDT");
    assert.equal(url.searchParams.get("interval"), "1m");

    return new Response(
      JSON.stringify([
        [Date.parse(start), "87.00", "87.50", "86.90", "87.10", "100", Date.parse(start) + 60_000, "0", 1, "0", "0", "0"],
        [Date.parse(close) - 60_000, "87.70", "88.01", "87.60", "87.90", "100", Date.parse(close), "0", 1, "0", "0", "0"],
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const prepareResponse = await app.request("/evidence/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "resolver",
        marketId: "solana-88-demo",
        marketAddress: "0x0000000000000000000000000000000000000001",
        question: "Will Solana trade at or above $88 in the next hour?",
        closeTime: close,
        resolutionSource: `Binance SOL/USDT 1-minute candles. Market window: ${start} to ${close}.`,
        invalidConditions: ["Resolve Invalid only if Binance SOL/USDT 1-minute candle data is unavailable."],
      }),
    });

    assert.equal(prepareResponse.status, 201);
    const prepared = await prepareResponse.json();

    assert.equal(prepared.packet.suggestedOutcome, "YES");
    assert.equal(prepared.packet.agentId, "iknow-api-binance-candle-resolver");
    assert.equal(prepared.packet.evidenceLinks[0].publisher, "Binance");
    assert.match(prepared.packet.extractedFacts[0].claim, /maximum 1-minute candle high was 88.01/);
    assert.equal(prepared.packet.invalidChecks[0].status, "PASSED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects evidence packets missing required evidence", async () => {
  resetEvidencePacketStoreForTests();

  const response = await app.request("/local/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketId: "local-market-1",
      outcome: "NO",
      rationale: "No evidence supplied.",
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();

  assert.equal(body.error, "INVALID_EVIDENCE_PACKET");
});
