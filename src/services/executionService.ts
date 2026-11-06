import {
  AccountBalance,
  BinanceCredentials,
  BotSettings,
  ClosedTrade,
  FuturesSymbolInfo,
  Position,
  TradeDirection,
} from '../types/trading';
import { BinanceService } from './binanceService';
import { RiskManagementService } from './riskManagementService';
import { TraderSkillMasterEngine } from './traderSkillEngine';

export interface ExecutionRequest {
  symbol: string;
  side: TradeDirection;
  rationale: string;
  customLeverage?: number;
  customAmountUsd?: number;
  overrideLimits?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  position?: Position;
  error?: string;
  rejectionReason?: string;
  isRealOrder: boolean;
}

export class ExecutionService {
  private static executionLock = new Set<string>();

  /**
   * Executes an order through the unified risk management gatekeeper
   */
  static async executeOrder(
    req: ExecutionRequest,
    symbolInfo: FuturesSymbolInfo,
    plannedStopLossPrice: number,
    plannedTakeProfitPrice: number,
    tp1Price: number,
    tp2Price: number,
    tp3Price: number,
    balance: AccountBalance,
    openPositions: Position[],
    closedTrades: ClosedTrade[],
    settings: BotSettings,
    credentials: BinanceCredentials,
    isRealMode: boolean,
    isTestnet: boolean
  ): Promise<ExecutionResult> {
    const symbol = req.symbol;
    const lockKey = `${symbol}-${req.side}`;

    if (this.executionLock.has(lockKey)) {
      return {
        success: false,
        error: 'Execution lock active: A concurrent order for this symbol is currently being processed.',
        isRealOrder: isRealMode,
      };
    }

    this.executionLock.add(lockKey);
    setTimeout(() => this.executionLock.delete(lockKey), 8000);

    try {
      const entryPrice = symbolInfo.price;
      const totalEquity = balance.totalMarginBalance || balance.totalWalletBalance || 0;

      const freeMargin = balance.availableBalance !== undefined && balance.availableBalance !== null
        ? balance.availableBalance
        : totalEquity;

      // 1. Mandatory Risk-Based Sizing
      const sizing = RiskManagementService.calculatePositionSize(
        totalEquity,
        entryPrice,
        plannedStopLossPrice,
        symbolInfo,
        settings,
        req.customLeverage,
        freeMargin
      );

      if (!sizing.allowed) {
        return {
          success: false,
          rejectionReason: sizing.rejectionReason,
          error: sizing.rejectionReason,
          isRealOrder: isRealMode,
        };
      }

      // 2. Pre-Trade Risk Gatekeeper (Trader-Skill 11 Modules Pack - 95% Authority)
      const traderSkillRisk = TraderSkillMasterEngine.verifyPreTrade(
        symbol,
        req.side,
        sizing.marginRequiredUsd,
        entryPrice,
        plannedStopLossPrice,
        plannedTakeProfitPrice,
        balance,
        openPositions,
        settings
      );

      if (traderSkillRisk.verdict === 'BLOCK' && !req.overrideLimits) {
        const primaryReason = traderSkillRisk.reasons[0] || 'Order blocked by Trader-Skill Risk Gatekeeper.';
        return {
          success: false,
          rejectionReason: `[Trader-Skill Risk Gate] ${primaryReason}`,
          error: primaryReason,
          isRealOrder: isRealMode,
        };
      }

      // 3. Mandatory Risk Validation Gatekeeper
      const riskCheck = RiskManagementService.validateOrderRisk(
        symbol,
        req.side,
        sizing.quantity,
        entryPrice,
        plannedStopLossPrice,
        balance,
        openPositions,
        closedTrades,
        settings,
        req.overrideLimits
      );

      if (!riskCheck.isValid) {
        return {
          success: false,
          rejectionReason: riskCheck.rejectionReason,
          error: riskCheck.rejectionReason,
          isRealOrder: isRealMode,
        };
      }

      // 3. Binance Direct Execution (Supports both Binance Demo and Binance Live)
      const hasBinanceCreds = Boolean(credentials.apiKey && credentials.apiSecret);
      const shouldExecuteOnBinance = isRealMode || (hasBinanceCreds && credentials.isValidated);

      if (shouldExecuteOnBinance) {
        if (!credentials.isValidated && !hasBinanceCreds) {
          return {
            success: false,
            error: 'Binance execution requires a validated API connection. Please verify connection in Settings.',
            isRealOrder: true,
          };
        }

        // For Live Real Trading (non-testnet), verify user has entered valid credentials
        if (!credentials.isTestnet && !settings.productionConfirmed && !hasBinanceCreds) {
          return {
            success: false,
            error: 'Production trading requires validated credentials before order placement.',
            isRealOrder: true,
          };
        }

        // Adjust leverage on Binance with adaptive clamping (never exceeds user settings, steps down if symbol cap is lower)
        const levRes = await BinanceService.setLeverage(credentials, symbol, sizing.effectiveLeverage);
        const actualLeverage = levRes.success && levRes.effectiveLeverage ? levRes.effectiveLeverage : sizing.effectiveLeverage;
        const actualMarginUsd = Number(((sizing.quantity * entryPrice) / actualLeverage).toFixed(2));

        // Submit Entry order with automatic Stop Loss (SL) and Take Profit (TP) orders directly to Binance API
        const orderSide = req.side === 'LONG' ? 'BUY' : 'SELL';
        const clientOrderId = `apex-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const pricePrecision = symbolInfo.pricePrecision ?? 4;
        const formattedStopPrice = Number(plannedStopLossPrice.toFixed(pricePrecision));
        const formattedTpPrice = Number(plannedTakeProfitPrice.toFixed(pricePrecision));

        const bracketResult = await BinanceService.placeBracketOrder(credentials, {
          symbol,
          side: orderSide,
          quantity: sizing.quantity,
          leverage: actualLeverage,
          stopLossPrice: formattedStopPrice,
          takeProfitPrice: formattedTpPrice,
          clientOrderId,
        });

        if (!bracketResult.success || !bracketResult.order) {
          const rawErr = bracketResult.error || 'Binance order submission rejected.';
          const isMarginErr = rawErr.toLowerCase().includes('margin is insufficient');
          const localizedMsg = isMarginErr
            ? `الهامش الحر المتاح حالياً ($${(balance.availableBalance ?? 0).toFixed(2)}) غير كافٍ لفتح صفقة جديدة، لأن السيولة محجوزة بالكامل في صفقاتك المفتوحة حالياً. ستتمكن من فتح صفقات جديدة بمجرد إغلاق إحدى الصفقات الرابحة وتحرير هامشها.`
            : rawErr;

          return {
            success: false,
            error: localizedMsg,
            rejectionReason: localizedMsg,
            isRealOrder: true,
          };
        }

        const exchangeOrder = bracketResult.order;
        const executedAvgPrice =
          exchangeOrder && parseFloat(exchangeOrder.avgPrice) > 0
            ? parseFloat(exchangeOrder.avgPrice)
            : entryPrice;

        let exchangeStopOrderId: string | undefined = bracketResult.slOrderId;
        let exchangeTpOrderId: string | undefined = bracketResult.tpOrderId;

        // Fallback verification: If SL or TP did not yield an ID, execute direct protective submission
        const protectiveSide = req.side === 'LONG' ? 'SELL' : 'BUY';
        if (!exchangeStopOrderId && formattedStopPrice > 0) {
          try {
            const stopRes = await BinanceService.placeProtectiveStopOrder(
              credentials,
              symbol,
              protectiveSide,
              formattedStopPrice,
              sizing.quantity,
              pricePrecision
            );
            if (stopRes.success && stopRes.order?.orderId) {
              exchangeStopOrderId = stopRes.order.orderId.toString();
            }
          } catch (e) {
            console.warn('Fallback protective SL failed:', e);
          }
        }

        if (!exchangeTpOrderId && formattedTpPrice > 0) {
          try {
            const tpRes = await BinanceService.placeTakeProfitOrder(
              credentials,
              symbol,
              protectiveSide,
              formattedTpPrice,
              sizing.quantity,
              pricePrecision
            );
            if (tpRes.success && tpRes.order?.orderId) {
              exchangeTpOrderId = tpRes.order.orderId.toString();
            }
          } catch (e) {
            console.warn('Fallback protective TP failed:', e);
          }
        }

        const newPosition: Position = {
          id: `pos-real-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          symbol,
          side: req.side,
          entryPrice: executedAvgPrice,
          markPrice: executedAvgPrice,
          quantity: sizing.quantity,
          amountUsd: actualMarginUsd,
          notionalValue: Number((sizing.quantity * executedAvgPrice).toFixed(2)),
          leverage: actualLeverage,
          liquidationPrice:
            req.side === 'LONG'
              ? executedAvgPrice * (1 - 0.9 / actualLeverage)
              : executedAvgPrice * (1 + 0.9 / actualLeverage),
          unrealizedProfit: 0,
          pnlPercentage: 0,
          stopLossPrice: plannedStopLossPrice,
          takeProfitPrice: plannedTakeProfitPrice,
          tp1Price,
          tp2Price,
          tp3Price,
          tpLevelReached: 0,
          initialStopLossPrice: plannedStopLossPrice,
          securedProfitUsd: 0,
          highestPriceReached: executedAvgPrice,
          lowestPriceReached: executedAvgPrice,
          exchangeEntryOrderId: exchangeOrder?.orderId ? exchangeOrder.orderId.toString() : undefined,
          exchangeStopLossOrderId: exchangeStopOrderId,
          exchangeTakeProfitOrderId: exchangeTpOrderId,
          stopLossOrderStatus: exchangeStopOrderId ? 'ACTIVE' : 'UNSUBMITTED',
          takeProfitOrderStatus: exchangeTpOrderId ? 'ACTIVE' : 'UNSUBMITTED',
          lastReconciliationTime: Date.now(),
          reconciliationStatus: exchangeStopOrderId ? 'IN_SYNC' : 'DESYNC_DETECTED',
          reconciliationMessage:
            exchangeStopOrderId && exchangeTpOrderId
              ? 'Order, native SL and TP confirmed on Binance.'
              : exchangeStopOrderId
              ? 'Order and protective SL confirmed on Binance.'
              : 'Warning: Protective order pending on exchange.',
          estimatedCommissionUsd: Number((sizing.notionalValue * 0.0005).toFixed(3)),
          fundingFeeUsd: 0,
          slippageEstimateUsd: Number((sizing.notionalValue * 0.0002).toFixed(3)),
          openedAt: Date.now(),
          maxDurationMs: settings.maxTradeDurationHours * 3600 * 1000,
          aiConfidence: symbolInfo.aiScore || 75,
          rationale: req.rationale,
          isRealOrder: true,
          isTestnet,
        };

        return {
          success: true,
          position: newPosition,
          isRealOrder: true,
        };
      }

      // 4. Paper Trading Sandbox Execution
      const newPosition: Position = {
        id: `pos-paper-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        symbol,
        side: req.side,
        entryPrice,
        markPrice: entryPrice,
        quantity: sizing.quantity,
        amountUsd: sizing.marginRequiredUsd,
        notionalValue: sizing.notionalValue,
        leverage: sizing.effectiveLeverage,
        liquidationPrice:
          req.side === 'LONG'
            ? entryPrice * (1 - 0.9 / sizing.effectiveLeverage)
            : entryPrice * (1 + 0.9 / sizing.effectiveLeverage),
        unrealizedProfit: 0,
        pnlPercentage: 0,
        stopLossPrice: plannedStopLossPrice,
        takeProfitPrice: plannedTakeProfitPrice,
        tp1Price,
        tp2Price,
        tp3Price,
        tpLevelReached: 0,
        initialStopLossPrice: plannedStopLossPrice,
        securedProfitUsd: 0,
        highestPriceReached: entryPrice,
        lowestPriceReached: entryPrice,
        stopLossOrderStatus: 'ACTIVE',
        takeProfitOrderStatus: 'ACTIVE',
        lastReconciliationTime: Date.now(),
        reconciliationStatus: 'IN_SYNC',
        reconciliationMessage: 'Paper Sandbox simulation active.',
        estimatedCommissionUsd: Number((sizing.notionalValue * 0.0005).toFixed(3)),
        fundingFeeUsd: 0,
        slippageEstimateUsd: Number((sizing.notionalValue * 0.0002).toFixed(3)),
        openedAt: Date.now(),
        maxDurationMs: settings.maxTradeDurationHours * 3600 * 1000,
        aiConfidence: symbolInfo.aiScore || 75,
        rationale: req.rationale,
        isRealOrder: false,
        isTestnet: false,
      };

      return {
        success: true,
        position: newPosition,
        isRealOrder: false,
      };
    } finally {
      this.executionLock.delete(lockKey);
    }
  }
}
