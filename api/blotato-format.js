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

  if (payload.formattedPost || payload.caption || payload.message || payload.payloads) return payload;

  const candidates = [
    payload.data,
    payload.result,
    payload.output,
    payload.content,
    payload.text
  ].filter(Boolean);

  for (const item of candidates) {
    if (
      typeof item === 'object' &&
      (item.formattedPost || item.caption || item.message || item.payloads)
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

function normalizeHashtags(text) {
  return Array.from(
    new Set(
      (text.match(/#[\p{L}\p{N}_]+/gu) || [])
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function localFormat(body) {
  const platforms = Array.isArray(body.platforms)
    ? body.platforms
    : [body.targetPlatform || body.platform || 'facebook'];

  const rewritten = (body.rewrittenText || body.caption || '').trim();
  const shortCaption = (body.shortCaption || '').trim();
  const creative = body.creative || {};
  const hook = creative.hook || '';
  const cta = body.callToAction || 'Learn more';
  const hashtags = Array.isArray(body.hashtags)
    ? body.hashtags
    : normalizeHashtags(rewritten);

  const payloads = platforms.map((platformRaw) => {
    const platform = String(platformRaw || 'facebook').toLowerCase();
    let formattedPost = shortCaption || rewritten;

    if (hook && !formattedPost.toLowerCase().startsWith(hook.toLowerCase().slice(0, 24))) {
      formattedPost = `${hook}\n\n${formattedPost}`;
    }

    if (cta && !formattedPost.toLowerCase().includes(cta.toLowerCase())) {
      formattedPost = `${formattedPost}\n\n${cta}`;
    }

    const tagLimit = platform.includes('instagram') ? 12 : 5;
    const selectedTags = hashtags.slice(0, tagLimit);

    if (selectedTags.length) {
      formattedPost = `${formattedPost}\n\n${selectedTags.join(' ')}`;
    }

    if (platform.includes('instagram')) {
      formattedPost = formattedPost.slice(0, 2200);
    }

    return {
      platform,
      caption: formattedPost,
      formattedPost,
      hashtags: selectedTags
    };
  });

  return {
    provider: 'local-fallback',
    payloads,
    formattedPost: payloads[0]?.formattedPost || '',
    caption: payloads[0]?.caption || '',
    hashtags
  };
}

async function tryProvider(apiKey, payload) {
  const endpoints = [
    'https://backend.blotato.com/api/format',
    'https://api.blotato.com/v1/format',
    'https://backend.blotato.com/v2/format'
  ];

  const bodies = [
    payload,
    { input: payload },
    { prompt: JSON.stringify(payload) }
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
  const apiKey = process.env.BLOTATO_API_KEY;

  const providerPayload = {
    platforms: body.platforms || [body.targetPlatform || body.platform || 'facebook'],
    pageTitle: body.pageTitle || '',
    url: body.url || '',
    text: body.rewrittenText || body.caption || '',
    shortCaption: body.shortCaption || '',
    hashtags: body.hashtags || [],
    videoScript: body.videoScript || '',
    creative: body.creative || {},
    callToAction: body.callToAction || '',
    additionalInstructions: body.additionalInstructions || ''
  };

  try {
    if (apiKey) {
      const providerResult = await tryProvider(apiKey, providerPayload);

      if (providerResult.data) {
        return json(res, 200, {
          ok: true,
          data: providerResult.data,
          ...providerResult.data
        });
      }

      const fallback = localFormat(body);

      return json(res, 200, {
        ok: true,
        data: {
          ...fallback,
          providerErrors: providerResult.errors
        },
        ...fallback,
        providerErrors: providerResult.errors
      });
    }

    const fallback = localFormat(body);

    return json(res, 200, {
      ok: true,
      data: fallback,
      ...fallback
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
};
