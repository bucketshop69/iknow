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
  assert.equal(response.factoryArgs.creationBond, "100000000");
  assert.equal(response.factoryArgs.initialLiquidity, "1000000000");
  assert.equal(response.specHashInput.closeTime, response.draft.closeTime);
  assert.equal(response.specHashInput.resolutionSource, response.draft.resolutionSource);
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
