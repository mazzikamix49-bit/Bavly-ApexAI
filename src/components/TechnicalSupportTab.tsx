import React, { useState } from 'react';
import { useTrading } from '../context/TradingContext';
import {
  Bot,
  HelpCircle,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  User,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
}

export const TechnicalSupportTab: React.FC = () => {
  const { t, language } = useTrading();
  const isArabic = language === 'ar';

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text:
        isArabic
          ? 'مرحباً بك في مركز الدعم الفني الذكي لبوت Bavly ApexAI! 🤖\n\nأنا هنا لمساعدتك على مدار الساعة 24/7:\n• شرح كيفية استخراج مفاتيح Binance API وتفعيل صلاحيات Futures.\n• توضيح الفرق بين الهامش المعزول (Isolated) والمشترك (Cross).\n• كيفية تشغيل البوت بدون أي برمجة أو بايثون وبشكل تلقائي 24/7.\n• أفضل إعدادات إدارة المخاطر لحماية رأس المال.\n\nكيف يمكنني مساعدتك الآن؟'
          : 'Welcome to Bavly ApexAI 24/7 Technical Support Assistant! 🤖\n\nI am here around the clock to help you:\n• How to generate Binance API keys with Futures trading permissions.\n• Isolated vs Cross margin management.\n• Operating the bot without Python or coding in automated 24/7 mode.\n• Optimal risk management to prevent liquidations.\n\nHow can I help you today?',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const handleSend = async (textToSend?: string) => {
    const question = textToSend || input;
    if (!question.trim()) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: question,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          language,
        }),
      });

      const data = await res.json();
      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text:
          data.reply ||
          (isArabic
            ? 'شكراً لسؤالك. يمكنك مراجعة لوحة الإعدادات لضبط مفاتيح API الخاصة بك وتفعيل التداول الآلي 24/7.'
            : 'Thank you for your question. You can review the Settings panel to configure your Binance API keys and enable automated 24/7 trading.'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiReply]);
    } catch (err) {
      console.error('Chat error:', err);
    } finally {
      setLoading(false);
    }
  };

  const quickChips = [
    t.q1,
    t.q2,
    t.q3,
    t.q4,
  ];

  return (
    <div className="bg-[#121824] border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col h-[650px]">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>{t.supportTitle}</span>
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                ONLINE
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {t.supportDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {messages.map((msg) => {
          const isAi = msg.sender === 'ai';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 max-w-[85%] ${
                isAi ? '' : 'ml-auto flex-row-reverse'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                  isAi
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>

              <div
                className={`p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow ${
                  isAi
                    ? 'bg-slate-900/90 text-slate-200 border border-slate-800'
                    : 'bg-amber-500 text-black font-medium'
                }`}
              >
                {msg.text}
                <div
                  className={`text-[9px] mt-1 text-right font-mono ${
                    isAi ? 'text-slate-500' : 'text-black/60'
                  }`}
                >
                  {msg.time}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs font-mono p-2">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            <span>{isArabic ? 'الذكاء الاصطناعي يحلل ويكتب الإجابة...' : 'AI Quant analyzing and drafting response...'}</span>
          </div>
        )}
      </div>

      {/* Quick Chips */}
      <div className="px-4 py-2 bg-slate-900/40 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="text-slate-500 text-[11px] shrink-0 font-medium">
          {t.quickQuestions}
        </span>
        {quickChips.map((chip, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(chip)}
            className="px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 text-slate-300 hover:text-white border border-slate-700/50 shrink-0 text-[11px] transition"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.askQuestionPlaceholder}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition flex items-center gap-1.5 disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5 fill-black" />
            <span>{t.send}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
