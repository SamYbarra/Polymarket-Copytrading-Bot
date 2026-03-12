import { RealTimeDataClient, type RealTimeDataClientArgs } from "@polymarket/real-time-data-client";
import { env } from "../config/env";

const DEFAULT_PING_INTERVAL = 5000;

/**
 * Get a RealTimeDataClient instance with optional callbacks.
 * @param args - Configuration options including callbacks for the client.
 * @returns A RealTimeDataClient instance.
 */
export function getRealTimeDataClient(args?: RealTimeDataClientArgs): RealTimeDataClient {
    return new RealTimeDataClient({
        host: env.USER_REAL_TIME_DATA_URL,
        pingInterval: DEFAULT_PING_INTERVAL,
        ...args,
    });
}
