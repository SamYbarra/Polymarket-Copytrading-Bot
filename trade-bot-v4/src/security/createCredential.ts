/**
 * Create or derive API credential for Polymarket CLOB.
 */

import { ApiKeyCreds, ClobClient, Chain } from "@polymarket/clob-client";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { Wallet } from "@ethersproject/wallet";
import { config } from "../config";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

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
    const tempClient = new ClobClient(config.CLOB_HOST, chainId, wallet);
    let credential: ApiKeyCreds;
    try {
      credential = await tempClient.deriveApiKey();
    } catch {
      credential = await tempClient.createApiKey();
    }
    if (!credential?.key) throw new Error("No API key returned");
    const path = getCredentialPath();
    const dir = resolve(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ key: credential.key, secret: credential.secret, passphrase: credential.passphrase }, null, 2));
    log(`Credential saved for ${wallet.address.slice(0, 6)}...`);
    return credential;
  } catch (error: unknown) {
    log(`Credential: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
