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

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return safeParse(match[0]);
}

function normalizeProviderPayload(payload) {
  if (!payload) return null;

  if (typeof payload === 'string') {
    return extractJsonString(payload);
  }

  if (payload.visualIdea || payload.imagePrompt || payload.variations || payload.script || payload.shots) {
    return payload;
  }

  const candidates = [
    payload.data,
    payload.result,
    payload.output,
    payload.content,
    payload.message,
    payload.text
  ].filter(Boolean);

  for (const item of candidates) {
    if (
      typeof item === 'object' &&
      (item.visualIdea || item.imagePrompt || item.variations || item.script || item.shots)
    ) {
      return item;
    }

    if (typeof item === 'string') {
      const parsed = extractJsonString(item);
      if (parsed) return parsed;
    }
  }

  return null;
}

function localFallback(body) {
  const title = body.pageTitle || body.businessName || 'this content';
  const rewritten = (body.rewrittenText || body.caption || '').trim();
  const firstSentence = rewritten.split(/(?<=[.!?])\s+/)[0] || rewritten.slice(0, 180);

  const script = [
    `Opening shot: Show the main offer or product clearly. Voiceover: "${firstSentence || `Here's what to know about ${title}.`}"`,
    `Middle shot: Show supporting details, product use, or customer benefit. Voiceover: "Make the value obvious and practical."`,
    `Closing shot: Show logo, website, or call-to-action. Voiceover: "${body.callToAction || 'Contact us to learn more.'}"`
  ].join('\n');

  return {
    provider: 'local-fallback',
    hook: firstSentence,
    script,
    shots: [
      {
        time: '0-5s',
        visual: 'Hero shot of the product or service',
        voiceover: firstSentence || `Introducing ${title}`
      },
      {
        time: '5-20s',
        visual: 'Show details, use cases, or benefits',
        voiceover: 'Highlight the core customer benefit'
      },
      {
        time: '20-30s',
        visual: 'Logo, contact info, and call-to-action',
        voiceover: body.callToAction || 'Contact us to learn more'
      }
    ],
    visualIdea: `Create a clean, modern short-form video focused on ${title}.`,
    imagePrompt: `Social video storyboard for ${title}. Clean modern layout, practical visuals, strong readable text overlays, vertical 9:16 composition.`,
    captionAngle: `Lead with a clear hook, explain the core takeaway, and end with a direct CTA tied to ${title}.`,
    variations: [
      `What makes ${title} worth attention right now?`,
      `A simple breakdown of ${title} for busy audiences.`,
      `The key takeaway from ${title} in one short video.`
    ]
  };
}

async function tryProvider(apiKey, prompt) {
  const endpoints = [
    'https://api.arvo.ai/v1/generate',
    'https://api.arvo.ai/v1/content/generate',
    'https://api.arvow.com/v1/generate'
  ];

  const bodies = [
    { prompt, format: 'json' },
    { input: prompt, format: 'json' },
    { messages: [{ role: 'user', content: prompt }], response_format: 'json' }
  ];

  const errors = [];

  for (const endpoint of endpoints) {
    for (const body of bodies) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey
          },
          body: JSON.stringify(body)
        });

        const raw = await response.text();

        if (!response.ok) {
          errors.push(`${endpoint} -> ${response.status}: ${raw.slice(0, 300)}`);
          continue;
        }

        const parsed = safeParse(raw) || raw;
        const normalized = normalizeProviderPayload(parsed);

        if (normalized) {
          return { data: { provider: endpoint, ...normalized }, errors };
        }

        errors.push(`${endpoint} -> unrecognized response payload`);
      } catch (error) {
        errors.push(`${endpoint} -> ${error.message}`);
      }
    }
  }

  return { data: null, errors };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = readBody(req);
  const apiKey = process.env.ARVO_API_KEY;

  const prompt = `
Generate creative direction and a short video script for a social post.

Return JSON only:
{
  "hook": "string",
  "script": "string",
  "shots": [
    {
      "time": "string",
      "visual": "string",
      "voiceover": "string"
    }
  ],
  "visualIdea": "string",
  "imagePrompt": "string",
  "captionAngle": "string",
  "variations": ["string", "string", "string"]
}

Platform: ${body.targetPlatform || 'facebook'}
Page title: ${body.pageTitle || 'Untitled'}
Business name: ${body.businessName || 'Conex Creation & Supply'}
Brand voice: ${body.brandVoice || 'clear, credible, engaging'}
CTA: ${body.callToAction || 'Learn more'}
Duration seconds: ${body.durationSeconds || 30}
Instructions: ${body.additionalInstructions || 'None'}
URL: ${body.url || 'N/A'}

Caption / rewritten content:
${body.rewrittenText || body.caption || ''}

Source content:
${body.scrapedText || ''}
`.trim();

  try {
    if (apiKey) {
      const providerResult = await tryProvider(apiKey, prompt);

      if (providerResult.data) {
        return json(res, 200, {
          ok: true,
          data: providerResult.data,
          ...providerResult.data
        });
      }

      return json(res, 200, {
        ok: true,
        data: {
          ...localFallback(body),
          providerErrors: providerResult.errors
        },
        ...localFallback(body),
        providerErrors: providerResult.errors
      });
    }

    const fallback = localFallback(body);

    return json(res, 200, {
      ok: true,
      data: fallback,
      ...fallback
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
};
