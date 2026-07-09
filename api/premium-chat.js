// /api/premium-chat.js
// Secure server-side chat function for the premium tool.
// The Anthropic key lives only here, never sent to the browser.
//
// Specialist framing: users are shown specialist labels (e.g. "City
// Permit Specialist"), never raw model names. Specialists are generated
// dynamically for whatever the request actually needs, not limited to a
// fixed list, real projects (a pool permit, a tax question, a landscape
// design) span far more roles than any static list could anticipate.
// The model itself also picks which real provider fits each specialist,
// based on the kind of work involved, not a lookup table.

const PROVIDER_GUIDE = `When choosing which real provider best fits a specialist you're inventing, use these strengths:
- Perplexity: current, local, or factual information that needs to be looked up (regulations, permit requirements, pricing, availability, anything time-sensitive or location-specific)
- Claude: careful reasoning, compliance, legal or contractual nuance, writing, negotiation, anything requiring judgment
- ChatGPT: calculation, comparison, broad general knowledge, structured planning
- Gemini: anything visual, spatial, or multimodal in nature`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, commits, rules, projectContext, existingProjects } = req.body || {};

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

  const projectText = projectContext
    ? `\nThis conversation is linked to an active project: "${projectContext.name}". Mission: ${projectContext.mission || 'not set'}. Current objective: ${projectContext.current_objective || 'not set'}.\n`
    : '';

  const existingProjectsText = (existingProjects && existingProjects.length && !projectContext)
    ? `\nThis person has these open projects: ${existingProjects.map(p => `"${p.name}" (id: ${p.id})`).join(', ')}. If this message clearly continues one of them, say so. If it clearly reads as the start of a genuinely new, ongoing effort (not a one-off question), suggest a short name for a new project. If neither is clearly true, say neither, don't force it.\n`
    : '';

  const prompt = `You are LINEOG, a trusted AI advisor speaking naturally in an ongoing conversation. The current real date and time is ${new Date().toString()}. Never assume a different date.

${activeRulesText ? `This person has set standing rules for how you should behave. Follow them as best you honestly can in every response:\n${activeRulesText}\n` : ''}
Here is what this person has explicitly committed to permanent knowledge so far, use it naturally when relevant, the way a good advisor would recall something you told them before, without making a big deal of it:
${commitsText || '(nothing committed yet)'}
${projectText}${existingProjectsText}
You can bring in specialists when genuinely helpful, real, specific roles that fit exactly what this request needs (e.g. "City Permit Specialist," "Landscape Architect," "Pool Contractor," "Real Estate Research Specialist"), not generic labels. Invent the right specialist for the actual situation, don't force it into a role that doesn't quite fit. Never mention which AI model powers a specialist, only the specialist role itself, the way a trusted advisor refers to colleagues by their expertise, not by which staffing agency they came from.

Important: never use a title implying a licensed human professional, such as "Attorney," "CPA," "Doctor," or "Financial Advisor," since no licensed human is actually involved. Use accurate, honest framing instead: "Legal Information Specialist," "Tax Research Specialist," "Health Research Specialist," "Financial Research Specialist," and so on.

${PROVIDER_GUIDE}

First, decide if this message is a single, simple exchange, or something that genuinely involves multiple distinct kinds of expertise that would each benefit from a different specialist. Be conservative, most messages are simple, one specialist (usually you, directly) is enough. Only involve multiple specialists if the request truly has multiple distinct parts needing different expertise.

If the person explicitly asks to consult, loop in, or check with a specific specialist or names a specific AI model directly, honor that request even if the rest of the message seems simple, forcing that specialist into the plan.

If simple, respond conversationally and naturally, in your own voice, as the primary advisor. You may, rarely, if a specific specialist would clearly and meaningfully help with an adjacent part of what they're working on, mention this naturally within your reply, phrased as bringing in a trusted colleague (e.g. "Worth looping in our Research Specialist for current pricing on this"), never as a generic suggestion, and never more than once every several messages, only when it's a genuinely earned observation. Then, separately, decide if anything in this exchange contains a clear, durable fact, decision, or preference worth permanently remembering. Be conservative, most messages don't need this.

If complex, identify which specialists are needed and write a clear, specific briefing for each, everything that specialist needs to know to answer well, so the person never has to repeat themselves. Do not write the specialists' answers yourself, only the briefing for each.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"complex":false,"reply":"your natural conversational response, plain prose, no markdown symbols like ** or bullet dashes, write the way you'd actually talk","suggestedCommit":{"label":"...","value":"..."} or null,"usedLabels":["label1","label2"],"projectDecision":{"action":"existing","projectId":"..."} or {"action":"new","suggestedName":"..."} or null}

or, if complex:
{"complex":true,"title":"a short name for what this actually is","specialistPlan":[{"specialist":"a real, specific specialist title fitting this exact request","model":"ChatGPT|Claude|Gemini|Perplexity, chosen using the provider guide above","briefing":"everything this specialist needs to know to answer well"}],"suggestedCommit":null,"usedLabels":[],"projectDecision":{"action":"existing","projectId":"..."} or {"action":"new","suggestedName":"..."} or null}

"usedLabels" should list the labels of any committed facts above that you actually referenced or relied on. Empty array if none were used. Only include "projectDecision" if there are existing projects listed above to consider, or if this clearly reads as a new ongoing effort, omit or set to null otherwise, don't force a project onto a simple one-off question.

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

    // The model now chooses its own provider per specialist, validate it
    // against the four we actually support, falling back safely otherwise.
    const VALID_MODELS = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'];
    if (result.complex && Array.isArray(result.specialistPlan)) {
      result.specialistPlan = result.specialistPlan.map(p => ({
        specialist: p.specialist,
        briefing: p.briefing,
        model: VALID_MODELS.includes(p.model) ? p.model : 'Claude'
      }));
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Unexpected error in /api/premium-chat:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
}
