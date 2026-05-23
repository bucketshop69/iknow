import {
  importResolutionReviewSchema,
  marketImportReviewResponseSchema,
  type ImportResolutionReview,
  type ImportResolutionReviewer,
  type MarketImportReviewResponse,
} from "@iknow/shared";
import { z } from "zod";
import { callMinimax, extractText } from "./minimax.js";

const REVIEW_POLICY_VERSION = "market-import-review-llm-v1";
const FALLBACK_POLICY_VERSION = "market-import-review-fallback-v1";
const MIN_READY_SCORE = 8;
const MIN_NEEDS_REVIEW_SCORE = 5;
const reviewerRoles = ["rule-parser", "evidence-source", "tooling", "adversarial", "policy"] as const;

const marketImportCandidateReviewSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().min(1),
  tagSlug: z.string().min(1),
  tagLabel: z.string().min(1),
  question: z.string().min(8),
  closeTime: z.string().datetime(),
  resolutionSource: z.string().min(1),
  invalidConditions: z.array(z.string().min(1)),
  description: z.string().min(1),
  imageUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  sourceProvider: z.string().min(1).optional(),
  liquidity: z.string().optional(),
  volume: z.string().optional(),
  volume24hr: z.string().optional(),
});

const marketImportReviewRequestSchema = z.object({
  candidate: marketImportCandidateReviewSchema,
  editedDraft: z
    .object({
      question: z.string().min(8).optional(),
      closeTime: z.string().datetime().optional(),
      resolutionSource: z.string().min(1).optional(),
      invalidConditions: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

const llmReviewerResultSchema = z.object({
  role: z.enum(reviewerRoles),
  vote: z.enum(["ready", "needs-review", "rejected"]),
  score: z.number().min(1).max(10),
  reasons: z.array(z.string().min(1)).default([]),
  yesPath: z.string().min(1),
  noPath: z.string().min(1),
  invalidPath: z.string().min(1),
  evidencePlan: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  suggestedResolutionSource: z.string().min(1),
  suggestedInvalidConditions: z.array(z.string().min(1)).default([]),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  missingCapabilities: z.array(z.string().min(1)).default([]),
});

export type ReviewContext = {
  candidate: z.infer<typeof marketImportCandidateReviewSchema>;
  question: string;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string[];
  description: string;
  sourceUrl?: string;
};

export type LlmReviewerResult = z.infer<typeof llmReviewerResultSchema>;
export type ReviewLlm = (role: (typeof reviewerRoles)[number], context: ReviewContext) => Promise<LlmReviewerResult>;

export async function reviewMarketImportCandidate(
  body: unknown,
  now = new Date(),
  reviewLlm: ReviewLlm = defaultReviewLlm,
): Promise<MarketImportReviewResponse> {
  const input = marketImportReviewRequestSchema.parse(body);
  const context = reviewContextFor(input);
  const guardrail = deterministicGuardrailReview(context, now);
  const review = guardrail ?? (await agentVoteReview(context, reviewLlm));

  return marketImportReviewResponseSchema.parse({
    review,
    draftPatch: {
      resolutionSource: review.rewrittenResolutionSource,
      invalidConditions: review.rewrittenInvalidConditions,
    },
  });
}

export function logMarketImportReview(review: ImportResolutionReview) {
  console.info(
    `[market-import-review] status=${review.status} mode=${review.resolverMode} template=${review.resolverTemplate} score=${review.score.toFixed(1)} policy=${review.reviewPolicyVersion}`,
  );

  for (const report of review.reviewerReports) {
    console.info(
      `[market-import-review:${report.role}] verdict=${report.verdict} score=${report.score.toFixed(1)} reasons=${report.reasons.join(" | ")}`,
    );
  }

  if (review.blockers.length > 0) console.info(`[market-import-review:blockers] ${review.blockers.join(" | ")}`);
  if (review.warnings.length > 0) console.info(`[market-import-review:warnings] ${review.warnings.join(" | ")}`);
  if (review.missingCapabilities.length > 0) {
    console.info(`[market-import-review:missing-capabilities] ${review.missingCapabilities.join(" | ")}`);
  }
}

function reviewContextFor(input: z.infer<typeof marketImportReviewRequestSchema>): ReviewContext {
  const context: ReviewContext = {
    candidate: input.candidate,
    question: clean(input.editedDraft?.question ?? input.candidate.question),
    closeTime: new Date(input.editedDraft?.closeTime ?? input.candidate.closeTime).toISOString(),
    resolutionSource: clean(input.editedDraft?.resolutionSource ?? input.candidate.resolutionSource),
    invalidConditions: input.editedDraft?.invalidConditions ?? input.candidate.invalidConditions,
    description: clean(input.candidate.description),
  };
  if (input.candidate.sourceUrl) context.sourceUrl = input.candidate.sourceUrl;

  return context;
}

async function agentVoteReview(context: ReviewContext, reviewLlm: ReviewLlm): Promise<ImportResolutionReview> {
  const settled = await Promise.allSettled(reviewerRoles.map((role) => reviewLlm(role, context)));
  const results = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : fallbackReviewerVote(reviewerRoles[index], context, result.reason),
  );
  const policyVersion = settled.some((result) => result.status === "fulfilled")
    ? REVIEW_POLICY_VERSION
    : FALLBACK_POLICY_VERSION;

  return aggregateReviewerVotes(context, results, policyVersion);
}

function deterministicGuardrailReview(context: ReviewContext, now: Date): ImportResolutionReview | null {
  const blockers: string[] = [];
  const closeTimeMs = Date.parse(context.closeTime);

  if (!Number.isFinite(closeTimeMs) || closeTimeMs <= now.getTime()) blockers.push("Close time is not in the future.");
  if (!context.question.trim()) blockers.push("Question is missing.");
  if (!context.description.trim() && !context.resolutionSource.trim()) {
    blockers.push("Source metadata does not include enough rules to review.");
  }
  if (blockers.length === 0) return null;

  return importResolutionReviewSchema.parse({
    status: "rejected",
    resolverMode: "needs-human-review",
    resolverTemplate: "general-agent",
    score: 1,
    blockers,
    warnings: [],
    rewrittenResolutionSource: "This market cannot be reviewed for autonomous resolution until the deterministic blockers are fixed.",
    rewrittenInvalidConditions: ["The market metadata fails basic creation-time review guardrails."],
    evidencePlan: ["Fix the basic market metadata, then run agent review again."],
    requiredCapabilities: ["Valid future close time", "Question", "Source metadata"],
    missingCapabilities: [],
    reviewerReports: reviewerRoles.map((role) =>
      reviewerReport(role, 1, "blocker", role === "policy" ? blockers : ["Guardrail failed before agent review."]),
    ),
    reviewPolicyVersion: FALLBACK_POLICY_VERSION,
  });
}

function aggregateReviewerVotes(
  context: ReviewContext,
  results: LlmReviewerResult[],
  reviewPolicyVersion: string,
): ImportResolutionReview {
  const score = roundScore(results.reduce((sum, result) => sum + result.score, 0) / results.length);
  const rejectedVotes = results.filter((result) => result.vote === "rejected");
  const needsReviewVotes = results.filter((result) => result.vote === "needs-review");
  const blockers = unique(rejectedVotes.flatMap((result) => result.reasons));
  const warnings = unique([...needsReviewVotes.flatMap((result) => result.reasons), ...results.flatMap((result) => result.risks)]);
  const missingCapabilities = unique(results.flatMap((result) => result.missingCapabilities));
  const status =
    blockers.length === 0 && score >= MIN_READY_SCORE ? "ready" : score >= MIN_NEEDS_REVIEW_SCORE ? "needs-review" : "rejected";

  return importResolutionReviewSchema.parse({
    status,
    resolverMode: status === "ready" ? "autonomous" : "needs-human-review",
    resolverTemplate: "general-agent",
    score,
    blockers,
    warnings,
    rewrittenResolutionSource: synthesizeResolutionSource(results),
    rewrittenInvalidConditions: synthesizeInvalidConditions(context, results),
    evidencePlan: unique(results.flatMap((result) => result.evidencePlan)).slice(0, 8),
    requiredCapabilities: unique(results.flatMap((result) => result.requiredCapabilities)),
    missingCapabilities,
    reviewerReports: results.map((result) =>
      reviewerReport(
        result.role,
        result.score,
        result.vote === "rejected" ? "blocker" : result.vote === "needs-review" ? "warning" : "pass",
        result.reasons.length ? result.reasons : [`${result.role} voted ${result.vote}.`],
      ),
    ),
    reviewPolicyVersion,
  });
}

async function defaultReviewLlm(role: (typeof reviewerRoles)[number], context: ReviewContext): Promise<LlmReviewerResult> {
  if (process.env.IMPORT_REVIEW_LLM_ENABLED === "false" || !process.env.MINIMAX_API_KEY) {
    throw new Error("Import review LLM is not enabled");
  }

  const response = await callMinimax(
    [
      {
        role: "user",
        content: JSON.stringify(
          {
            role,
            task: "Review whether this imported Source market can be resolved later by iknow agents.",
            market: context,
            outputContract: {
              role,
              vote: "ready | needs-review | rejected",
              score: "number 1-10",
              reasons: ["short reason"],
              yesPath: "how a future resolver decides YES",
              noPath: "how a future resolver decides NO",
              invalidPath: "what makes this invalid or needs review",
              evidencePlan: ["public/source evidence to gather after close"],
              risks: ["ambiguities or failure modes"],
              suggestedResolutionSource: "rewritten iknow resolution source",
              suggestedInvalidConditions: ["invalid condition"],
              requiredCapabilities: ["capability"],
              missingCapabilities: "array of missing capability strings, or [] if none",
            },
          },
          null,
          2,
        ),
      },
    ],
    reviewerSystemPrompt(role),
    {
      maxTokens: Number(process.env.IMPORT_REVIEW_LLM_MAX_TOKENS ?? 2048),
      temperature: Number(process.env.IMPORT_REVIEW_LLM_TEMPERATURE ?? 0.1),
    },
  );
  const parsed = extractJson(extractText(response));

  return llmReviewerResultSchema.parse(normalizeReviewerResult(parsed, role));
}

function reviewerSystemPrompt(role: string) {
  return `You are the iknow ${role} reviewer for market creation.
You are not resolving the market now. You decide whether future resolver agents can resolve it after close.
Do not require hardcoded templates. Treat random market topics as normal.
Read the Source metadata and reason from first principles.
Vote rejected only when the market cannot be objectively reviewed or lacks enough metadata.
Return only valid JSON with the requested keys. No markdown. No prose outside JSON.`;
}

function fallbackReviewerVotes(context: ReviewContext, error: unknown): LlmReviewerResult[] {
  return reviewerRoles.map((role) => fallbackReviewerVote(role, context, error));
}

function fallbackReviewerVote(
  role: (typeof reviewerRoles)[number],
  context: ReviewContext,
  error: unknown,
): LlmReviewerResult {
  const reason = `LLM review unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
  const sourceHint = context.sourceUrl ? "The linked Source market can be used as supporting metadata." : "No Source URL is available.";

  return {
    role,
    vote: "needs-review",
    score: 6,
    reasons: [reason],
    yesPath: `After close, gather public evidence for "${context.question}" and resolve YES if the market condition is met.`,
    noPath: "Resolve NO if public evidence shows the market condition was not met.",
    invalidPath: "Return needs review if public evidence is unavailable, conflicting, or the market condition cannot be objectively mapped.",
    evidencePlan: ["Read Source metadata.", "Search public official or authoritative evidence after close.", sourceHint],
    risks: ["Fallback review did not use live LLM reasoning."],
    suggestedResolutionSource: genericResolutionSource(context),
    suggestedInvalidConditions: genericInvalidConditions(context),
    requiredCapabilities: ["Source metadata review", "Public evidence search", "Evidence packet generation"],
    missingCapabilities: ["Live import-review LLM call"],
  };
}

function normalizeReviewerResult(parsed: unknown, role: (typeof reviewerRoles)[number]) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { role };
  }

  const record = parsed as Record<string, unknown>;

  return {
    ...record,
    role,
    reasons: cleanStringArray(record.reasons),
    evidencePlan: cleanStringArray(record.evidencePlan),
    risks: cleanStringArray(record.risks),
    suggestedInvalidConditions: cleanStringArray(record.suggestedInvalidConditions),
    requiredCapabilities: cleanStringArray(record.requiredCapabilities),
    missingCapabilities: cleanStringArray(record.missingCapabilities),
  };
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => (typeof item === "string" ? clean(item) : ""))
    .filter(Boolean);
}

function synthesizeResolutionSource(results: LlmReviewerResult[]) {
  const planner = results.find((result) => result.role === "rule-parser") ?? results[0];
  const evidence = unique(results.flatMap((result) => result.evidencePlan)).slice(0, 4).join(" ");

  return `${planner.suggestedResolutionSource} YES path: ${planner.yesPath} NO path: ${planner.noPath} Evidence plan: ${evidence}`;
}

function synthesizeInvalidConditions(context: ReviewContext, results: LlmReviewerResult[]) {
  return unique([
    ...context.invalidConditions,
    ...results.flatMap((result) => result.suggestedInvalidConditions),
    ...results.map((result) => result.invalidPath),
  ]).slice(0, 8);
}

function genericResolutionSource(context: ReviewContext) {
  return `After close, iknow agents review the Source metadata for "${context.question}", then gather public official, authoritative, or linked Source evidence to decide YES or NO.`;
}

function genericInvalidConditions(context: ReviewContext) {
  return unique([
    ...context.invalidConditions,
    "Public evidence is unavailable, conflicting, or insufficient to objectively decide YES or NO.",
    "The Source metadata changes materially or cannot be verified after market creation.",
  ]);
}

function reviewerReport(
  role: ImportResolutionReviewer["role"],
  rawScore: number,
  verdict: ImportResolutionReviewer["verdict"],
  reasons: string[],
): ImportResolutionReviewer {
  return {
    role,
    score: Math.max(1, Math.min(10, roundScore(rawScore))),
    verdict,
    reasons: reasons.length ? reasons : [`${role} found no issue.`],
  };
}

function extractJson(text: string) {
  const direct = safeJsonParse(text);
  if (direct) return direct;

  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? safeJsonParse(match[0]) : null;
  if (!parsed) throw new Error(`Import review LLM did not return JSON: ${text.slice(0, 240)}`);

  return parsed;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
