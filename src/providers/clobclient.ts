import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { Chain, ClobClient } from "@polymarket/clob-client";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { env } from "../config/env";

// Cache for ClobClient instance to avoid repeated initialization
let cachedClient: ClobClient | null = null;
let cachedConfig: { chainId: number; host: string } | null = null;

/**
 * Initialize ClobClient from credentials (cached singleton)
 * Prevents creating multiple ClobClient instances
 */
export async function getClobClient(): Promise<ClobClient> {
    // Load credentials
    const credentialPath = resolve(process.cwd(), "src/data/credential.json");
    
    if (!existsSync(credentialPath)) {
        throw new Error("Credential file not found. Run createCredential() first.");
    }

    const creds: ApiKeyCreds = JSON.parse(readFileSync(credentialPath, "utf-8"));
    
    const chainId = env.CHAIN_ID as Chain;
    const host = env.CLOB_API_URL;

    // Return cached client if config hasn't changed
    if (cachedClient && cachedConfig && 
        cachedConfig.chainId === chainId && 
        cachedConfig.host === host) {
        return cachedClient;
    }

    // Create wallet from private key
    const privateKey = env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found");
    }
    const wallet = new Wallet(privateKey);

    // Convert base64url secret to standard base64 for clob-client compatibility
    const secretBase64 = creds.secret.replace(/-/g, '+').replace(/_/g, '/');

    // Create API key credentials
    const apiKeyCreds: ApiKeyCreds = {
        key: creds.key,
        secret: secretBase64,
        passphrase: creds.passphrase,
    };

    const proxyWalletAddress = env.PROXY_WALLET_ADDRESS;
    
    // Create and cache client
    cachedClient = new ClobClient(host, chainId, wallet, apiKeyCreds, 2, proxyWalletAddress);
    cachedConfig = { chainId, host };

    return cachedClient;
}

/**
 * Clear cached ClobClient (useful for testing or re-initialization)
 */
export function clearClobClientCache(): void {
    cachedClient = null;
    cachedConfig = null;
}