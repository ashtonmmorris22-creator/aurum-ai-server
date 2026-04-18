const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory signal store (last 50 signals)
const signals = [];

// ─── WEBHOOK ENDPOINT ─────────────────────────────────────────────────────────
// TradingView sends alerts here
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 Webhook received:", JSON.stringify(payload, null, 2));

    // Expected payload from TradingView alert:
    // {
    //   "ticker": "XAUUSD",
    //   "price": "2345.50",
    //   "timeframe": "5",
    //   "high": "2350.00",
    //   "low": "2340.00",
    //   "open": "2342.00",
    //   "close": "2345.50",
    //   "volume": "12345",
    //   "rsi": "58.4",
    //   "ema20": "2338.00",
    //   "ema50": "2325.00",
    //   "atr": "8.50",
    //   "time": "{{timenow}}"
    // }

    const {
      ticker = "XAUUSD",
      price,
      timeframe = "5",
      high,
      low,
      open,
      close,
      volume,
      rsi,
      ema20,
      ema50,
      atr,
      time,
    } = payload;

    const currentPrice = parseFloat(price || close);
    const atrValue = parseFloat(atr) || currentPrice * 0.003;

    // Build market context string
    const marketContext = `
INSTRUMENT: Gold Futures (GC/MGC) — ${ticker}
TIMEFRAME: ${timeframe} minutes
CURRENT PRICE: ${currentPrice}
CANDLE: O=${open} H=${high} L=${low} C=${close}
VOLUME: ${volume || "N/A"}
INDICATORS:
  - RSI(14): ${rsi || "N/A"}
  - EMA(20): ${ema20 || "N/A"}
  - EMA(50): ${ema50 || "N/A"}
  - ATR(14): ${atrValue.toFixed(2)}
TIME: ${time || new Date().toISOString()}
    `.trim();

    // Claude analysis
    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: `You are an elite gold futures day trader. Given real-time market data, generate a precise trade signal.
Account: $10,000 | Risk per trade: 1% = $100 max | Instrument: GC/MGC gold futures
MGC = 10 oz/contract | GC = 100 oz/contract
Respond ONLY with valid JSON, no markdown or extra text.`,
      messages: [
        {
          role: "user",
          content: `Analyze this real-time gold futures data and generate a complete trade signal:

${marketContext}

Respond with this exact JSON structure:
{
  "direction": "BUY" | "SELL" | "WAIT",
  "confidence": <integer 40-95>,
  "entry": <price number>,
  "stopLoss": <price number>,
  "tp1": <price number>,
  "tp2": <price number>,
  "tp3": <price number or null>,
  "rrRatio": "<string like '1:2.4'>",
  "setup": "<pattern name>",
  "analysis": "<3 sentence technical reasoning>",
  "conditions": [
    {"label": "Trend", "status": "pass|warn|fail", "note": "<brief>"},
    {"label": "Momentum", "status": "pass|warn|fail", "note": "<brief>"},
    {"label": "Structure", "status": "pass|warn|fail", "note": "<brief>"},
    {"label": "Risk/Reward", "status": "pass|warn|fail", "note": "<brief>"}
  ],
  "executionNote": "<exact one-sentence entry instruction>",
  "microContracts": <integer, how many MGC contracts for $100 risk>,
  "riskPerOz": <number>
}`,
        },
      ],
    });

    const raw = message.content[0].text;
    const clean = raw.replace(/```json|```/g, "").trim();
    const signal = JSON.parse(clean);

    // Enrich with metadata
    signal.receivedAt = new Date().toISOString();
    signal.price = currentPrice;
    signal.timeframe = timeframe;
    signal.ticker = ticker;
    signal.id = Date.now();

    // Store signal
    signals.unshift(signal);
    if (signals.length > 50) signals.pop();

    console.log(`✅ Signal generated: ${signal.direction} @ ${signal.entry} (${signal.confidence}% confidence)`);
    res.json({ ok: true, signal });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET LATEST SIGNALS ───────────────────────────────────────────────────────
app.get("/signals", (req, res) => {
  res.json(signals);
});

// ─── GET LATEST SIGNAL ────────────────────────────────────────────────────────
app.get("/signals/latest", (req, res) => {
  res.json(signals[0] || null);
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ ok: true, signals: signals.length, uptime: process.uptime() });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🥇 Gold Signal Server running on port ${PORT}`);
  console.log(`📡 Webhook URL: https://YOUR-RAILWAY-URL/webhook`);
});
