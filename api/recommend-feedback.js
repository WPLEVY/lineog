// /api/recommend-feedback.js
// Real feedback capture for the free tool. Without this, the usage log
// is just passive observation, this is what turns it into something
// that can actually learn whether its recommendations were good.

import { rateLimit } from './_rateLimit.js';
import { createClient } from '@supabase/supabase-js';

const sbAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(req, res, { windowMs: 60000, maxRequests: 20 })) return;

  const { recommendationId, wasHelpful } = req.body || {};
  if (!recommendationId || typeof wasHelpful !== 'boolean') {
    return res.status(400).json({ error: 'Missing recommendationId or wasHelpful.' });
  }
  if (!sbAdmin) {
    return res.status(500).json({ error: 'Server is not configured yet.' });
  }

  const { error } = await sbAdmin
    .from('tool_recommendations')
    .update({ was_helpful: wasHelpful })
    .eq('id', recommendationId);

  if (error) {
    console.error('Could not save feedback', error);
    return res.status(502).json({ error: 'Could not save feedback right now.' });
  }

  return res.status(200).json({ ok: true });
}
