/**
 * Binance Network Guard & Environment Separation
 *
 * Central security enforcement guard ensuring explicit environment separation:
 * - BINANCE_ENV: 'testnet' | 'production' (default: 'testnet')
 * - ALLOW_PRODUCTION_TRADING: 'true' | 'false' (default: false)
 *
 * CRITICAL SAFETY INVARIANT:
 * Production is 100% STRICTLY REJECTED as long as ALLOW_PRODUCTION_TRADING !== true.
 * Zero silent fallback. Zero production leaks. Fail closed immediately.
 */

export const BINANCE_TESTNET_BASE_URL = 'https://testnet.binancefuture.com';
export const BINANCE_PROD_FUTURES_BASE_URL = 'https://fapi.binance.com';
export const BINANCE_PROD_SPOT_BASE_URL = 'https://api.binance.com';
export const BINANCE_PROD_WEB_BASE_URL = 'https://www.binance.com';

export type BinanceEnvironment = 'testnet' | 'production';

export function getBinanceEnvironment(): BinanceEnvironment {
  const env = (process.env.BINANCE_ENV || 'testnet').trim().toLowerCase();
  return env === 'production' ? 'production' : 'testnet';
}

export function isProductionTradingAllowed(): boolean {
  return process.env.ALLOW_PRODUCTION_TRADING === 'true';
}

export function getActiveBinanceBaseUrl(): string {
  const env = getBinanceEnvironment();
  if (env === 'production') {
    if (!isProductionTradingAllowed()) {
      throw new Error(
        '[CENTRAL_GUARD_FAIL_CLOSED] Production environment requested (BINANCE_ENV=production), but ALLOW_PRODUCTION_TRADING is false. Production is strictly blocked.'
      );
    }
    return BINANCE_PROD_FUTURES_BASE_URL;
  }
  return BINANCE_TESTNET_BASE_URL;
}

const FORBIDDEN_PRODUCTION_HOSTS = [
  'fapi.binance.com',
  'api.binance.com',
  'www.binance.com',
  'api1.binance.com',
  'api2.binance.com',
  'api3.binance.com',
];

class BinanceNetworkGuard {
  private testnetRequestsCount = 0;
  private productionRequestsCount = 0;
  private blockedProductionRequestsCount = 0;

  public getEnvironment(): BinanceEnvironment {
    return getBinanceEnvironment();
  }

  public isProductionTradingAllowed(): boolean {
    return isProductionTradingAllowed();
  }

  public getActiveBaseUrl(): string {
    return getActiveBinanceBaseUrl();
  }

  public getSafeActiveBaseUrl(): string {
    if (this.getEnvironment() === 'production' && this.isProductionTradingAllowed()) {
      return BINANCE_PROD_FUTURES_BASE_URL;
    }
    return BINANCE_TESTNET_BASE_URL;
  }

  /**
   * Asserts that traffic complies with the active environment policy.
   * If production is requested but ALLOW_PRODUCTION_TRADING is false, FAILS CLOSED immediately.
   */
  public assertTraffic(rawUrl: string | URL, callerContext = 'Unspecified'): string {
    const urlStr = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString();
    const env = this.getEnvironment();
    const allowProd = this.isProductionTradingAllowed();

    if (env === 'production') {
      if (!allowProd) {
        this.blockedProductionRequestsCount++;
        const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Production environment rejected: ALLOW_PRODUCTION_TRADING is false. (Caller: ${callerContext})`;
        console.error(errMsg);
        throw new Error(errMsg);
      }

      if (!urlStr.includes('fapi.binance.com')) {
        this.blockedProductionRequestsCount++;
        const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Non-production or invalid host URL rejected: ${urlStr}. Production requires https://fapi.binance.com. (Caller: ${callerContext})`;
        console.error(errMsg);
        throw new Error(errMsg);
      }

      this.productionRequestsCount++;
      return urlStr;
    }

    // Default testnet environment
    return this.assertTestnetTraffic(urlStr, callerContext);
  }

  /**
   * Asserts that a target URL is 100% strictly a Binance Futures Testnet endpoint.
   * If any production URL or forbidden pattern is detected, FAILS CLOSED immediately.
   */
  public assertTestnetTraffic(rawUrl: string | URL, callerContext = 'Unspecified'): string {
    const urlStr = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString();

    // Check for forbidden production hosts/substrings
    for (const host of FORBIDDEN_PRODUCTION_HOSTS) {
      if (urlStr.includes(host)) {
        this.blockedProductionRequestsCount++;
        const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Production URL detected (${urlStr}). Forbidden in Testnet mode. (Caller: ${callerContext})`;
        console.error(errMsg);
        throw new Error(errMsg);
      }
    }

    // Must be pointing to Binance Futures Testnet if it is a Binance API request
    if (urlStr.includes('binance') && !urlStr.includes('testnet.binancefuture.com')) {
      this.blockedProductionRequestsCount++;
      const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Non-testnet Binance URL rejected: ${urlStr} (Caller: ${callerContext})`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (urlStr.includes('testnet.binancefuture.com')) {
      this.testnetRequestsCount++;
    }

    return urlStr;
  }

  /**
   * Asserts that a target URL is a valid Production Futures endpoint.
   * Strictly FAILS CLOSED if ALLOW_PRODUCTION_TRADING is not explicitly true.
   */
  public assertProductionTraffic(rawUrl: string | URL, callerContext = 'Unspecified'): string {
    const urlStr = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString();

    if (!this.isProductionTradingAllowed()) {
      this.blockedProductionRequestsCount++;
      const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Production URL rejected: ALLOW_PRODUCTION_TRADING is false. (Caller: ${callerContext})`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (this.getEnvironment() !== 'production') {
      this.blockedProductionRequestsCount++;
      const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Production URL rejected: BINANCE_ENV is '${this.getEnvironment()}', not 'production'. (Caller: ${callerContext})`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (!urlStr.includes('fapi.binance.com')) {
      this.blockedProductionRequestsCount++;
      const errMsg = `[CENTRAL_GUARD_FAIL_CLOSED] Invalid production host: ${urlStr}. Binance Futures Production requires https://fapi.binance.com. (Caller: ${callerContext})`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    this.productionRequestsCount++;
    return urlStr;
  }

  /**
   * Returns current audit counters for network traffic isolation.
   */
  public getAuditMetrics(): {
    testnetRequestsCount: number;
    productionRequestsCount: number;
    blockedProductionRequestsCount: number;
    testnetModeLocked: boolean;
    activeBaseUrl: string;
    environment: BinanceEnvironment;
    allowProductionTrading: boolean;
  } {
    return {
      testnetRequestsCount: this.testnetRequestsCount,
      productionRequestsCount: this.productionRequestsCount,
      blockedProductionRequestsCount: this.blockedProductionRequestsCount,
      testnetModeLocked: this.getEnvironment() === 'testnet',
      activeBaseUrl: this.getSafeActiveBaseUrl(),
      environment: this.getEnvironment(),
      allowProductionTrading: this.isProductionTradingAllowed(),
    };
  }

  public getAuditSummary(): {
    testnetRequestsCount: number;
    productionRequestsCount: number;
    blockedProductionRequestsCount: number;
    productionAttemptCount: number;
    testnetModeLocked: boolean;
    activeBaseUrl: string;
    environment: BinanceEnvironment;
    allowProductionTrading: boolean;
  } {
    return {
      testnetRequestsCount: this.testnetRequestsCount,
      productionRequestsCount: this.productionRequestsCount,
      blockedProductionRequestsCount: this.blockedProductionRequestsCount,
      productionAttemptCount: this.blockedProductionRequestsCount,
      testnetModeLocked: this.getEnvironment() === 'testnet',
      activeBaseUrl: this.getSafeActiveBaseUrl(),
      environment: this.getEnvironment(),
      allowProductionTrading: this.isProductionTradingAllowed(),
    };
  }

  public resetAuditMetrics(): void {
    this.testnetRequestsCount = 0;
    this.productionRequestsCount = 0;
    this.blockedProductionRequestsCount = 0;
  }
}

export const binanceNetworkGuard = new BinanceNetworkGuard();
