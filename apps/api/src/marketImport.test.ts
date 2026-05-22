import assert from "node:assert/strict";
import test from "node:test";
import { MARKET_IMPORT_TAGS, collectMarketImportCandidates, normalizeMarketImportCandidate } from "./marketImport.js";

const cryptoTag = MARKET_IMPORT_TAGS.find((tag) => tag.slug === "crypto") ?? MARKET_IMPORT_TAGS[0];
const soccerTag = MARKET_IMPORT_TAGS.find((tag) => tag.slug === "soccer") ?? MARKET_IMPORT_TAGS[0];
const futureNow = new Date("2026-05-19T00:00:00.000Z");

test("normalizes active future yes/no market import candidates", () => {
  const candidate = normalizeMarketImportCandidate(
    {
      id: "573655",
      question: "Will Bitcoin hit $150k by June 30, 2026?",
      endDate: "2026-07-01T04:00:00Z",
      active: true,
      closed: false,
      outcomes: '["Yes", "No"]',
      description:
        "This market resolves to Yes if the listed price is reached. The resolution source for this market is Binance one minute BTC/USDT candles.",
      liquidityNum: 1234.5,
    },
    cryptoTag,
    futureNow,
  );

  assert.ok(candidate);
  assert.equal(candidate.question, "Will Bitcoin hit $150k by June 30, 2026?");
  assert.equal(candidate.closeTime, "2026-07-01T04:00:00.000Z");
  assert.match(candidate.resolutionSource, /resolution source/i);
  assert.deepEqual(candidate.invalidConditions.slice(0, 1), [
    "The result cannot be objectively checked from the market details.",
  ]);
});

test("filters closed, past, non-binary, and under-specified markets", () => {
  const base = {
    id: "1",
    question: "Will this import?",
    endDate: "2026-07-01T04:00:00Z",
    active: true,
    closed: false,
    outcomes: '["Yes", "No"]',
    description: "This has enough market rules to import as a candidate.",
  };

  assert.equal(normalizeMarketImportCandidate({ ...base, closed: true }, cryptoTag, futureNow), null);
  assert.equal(normalizeMarketImportCandidate({ ...base, endDate: "2026-01-01T00:00:00Z" }, cryptoTag, futureNow), null);
  assert.equal(normalizeMarketImportCandidate({ ...base, endDate: "2026-05-19T12:00:00Z" }, cryptoTag, futureNow), null);
  assert.equal(normalizeMarketImportCandidate({ ...base, outcomes: '["Red", "Blue"]' }, cryptoTag, futureNow), null);
  assert.equal(normalizeMarketImportCandidate({ ...base, description: "" }, cryptoTag, futureNow), null);
});

test("collects importable child markets from search event payloads", () => {
  const candidates = collectMarketImportCandidates(
    {
      events: [
        {
          title: "Crypto event",
          tags: [{ id: "21", label: "Crypto", slug: "crypto" }],
          markets: [
            {
              id: "child-1",
              question: "Will the child market stay open?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to the public final result. The primary source is the official result page.",
            },
          ],
        },
      ],
    },
    cryptoTag,
    10,
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].externalId, "child-1");
});

test("search collection stays inside the selected tag", () => {
  const soccerCandidates = collectMarketImportCandidates(
    {
      events: [
        {
          title: "Chelsea vs Newcastle",
          tags: [{ id: "100350", label: "Soccer", slug: "soccer" }],
          markets: [
            {
              id: "soccer-1",
              question: "Will Chelsea beat Newcastle?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to the official final score. The primary source is the league scorecard.",
            },
          ],
        },
        {
          title: "Chelsea entertainment story",
          tags: [{ id: "2", label: "Politics", slug: "politics" }],
          markets: [
            {
              id: "politics-1",
              question: "Will Chelsea be mentioned in a political debate?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to official debate transcripts. The primary source is the published transcript.",
            },
          ],
        },
      ],
    },
    soccerTag,
    10,
    "chelsea",
  );

  assert.equal(soccerCandidates.length, 1);
  assert.equal(soccerCandidates[0].externalId, "soccer-1");

  const cryptoCandidates = collectMarketImportCandidates(
    {
      events: [
        {
          title: "Chelsea vs Newcastle",
          tags: [{ id: "100350", label: "Soccer", slug: "soccer" }],
          markets: [
            {
              id: "soccer-1",
              question: "Will Chelsea beat Newcastle?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to the official final score. The primary source is the league scorecard.",
            },
          ],
        },
      ],
    },
    cryptoTag,
    10,
    "chelsea",
  );

  assert.equal(cryptoCandidates.length, 0);
});

test("search collection can run without a selected tag", () => {
  const candidates = collectMarketImportCandidates(
    {
      events: [
        {
          title: "Chelsea vs Newcastle",
          tags: [{ id: "100350", label: "Soccer", slug: "soccer" }],
          markets: [
            {
              id: "soccer-1",
              question: "Will Chelsea beat Newcastle?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to the official final score. The primary source is the league scorecard.",
            },
          ],
        },
        {
          title: "Chelsea entertainment story",
          tags: [{ id: "2", label: "Politics", slug: "politics" }],
          markets: [
            {
              id: "politics-1",
              question: "Will Chelsea be mentioned in a political debate?",
              endDate: "2026-09-01T00:00:00Z",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              description:
                "This market resolves according to official debate transcripts. The primary source is the published transcript.",
            },
          ],
        },
      ],
    },
    undefined,
    10,
    "chelsea",
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].tagSlug, "soccer");
  assert.equal(candidates[1].tagSlug, "politics");
});
