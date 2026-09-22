import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

// Lazy AI Client initializer
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Quota & Rate Limit Cooldown Manager
let quotaCooldownUntil = 0;

function isQuotaExhausted(): boolean {
  return Date.now() < quotaCooldownUntil;
}

function handleAPIError(featureName: string, err: any): { isQuota: boolean; message: string } {
  const errMsg = err?.message || String(err);
  const isQuota =
    err?.status === 429 ||
    errMsg.includes("429") ||
    errMsg.includes("RESOURCE_EXHAUSTED") ||
    errMsg.includes("quota") ||
    errMsg.includes("rate-limits");

  if (isQuota) {
    // Put API into 60s cooldown to prevent repeated rejected calls
    quotaCooldownUntil = Date.now() + 60 * 1000;
    console.warn(`[Gemini API] Quota/Rate limit reached for ${featureName}. Activating simulated telemetry & fallback cache for 60s.`);
  } else {
    console.warn(`[Gemini API] ${featureName} graceful fallback triggered: ${errMsg.slice(0, 120)}`);
  }

  return { isQuota, message: errMsg };
}

// Curated Grounding Fallbacks for Hackathon Milestones
const CURATED_BOSS_GROUNDINGS: Record<string, { flavor: string; sources: string[] }> = {
  "1": {
    flavor: "Upstream Chromium RFC-8288 CORS preflight security patch rejected multi-origin Authorization headers on port 3000. Staging clusters report 403 Forbidden spikes across OAuth redirect routes!",
    sources: [
      "https://developers.google.com/search",
      "https://news.ycombinator.com",
      "https://github.com/expressjs/cors/issues"
    ]
  },
  "2": {
    flavor: "Redis Sentinel split-brain anomaly and unhandled asynchronous micro-task deadlocks pegged worker CPU at 99.8%. Engineers advise implementing exponential backoff retry jitter immediately!",
    sources: [
      "https://redis.io/docs/management/sentinel",
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
      "https://news.ycombinator.com"
    ]
  },
  "3": {
    flavor: "Zero-day connection exhaustion on multi-region database replication locks write transactions before demo day. SRE teams recommend read-replica failovers and aggressive caching layers.",
    sources: [
      "https://cloud.google.com/spanner/docs/latency-guide",
      "https://github.com/nodejs/node/issues",
      "https://news.ycombinator.com"
    ]
  }
};

const groundingCache: Record<string, { groundedFlavor: string; sources: string[] }> = {};

// 1. API Status Endpoint
app.get("/api/ai/status", (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const quotaLimited = isQuotaExhausted();

  res.json({
    configured: hasKey,
    quotaLimited,
    models: {
      chat: "gemini-3.5-flash",
      grounding: "gemini-3.5-flash (Google Search)",
      images: "gemini-3.1-flash-lite-image",
      tts: "gemini-3.1-flash-tts-preview",
      video: "veo-3.1-lite-generate-preview",
    },
    message: hasKey
      ? (quotaLimited
          ? "Google AI Studio: Quota Cooldown Active (Resilient Telemetry Cache Engaged)"
          : "Google AI Studio Live Services Online (Search Grounding, Gemini 3.5, Imagen, TTS, Veo)")
      : "Running in Offline / Client-Simulated Mode (Procedural Fallbacks Enabled)",
  });
});

// 2. Lead Guildmaster 3AM Standup Chat & Roast
app.post("/api/ai/roast", async (req, res) => {
  const ai = getAIClient();
  const { roster, boss, timeRemaining, guildXP, stamina, message } = req.body;

  const names = (roster || []).filter(Boolean).map((r: any) => `${r.name} (${r.title})`).join(", ");
  const fallbackRoast = `[Lead Guildmaster 3AM Tactical Sync]: Team roster (${names || "Incomplete Roster"}) has ${stamina || 100} stamina facing "${boss?.name || "Milestone Boss"}". Watch your role synergies! Ensure you pair high debug with velocity before you commit. Coffee is hot—push the build!`;

  if (!ai || isQuotaExhausted()) {
    return res.json({
      success: true,
      fallback: true,
      text: fallbackRoast,
    });
  }

  try {
    const rosterSummary = (roster || [])
      .filter(Boolean)
      .map((m: any, idx: number) => `Slot ${idx + 1}: ${m.name} - ${m.title} [Tag: #${m.synergyTag}, Vel: ${m.velocity}, Dbg: ${m.debug}, UI: ${m.uix}]`)
      .join("\n");

    const prompt = `Current Hackathon Situation:
Time Remaining: ${Math.floor((timeRemaining || 0) / 3600)}h ${Math.floor(((timeRemaining || 0) % 3600) / 60)}m
Current Boss Challenge: ${boss?.name || "Milestone 1"} (Threshold: ${boss?.threshold || 250} PWR)
Active Team Roster:
${rosterSummary || "No active heroes drafted yet!"}
Guild XP: ${guildXP || 0} PTS | Stamina: ${stamina || 0}/100

User message / action: ${message || "Roast our current team setup and give us 3AM tactical advice."}

Respond as the AI Lead Guildmaster: a cynical, sharp, brilliant senior tech lead who has won 10 hackathons. Be witty, slightly snarky about their tech stack or missing roles, but give 1 actionable high-IQ tactical recommendation. Keep it under 75 words.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an elite, highly caffeinated AI Lead Guildmaster at a 48-hour student hackathon. Punchy, witty, high-IQ, and strategic.",
        temperature: 0.8,
      },
    });

    res.json({
      success: true,
      fallback: false,
      text: response.text || "Keep shipping. Coffee is cheap, demo day isn't.",
    });
  } catch (err: any) {
    handleAPIError("Standup Roast", err);
    res.json({
      success: true,
      fallback: true,
      text: fallbackRoast,
    });
  }
});

// 3. Boss Milestone Grounding with Google Search
app.post("/api/ai/search-boss", async (req, res) => {
  const { bossPhase, bossName } = req.body;
  const phaseKey = String(bossPhase || 1);
  const cacheKey = `${phaseKey}_${bossName || "boss"}`;

  // Check in-memory cache first to conserve quota
  if (groundingCache[cacheKey]) {
    return res.json({
      success: true,
      fallback: false,
      groundedFlavor: groundingCache[cacheKey].groundedFlavor,
      sources: groundingCache[cacheKey].sources,
      cached: true,
    });
  }

  const curated = CURATED_BOSS_GROUNDINGS[phaseKey] || CURATED_BOSS_GROUNDINGS["1"];

  const ai = getAIClient();
  if (!ai || isQuotaExhausted()) {
    return res.json({
      success: true,
      fallback: true,
      groundedFlavor: curated.flavor,
      sources: curated.sources,
    });
  }

  try {
    const prompt = `Search for recent breaking developer news, popular runtime nightmares, or tech memes related to: ${bossName || "developer authentication and cloud deployment"}. Summarize 1 real-world breaking incident or critical developer trap in 2 punchy sentences to serve as live boss battlefield flavor text for a hackathon team challenge.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.7,
      },
    });

    const sources: string[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && Array.isArray(chunks)) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri) sources.push(chunk.web.uri);
      });
    }

    const flavor = response.text || curated.flavor;
    const finalSources = sources.length > 0 ? sources.slice(0, 3) : curated.sources;

    // Store in cache
    groundingCache[cacheKey] = {
      groundedFlavor: flavor,
      sources: finalSources,
    };

    res.json({
      success: true,
      fallback: false,
      groundedFlavor: flavor,
      sources: finalSources,
    });
  } catch (err: any) {
    handleAPIError("Search Grounding", err);
    res.json({
      success: true,
      fallback: true,
      groundedFlavor: curated.flavor,
      sources: curated.sources,
    });
  }
});

// 4. Imagen 3 Student Portrait Generation
app.post("/api/ai/portrait", async (req, res) => {
  const { name, title, synergyTag } = req.body;
  const ai = getAIClient();

  if (!ai || isQuotaExhausted()) {
    return res.json({
      success: false,
      fallback: true,
      message: "Procedural cyber-avatar SVG active.",
    });
  }

  try {
    const prompt = `A cyber-academic digital anime portrait icon of student hacker named ${name}, who is a ${title} with ${synergyTag} energy. Glowing neon glasses, dark futuristic university hoodie, subtle 3AM terminal glow on face, dark slate background with electric teal and violet lighting, digital art, high quality avatar.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-image",
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    let imageUrl: string | null = null;
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageUrl = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (imageUrl) {
      res.json({ success: true, imageUrl, fallback: false });
    } else {
      res.json({ success: false, fallback: true });
    }
  } catch (err: any) {
    handleAPIError("Portrait Generation", err);
    res.json({ success: false, fallback: true });
  }
});

// 5. Gemini Voice / TTS Narration Hook
app.post("/api/ai/narrate", async (req, res) => {
  const { text, voice } = req.body;
  const ai = getAIClient();

  if (!ai || isQuotaExhausted()) {
    return res.json({
      success: false,
      fallback: true,
      message: "Client Web Audio speech synthesis active.",
    });
  }

  try {
    const prompt = `Say with intense energy like an energetic esports caster at a tech hackathon: "${text || "Hackathon deployment commencing now!"}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || "Kore" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      res.json({ success: true, audio: base64Audio, mimeType: "audio/wav", fallback: false });
    } else {
      res.json({ success: false, fallback: true });
    }
  } catch (err: any) {
    handleAPIError("TTS Narration", err);
    res.json({ success: false, fallback: true });
  }
});

// 6. Veo Text-to-Video Cutscene Dispatcher
app.post("/api/ai/cutscene", async (req, res) => {
  const { bossName, outcome } = req.body;
  const ai = getAIClient();

  if (!ai || isQuotaExhausted()) {
    return res.json({
      success: true,
      fallback: true,
      prompt: `Cinematic breakdown sequence for ${bossName}`,
      message: "Client fallback kinetic particle canvas activated.",
    });
  }

  try {
    const prompt = outcome === "win"
      ? `A dynamic 3-second sci-fi cinematic cutscene of a cybernetic glitch monster representing ${bossName} dissolving into sparkling neon green binary code and glowing 200 OK data streams, futuristic cyber hackathon aesthetic.`
      : `A dynamic 3-second sci-fi cinematic cutscene of a computer terminal blinking emergency red alert with 500 server error warnings cascading across dark glass screens, neon glitch sparks.`;

    const operation = await ai.models.generateVideos({
      model: "veo-3.1-lite-generate-preview",
      prompt,
      config: {
        numberOfVideos: 1,
        resolution: "720p",
        aspectRatio: "16:9",
      },
    });

    res.json({
      success: true,
      fallback: false,
      operationName: operation.name,
      prompt,
    });
  } catch (err: any) {
    handleAPIError("Veo Cutscene", err);
    res.json({
      success: true,
      fallback: true,
      prompt: `Cinematic particle breakdown of ${bossName}`,
      message: "Canvas particle fallback triggered.",
    });
  }
});

// Setup Vite middleware in dev, static serving in prod
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GUILDMASTERS backend running at http://0.0.0.0:${PORT}`);
  });
}

start();
