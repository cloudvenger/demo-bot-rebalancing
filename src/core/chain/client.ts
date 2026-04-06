import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Config } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The viem public client type produced by this factory. */
export type BotPublicClient = PublicClient<Transport, Chain>;

/** The viem wallet client type produced by this factory. */
export type BotWalletClient = WalletClient<Transport, Chain, PrivateKeyAccount>;

/** Both clients bundled together — passed by injection throughout the bot. */
export interface Clients {
  publicClient: BotPublicClient;
  walletClient: BotWalletClient;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a viem public client and wallet client from the validated config.
 *
 * - Public client: JSON-RPC read access on Ethereum mainnet.
 * - Wallet client: EIP-1559 transaction signing with the operator private key.
 *
 * Both clients share the same HTTP transport, so they resolve to the same
 * RPC endpoint. The account is derived deterministically from PRIVATE_KEY.
 *
 * @throws {Error} If PRIVATE_KEY cannot be converted to a valid account.
 */
export function createClients(config: Pick<Config, "RPC_URL" | "PRIVATE_KEY">): Clients {
  const transport = http(config.RPC_URL);

  // Normalise the private key to a 0x-prefixed hex string.
  const rawKey = config.PRIVATE_KEY;
  const privateKey = rawKey.startsWith("0x")
    ? (rawKey as `0x${string}`)
    : (`0x${rawKey}` as `0x${string}`);

  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: mainnet,
    transport,
  }) as BotPublicClient;

  const walletClient = createWalletClient({
    chain: mainnet,
    transport,
    account,
  }) as BotWalletClient;

  return { publicClient, walletClient };
}
