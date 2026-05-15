import { arcTestnet } from "@iknow/shared";
import { createConfig, http, injected } from "wagmi";
import type { Chain } from "viem";

export const anvilLocal = {
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
} as const satisfies Chain;

export const arcTestnetChain = {
  id: arcTestnet.id,
  name: arcTestnet.name,
  nativeCurrency: arcTestnet.nativeCurrency,
  rpcUrls: {
    default: {
      http: [arcTestnet.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: arcTestnet.explorerUrl,
    },
  },
} as const satisfies Chain;

export const wagmiConfig = createConfig({
  chains: [anvilLocal, arcTestnetChain],
  connectors: [injected()],
  transports: {
    [anvilLocal.id]: http(anvilLocal.rpcUrls.default.http[0]),
    [arcTestnetChain.id]: http(arcTestnetChain.rpcUrls.default.http[0]),
  },
});
