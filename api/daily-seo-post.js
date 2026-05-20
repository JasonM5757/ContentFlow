const { getTodaysTopic } = require("./content-calendar");

const DEFAULT_SOURCE_URL = "https://conexcreation.com";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const WORDPRESS_MEDIA_ENDPOINT = `${DEFAULT_SOURCE_URL}/wp-json/wp/v2/media?per_page=100&media_type=image`;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function json(res, status, body) {
  setCors(res);
  res.status(status).json(body);
}

function arizonaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function authHeader() {
  const username = process.env.WORDPRESS_USERNAME;
  const password = process.env.WORDPRESS_APP_PASSWORD;

  if (!username || !password) {
    throw new Error("WORDPRESS_USERNAME or WORDPRESS_APP_PASSWORD is not configured.");
  }

  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function stripJson(text) {
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

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function pickRenderedOrRaw(field) {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object") {
    if (typeof field.rendered === "string") return field.rendered;
    if (typeof field.raw === "string") return field.raw;
  }
  return "";
}

function cleanMediaText(value, maxLength = 600) {
  const stripped = stripHtml(value);
  if (!stripped) return "";
  return stripped.length > maxLength
    ? stripped.slice(0, maxLength - 1).trim() + "…"
    : stripped;
}

function isUsableImageUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  if (/\.(svg|gif|bmp|tiff|pdf)(\?|$)/i.test(url)) return false;
  if (/(icon|favicon|sprite|placeholder)/i.test(url)) return false;
  return /\.(jpe?g|png|webp)(\?[^\s]*)?$/i.test(url);
}

function extractBestImageUrl(item) {
  const sizes = item?.media_details?.sizes;
  if (sizes && typeof sizes === "object") {
    const preferred = sizes.full || sizes.large || sizes.medium_large || sizes.medium;
    if (preferred?.source_url && isUsableImageUrl(preferred.source_url)) {
      return preferred.source_url;
    }
  }

  if (item?.source_url && isUsableImageUrl(item.source_url)) {
    return item.source_url;
  }

  return null;
}

function mediaObjectFromWp(item) {
  if (!item || typeof item !== "object") return null;
  if (item?.media_type && item.media_type !== "image") return null;

  const url = extractBestImageUrl(item);
  if (!url) return null;

  const title = cleanMediaText(pickRenderedOrRaw(item.title), 200);
  const altText = cleanMediaText(item.alt_text, 300);
  const caption = cleanMediaText(pickRenderedOrRaw(item.caption), 600);
  const description = cleanMediaText(pickRenderedOrRaw(item.description), 800);
  const slug = typeof item.slug === "string" ? item.slug : "";
  const id = item.id ?? null;

  return {
    id,
    url,
    title,
    altText,
    caption,
    description,
    slug
  };
}

function topicKeywords(topic) {
  const base = [
    topic.topicType,
    topic.primaryKeyword,
    topic.title,
    topic.slugBase,
    topic.audience
  ]
    .join(" ")
    .toLowerCase();

  const keywords = new Set(
    base
      .replace(/[^a-z0-9' -]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4)
  );

  if (/rental|rentals|rent/.test(base)) {
    ["rental", "rentals", "storage", "container", "containers", "jobsite"].forEach((word) => keywords.add(word));
  }

  if (/cool|cooling|heat/.test(base)) {
    ["cool", "cooling", "station", "heat", "air", "conditioned"].forEach((word) => keywords.add(word));
  }

  if (/office/.test(base)) {
    ["office", "mobile", "jobsite", "container"].forEach((word) => keywords.add(word));
  }

  if (/custom|build/.test(base)) {
    ["custom", "build", "workshop", "tack", "shed", "container"].forEach((word) => keywords.add(word));
  }

  if (/ranch|agriculture|farm/.test(base)) {
    ["ranch", "farm", "tack", "storage", "agriculture"].forEach((word) => keywords.add(word));
  }

  return [...keywords];
}

function scoreMediaForTopic(media, topic) {
  const haystack = [
    media.title,
    media.altText,
    media.caption,
    media.description,
    media.slug,
    media.url
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
const topicText = [
  topic.topicType,
  topic.primaryKeyword,
  topic.title,
  topic.slugBase,
  topic.audience
].join(" ").toLowerCase();

if (/cool|cooling|cool station|heat/.test(topicText)) {
  if (haystack.includes("cool station")) score += 25;
  if (haystack.includes("cool-station")) score += 25;
  if (haystack.includes("cooling")) score += 15;
  if (haystack.includes("heat")) score += 10;
  if (haystack.includes("office")) score -= 20;
}
  for (const keyword of topicKeywords(topic)) {
    if (haystack.includes(keyword)) score += 1;
  }

  if (media.altText) score += 3;
  if (media.caption) score += 1;
  if (media.description) score += 1;

  return score;
}

async function fetchWordPressMedia() {
  const response = await fetch(WORDPRESS_MEDIA_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "ContentFlowSEOBot/1.0"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`WordPress media fetch failed (${response.status}): ${text.slice(0, 300)}`);
  }

  let items;

  try {
    items = JSON.parse(text);
  } catch {
    throw new Error("WordPress media endpoint returned non-JSON data.");
  }

  if (!Array.isArray(items)) return [];

  return items.map(mediaObjectFromWp).filter(Boolean);
}

async function selectFeaturedMedia(topic) {
  const mediaItems = await fetchWordPressMedia();

  if (!mediaItems.length) {
    return {
      selected: null,
      available: 0,
      reason: "No usable WordPress media found."
    };
  }

  const scored = mediaItems
    .map((media) => ({ media, score: scoreMediaForTopic(media, topic) }))
    .sort((a, b) => b.score - a.score || String(a.media.id).localeCompare(String(b.media.id)));

  const best = scored[0];

  return {
    selected: best.media,
    available: mediaItems.length,
    score: best.score,
    reason: best.score > 0 ? "Matched by topic keywords." : "No strong keyword match; selected first usable approved media."
  };
}

function paragraphsToHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

function buildPostHtml(data, topic, media) {
  const intro = paragraphsToHtml(data.introduction || "");

  const body = Array.isArray(data.sections)
    ? data.sections
        .map((section) => `<h2>${escapeHtml(section.heading)}</h2>\n${paragraphsToHtml(section.body)}`)
        .join("\n")
    : "";

  const faq = Array.isArray(data.faq)
    ? `<h2>Frequently Asked Questions</h2>\n` +
      data.faq
        .map((item) => `<h3>${escapeHtml(item.question)}</h3>\n<p>${escapeHtml(item.answer)}</p>`)
        .join("\n")
    : "";

  const linkLabels = {
    "/#pricing": "View container pricing",
    "/#inventory": "View container examples",
    "/#rentals": "View rental rates",
    "/#delivery": "Review delivery requirements",
    "/#quote": "Request a quote",
    "/#cool-stations": "Learn about Arizona Cool Stations",
    "/#offices": "View mobile office options",
    "/#custom-builds": "Explore custom container builds",
    "/#upgrades": "View container upgrades"
  };

  const links = Array.isArray(topic.internalLinks)
    ? `<h2>Get a Quote</h2>\n<p>Ready to price a container, rental, mobile office, or Cool Station? Use the links below or contact Conex Creation & Supply.</p>\n<ul>` +
      topic.internalLinks
        .map((link) => {
          const label = linkLabels[link] || "Learn more";
          return `<li><a href="${DEFAULT_SOURCE_URL}${link}">${escapeHtml(label)}</a></li>`;
        })
        .join("\n") +
      `</ul>`
    : "";

  const mediaBlock = media?.url
  ? `
<figure class="wp-block-image size-large">
  <img src="${escapeHtml(media.url)}" alt="${escapeHtml(data.imageAltText || media.altText || media.title || topic.title)}" />
</figure>
`
  : "";

  return `
<!-- Generated by ContentFlow SEO automation -->
<p><strong>${escapeHtml(data.metaDescription || "")}</strong></p>
${mediaBlock}
${intro}
${body}
${faq}
${links}
<p><strong>Call Conex Creation & Supply at 520-253-3194 for current availability, pricing, and delivery options.</strong></p>
`.trim();
}

async function generateSeoContent({ topic, dateKey, media }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const selectedMediaContext = media?.url
    ? `
Selected approved media for this post:
- Media ID: ${media.id || ""}
- Image URL: ${media.url || ""}
- Image title: ${media.title || ""}
- Image alt text: ${media.altText || ""}
- Image caption: ${media.caption || ""}
- Image description: ${media.description || ""}
- Image slug: ${media.slug || ""}
`
    : "Selected approved media for this post: none available.";

  const prompt = `
You are creating a local SEO blog post for Conex Creation & Supply.

Business context:
- Business: Conex Creation & Supply
- Website: ${DEFAULT_SOURCE_URL}
- Phone: 520-253-3194
- Service area: Southern Arizona, Willcox, Tucson, Pima County, Santa Cruz County, Nogales, Green Valley, Sahuarita, Vail, Marana, Oro Valley, Safford, Sierra Vista, Benson, Cochise County, and Graham County
- Offers: shipping container sales, container rentals, mobile offices, Arizona Cool Stations, custom container builds, rent-to-own, delivery

Current rental pricing to include when relevant:
- 20' Standard Container Rental: $135/month
- 20' Insulated Container Rental: $175/month
- 40' High Cube Container Rental: $145/month
- 45' High Cube Container Rental: $155/month
- 20' Office Rental: $300/month
- 20' Cool Station Rental: $295/month
- 40' Office Rental: $450/month
- Pricing may not include delivery, pickup fees, tax, permits, or optional upgrades. Inventory and pricing can change.

${selectedMediaContext}

Today's topic:
- Day/date: ${dateKey}
- Topic type: ${topic.topicType}
- Primary keyword: ${topic.primaryKeyword}
- Working title: ${topic.title}
- Audience: ${topic.audience}

Return JSON only with this exact shape:
{
  "seoTitle": "string, under 65 characters",
  "metaDescription": "string, under 155 characters",
  "slug": "string, lowercase-hyphenated",
  "introduction": "2 short paragraphs",
  "sections": [
    {
      "heading": "string",
      "body": "2 short paragraphs"
    }
  ],
  "faq": [
    {
      "question": "string",
      "answer": "string"
    }
  ],
  "excerpt": "string, under 155 characters",
  "imageAltText": "SEO-friendly alt text for the selected approved media"
}

Rules:
- Write for real customers, not search engines only.
- Include the primary keyword naturally.
- If the topic is about rentals, include a short rental pricing section using the current rental pricing provided above.
- Mention Southern Arizona naturally.
- Mention Tucson and Pima County naturally when relevant.
- Do not invent certifications, laws, guarantees, or fake statistics.
- Keep it useful, specific, and local.
- Avoid keyword stuffing.
- Include a clear call to action.
- Write 650 to 900 words total.
- Make it publishable on WordPress.
- If selected media is provided, make the article topic consistent with that media when practical, but do not force it awkwardly.
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
      max_tokens: 2800,
      temperature: 0.45,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${raw.slice(0, 500)}`);
  }

  const payload = JSON.parse(raw);

  const text = Array.isArray(payload.content)
    ? payload.content.map((item) => item.text || "").join("\n").trim()
    : "";

  const parsed = stripJson(text);

  if (!parsed || !parsed.seoTitle || !parsed.sections) {
    throw new Error("Claude response did not include valid SEO JSON.");
  }

  return parsed;
}

async function updateMediaAltText({ mediaId, altText }) {
  if (!mediaId || !altText) return null;

  const baseUrl = process.env.WORDPRESS_BASE_URL || DEFAULT_SOURCE_URL;

  const response = await fetch(`${baseUrl}/wp-json/wp/v2/media/${mediaId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader()
    },
    body: JSON.stringify({ alt_text: altText })
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: text.slice(0, 300) };
  }

  return { ok: true };
}

async function createWordPressPost({ seo, topic, dateKey, media }) {
  const baseUrl = process.env.WORDPRESS_BASE_URL || DEFAULT_SOURCE_URL;
  const status = process.env.WORDPRESS_AUTO_PUBLISH === "true" ? "publish" : "draft";
  const slug = `${seo.slug || topic.slugBase}-${dateKey}`;

  const postBody = {
    title: seo.seoTitle || topic.title,
    slug,
    status,
    excerpt: seo.excerpt || seo.metaDescription || "",
    content: buildPostHtml(seo, topic, media)
  };

  if (media?.id) {
    postBody.featured_media = media.id;
  }

  const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader()
    },
    body: JSON.stringify(postBody)
  });

  const text = await response.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`WordPress post failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return body;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const startedAt = new Date();
  const dateKey = arizonaDateKey(startedAt);
  const topic = getTodaysTopic(startedAt);

  const log = {
    ok: false,
    triggeredAt: startedAt.toISOString(),
    arizonaDate: dateKey,
    topic,
    selectedMedia: null,
    mediaAltTextUpdate: null,
    wordpressStatus: null,
    wordpressPostId: null,
    wordpressLink: null,
    errors: []
  };

  try {
    const mediaResult = await selectFeaturedMedia(topic);
    const media = mediaResult.selected;

    log.selectedMedia = media
      ? {
          id: media.id,
          url: media.url,
          title: media.title,
          altText: media.altText,
          available: mediaResult.available,
          score: mediaResult.score,
          reason: mediaResult.reason
        }
      : {
          available: mediaResult.available,
          reason: mediaResult.reason
        };

    const seo = await generateSeoContent({ topic, dateKey, media });

    if (media?.id && seo.imageAltText) {
      log.mediaAltTextUpdate = await updateMediaAltText({
        mediaId: media.id,
        altText: seo.imageAltText
      });
    }

    const wp = await createWordPressPost({ seo, topic, dateKey, media });

    log.ok = true;
    log.wordpressStatus = wp.status;
    log.wordpressPostId = wp.id;
    log.wordpressLink = wp.link;
    log.seoTitle = seo.seoTitle;
    log.metaDescription = seo.metaDescription;

    return json(res, 200, log);
  } catch (error) {
    log.errors.push(error.message);
    return json(res, 500, log);
  }
};
