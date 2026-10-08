/**
 * Account State Provider Abstraction — READ-ONLY
 *
 * Defines the contract for fetching remote Binance Futures account and position data.
 * Designed to cleanly decouple the Worker from specific credential management
 * or authentication mechanisms.
 */

export interface RemotePosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice?: number;
  unrealizedPnl?: number;
  leverage?: number;
  initialMargin?: number;
}

export interface AccountState {
  available: boolean;
  source: string;
  timestamp: number;
  availableBalance?: number;
  totalWalletBalance?: number;
  totalMarginBalance?: number; // total margin balance
  equity?: number; // strictly mapped from totalMarginBalance
  openPositions: RemotePosition[];
  error?: string;
}

export interface AccountStateProvider {
  getAccountState(): Promise<AccountState>;
}

/**
 * NullAccountStateProvider
 *
 * Safe default provider when credentials are unconfigured or unavailable in the Worker.
 * Returns available: false.
 * Strictly avoids:
 * - No invented balances or mock fallbacks to $20
 * - No assumption that missing state equals zero balance
 * - No fatal errors or crashes
 */
export class NullAccountStateProvider implements AccountStateProvider {
  private readonly source: string;

  constructor(source = 'UNCONFIGURED_OR_UNAVAILABLE') {
    this.source = source;
  }

  public async getAccountState(): Promise<AccountState> {
    return {
      available: false,
      source: this.source,
      timestamp: Date.now(),
      openPositions: [],
      error: 'No account credentials configured in Worker environment.',
    };
  }
}

export const defaultAccountStateProvider = new NullAccountStateProvider();
