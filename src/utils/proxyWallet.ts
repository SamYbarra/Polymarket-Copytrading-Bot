import { Chain, getContractConfig } from "@polymarket/clob-client";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { env, getRpcUrl } from "../config/env";

const EXCHANGE_ABI = [
    "function getPolyProxyWalletAddress(address _addr) view returns (address)",
];

/**
 * Resolve the Polymarket proxy wallet (smart wallet) address for a given EOA address.
 *
 * Note: Proxy wallets do not have private keys. You sign with the EOA; the proxy wallet is derived on-chain.
 */
export async function getPolymarketProxyWalletAddress(
    eoaAddress: string,
    chainId?: Chain
): Promise<string> {
    const chainIdValue = chainId || (env.CHAIN_ID as Chain);
    const rpcUrl = getRpcUrl(chainIdValue);
    const provider = new JsonRpcProvider(rpcUrl);
    const contractConfig = getContractConfig(chainIdValue);

    const exchange = new Contract(contractConfig.exchange, EXCHANGE_ABI, provider);
    return await exchange.getPolyProxyWalletAddress(eoaAddress);
}


