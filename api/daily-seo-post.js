const { CONTENT_CALENDAR, getTodaysTopic } = require("./content-calendar");

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

function getTopicForRequest(req, date = new Date()) {
  const requestedDay =
    typeof req.query?.day === "string" ? req.query.day.trim().toLowerCase() : "";

  if (requestedDay) {
    const matchedTopic = CONTENT_CALENDAR.find(
      (item) => item.day.toLowerCase() === requestedDay
    );

    if (matchedTopic) return matchedTopic;
  }

  return getTodaysTopic(date);
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

function normalizeBrand(text) {
  return String(text || "")
    .replace(/Conex Creation and Supply/g, "Conex Creation & Supply")
    .replace(/Conex Creation And Supply/g, "Conex Creation & Supply")
    .replace(/Conex Creation &amp; Supply/g, "Conex Creation & Supply");
}

function removeMarkdown(text) {
  return normalizeBrand(text)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function escapeHtml(text) {
  return removeMarkdown(text)
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

  if (item?.source_url && isUsableImageUrl(item.source_url)) return item.source_url;

  return null;
}

function mediaObjectFromWp(item) {
  if (!item || typeof item !== "object") return null;
  if (item?.media_type && item.media_type !== "image") return null;

  const url = extractBestImageUrl(item);
  if (!url) return null;

  return {
    id: item.id ?? null,
    url,
    title: cleanMediaText(pickRenderedOrRaw(item.title), 200),
    altText: cleanMediaText(item.alt_text, 300),
    caption: cleanMediaText(pickRenderedOrRaw(item.caption), 600),
    description: cleanMediaText(pickRenderedOrRaw(item.description), 800),
    slug: typeof item.slug === "string" ? item.slug : ""
  };
}

function topicText(topic) {
  return [
    topic.topicType,
    topic.primaryKeyword,
    topic.title,
    topic.slugBase,
    topic.audience
  ]
    .join(" ")
    .toLowerCase();
}

function topicKeywords(topic) {
  const base = topicText(topic);

  const keywords = new Set(
    base
      .replace(/[^a-z0-9' -]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4)
  );

  if (/rental|rentals|rent/.test(base)) {
    ["rental", "rentals", "storage", "container", "containers", "jobsite"].forEach((word) =>
      keywords.add(word)
    );
  }

  if (/cool|cooling|heat/.test(base)) {
    ["cool", "cooling", "station", "heat", "air", "conditioned"].forEach((word) =>
      keywords.add(word)
    );
  }

  if (/office/.test(base)) {
    ["office", "mobile", "jobsite", "container"].forEach((word) => keywords.add(word));
  }

  if (/custom|build/.test(base)) {
    ["custom", "build", "workshop", "tack", "shed", "container"].forEach((word) =>
      keywords.add(word)
    );
  }

  if (/ranch|agriculture|farm/.test(base)) {
    ["ranch", "farm", "tack", "storage", "agriculture"].forEach((word) =>
      keywords.add(word)
    );
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
  const text = topicText(topic);

  if (/cool|cooling|cool station|heat/.test(text)) {
    if (haystack.includes("cool station")) score += 25;
    if (haystack.includes("cool-station")) score += 25;
    if (haystack.includes("cooling")) score += 15;
    if (haystack.includes("heat")) score += 10;
    if (haystack.includes("office")) score -= 20;
  }

  if (/office|mobile office/.test(text)) {
    if (haystack.includes("office")) score += 25;
    if (haystack.includes("mobile office")) score += 25;
    if (haystack.includes("office-rental")) score += 20;
    if (haystack.includes("cool")) score -= 10;
  }

  if (/tack|tack room|horse|saddle|bridle/.test(text)) {
    if (haystack.includes("tack")) score += 35;
    if (haystack.includes("tack-room")) score += 35;
    if (haystack.includes("saddle")) score += 25;
    if (haystack.includes("bridle")) score += 20;
    if (haystack.includes("horse")) score += 15;
  }

  if (/ranch|agriculture|farm|tack/.test(text)) {
    if (haystack.includes("ranch")) score += 20;
    if (haystack.includes("farm")) score += 15;
    if (haystack.includes("tack")) score += 20;
    if (haystack.includes("agriculture")) score += 15;
  }

  if (/custom|build|workshop|shed/.test(text)) {
    if (haystack.includes("custom")) score += 20;
    if (haystack.includes("build")) score += 15;
    if (haystack.includes("workshop")) score += 20;
    if (haystack.includes("shed")) score += 15;
  }

  if (/rental|rentals|storage/.test(text) && !/office|cool/.test(text)) {
    if (haystack.includes("rental")) score += 20;
    if (haystack.includes("container")) score += 15;
    if (haystack.includes("storage")) score += 15;
    if (haystack.includes("office")) score -= 10;
    if (haystack.includes("cool")) score -= 10;
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
    reason:
      best.score > 0
        ? "Matched by topic keywords."
        : "No strong keyword match; selected first usable approved media."
  };
}

function getCategoryNameForTopic(topic) {
  const text = topicText(topic);

  if (/cool|cooling|cool station|heat/.test(text)) return "Cool Stations";
  if (/mobile office|office/.test(text)) return "Mobile Offices";
  if (/tack|tack room|horse|saddle|bridle/.test(text)) return "Tack Rooms";
  if (/custom|build|workshop|shed/.test(text)) return "Custom Builds";
  if (/ranch|agriculture|farm/.test(text)) return "Ranch & Agriculture";
  if (/delivery|site prep|requirements/.test(text)) return "Delivery Tips";
  if (/rental|rentals|rent/.test(text)) return "Container Rentals";
  if (/sale|sales|buy|purchase/.test(text)) return "Container Sales";

  return "Container Rentals";
}

function getTagNamesForTopic(topic) {
  const text = topicText(topic);

  const tags = new Set([
    "Southern Arizona",
    "Tucson",
    "Pima County",
    "Shipping Containers",
    "Conex Creation"
  ]);

  if (/cool|cooling|cool station|heat/.test(text)) {
    ["Cool Stations", "Mobile Cooling Stations", "Heat Safety", "Jobsite Cooling"].forEach((tag) =>
      tags.add(tag)
    );
  }

  if (/mobile office|office/.test(text)) {
    ["Mobile Offices", "Jobsite Office", "Container Office"].forEach((tag) => tags.add(tag));
  }

  if (/tack|tack room|horse|saddle|bridle/.test(text)) {
    ["Tack Rooms", "Horse Property", "Ranch Storage", "Saddle Storage"].forEach((tag) =>
      tags.add(tag)
    );
  }

  if (/custom|build|workshop|shed/.test(text)) {
    ["Custom Builds", "Container Builds", "Workshops", "Backyard Storage"].forEach((tag) =>
      tags.add(tag)
    );
  }

  if (/ranch|agriculture|farm/.test(text)) {
    ["Ranch Storage", "Agriculture", "Farm Storage", "Rural Delivery"].forEach((tag) =>
      tags.add(tag)
    );
  }

  if (/delivery|site prep|requirements/.test(text)) {
    ["Container Delivery", "Delivery Requirements", "Site Prep"].forEach((tag) => tags.add(tag));
  }

  if (/rental|rentals|rent/.test(text)) {
    ["Container Rentals", "Storage Rentals", "Jobsite Storage"].forEach((tag) => tags.add(tag));
  }

  if (/sale|sales|buy|purchase/.test(text)) {
    ["Container Sales", "Containers for Sale", "One Trip Containers"].forEach((tag) =>
      tags.add(tag)
    );
  }

  return [...tags];
}

async function findTermByName(baseUrl, taxonomy, name) {
  const endpoint = `${baseUrl}/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(
    name
  )}&per_page=100`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      authorization: authHeader()
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`WordPress ${taxonomy} search failed (${response.status}): ${text.slice(0, 300)}`);
  }

  let terms;
  try {
    terms = JSON.parse(text);
  } catch {
    throw new Error(`WordPress ${taxonomy} search returned non-JSON data.`);
  }

  if (!Array.isArray(terms)) return null;

  return terms.find((term) => String(term.name || "").toLowerCase() === name.toLowerCase()) || null;
}

async function createTerm(baseUrl, taxonomy, name) {
  const response = await fetch(`${baseUrl}/wp-json/wp/v2/${taxonomy}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader()
    },
    body: JSON.stringify({ name })
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    if (body?.code === "term_exists" && body?.data?.term_id) {
      return { id: body.data.term_id, name };
    }

    throw new Error(`WordPress ${taxonomy} create failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return body;
}

async function getOrCreateTerm(baseUrl, taxonomy, name) {
  const existing = await findTermByName(baseUrl, taxonomy, name);
  if (existing?.id) return existing;
  return createTerm(baseUrl, taxonomy, name);
}

async function resolveTaxonomies(topic) {
  const baseUrl = process.env.WORDPRESS_BASE_URL || DEFAULT_SOURCE_URL;

  const result = {
    categoryName: getCategoryNameForTopic(topic),
    categoryIds: [],
    tagNames: getTagNamesForTopic(topic),
    tagIds: [],
    errors: []
  };

  try {
    const category = await getOrCreateTerm(baseUrl, "categories", result.categoryName);
    if (category?.id) result.categoryIds.push(category.id);
  } catch (error) {
    result.errors.push(`Category error: ${error.message}`);
  }

  for (const tagName of result.tagNames) {
    try {
      const tag = await getOrCreateTerm(baseUrl, "tags", tagName);
      if (tag?.id) result.tagIds.push(tag.id);
    } catch (error) {
      result.errors.push(`Tag error for ${tagName}: ${error.message}`);
    }
  }

  return result;
}

function getTopicSpecificCta(topic) {
  const text = topicText(topic);

  if (/tack|tack room|horse|saddle|bridle/.test(text)) {
    return "Ready to price a custom container tack room, ranch storage container, or horse property storage solution?";
  }

  if (/cool|cooling|cool station|heat/.test(text)) {
    return "Ready to rent an Arizona Cool Station or add a cooled break area to your jobsite?";
  }

  if (/mobile office|office/.test(text)) {
    return "Ready to price a mobile office container for your jobsite or business?";
  }

  if (/custom|build|workshop|shed/.test(text)) {
    return "Ready to price a custom container build, workshop, shed, office, or backyard project?";
  }

  if (/ranch|agriculture|farm/.test(text)) {
    return "Ready to price a ranch storage container, tack room, or agricultural storage solution?";
  }

  if (/delivery|site prep|requirements/.test(text)) {
    return "Ready to schedule container delivery or confirm what your site needs before placement?";
  }

  if (/rental|rentals|rent/.test(text)) {
    return "Ready to price a storage container rental, mobile office rental, or Cool Station rental?";
  }

  if (/sale|sales|buy|purchase/.test(text)) {
    return "Ready to price a new or used shipping container for your property, jobsite, or business?";
  }

  return "Ready to price a container, rental, mobile office, Cool Station, or custom build?";
}

function paragraphToHtmlBlock(paragraph) {
  const clean = removeMarkdown(paragraph || "").trim();
  if (!clean) return "";

  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const looksLikeList =
    lines.length > 1 && lines.every((line) => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line));

  if (looksLikeList) {
    const items = lines
      .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim())
      .filter(Boolean)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("\n");

    return `<ul>\n${items}\n</ul>`;
  }

  return `<p>${escapeHtml(clean)}</p>`;
}

function paragraphsToHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map(paragraphToHtmlBlock)
    .filter(Boolean)
    .join("\n");
}

function buildPostHtml(data, topic, media) {
  const intro = paragraphsToHtml(data.introduction || "");

  const mediaBlock = media?.url
    ? `
<figure class="wp-block-image size-large">
  <img src="${escapeHtml(media.url)}" alt="${escapeHtml(
        data.imageAltText || media.altText || media.title || topic.title
      )}" />
</figure>
`
    : "";

  const body = Array.isArray(data.sections)
    ? data.sections
        .map(
          (section) =>
            `<h2>${escapeHtml(section.heading)}</h2>\n${paragraphsToHtml(section.body)}`
        )
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

  const ctaText = getTopicSpecificCta(topic);

  const links = Array.isArray(topic.internalLinks)
    ? `<h2>Get a Quote</h2>\n<p>${escapeHtml(
        ctaText
      )} Use the links below or contact Conex Creation & Supply.</p>\n<ul>` +
      topic.internalLinks
        .map((link) => {
          const label = linkLabels[link] || "Learn more";
          return `<li><a href="${DEFAULT_SOURCE_URL}${link}">${escapeHtml(label)}</a></li>`;
        })
        .join("\n") +
      `</ul>`
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
- IMPORTANT: Always write the business name exactly as "Conex Creation & Supply". Never write "Conex Creation and Supply."
- Website: ${DEFAULT_SOURCE_URL}
- Phone: 520-253-3194
- Service area: Southern Arizona, Willcox, Tucson, Pima County, Santa Cruz County, Nogales, Green Valley, Sahuarita, Vail, Marana, Oro Valley, Safford, Sierra Vista, Benson, Cochise County, and Graham County
- Offers: shipping container sales, container rentals, mobile offices, Arizona Cool Stations, custom container builds, tack rooms, rent-to-own, delivery

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
- If listing prices, write them in normal sentence form instead of Markdown bullets.
- Do not use Markdown formatting inside the JSON fields. Do not use **bold**, markdown bullets, tables, or raw HTML.
- Use plain sentences and paragraphs only inside JSON fields.
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

async function generateSocialContent({ topic, seo, media, wordpressLink }) {
  const articleUrl = wordpressLink || DEFAULT_SOURCE_URL;
  const topicType = topic.topicType || "Shipping Containers";
  const title = removeMarkdown(seo.seoTitle || topic.title || "");
  const metaDescription = removeMarkdown(seo.metaDescription || seo.excerpt || "");

  const hashtags = new Set([
    "#ConexCreation",
    "#ShippingContainers",
    "#SouthernArizona",
    "#Tucson"
  ]);

  const text = topicText(topic);

  if (/cool|cooling|cool station|heat/.test(text)) {
    ["#CoolStations", "#JobsiteSafety", "#ArizonaHeat", "#Construction"].forEach((tag) =>
      hashtags.add(tag)
    );
  }

  if (/mobile office|office/.test(text)) {
    ["#MobileOffice", "#JobsiteOffice", "#Contractors"].forEach((tag) => hashtags.add(tag));
  }

  if (/tack|tack room|horse|saddle|bridle/.test(text)) {
    ["#TackRoom", "#HorseProperty", "#RanchStorage", "#Rodeo"].forEach((tag) =>
      hashtags.add(tag)
    );
  }

  if (/custom|build|workshop|shed/.test(text)) {
    ["#CustomBuilds", "#ContainerBuilds", "#Workshop"].forEach((tag) => hashtags.add(tag));
  }

  if (/rental|rentals|rent/.test(text)) {
    ["#ContainerRentals", "#StorageSolutions"].forEach((tag) => hashtags.add(tag));
  }

  const hookByTopic = (() => {
    if (/cool|cooling|cool station|heat/.test(text)) {
      return "Arizona heat is brutal. Give your crew a real place to cool down.";
    }

    if (/tack|tack room|horse|saddle|bridle/.test(text)) {
      return "Need a tack room that can handle Arizona heat, dust, and ranch life?";
    }

    if (/mobile office|office/.test(text)) {
      return "Need a real office on your jobsite instead of working out of a truck?";
    }

    if (/custom|build|workshop|shed/.test(text)) {
      return "Shipping containers can be more than storage.";
    }

    if (/delivery|site prep|requirements/.test(text)) {
      return "Getting a container delivered? Site prep matters.";
    }

    if (/rental|rentals|rent/.test(text)) {
      return "Need temporary storage without buying a container outright?";
    }

    if (/sale|sales|buy|purchase/.test(text)) {
      return "Looking for a new or used shipping container in Southern Arizona?";
    }

    return "Need rugged container storage or a custom container solution?";
  })();

  const shortCaption = [
    hookByTopic,
    "",
    metaDescription || title,
    "",
    "Read the full article or request a quote:",
    articleUrl,
    "",
    "Call Conex Creation & Supply at 520-253-3194."
  ].join("\n");

  const instagramCaption = [
    hookByTopic,
    "",
    metaDescription || title,
    "",
    "Conex Creation & Supply serves Tucson, Willcox, Cochise County, Graham County, Santa Cruz County, Pima County, and Southern Arizona.",
    "",
    "Call 520-253-3194 for current availability, pricing, and delivery options.",
    "",
    [...hashtags].slice(0, 12).join(" ")
  ].join("\n");

  const facebookCaption = [
    hookByTopic,
    "",
    metaDescription || title,
    "",
    "Read more:",
    articleUrl,
    "",
    "Call 520-253-3194 for current availability, pricing, and delivery options.",
    "",
    [...hashtags].slice(0, 6).join(" ")
  ].join("\n");

  return {
    enabled: true,
    publishEnabled: process.env.SEO_SOCIAL_PUBLISH === "true",
    platforms: (process.env.SEO_SOCIAL_PLATFORMS || "facebook,instagram")
      .split(",")
      .map((platform) => platform.trim().toLowerCase())
      .filter(Boolean),
    topicType,
    articleUrl,
    imageUrl: media?.url || "",
    title,
    metaDescription,
    hashtags: [...hashtags],
    preview: {
      facebook: facebookCaption,
      instagram: instagramCaption
    },
    publishPayload: {
      platforms: (process.env.SEO_SOCIAL_PLATFORMS || "facebook,instagram")
        .split(",")
        .map((platform) => platform.trim().toLowerCase())
        .filter(Boolean),
      caption: shortCaption,
      content: shortCaption,
      message: shortCaption,
      linkUrl: articleUrl,
      url: articleUrl,
      imageUrl: media?.url || "",
      mediaUrl: media?.url || ""
    }
  };
}

async function maybePublishSocial(social) {
  if (!social?.publishEnabled) {
    return {
      attempted: false,
      reason: "SEO_SOCIAL_PUBLISH is not true. Social post preview generated only."
    };
  }

  const appBaseUrl =
    process.env.CONTENTFLOW_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (!appBaseUrl) {
    return {
      attempted: false,
      error: "No ContentFlow app base URL configured. Set CONTENTFLOW_BASE_URL if you want automatic social publishing."
    };
  }

  const response = await fetch(`${appBaseUrl}/api/publish-post`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(social.publishPayload)
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok || body.ok === false) {
    return {
      attempted: true,
      ok: false,
      error: body.error || text
    };
  }

  return {
    attempted: true,
    ok: true,
    response: body
  };
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
    body: JSON.stringify({ alt_text: removeMarkdown(altText) })
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: text.slice(0, 300) };
  }

  return { ok: true };
}

async function createWordPressPost({ seo, topic, dateKey, media, taxonomies }) {
  const baseUrl = process.env.WORDPRESS_BASE_URL || DEFAULT_SOURCE_URL;
  const status = process.env.WORDPRESS_AUTO_PUBLISH === "true" ? "publish" : "draft";
  const slug = `${seo.slug || topic.slugBase}-${dateKey}`;

  const postBody = {
    title: removeMarkdown(seo.seoTitle || topic.title),
    slug,
    status,
    excerpt: removeMarkdown(seo.excerpt || seo.metaDescription || ""),
    content: buildPostHtml(seo, topic, media)
  };

  if (media?.id) postBody.featured_media = media.id;
  if (taxonomies?.categoryIds?.length) postBody.categories = taxonomies.categoryIds;
  if (taxonomies?.tagIds?.length) postBody.tags = taxonomies.tagIds;

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
  const topic = getTopicForRequest(req, startedAt);

  const log = {
    ok: false,
    triggeredAt: startedAt.toISOString(),
    arizonaDate: dateKey,
    topic,
    selectedMedia: null,
    mediaAltTextUpdate: null,
    taxonomies: null,
    social: null,
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

    const taxonomies = await resolveTaxonomies(topic);
    log.taxonomies = taxonomies;

    const seo = await generateSeoContent({ topic, dateKey, media });

    if (media?.id && seo.imageAltText) {
      log.mediaAltTextUpdate = await updateMediaAltText({
        mediaId: media.id,
        altText: seo.imageAltText
      });
    }

    const wp = await createWordPressPost({ seo, topic, dateKey, media, taxonomies });

    log.ok = true;
    log.wordpressStatus = wp.status;
    log.wordpressPostId = wp.id;
    log.wordpressLink = wp.link;
    log.seoTitle = seo.seoTitle;
    log.metaDescription = seo.metaDescription;

    const social = await generateSocialContent({
      topic,
      seo,
      media,
      wordpressLink: wp.link
    });

    social.publishResult = await maybePublishSocial(social);
    log.social = social;

    return json(res, 200, log);
  } catch (error) {
    log.errors.push(error.message);
    return json(res, 500, log);
  }
};
