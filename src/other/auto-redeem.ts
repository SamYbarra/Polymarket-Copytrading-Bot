#!/usr/bin/env bun
/**
 * Automated redemption script for resolved Polymarket markets
 * 
 * This script:
 * 1. Checks all markets in your holdings
 * 2. Identifies which markets are resolved
 * 3. Automatically redeems resolved markets
 * 
 * Usage:
 *   bun src/auto-redeem.ts                    # Check and redeem all resolved markets (from holdings file)
 *   bun src/auto-redeem.ts --api               # Fetch all markets from API and redeem winning positions
 *   bun src/auto-redeem.ts --dry-run          # Check but don't redeem (preview only)
 *   bun src/auto-redeem.ts --clear-holdings   # Clear holdings after successful redemption
 *   bun src/auto-redeem.ts --check <conditionId>  # Check if a specific market is resolved
 */

import {
    autoRedeemResolvedMarkets,
    isMarketResolved,
    redeemMarket,
    getUserTokenBalances,
    redeemAllWinningMarketsFromAPI
} from "../utils/redeem";
import { getAllHoldings } from "../utils/holdings";
import { env } from "../config/env";

async function main() {
    const args = process.argv.slice(2);
    
    // Check for specific condition ID
    const checkIndex = args.indexOf("--check");
    if (checkIndex !== -1 && args[checkIndex + 1]) {
        const conditionId = args[checkIndex + 1];
        console.log(`\n=== Checking Market Status ===`);
        console.log(`Condition ID: ${conditionId}`);
        
        const { isResolved, market, reason, winningIndexSets } = await isMarketResolved(conditionId);
        
        if (isResolved) {
            console.log(`✅ Market is RESOLVED and ready for redemption!`);
            console.log(`Outcome: ${market?.outcome || "N/A"}`);
            if (winningIndexSets && winningIndexSets.length > 0) {
                console.log(`Winning outcomes: ${winningIndexSets.join(", ")}`);
            }
            console.log(`Reason: ${reason}`);
            
            // Check user's holdings
            try {
                const privateKey = env.PRIVATE_KEY;
                if (privateKey) {
                    const { Wallet } = await import("@ethersproject/wallet");
                    const wallet = new Wallet(privateKey);
                    const balances = await getUserTokenBalances(conditionId, await wallet.getAddress());
                    
                    if (balances.size > 0) {
                        console.log("\nYour token holdings:");
                        for (const [indexSet, balance] of balances.entries()) {
                            const isWinner = winningIndexSets?.includes(indexSet);
                            const status = isWinner ? "✅ WINNER" : "❌ Loser";
                            console.log(`  IndexSet ${indexSet}: ${balance.toString()} tokens ${status}`);
                        }
                        
                        const winningHeld = Array.from(balances.keys()).filter(idx => 
                            winningIndexSets?.includes(idx)
                        );
                        if (winningHeld.length > 0) {
                            console.log(`\nYou hold winning tokens! (IndexSets: ${winningHeld.join(", ")})`);
                        } else {
                            console.log("\n⚠️  You don't hold any winning tokens for this market.");
                        }
                    }
                }
            } catch (error) {
                // Ignore balance check errors
            }
            
            // Ask if user wants to redeem
            const shouldRedeem = args.includes("--redeem");
            if (shouldRedeem) {
                console.log("\nRedeeming market...");
                try {
                    const receipt = await redeemMarket(conditionId);
                    console.log(`✅ Successfully redeemed!`);
                    console.log(`Transaction: ${receipt.transactionHash}`);
                } catch (error) {
                    console.log(`Failed to redeem: ${error instanceof Error ? error.message : String(error)}`);
                    process.exit(1);
                }
            } else {
                console.log("\nTo redeem this market, run:");
                console.log(`  bun src/auto-redeem.ts --check ${conditionId} --redeem`);
            }
        } else {
            console.log(`❌ Market is NOT resolved`);
            console.log(`Reason: ${reason}`);
        }
        return;
    }
    
    // Check for flags
    const dryRun = args.includes("--dry-run");
    const clearHoldings = args.includes("--clear-holdings");
    const useAPI = args.includes("--api");
    
    if (dryRun) {
        console.log("\n=== DRY RUN MODE: No actual redemptions will be performed ===\n");
    }
    
    // Use API method if --api flag is set
    if (useAPI) {
        console.log("\n=== USING POLYMARKET API METHOD ===");
        console.log("Fetching all markets from API and checking for winning positions...\n");
        
        const maxMarkets = args.includes("--max") 
            ? parseInt(args[args.indexOf("--max") + 1]) || 1000
            : 1000;
        
        const result = await redeemAllWinningMarketsFromAPI({
            maxMarkets,
            dryRun,
        });
        
        // Print summary
        console.log("\n" + "=".repeat(50));
        console.log("API REDEMPTION SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total markets checked: ${result.totalMarketsChecked}`);
        console.log(`Markets where you have positions: ${result.marketsWithPositions}`);
        console.log(`Resolved markets: ${result.resolved}`);
        console.log(`Markets with winning tokens: ${result.withWinningTokens}`);
        
        if (dryRun) {
            console.log(`Would redeem: ${result.withWinningTokens} market(s)`);
        } else {
            console.log(`Successfully redeemed: ${result.redeemed} market(s)`);
            if (result.failed > 0) {
                console.log(`Failed: ${result.failed} market(s)`);
            }
        }
        
        // Show detailed results for markets with winning tokens
        if (result.withWinningTokens > 0) {
            console.log("\nDetailed Results (Markets with Winning Tokens):");
            for (const res of result.results) {
                if (res.hasWinningTokens) {
                    const title = res.marketTitle ? `"${res.marketTitle.substring(0, 50)}..."` : res.conditionId.substring(0, 20) + "...";
                    if (res.redeemed) {
                        console.log(`  ✅ ${title} - Redeemed`);
                    } else {
                        console.log(`  ❌ ${title} - Failed: ${res.error || "Unknown error"}`);
                    }
                }
            }
        }
        
        if (result.withWinningTokens === 0 && !dryRun) {
            console.log("\nNo resolved markets with winning tokens found.");
        }
        
        return;
    }
    
    // Default: Use holdings file method
    console.log("\n=== USING HOLDINGS FILE METHOD ===");
    
    // Get all holdings
    const holdings = getAllHoldings();
    const marketCount = Object.keys(holdings).length;
    
    if (marketCount === 0) {
        console.log("No holdings found in token-holding.json. Nothing to redeem.");
        console.log("\nOptions:");
        console.log("  1. Holdings are tracked automatically when you place orders");
        console.log("  2. Use --api flag to fetch all markets from Polymarket API instead");
        console.log("     Example: bun src/auto-redeem.ts --api");
        process.exit(0);
    }
    
    console.log(`\nFound ${marketCount} market(s) in holdings`);
    console.log("Checking which markets are resolved...\n");
    
    // Run auto-redemption
    const result = await autoRedeemResolvedMarkets({
        dryRun,
        clearHoldingsAfterRedeem: clearHoldings,
    });
    
    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("REDEMPTION SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total markets checked: ${result.total}`);
    console.log(`Resolved markets: ${result.resolved}`);
    
    if (dryRun) {
        console.log(`Would redeem: ${result.resolved} market(s)`);
    } else {
        console.log(`Successfully redeemed: ${result.redeemed} market(s)`);
        if (result.failed > 0) {
            console.log(`Failed: ${result.failed} market(s)`);
        }
    }
    
    // Show detailed results
    if (result.resolved > 0 || result.failed > 0) {
        console.log("\nDetailed Results:");
        for (const res of result.results) {
            if (res.isResolved) {
                if (res.redeemed) {
                    console.log(`  ✅ ${res.conditionId.substring(0, 20)}... - Redeemed`);
                } else {
                    console.log(`  ❌ ${res.conditionId.substring(0, 20)}... - Failed: ${res.error || "Unknown error"}`);
                }
            }
        }
    }
    
    if (result.resolved === 0 && !dryRun) {
        console.log("\nNo resolved markets found. All markets are either still active or not yet reported.");
    }
}

main().catch((error) => {
            console.log("Fatal error", error);
    process.exit(1);
});

