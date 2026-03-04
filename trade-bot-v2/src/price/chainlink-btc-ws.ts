/**
 * Chainlink Data Streams WebSocket: real-time BTC/USD price for velocity sampler.
 * Uses @chainlink/data-streams-sdk; no Binance. Requires CHAINLINK_DS_* env.
 */

import { createClient, decodeReport } from "@chainlink/data-streams-sdk";
import { config } from "../config";

const PRICE_DECIMALS = 18;

export type ChainlinkBtcPriceCallback = (ts: number, price: number) => void;

/**
 * Connects to Chainlink Data Streams WebSocket, decodes BTC/USD reports,
 * and invokes onPrice(ts, price) on each report. Call close() to disconnect.
 */
export class ChainlinkBtcPriceStream {
  private stream: ReturnType<ReturnType<typeof createClient>["createStream"]> | null = null;
  private client: ReturnType<typeof createClient> | null = null;
  private callback: ChainlinkBtcPriceCallback | null = null;

  constructor(private readonly onPrice: ChainlinkBtcPriceCallback) {
    this.callback = onPrice;
  }

  async connect(): Promise<void> {
    const feedId = config.CHAINLINK_DS_FEED_ID_BTC_USD;
    const apiKey = config.CHAINLINK_DS_API_KEY;
    const userSecret = config.CHAINLINK_DS_USER_SECRET;
    if (!feedId || !apiKey || !userSecret) {
      throw new Error("Chainlink DS: set CHAINLINK_DS_FEED_ID_BTC_USD, CHAINLINK_DS_API_KEY, CHAINLINK_DS_USER_SECRET");
    }
    this.client = createClient({
      apiKey,
      userSecret,
      endpoint: config.CHAINLINK_DS_API_URL,
      wsEndpoint: config.CHAINLINK_DS_WS_URL,
    });
    this.stream = this.client.createStream([feedId]);
    this.stream.on("report", (report: { fullReport: string; feedID: string }) => {
      try {
        const decoded = decodeReport(report.fullReport, report.feedID) as { price?: bigint };
        const raw = decoded?.price;
        if (raw != null && typeof raw === "bigint") {
          const price = Number(raw) / 10 ** PRICE_DECIMALS;
          if (Number.isFinite(price) && price > 0) this.callback?.(Date.now(), price);
        }
      } catch {
        // skip bad report
      }
    });
    this.stream.on("error", (err: Error) => {
      console.error("[Chainlink BTC WS] error", err.message);
    });
    await this.stream.connect();
  }

  async close(): Promise<void> {
    this.callback = null;
    if (this.stream) {
      await this.stream.close();
      this.stream = null;
    }
    this.client = null;
  }
}
