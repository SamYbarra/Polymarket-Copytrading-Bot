/**
 * Executor: GTC limit buy at 0.45, market sell, get order status, cancel.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Chain, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { config } from "../config";

let client: ClobClient | null = null;

export function getClobClient(): ClobClient {
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

/** GTC limit buy (no expiration). Rests on book until filled or cancelled. */
export async function limitBuyGTC(
  tokenId: string,
  amountUsd: number,
  price: number
): Promise<{ ok: boolean; orderId?: string }> {
  if (!config.ENABLE_TRADING) return { ok: false };
  const c = getClobClient();
  const p = clampPrice(price);
  const size = Math.round((amountUsd / p) * 100) / 100;
  const order = {
    tokenID: tokenId,
    side: Side.BUY,
    size,
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

/** Get order by ID. Returns null if not found (expired/cancelled/filled). */
export async function getOrder(orderId: string): Promise<{
  status: string;
  original_size: string;
  size_matched: string;
  asset_id: string;
  side: string;
} | null> {
  try {
    const c = getClobClient();
    const order = await c.getOrder(orderId);
    if (!order) return null;
    return {
      status: order.status ?? "",
      original_size: (order as any).original_size ?? "0",
      size_matched: (order as any).size_matched ?? "0",
      asset_id: (order as any).asset_id ?? "",
      side: (order as any).side ?? "",
    };
  } catch {
    return null;
  }
}

/** Market sell. */
export async function marketSell(
  tokenId: string,
  shares: number,
  priceFromStream: number
): Promise<{ ok: boolean; filledShares?: number }> {
  if (!config.ENABLE_TRADING) return { ok: false };
  const c = getClobClient();
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

export async function cancelOrder(orderId: string): Promise<{ ok: boolean }> {
  if (!orderId) return { ok: false };
  try {
    const c = getClobClient();
    const res: any = await c.cancelOrder({ orderID: orderId });
    const canceled = res?.canceled && Array.isArray(res.canceled) && res.canceled.includes(orderId);
    return { ok: !!canceled };
  } catch {
    return { ok: false };
  }
}
