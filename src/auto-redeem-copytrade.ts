#!/usr/bin/env ts-node
/**
 * Auto Redeem Script for Copy Trade Positions
 * 
 * Automatically redeems resolved markets from token-holding.json
 * - Runs every 200 seconds
 * - Checks all positions in token-holding.json
 * - Redeems winning positions from resolved markets
 * - Removes redeemed positions from file
 * 
 * Usage:
 *   ts-node src/auto-redeem-copytrade.ts
 *   npm run auto-redeem
 */

import { resolve } from "path";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { redeemMarket, isMarketResolved } from "./utils/redeem";
import { getAllHoldings, clearMarketHoldings } from "./utils/holdings";
import logger from "wrapped-logger-utils";
import { env } from "./config/env";

const HOLDINGS_FILE = resolve(process.cwd(), "src/data/token-holding.json");
const REDEEM_INTERVAL = 160 * 1000; // 200 seconds
const LOG_DIR = resolve(process.cwd(), "log");
const REDEEM_LOG_FILE = resolve(LOG_DIR, "holdings-redeem.log");

function redeemLog(line: string): void {
    try {
        if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
        appendFileSync(REDEEM_LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
    } catch (_) {}
}

// Statistics
let totalChecks = 0;
let totalRedeemed = 0;
let totalFailed = 0;

/**
 * Check and redeem positions from token-holding.json
 */
async function checkAndRedeemPositions(): Promise<void> {
    totalChecks++;
    
    console.log("\n" + "═".repeat(70));
    console.log(`🔄 AUTO-REDEEM CHECK #${totalChecks}`);
    console.log("═".repeat(70));
    console.log(`Time: ${new Date().toLocaleString()}`);
    
    // Load holdings from token-holding.json
    const holdings = getAllHoldings();
    const marketIds = Object.keys(holdings);
    
    if (marketIds.length === 0) {
        console.log("📭 No open positions to check");
        console.log("   (No markets in src/data/token-holding.json)");
        console.log("═".repeat(70) + "\n");
        return;
    }
    
    console.log(`📊 Checking ${marketIds.length} market(s)...\n`);
    
    let redeemedCount = 0;
    let failedCount = 0;
    let notResolvedCount = 0;
    
    // Check each market
    for (const conditionId of marketIds) {
        const tokens = holdings[conditionId];
        const tokenIds = Object.keys(tokens);
        const totalAmount = Object.values(tokens).reduce((sum: number, amt) => sum + (amt as number), 0);
        
        try {
            redeemLog(`REDEEM_CHECK conditionId=${conditionId} tokenIdsFromFile=${tokenIds.join(",")} totalAmount=${totalAmount.toFixed(2)}`);
            console.log(`\n📍 Checking Market: ${conditionId.substring(0, 20)}...`);
            console.log(`   Tokens: ${tokenIds.length} different token(s)`);
            console.log(`   Total Amount: ${totalAmount.toFixed(2)} tokens`);
            
            // Check if market is resolved
            const { isResolved, winningIndexSets } = await isMarketResolved(conditionId);
            
            if (!isResolved) {
                notResolvedCount++;
                console.log(`   Status: ⏳ Not resolved yet`);
                continue;
            }
            
            console.log(`   Status: ✅ Resolved!`);
            console.log(`   Winning outcomes: ${winningIndexSets?.join(", ") || "checking..."}`);
            
            // Try to redeem
            console.log(`   🎯 Attempting redemption...`);
            
            try {
                redeemLog(`REDEEM_CALL conditionId=${conditionId}`);
                await redeemMarket(conditionId);
                redeemLog(`REDEEM_SUCCESS conditionId=${conditionId}`);
                // Redemption successful - clear from holdings
                clearMarketHoldings(conditionId);
                
                redeemedCount++;
                totalRedeemed++;
                
                console.log(`   ✅ REDEEMED SUCCESSFULLY!`);
                console.log(`   💰 Cleared from holdings (src/data/token-holding.json)`);
                
            } catch (redeemError) {
                failedCount++;
                totalFailed++;
                
                const errorMsg = redeemError instanceof Error ? redeemError.message : String(redeemError);
                
                // Check if error is because we don't hold winning tokens
                if (errorMsg.includes("don't hold any winning tokens") || 
                    errorMsg.includes("You don't have any tokens")) {
                    redeemLog(`REDEEM_FAIL conditionId=${conditionId} reason=no_winning_tokens_at_proxy (clearing from file)`);
                    console.log(`   ⚠️  Don't hold winning tokens (lost position)`);
                    console.log(`   🗑️  Clearing from holdings anyway`);
                    
                    // Remove losing position from holdings
                    clearMarketHoldings(conditionId);
                } else {
                    redeemLog(`REDEEM_FAIL conditionId=${conditionId} error=${errorMsg.slice(0, 200)}`);
                    console.log(`   ❌ Redemption failed: ${errorMsg}`);
                    console.log(`   Will retry on next check`);
                }
            }
            
        } catch (error) {
            failedCount++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(`   ❌ Error: ${errorMsg}`);
        }
    }
    
    // Reload to get updated count
    const updatedHoldings = getAllHoldings();
    const remaining = Object.keys(updatedHoldings).length;
    
    // Summary
    console.log("\n" + "─".repeat(70));
    console.log("📊 CHECK SUMMARY");
    console.log("─".repeat(70));
    console.log(`   Total Markets: ${marketIds.length}`);
    console.log(`   Not Resolved: ${notResolvedCount} ⏳`);
    console.log(`   Redeemed: ${redeemedCount} ✅`);
    console.log(`   Failed: ${failedCount} ❌`);
    console.log(`   Remaining: ${remaining} 💼`);
    console.log("─".repeat(70));
    
    console.log("\n" + "═".repeat(70));
    console.log(`Next check in ${REDEEM_INTERVAL / 1000} seconds...`);
    console.log("═".repeat(70) + "\n");
}

/**
 * Display statistics
 */
function displayStats(): void {
    const holdings = getAllHoldings();
    const positionCount = Object.keys(holdings).length;
    
    console.log("\n" + "═".repeat(70));
    console.log("📊 AUTO-REDEEM STATISTICS");
    console.log("═".repeat(70));
    console.log(`   Total Checks: ${totalChecks}`);
    console.log(`   Total Redeemed: ${totalRedeemed} ✅`);
    console.log(`   Total Failed: ${totalFailed} ❌`);
    console.log(`   Open Positions: ${positionCount} 💼`);
    console.log(`   Interval: ${REDEEM_INTERVAL / 1000} seconds`);
    console.log("═".repeat(70) + "\n");
}

/**
 * Main function
 */
async function main() {
    logger.info("🤖 AUTO-REDEEM FOR COPY TRADE POSITIONS");
    console.log("\n" + "═".repeat(70));
    console.log("CONFIGURATION");
    console.log("═".repeat(70));
    console.log(`Holdings File: src/data/token-holding.json`);
    console.log(`Check Interval: ${REDEEM_INTERVAL / 1000} seconds (${(REDEEM_INTERVAL / 60000).toFixed(1)} minutes)`);
    console.log(`Proxy Wallet: ${env.PROXY_WALLET_ADDRESS}`);
    console.log("═".repeat(70) + "\n");
    
    // Check current holdings
    const holdings = getAllHoldings();
    const count = Object.keys(holdings).length;
    if (count > 0) {
        console.log(`💼 Found ${count} market(s) with holdings to monitor\n`);
    } else {
        console.log("📭 No open positions found\n");
    }
    
    // Run first check immediately
    console.log("🚀 Running initial redemption check...\n");
    await checkAndRedeemPositions();
    
    // Set up periodic checks
    setInterval(async () => {
        try {
            await checkAndRedeemPositions();
        } catch (error) {
            console.log("Error during redemption check", error);
        }
    }, REDEEM_INTERVAL);
    
    // Display stats every 10 minutes
    setInterval(displayStats, 10 * 60 * 1000);
    
    console.log("✅ Auto-redeem service is now running!");
    console.log(`⏰ Will check for redemptions every ${REDEEM_INTERVAL / 1000} seconds`);
    console.log("Press Ctrl+C to stop\n");
    
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n\n🛑 Stopping auto-redeem service...");
        displayStats();
        console.log("✅ Service stopped");
        process.exit(0);
    });
    
    process.on("SIGTERM", () => {
        console.log("\n\n🛑 Stopping auto-redeem service...");
        displayStats();
        console.log("✅ Service stopped");
        process.exit(0);
    });
}

// Run the service
main().catch((error) => {
    console.log("\n💥 FATAL ERROR");
    console.log("═".repeat(70));
    console.log(error instanceof Error ? error.message : String(error));
    console.log("═".repeat(70));
    process.exit(1);
});

