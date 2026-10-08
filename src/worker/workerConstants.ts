/**
 * Shared Worker Constants & Environment Separation
 *
 * Supports explicit Binance Futures Testnet and Production configurations:
 * - BINANCE_ENV ('testnet' | 'production', default: 'testnet')
 * - ALLOW_PRODUCTION_TRADING ('true' | 'false', default: false)
 */

import {
  BINANCE_TESTNET_BASE_URL,
  BINANCE_PROD_FUTURES_BASE_URL,
  getBinanceEnvironment,
  isProductionTradingAllowed,
  getActiveBinanceBaseUrl,
} from './binanceNetworkGuard';

export {
  BINANCE_TESTNET_BASE_URL,
  BINANCE_PROD_FUTURES_BASE_URL,
  getBinanceEnvironment,
  isProductionTradingAllowed,
  getActiveBinanceBaseUrl,
};

/**
 * Public Market Data Base URL
 * Defaults to Binance Futures Testnet (https://testnet.binancefuture.com).
 * In production mode, resolves to https://fapi.binance.com ONLY if ALLOW_PRODUCTION_TRADING is true.
 */
export const BINANCE_FUTURES_BASE_URL =
  process.env.BINANCE_FUTURES_BASE_URL ||
  (getBinanceEnvironment() === 'production' && isProductionTradingAllowed()
    ? BINANCE_PROD_FUTURES_BASE_URL
    : BINANCE_TESTNET_BASE_URL);

/**
 * Authenticated Account URL
 * In testnet mode (default), strictly Binance Futures Testnet.
 * In production mode, resolves to https://fapi.binance.com ONLY if ALLOW_PRODUCTION_TRADING is true.
 */
export const BINANCE_FUTURES_ACCOUNT_BASE_URL =
  process.env.BINANCE_FUTURES_ACCOUNT_BASE_URL ||
  (getBinanceEnvironment() === 'production' && isProductionTradingAllowed()
    ? BINANCE_PROD_FUTURES_BASE_URL
    : BINANCE_TESTNET_BASE_URL);

/**
 * Checks if Binance credentials for the target environment are fully configured.
 * Evaluated server-side only. Secrets are never exposed.
 * - Testnet: BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET
 * - Production: BINANCE_API_KEY / BINANCE_API_SECRET
 */
export function areCredentialsConfigured(env?: 'testnet' | 'production'): boolean {
  const targetEnv = env || getBinanceEnvironment();
  if (targetEnv === 'production') {
    const key = (process.env.BINANCE_API_KEY || '').trim();
    const secret = (process.env.BINANCE_API_SECRET || '').trim();
    return Boolean(key && secret);
  }
  const key = (process.env.BINANCE_TESTNET_API_KEY || '').trim();
  const secret = (process.env.BINANCE_TESTNET_API_SECRET || '').trim();
  return Boolean(key && secret);
}

/**
 * Backward-compatible check for testnet credentials.
 */
export function areTestnetCredentialsConfigured(): boolean {
  return areCredentialsConfigured('testnet');
}

/**
 * Returns a masked representation of the configured API key (e.g. 'ABCD...WXYZ').
 * Never returns or exposes the API Secret.
 */
export function getMaskedApiKey(env?: 'testnet' | 'production'): string | null {
  const targetEnv = env || getBinanceEnvironment();
  const key = (
    targetEnv === 'production'
      ? process.env.BINANCE_API_KEY
      : process.env.BINANCE_TESTNET_API_KEY
  )?.trim() || '';

  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
