// /api/search-knowledge.js
// Secure server-side search over a user's committed knowledge.
// The Anthropic key lives only here, never sent to the browser.

import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(req, res, { windowMs: 60000, maxRequests: 20 })) return;

  const { question, commits } = req.body || {};
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const commitsText = (commits || [])
    .map(c => `- ${c.label}: ${c.value} (committed ${new Date(c.date).toLocaleString()})`)
    .join('\n');

  const prompt = `You are answering a question using ONLY the structured, committed knowledge below, not general knowledge, not assumptions. If the answer isn't in this knowledge, say so plainly rather than guessing.

Committed knowledge:
${commitsText || '(nothing committed yet)'}

Question: ${question.trim()}

Respond with ONLY valid JSON: {"answer":"your answer, 1-3 sentences","usedLabels":["label1","label2"]}`;

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
      return res.status(502).json({ error: 'Could not search right now.' });
    }

    const data = await response.json();
    let raw = (data.content || []).map(b => b.text || '').join('').trim();
    raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const result = JSON.parse(raw);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/search-knowledge:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
