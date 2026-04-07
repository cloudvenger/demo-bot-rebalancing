import type { Address } from "viem";
import type { RebalanceAction, RebalanceResult } from "../core/rebalancer/types.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Telegram Bot API base URL — token is interpolated at send time */
const TELEGRAM_API_BASE = "https://api.telegram.org" as const;

/** Default cooldown period in milliseconds (15 minutes) */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1_000;

/** USDC has 6 decimal places */
const USDC_DECIMALS = 6 as const;

/** Divisor to convert raw USDC units to a human-readable decimal number */
const USDC_DIVISOR = 10 ** USDC_DECIMALS;

/** Alert type discriminant values */
const ALERT_TYPES = [
  "rebalance_success",
  "rebalance_failed",
  "rpc_failure",
  "missed_heartbeat",
  "low_balance",
] as const;

type AlertType = (typeof ALERT_TYPES)[number];

/** Health issue types exposed in the public API */
export type HealthIssueType = "rpc_failure" | "missed_heartbeat" | "low_balance";

// ---------------------------------------------------------------------------
// Notifier class
// ---------------------------------------------------------------------------

/**
 * Sends Telegram alerts for rebalance outcomes and bot health issues.
 *
 * All methods are fire-and-forget:
 *   - `fetch()` errors are caught and logged via `console.error`
 *   - No method ever throws or propagates an error to the caller
 *   - Telegram failures never block the rebalancing flow
 *
 * Per-alert-type cooldowns prevent notification spam. If the same alert type
 * was sent within `cooldownMs`, the send is skipped silently.
 */
export class Notifier {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly cooldownMs: number;

  /** Tracks the last time each alert type was successfully sent */
  private readonly lastSentAt: Map<AlertType, number> = new Map();

  constructor(
    config: Pick<Config, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID">,
    cooldownMs: number = DEFAULT_COOLDOWN_MS
  ) {
    this.botToken = config.TELEGRAM_BOT_TOKEN;
    this.chatId = config.TELEGRAM_CHAT_ID;
    this.cooldownMs = cooldownMs;
  }

  // -------------------------------------------------------------------------
  // Public alert methods
  // -------------------------------------------------------------------------

  /**
   * Send a success notification after a completed rebalance.
   *
   * Message includes:
   *   - Vault address
   *   - Markets affected and amounts moved (human-readable USDC)
   *   - Transaction hashes
   *   - New allocation percentages keyed by marketLabel
   */
  async notifyRebalanceSuccess(
    result: RebalanceResult,
    vaultAddress: Address
  ): Promise<void> {
    if (!this.canSend("rebalance_success")) return;

    const lines: string[] = [
      "*Rebalance Executed*",
      "",
      `Vault: \`${vaultAddress}\``,
      "",
    ];

    if (result.actions.length > 0) {
      lines.push("*Actions:*");
      for (const action of result.actions) {
        const amountUsdc = formatUsdc(action.amount);
        const direction = action.direction === "allocate" ? "ALLOCATE" : "DEALLOCATE";
        // Use marketLabel (human-readable) instead of adapter address
        lines.push(`  • ${direction} *${action.marketLabel}* — ${amountUsdc} USDC`);
      }
      lines.push("");
    }

    if (result.txHashes.length > 0) {
      lines.push("*Transactions:*");
      for (const hash of result.txHashes) {
        lines.push(`  • \`${hash}\``);
      }
      lines.push("");
    }

    if (result.newAllocations.length > 0) {
      lines.push("*New Allocations:*");
      for (const alloc of result.newAllocations) {
        const pct = alloc.percentage.toFixed(2);
        // Use marketLabel (human-readable) from the new newAllocations shape
        lines.push(`  • *${alloc.marketLabel}* — ${pct}%`);
      }
      lines.push("");
    }

    lines.push(`_${result.timestamp}_`);

    await this.send("rebalance_success", lines.join("\n"));
  }

  /**
   * Send a failure notification after a rebalance error.
   *
   * Message includes:
   *   - Vault address
   *   - Failing market (human-readable marketLabel, if known)
   *   - Error message (sanitised — no internal stack traces)
   *   - Transaction hash (if a tx was submitted before the failure)
   */
  async notifyRebalanceFailed(
    error: Error,
    vaultAddress: Address,
    failedAction?: RebalanceAction
  ): Promise<void> {
    if (!this.canSend("rebalance_failed")) return;

    const lines: string[] = [
      "*Rebalance Failed*",
      "",
      `Vault: \`${vaultAddress}\``,
      "",
    ];

    if (failedAction) {
      const direction = failedAction.direction === "allocate" ? "ALLOCATE" : "DEALLOCATE";
      const amountUsdc = formatUsdc(failedAction.amount);
      // Use marketLabel (human-readable) instead of adapter address
      lines.push(`Failing action: ${direction} *${failedAction.marketLabel}* — ${amountUsdc} USDC`);
      lines.push("");
    }

    // Sanitise the error message — never expose RPC URLs, private key hints, etc.
    const safeMessage = sanitiseErrorMessage(error.message);
    lines.push(`Error: ${safeMessage}`);

    await this.send("rebalance_failed", lines.join("\n"));
  }

  /**
   * Send a health-issue alert.
   *
   * Alert types:
   *   - `rpc_failure`      — RPC connection failed after retries exhausted
   *   - `missed_heartbeat` — No rebalance check ran in 2x the configured interval
   *   - `low_balance`      — Wallet ETH balance below the configured threshold
   */
  async notifyHealthIssue(
    type: HealthIssueType,
    details: string
  ): Promise<void> {
    if (!this.canSend(type)) return;

    const title = healthAlertTitle(type);
    const lines: string[] = [
      `*${title}*`,
      "",
      sanitiseErrorMessage(details),
    ];

    await this.send(type, lines.join("\n"));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Return true if `alertType` has not been sent within the cooldown window.
   * Does NOT update `lastSentAt` — that happens in `send()` after a successful
   * dispatch.
   */
  private canSend(alertType: AlertType): boolean {
    const lastMs = this.lastSentAt.get(alertType);
    if (lastMs === undefined) return true;
    return Date.now() - lastMs >= this.cooldownMs;
  }

  /**
   * POST a message to the Telegram Bot API.
   *
   * Fire-and-forget contract:
   *   - On network error: catch, log via `console.error`, return.
   *   - On non-2xx HTTP response: log the status, return.
   *   - Never throws, never rejects.
   *
   * The bot token is never logged — only the alert type and HTTP status appear
   * in error messages.
   *
   * Updates `lastSentAt` only after a successful send so that transient
   * failures do not reset the cooldown clock.
   */
  private async send(alertType: AlertType, text: string): Promise<void> {
    // Construct the URL by interpolating only the token — never log this URL.
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "Markdown",
        }),
      });

      if (!response.ok) {
        // Log the HTTP status but do not throw — Telegram failures are non-fatal.
        // eslint-disable-next-line no-console
        console.error(
          `[Notifier] Telegram API returned ${response.status} for alert type "${alertType}"`
        );
        return;
      }

      // Record the successful send time to enforce the cooldown.
      this.lastSentAt.set(alertType, Date.now());
    } catch (err) {
      // Network failure, DNS error, timeout, etc. — log and continue.
      // eslint-disable-next-line no-console
      console.error(
        `[Notifier] Failed to send Telegram alert (type="${alertType}"):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Convert a raw bigint USDC amount (6 decimals) to a human-readable string.
 * Example: 1_000_000n → "1.00"
 */
function formatUsdc(rawAmount: bigint): string {
  const whole = rawAmount / BigInt(USDC_DIVISOR);
  const fraction = rawAmount % BigInt(USDC_DIVISOR);
  const fractionPadded = fraction.toString().padStart(USDC_DECIMALS, "0").slice(0, 2);
  return `${whole.toString()}.${fractionPadded}`;
}

/**
 * Return a human-readable title for each health alert type.
 */
function healthAlertTitle(type: HealthIssueType): string {
  const titles: Record<HealthIssueType, string> = {
    rpc_failure: "RPC Failure",
    missed_heartbeat: "Missed Heartbeat",
    low_balance: "Low Wallet Balance",
  };
  return titles[type];
}

/**
 * Strip any fragments that could expose internal details:
 *   - URL-like strings (RPC endpoints)
 *   - Hex strings longer than 20 chars (could be a private key fragment)
 *   - Stack trace lines
 *
 * Returns the first 200 characters of the sanitised message to keep alerts concise.
 */
function sanitiseErrorMessage(message: string): string {
  let safe = message
    // Remove full URLs (could expose RPC endpoint / API keys in query params)
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    // Remove long hex strings (possible key material)
    .replace(/0x[0-9a-fA-F]{20,}/g, "[HEX_REDACTED]")
    // Remove stack trace lines
    .replace(/\s+at\s+\S+\s*\(\S+\)/g, "");

  // Truncate to keep Telegram messages readable
  if (safe.length > 200) {
    safe = safe.slice(0, 197) + "...";
  }

  return safe.trim() || "Unknown error";
}
