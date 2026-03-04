/**
 * Price velocity sampler: rolling short-window |velocity| in $/sec.
 * Takes a price getter (e.g. getBtcPriceUsd or getEthPriceUsd); getVelocity() uses latest vs window-ago sample.
 */

import { config } from "../config";

export type PriceGetter = () => Promise<number | null>;

interface Sample {
  ts: number;
  price: number;
}

/** Max age for "old" sample (ms). If oldest sample is older, velocity is null. */
const MAX_SAMPLE_AGE_MS = 2 * 60 * 1000;

export interface PriceVelocitySamplerOptions {
  getPriceUsd: PriceGetter;
  /** Label for logs (e.g. "btc", "eth"). */
  assetLabel?: string;
}

export class PriceVelocitySampler {
  private readonly getPriceUsd: PriceGetter;
  private readonly assetLabel: string;
  private samples: Sample[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: PriceVelocitySamplerOptions | PriceGetter) {
    if (typeof options === "function") {
      this.getPriceUsd = options;
      this.assetLabel = "price";
    } else {
      this.getPriceUsd = options.getPriceUsd;
      this.assetLabel = options.assetLabel ?? "price";
    }
  }

  start(): void {
    if (this.intervalId != null) return;
    const tick = async (): Promise<void> => {
      const price = await this.getPriceUsd();
      if (price != null && Number.isFinite(price)) {
        const ts = Date.now();
        this.samples.push({ ts, price });
        const windowMs = config.VELOCITY_WINDOW_SEC * 1000;
        const cutoff = ts - windowMs - config.BTC_SAMPLE_INTERVAL_MS;
        this.samples = this.samples.filter((s) => s.ts >= cutoff);
      }
    };
    tick();
    this.intervalId = setInterval(tick, config.BTC_SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.samples = [];
  }

  /** Asset label (e.g. "btc", "eth") for logging. */
  getAssetLabel(): string {
    return this.assetLabel;
  }

  /** Last price from the most recent sample (for logging). */
  getLastPrice(): number | null {
    if (this.samples.length === 0) return null;
    const p = this.samples[this.samples.length - 1].price;
    return Number.isFinite(p) ? p : null;
  }

  /** @deprecated Use getLastPrice(). Kept for backward compatibility. */
  getLastBtcPrice(): number | null {
    return this.getLastPrice();
  }

  /**
   * Returns |velocity| in $/sec over the configured window, or null if not enough data.
   * Uses absolute value so both up and down moves are "dangerous".
   */
  getVelocity(): number | null {
    const now = Date.now();
    const windowMs = config.VELOCITY_WINDOW_SEC * 1000;
    const minOldTs = now - windowMs;
    if (this.samples.length < 2) return null;
    const latest = this.samples[this.samples.length - 1];
    if (now - latest.ts > MAX_SAMPLE_AGE_MS) return null;
    const old = this.samples.find((s) => s.ts <= minOldTs);
    if (old == null) return null;
    const deltaSec = (latest.ts - old.ts) / 1000;
    if (deltaSec <= 0) return null;
    const velocitySigned = (latest.price - old.price) / deltaSec;
    return Math.abs(velocitySigned);
  }

  /** Signed velocity ($/sec) for optional direction-aware logic. Positive = price up. */
  getVelocitySigned(): number | null {
    const now = Date.now();
    const windowMs = config.VELOCITY_WINDOW_SEC * 1000;
    const minOldTs = now - windowMs;
    if (this.samples.length < 2) return null;
    const latest = this.samples[this.samples.length - 1];
    if (now - latest.ts > MAX_SAMPLE_AGE_MS) return null;
    const old = this.samples.find((s) => s.ts <= minOldTs);
    if (old == null) return null;
    const deltaSec = (latest.ts - old.ts) / 1000;
    if (deltaSec <= 0) return null;
    return (latest.price - old.price) / deltaSec;
  }
}
