// /api/classify-rule.js
// Honestly classifies whether a user's requested rule can genuinely be
// attempted or is structurally impossible. Key stays server-side.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Rule text is required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const prompt = `A user wants to add this as a standing rule for how their AI should behave: "${text.trim()}"

Decide honestly: is this something an AI system could genuinely attempt to follow as an instruction applied to every conversation (even if not perfectly guaranteed), or is it something structurally impossible (e.g. requires reading private messages/texts with no access, requires physical world action, requires info no AI has access to)?

Respond with ONLY valid JSON: {"status":"best-effort" or "cant","reason":"if cant, one honest sentence explaining why, in plain language. if best-effort, empty string."}`;

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Could not classify this rule right now.' });
    }

    const data = await response.json();
    let raw = (data.content || []).map(b => b.text || '').join('').trim();
    raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const result = JSON.parse(raw);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/classify-rule:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
