#!/usr/bin/env ts-node
/**
 * Polymarket Wallet Monitor
 * 
 * Monitors a target wallet and displays their trading activity in real-time
 * - Shows what markets they trade
 * - Shows which tokens they buy/sell
 * - Shows amounts and prices
 * - Does NOT copy trades (watch-only mode)
 * 
 * Usage:
 *   ts-node src/monitor-wallet.ts
 *   bun src/monitor-wallet.ts
 */

import { resolve } from "path";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import type { Message } from "@polymarket/real-time-data-client";
import type { TradePayload } from "../utils/types";
import { env } from "../config/env";

// Setup log directory and file
const LOG_DIR = resolve(process.cwd(), "log");
const LOG_FILE = resolve(LOG_DIR, "monitor.log");

// Create log directory if it doesn't exist
if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log to file with timestamp
 */
function logToFile(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    appendFileSync(LOG_FILE, logEntry);
}

/**
 * Log trade details to file
 */
function logTradeToFile(trade: TradePayload, tradeNumber: number) {
    const side = trade.side.toUpperCase();
    const timestamp = new Date(trade.timestamp * 1000).toISOString();
    const totalAmount = (trade.price * trade.size).toFixed(2);
    
    const logEntry = `
${"=".repeat(80)}
TRADE #${tradeNumber} - ${side}
${"=".repeat(80)}
Timestamp: ${timestamp}
Market: ${trade.title || "N/A"}
Outcome: ${trade.outcome || "N/A"}
Side: ${side}
Price: $${trade.price.toFixed(4)}
Size: ${trade.size.toFixed(2)} tokens
Total: $${totalAmount} USDC
Token ID: ${trade.asset}
Condition ID: ${trade.conditionId}
Transaction: ${trade.transactionHash}
Polygonscan: https://polygonscan.com/tx/${trade.transactionHash}
${"=".repeat(80)}

`;
    
    appendFileSync(LOG_FILE, logEntry);
}

// Configuration
const TARGET_WALLET = "0xfdb826a0fb4a90b4cc9049e408ea3ef1b73ae4c9";
const WS_HOST = env.USER_REAL_TIME_DATA_URL;

// Initialize log file with header
const logHeader = `
${"=".repeat(80)}
Polymarket Wallet Monitor - Log File
Started: ${new Date().toISOString()}
Target Wallet: ${TARGET_WALLET}
${"=".repeat(80)}

`;
writeFileSync(LOG_FILE, logHeader);

// Statistics
let tradesDetected = 0;
let startTime = Date.now();

/**
 * Display trade information
 */
function displayTrade(trade: TradePayload) {
    tradesDetected++;
    
    const side = trade.side.toUpperCase();
    const sideEmoji = side === "BUY" ? "🟢" : "🔴";
    const timestamp = new Date(trade.timestamp * 1000).toLocaleString();
    
    // Log to file
    logTradeToFile(trade, tradesDetected);
    
    console.log("\n" + "═".repeat(70));
    console.log(`${sideEmoji} TRADE #${tradesDetected} DETECTED FROM TARGET WALLET`);
    console.log("═".repeat(70));
    
    // Market Information
    console.log("📊 MARKET INFORMATION:");
    console.log(`   Title: ${trade.title || "N/A"}`);
    console.log(`   Slug: ${trade.slug || "N/A"}`);
    console.log(`   Outcome: ${trade.outcome || "N/A"}`);
    if (trade.eventSlug) {
        console.log(`   Event: ${trade.eventSlug}`);
    }
    
    // Trade Details
    console.log("\n💰 TRADE DETAILS:");
    console.log(`   Side: ${side} ${sideEmoji}`);
    console.log(`   Price: $${trade.price.toFixed(4)}`);
    console.log(`   Size: ${trade.size.toFixed(2)} tokens`);
    
    if (side === "BUY") {
        const totalCost = trade.price * trade.size;
        console.log(`   Total Cost: $${totalCost.toFixed(2)} USDC`);
    } else {
        const totalReceived = trade.price * trade.size;
        console.log(`   Total Received: $${totalReceived.toFixed(2)} USDC`);
    }
    
    // Token Information
    console.log("\n🎫 TOKEN INFORMATION:");
    console.log(`   Token ID: ${trade.asset}`);
    console.log(`   Condition ID: ${trade.conditionId}`);
    console.log(`   Outcome Index: ${trade.outcomeIndex}`);
    
    // Transaction Details
    console.log("\n⛓️  BLOCKCHAIN:");
    console.log(`   Transaction: ${trade.transactionHash}`);
    console.log(`   Time: ${timestamp}`);
    console.log(`   View: https://polygonscan.com/tx/${trade.transactionHash}`);
    
    // Summary
    const action = side === "BUY" ? "bought" : "sold";
    console.log(`\n📌 SUMMARY: Target wallet ${action} ${trade.size.toFixed(2)} tokens of "${trade.outcome}" at $${trade.price.toFixed(4)} each`);
    console.log(`💾 Logged to: ${LOG_FILE}`);
    console.log("═".repeat(70) + "\n");
}

/**
 * Display statistics
 */
function displayStats() {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    console.log("\n" + "─".repeat(70));
    console.log("📊 MONITORING STATISTICS");
    console.log("─".repeat(70));
    console.log(`   Trades Detected: ${tradesDetected}`);
    console.log(`   Uptime: ${hours}h ${minutes}m ${seconds}s`);
    console.log(`   Target Wallet: ${TARGET_WALLET?.substring(0, 10)}...${TARGET_WALLET?.substring(TARGET_WALLET.length - 8)}`);
    console.log("─".repeat(70) + "\n");
}

/**
 * Main function
 */
async function main() {
    console.log("👁️  POLYMARKET WALLET MONITOR");
    console.log("\n" + "═".repeat(70));
    console.log("CONFIGURATION");
    console.log("═".repeat(70));
    
    // Validate configuration
    if (!TARGET_WALLET) {
        console.log("❌ TARGET_WALLET not set in .env file");
        console.log("\nPlease add to .env:");
        console.log("  TARGET_WALLET=0x...");
        process.exit(1);
    }
    
    console.log(`Target Wallet: ${TARGET_WALLET}`);
    console.log(`WebSocket Host: ${WS_HOST}`);
    console.log(`Mode: WATCH ONLY (no trades will be executed)`);
    console.log(`Log File: ${LOG_FILE}`);
    console.log("═".repeat(70) + "\n");
    
    // Connect to WebSocket
    console.log("🌐 Connecting to Polymarket WebSocket...\n");
    
    const wsClient = new RealTimeDataClient({
        host: WS_HOST,
        pingInterval: 5000,
        onConnect: (client) => {
            console.log("✅ Connected to WebSocket!");
            console.log("📡 Subscribing to trade activity feed...\n");
            
            client.subscribe({
                subscriptions: [
                    {
                        topic: "activity",
                        type: "trades"
                    }
                ]
            });
            
            console.log("✅ Subscribed successfully!");
            console.log("\n👁️  MONITORING TARGET WALLET...");
            console.log(`Target: ${TARGET_WALLET}\n`);
            console.log("⏳ Waiting for trades from target wallet...");
            console.log("   (Trades will appear below when detected)\n");
        },
        onMessage: async (client, message: Message) => {
            // Only process trade messages
            if (message.topic !== "activity" || message.type !== "trades") {
                return;
            }
            
            const payload = message.payload as TradePayload;
            
            // Check if trade is from target wallet
            const traderWallet = payload.proxyWallet?.toLowerCase() || 
                                payload.wallet?.toLowerCase() || 
                                payload.user?.toLowerCase() ||
                                payload.address?.toLowerCase() ||
                                payload.userAddress?.toLowerCase();
            
            if (traderWallet === TARGET_WALLET.toLowerCase()) {
                displayTrade(payload);
            }
        }
    });
    
    // Connect
    wsClient.connect();
    
    // Display stats every 5 minutes
    setInterval(displayStats, 5 * 60 * 1000);
    
    // Keep process alive
    console.log("✅ Monitor is now running!");
    console.log("Press Ctrl+C to stop\n");
    
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n\n🛑 Stopping monitor...");
        displayStats();
        
        // Log shutdown to file
        logToFile(`Monitor stopped. Total trades detected: ${tradesDetected}`);
        logToFile("=".repeat(80) + "\n");
        
        wsClient.disconnect();
        console.log("✅ Monitor stopped");
        console.log(`📄 Log file: ${LOG_FILE}`);
        process.exit(0);
    });
    
    process.on("SIGTERM", () => {
        console.log("\n\n🛑 Stopping monitor...");
        displayStats();
        
        // Log shutdown to file
        logToFile(`Monitor stopped. Total trades detected: ${tradesDetected}`);
        logToFile("=".repeat(80) + "\n");
        
        wsClient.disconnect();
        console.log("✅ Monitor stopped");
        console.log(`📄 Log file: ${LOG_FILE}`);
        process.exit(0);
    });
}

// Run the monitor
main().catch((error) => {
    console.log("\n💥 FATAL ERROR");
    console.log("═".repeat(70));
    console.log(error instanceof Error ? error.message : String(error));
    console.log("═".repeat(70));
    process.exit(1);
});


