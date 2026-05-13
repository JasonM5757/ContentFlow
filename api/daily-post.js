// Autonomous daily posting route for ContentFlow.
// Triggered by Vercel Cron (see vercel.json) or manually via POST/GET.
// Does not remove or modify the existing manual pipeline.

const DEFAULT_SOURCE_URL = "https://conexcreation.com";

// Approved backend media library. Only .jpg / .jpeg URLs are used.
const APPROVED_MEDIA_LIBRARY = [
  "https://conexcreation.com/wp-content/uploads/2026/05/custom-tack-room-JPG-300x225.jpg"
];

const GRAPH_API_VERSION = "v20.0";
const CLAUDE_MODEL = "claude-sonnet-4-6";

// Instagram container readiness polling (mirrors api/publish-post.js).
const IG_CONTAINER_POLL_INTERVAL_MS = 2500;
const IG_CONTAINER_POLL_MAX_ATTEMPTS = 20; // ~50 seconds total

// Lightweight in-memory duplicate protection per warm serverless instance.
const RECENT_RUNS = globalThis.__CONTENTFLOW_DAILY_RUNS__ || new Map();
globalThis.__CONTENTFLOW_DAILY_RUNS__ = RECENT_RUNS;

function arizonaDateKey(date = new Date()) {
  // Arizona does not observe DST. Treat as fixed UTC-7.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date); // YYYY-MM-DD
}

function hashSignature(input) {
  // Tiny deterministic hash (FNV-1a 32-bit) — enough for duplicate detection.
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

function pickDailyMedia(dateKey) {
  const jpgOnly = APPROVED_MEDIA_LIBRARY.filter((url) =>
    /\.(jpg|jpeg)(\?|$)/i.test(url)
  );
  if (!jpgOnly.length) return null;

  // Deterministic rotation by date so the same day always selects the same image.
  const seed = Number.parseInt(hashSignature(dateKey).slice(-6), 16);
  const index = seed % jpgOnly.length;
  return jpgOnly[index];
}

function isValidJpgUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return /\.(jpg|jpeg)(\?|$)/i.test(url);
}

function decodeEntities(text) {
  return (text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, "$&\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : "";
}

async function scrapeSourceWebsite(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ContentFlowDailyBot/1.0; +https://contentflow.vercel.app)",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`Scrape failed with status ${response.status}`);
    }

    const html = await response.text();
    const text = stripHtml(html);
    const title = extractTitle(html);

    return {
      url,
      finalUrl: response.url,
      title,
      excerpt: text.slice(0, 3000),
      wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
      fetchedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
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

async function generateDailyCaption({ scrape, dateKey }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const sourceText = scrape.excerpt || scrape.title || DEFAULT_SOURCE_URL;

  const prompt = `
You are writing the official daily social post for Conex Creation
(${DEFAULT_SOURCE_URL}). The audience is Southern Arizona job sites,
ranches, contractors, and small businesses interested in shipping
containers, mobile offices, and custom container builds.

Return JSON only with this exact shape:
{
  "caption": "string (Facebook + Instagram ready, includes a hook, value, and CTA)",
  "shortCaption": "string (one-sentence version for fallback)",
  "hashtags": ["#example"],
  "audienceHook": "string"
}

Rules:
- Date context: ${dateKey} (America/Phoenix).
- Keep the caption under 2,200 characters so Instagram accepts it.
- Lead with a strong hook in the first line.
- Mention Southern Arizona where it feels natural.
- End with a clear CTA pointing to ${DEFAULT_SOURCE_URL}.
- Keep hashtags relevant, max 8.
- Do not invent statistics or false claims.

Source content (from ${scrape.finalUrl || scrape.url}):
"""
${sourceText}
"""
`.trim();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${raw.slice(0, 400)}`);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Claude returned non-JSON response.");
  }

  const text = Array.isArray(payload.content)
    ? payload.content.map((item) => item.text || "").join("\n").trim()
    : "";

  const parsed = extractJson(text);
  if (!parsed || !parsed.caption) {
    throw new Error("Claude response did not include a valid caption.");
  }

  // Append hashtags if Claude returned them as a separate array.
  let caption = String(parsed.caption).trim();
  if (Array.isArray(parsed.hashtags) && parsed.hashtags.length) {
    const tags = parsed.hashtags
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      .join(" ");
    if (!caption.includes(tags)) {
      caption = `${caption}\n\n${tags}`;
    }
  }

  return {
    caption,
    shortCaption: parsed.shortCaption || "",
    hashtags: parsed.hashtags || [],
    audienceHook: parsed.audienceHook || ""
  };
}

async function graphRequest(path, params) {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params)
    }
  );

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok || body.error) {
    const message = body?.error?.message || text || "Graph API request failed.";
    throw new Error(message);
  }

  return body;
}

async function graphGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), { method: "GET" });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok || body.error) {
    const message = body?.error?.message || text || "Graph API request failed.";
    throw new Error(message);
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors the readiness polling in api/publish-post.js. Instagram's media
// container is not always immediately publishable, so we wait until its
// status_code is FINISHED (or fail fast on ERROR/EXPIRED).
async function waitForInstagramContainerReady({ token, creationId }) {
  let lastStatus = null;

  for (let attempt = 0; attempt < IG_CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
    const info = await graphGet(creationId, {
      access_token: token,
      fields: "status_code,status"
    });

    lastStatus = info.status_code || info.status || null;

    if (lastStatus === "FINISHED") {
      return info;
    }
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      throw new Error(
        `Instagram container ${creationId} ended in status ${lastStatus}.`
      );
    }

    await sleep(IG_CONTAINER_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Instagram container ${creationId} not ready after ${
      IG_CONTAINER_POLL_MAX_ATTEMPTS * IG_CONTAINER_POLL_INTERVAL_MS
    }ms (last status: ${lastStatus || "unknown"}).`
  );
}

async function publishToFacebook({ token, pageId, caption, imageUrl, linkUrl }) {
  if (!pageId) throw new Error("FACEBOOK_PAGE_ID is not configured.");

  if (imageUrl) {
    return graphRequest(`${pageId}/photos`, {
      access_token: token,
      url: imageUrl,
      caption: caption || "",
      published: "true"
    });
  }

  return graphRequest(`${pageId}/feed`, {
    access_token: token,
    message: caption || "",
    ...(linkUrl ? { link: linkUrl } : {})
  });
}

async function publishToInstagram({ token, igId, caption, imageUrl }) {
  if (!igId) throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured.");
  if (!imageUrl) {
    throw new Error("Instagram publishing requires a valid JPG imageUrl.");
  }

  const creation = await graphRequest(`${igId}/media`, {
    access_token: token,
    image_url: imageUrl,
    caption: caption || ""
  });

  if (!creation || !creation.id) {
    throw new Error("Instagram media container creation did not return an id.");
  }

  // Wait until the container is FINISHED before publishing — prevents
  // "Media ID is not available." errors when publishing immediately.
  await waitForInstagramContainerReady({ token, creationId: creation.id });

  return graphRequest(`${igId}/media_publish`, {
    access_token: token,
    creation_id: creation.id
  });
}

function buildSignature({ dateKey, mediaUrl, caption }) {
  return hashSignature(`${dateKey}::${mediaUrl}::${caption.slice(0, 400)}`);
}

function pruneOldRuns(now) {
  const cutoff = now - 1000 * 60 * 60 * 36; // 36h
  for (const [key, entry] of RECENT_RUNS.entries()) {
    if (!entry?.timestamp || entry.timestamp < cutoff) {
      RECENT_RUNS.delete(key);
    }
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function json(res, status, body) {
  setCors(res);
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  // Allow both GET (Vercel Cron uses GET) and POST (manual triggers).
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const startedAt = new Date();
  const dateKey = arizonaDateKey(startedAt);
  const log = {
    ok: false,
    triggeredAt: startedAt.toISOString(),
    arizonaDate: dateKey,
    source: DEFAULT_SOURCE_URL,
    model: CLAUDE_MODEL,
    scrape: null,
    caption: null,
    mediaUrl: null,
    facebook: null,
    instagram: null,
    duplicate: false,
    errors: []
  };

  const token = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!token) {
    log.errors.push("META_ACCESS_TOKEN is not configured.");
    return json(res, 500, log);
  }

  try {
    pruneOldRuns(Date.now());

    // 1. Select today's approved JPG.
    const mediaUrl = pickDailyMedia(dateKey);
    if (!isValidJpgUrl(mediaUrl)) {
      log.errors.push("No valid JPG available in the approved media library.");
      return json(res, 500, log);
    }
    log.mediaUrl = mediaUrl;

    // 2. Scrape the source website.
    let scrape;
    try {
      scrape = await scrapeSourceWebsite(DEFAULT_SOURCE_URL);
      log.scrape = scrape;
    } catch (error) {
      log.errors.push(`Scrape failed: ${error.message}`);
      // Fall back to a minimal scrape object so Claude still has context.
      scrape = {
        url: DEFAULT_SOURCE_URL,
        finalUrl: DEFAULT_SOURCE_URL,
        title: "Conex Creation",
        excerpt:
          "Conex Creation builds heavy-duty shipping containers, mobile offices, " +
          "and custom container solutions for Southern Arizona job sites, ranches, " +
          "and businesses.",
        wordCount: 0,
        fetchedAt: new Date().toISOString(),
        fallback: true
      };
      log.scrape = scrape;
    }

    // 3. Generate the daily caption via Claude.
    let claude;
    try {
      claude = await generateDailyCaption({ scrape, dateKey });
    } catch (error) {
      log.errors.push(`Claude failed: ${error.message}`);
      return json(res, 500, log);
    }
    log.caption = claude.caption;

    // 4. Duplicate protection — same date + same media + same caption.
    const signature = buildSignature({
      dateKey,
      mediaUrl,
      caption: claude.caption
    });
    const dedupeKey = `${dateKey}::${signature}`;
    if (RECENT_RUNS.has(dedupeKey)) {
      const previous = RECENT_RUNS.get(dedupeKey);
      log.duplicate = true;
      log.errors.push(
        `Duplicate run blocked. Already posted at ${new Date(previous.timestamp).toISOString()}.`
      );
      log.facebook = previous.facebook || null;
      log.instagram = previous.instagram || null;
      return json(res, 200, log);
    }
    // Also block if any other entry today already used the same media+caption signature.
    for (const [existingKey, existingValue] of RECENT_RUNS.entries()) {
      if (
        existingKey.startsWith(`${dateKey}::`) &&
        existingValue.signature === signature
      ) {
        log.duplicate = true;
        log.errors.push("Duplicate caption/media already posted today.");
        log.facebook = existingValue.facebook || null;
        log.instagram = existingValue.instagram || null;
        return json(res, 200, log);
      }
    }

    // 5. Publish to Facebook.
    try {
      log.facebook = await publishToFacebook({
        token,
        pageId,
        caption: claude.caption,
        imageUrl: mediaUrl,
        linkUrl: DEFAULT_SOURCE_URL
      });
    } catch (error) {
      log.errors.push(`Facebook publish failed: ${error.message}`);
    }

    // 6. Publish to Instagram — only if JPG is valid (already enforced above).
    try {
      if (isValidJpgUrl(mediaUrl)) {
        log.instagram = await publishToInstagram({
          token,
          igId,
          caption: claude.caption,
          imageUrl: mediaUrl
        });
      } else {
        log.errors.push("Skipped Instagram: no valid JPG imageUrl available.");
      }
    } catch (error) {
      log.errors.push(`Instagram publish failed: ${error.message}`);
    }

    // 7. Record this run for duplicate protection.
    RECENT_RUNS.set(dedupeKey, {
      timestamp: Date.now(),
      signature,
      facebook: log.facebook,
      instagram: log.instagram
    });

    log.ok = log.errors.length === 0 || Boolean(log.facebook) || Boolean(log.instagram);
    return json(res, log.ok ? 200 : 500, log);
  } catch (error) {
    log.errors.push(`Unhandled error: ${error.message}`);
    return json(res, 500, log);
  }
};
