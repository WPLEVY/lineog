// /api/execute-part.js
// Actually calls the real, recommended AI provider for one part of a
// breakdown, instead of simulating that model's answer through Claude.
// All four keys live only here, never sent to the browser.

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`Claude error ${response.status}`);
  const data = await response.json();
  return (data.content || []).map(b => b.text || '').join('').trim();
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`OpenAI error ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );
  if (!response.ok) throw new Error(`Gemini error ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callPerplexity(prompt) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (response.status === 402) {
    // Perplexity gives no advance warning before running dry, unlike the
    // other three providers. This is the one place that failure actually
    // surfaces, caught here so it degrades gracefully instead of crashing
    // the whole breakdown.
    throw new Error('PERPLEXITY_OUT_OF_CREDIT');
  }
  if (!response.ok) throw new Error(`Perplexity error ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

const providers = {
  'Claude': callClaude,
  'ChatGPT': callOpenAI,
  'Gemini': callGemini,
  'Perplexity': callPerplexity
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { model, specialist, name, guidance } = req.body || {};

  if (!model || !providers[model]) {
    return res.status(400).json({ error: 'Unknown or unsupported model.' });
  }
  if (!guidance) {
    return res.status(400).json({ error: 'Briefing is required.' });
  }

  const prompt = `You are being consulted as a specialist for one part of a larger task${specialist ? `, specifically as the ${specialist}` : ''}. Here is the briefing: ${guidance}

Give a real, specific, helpful answer, a few sentences, not a placeholder. Plain prose, no markdown symbols like ** or bullet dashes.`;

  try {
    const answer = await providers[model](prompt);
    return res.status(200).json({ answer, model, specialist, usedFallback: false });

  } catch (err) {
    console.error(`Error calling ${model}:`, err.message);

    // Graceful degradation: if the recommended provider fails for any
    // reason (out of credit, outage, bad key), fall back to Claude rather
    // than letting one provider's failure break the whole breakdown.
    if (model !== 'Claude') {
      try {
        const fallbackAnswer = await callClaude(prompt);
        return res.status(200).json({
          answer: fallbackAnswer,
          model: 'Claude',
          specialist,
          usedFallback: true,
          fallbackReason: err.message === 'PERPLEXITY_OUT_OF_CREDIT'
            ? 'Perplexity is out of credit, answered with Claude instead.'
            : `${model} was unavailable, answered with Claude instead.`
        });
      } catch (fallbackErr) {
        console.error('Fallback to Claude also failed:', fallbackErr.message);
      }
    }

    return res.status(502).json({ error: 'Could not get an answer for this part right now.' });
  }
}
