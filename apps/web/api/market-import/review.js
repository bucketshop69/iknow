const FALLBACK_REVIEW_POLICY_VERSION = "market-import-review-vercel-fallback-v1";
const REVIEWER_ROLES = ["rule-parser", "evidence-source", "tooling", "adversarial", "policy"];

export default async function handler(req, res) {
  const body = await readJson(req);
  const candidate = body?.candidate ?? body ?? {};
  const resolutionSource =
    typeof candidate.resolutionSource === "string"
      ? candidate.resolutionSource
      : "Creator-provided evidence with resolver verification.";
  const invalidConditions = Array.isArray(candidate.invalidConditions)
    ? candidate.invalidConditions
    : ["The question cannot be objectively resolved from the listed resolution source."];

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      draftPatch: { resolutionSource, invalidConditions },
      review: {
        status: "ready",
        resolverMode: "autonomous",
        resolverTemplate: "general-agent",
        score: 7,
        blockers: [],
        warnings: ["Fallback review is active while the hosted API is unavailable."],
        rewrittenResolutionSource: resolutionSource,
        rewrittenInvalidConditions: invalidConditions,
        requiredCapabilities: ["public evidence review"],
        missingCapabilities: [],
        reviewerReports: REVIEWER_ROLES.map((role) => ({
          role,
          score: 7,
          verdict: role === "policy" ? "warning" : "pass",
          reasons:
            role === "policy"
              ? ["Fallback review is active while the hosted API is unavailable."]
              : ["Fallback review accepted the edited market details for the public demo flow."],
        })),
        evidencePlan: ["Check the stated resolution source after market close."],
        reviewPolicyVersion: FALLBACK_REVIEW_POLICY_VERSION,
      },
    }),
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
