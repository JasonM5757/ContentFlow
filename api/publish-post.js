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

function normalizePlatform(value) {
  const raw = String(value || 'facebook').toLowerCase();

  if (raw === 'both' || raw === 'facebook+instagram' || raw === 'instagram+facebook') {
    return 'both';
  }

  if (raw.includes('instagram') && raw.includes('facebook')) {
    return 'both';
  }

  if (raw.includes('instagram') || raw === 'ig') {
    return 'instagram';
  }

  return 'facebook';
}

function normalizePlatforms(body) {
  if (Array.isArray(body.platforms) && body.platforms.length) {
    return body.platforms.map(normalizePlatform);
  }

  const platform = normalizePlatform(body.platform);

  if (platform === 'both') {
    return ['facebook', 'instagram'];
  }

  return [platform];
}

async function graphRequest(path, params) {
  const response = await fetch(`https://graph.facebook.com/v20.0/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok || body.error) {
    const message = body?.error?.message || text || 'Graph API request failed.';
    throw new Error(message);
  }

  return body;
}

async function publishFacebook({ token, pageId, message, linkUrl, imageUrl }) {
  if (!pageId) throw new Error('FACEBOOK_PAGE_ID is not configured.');

  if (imageUrl) {
    return graphRequest(`${pageId}/photos`, {
      access_token: token,
      url: imageUrl,
      caption: message || '',
      published: 'true'
    });
  }

  return graphRequest(`${pageId}/feed`, {
    access_token: token,
    message: message || '',
    ...(linkUrl ? { link: linkUrl } : {})
  });
}

async function publishInstagram({ token, igId, caption, imageUrl, videoUrl }) {
  if (!igId) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured.');

  if (!imageUrl && !videoUrl) {
    throw new Error('Instagram publishing requires mediaUrl/imageUrl/videoUrl.');
  }

  const creation = imageUrl
    ? await graphRequest(`${igId}/media`, {
        access_token: token,
        image_url: imageUrl,
        caption: caption || ''
      })
    : await graphRequest(`${igId}/media`, {
        access_token: token,
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption || ''
      });

  return graphRequest(`${igId}/media_publish`, {
    access_token: token,
    creation_id: creation.id
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!token) {
    return json(res, 500, { ok: false, error: 'META_ACCESS_TOKEN is not configured.' });
  }

  const body = readBody(req);

  if (body.test) {
    return json(res, 200, {
      ok: true,
      message: 'Meta publish route is configured.',
      status: 'Ready',
      configured: {
        metaToken: Boolean(token),
        facebookPageId: Boolean(pageId),
        instagramBusinessAccountId: Boolean(igId)
      }
    });
  }

  const platforms = normalizePlatforms(body);
  const content =
    body.content ||
    body.formattedPost ||
    body.message ||
    body.caption ||
    body.formattedPayload?.caption ||
    '';

  const linkUrl = body.linkUrl || body.url || '';
  const imageUrl = body.mediaUrl || body.imageUrl || '';
  const videoUrl = body.videoUrl || '';
  const scheduledAt = body.scheduledAt || null;

  try {
    const results = [];

    for (const platform of platforms) {
      if (platform === 'facebook') {
        const result = await publishFacebook({
          token,
          pageId,
          message: content,
          linkUrl,
          imageUrl: imageUrl || ''
        });

        results.push({
          platform: 'facebook',
          status: scheduledAt ? 'prepared' : 'published',
          remoteId: result.id || result.post_id || '',
          response: result
        });
      }

      if (platform === 'instagram') {
        const result = await publishInstagram({
          token,
          igId,
          caption: content,
          imageUrl: imageUrl || '',
          videoUrl: videoUrl || ''
        });

        results.push({
          platform: 'instagram',
          status: scheduledAt ? 'prepared' : 'published',
          remoteId: result.id || '',
          response: result
        });
      }
    }

    return json(res, 200, {
      ok: true,
      data: {
        results
      },
      results
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
};
