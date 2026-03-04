/**
 * Polymarket CLOB client for trading.
 * Requires src/data/credential.json (copy from polymarket-copytrading-bot or run createCredential there).
 */

import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { Chain, ClobClient } from "@polymarket/clob-client";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { tradingEnv } from "../config/env";

let cachedClient: ClobClient | null = null;
let cachedConfig: { chainId: number; host: string } | null = null;

export async function getClobClient(): Promise<ClobClient> {
  const credentialPath = resolve(__dirname, "../../src/data/credential.json");
  if (!existsSync(credentialPath)) {
    throw new Error(
      "Credential file not found at src/data/credential.json. " +
        "Copy from polymarket-copytrading-bot-ts or run createCredential there."
    );
  }

  const creds: ApiKeyCreds = JSON.parse(readFileSync(credentialPath, "utf-8"));
  const chainId = tradingEnv.CHAIN_ID as Chain;
  const host = tradingEnv.CLOB_API_URL;

  if (cachedClient && cachedConfig && cachedConfig.chainId === chainId && cachedConfig.host === host) {
    return cachedClient;
  }

  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env");
  }

  const wallet = new Wallet(privateKey);
  const secretBase64 = creds.secret.replace(/-/g, "+").replace(/_/g, "/");
  const apiKeyCreds: ApiKeyCreds = {
    key: creds.key,
    secret: secretBase64,
    passphrase: creds.passphrase,
  };

  const proxyWalletAddress = tradingEnv.PROXY_WALLET_ADDRESS;
  cachedClient = new ClobClient(host, chainId, wallet, apiKeyCreds, 2, proxyWalletAddress);
  cachedConfig = { chainId, host };
  return cachedClient;
}

export function clearClobClientCache(): void {
  cachedClient = null;
  cachedConfig = null;
}
