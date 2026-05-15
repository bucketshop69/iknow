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
  closeTime: z.string(),
  resolutionSource: z.string().min(1),
  outcomes: z.tuple([z.literal("YES"), z.literal("NO")]),
});

export type MarketDraft = z.infer<typeof marketDraftSchema>;
