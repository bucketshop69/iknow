import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { createPublicClient, type Address } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { arcTestnetChain } from "./wagmi";

const CIRCLE_USERNAME_KEY = "iknow-circle-passkey-username";

export interface CircleWalletSession {
  address: Address;
  username: string;
  mode: WebAuthnMode;
}

const requiredEnv = (name: "VITE_CIRCLE_CLIENT_KEY" | "VITE_CIRCLE_CLIENT_URL") => {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
};

const requiredClientUrl = () => {
  const value = requiredEnv("VITE_CIRCLE_CLIENT_URL");
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Circle client URL is invalid. Use the Client URL from Modular Wallets Configurator.");
  }

  return value;
};

const arcClientUrl = (clientUrl: string) => `${clientUrl.replace(/\/+$/g, "")}/arcTestnet`;

const createDemoUsername = () => `iknow-${crypto.randomUUID()}`;

export async function connectCirclePasskeyWallet(): Promise<CircleWalletSession> {
  const clientKey = requiredEnv("VITE_CIRCLE_CLIENT_KEY");
  const clientUrl = requiredClientUrl();
  const storedUsername = window.localStorage.getItem(CIRCLE_USERNAME_KEY);
  const username = storedUsername ?? createDemoUsername();
  const mode = storedUsername ? WebAuthnMode.Login : WebAuthnMode.Register;
  const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport,
    mode,
    username,
  });
  const modularTransport = toModularTransport(arcClientUrl(clientUrl), clientKey);
  const client = createPublicClient({
    chain: arcTestnetChain,
    transport: modularTransport,
  });
  const smartAccount = await toCircleSmartAccount({
    client,
    owner: toWebAuthnAccount({ credential }),
  });

  window.localStorage.setItem(CIRCLE_USERNAME_KEY, username);

  return {
    address: smartAccount.address,
    username,
    mode,
  };
}
