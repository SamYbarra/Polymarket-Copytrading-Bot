import { BigNumber } from "@ethersproject/bignumber";
import { hexZeroPad } from "@ethersproject/bytes";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { Chain, getContractConfig } from "@polymarket/clob-client";
import { getClobClient } from "../providers/clobclient";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { tradingEnv, getRpcUrl, maskAddress } from "../config/env";
import { resolve } from "path";
import { existsSync, mkdirSync, appendFileSync } from "fs";

const PROXY_WALLET_ADDRESS = tradingEnv.PROXY_WALLET_ADDRESS;
const LOG_DIR = resolve(process.cwd(), "log");
const REDEEM_LOG_FILE = resolve(LOG_DIR, "holdings-redeem.log");

function redeemLog(line: string): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(REDEEM_LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch (_) {}
}

// CTF Contract ABI - functions needed for redemption and checking resolution
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

export interface RedeemOptions {
  conditionId: string;
  indexSets?: number[];
  chainId?: Chain;
}

export async function redeemPositions(options: RedeemOptions): Promise<any> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment");
  }

  const chainId = options.chainId ?? (tradingEnv.CHAIN_ID as Chain);
  const contractConfig = getContractConfig(chainId);
  const rpcUrl = getRpcUrl(chainId);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const address = await wallet.getAddress();

  const indexSets = options.indexSets ?? [1, 2];
  const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";

  let conditionIdBytes32: string;
  if (options.conditionId.startsWith("0x")) {
    conditionIdBytes32 = hexZeroPad(options.conditionId, 32);
  } else {
    const bn = BigNumber.from(options.conditionId);
    conditionIdBytes32 = hexZeroPad(bn.toHexString(), 32);
  }

  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);

  console.log("\n=== REDEEMING POSITIONS ===");
  console.log(`Contract Config: ${contractConfig.conditionalTokens}`);
  console.log(`Condition ID: ${conditionIdBytes32}`);
  console.log(`Index Sets: ${indexSets.join(", ")}`);
  console.log(`Collateral Token: ${contractConfig.collateral}`);
  console.log(`Parent Collection ID: ${parentCollectionId}`);
  console.log(`Wallet: ${address}`);

  let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
  try {
    const gasPrice = await provider.getGasPrice();
    gasOptions = {
      gasPrice: gasPrice.mul(120).div(100),
      gasLimit: 500_000,
    };
  } catch (error) {
    gasOptions = {
      gasPrice: BigNumber.from("100000000000"),
      gasLimit: 500_000,
    };
  }

  try {
    console.log("Calling redeemPositions on CTF contract...");
    const tx = await ctfContract.redeemPositions(
      contractConfig.collateral,
      parentCollectionId,
      conditionIdBytes32,
      indexSets,
      gasOptions
    );

    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log("\n=== REDEEM COMPLETE ===");

    return receipt;
  } catch (error: any) {
    console.log("Failed to redeem positions", error);
    if (error.reason) console.log("Reason", error.reason);
    if (error.data) console.log("Data", error.data);
    throw error;
  }
}

async function redeemPositionsViaSafe(
  conditionId: string,
  indexSets: number[],
  chainIdValue: Chain
): Promise<any> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment");
  }

  const contractConfig = getContractConfig(chainIdValue);
  const rpcUrl = getRpcUrl(chainIdValue);
  const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";

  let conditionIdBytes32: string;
  if (conditionId.startsWith("0x")) {
    conditionIdBytes32 = hexZeroPad(conditionId, 32);
  } else {
    conditionIdBytes32 = hexZeroPad(BigNumber.from(conditionId).toHexString(), 32);
  }

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

  console.log("\n=== REDEEMING VIA SAFE (PROXY) ===");
  console.log(`Safe (proxy) address: ${maskAddress(PROXY_WALLET_ADDRESS)}`);
  console.log(`CTF contract: ${contractConfig.conditionalTokens}`);
  console.log(`Condition ID: ${conditionIdBytes32}`);
  console.log(`Index Sets: ${indexSets.join(", ")}`);

  let safeSdk: InstanceType<typeof Safe>;
  try {
    console.log("Initializing Safe SDK...");
    safeSdk = await Safe.init({
      provider: rpcUrl,
      signer: privateKey,
      safeAddress: PROXY_WALLET_ADDRESS,
    });
    console.log("Safe SDK initialized");
  } catch (initErr: unknown) {
    const msg = initErr instanceof Error ? initErr.message : String(initErr);
    const err = initErr as { reason?: string; code?: string; data?: unknown };
    console.log("Safe.init failed.");
    console.log("PROXY_WALLET_ADDRESS must be a Gnosis Safe (MetaMask users). MagicLink users use a different proxy and cannot use this path.");
    console.log("Error: " + msg);
    if (err.reason) console.log("Reason: " + err.reason);
    if (err.code) console.log("Code: " + err.code);
    if (err.data) console.log("Data: " + JSON.stringify(err.data));
    if (initErr instanceof Error && initErr.stack) console.log(initErr.stack);
    throw initErr;
  }

  let safeTransaction: Awaited<ReturnType<InstanceType<typeof Safe>["createTransaction"]>>;
  try {
    console.log("Creating Safe transaction...");
    safeTransaction = await safeSdk.createTransaction({ transactions: [metaTx] });
    console.log("Safe transaction created");
  } catch (createErr: unknown) {
    const msg = createErr instanceof Error ? createErr.message : String(createErr);
    const err = createErr as { reason?: string; code?: string; data?: unknown };
    console.log("createTransaction failed: " + msg);
    if (err.reason) console.log("Reason: " + err.reason);
    if (err.code) console.log("Code: " + err.code);
    if (createErr instanceof Error && createErr.stack) console.log(createErr.stack);
    throw createErr;
  }

  let signedTx: Awaited<ReturnType<InstanceType<typeof Safe>["signTransaction"]>>;
  try {
    console.log("Signing Safe transaction...");
    signedTx = await safeSdk.signTransaction(safeTransaction);
    console.log("Safe transaction signed");
  } catch (signErr: unknown) {
    const msg = signErr instanceof Error ? signErr.message : String(signErr);
    console.log("signTransaction failed: " + msg);
    if (signErr instanceof Error && signErr.stack) console.log(signErr.stack);
    throw signErr;
  }

  let result: Awaited<ReturnType<InstanceType<typeof Safe>["executeTransaction"]>>;
  try {
    console.log("Executing Safe transaction (sending to chain)...");
    result = await safeSdk.executeTransaction(signedTx);
    console.log("Transaction sent: " + result.hash);
  } catch (execErr: unknown) {
    const msg = execErr instanceof Error ? execErr.message : String(execErr);
    const err = execErr as { reason?: string; code?: string; data?: unknown };
    console.log("executeTransaction failed: " + msg);
    if (err.reason) console.log("Reason: " + err.reason);
    if (err.code) console.log("Code: " + err.code);
    if (msg.includes("signatures missing")) {
      console.log("Your Safe may require more than one signature. Ensure the signer (PRIVATE_KEY) is an owner and that the Safe threshold is met.");
    }
    if (execErr instanceof Error && execErr.stack) console.log(execErr.stack);
    throw execErr;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  try {
    const receipt = await provider.waitForTransaction(result.hash, 1, 60_000);
    if (receipt && receipt.status === 0) {
      console.log("Transaction reverted on-chain. Check contract state (e.g. tokens held by proxy, correct conditionId/indexSets).");
    } else if (receipt) {
      console.log("Transaction confirmed in block " + receipt.blockNumber);
    }
  } catch (waitErr: unknown) {
    console.log("Could not wait for receipt: " + (waitErr instanceof Error ? waitErr.message : String(waitErr)));
  }

  console.log("\n=== REDEEM COMPLETE (VIA SAFE) ===");
  return result;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      const isRetryable =
        errorMsg.includes("network") ||
        errorMsg.includes("timeout") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("RPC") ||
        errorMsg.includes("rate limit") ||
        errorMsg.includes("nonce") ||
        errorMsg.includes("replacement transaction") ||
        errorMsg.includes("already known") ||
        errorMsg.includes("503") ||
        errorMsg.includes("502") ||
        errorMsg.includes("504") ||
        errorMsg.includes("connection") ||
        errorMsg.includes("socket") ||
        errorMsg.includes("ECONNRESET");

      if (!isRetryable) throw error;
      if (attempt === maxRetries) throw error;

      const delay = delayMs * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt}/${maxRetries} failed: ${errorMsg}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

export async function redeemMarket(
  conditionId: string,
  chainId?: Chain,
  maxRetries: number = 3
): Promise<any> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment");
  }

  const chainIdValue = chainId ?? (tradingEnv.CHAIN_ID as Chain);
  const contractConfig = getContractConfig(chainIdValue);
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const walletAddress = await wallet.getAddress();

  redeemLog(`REDEEM_ATTEMPT conditionId=${conditionId} proxy=${maskAddress(PROXY_WALLET_ADDRESS)}`);
  console.log("\n=== CHECKING MARKET RESOLUTION ===");

  const resolution = await checkConditionResolution(conditionId, chainIdValue);

  if (!resolution.isResolved) {
    throw new Error(`Market is not yet resolved. ${resolution.reason}`);
  }

  if (resolution.winningIndexSets.length === 0) {
    throw new Error("Condition is resolved but no winning outcomes found");
  }

  console.log(`Winning indexSets: ${resolution.winningIndexSets.join(", ")}`);
  console.log(`Checking token balances at proxy wallet: ${maskAddress(PROXY_WALLET_ADDRESS)}`);
  const userBalances = await getUserTokenBalances(conditionId, PROXY_WALLET_ADDRESS, chainIdValue);
  const balancesLog = Array.from(userBalances.entries())
    .map(([k, v]) => `${k}:${v.toString()}`)
    .join(" ");
  redeemLog(`REDEEM_BALANCES conditionId=${conditionId} proxyBalancesByIndexSet=${balancesLog || "none"}`);

  if (userBalances.size === 0) {
    redeemLog(`REDEEM_SKIP conditionId=${conditionId} reason=no_tokens_at_proxy`);
    throw new Error("You don't have any tokens for this condition to redeem");
  }

  const redeemableIndexSets = resolution.winningIndexSets.filter((indexSet) => {
    const balance = userBalances.get(indexSet);
    return balance && !balance.isZero();
  });

  if (redeemableIndexSets.length === 0) {
    const heldIndexSets = Array.from(userBalances.keys());
    throw new Error(
      `You don't hold any winning tokens. ` +
        `You hold: ${heldIndexSets.join(", ")}, ` +
        `Winners: ${resolution.winningIndexSets.join(", ")}`
    );
  }

  console.log(`\nYou hold winning tokens for indexSets: ${redeemableIndexSets.join(", ")}`);
  for (const indexSet of redeemableIndexSets) {
    const balance = userBalances.get(indexSet);
    console.log(`  IndexSet ${indexSet}: ${balance?.toString() ?? "0"} tokens`);
  }

  console.log(`\nRedeeming winning positions: ${redeemableIndexSets.join(", ")}`);

  const useProxyRedeem = walletAddress.toLowerCase() !== PROXY_WALLET_ADDRESS.toLowerCase();
  if (useProxyRedeem) {
    console.log("Using proxy (Gnosis Safe) redemption — tokens are held by proxy wallet");
  }

  return retryWithBackoff(
    async () => {
      if (useProxyRedeem) {
        return await redeemPositionsViaSafe(conditionId, redeemableIndexSets, chainIdValue);
      }
      return await redeemPositions({
        conditionId,
        indexSets: redeemableIndexSets,
        chainId: chainIdValue,
      });
    },
    maxRetries,
    2000
  );
}

export async function checkConditionResolution(
  conditionId: string,
  chainId?: Chain
): Promise<{
  isResolved: boolean;
  winningIndexSets: number[];
  payoutDenominator: BigNumber;
  payoutNumerators: BigNumber[];
  outcomeSlotCount: number;
  reason?: string;
}> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment");
  }

  const chainIdValue = chainId ?? (tradingEnv.CHAIN_ID as Chain);
  const contractConfig = getContractConfig(chainIdValue);
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  let conditionIdBytes32: string;
  if (conditionId.startsWith("0x")) {
    conditionIdBytes32 = hexZeroPad(conditionId, 32);
  } else {
    const bn = BigNumber.from(conditionId);
    conditionIdBytes32 = hexZeroPad(bn.toHexString(), 32);
  }

  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);

  try {
    const outcomeSlotCount = (await ctfContract.getOutcomeSlotCount(conditionIdBytes32)).toNumber();
    const payoutDenominator = await ctfContract.payoutDenominator(conditionIdBytes32);
    const isResolved = !payoutDenominator.isZero();

    let winningIndexSets: number[] = [];
    let payoutNumerators: BigNumber[] = [];

    if (isResolved) {
      payoutNumerators = [];
      for (let i = 0; i < outcomeSlotCount; i++) {
        const numerator = await ctfContract.payoutNumerators(conditionIdBytes32, i);
        payoutNumerators.push(numerator);
        if (!numerator.isZero()) {
          winningIndexSets.push(i + 1);
        }
      }
      console.log(`Condition resolved. Winning indexSets: ${winningIndexSets.join(", ")}`);
    } else {
      console.log("Condition not yet resolved");
    }

    return {
      isResolved,
      winningIndexSets,
      payoutDenominator,
      payoutNumerators,
      outcomeSlotCount,
      reason: isResolved
        ? `Condition resolved. Winning outcomes: ${winningIndexSets.join(", ")}`
        : "Condition not yet resolved",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log("Failed to check condition resolution", error);
    return {
      isResolved: false,
      winningIndexSets: [],
      payoutDenominator: BigNumber.from(0),
      payoutNumerators: [],
      outcomeSlotCount: 0,
      reason: `Error checking resolution: ${errorMsg}`,
    };
  }
}

export async function getUserTokenBalances(
  conditionId: string,
  walletAddress: string,
  chainId?: Chain
): Promise<Map<number, BigNumber>> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment");
  }

  const chainIdValue = chainId ?? (tradingEnv.CHAIN_ID as Chain);
  const contractConfig = getContractConfig(chainIdValue);
  const rpcUrl = getRpcUrl(chainIdValue);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  let conditionIdBytes32: string;
  if (conditionId.startsWith("0x")) {
    conditionIdBytes32 = hexZeroPad(conditionId, 32);
  } else {
    const bn = BigNumber.from(conditionId);
    conditionIdBytes32 = hexZeroPad(bn.toHexString(), 32);
  }

  const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);
  const balances = new Map<number, BigNumber>();
  const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";

  try {
    const outcomeSlotCount = (await ctfContract.getOutcomeSlotCount(conditionIdBytes32)).toNumber();
    const derivedTokenIds: string[] = [];

    for (let i = 1; i <= outcomeSlotCount; i++) {
      try {
        const collectionId = await ctfContract.getCollectionId(
          parentCollectionId,
          conditionIdBytes32,
          i
        );
        const positionId = await ctfContract.getPositionId(contractConfig.collateral, collectionId);
        derivedTokenIds.push(`${i}:${positionId.toString()}`);
        const balance = await ctfContract.balanceOf(walletAddress, positionId);
        if (!balance.isZero()) {
          balances.set(i, balance);
        }
      } catch (error) {
        continue;
      }
    }
    redeemLog(`REDEEM_DERIVED_TOKEN_IDS conditionId=${conditionId} indexSet_to_positionId=${derivedTokenIds.join(" ")}`);
  } catch (error) {
    console.log("Failed to get user token balances", error);
    redeemLog(`REDEEM_GET_BALANCES_ERROR conditionId=${conditionId} error=${error instanceof Error ? error.message : String(error)}`);
  }

  return balances;
}

export async function isMarketResolved(conditionId: string): Promise<{
  isResolved: boolean;
  market?: any;
  reason?: string;
  winningIndexSets?: number[];
}> {
  try {
    const resolution = await checkConditionResolution(conditionId);

    if (resolution.isResolved) {
      try {
        const clobClient = await getClobClient();
        const market = await clobClient.getMarket(conditionId);
        return {
          isResolved: true,
          market,
          winningIndexSets: resolution.winningIndexSets,
          reason: `Market resolved. Winning outcomes: ${resolution.winningIndexSets.join(", ")}`,
        };
      } catch (apiError) {
        return {
          isResolved: true,
          winningIndexSets: resolution.winningIndexSets,
          reason: `Market resolved (checked via CTF contract). Winning outcomes: ${resolution.winningIndexSets.join(", ")}`,
        };
      }
    } else {
      try {
        const clobClient = await getClobClient();
        const market = await clobClient.getMarket(conditionId);

        if (!market) {
          return { isResolved: false, reason: "Market not found" };
        }

        const isActive = market.active !== false;

        return {
          isResolved: false,
          market,
          reason: isActive ? "Market still active" : "Market ended but outcome not reported yet",
        };
      } catch (apiError) {
        return {
          isResolved: false,
          reason: resolution.reason ?? "Market not resolved",
        };
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log("Failed to check market status", error);
    return {
      isResolved: false,
      reason: `Error checking market: ${errorMsg}`,
    };
  }
}
