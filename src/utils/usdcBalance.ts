import { Chain, getContractConfig } from "@polymarket/clob-client";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { env, getRpcUrl } from "../config/env";

const ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
];

function formatUnits(value: BigNumber, decimals: number): number {
    // Avoid pulling in extra deps; USDC is 6 decimals on Polygon.
    const s = value.toString();
    if (decimals <= 0) return Number(s);
    const pad = decimals + 1;
    const padded = s.length < pad ? s.padStart(pad, "0") : s;
    const intPart = padded.slice(0, padded.length - decimals);
    const fracPart = padded.slice(padded.length - decimals);
    return parseFloat(`${intPart}.${fracPart}`);
}

/**
 * Get USDC balance (as a number) for an address using on-chain ERC20 balanceOf.
 */
export async function getUsdcBalance(
    address: string,
    chainId?: Chain
): Promise<number> {
    const chainIdValue = chainId || (env.CHAIN_ID as Chain);
    const rpcUrl = getRpcUrl(chainIdValue);
    const provider = new JsonRpcProvider(rpcUrl);
    const contractConfig = getContractConfig(chainIdValue);

    const usdc = new Contract(contractConfig.collateral, ERC20_ABI, provider);
    const [rawBalance, decimals] = await Promise.all([
        usdc.balanceOf(address) as Promise<BigNumber>,
        usdc.decimals() as Promise<number>,
    ]);

    return formatUnits(rawBalance, decimals);
}


