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

function decodeEntities(text) {
  return (text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, '$&\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

function extractTag(html, regex) {
  const match = html.match(regex);
  return match ? decodeEntities(match[1].trim()) : '';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = readBody(req);
  const url = (body.url || '').trim();

  if (!/^https?:\/\//i.test(url)) {
    return json(res, 400, { ok: false, error: 'A valid http(s) URL is required.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VercelServerless/1.0; +https://vercel.com)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return json(res, response.status, {
        ok: false,
        error: `Unable to fetch URL (${response.status}).`
      });
    }

    const html = await response.text();
    const text = stripHtml(html);
    const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      extractTag(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
      ) ||
      extractTag(
        html,
        /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i
      ) ||
      extractTag(
        html,
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
      );

    const excerpt = text.slice(0, 3000);
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

    return json(res, 200, {
      ok: true,
      data: {
        url,
        finalUrl: response.url,
        title,
        description,
        excerpt,
        text,
        wordCount,
        fetchedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error.name === 'AbortError' ? 'Scrape request timed out.' : error.message
    });
  }
};
