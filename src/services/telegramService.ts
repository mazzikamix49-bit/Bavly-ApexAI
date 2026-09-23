import { ClosedTrade, Position, TelegramSettings } from '../types/trading';

export class TelegramService {
  static async sendMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
    if (!botToken || !chatId) return false;
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken,
          chatId,
          message: text,
        }),
      });
      const data = await res.json();
      return !!data.success;
    } catch (err) {
      console.error('Telegram notification error:', err);
      return false;
    }
  }

  static async notifyPositionOpened(settings: TelegramSettings, position: Position, isArabic: boolean) {
    if (!settings.enabled || !settings.notifyOnOpen) return;

    const emoji = position.side === 'LONG' ? '🟢 🚀' : '🔴 📉';
    const text = isArabic
      ? `<b>${emoji} صفقة عقود آجلة جديدة مفتوحة!</b>\n\n` +
        `• <b>الزوج:</b> ${position.symbol}\n` +
        `• <b>النوع:</b> ${position.side === 'LONG' ? 'شراء (LONG)' : 'بيع (SHORT)'}\n` +
        `• <b>سعر الدخول:</b> $${position.entryPrice.toLocaleString()}\n` +
        `• <b>الرافعة:</b> ${position.leverage}x\n` +
        `• <b>حجم الصفقة:</b> $${position.amountUsd.toFixed(2)}\n` +
        `• <b>هدف الربح (TP):</b> $${position.takeProfitPrice.toLocaleString()}\n` +
        `• <b>وقف الخسارة (SL):</b> $${position.stopLossPrice.toLocaleString()}\n` +
        `• <b>ثقة الذكاء الاصطناعي:</b> ${position.aiConfidence}%\n` +
        `• <b>السبب:</b> ${position.rationale}\n\n` +
        `⚡ <i>بوت Bavly ApexAI يعمل 24/7 لمتابعة وإغلاق الصفقة آلياً</i>`
      : `<b>${emoji} NEW BINANCE FUTURES ORDER OPENED!</b>\n\n` +
        `• <b>Pair:</b> ${position.symbol}\n` +
        `• <b>Direction:</b> ${position.side}\n` +
        `• <b>Entry Price:</b> $${position.entryPrice.toLocaleString()}\n` +
        `• <b>Leverage:</b> ${position.leverage}x\n` +
        `• <b>Size:</b> $${position.amountUsd.toFixed(2)}\n` +
        `• <b>Take Profit:</b> $${position.takeProfitPrice.toLocaleString()}\n` +
        `• <b>Stop Loss:</b> $${position.stopLossPrice.toLocaleString()}\n` +
        `• <b>AI Confidence:</b> ${position.aiConfidence}%\n\n` +
        `⚡ <i>Bavly ApexAI 24/7 Autonomous Bot Tracking</i>`;

    await this.sendMessage(settings.botToken, settings.chatId, text);
  }

  static async notifyPositionClosed(settings: TelegramSettings, trade: ClosedTrade, isArabic: boolean) {
    if (!settings.enabled || !settings.notifyOnClose) return;

    const isWin = trade.wasWinning;
    const emoji = isWin ? '💰 🎯 WIN' : '🛡️ 🛑 STOP LOSS / EXIT';
    const pnlSign = trade.pnl >= 0 ? '+' : '';

    const text = isArabic
      ? `<b>${emoji} - تم إغلاق صفقة فيوتشرز!</b>\n\n` +
        `• <b>الزوج:</b> ${trade.symbol}\n` +
        `• <b>النوع:</b> ${trade.side}\n` +
        `• <b>سعر الدخول:</b> $${trade.entryPrice.toLocaleString()}\n` +
        `• <b>سعر الخروج:</b> $${trade.exitPrice.toLocaleString()}\n` +
        `• <b>صافي الربح / الخسارة:</b> <b>${pnlSign}$${trade.pnl.toFixed(2)} (${pnlSign}${trade.pnlPercentage.toFixed(2)}%)</b>\n` +
        `• <b>سبب الإغلاق:</b> ${trade.exitReason}\n` +
        `• <b>مدة الصفقة:</b> ${Math.round(trade.durationMs / 60000)} دقيقة\n\n` +
        `🧠 <i>تم إرسال نتيجة الصفقة لمحرك التعلم الذاتي لتحديث أوزان الذكاء الاصطناعي</i>`
      : `<b>${emoji} - POSITION CLOSED!</b>\n\n` +
        `• <b>Pair:</b> ${trade.symbol}\n` +
        `• <b>Side:</b> ${trade.side}\n` +
        `• <b>Entry:</b> $${trade.entryPrice.toLocaleString()}\n` +
        `• <b>Exit:</b> $${trade.exitPrice.toLocaleString()}\n` +
        `• <b>Net PnL:</b> <b>${pnlSign}$${trade.pnl.toFixed(2)} (${pnlSign}${trade.pnlPercentage.toFixed(2)}%)</b>\n` +
        `• <b>Exit Reason:</b> ${trade.exitReason}\n` +
        `• <b>Duration:</b> ${Math.round(trade.durationMs / 60000)} mins\n\n` +
        `🧠 <i>Results fed into AI continuous reinforcement learning engine</i>`;

    await this.sendMessage(settings.botToken, settings.chatId, text);
  }
}
