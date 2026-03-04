/**
 * Create or derive API credential for Polymarket CLOB (same as main bot).
 * Uses createOrDeriveApiKey; writes to CREDENTIAL_PATH so executor can load it.
 */

import { ApiKeyCreds, ClobClient, Chain } from "@polymarket/clob-client";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { Wallet } from "@ethersproject/wallet";
import { config } from "../config";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function maskAddress(addr: string): string {
  if (!addr || addr.length < 12) return "***";
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}

function getCredentialPath(): string {
  return resolve(process.cwd(), config.CREDENTIAL_PATH);
}

function loadFromFile(): ApiKeyCreds | null {
  const path = getCredentialPath();
  if (!existsSync(path)) return null;
  try {
    const cred = JSON.parse(readFileSync(path, "utf-8")) as ApiKeyCreds;
    return cred?.key ? cred : null;
  } catch {
    return null;
  }
}

export async function createCredential(): Promise<ApiKeyCreds | null> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) {
    log("Credential: PRIVATE_KEY not set");
    return null;
  }

  const existing = loadFromFile();
  if (existing) {
    log("Using credential from credential.json");
    return existing;
  }

  try {
    const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
    const wallet = new Wallet(key);
    const chainId = config.CHAIN_ID as Chain;
    const host = config.CLOB_HOST;

    const tempClient = new ClobClient(host, chainId, wallet);
    let credential: ApiKeyCreds;
    try {
      credential = await tempClient.deriveApiKey();
    } catch {
      credential = await tempClient.createApiKey();
    }
    if (!credential?.key) {
      throw new Error("No API key returned (derive or create)");
    }
    const toSave = {
      key: credential.key,
      secret: credential.secret,
      passphrase: credential.passphrase,
    };

    const path = getCredentialPath();
    const dir = resolve(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(toSave, null, 2));

    log(`Credential saved for ${maskAddress(wallet.address)}`);
    return toSave;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`Credential: ${msg}`);
    return null;
  }
}
