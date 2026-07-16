// /api/interest.js
// Captures early-access interest: email, what they were working on, and
// which AI was recommended. Deliberately minimal — no accounts, no
// passwords, no persistent project storage. Just enough to know real
// intent exists before building any of that.

import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { windowMs: 60000, maxRequests: 10 })) return;

  const { email, task, recommended } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }

  // For now, this just logs to Vercel's function logs (Project → Logs),
  // the same free, zero-infrastructure visibility used in recommend.js.
  // Once there's enough signal to justify it, this is the natural place
  // to write to a real database instead of just logging.
  console.log('interest:', {
    email,
    task: (task || '').slice(0, 200),
    recommended: recommended || null,
    time: new Date().toISOString()
  });

  return res.status(200).json({ ok: true });
}
