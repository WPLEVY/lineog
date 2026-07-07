// /api/recommend.js
// Vercel serverless function. Runs on the server only — this file's contents
// are never sent to the browser, so the API key stays private here.

// Simple in-memory cache for identical, repeated questions.
// Caveat, worth knowing: this resets whenever Vercel spins up a fresh
// instance (a "cold start"), and isn't shared across multiple concurrent
// instances under real traffic. It's a free, honest first step that helps
// with obvious repeat questions, not a real distributed cache. If usage
// grows enough to matter, the real upgrade is Vercel KV or Upstash Redis,
// a small, separate piece of infrastructure worth adding once there's
// actual traffic data showing it's needed.
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { task } = req.body || {};

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: "Tell us what you're trying to do first." });
  }
  if (task.length > 2000) {
    return res.status(400).json({ error: 'That description is too long. Try summarizing it.' });
  }

  const normalized = task.trim().toLowerCase();
  const cached = cache.get(normalized);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return res.status(200).json(cached.result);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in the environment.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const prompt = `You match everyday tasks to the AI assistant best suited for them: ChatGPT, Claude, Gemini, Perplexity, or Grok. Base this on each model's realistic relative strengths as of 2026 (Claude: careful writing, nuanced or sensitive tone, careful reasoning and coding correctness; ChatGPT: broad general knowledge, fast casual answers, image generation, wide plugin ecosystem; Gemini: deep Google Workspace integration, very long documents, multimodal and search-grounded tasks; Perplexity: research questions, fact-finding, current information with cited sources; Grok: real-time information, current events, and topics tied to X/Twitter). Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape: {"recommended":"ChatGPT|Claude|Gemini|Perplexity|Grok","reason":"one or two plain, warm sentences a non-technical person would understand","runnerUp":{"name":"ChatGPT|Claude|Gemini|Perplexity|Grok","reason":"one short sentence"} or null,"confidence":"high|medium"}

Task: ${task.trim()}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Could not get a recommendation right now. Try again in a moment.' });
    }

    const data = await response.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Failed to parse model output as JSON:', text);
      return res.status(502).json({ error: 'Got an unexpected response. Try again.' });
    }

    const allowed = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok'];
    if (!allowed.includes(result.recommended)) {
      console.error('Model returned an unexpected recommendation:', result.recommended);
      return res.status(502).json({ error: 'Got an unexpected response. Try again.' });
    }

    // Basic, free visibility: this shows up in Vercel's function logs
    // (Project → Logs), giving you a real, if rough, sense of what people
    // are asking and what gets recommended, with no extra service needed.
    console.log('recommend:', normalized.slice(0, 120), '->', result.recommended);

    cache.set(normalized, { result, time: Date.now() });

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/recommend:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
}

// Note on CORS: deliberately not adding Access-Control-Allow-Origin headers here.
// Without them, only requests from this same site can call this endpoint.
// Adding a wildcard origin would let any other website use your API key
// through this function, defeating the point of hiding it server-side.
