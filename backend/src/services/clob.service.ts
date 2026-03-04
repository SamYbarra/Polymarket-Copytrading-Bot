import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Chain, ClobClient } from '@polymarket/clob-client';
import type { ApiKeyCreds, OpenOrder } from '@polymarket/clob-client';
import { AssetType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';

const CLOB_DECIMALS = 6;

function parseClobAmount(value: string | undefined): number {
  if (!value || !value.trim()) return 0;
  const n = parseFloat(value.trim());
  if (Number.isNaN(n)) return 0;
  if (value.includes('.')) return n;
  return n / Math.pow(10, CLOB_DECIMALS);
}

export interface WalletBalanceDto {
  balanceUsd: number;
  allowanceUsd: number;
  availableUsd: number;
}

export interface MyOrderDto {
  id: string;
  side: string;
  outcome: string;
  price: number;
  size: number;
  sizeMatched: number;
  amountUsd: number;
  createdAt: number;
}

@Injectable()
export class ClobService {
  private client: ClobClient | null = null;
  private initAttempted = false;

  private getClient(): ClobClient | null {
    if (this.initAttempted) return this.client;
    this.initAttempted = true;
    const privateKey = (process.env.PRIVATE_KEY ?? '').trim();
    if (!privateKey) return null;
    let creds: ApiKeyCreds;
    const key = process.env.POLY_API_KEY ?? process.env.POLY_API_KEY_CREDENTIAL;
    const secret = process.env.POLY_API_SECRET ?? process.env.POLY_API_SECRET_CREDENTIAL;
    const passphrase = process.env.POLY_API_PASSPHRASE ?? process.env.POLY_API_PASSPHRASE_CREDENTIAL;
    if (key && secret && passphrase) {
      const secretBase64 = secret.replace(/-/g, '+').replace(/_/g, '/');
      creds = { key, secret: secretBase64, passphrase };
    } else {
      // Default: project root src/data/credential.json (same as tracker), relative to backend dist
      const projectRoot = resolve(__dirname, '..', '..', '..');
      const defaultCredentialPath = resolve(projectRoot, 'src', 'data', 'credential.json');
      const credentialPath = process.env.CREDENTIAL_PATH || defaultCredentialPath;
      if (!existsSync(credentialPath)) return null;
      try {
        const raw = JSON.parse(readFileSync(credentialPath, 'utf-8'));
        const secretBase64 = (raw.secret ?? '').replace(/-/g, '+').replace(/_/g, '/');
        creds = { key: raw.key, secret: secretBase64, passphrase: raw.passphrase };
      } catch {
        return null;
      }
    }
    try {
      const chainId = parseInt(process.env.CHAIN_ID ?? '137', 10) as Chain;
      const host = (process.env.CLOB_API_URL ?? 'https://clob.polymarket.com').replace(/\/$/, '');
      const wallet = new Wallet(privateKey);
      const proxyWalletAddress = (process.env.PROXY_WALLET_ADDRESS ?? '').trim();
      this.client = new ClobClient(host, chainId, wallet, creds, 2, proxyWalletAddress || undefined);
      return this.client;
    } catch {
      return null;
    }
  }

  async getWalletBalance(): Promise<WalletBalanceDto | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const res = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      const balanceUsd = parseClobAmount(res.balance);
      const allowanceUsd = parseClobAmount(res.allowance);
      const availableUsd = Math.max(0, Math.min(balanceUsd, allowanceUsd));
      return {
        balanceUsd: Math.max(0, balanceUsd),
        allowanceUsd: Math.max(0, allowanceUsd),
        availableUsd,
      };
    } catch {
      return null;
    }
  }

  async getOpenOrdersForMarket(conditionId: string): Promise<MyOrderDto[]> {
    const client = this.getClient();
    if (!client || !conditionId) return [];
    try {
      const orders = await client.getOpenOrders({ market: conditionId }, true);
      const data = Array.isArray(orders) ? orders : [];
      return data.map((o: OpenOrder) => {
        const originalSize = parseClobAmount(o.original_size);
        const sizeMatched = parseClobAmount(o.size_matched);
        const size = Math.max(0, originalSize - sizeMatched);
        const price = parseFloat(String(o.price ?? 0)) || 0;
        return {
          id: o.id,
          side: o.side,
          outcome: o.outcome,
          price,
          size,
          sizeMatched,
          amountUsd: size * price,
          createdAt: o.created_at,
        };
      });
    } catch {
      return [];
    }
  }
}
