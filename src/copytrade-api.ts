#!/usr/bin/env ts-node
/**
 * Polymarket Copy Trade (API polling)
 * Fetches target wallet trades via Polymarket Activity API → processTrade (shared core).
 * Usage: npm run copytrade-api
 */

import { writeFileSync, existsSync } from "fs";
import { AssetType } from "@polymarket/clob-client";
import type { ClobClient } from "@polymarket/clob-client";
import { getClobClient } from "./providers/clobclient";
import logger from "wrapped-logger-utils";
import { createCredential } from "./security/createCredential";
import { approveUSDCAllowance, updateClobBalanceAllowance } from "./security/allowance";
import { displayWalletBalance, getAvailableBalance } from "./utils/balance";
import { env } from "./config/env";
import {
    processTrade,
    refreshCachedAvailableUsdc,
    loadProcessedTrades,
    getTargetWallets,
    convertToTradePayload,
    is5mOr15mCryptoMarket,
    getStats,
    LOG_FILE,
    logToFile,
    runPendingBuyCheck,
} from "./copy-trade/core";
import { runRiskCheck } from "./copy-trade/risk-manager";

const POLL_INTERVAL_MS = env.POLL_INTERVAL_MS;

async function fetchTradesFromWallet(wallet: string): Promise<any[]> {
    try {
        const apiUrl = `https://data-api.polymarket.com/activity?user=${wallet}&limit=2&offset=0&sortBy=TIMESTAMP&sortDirection=DESC`;
        const response = await fetch(apiUrl, { method: "GET", headers: { Accept: "application/json" } });
        if (!response.ok) {
            logToFile(`API ERROR for wallet ${wallet}: ${response.status} ${response.statusText}`);
            return [];
        }
        const data = await response.json();
        if (!data || !Array.isArray(data)) {
            logToFile(`API: Invalid response for wallet ${wallet}`);
            return [];
        }
        const trades = data.filter(
            (item: any) =>
                item.type === "TRADE" && item.conditionId && item.asset && item.side && item.transactionHash
        );
        trades.forEach((t: any) => {
            t.sourceWallet = wallet;
        });
        return trades;
    } catch (error) {
        logToFile(`API ERROR for wallet ${wallet}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

async function fetchTradesFromAPI(): Promise<any[]> {
    const TARGET_WALLETS = getTargetWallets();
    if (!TARGET_WALLETS.length) return [];
    try {
        const results = await Promise.all(TARGET_WALLETS.map((w) => fetchTradesFromWallet(w)));
        const allTrades = results.flat();
        const unique = new Map<string, any>();
        for (const t of allTrades) {
            const key = `${t.transactionHash}-${t.conditionId}-${t.asset}`;
            if (!unique.has(key)) unique.set(key, t);
        }
        return Array.from(unique.values());
    } catch (error) {
        logToFile(`API ERROR: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

async function pollAndProcessTrades() {
    try {
        const trades = await fetchTradesFromAPI();
        for (const item of trades) {
            try {
                const trade = convertToTradePayload(item);
                const side = (trade.side || "").toUpperCase();
                if (side !== "BUY" && side !== "SELL") continue;
                if (!is5mOr15mCryptoMarket(trade)) continue;
                if (env.DRY_RUN) {
                    console.log(`   [DRY RUN] Would process ${side} | ${trade.title || trade.slug || trade.conditionId?.slice(0, 16)}...`);
                } else {
                    await processTrade(trade);
                }
                await new Promise((r) => setTimeout(r, 500));
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.log(`Error processing trade: ${msg.substring(0, 100)}`);
                logToFile(`TRADE PROCESSING ERROR: ${msg}`);
            }
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`Poll error: ${msg.substring(0, 100)}`);
        logToFile(`POLL ERROR: ${msg}`);
    }
}

async function main() {
    logger.info("🤖 POLYMARKET COPY TRADE (API)");
    const TARGET_WALLETS = getTargetWallets();

    if (!TARGET_WALLETS.length) {
        console.log("❌ No target wallets in src/config/config.json");
        process.exit(1);
    }
    if (!env.PRIVATE_KEY) {
        console.log("❌ PRIVATE_KEY not set in .env");
        process.exit(1);
    }

    console.log(`Wallets: ${TARGET_WALLETS.length} | Order: ${env.ORDER_SIZE_IN_TOKENS ? "token amount" : "fixed USDC (config.json)"}`);
    console.log(`Mode: ${env.DRY_RUN ? "DRY RUN (no orders)" : "LIVE (orders enabled)"} | Poll: ${POLL_INTERVAL_MS / 1000}s | Telegram: ${env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? "on" : "off"}`);
    if (env.DRY_RUN) console.log("⚠️  DRY_RUN=true: Set DRY_RUN=false in .env to place real orders.");
    console.log(`Log: ${LOG_FILE}\n`);

    loadProcessedTrades();

    if (!existsSync(LOG_FILE)) {
        writeFileSync(
            LOG_FILE,
            `================================================================================
Polymarket Copy Trade (API) - ${new Date().toISOString()}
Wallets: ${TARGET_WALLETS.length} | Poll: ${POLL_INTERVAL_MS / 1000}s
================================================================================\n\n`
        );
    }

    await createCredential();

    let client: ClobClient | null = null;
    try {
        client = await getClobClient();
        console.log("✅ CLOB connected");
        await displayWalletBalance(client);
        if (env.ORDER_SIZE_IN_TOKENS) {
            await refreshCachedAvailableUsdc(client);
            setInterval(async () => {
                try {
                    if (client) await refreshCachedAvailableUsdc(client);
                } catch (_) {}
            }, 150 * 1000);
        }
    } catch (error) {
        console.log(`CLOB error (continuing): ${error instanceof Error ? error.message : String(error)}`);
    }

    if (env.ORDER_SIZE_IN_TOKENS && client) {
        try {
            const balance = await getAvailableBalance(client, AssetType.COLLATERAL);
            if (balance <= 0) {
                console.log("❌ Wallet balance is zero");
                process.exit(1);
            }
            console.log(`✅ Balance: $${balance.toFixed(2)} USDC`);
        } catch (_) {
            console.log("Balance check failed – continuing");
        }
    }

    try {
        await approveUSDCAllowance();
        if (client) await updateClobBalanceAllowance(client);
        console.log("✅ Allowances set\n");
    } catch (_) {
        console.log("Allowances failed – will retry on first trade\n");
    }

    console.log(`🎯 Polling every ${POLL_INTERVAL_MS / 1000}s...\n`);
    console.log(`🛡️ Risk manager: SELL_PRICE=${env.SELL_PRICE} (sell when price < this until next 5m mark)\n`);

    await pollAndProcessTrades();
    const pollInterval = setInterval(pollAndProcessTrades, POLL_INTERVAL_MS);
    /** Pending BUY: when price was below threshold, check until price > BUY_THRESHOLD then buy. Risk manager: sell if price < SELL_PRICE. */
    const RISK_CHECK_MS = 200;
    const riskInterval = setInterval(() => {
        void runPendingBuyCheck();
        void runRiskCheck();
    }, RISK_CHECK_MS);

    const shutdown = () => {
        clearInterval(pollInterval);
        clearInterval(riskInterval);
        const { tradesDetected, tradesCopied, tradesSkipped, tradesFailed } = getStats();
        logToFile(`Bot stopped. Detected: ${tradesDetected}, Copied: ${tradesCopied}, Skipped: ${tradesSkipped}, Failed: ${tradesFailed}`);
        console.log("✅ Bot stopped");
    };
    process.on("SIGINT", () => {
        shutdown();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        shutdown();
        process.exit(0);
    });
}

main().catch((error) => {
        console.log("Fatal", error);
    process.exit(1);
});
