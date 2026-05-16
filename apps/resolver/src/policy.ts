import type { EvidencePacket, MarketSnapshot, PolicyDecision } from "./types.js";

export type PolicyOptions = {
  minConfidence: number;
  allowPropose: boolean;
  allowFinalize: boolean;
};

export const defaultPolicy: PolicyOptions = {
  minConfidence: 0.85,
  allowPropose: false,
  allowFinalize: false,
};

export function canPrepareEvidence(packet: EvidencePacket, minConfidence = defaultPolicy.minConfidence): PolicyDecision {
  const reasons: string[] = [];

  if (packet.confidence < minConfidence) {
    reasons.push(`confidence ${packet.confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`);
  }

  const unresolvedInvalidChecks = packet.invalidChecks.filter((check) => check.status !== "PASSED");
  if (unresolvedInvalidChecks.length > 0) {
    reasons.push(`invalid checks unresolved: ${unresolvedInvalidChecks.map((check) => check.condition).join(", ")}`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

export function canProposeResolution(
  packet: EvidencePacket,
  snapshot: MarketSnapshot,
  options: Pick<PolicyOptions, "allowPropose" | "minConfidence">,
): PolicyDecision {
  const base = canPrepareEvidence(packet, options.minConfidence);
  const reasons = [...base.reasons];

  if (!options.allowPropose) {
    reasons.push("proposal disabled by policy; pass --allow-propose to send a transaction");
  }

  if (snapshot.stateName === "Resolved" || snapshot.stateName === "Proposed") {
    reasons.push(`market is already ${snapshot.stateName}`);
  }

  if (snapshot.stateName === "Open" && snapshot.blockTimestamp < snapshot.closeTime) {
    reasons.push("market close time has not passed");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

export function canFinalizeResolution(
  snapshot: MarketSnapshot,
  options: Pick<PolicyOptions, "allowFinalize">,
): PolicyDecision {
  const reasons: string[] = [];

  if (!options.allowFinalize) {
    reasons.push("finalization disabled by policy; pass --allow-finalize to send a transaction");
  }

  if (snapshot.stateName !== "Proposed") {
    reasons.push(`market is ${snapshot.stateName}, not Proposed`);
  }

  if (snapshot.finalizeAfter === 0n) {
    reasons.push("market has no finalizeAfter timestamp");
  } else if (snapshot.blockTimestamp < snapshot.finalizeAfter) {
    reasons.push("challenge window has not elapsed");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

export function outcomeToContractValue(outcome: EvidencePacket["suggestedOutcome"]): 1 | 2 | 3 {
  if (outcome === "YES") return 1;
  if (outcome === "NO") return 2;
  return 3;
}
