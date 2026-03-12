#!/usr/bin/env ts-node

/**
 * Sync Holdings from Wallet
 * 
 * Queries the blockchain to find all Polymarket tokens in your wallet
 * and formats them in the same structure as token-holding.json
 * 
 * This helps identify any tokens that might be missing from token-holding.json
 * 
 * Usage:
 *   npm run sync-holdings
 */

import { resolve } from "path";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { formatEther } from "@ethersproject/units";
import { hexZeroPad } from "@ethersproject/bytes";
import { Chain, getContractConfig } from "@polymarket/clob-client";
import { writeFileSync } from "fs";
import { getAllHoldings, TokenHoldings } from "../utils/holdings";
import { env, getRpcUrl } from "../config/env";

// ERC1155 TransferSingle event ABI
const TRANSFER_SINGLE_ABI = [
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
];

// ConditionalTokens contract ABI (minimal - just what we need)
const CTF_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
    "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)",
    "function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)"
];



/**
 * Get all tokens from wallet by checking balances for known conditionIds
 * and also scanning transfer events for additional tokens
 */
async function getTokensFromWallet(
    walletAddress: string
): Promise<{ holdings: TokenHoldings; unknownTokens: Array<{ tokenId: string; balance: number }> }> {
    const holdings: TokenHoldings = {};
    const unknownTokens: Array<{ tokenId: string; balance: number }> = [];
    
    const chainId = env.CHAIN_ID as Chain;
    const contractConfig = getContractConfig(chainId);
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, provider);
    
    console.log("🔍 Checking token balances from blockchain...");
    
    // Step 1: Check balances for conditionIds from existing holdings
    const existingHoldings = getAllHoldings();
    const knownConditionIds = Object.keys(existingHoldings);
    
    if (knownConditionIds.length > 0) {
        console.log(`   Checking balances for ${knownConditionIds.length} known conditionId(s)...`);
        
        for (const conditionId of knownConditionIds) {
            try {
                // Convert conditionId to bytes32 format
                const conditionIdBytes32 = hexZeroPad(
                    conditionId.startsWith("0x") ? conditionId : `0x${conditionId}`,
                    32
                );
                
                // Get outcome slot count
                const outcomeSlotCount = await ctfContract.getOutcomeSlotCount(conditionIdBytes32);
                const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";
                
                if (!holdings[conditionId]) {
                    holdings[conditionId] = {};
                }
                
                // Check each outcome token
                for (let i = 1; i <= outcomeSlotCount.toNumber(); i++) {
                    try {
                        const collectionId = await ctfContract.getCollectionId(
                            parentCollectionId,
                            conditionIdBytes32,
                            i
                        );
                        
                        const positionId = await ctfContract.getPositionId(
                            contractConfig.collateral,
                            collectionId
                        );
                        
                        const balance = await ctfContract.balanceOf(walletAddress, positionId);
                        
                        if (!balance.isZero()) {
                            const balanceFormatted = parseFloat(formatEther(balance));
                            holdings[conditionId][positionId.toString()] = balanceFormatted;
                            console.log(`   ✓ ${conditionId.substring(0, 12)}... -> ${balanceFormatted.toFixed(2)} tokens`);
                        }
                    } catch (error) {
                        continue;
                    }
                }
            } catch (error) {
                console.log(`   ⚠️  Failed to check conditionId ${conditionId.substring(0, 12)}...`);
                continue;
            }
        }
    }
    
    // Step 2: Scan transfer events to find additional tokens
    console.log("\n   Scanning transfer events for additional tokens...");
    
    try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 200000); // ~1 month
        
        const transferFilter = ctfContract.filters.TransferSingle(null, null, walletAddress);
        const transfers = await ctfContract.queryFilter(transferFilter, fromBlock, currentBlock);
        
        console.log(`   Found ${transfers.length} transfer events`);
        
        // Extract unique position IDs
        const positionIds = new Set<string>();
        for (const event of transfers) {
            if (event.args && event.args.id) {
                positionIds.add(event.args.id.toString());
            }
        }
        
        console.log(`   Found ${positionIds.size} unique position IDs`);
        console.log(`   Checking current balances...`);
        
        // Check current balances and identify known vs unknown tokens
        const knownPositionIds = new Set<string>();
        for (const tokens of Object.values(holdings)) {
            for (const tokenId of Object.keys(tokens)) {
                knownPositionIds.add(tokenId);
            }
        }
        
        for (const positionId of Array.from(positionIds)) {
            // Skip if already in holdings
            if (knownPositionIds.has(positionId)) continue;
            
            try {
                const balance = await ctfContract.balanceOf(walletAddress, positionId);
                if (!balance.isZero()) {
                    const balanceFormatted = parseFloat(formatEther(balance));
                    unknownTokens.push({ tokenId: positionId, balance: balanceFormatted });
                }
            } catch (error) {
                continue;
            }
        }
        
        console.log(`   Found ${unknownTokens.length} additional token(s) with balances`);
        
    } catch (error) {
        console.log(`   Error scanning transfer events: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return { holdings, unknownTokens };
}

/**
 * Compare wallet holdings with existing token-holding.json
 */
function compareHoldings(walletHoldings: TokenHoldings, existingHoldings: TokenHoldings) {
    console.log("\n📊 COMPARISON RESULTS");
    console.log("=".repeat(70));
    
    const missing: Array<{ conditionId: string; tokenId: string; amount: number }> = [];
    const different: Array<{ conditionId: string; tokenId: string; walletAmount: number; fileAmount: number }> = [];
    
    // Check for missing or different amounts
    for (const [conditionId, tokens] of Object.entries(walletHoldings)) {
        if (!existingHoldings[conditionId]) {
            // Entire conditionId missing
            for (const [tokenId, amount] of Object.entries(tokens)) {
                missing.push({ conditionId, tokenId, amount });
            }
        } else {
            // Check individual tokens
            for (const [tokenId, amount] of Object.entries(tokens)) {
                const existingAmount = existingHoldings[conditionId][tokenId];
                if (existingAmount === undefined) {
                    missing.push({ conditionId, tokenId, amount });
                } else if (Math.abs(existingAmount - amount) > 0.01) {
                    different.push({ conditionId, tokenId, walletAmount: amount, fileAmount: existingAmount });
                }
            }
        }
    }
    
    // Also check for tokens in file but not in wallet (sold/redeemed)
    const extra: Array<{ conditionId: string; tokenId: string; amount: number }> = [];
    for (const [conditionId, tokens] of Object.entries(existingHoldings)) {
        if (!walletHoldings[conditionId]) {
            for (const [tokenId, amount] of Object.entries(tokens)) {
                extra.push({ conditionId, tokenId, amount });
            }
        } else {
            for (const [tokenId, amount] of Object.entries(tokens)) {
                if (walletHoldings[conditionId][tokenId] === undefined) {
                    extra.push({ conditionId, tokenId, amount });
                }
            }
        }
    }
    
    if (missing.length === 0 && different.length === 0 && extra.length === 0) {
        console.log("✅ All holdings match! No differences found.");
        return;
    }
    
    if (missing.length > 0) {
        console.log(`\n⚠️  MISSING from token-holding.json (${missing.length} token(s)):`);
        for (const item of missing) {
            console.log(`   ConditionId: ${item.conditionId.substring(0, 20)}...`);
            console.log(`   TokenId: ${item.tokenId.substring(0, 20)}...`);
            console.log(`   Amount: ${item.amount.toFixed(2)} tokens`);
            console.log("");
        }
    }
    
    if (different.length > 0) {
        console.log(`\n⚠️  DIFFERENT amounts (${different.length} token(s)):`);
        for (const item of different) {
            console.log(`   ConditionId: ${item.conditionId.substring(0, 20)}...`);
            console.log(`   TokenId: ${item.tokenId.substring(0, 20)}...`);
            console.log(`   Wallet: ${item.walletAmount.toFixed(2)} tokens`);
            console.log(`   File: ${item.fileAmount.toFixed(2)} tokens`);
            console.log(`   Difference: ${(item.walletAmount - item.fileAmount).toFixed(2)} tokens`);
            console.log("");
        }
    }
    
    if (extra.length > 0) {
        console.log(`\nℹ️  IN FILE but not in wallet (${extra.length} token(s)) - may have been sold/redeemed:`);
        for (const item of extra) {
            console.log(`   ConditionId: ${item.conditionId.substring(0, 20)}...`);
            console.log(`   TokenId: ${item.tokenId.substring(0, 20)}...`);
            console.log(`   Amount in file: ${item.amount.toFixed(2)} tokens`);
            console.log("");
        }
    }
}

async function main() {
    console.log("🔄 SYNC HOLDINGS FROM WALLET");
    console.log("=".repeat(70));
    
    const privateKey = env.PRIVATE_KEY;
    if (!privateKey) {
        console.log("❌ PRIVATE_KEY not found in .env file");
        process.exit(1);
    }
    
    const chainId = env.CHAIN_ID as Chain;
    const contractConfig = getContractConfig(chainId);
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Chain: ${chainId} (Polygon)`);
    console.log(`CTF Contract: ${contractConfig.conditionalTokens}`);
    console.log("");
    
    // Get existing holdings from file
    const existingHoldings = getAllHoldings();
    console.log(`Existing holdings in file: ${Object.keys(existingHoldings).length} market(s)`);
    
    // Get tokens from wallet
    const { holdings: walletHoldings, unknownTokens } = await getTokensFromWallet(walletAddress);
    
    console.log(`\nWallet holdings: ${Object.keys(walletHoldings).length} market(s)`);
    
    // Show unknown tokens
    if (unknownTokens.length > 0) {
        console.log(`\n⚠️  Found ${unknownTokens.length} token(s) with unknown conditionIds:`);
        console.log("   These tokens are in your wallet but conditionId could not be determined.");
        console.log("   You may need to manually identify which market they belong to.");
        console.log("");
        for (const token of unknownTokens) {
            console.log(`   Position ID: ${token.tokenId}`);
            console.log(`   Balance: ${token.balance.toFixed(2)} tokens`);
            console.log("");
        }
        console.log("   💡 You can manually add these using: npm run manual-add-holdings");
        console.log("");
    }
    
    // Compare
    compareHoldings(walletHoldings, existingHoldings);
    
    // Save wallet holdings to a file for reference (optional)
    if (Object.keys(walletHoldings).length > 0) {
        const walletHoldingsFile = resolve(process.cwd(), "src/data/wallet-holdings-sync.json");
        writeFileSync(walletHoldingsFile, JSON.stringify(walletHoldings, null, 2));
        console.log(`\n💾 Wallet holdings saved to: src/data/wallet-holdings-sync.json`);
        console.log("   (This is for reference - token-holding.json remains unchanged)");
    }
    
    // Show summary
    console.log("\n" + "=".repeat(70));
    console.log("✅ Sync complete!");
    console.log(`\n📁 Wallet holdings saved to memory`);
    console.log(`📁 File holdings: src/data/token-holding.json`);
    console.log(`\n💡 To update token-holding.json with wallet data, use: npm run manual-add-holdings`);
}

main().catch((error) => {
    console.log("Fatal error:", error);
    process.exit(1);
});

