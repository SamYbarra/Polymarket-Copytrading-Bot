/**
 * Optional Redis client to read realtime features (realtime:features:{conditionId}).
 * Written by origin src: redis.setRealtimeFeatures(conditionId, JSON.stringify({ features, timestamp, conditionId })) with TTL 120s.
 * When REDIS_URL is set, v2 reads this key and uses data.features for ML/ensemble prediction.
 */

import { createClient } from "redis";
import { config } from "../config";

let client: ReturnType<typeof createClient> | null = null;

export async function connectRedis(): Promise<boolean> {
  if (!config.REDIS_URL) return false;
  if (client) return true;
  try {
    client = createClient({ url: config.REDIS_URL });
    await client.connect();
    return true;
  } catch {
    return false;
  }
}

export function isRedisConfigured(): boolean {
  return !!config.REDIS_URL;
}

/** Read latest features JSON for conditionId. Key must match origin: realtime:features:{conditionId}. Returns null if no Redis or key missing. */
export async function getRealtimeFeatures(conditionId: string): Promise<string | null> {
  if (!client) return null;
  try {
    console.log(`[getRealtimeFeatures] conditionId=${conditionId}`);
    return await client.get(`realtime:features:${conditionId}`);
  } catch {
    return null;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
