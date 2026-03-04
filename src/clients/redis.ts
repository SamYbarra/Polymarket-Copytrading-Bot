/**
 * Redis client for storing wallet trade data per market
 */

import { createClient } from "redis";
import type { WalletTradeData } from "../types";

export class RedisClient {
  private client: ReturnType<typeof createClient> | null = null;

  async connect(): Promise<void> {
    const host = process.env.REDIS_HOST || "localhost";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD || undefined;

    this.client = createClient({
      socket: { host, port },
      password,
    });

    this.client.on("error", (err) => {
      const ts = () => new Date().toISOString();
      console.error(`${ts()} ✗ Redis`);
      if (err !== undefined) console.error(err);
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  private marketKey(conditionId: string): string {
    return `market:${conditionId}:wallets`;
  }

  private currentHotWalletKey(conditionId: string): string {
    return `market:${conditionId}:current_hot_wallet`;
  }

  private btcOpenKey(conditionId: string): string {
    return `market:${conditionId}:btc_open`;
  }

  async setBtcOpen(conditionId: string, btcPriceUsd: number): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");
    const key = this.btcOpenKey(conditionId);
    await this.client.set(key, String(btcPriceUsd), { EX: 3600 });
  }

  async getBtcOpen(conditionId: string): Promise<number | null> {
    if (!this.client) throw new Error("Redis not connected");
    const key = this.btcOpenKey(conditionId);
    const val = await this.client.get(key);
    if (val == null) return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  async updateWalletTrade(
    conditionId: string,
    wallet: string,
    buyUsd: number,
    isUp: boolean,
    timestamp?: number
  ): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");

    const key = this.marketKey(conditionId);
    const dataStr = await this.client.hGet(key, wallet);
    const lastBuyTime = timestamp ?? Math.floor(Date.now() / 1000);
    let data: WalletTradeData;

    if (dataStr) {
      data = JSON.parse(dataStr);
      data.totalBuyUsd += buyUsd;
      if (isUp) {
        data.buyUpCount++;
        data.buyUpUsd += buyUsd;
      } else {
        data.buyDownCount++;
        data.buyDownUsd += buyUsd;
      }
      data.lastBuyTime = lastBuyTime;
    } else {
      data = {
        wallet,
        totalBuyUsd: buyUsd,
        buyUpCount: isUp ? 1 : 0,
        buyDownCount: isUp ? 0 : 1,
        buyUpUsd: isUp ? buyUsd : 0,
        buyDownUsd: isUp ? 0 : buyUsd,
        lastBuyTime,
      };
    }

    await this.client.hSet(key, wallet, JSON.stringify(data));
  }

  async getMarketWallets(conditionId: string): Promise<WalletTradeData[]> {
    if (!this.client) throw new Error("Redis not connected");
    const key = this.marketKey(conditionId);
    const all = await this.client.hGetAll(key);
    return Object.values(all).map((v) => JSON.parse(v));
  }

  /** Replace all wallet state for a market (e.g. after syncing from Data API positions). */
  async setMarketWallets(conditionId: string, wallets: WalletTradeData[]): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");
    const key = this.marketKey(conditionId);
    await this.client.del(key);
    if (wallets.length === 0) return;
    const fields = wallets.map((w) => ({ field: w.wallet, value: JSON.stringify(w) }));
    await this.client.hSet(key, Object.fromEntries(fields.map((f) => [f.field, f.value])));
  }

  async setProxyWalletBalanceUsd(value: number): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");
    await this.client.set("proxy_wallet_balance_usd", String(value), { EX: 120 });
  }

  async getProxyWalletBalanceUsd(): Promise<number | null> {
    if (!this.client) throw new Error("Redis not connected");
    const val = await this.client.get("proxy_wallet_balance_usd");
    if (val == null) return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  async deleteMarket(conditionId: string): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");
    const key = this.marketKey(conditionId);
    const hotKey = this.currentHotWalletKey(conditionId);
    const btcKey = this.btcOpenKey(conditionId);
    await this.client.del([key, hotKey, btcKey]);
  }

  async listActiveMarkets(): Promise<string[]> {
    if (!this.client) throw new Error("Redis not connected");
    const keys = await this.client.keys("market:*:wallets");
    return keys.map((k) => k.replace("market:", "").replace(":wallets", ""));
  }

  /** Realtime bot: store latest market features JSON (TTL 120s). */
  async setRealtimeFeatures(conditionId: string, json: string): Promise<void> {
    if (!this.client) throw new Error("Redis not connected");
    console.log("setRealtimeFeatures are called ", conditionId+" "+JSON.stringify(json));
    await this.client.set(`realtime:features:${conditionId}`, json, { EX: 120 });
  }

  /** Realtime bot: read latest market features. */
  async getRealtimeFeatures(conditionId: string): Promise<string | null> {
    if (!this.client) throw new Error("Redis not connected");
    return this.client.get(`realtime:features:${conditionId}`);
  }
}
