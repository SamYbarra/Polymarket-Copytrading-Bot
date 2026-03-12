/**
 * Fire-and-forget Telegram notifications for target wallet trades.
 * Never blocks or affects bot performance – notifications run asynchronously.
 */

import { env } from "../config/env";

/** Polymarket Polyscan base URL for transaction links */
const POLYSCAN_TX = "https://polygonscan.com/tx/";

/** Throttle: at most one notification per target wallet per 5 minutes (no repeat alerts from same wallet) */
const TELEGRAM_THROTTLE_MS = 5 * 60 * 1000;
const lastSentByWallet = new Map<string, number>();

/** Trade payload from API or WebSocket (partial – only used fields) */
export interface TradePayloadForTelegram {
    side?: string;
    price?: number;
    size?: number;
    title?: string;
    slug?: string;
    outcome?: string;
    transactionHash?: string;
    proxyWallet?: string;
    sourceWallet?: string;
    eventSlug?: string;
    timestamp?: number;
}

/**
 * Send a Telegram message (fire-and-forget). Never blocks or throws.
 * Caller should never await – use: notifyTelegramTargetTrade(trade);
 */
function sendTelegramMessage(text: string): void {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
    });

    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    }).catch(() => {
        /* swallow – never affect main flow */
    });
}

/**
 * Notify Telegram when a target wallet trade is detected.
 * Throttled per target wallet: at most one alert per wallet per 5 minutes (no repeated alerts from same wallet).
 * Fire-and-forget: does not block or affect bot speed.
 * Call as: notifyTelegramTargetTrade(trade);  (no await)
 */
export function notifyTelegramTargetTrade(trade: TradePayloadForTelegram): void {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

    const wallet = (trade.sourceWallet || trade.proxyWallet || "").toLowerCase();
    if (!wallet) return;

    const now = Date.now();
    const lastSent = lastSentByWallet.get(wallet) ?? 0;
    if (now - lastSent < TELEGRAM_THROTTLE_MS) return;
    lastSentByWallet.set(wallet, now);

    const side = (trade.side || "").toUpperCase();
    const sideEmoji = side === "BUY" ? "🟢" : "🔴";
    const title = trade.title || trade.slug || trade.eventSlug || "Unknown";
    const outcome = trade.outcome || "—";
    const price = typeof trade.price === "number" ? trade.price.toFixed(4) : "—";
    const size = typeof trade.size === "number" ? trade.size.toFixed(2) : "—";
    const walletDisplay = trade.sourceWallet || trade.proxyWallet || "—";
    const txHash = trade.transactionHash || "";
    const txLink = txHash ? `${POLYSCAN_TX}${txHash}` : "";
    const ts = trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : new Date().toISOString();

    const lines = [
        `${sideEmoji} <b>Target Trade ${side}</b>`,
        ``,
        `<b>Market:</b> ${escapeHtml(title)}`,
        `<b>Outcome:</b> ${escapeHtml(outcome)}`,
        `<b>Price:</b> $${price} | <b>Size:</b> ${size}`,
        `<b>Wallet:</b> <code>${escapeHtml(walletDisplay)}</code>`,
        txLink ? `<b>TX:</b> <a href="${txLink}">${txHash.substring(0, 16)}...</a>` : "",
        `<b>Time:</b> ${ts}`,
    ].filter(Boolean);

    sendTelegramMessage(lines.join("\n"));
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
