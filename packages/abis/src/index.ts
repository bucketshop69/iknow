export const iknowMarketFactoryAbi = [
  {
    type: "event",
    name: "MarketFactoryBootstrapped",
    inputs: [{ name: "deployer", type: "address", indexed: true }],
    anonymous: false,
  },
] as const;

export const deployedAddresses = {
  arcTestnet: {
    marketFactory: undefined,
  },
} as const;
