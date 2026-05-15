import { z } from "zod";

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

export type MarketSpecHashInput = z.infer<typeof marketSpecHashInputSchema>;
export type MarketFactoryArgs = z.infer<typeof marketFactoryArgsSchema>;
export type MarketDraftResponse = z.infer<typeof marketDraftResponseSchema>;
