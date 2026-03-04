import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

interface WalletTradeData {
  wallet: string;
  totalBuyUsd: number;
  buyUpUsd: number;
  buyDownUsd: number;
  buyUpCount: number;
  buyDownCount: number;
  lastBuyTime?: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private connected = false;

  async onModuleInit() {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD || undefined;
      this.client = createClient({
        socket: { host, port },
        password: password || undefined,
      }) as RedisClientType;
      await this.client.connect();
      this.connected = true;
    } catch {
      this.connected = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  isConnected(): boolean {
    return this.connected && !!this.client;
  }

  private marketKey(conditionId: string): string {
    return `market:${conditionId}:wallets`;
  }

  private btcOpenKey(conditionId: string): string {
    return `market:${conditionId}:btc_open`;
  }

  async getMarketWallets(conditionId: string): Promise<WalletTradeData[]> {
    if (!this.client) return [];
    const key = this.marketKey(conditionId);
    const all = await this.client.hGetAll(key);
    return Object.values(all).map((v) => JSON.parse(v) as WalletTradeData);
  }

  async getBtcOpen(conditionId: string): Promise<number | null> {
    if (!this.client) return null;
    const val = await this.client.get(this.btcOpenKey(conditionId));
    if (val == null) return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  async setBtcOpen(conditionId: string, btcPriceUsd: number): Promise<void> {
    if (!this.client) return;
    await this.client.set(this.btcOpenKey(conditionId), String(btcPriceUsd), { EX: 86400 * 2 });
  }

  async listActiveMarkets(): Promise<string[]> {
    if (!this.client) return [];
    const keys = await this.client.keys('market:*:wallets');
    return keys.map((k) => k.replace('market:', '').replace(':wallets', ''));
  }
}
