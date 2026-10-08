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

      // 1. Mandatory Risk-Based Sizing
      const sizing = RiskManagementService.calculatePositionSize(
        totalEquity,
        entryPrice,
        plannedStopLossPrice,
        symbolInfo,
        settings,
        req.customLeverage
      );

      if (!sizing.allowed) {
        return {
          success: false,
          rejectionReason: sizing.rejectionReason,
          error: sizing.rejectionReason,
          isRealOrder: isRealMode,
        };
      }

      // 2. Mandatory Risk Validation Gatekeeper
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

      // 3. Real Trading Guard: Require explicit user confirmation and valid credentials
      if (isRealMode) {
        if (!credentials.isValidated) {
          return {
            success: false,
            error: 'Real Mode requires validated Binance API connection. Please verify connection in Settings.',
            isRealOrder: true,
          };
        }

        if (!settings.productionConfirmed) {
          return {
            success: false,
            error: 'Production trading requires explicit user confirmation before order placement.',
            isRealOrder: true,
          };
        }

        // Adjust leverage on Binance
        await BinanceService.setLeverage(credentials, symbol, sizing.effectiveLeverage);

        // Place main entry order on Binance
        const orderSide = req.side === 'LONG' ? 'BUY' : 'SELL';
        const clientOrderId = `apex-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

        const entryOrderRes = await BinanceService.placeOrder(
          credentials,
          symbol,
          orderSide,
          sizing.quantity,
          false,
          clientOrderId
        );

        if (!entryOrderRes.success) {
          return {
            success: false,
            error: entryOrderRes.error || 'Binance order submission rejected.',
            isRealOrder: true,
          };
        }

        const exchangeOrder = entryOrderRes.order;
        const executedAvgPrice =
          exchangeOrder && parseFloat(exchangeOrder.avgPrice) > 0
            ? parseFloat(exchangeOrder.avgPrice)
            : entryPrice;

        // Place exchange-side protective STOP_MARKET order
        const protectiveSide = req.side === 'LONG' ? 'SELL' : 'BUY';
        let exchangeStopOrderId: string | undefined;

        try {
          const stopRes = await BinanceService.placeProtectiveStopOrder(
            credentials,
            symbol,
            protectiveSide,
            plannedStopLossPrice,
            sizing.quantity
          );
          if (stopRes.success && stopRes.order?.orderId) {
            exchangeStopOrderId = stopRes.order.orderId.toString();
          }
        } catch (e) {
          console.warn('Failed placing exchange-side stop order:', e);
        }

        const newPosition: Position = {
          id: `pos-real-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          symbol,
          side: req.side,
          entryPrice: executedAvgPrice,
          markPrice: executedAvgPrice,
          quantity: sizing.quantity,
          amountUsd: sizing.marginRequiredUsd,
          notionalValue: sizing.notionalValue,
          leverage: sizing.effectiveLeverage,
          liquidationPrice:
            req.side === 'LONG'
              ? executedAvgPrice * (1 - 0.9 / sizing.effectiveLeverage)
              : executedAvgPrice * (1 + 0.9 / sizing.effectiveLeverage),
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
          stopLossOrderStatus: exchangeStopOrderId ? 'ACTIVE' : 'UNSUBMITTED',
          takeProfitOrderStatus: 'UNSUBMITTED',
          lastReconciliationTime: Date.now(),
          reconciliationStatus: exchangeStopOrderId ? 'IN_SYNC' : 'DESYNC_DETECTED',
          reconciliationMessage: exchangeStopOrderId
            ? 'Order and protective SL confirmed on Binance.'
            : 'Warning: Protective STOP_MARKET order not confirmed on exchange!',
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
