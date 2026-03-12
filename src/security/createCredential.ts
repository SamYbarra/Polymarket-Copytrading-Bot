import { ApiKeyCreds, ClobClient, Chain } from "@polymarket/clob-client";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { Wallet } from "@ethersproject/wallet";
import { env } from "../config/env";

export async function createCredential(): Promise<ApiKeyCreds | null> {
    const privateKey = env.PRIVATE_KEY;
    if (!privateKey) {
        console.log("PRIVATE_KEY not found");
        return null;
    }

    try {
        const wallet = new Wallet(privateKey);
        console.log(`Wallet address: ${wallet.address}`);
        const chainId = env.CHAIN_ID as Chain;
        const host = env.CLOB_API_URL;
        
        // Create temporary ClobClient just for credential creation
        const clobClient = new ClobClient(host, chainId, wallet);
        const credential = await clobClient.createOrDeriveApiKey();
        
        await saveCredential(credential);
        console.log("Credential created successfully");
        return credential;
    } catch (error) {
        console.log(`Error creating credential: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}   

export async function saveCredential(credential: ApiKeyCreds) {
    const credentialPath = resolve(process.cwd(), "src/data/credential.json");
    writeFileSync(credentialPath, JSON.stringify(credential, null, 2));
}