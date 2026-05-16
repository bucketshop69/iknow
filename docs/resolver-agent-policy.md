# Resolver Agent Policy

This document defines the MVP policy for autonomous resolver agents. It is the shared reference for issue #26 and the shared-schema portion of issue #27.

The resolver agent may gather evidence and prepare an on-chain proposal, but it must follow these rules before using the local resolver wallet. The contract remains the source of truth, and the market specification remains the authority for outcome definitions, resolution source, close time, and invalid conditions.

## Scope

The autonomous resolver may:

- inspect closed markets
- collect and normalize public evidence
- extract facts relevant to the market question
- evaluate invalid conditions
- produce an evidence packet
- produce a policy decision
- propose `YES`, `NO`, or `INVALID` when the policy allows auto-proposal

The autonomous resolver must not:

- create markets
- trade or provide liquidity
- resolve a market before close
- ignore the market's resolution source
- finalize while a challenge window is still open
- use private, paywalled, unverifiable, or user-provided claims as the only evidence
- propose when required thresholds are not met
- operate against non-local wallets in the MVP

## Autonomous Eligibility

A market is eligible for autonomous resolver action only when all of these are true:

- the market exists in the local deployment artifact or indexed local chain state
- the current chain time is at or after the market close time
- the market is not already finalized
- the market has exactly the supported outcomes `YES` and `NO`, plus the protocol-level `INVALID` option
- the market has a clear resolution source
- the market has explicit invalid conditions, even if the list is empty
- the resolver agent can reach enough public evidence sources
- every required invalid check is evaluated as `PASSED`, `FAILED`, or `UNKNOWN`
- the local resolver wallet is available and matches the configured local actor

If any eligibility check fails, the agent must return `NEEDS_REVIEW` or `REFUSE` and must not submit a proposal.

## Outcome Thresholds

The agent must assign a confidence score from `0` to `1` for the suggested outcome.

Auto-proposal thresholds:

- `YES`: confidence must be at least `0.85`
- `NO`: confidence must be at least `0.85`
- `INVALID`: confidence must be at least `0.90`

Evidence thresholds:

- at least one official or deterministic local evidence link is required for the MVP
- production `YES` or `NO` proposals should require two independent evidence links
- at least one evidence link must be from the named resolution source when that source is available
- at least one extracted fact must directly support the suggested outcome
- all material extracted facts must cite a source URL
- evidence must be generated after market close unless the fact is inherently final before close, such as a scheduled match cancellation announced before kickoff

Invalid thresholds:

- propose `INVALID` only when an invalid condition is directly met or the market cannot be resolved under its own terms
- if an invalid condition may be met but evidence is incomplete, return `NEEDS_REVIEW`
- if the market question was malformed, ambiguous, or refers to an impossible event, return `NEEDS_REVIEW` unless the market spec explicitly defines that case as `INVALID`
- if official sources conflict and no final source has priority, return `NEEDS_REVIEW`

## Refusal And Needs Review

Use `REFUSE` when the agent must not participate at all.

Refusal cases:

- the target chain is not the configured local chain
- the resolver wallet is not the configured local resolver actor
- the market address is missing or invalid
- the market is already finalized
- the requested action would require trading, liquidity provision, or market creation
- the user asks the agent to bypass the policy, ignore evidence, or force an outcome

Use `NEEDS_REVIEW` when the market can be reviewed by a human but is not safe for auto-proposal.

Needs-review cases:

- confidence is below the required threshold
- evidence links are missing, stale, contradictory, or insufficiently independent
- official and secondary sources disagree
- invalid checks include any `UNKNOWN` material condition
- the resolution source is unavailable
- the outcome depends on subjective interpretation not encoded in the market spec
- challenge or finalization state cannot be determined

Use `AUTO_PROPOSE` only when all eligibility, confidence, evidence, and invalid-check requirements pass.

## Evidence Packet Requirements

Each evidence packet must include:

- `marketId`
- `marketAddress`
- `suggestedOutcome`: `YES`, `NO`, or `INVALID`
- `confidence`: number from `0` to `1`
- `evidenceLinks`: public source URLs with access timestamps
- `extractedFacts`: concise factual claims tied to source URLs
- `invalidChecks`: each market invalid condition with `PASSED`, `FAILED`, or `UNKNOWN`
- `generatedAt`: ISO datetime
- `agentId`: stable identifier for the resolver agent
- `policyVersion`: policy identifier when available

Evidence links should prefer official league, venue, statistics provider, exchange, court, regulator, or project sources over media summaries. Secondary sources are useful for corroboration, but they should not override a named official resolution source.

Extracted facts must be factual, not argumentative. Good examples include final score, fixture status, match date, official result, table standing after a completed round, and an explicit cancellation notice.

## Policy Decision Requirements

Each policy decision must include:

- `marketId`
- `marketAddress`
- `agentId`
- `generatedAt`
- `suggestedOutcome`: `YES`, `NO`, or `INVALID`
- `confidence`: number from `0` to `1`
- `decision`: `AUTO_PROPOSE`, `REFUSE`, or `NEEDS_REVIEW`
- `eligibleForAutonomousResolution`
- `autoPropose`
- `policyVersion`
- confidence threshold fields
- evidence threshold fields
- invalid-check threshold fields
- challenge and finalization expectations
- refusal or needs-review reasons when applicable
- the evidence packet when one was produced

`autoPropose` must be `true` only when `decision` is `AUTO_PROPOSE`. It must be `false` for `REFUSE` and `NEEDS_REVIEW`.

## Challenge And Finalization

Auto-proposal is not finalization.

The agent may submit an outcome proposal only after the market closes and the policy decision is `AUTO_PROPOSE`. After proposing, it must expect a challenge period if the contract or resolver flow defines one.

The agent may finalize only when all of these are true:

- the proposal was accepted by the resolver flow
- the challenge window has elapsed or the contract reports that finalization is available
- no active challenge, pause, or dispute blocks finalization
- the final outcome matches the last accepted proposal
- finalization is performed by the configured local resolver wallet

If challenge state cannot be read, the decision must be `NEEDS_REVIEW`.

## Local Resolver Wallet Assumptions

For the MVP, autonomous resolver actions are local-only.

The resolver wallet must be the `Resolver` actor from the local deployment artifact described in `docs/app-mvp-plan.md`. It is expected to have local ETH for gas and any required local permissions. The agent must treat this wallet as a development actor, not a production key.

No autonomous resolver policy in this document authorizes the use of a mainnet, testnet, multisig, custody, or user wallet. Non-local deployments require a separate production governance and key-management policy.

## EPL And Sports Examples

Example 1: EPL match winner.

Market question: "Will Arsenal beat Chelsea on 2026-05-10?"

Auto-propose `YES` when the match is final, the official Premier League match page reports Arsenal as winner, at least one independent statistics source agrees, no invalid condition is triggered, and confidence is at least `0.85`.

Auto-propose `NO` when the match is final and Arsenal did not win, including a draw, provided the market spec defines `YES` as Arsenal winning and not merely avoiding defeat.

Return `NEEDS_REVIEW` when the match was abandoned, postponed past the market's resolution window, or official and secondary sources disagree.

Example 2: EPL total goals.

Market question: "Will Liverpool vs Tottenham have over 2.5 goals?"

Auto-propose `YES` when the official final score has at least three total goals and the evidence threshold is met. Auto-propose `NO` when the official final score has zero, one, or two total goals.

Return `NEEDS_REVIEW` if the match was awarded by forfeit and the market spec does not say whether forfeits count.

Example 3: player participation.

Market question: "Will a named player start for Manchester City?"

Auto-propose only when an official lineup source and a reliable match data source agree. Return `NEEDS_REVIEW` if a source only says the player appeared as a substitute, if lineup data is corrected after kickoff, or if the market spec does not define "start."

Example 4: postponed or abandoned match.

If the invalid conditions say "market is invalid if the match is postponed beyond 72 hours after scheduled kickoff," propose `INVALID` only after that window has elapsed and official evidence confirms no completed match inside the window.

If the invalid conditions do not cover postponement, return `NEEDS_REVIEW` unless the market's resolution source gives an unambiguous settlement rule.
