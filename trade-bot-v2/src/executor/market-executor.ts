/**
 * Executor layer: market buy, market sell, and limit sell (e.g. at 0.97).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Chain, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { config } from "../config";
import type { MarketInfo } from "../types";

let client: ClobClient | null = null;

/** Get or create CLOB client (for approve and orders). */
export function getClobClient(): ClobClient {
  return getClient();
}

function getClient(): ClobClient {
  if (client) return client;
  if (!config.PRIVATE_KEY) throw new Error("PRIVATE_KEY required");
  let credPath = resolve(process.cwd(), config.CREDENTIAL_PATH);
  if (!existsSync(credPath)) credPath = resolve(process.cwd(), "../src/data/credential.json");
  if (!existsSync(credPath)) throw new Error(`Credential not found. Set CREDENTIAL_PATH or run from repo root.`);
  const creds = JSON.parse(readFileSync(credPath, "utf-8")) as { key: string; secret: string; passphrase: string };
  const secretBase64 = creds.secret.replace(/-/g, "+").replace(/_/g, "/");
  const wallet = new Wallet(config.PRIVATE_KEY);
  client = new ClobClient(
    config.CLOB_HOST,
    config.CHAIN_ID as Chain,
    wallet,
    { key: creds.key, secret: secretBase64, passphrase: creds.passphrase },
    2,
    config.PROXY_WALLET || undefined
  );
  return client;
}

function clampPrice(p: number): number {
  const t = parseFloat(config.TICK_SIZE);
  return Math.max(t, Math.min(1 - t, p));
}

/**
 * Market buy. amountUsd = shares * bestAsk at call time (caller should pass price from price stream).
 */
export async function marketBuy(
  tokenId: string,
  shares: number,
  priceFromStream: number,
  _marketInfo?: MarketInfo
): Promise<{ ok: boolean; filledShares?: number }> {
  if (!config.ENABLE_TRADING) return { ok: false };
  const c = getClient();
  const amountUsd = shares * priceFromStream;
  const price = clampPrice(Math.min(priceFromStream * 1.01, 0.9));
  const order = {
    tokenID: tokenId,
    side: Side.BUY,
    amount: amountUsd,
    price,
  };
  
  if(!config.ENABLE_ML_BUY)
  {
    return { ok: true, filledShares: shares };
  }

  const res: any = await c.createAndPostMarketOrder(
    order,
    { tickSize: config.TICK_SIZE, negRisk: config.NEG_RISK },
    OrderType.FAK as import("@polymarket/clob-client").OrderType.FAK
  );
  const ok = res && (res.status === "FILLED" || res.status === "PARTIALLY_FILLED" || res.status === "matched" || res.status === "MATCHED" || !res.status);
  if (!ok) return { ok: false };
  let filled = res.takingAmount ? parseFloat(res.takingAmount) : shares;
  if (filled >= 1e6) filled /= 1e6;
  return { ok: true, filledShares: filled };
}

/**
 * Market sell. size = shares (tokens).
 */
export async function marketSell(
  tokenId: string,
  shares: number,
  priceFromStream: number
): Promise<{ ok: boolean; filledShares?: number }> {
  if (!config.ENABLE_TRADING) return { ok: false };
  const c = getClient();
  const price = clampPrice(Math.max(priceFromStream * 0.98, parseFloat(config.TICK_SIZE)));
  const order = {
    tokenID: tokenId,
    side: Side.SELL,
    amount: shares,
    price,
  };
  const res: any = await c.createAndPostMarketOrder(
    order,
    { tickSize: config.TICK_SIZE, negRisk: config.NEG_RISK },
    OrderType.FAK as import("@polymarket/clob-client").OrderType.FAK
  );
  const ok = res && (res.status === "FILLED" || res.status === "PARTIALLY_FILLED" || res.status === "matched" || res.status === "MATCHED" || !res.status);
  if (!ok) return { ok: false };
  let filled = res.makingAmount ? parseFloat(res.makingAmount) : shares;
  if (filled >= 1e6) filled /= 1e6;
  return { ok: true, filledShares: filled };
}

/** Limit sell: post a GTC limit order at the given price (e.g. 0.97) for all shares. */
export async function limitSell(
  tokenId: string,
  shares: number,
  price: number
): Promise<{ ok: boolean; orderId?: string }> {
  if (!config.ENABLE_TRADING) return { ok: false };
  const c = getClient();
  const p = clampPrice(price);
  const order = {
    tokenID: tokenId,
    side: Side.SELL,
    size: shares,
    price: p,
  };
  const res: any = await c.createAndPostOrder(
    order,
    { tickSize: config.TICK_SIZE, negRisk: config.NEG_RISK },
    OrderType.GTC
  );
  const ok = res && (res.orderID || res.id || res.status !== undefined);
  return { ok: !!ok, orderId: res?.orderID ?? res?.id };
}

/** Cancel a single order by ID (e.g. limit sell). Avoids conflict with profit-lock market sells. */
export async function cancelOrder(orderId: string): Promise<{ ok: boolean }> {
  if (!orderId) return { ok: false };
  try {
    const c = getClient();
    const res: any = await c.cancelOrder({ orderID: orderId });
    const canceled = res?.canceled && Array.isArray(res.canceled) && res.canceled.includes(orderId);
    return { ok: !!canceled };
  } catch {
    return { ok: false };
  }
}
