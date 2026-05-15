import { z } from "zod";

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

export const localActorSchema = z.object({
  address: evmAddressSchema,
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const deployedMarketSchema = z.object({
  id: z.string().min(1),
  address: evmAddressSchema,
  specHash: marketFactoryArgsSchema.shape.specHash,
  metadataURI: z.string().min(1),
  question: z.string().min(8),
  closeTime: z.number().int().positive(),
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
export type MarketFactoryArgs = z.infer<typeof marketFactoryArgsSchema>;
export type MarketDraftResponse = z.infer<typeof marketDraftResponseSchema>;
export type LocalActor = z.infer<typeof localActorSchema>;
export type DeployedMarket = z.infer<typeof deployedMarketSchema>;
export type LocalDeployment = z.infer<typeof localDeploymentSchema>;
