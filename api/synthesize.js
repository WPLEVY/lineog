// /api/synthesize.js
// Combines real specialist answers into one clean, coherent final
// response. This is what replaces separate cards and external links
// with a single answer, the way a trusted advisor would summarize
// what the team found, not hand you off to each of them separately.

import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(req, res, { windowMs: 60000, maxRequests: 20 })) return;

  const { originalMessage, results } = req.body || {};

  if (!originalMessage || !Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'Original message and results are required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const resultsText = results
    .map(r => `${r.specialist}: ${r.answer}`)
    .join('\n\n');

  const prompt = `You are LINEOG, a trusted advisor. Your team of specialists just weighed in on this request: "${originalMessage}"

Here is what each specialist found:

${resultsText}

Write ONE clean, coherent response to the person, in your own voice, as if you personally consulted your team and are now summarizing the complete picture for them. Do not say "specialist X said..." repeatedly, weave it into one natural, well-organized answer. Plain prose, no markdown symbols like ** or bullet dashes, write the way you'd actually talk. Then, separately, decide if anything here contains a clear, durable fact, decision, or preference worth permanently remembering.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"reply":"the single synthesized answer","suggestedCommit":{"label":"...","value":"..."} or null}`;

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
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Could not synthesize an answer right now.' });
    }

    const data = await response.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Failed to parse synthesis output:', text);
      return res.status(502).json({ error: 'Got an unexpected response. Try again.' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/synthesize:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
