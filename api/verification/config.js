// Explicit Vercel serverless function for /api/verification/config
// This avoids catch-all routing issues

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
  const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY;
  const RECAPTCHA_ENABLED = !!RECAPTCHA_SECRET_KEY;

  const config = {
    recaptchaEnabled: RECAPTCHA_ENABLED,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY || null
  };

  console.log('[API] /api/verification/config called');
  console.log(`[API] Returning: recaptchaEnabled=${config.recaptchaEnabled}, siteKey=${config.recaptchaSiteKey ? 'SET' : 'NULL'}`);

  res.status(200).json(config);
}
