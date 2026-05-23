import assert from "node:assert/strict";
import test from "node:test";
import { reviewMarketImportCandidate, type ReviewLlm } from "./marketImportReview.js";

const now = new Date("2026-05-23T00:00:00.000Z");

test("uses general reviewer votes instead of requiring a hardcoded sports template", async () => {
  const response = await reviewMarketImportCandidate({ candidate: uzbekistanCandidate() }, now, readySportsReviewer);

  assert.equal(response.review.status, "ready");
  assert.equal(response.review.resolverMode, "autonomous");
  assert.equal(response.review.resolverTemplate, "general-agent");
  assert.ok(response.review.score >= 8);
  assert.match(response.draftPatch.resolutionSource, /FIFA/i);
  assert.match(response.draftPatch.resolutionSource, /Uzbekistan/i);
  assert.equal(response.review.blockers.length, 0);
});

test("aggregates cautious reviewer votes into needs-review", async () => {
  const response = await reviewMarketImportCandidate({ candidate: iranPeaceCandidate() }, now, cautiousOfficialReviewer);

  assert.equal(response.review.status, "needs-review");
  assert.equal(response.review.resolverMode, "needs-human-review");
  assert.equal(response.review.resolverTemplate, "general-agent");
  assert.ok(response.review.score >= 5);
  assert.match(response.review.warnings.join(" "), /official statements/i);
  assert.match(response.draftPatch.resolutionSource, /official/i);
});

test("rejects only basic deterministic guardrail failures before agent review", async () => {
  const response = await reviewMarketImportCandidate(
    {
      candidate: {
        ...uzbekistanCandidate(),
        closeTime: "2020-01-01T00:00:00.000Z",
      },
    },
    now,
    readySportsReviewer,
  );

  assert.equal(response.review.status, "rejected");
  assert.equal(response.review.resolverTemplate, "general-agent");
  assert.match(response.review.blockers.join(" "), /Close time/);
});

test("falls back to a generic needs-review plan when LLM review is unavailable", async () => {
  const failingReviewer: ReviewLlm = async () => {
    throw new Error("provider unavailable");
  };
  const response = await reviewMarketImportCandidate({ candidate: uzbekistanCandidate() }, now, failingReviewer);

  assert.equal(response.review.status, "needs-review");
  assert.equal(response.review.resolverTemplate, "general-agent");
  assert.match(response.review.warnings.join(" "), /Fallback review/);
  assert.match(response.review.missingCapabilities.join(" "), /Live import-review LLM call/);
});

test("keeps successful reviewer votes when one reviewer fails", async () => {
  const partlyFailingReviewer: ReviewLlm = async (role, context) => {
    if (role === "adversarial") throw new Error("bad reviewer payload");

    return readySportsReviewer(role, context);
  };
  const response = await reviewMarketImportCandidate({ candidate: uzbekistanCandidate() }, now, partlyFailingReviewer);

  assert.equal(response.review.resolverTemplate, "general-agent");
  assert.equal(response.review.reviewPolicyVersion, "market-import-review-llm-v1");
  assert.equal(response.review.reviewerReports.length, 5);
  assert.match(response.review.missingCapabilities.join(" "), /Live import-review LLM call/);
  assert.ok(response.review.score > 8);
});

const readySportsReviewer: ReviewLlm = async (role, context) => ({
  role,
  vote: "ready",
  score: 9,
  reasons: [`${role} can resolve this with public tournament evidence.`],
  yesPath: "Resolve YES if official FIFA records list Uzbekistan as the 2026 FIFA World Cup champion.",
  noPath: "Resolve NO if official FIFA records list any other country as champion.",
  invalidPath: "Needs review if the tournament is cancelled, no champion is declared, or official records conflict.",
  evidencePlan: [
    "Check official FIFA competition records after the final.",
    "Confirm the tournament champion and final match result.",
    "Use credible sports reporting only as backup if official pages are temporarily unavailable.",
  ],
  risks: [],
  suggestedResolutionSource:
    "After close, agents check official FIFA 2026 World Cup records and final tournament results. YES if Uzbekistan is champion; NO if another team is champion.",
  suggestedInvalidConditions: [
    "The tournament is cancelled or no champion is declared.",
    "Official FIFA records are unavailable or conflicting.",
  ],
  requiredCapabilities: ["Public web/source retrieval", "Official sports record reading", "Evidence packet generation"],
  missingCapabilities: [],
});

const cautiousOfficialReviewer: ReviewLlm = async (role) => ({
  role,
  vote: "needs-review",
  score: 6,
  reasons: ["Official statements can resolve this, but diplomatic language may be ambiguous."],
  yesPath: "Resolve YES only if both governments officially confirm the same permanent peace agreement before the deadline.",
  noPath: "Resolve NO if no qualifying official confirmation exists before the deadline.",
  invalidPath: "Needs review if official statements conflict or only temporary/negotiation language exists.",
  evidencePlan: [
    "Check official United States government statements.",
    "Check official Iranian government statements.",
    "Compare whether both refer to the same permanent agreement.",
  ],
  risks: ["Official statements may use vague language or conflict across governments."],
  suggestedResolutionSource:
    "After close, agents check official public government statements from the United States and Iran before the deadline.",
  suggestedInvalidConditions: ["Official statements conflict or do not clearly refer to the same permanent agreement."],
  requiredCapabilities: ["Public official-source retrieval", "Cross-source agreement matching"],
  missingCapabilities: ["Official-source conflict review"],
});

function baseCandidate() {
  return {
    id: "candidate",
    externalId: "candidate",
    tagSlug: "sports",
    tagLabel: "Sports",
    question: "Will Uzbekistan win the 2026 FIFA World Cup?",
    closeTime: "2026-07-20T00:00:00.000Z",
    resolutionSource: "Source market details.",
    invalidConditions: ["The tournament is cancelled or no winner is declared."],
    description: "This market resolves to Yes if Uzbekistan wins the 2026 FIFA World Cup. Otherwise, it resolves to No.",
    sourceUrl: "https://source.example/market/uzbekistan-world-cup",
    sourceProvider: "source",
  };
}

function uzbekistanCandidate() {
  return baseCandidate();
}

function iranPeaceCandidate() {
  return {
    ...baseCandidate(),
    id: "iran-peace",
    externalId: "1919425",
    tagSlug: "geopolitics",
    tagLabel: "Geopolitics",
    question: "US x Iran permanent peace deal by May 31, 2026?",
    closeTime: "2026-05-31T00:00:00.000Z",
    description:
      "This market will resolve to Yes if Iran and the United States agree to a permanent peace deal by the specified date, 11:59 PM ET. Otherwise, this market will resolve to No. A qualifying agreement will be established if the United States and Iran each sign or formally adopt a written agreement, or both governments provide clear public confirmation.",
    resolutionSource:
      "The primary resolution source will be official information from the governments of the United States and Iran; however, a consensus of credible reporting may also be used.",
    invalidConditions: ["Temporary ceasefire extensions or progress statements do not qualify."],
  };
}
