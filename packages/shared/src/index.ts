import { z } from "zod";

export const CREATE_MIN_CREATION_BOND_USDC = "5";
export const CREATE_MIN_INITIAL_LIQUIDITY_USDC = "10";

export const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
} as const;

export const marketDraftSchema = z.object({
  question: z.string().min(8),
  closeTime: z.string().datetime(),
  resolutionSource: z.string().min(1),
  invalidConditions: z.array(z.string().min(1)).default([]),
  outcomes: z.tuple([z.literal("YES"), z.literal("NO")]),
});

export type MarketDraft = z.infer<typeof marketDraftSchema>;

export const marketSpecHashInputSchema = z.object({
  question: z.string().min(8),
  outcomes: z.tuple([z.literal("YES"), z.literal("NO")]),
  closeTime: z.string().datetime(),
  resolutionSource: z.string().min(1),
  invalidConditions: z.array(z.string().min(1)),
});

export const marketFactoryArgsSchema = z.object({
  specHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  metadataURI: z.string().min(1),
  closeTime: z.number().int().positive(),
  creationBond: z.string().regex(/^\d+$/),
  initialLiquidity: z.string().regex(/^\d+$/),
});

export const marketDraftResponseSchema = z.object({
  draft: marketDraftSchema,
  specHashInput: marketSpecHashInputSchema,
  factoryArgs: marketFactoryArgsSchema,
});

export const resolutionOutcomeSchema = z.enum(["YES", "NO", "INVALID"]);

export const resolverEvidenceLinkSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).optional(),
  publisher: z.string().min(1).optional(),
  publishedAt: z.string().datetime().optional(),
  accessedAt: z.string().datetime(),
});

export const resolverExtractedFactSchema = z.object({
  claim: z.string().min(1),
  sourceUrl: z.string().url(),
  observedAt: z.string().datetime().optional(),
  supportsOutcome: resolutionOutcomeSchema.optional(),
});

export const resolverInvalidCheckSchema = z.object({
  condition: z.string().min(1),
  status: z.enum(["PASSED", "FAILED", "UNKNOWN"]),
  explanation: z.string().min(1),
  evidenceUrls: z.array(z.string().url()).default([]),
});

export const resolverEvidencePacketSchema = z.object({
  marketId: z.string().min(1),
  marketAddress: evmAddressSchema,
  suggestedOutcome: resolutionOutcomeSchema,
  confidence: z.number().min(0).max(1),
  evidenceLinks: z.array(resolverEvidenceLinkSchema).min(1),
  extractedFacts: z.array(resolverExtractedFactSchema).min(1),
  invalidChecks: z.array(resolverInvalidCheckSchema).default([]),
  generatedAt: z.string().datetime(),
  agentId: z.string().min(1),
  policyVersion: z.string().min(1).optional(),
  policyStatus: z.enum(["AUTO_PROPOSE", "REFUSE", "NEEDS_REVIEW"]).optional(),
  autoPropose: z.boolean().optional(),
  policyReasons: z.array(z.string().min(1)).optional(),
});

export const evidencePacketSchema = resolverEvidencePacketSchema;

export const evidencePacketResponseSchema = z.object({
  packet: evidencePacketSchema,
  packetHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  evidenceURI: z.string().regex(/^local:\/\/evidence\/0x[a-fA-F0-9]{64}$/),
});

export const resolverPolicyDecisionSchema = z.object({
  marketId: z.string().min(1),
  marketAddress: evmAddressSchema,
  agentId: z.string().min(1),
  generatedAt: z.string().datetime(),
  suggestedOutcome: resolutionOutcomeSchema,
  confidence: z.number().min(0).max(1),
  decision: z.enum(["AUTO_PROPOSE", "REFUSE", "NEEDS_REVIEW"]),
  eligibleForAutonomousResolution: z.boolean(),
  autoPropose: z.boolean(),
  refusalReason: z.string().min(1).optional(),
  needsReviewReasons: z.array(z.string().min(1)).default([]),
  policyVersion: z.string().min(1),
  minimumConfidence: z.number().min(0).max(1),
  metConfidenceThreshold: z.boolean(),
  metEvidenceThreshold: z.boolean(),
  metInvalidCheckThreshold: z.boolean(),
  challengeWindowExpected: z.boolean(),
  canFinalizeAfterChallenge: z.boolean(),
  evidencePacket: resolverEvidencePacketSchema.optional(),
});

export const localActorSchema = z.object({
  address: evmAddressSchema,
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const marketSourceIdeaSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1),
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  question: z.string().min(8).optional(),
  closeTime: z.string().datetime().optional(),
});

export const deployedMarketSchema = z.object({
  id: z.string().min(1),
  address: evmAddressSchema,
  specHash: marketFactoryArgsSchema.shape.specHash,
  metadataURI: z.string().min(1),
  question: z.string().min(8),
  closeTime: z.number().int().positive(),
  resolutionSource: z.string().min(1).optional(),
  invalidConditions: z.array(z.string().min(1)).optional(),
  imageUrl: z.string().url().optional(),
  sourceIdea: marketSourceIdeaSchema.optional(),
  creationBond: z.string().regex(/^\d+$/),
  initialLiquidity: z.string().regex(/^\d+$/),
  yesTokenId: z.string().regex(/^\d+$/),
  noTokenId: z.string().regex(/^\d+$/),
});

export const localDeploymentSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAtBlockTimestamp: z.number().int().positive(),
  chain: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    rpcUrl: z.string().url(),
  }),
  contracts: z.object({
    mockUSDC: z.object({
      address: evmAddressSchema,
      decimals: z.number().int().positive(),
    }),
    outcomeToken: z.object({
      address: evmAddressSchema,
    }),
    iknowMarketFactory: z.object({
      address: evmAddressSchema,
    }),
  }),
  actors: z.object({
    deployer: localActorSchema,
    creator: localActorSchema,
    traderYes: localActorSchema,
    traderNo: localActorSchema,
    liquidityProvider: localActorSchema,
    resolver: localActorSchema,
    protocol: localActorSchema,
  }),
  markets: z.array(deployedMarketSchema),
});

export type MarketSpecHashInput = z.infer<typeof marketSpecHashInputSchema>;
export type ResolutionOutcome = z.infer<typeof resolutionOutcomeSchema>;
export type ResolverEvidenceLink = z.infer<typeof resolverEvidenceLinkSchema>;
export type ResolverExtractedFact = z.infer<typeof resolverExtractedFactSchema>;
export type ResolverInvalidCheck = z.infer<typeof resolverInvalidCheckSchema>;
export type ResolverEvidencePacket = z.infer<typeof resolverEvidencePacketSchema>;
export type ResolverPolicyDecision = z.infer<typeof resolverPolicyDecisionSchema>;
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
export type EvidencePacketResponse = z.infer<typeof evidencePacketResponseSchema>;
export type MarketFactoryArgs = z.infer<typeof marketFactoryArgsSchema>;
export type MarketDraftResponse = z.infer<typeof marketDraftResponseSchema>;
export type MarketSourceIdea = z.infer<typeof marketSourceIdeaSchema>;
export type LocalActor = z.infer<typeof localActorSchema>;
export type DeployedMarket = z.infer<typeof deployedMarketSchema>;
export type LocalDeployment = z.infer<typeof localDeploymentSchema>;
