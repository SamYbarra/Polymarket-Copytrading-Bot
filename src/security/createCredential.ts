/**
 * Create or derive API credential for Polymarket CLOB via createOrDeriveApiKey.
 * Uses existing credential.json when present (avoids "Could not create api key" log spam).
 * Calls createOrDeriveApiKey only when credential.json is missing.
 */

import { ApiKeyCreds, ClobClient, Chain } from "@polymarket/clob-client";
import { writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { mkdirSync, existsSync } from "fs";
import { Wallet } from "@ethersproject/wallet";
import { tradingEnv, maskAddress } from "../config/env";
const ts = () => new Date().toISOString();

const CREDENTIAL_PATH = resolve(__dirname, "../../src/data/credential.json");

function loadFromFile(): ApiKeyCreds | null {
  if (!existsSync(CREDENTIAL_PATH)) return null;
  try {
    const cred = JSON.parse(readFileSync(CREDENTIAL_PATH, "utf-8")) as ApiKeyCreds;
    return cred?.key ? cred : null;
  } catch {
    return null;
  }
}

export async function createCredential(): Promise<ApiKeyCreds | null> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    console.log(`${ts()} ⏭ Credential: PRIVATE_KEY not set`);
    return null;
  }

  const existing = loadFromFile();
  if (existing) {
    console.log(`${ts()} ℹ Using credential from credential.json`);
    return existing;
  }

  try {
    const wallet = new Wallet(privateKey);
    const chainId = tradingEnv.CHAIN_ID as Chain;
    const host = tradingEnv.CLOB_API_URL;

    const tempClient = new ClobClient(host, chainId, wallet);
    // Derive first (restore existing key). createApiKey() returns 400 when a key already exists for nonce 0.
    // See https://github.com/Polymarket/clob-client/issues/202
    let credential: ApiKeyCreds;
    try {
      credential = await tempClient.deriveApiKey();
    } catch {
      credential = await tempClient.createApiKey();
    }
    if (!credential?.key) {
      throw new Error("No API key returned (derive or create)");
    }
    // SDK may return apiKey; normalize to key for our file format
    const toSave = {
      key: credential.key,
      secret: credential.secret,
      passphrase: credential.passphrase,
    };

    const dir = resolve(__dirname, "../../src/data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CREDENTIAL_PATH, JSON.stringify(toSave, null, 2));

    console.log(`${ts()} ✔ Credential saved for ${maskAddress(wallet.address)}`);
    return toSave;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${ts()} ✗ Credential: ${msg}`);
    return null;
  }
}
