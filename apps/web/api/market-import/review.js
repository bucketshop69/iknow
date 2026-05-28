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
        score: 0.75,
        blockers: [],
        warnings: ["Fallback review is active while the hosted API is unavailable."],
        rewrittenResolutionSource: resolutionSource,
        rewrittenInvalidConditions: invalidConditions,
        requiredCapabilities: ["public evidence review"],
        missingCapabilities: [],
        reviewerReports: [],
        evidencePlan: ["Check the stated resolution source after market close."],
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
