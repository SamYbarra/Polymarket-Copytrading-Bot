/**
 * CTF redeem: check resolution, redeem winning tokens. Uses v4 config only.
 */

import { BigNumber } from "@ethersproject/bignumber";
import { hexZeroPad } from "@ethersproject/bytes";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { Chain, getContractConfig } from "@polymarket/clob-client";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { config, getRpcUrl } from "../config";

const PROXY_WALLET_ADDRESS = config.PROXY_WALLET ?? "";

const CTF_ABI = [
  {
    constant: false,
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    name: "redeemPositions",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "uint256" },
    ],
    name: "payoutNumerators",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "", type: "bytes32" }],
    name: "payoutDenominator",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "conditionId", type: "bytes32" }],
    name: "getOutcomeSlotCount",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "owner", type: "address" },
      { name: "id", type: "uint256" },
    ],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSet", type: "uint256" },
    ],
    name: "getCollectionId",
    outputs: [{ name: "", type: "bytes32" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "collectionId", type: "bytes32" },
    ],
    name: "getPositionId",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "pure",
    type: "function",
  },
];

const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";

function toConditionIdBytes32(conditionId: string): string {
  if (conditionId.startsWith("0x")) {
    return hexZeroPad(conditionId, 32);
  }
  return hexZeroPad(BigNumber.from(conditionId).toHexString(), 32);
}

export async function checkConditionResolution(
  conditionId: string,
  chainIdParam?: Chain
): Promise<{
  isResolved: boolean;
  winningIndexSets: number[];
  payoutDenominator: BigNumber;
  payoutNumerators: BigNumber[];
  outcomeSlotCount: number;
  reason?: string;
}> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) throw new Error("PRIVATE_KEY not found");
  const chainIdValue = (chainIdParam ?? config.CHAIN_ID) as Chain;
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const wallet = new Wallet(key, provider);
  const contractConfig = getContractConfig(chainIdValue);
  const conditionIdBytes32 = toConditionIdBytes32(conditionId);
  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);

  try {
    const outcomeSlotCount = (await ctfContract.getOutcomeSlotCount(conditionIdBytes32)).toNumber();
    const payoutDenominator = await ctfContract.payoutDenominator(conditionIdBytes32);
    const isResolved = !payoutDenominator.isZero();
    let winningIndexSets: number[] = [];
    const payoutNumerators: BigNumber[] = [];
    if (isResolved) {
      for (let i = 0; i < outcomeSlotCount; i++) {
        const numerator = await ctfContract.payoutNumerators(conditionIdBytes32, i);
        payoutNumerators.push(numerator);
        if (!numerator.isZero()) winningIndexSets.push(i + 1);
      }
    }
    return {
      isResolved,
      winningIndexSets,
      payoutDenominator,
      payoutNumerators,
      outcomeSlotCount,
      reason: isResolved ? `Winning: ${winningIndexSets.join(", ")}` : "Not yet resolved",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      isResolved: false,
      winningIndexSets: [],
      payoutDenominator: BigNumber.from(0),
      payoutNumerators: [],
      outcomeSlotCount: 0,
      reason: `Error: ${errorMsg}`,
    };
  }
}

export async function getUserTokenBalances(
  conditionId: string,
  walletAddress: string,
  chainIdParam?: Chain
): Promise<Map<number, BigNumber>> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) throw new Error("PRIVATE_KEY not found");
  const chainIdValue = (chainIdParam ?? config.CHAIN_ID) as Chain;
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const wallet = new Wallet(key, provider);
  const contractConfig = getContractConfig(chainIdValue);
  const conditionIdBytes32 = toConditionIdBytes32(conditionId);
  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);
  const balances = new Map<number, BigNumber>();
  try {
    const outcomeSlotCount = (await ctfContract.getOutcomeSlotCount(conditionIdBytes32)).toNumber();
    for (let i = 1; i <= outcomeSlotCount; i++) {
      try {
        const collectionId = await ctfContract.getCollectionId(parentCollectionId, conditionIdBytes32, i);
        const positionId = await ctfContract.getPositionId(contractConfig.collateral, collectionId);
        const balance = await ctfContract.balanceOf(walletAddress, positionId);
        if (!balance.isZero()) balances.set(i, balance);
      } catch {
        // skip
      }
    }
  } catch {
    // return empty
  }
  return balances;
}

async function redeemPositionsEOA(
  conditionId: string,
  indexSets: number[],
  chainIdValue: Chain
): Promise<any> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) throw new Error("PRIVATE_KEY not found");
  const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(key, provider);
  const contractConfig = getContractConfig(chainIdValue);
  const conditionIdBytes32 = toConditionIdBytes32(conditionId);
  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);
  let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
  try {
    const gasPrice = await provider.getGasPrice();
    gasOptions = { gasPrice: gasPrice.mul(120).div(100), gasLimit: 500_000 };
  } catch {
    gasOptions = { gasPrice: BigNumber.from("100000000000"), gasLimit: 500_000 };
  }
  const tx = await ctfContract.redeemPositions(
    contractConfig.collateral,
    parentCollectionId,
    conditionIdBytes32,
    indexSets,
    gasOptions
  );
  await tx.wait();
  return tx;
}

async function redeemPositionsViaSafe(
  conditionId: string,
  indexSets: number[],
  chainIdValue: Chain
): Promise<any> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) throw new Error("PRIVATE_KEY not found");
  const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const rpcUrl = getRpcUrl(chainIdValue);
  const contractConfig = getContractConfig(chainIdValue);
  const conditionIdBytes32 = toConditionIdBytes32(conditionId);
  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI);
  const data = ctfContract.interface.encodeFunctionData("redeemPositions", [
    contractConfig.collateral,
    parentCollectionId,
    conditionIdBytes32,
    indexSets,
  ]);
  const metaTx: MetaTransactionData = {
    to: contractConfig.conditionalTokens,
    value: "0",
    data,
    operation: OperationType.Call,
  };
  const safeSdk = await Safe.init({
    provider: rpcUrl,
    signer: key,
    safeAddress: PROXY_WALLET_ADDRESS,
  });
  const safeTransaction = await safeSdk.createTransaction({ transactions: [metaTx] });
  const signedTx = await safeSdk.signTransaction(safeTransaction);
  const result = await safeSdk.executeTransaction(signedTx);
  const provider = new JsonRpcProvider(rpcUrl);
  await provider.waitForTransaction(result.hash, 1, 60_000).catch(() => {});
  return result;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number = 3, delayMs: number = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const retryable =
        /network|timeout|ECONNREFUSED|ETIMEDOUT|rate limit|nonce|replacement|already known|50[234]|connection|socket|ECONNRESET/i.test(msg);
      if (!retryable || attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

export async function redeemMarket(conditionId: string, chainIdParam?: Chain, maxRetries: number = 3): Promise<any> {
  const privateKey = (config.PRIVATE_KEY ?? "").trim();
  if (!privateKey) throw new Error("PRIVATE_KEY not found");
  const chainIdValue = (chainIdParam ?? config.CHAIN_ID) as Chain;
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const wallet = new Wallet(key, provider);
  const walletAddress = await wallet.getAddress();

  const resolution = await checkConditionResolution(conditionId, chainIdValue);
  if (!resolution.isResolved) throw new Error(`Market not yet resolved. ${resolution.reason}`);
  if (resolution.winningIndexSets.length === 0) throw new Error("Condition resolved but no winning outcomes");

  const proxyAddress = PROXY_WALLET_ADDRESS || walletAddress;
  const userBalances = await getUserTokenBalances(conditionId, proxyAddress, chainIdValue);
  if (userBalances.size === 0) throw new Error("No tokens for this condition to redeem");

  const redeemableIndexSets = resolution.winningIndexSets.filter((indexSet) => {
    const balance = userBalances.get(indexSet);
    return balance && !balance.isZero();
  });
  if (redeemableIndexSets.length === 0) {
    const held = Array.from(userBalances.keys());
    throw new Error(`No winning tokens. Hold: ${held.join(", ")}, Winners: ${resolution.winningIndexSets.join(", ")}`);
  }

  const useProxy = walletAddress.toLowerCase() !== proxyAddress.toLowerCase();
  return retryWithBackoff(
    async () => {
      if (useProxy) return redeemPositionsViaSafe(conditionId, redeemableIndexSets, chainIdValue);
      return redeemPositionsEOA(conditionId, redeemableIndexSets, chainIdValue);
    },
    maxRetries,
    2000
  );
}
