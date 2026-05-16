import {
  resolutionOutcomeSchema,
  resolverEvidencePacketSchema,
  type ResolverEvidencePacket,
} from "@iknow/shared";
import { z } from "zod";

export const outcomeSchema = resolutionOutcomeSchema;
export type SuggestedOutcome = z.infer<typeof outcomeSchema>;

export const evidencePacketSchema = resolverEvidencePacketSchema;
export type EvidencePacket = ResolverEvidencePacket;

export type MarketStateName = "Open" | "Closed" | "Proposed" | "Resolved";
export type OutcomeName = "Unresolved" | "Yes" | "No" | "Invalid";

export type MarketSnapshot = {
  id: string;
  address: `0x${string}`;
  question: string;
  closeTime: bigint;
  state: number;
  stateName: MarketStateName;
  proposedOutcome: number;
  proposedOutcomeName: OutcomeName;
  finalOutcome: number;
  finalOutcomeName: OutcomeName;
  finalizeAfter: bigint;
  evidenceURI: string;
  creatorFeePool: bigint;
  blockTimestamp: bigint;
};

export type EvidenceDecision =
  | {
      kind: "packet";
      packet: EvidencePacket;
      evidenceURI: string;
      postStatus: "posted" | "failed" | "skipped";
      postStatusCode?: number;
      postMessage?: string;
    }
  | {
      kind: "refusal";
      marketId: string;
      marketAddress: `0x${string}`;
      reason: string;
      confidence: number;
    };

export type PolicyDecision = {
  allowed: boolean;
  reasons: string[];
};

export type PrepareResult = EvidenceDecision & {
  stateName: MarketStateName;
  blockTimestamp: string;
};
