function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  setCors(res);
  res.status(status).json(body);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(res, 500, { ok: false, error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  const body = readBody(req);
  const sourceText = [
    body.scrapedText || '',
    body.excerpt || '',
    body.originalText || '',
    body.sourceText || ''
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (!sourceText) {
    return json(res, 400, { ok: false, error: 'No source content provided for rewrite.' });
  }

  const prompt = `
You are rewriting website content into a social-ready post.

Return JSON only with this exact shape:
{
  "headline": "string",
  "summary": "string",
  "post": "string",
  "caption": "string",
  "shortCaption": "string",
  "hashtags": ["#example"],
  "imagePrompt": "string",
  "audienceHook": "string",
  "callToAction": "string",
  "notes": "string"
}

Rules:
- Target platform: ${body.targetPlatform || 'facebook'}
- Business name: ${body.businessName || 'Conex Creation & Supply'}
- Brand voice: ${body.brandVoice || body.tone || 'clear, credible, engaging'}
- Goal: ${body.goal || 'Create a high-converting social post'}
- CTA preference: ${body.callToAction || 'Invite the audience to learn more'}
- Additional instructions: ${body.additionalInstructions || body.extraInstructions || 'None'}
- Page title: ${body.pageTitle || body.title || 'Untitled'}
- Source URL: ${body.url || 'N/A'}
- Keep claims faithful to the source.
- Do not invent statistics or facts.
- Make the post publishable, not generic.
- Keep hashtags relevant and limited.

Source content:
${sourceText}
`.trim();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1400,
        temperature: 0.4,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      return json(res, response.status, { ok: false, error: raw || 'Anthropic request failed.' });
    }

    const payload = JSON.parse(raw);
    const text = Array.isArray(payload.content)
      ? payload.content.map((item) => item.text || '').join('\n').trim()
      : '';

    const parsed = extractJson(text);
    if (!parsed) {
      return json(res, 502, {
        ok: false,
        error: 'Anthropic response did not contain valid JSON.',
        raw: text
      });
    }

    return json(res, 200, {
      ok: true,
      data: parsed,
      ...parsed
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
};
