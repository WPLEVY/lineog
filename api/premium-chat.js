// /api/premium-chat.js
// Secure server-side chat function for the premium tool.
// The Anthropic key lives only here, never sent to the browser.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, commits, rules } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'That message is too long.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const commitsText = (commits || []).map(c => {
    const d = new Date(c.date);
    const isYesterday = (new Date() - d) < 2 * 24 * 60 * 60 * 1000 && (new Date() - d) > 12 * 60 * 60 * 1000;
    return `- ${c.label}: ${c.value} (committed ${isYesterday ? 'yesterday' : d.toLocaleDateString()})`;
  }).join('\n');

  const activeRulesText = (rules || []).filter(r => r.status !== 'cant').map(r => `- ${r.text}`).join('\n');

  const prompt = `You are LINEOG, a trusted AI advisor speaking naturally in an ongoing conversation. The current real date and time is ${new Date().toString()}. Never assume a different date.

${activeRulesText ? `This person has set standing rules for how you should behave. Follow them as best you honestly can in every response:\n${activeRulesText}\n` : ''}
Here is what this person has explicitly committed to permanent knowledge so far, use it naturally when relevant, the way a good advisor would recall something you told them before, without making a big deal of it:
${commitsText || '(nothing committed yet)'}

First, decide if this message is a single, simple exchange, or something that genuinely involves multiple distinct kinds of work (e.g. research, negotiation, calculation, drafting) that would each benefit from a different specialized AI. Be conservative, most messages are simple. Only mark something complex if it truly has multiple distinct parts.

If simple, respond conversationally and naturally. Then, separately, decide if anything in this exchange contains a clear, durable fact, decision, or preference worth permanently remembering. Be conservative, most messages don't need this.

If complex, break it into parts. For each part, write real, specific guidance, your own best advice for that part, clearly, not a placeholder, and recommend which AI (ChatGPT, Claude, Gemini, or Perplexity) suits it best. Then write one short paragraph synthesizing the parts together.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"complex":false,"reply":"your natural conversational response","suggestedCommit":{"label":"...","value":"..."} or null,"usedLabels":["label1","label2"]}

or, if complex:
{"complex":true,"title":"a short name for what this actually is","parts":[{"name":"...","model":"ChatGPT|Claude|Gemini|Perplexity","guidance":"real, specific advice for this part"}],"synthesis":"a short paragraph pulling the parts together","suggestedCommit":null,"usedLabels":[]}

"usedLabels" should list the labels of any committed facts above that you actually referenced or relied on. Empty array if none were used.

Their message: ${message.trim()}`;

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
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Could not reach the model right now. Try again.' });
    }

    const data = await response.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Failed to parse model output:', text);
      return res.status(502).json({ error: 'Got an unexpected response. Try again.' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/premium-chat:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
}
