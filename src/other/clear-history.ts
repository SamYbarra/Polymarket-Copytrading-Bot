#!/usr/bin/env ts-node
/**
 * Clear Trade History
 * 
 * Deletes the trade history file to allow re-trading markets
 * Use this if you want to reset and start fresh
 * 
 * Usage:
 *   ts-node src/clear-history.ts
 *   bun src/clear-history.ts
 */

import { resolve } from "path";
import { existsSync, unlinkSync, readFileSync } from "fs";

const LOG_DIR = resolve(process.cwd(), "log");
const HISTORY_FILE = resolve(LOG_DIR, "trade-history.json");

async function main() {
    console.log("🗑️  CLEAR TRADE HISTORY");
    console.log("\n" + "═".repeat(70));
    
    if (!existsSync(HISTORY_FILE)) {
        console.log("⚠️  No trade history file found");
        console.log(`   Looking for: ${HISTORY_FILE}`);
        console.log("\n   Nothing to clear!");
        console.log("═".repeat(70));
        return;
    }
    
    // Show current history
    try {
        const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
        const count = Object.keys(data).length;
        
        console.log("📚 CURRENT TRADE HISTORY");
        console.log("═".repeat(70));
        console.log(`   Total trades in history: ${count}`);
        console.log(`   File: ${HISTORY_FILE}`);
        
        if (count > 0) {
            console.log("\n   Recent trades:");
            const entries = Object.entries(data).slice(-5);
            entries.forEach(([key, value]: [string, any]) => {
                console.log(`   - ${value.market || "Unknown"} (${value.side}) at ${value.timestamp}`);
            });
        }
        
        console.log("\n═".repeat(70));
        
    } catch (error) {
        console.log("Could not read history file");
    }
    
    // Ask for confirmation (auto-confirm in script)
    console.log("\n⚠️  This will delete all trade history!");
    console.log("   The bot will be able to copy trades again for previously traded markets.");
    console.log("\n   Deleting in 3 seconds... (Press Ctrl+C to cancel)");
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Delete the file
    try {
        unlinkSync(HISTORY_FILE);
        console.log("\n✅ Trade history cleared!");
        console.log("   Bot will now copy all trades (including previously traded markets)");
        console.log("   Restart the bot to start fresh");
    } catch (error) {
        console.log("Failed to delete history file", error);
        process.exit(1);
    }
    
    console.log("\n═".repeat(70));
}

main().catch((error) => {
    console.log("Error", error);
    process.exit(1);
});

