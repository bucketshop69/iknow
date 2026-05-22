import type { DeployedMarket } from "@iknow/shared";
import { evidencePacketSchema, type EvidencePacket, type MarketSnapshot, type SuggestedOutcome } from "./types.js";

export type EvidenceSourceResult =
  | {
      status: "resolved";
      outcome: SuggestedOutcome;
      confidence: number;
      evidenceLinks: EvidencePacket["evidenceLinks"];
      extractedFacts: EvidencePacket["extractedFacts"];
      invalidChecks: EvidencePacket["invalidChecks"];
    }
  | {
      status: "ambiguous";
      confidence: number;
      reason: string;
    };

const localMarketFixtures: Record<string, { outcome: SuggestedOutcome; confidence: number; fact: string }> = {
  "ship-mvp": {
    outcome: "YES",
    confidence: 0.9,
    fact: "Local deployment, API, web, and contract scripts exist for the MVP workflow.",
  },
  "arc-smoke-test": {
    outcome: "YES",
    confidence: 0.99,
    fact: "The Arc testnet smoke market was intentionally created to exercise the YES resolution path.",
  },
};

const eplResults = [
  { home: "arsenal", away: "chelsea", homeScore: 2, awayScore: 1, playedAt: "2026-05-10T16:30:00.000Z" },
  { home: "liverpool", away: "manchester city", homeScore: 1, awayScore: 1, playedAt: "2026-05-11T19:00:00.000Z" },
  { home: "tottenham", away: "arsenal", homeScore: 0, awayScore: 2, playedAt: "2026-05-12T18:45:00.000Z" },
];

export function buildEvidencePacket(
  market: DeployedMarket,
  snapshot: MarketSnapshot,
  agentId: string,
  generatedAt = new Date().toISOString(),
): EvidencePacket | null {
  const sourceResult = resolveFromMockSources(market, snapshot, generatedAt);
  if (sourceResult.status === "ambiguous") {
    return null;
  }

  return evidencePacketSchema.parse({
    marketId: market.id,
    marketAddress: market.address,
    suggestedOutcome: sourceResult.outcome,
    confidence: sourceResult.confidence,
    evidenceLinks: sourceResult.evidenceLinks,
    extractedFacts: sourceResult.extractedFacts,
    invalidChecks: sourceResult.invalidChecks,
    generatedAt,
    agentId,
    policyVersion: "resolver-local-v0",
  });
}

export function explainAmbiguity(market: DeployedMarket, snapshot: MarketSnapshot): EvidenceSourceResult {
  return resolveFromMockSources(market, snapshot, new Date().toISOString());
}

function resolveFromMockSources(
  market: DeployedMarket,
  snapshot: MarketSnapshot,
  observedAt: string,
): EvidenceSourceResult {
  const invalidChecks = invalidChecksFor(market);
  if (invalidChecks.some((check) => check.status !== "PASSED")) {
    return {
      status: "ambiguous",
      confidence: 0,
      reason: "market invalid conditions are not fully checkable by the local mock source",
    };
  }

  const localFixture = localMarketFixtures[market.id];
  if (localFixture) {
    return {
      status: "resolved",
      outcome: localFixture.outcome,
      confidence: localFixture.confidence,
      evidenceLinks: [{ title: "local fixture evidence", url: `local://iknow/evidence/${market.id}`, accessedAt: observedAt }],
      extractedFacts: [
        {
          claim: localFixture.fact,
          sourceUrl: `local://iknow/evidence/${market.id}`,
          observedAt,
          supportsOutcome: localFixture.outcome,
        },
      ],
      invalidChecks,
    };
  }

  if (market.id === "first-creator-fee" || /creator fees/i.test(market.question)) {
    const accrued = snapshot.creatorFeePool > 0n;
    return {
      status: "resolved",
      outcome: accrued ? "YES" : "NO",
      confidence: 0.93,
      evidenceLinks: [
        { title: "creatorFeePool on-chain read", url: `local://chain/${market.address}/creatorFeePool`, accessedAt: observedAt },
      ],
      extractedFacts: [
        {
          claim: `creatorFeePool is ${snapshot.creatorFeePool.toString()} base units at block timestamp ${snapshot.blockTimestamp.toString()}.`,
          sourceUrl: `local://chain/${market.address}/creatorFeePool`,
          observedAt,
          supportsOutcome: accrued ? "YES" : "NO",
        },
      ],
      invalidChecks,
    };
  }

  const eplResult = resolveEplMarket(market.question, observedAt, invalidChecks);
  if (eplResult) {
    return eplResult;
  }

  return {
    status: "ambiguous",
    confidence: 0.2,
    reason: "mock EPL/local evidence source has no deterministic fixture for this market",
  };
}

function invalidChecksFor(market: DeployedMarket): EvidencePacket["invalidChecks"] {
  const conditions = market.invalidConditions ?? [];
  if (conditions.length === 0) {
    return [
      {
        condition: "No invalid conditions declared in local deployment",
        status: "PASSED",
        explanation: "No invalid trigger found.",
        evidenceUrls: [],
      },
    ];
  }

  return conditions.map((condition) => ({
    condition,
    status: isLocalMockCondition(condition) ? ("PASSED" as const) : ("UNKNOWN" as const),
    explanation: isLocalMockCondition(condition)
      ? "The deterministic local source did not find this invalid condition triggered."
      : "The deterministic local mock source cannot verify this invalid condition yet.",
    evidenceUrls: isLocalMockEplCondition(condition)
      ? ["local://epl/results/arsenal-vs-chelsea"]
      : isLocalSmokeCondition(condition)
        ? ["local://iknow/evidence/arc-smoke-test"]
        : [],
  }));
}

function isLocalMockCondition(condition: string) {
  return isLocalMockEplCondition(condition) || isLocalSmokeCondition(condition);
}

function isLocalMockEplCondition(condition: string) {
  const normalized = condition.toLowerCase();
  return normalized.includes("local mock epl") || normalized.includes("arsenal") || normalized.includes("chelsea");
}

function isLocalSmokeCondition(condition: string) {
  return condition.toLowerCase().includes("malformed metadata");
}

function resolveEplMarket(
  question: string,
  observedAt: string,
  invalidChecks: EvidencePacket["invalidChecks"],
): EvidenceSourceResult | null {
  const normalizedQuestion = normalize(question);
  const asksDraw = /\bdraw\b/.test(normalizedQuestion);
  const match = eplResults.find((result) => {
    return normalizedQuestion.includes(result.home) && normalizedQuestion.includes(result.away);
  });

  if (!match) return null;

  const homeWon = match.homeScore > match.awayScore;
  const awayWon = match.awayScore > match.homeScore;
  let outcome: SuggestedOutcome;

  if (asksDraw) {
    outcome = match.homeScore === match.awayScore ? "YES" : "NO";
  } else if (/\b(beat|defeat|win|wins|won)\b/.test(normalizedQuestion)) {
    const firstTeam = firstMentionedTeam(normalizedQuestion, match.home, match.away);
    outcome = firstTeam === match.home ? (homeWon ? "YES" : "NO") : awayWon ? "YES" : "NO";
  } else {
    return {
      status: "ambiguous",
      confidence: 0.45,
      reason: "EPL fixture matched, but the question wording does not map to win/draw resolution",
    };
  }

  return {
    status: "resolved",
    outcome,
    confidence: 0.97,
    evidenceLinks: [{ title: "mock EPL result", url: `local://epl/results/${match.home}-vs-${match.away}`, accessedAt: observedAt }],
    extractedFacts: [
      {
        claim: `${title(match.home)} ${match.homeScore}-${match.awayScore} ${title(match.away)} on ${match.playedAt}.`,
        sourceUrl: `local://epl/results/${match.home}-vs-${match.away}`,
        observedAt,
        supportsOutcome: outcome,
      },
    ],
    invalidChecks,
  };
}

function firstMentionedTeam(question: string, home: string, away: string): string {
  return question.indexOf(home) <= question.indexOf(away) ? home : away;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function title(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
