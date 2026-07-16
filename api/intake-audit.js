// /api/intake-audit.js
// Real analysis of whatever someone pastes at intake, not a scripted
// demo. Finds genuine contradictions, vague facts, missing dates, and
// buried decisions, and extracts real structured objects for the
// Knowledge Layer (People, Companies, Preferences, dated Facts).

import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(req, res, { windowMs: 60000, maxRequests: 10 })) return;

  const { pastedText } = req.body || {};
  if (!pastedText || typeof pastedText !== 'string' || pastedText.trim().length < 20) {
    return res.status(400).json({ error: 'Paste something with a bit more substance, a memory summary or a real conversation.' });
  }
  if (pastedText.length > 12000) {
    return res.status(400).json({ error: "That's a lot, try a shorter excerpt." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const prompt = `You are a sharp, observant trusted advisor reviewing something a person pasted from another AI system (a memory summary, or a conversation). Review it the way a good attorney or CPA would in a first meeting, not summarizing, actually looking for problems that would affect the quality of future advice.

Find:
- Contradictions: two things that don't quite agree
- Vague facts: things stated in a way that will go stale or isn't specific enough to act on
- Missing dates: important information with no way to know when it was true
- Buried decisions: a real decision mentioned in passing, not marked as one

Pick the 2 or 3 sharpest, most real observations, not a generic list. Reference the actual content, in the person's own words where relevant. If there's genuinely nothing worth flagging, say so honestly, don't invent a problem.

Also extract, only what's genuinely present, don't invent anything:
- People mentioned (name and relationship, e.g. "Marie" / "Spouse")
- Companies or organizations mentioned (name and role, e.g. "Acme Corp" / "Employer")
- Clear preferences (category and the preference itself, e.g. "Travel" / "Prefers window seats")
- Standalone facts worth remembering (label, value, and whether it has a real date attached)

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "observations": [{"type":"contradiction|vague|missing_date|buried_decision","text":"the sharp observation, in your own voice, referencing their actual content","suggestedFix":"what you'd recommend, briefly"}],
  "extractedPeople": [{"name":"...","relationship":"..."}],
  "extractedCompanies": [{"name":"...","role":"..."}],
  "extractedPreferences": [{"category":"...","preference":"..."}],
  "extractedFacts": [{"label":"...","value":"...","hasDate":true or false}]
}

Pasted content:
${pastedText.trim()}`;

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Could not analyze that right now. Try again.' });
    }

    const data = await response.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Failed to parse intake audit output:', text);
      return res.status(502).json({ error: 'Got an unexpected response. Try again.' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/intake-audit:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
