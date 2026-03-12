#!/usr/bin/env bun
/**
 * Standalone script to redeem positions for resolved markets
 * 
 * Usage:
 *   bun src/redeem.ts <conditionId> [indexSets...]
 *   bun src/redeem.ts 0x5f65177b394277fd294cd75650044e32ba009a95022d88a0c1d565897d72f8f1 1 2
 * 
 * Or set CONDITION_ID and INDEX_SETS in .env file
 */

import { redeemPositions, redeemMarket } from "../utils/redeem";
import { getAllHoldings, getMarketHoldings } from "../utils/holdings";
import { env } from "../config/env";

async function main() {
    const args = process.argv.slice(2);

    // Get condition ID from args or env
    let conditionId: string | undefined;
    let indexSets: number[] | undefined;

    if (args.length > 0) {
        conditionId = args[0];
        if (args.length > 1) {
            indexSets = args.slice(1).map(arg => parseInt(arg, 10));
        }
    } else {
        conditionId = env.CONDITION_ID;
        const indexSetsEnv = env.INDEX_SETS;
        if (indexSetsEnv) {
            indexSets = indexSetsEnv.split(",").map(s => parseInt(s.trim(), 10));
        }
    }

    // If no conditionId provided, show holdings and prompt
    if (!conditionId) {
        console.log("No condition ID provided. Showing current holdings...");
        const holdings = getAllHoldings();
        
        if (Object.keys(holdings).length === 0) {
            console.log("No holdings found.");
            console.log("\nUsage:");
            console.log("  bun src/redeem.ts <conditionId> [indexSets...]");
            console.log("  bun src/redeem.ts 0x5f65177b394277fd294cd75650044e32ba009a95022d88a0c1d565897d72f8f1 1 2");
            console.log("\nOr set in .env:");
            console.log("  CONDITION_ID=0x5f65177b394277fd294cd75650044e32ba009a95022d88a0c1d565897d72f8f1");
            console.log("  INDEX_SETS=1,2");
            process.exit(1);
        }

        console.log("\nCurrent Holdings:");
        for (const [marketId, tokens] of Object.entries(holdings)) {
            console.log(`  Market: ${marketId}`);
            for (const [tokenId, amount] of Object.entries(tokens)) {
                console.log(`    Token ${tokenId.substring(0, 20)}...: ${amount}`);
            }
        }
        console.log("\nTo redeem a market, provide the conditionId (market ID) as an argument.");
        console.log("Example: bun src/redeem.ts <conditionId>");
        process.exit(0);
    }

    // Default to [1, 2] for Polymarket binary markets if not specified
    if (!indexSets || indexSets.length === 0) {
        console.log("No index sets specified, using default [1, 2] for Polymarket binary markets");
        indexSets = [1, 2];
    }

    // Show holdings for this market if available
    const marketHoldings = getMarketHoldings(conditionId);
    if (Object.keys(marketHoldings).length > 0) {
        console.log(`\nHoldings for market ${conditionId}:`);
        for (const [tokenId, amount] of Object.entries(marketHoldings)) {
            console.log(`  Token ${tokenId.substring(0, 20)}...: ${amount}`);
        }
    } else {
        console.log(`No holdings found for market ${conditionId}`);
    }

    try {
        console.log(`\nRedeeming positions for condition: ${conditionId}`);
        console.log(`Index Sets: ${indexSets.join(", ")}`);

        // Use the simple redeemMarket function
        const receipt = await redeemMarket(conditionId);

        console.log("\n✅ Successfully redeemed positions!");
        console.log(`Transaction hash: ${receipt.transactionHash}`);
        console.log(`Block number: ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);

        // Automatically clear holdings after successful redemption
        try {
            const { clearMarketHoldings } = await import("../utils/holdings");
            clearMarketHoldings(conditionId);
            console.log(`\n✅ Cleared holdings record for this market from token-holding.json`);
        } catch (clearError) {
            console.log(`Failed to clear holdings: ${clearError instanceof Error ? clearError.message : String(clearError)}`);
            // Don't fail if clearing holdings fails
        }
    } catch (error) {
        console.log("\n❌ Failed to redeem positions:", error);
        if (error instanceof Error) {
            console.log(`Error message: ${error.message}`);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

