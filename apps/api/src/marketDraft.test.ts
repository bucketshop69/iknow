import assert from "node:assert/strict";
import test from "node:test";
import { marketDraftResponseSchema } from "@iknow/shared";
import { createMarketDraftResponse } from "./marketDraft.js";

test("creates contract-ready market draft response", () => {
  const closeTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const response = createMarketDraftResponse({
    question: "Will Arsenal win the English Premier League?",
    closeTime,
    resolutionSource: "Official Premier League table after final matchday.",
    invalidConditions: ["Season cancelled before completion."],
  });

  marketDraftResponseSchema.parse(response);

  assert.deepEqual(response.draft.outcomes, ["YES", "NO"]);
  assert.equal(response.factoryArgs.closeTime, Math.floor(Date.parse(closeTime) / 1000));
  assert.match(response.factoryArgs.specHash, /^0x[a-f0-9]{64}$/);
  assert.equal(response.factoryArgs.metadataURI, `urn:iknow:market:${response.factoryArgs.specHash}`);
  assert.equal(response.factoryArgs.creationBond, "5000000");
  assert.equal(response.factoryArgs.initialLiquidity, "10000000");
  assert.equal(response.specHashInput.closeTime, response.draft.closeTime);
  assert.equal(response.specHashInput.resolutionSource, response.draft.resolutionSource);
});

test("rejects creator capital below product minimums", () => {
  const closeTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  assert.throws(
    () =>
      createMarketDraftResponse({
        question: "Will this tiny liquidity market be rejected?",
        closeTime,
        resolutionSource: "Official source.",
        creationBond: "5",
        initialLiquidity: "9.999999",
      }),
    /Money to start the market must be at least 10 USDC/,
  );

  assert.throws(
    () =>
      createMarketDraftResponse({
        question: "Will this tiny bond market be rejected?",
        closeTime,
        resolutionSource: "Official source.",
        creationBond: "4.999999",
        initialLiquidity: "10",
      }),
    /Safety deposit must be at least 5 USDC/,
  );
});

test("rejects closeTime values the factory would reject", () => {
  assert.throws(
    () =>
      createMarketDraftResponse({
        question: "Will this stale market be rejected?",
        closeTime: "2020-01-01T00:00:00.000Z",
        resolutionSource: "A historical source.",
      }),
    /closeTime must be in the future/,
  );
});
