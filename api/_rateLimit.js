// /api/_rateLimit.js
// A real, honest, in-memory rate limiter shared across API routes.
//
// Important limitation, worth knowing plainly: this resets whenever a
// serverless instance cold-starts, and doesn't share state across multiple
// concurrent instances. It's real protection against a single script
// hammering an endpoint in one session, not a fully reliable, distributed
// limit. A production-grade version would use Vercel KV or Upstash Redis
// so the count is shared across every instance, that's a real, separate
// piece of infrastructure to add when it's actually needed, not something
// to fake here.

const hits = new Map();

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

export function rateLimit(req, res, { windowMs = 60000, maxRequests = 20 } = {}) {
  const key = getClientKey(req);
  const now = Date.now();
  const record = hits.get(key);

  if (!record || now - record.windowStart > windowMs) {
    hits.set(key, { windowStart: now, count: 1 });
    return true;
  }

  record.count += 1;
  if (record.count > maxRequests) {
    res.status(429).json({ error: 'Too many requests, slow down a moment and try again.' });
    return false;
  }
  return true;
}
