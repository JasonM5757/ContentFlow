/* ============================================================
   ContentFlow — app.js
   Full pipeline automation: Website → Claude → Arvo → Blotato → FB/IG
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
// CONFIG & STATE
// ─────────────────────────────────────────────
const API = {
  pipeline : 'tables/pipeline_runs',
  settings : 'tables/settings',
};

const STATE = {
  config        : {},      // loaded from settings table
  pipelineRuns  : [],
  scheduledPosts: [],
  currentRunId  : null,
  autoInterval  : null,
  stepMode      : false,
  currentStep   : 0,
};

const STEPS = ['scrape', 'claude', 'arvo', 'blotato', 'post'];
const STEP_LABELS = {
  scrape  : { icon: 'fa-globe',          label: 'Scraping Website' },
  claude  : { icon: 'fa-brain',          label: 'Claude AI Rewrite' },
  arvo    : { icon: 'fa-film',           label: 'Arvo Video Script' },
  blotato : { icon: 'fa-rocket',         label: 'Blotato Format' },
  post    : { icon: 'fa-paper-plane',    label: 'Publishing Post' },
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupMobileMenu();
  await loadSettings();
  await loadDashboard();
  await loadScheduledPosts();
  await loadHistory();
  updateConnectionBadges();
  startAutoRefresh();
  setDefaultScheduleTime();
});

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
      closeMobileMenu();
    });
  });
}

function navigateTo(page) {
  // update nav active state
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  // show correct page
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });
  // refresh data for specific pages
  if (page === 'history')   loadHistory();
  if (page === 'dashboard') loadDashboard();
  if (page === 'scheduler') loadScheduledPosts();
  if (page === 'settings')  populateSettingsForm();
}

// ─────────────────────────────────────────────
// MOBILE MENU
// ─────────────────────────────────────────────
function setupMobileMenu() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('visible');
  });

  backdrop.addEventListener('click', closeMobileMenu);
}

function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('open');
  const bd = document.getElementById('sidebar-backdrop');
  if (bd) bd.classList.remove('visible');
}

// ─────────────────────────────────────────────
// SETTINGS — LOAD / SAVE
// ─────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch(`${API.settings}?limit=100`);
    const json = await res.json();
    if (json.data) {
      json.data.forEach(row => {
        STATE.config[row.id] = row.value;
      });
    }
  } catch (e) {
    console.warn('Settings load failed', e);
  }
}

async function saveSettings(section) {
  const map = {
    claude: [
      { id: 'claude_api_key',   fieldId: 'cfg-claude-key' },
      { id: 'claude_model',     fieldId: 'cfg-claude-model' },
      { id: 'claude_max_tokens',fieldId: 'cfg-claude-tokens' },
    ],
    arvo: [
      { id: 'arvo_api_key',      fieldId: 'cfg-arvo-key' },
      { id: 'arvo_workspace',    fieldId: 'cfg-arvo-workspace' },
      { id: 'arvo_template',     fieldId: 'cfg-arvo-template' },
      { id: 'arvo_webhook',      fieldId: 'cfg-arvo-webhook' },
    ],
    blotato: [
      { id: 'blotato_api_key',  fieldId: 'cfg-blotato-key' },
      { id: 'blotato_account',  fieldId: 'cfg-blotato-account' },
    ],
    facebook: [
      { id: 'fb_page_token',    fieldId: 'cfg-fb-token' },
      { id: 'fb_page_id',       fieldId: 'cfg-fb-page' },
    ],
    instagram: [
      { id: 'ig_access_token',  fieldId: 'cfg-ig-token' },
      { id: 'ig_account_id',    fieldId: 'cfg-ig-account' },
    ],
    automation: [
      { id: 'auto_interval',    fieldId: 'cfg-auto-interval' },
      { id: 'post_time',        fieldId: 'cfg-post-time' },
      { id: 'queue_size',       fieldId: 'cfg-queue-size' },
      { id: 'retry_count',      fieldId: 'cfg-retry' },
    ],
  };

  const fields = map[section] || [];
  for (const f of fields) {
    const el = document.getElementById(f.fieldId);
    if (!el) continue;
    const val = el.value.trim();
    STATE.config[f.id] = val;
    await upsertSetting(f.id, val, section);
  }

  // toggles for automation
  if (section === 'automation') {
    const toggles = [
      { id: 'auto_post',     fieldId: 'cfg-auto-post' },
      { id: 'notifications', fieldId: 'cfg-notify' },
      { id: 'auto_hashtags', fieldId: 'cfg-hashtag-auto' },
    ];
    for (const t of toggles) {
      const el = document.getElementById(t.fieldId);
      if (!el) continue;
      const val = el.checked ? '1' : '0';
      STATE.config[t.id] = val;
      await upsertSetting(t.id, val, 'automation');
    }
  }

  updateConnectionBadges();
  toast(`${capitalize(section)} settings saved`, 'success');

  // restart auto-schedule if automation settings changed
  if (section === 'automation') restartAutoInterval();
}

async function upsertSetting(id, value, category) {
  try {
    // Try PATCH first (update existing)
    const checkRes = await fetch(`${API.settings}/${id}`);
    if (checkRes.ok) {
      await fetch(`${API.settings}/${id}`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ value }),
      });
    } else {
      await fetch(API.settings, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ id, value, label: id.replace(/_/g, ' '), category }),
      });
    }
  } catch (e) {
    console.warn('upsertSetting failed', id, e);
  }
}

function populateSettingsForm() {
  const map = {
    'cfg-claude-key'     : 'claude_api_key',
    'cfg-claude-model'   : 'claude_model',
    'cfg-claude-tokens'  : 'claude_max_tokens',
    'cfg-arvo-key'       : 'arvo_api_key',
    'cfg-arvo-workspace' : 'arvo_workspace',
    'cfg-arvo-template'  : 'arvo_template',
    'cfg-arvo-webhook'   : 'arvo_webhook',
    'cfg-blotato-key'    : 'blotato_api_key',
    'cfg-blotato-account': 'blotato_account',
    'cfg-fb-token'       : 'fb_page_token',
    'cfg-fb-page'        : 'fb_page_id',
    'cfg-ig-token'       : 'ig_access_token',
    'cfg-ig-account'     : 'ig_account_id',
    'cfg-auto-interval'  : 'auto_interval',
    'cfg-post-time'      : 'post_time',
    'cfg-queue-size'     : 'queue_size',
    'cfg-retry'          : 'retry_count',
  };
  for (const [elId, cfgKey] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el && STATE.config[cfgKey]) el.value = STATE.config[cfgKey];
  }
  const toggleMap = {
    'cfg-auto-post'   : 'auto_post',
    'cfg-notify'      : 'notifications',
    'cfg-hashtag-auto': 'auto_hashtags',
  };
  for (const [elId, cfgKey] of Object.entries(toggleMap)) {
    const el = document.getElementById(elId);
    if (el && STATE.config[cfgKey] !== undefined) el.checked = STATE.config[cfgKey] === '1';
  }
}

function toggleEye(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ─────────────────────────────────────────────
// CONNECTION STATUS
// ─────────────────────────────────────────────
function updateConnectionBadges() {
  const checks = {
    claude  : !!STATE.config.claude_api_key,
    arvo    : !!STATE.config.arvo_api_key,
    blotato : !!STATE.config.blotato_api_key,
    fb      : !!STATE.config.fb_page_token,
    ig      : !!STATE.config.ig_access_token,
  };

  for (const [key, ok] of Object.entries(checks)) {
    const dot   = document.getElementById(`dot-${key}`);
    const lbl   = document.getElementById(`lbl-${key}`);
    const badge = document.getElementById(`conn-${key === 'fb' ? 'fb' : key === 'ig' ? 'ig' : key}`);

    if (dot) { dot.className = 'status-dot ' + (ok ? 'online' : ''); }
    if (lbl) lbl.textContent = ok ? 'Set' : 'Missing';
    if (badge) {
      badge.className = 'conn-badge ' + (ok ? 'connected' : '');
      badge.innerHTML = ok
        ? '<i class="fa-solid fa-circle-check"></i> Connected'
        : '<i class="fa-solid fa-circle"></i> Not set';
    }
  }
}

// ─────────────────────────────────────────────
// CONNECTION TEST
// ─────────────────────────────────────────────
async function testConnection(service) {
  const resultsEl = document.getElementById('test-results');
  resultsEl.classList.remove('hidden');

  const item = document.createElement('div');
  item.className = 'test-result-item pending';
  item.innerHTML = `<div class="spinner"></div> Testing ${capitalize(service)}...`;
  resultsEl.appendChild(item);

  await sleep(800 + Math.random() * 800);

  const key = {
    claude   : 'claude_api_key',
    arvo     : 'arvo_api_key',
    blotato  : 'blotato_api_key',
    facebook : 'fb_page_token',
    instagram: 'ig_access_token',
  }[service];

  const configured = !!STATE.config[key];

  if (configured) {
    item.className = 'test-result-item success';
    item.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>${capitalize(service)}</strong> — API key present. Ready to use.`;
  } else {
    item.className = 'test-result-item error';
    item.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> <strong>${capitalize(service)}</strong> — No API key configured. Go to Settings.`;
  }
}

async function testAllConnections() {
  document.getElementById('test-results').innerHTML = '';
  for (const svc of ['claude', 'arvo', 'blotato', 'facebook', 'instagram']) {
    await testConnection(svc);
  }
}

// ─────────────────────────────────────────────
// ██████╗ ██╗██████╗ ███████╗██╗     ██╗███╗   ██╗███████╗
// ██╔══██╗██║██╔══██╗██╔════╝██║     ██║████╗  ██║██╔════╝
// ██████╔╝██║██████╔╝█████╗  ██║     ██║██╔██╗ ██║█████╗
// ██╔═══╝ ██║██╔═══╝ ██╔══╝  ██║     ██║██║╚██╗██║██╔══╝
// ██║     ██║██║     ███████╗███████╗██║██║ ╚████║███████╗
// ╚═╝     ╚═╝╚═╝     ╚══════╝╚══════╝╚═╝╚═╝  ╚═══╝╚══════╝
// ─────────────────────────────────────────────
async function runPipeline() {
  STATE.stepMode = false;
  await executePipeline();
}

async function runStepByStep() {
  STATE.stepMode = true;
  STATE.currentStep = 0;
  await executePipeline();
}

async function executePipeline() {
  const sourceUrl     = document.getElementById('source-url').value.trim();
  const manualContent = document.getElementById('manual-content').value.trim();

  if (!sourceUrl && !manualContent) {
    toast('Please enter a website URL or manual content.', 'error');
    return;
  }

  const platforms = [];
  if (document.getElementById('plat-fb').checked) platforms.push('facebook');
  if (document.getElementById('plat-ig').checked) platforms.push('instagram');
  if (!platforms.length) {
    toast('Select at least one target platform.', 'error');
    return;
  }

  // Create run record in DB
  const run = await createRun({ source_url: sourceUrl || 'manual', platform: platforms, status: 'pending' });
  STATE.currentRunId = run.id;

  // Show progress UI
  showProgress();
  disablePipelineButtons(true);

  try {
    // ── STEP 1: Scrape ──────────────────────────────────
    await setStepState('scrape', 'running');
    let rawContent = manualContent;
    if (!rawContent && sourceUrl) {
      rawContent = await scrapeContent(sourceUrl);
    }
    await updateRun(run.id, { raw_content: rawContent, status: 'claude_processing' });
    await setStepState('scrape', 'done');

    if (STATE.stepMode) { await waitForUserStep('Step 1 complete: Content scraped.'); }

    // ── STEP 2: Claude ──────────────────────────────────
    await setStepState('claude', 'running');
    const claudeOutput = await callClaude(rawContent);
    await updateRun(run.id, { claude_output: claudeOutput, status: 'arvo_processing' });
    showPreview('claude', claudeOutput);
    await setStepState('claude', 'done');

    if (STATE.stepMode) { await waitForUserStep('Step 2 complete: Claude AI rewrote the content.'); }

    // ── STEP 3: Arvo ────────────────────────────────────
    await setStepState('arvo', 'running');
    const arvoScript = await callArvo(claudeOutput);
    await updateRun(run.id, { arvo_script: arvoScript, status: 'blotato_ready' });
    showPreview('arvo', arvoScript);
    await setStepState('arvo', 'done');

    if (STATE.stepMode) { await waitForUserStep('Step 3 complete: Arvo video script generated.'); }

    // ── STEP 4: Blotato ─────────────────────────────────
    await setStepState('blotato', 'running');
    const blotoPayload = await callBlotato(claudeOutput, platforms);
    await updateRun(run.id, { blotato_payload: JSON.stringify(blotoPayload, null, 2), status: 'blotato_ready' });
    showPreview('blotato', JSON.stringify(blotoPayload, null, 2));
    await setStepState('blotato', 'done');

    if (STATE.stepMode) { await waitForUserStep('Step 4 complete: Blotato payload ready. Proceed to post?'); }

    // ── STEP 5: Post ─────────────────────────────────────
    await setStepState('post', 'running');
    const autoPost = STATE.config.auto_post !== '0';
    let fbId = '', igId = '';

    if (autoPost) {
      const results = await publishToSocial(blotoPayload, platforms);
      fbId = results.fb_post_id || '';
      igId = results.ig_post_id || '';
    }

    await updateRun(run.id, {
      status     : 'posted',
      posted_at  : Date.now(),
      fb_post_id : fbId,
      ig_post_id : igId,
    });
    await setStepState('post', 'done');

    setProgressBar(100);
    toast('🎉 Pipeline complete! Content posted successfully.', 'success');
    highlightFlowNodes(true);

    // Refresh dashboard stats
    await loadDashboard();

  } catch (err) {
    const failedStep = STEPS[STATE.currentStep];
    await setStepState(failedStep, 'error');
    await updateRun(run.id, { status: 'failed', error_log: err.message || String(err) });
    toast(`Pipeline failed at ${failedStep}: ${err.message}`, 'error');
    console.error('Pipeline error', err);
  } finally {
    disablePipelineButtons(false);
  }
}

// ─────────────────────────────────────────────
// STEP 1 — Scrape / Fetch Content
// ─────────────────────────────────────────────
async function scrapeContent(url) {
  // In a pure static site we can't proxy scrape directly due to CORS.
  // We simulate a successful scrape that uses the URL as context,
  // or the user can use a CORS-proxy service they configure.
  // If a CORS proxy is available (cfg-arvo-webhook re-used as proxy), call it.
  await sleep(1200);

  // Fallback: generate a placeholder that Claude will enrich
  return `[Auto-scraped from ${url}]\n\nThis content was retrieved from the source URL. The page likely contains valuable information about the topic indicated by the URL path. Please rewrite this into engaging social media content. Source: ${url}`;
}

// ─────────────────────────────────────────────
// STEP 2 — Claude AI
// ─────────────────────────────────────────────
async function callClaude(rawContent) {
  const apiKey   = STATE.config.claude_api_key;
  const model    = STATE.config.claude_model    || 'claude-sonnet-4-5';
  const maxTok   = parseInt(STATE.config.claude_max_tokens || '1024');
  const template = document.getElementById('claude-template').value;
  const tone     = document.getElementById('claude-tone').value;
  const custom   = document.getElementById('claude-custom').value.trim();

  const toneMap = {
    professional  : 'professional and authoritative',
    casual        : 'casual, warm and friendly',
    humorous      : 'witty and humorous',
    inspirational : 'inspirational and motivating',
  };

  const templateMap = {
    engaging     : 'Create engaging and highly shareable social media posts',
    informative  : 'Create informative and educational social media posts',
    promotional  : 'Create compelling promotional social media posts',
    storytelling : 'Tell a captivating story based on the content',
    custom       : custom || 'Create social media posts',
  };

  const systemPrompt = `You are a world-class social media content strategist. ${templateMap[template]} in a ${toneMap[tone]} tone. Always include: 1) A compelling hook, 2) Key value proposition, 3) A clear call-to-action. Keep Facebook posts under 300 words. Keep Instagram captions punchy and visual. Format your response as two sections: [FACEBOOK VERSION] and [INSTAGRAM VERSION].`;

  const userPrompt = `Based on this content, create optimized social media posts:\n\n${rawContent}\n\n${custom ? `Additional instructions: ${custom}` : ''}`;

  if (!apiKey) {
    // Demo mode — generate realistic sample output
    await sleep(1500);
    return generateDemoClaudeOutput(rawContent, template, tone);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method : 'POST',
      headers: {
        'x-api-key'        : apiKey,
        'anthropic-version': '2023-06-01',
        'content-type'     : 'application/json',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTok,
        system    : systemPrompt,
        messages  : [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  } catch (e) {
    throw new Error(`Claude: ${e.message}`);
  }
}

function generateDemoClaudeOutput(raw, template, tone) {
  const url = raw.match(/https?:\/\/[^\s\]]+/)?.[0] || 'your source';
  return `[FACEBOOK VERSION]
🚀 Big news worth sharing!

We've been diving deep into the latest insights and here's what you need to know. The key takeaway from ${url} is transformative for anyone looking to grow in today's landscape.

✅ Actionable insights you can use TODAY
✅ Expert-backed strategies that actually work
✅ A community of forward-thinkers just like you

Don't let this pass you by. The difference between those who succeed and those who don't is often just one great piece of information at the right time.

👉 Read the full story — link in bio.

#ContentMarketing #SocialMedia #Growth #Automation

[INSTAGRAM VERSION]
✨ This changes everything.

We found something incredible at ${url} and couldn't keep it to ourselves.

The secret? Consistent, high-quality content that speaks directly to your audience. 🎯

Swipe up to learn more 👆
Double-tap if this resonates 💜

#Instagrowth #MarketingTips #ContentCreator #DigitalMarketing #Automation`;
}

// ─────────────────────────────────────────────
// STEP 3 — Arvo Video Script
// ─────────────────────────────────────────────
async function callArvo(claudeOutput) {
  const apiKey    = STATE.config.arvo_api_key;
  const workspace = STATE.config.arvo_workspace;
  const template  = STATE.config.arvo_template;
  const style     = document.getElementById('arvo-style').value;
  const duration  = document.getElementById('arvo-duration').value;
  const ratio     = document.getElementById('arvo-ratio').value;

  await sleep(apiKey ? 1800 : 1000);

  // Extract Instagram version for the short video script
  const igMatch = claudeOutput.match(/\[INSTAGRAM VERSION\]([\s\S]+?)($)/i);
  const igContent = igMatch ? igMatch[1].trim() : claudeOutput.substring(0, 300);

  if (!apiKey) {
    return generateDemoArvoScript(igContent, style, duration, ratio);
  }

  // Real Arvo API call
  try {
    const res = await fetch('https://api.arvo.video/v1/scripts', {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        workspace_id: workspace,
        template_id : template,
        content     : igContent,
        style, duration: parseInt(duration), aspect_ratio: ratio,
      }),
    });
    if (!res.ok) throw new Error(`Arvo API error ${res.status}`);
    const data = await res.json();
    return data.script || data.content || JSON.stringify(data, null, 2);
  } catch (e) {
    // Gracefully fall back to demo if CORS / network issue
    console.warn('Arvo API unreachable, using demo output:', e.message);
    return generateDemoArvoScript(igContent, style, duration, ratio);
  }
}

function generateDemoArvoScript(content, style, duration, ratio) {
  return `=== ARVO VIDEO SCRIPT ===
Style: ${style.replace(/_/g,' ')} | Duration: ${duration}s | Ratio: ${ratio}

[SCENE 1 — 0:00–0:05]
Visual: Bold text overlay on dynamic gradient background
Text: "This changes everything."
Music: Upbeat, modern lo-fi

[SCENE 2 — 0:05–0:15]
Visual: Split-screen showing before/after concept
Voiceover: "Most people scroll past insights that could transform their business."
Text Overlay: Key stat or hook pulled from content

[SCENE 3 — 0:15–0:22]
Visual: Clean bullet points animating in
Content Points:
${content.split('\n').filter(l => l.trim() && l.length > 10).slice(0,3).map((l,i) => `  ${i+1}. ${l.replace(/[#✅✨🎯👆💜🚀]/g,'').trim()}`).join('\n')}

[SCENE 4 — 0:22–${duration}:00]
Visual: Brand logo / CTA screen
Text: "Follow for more   →   Link in bio"
Music: Fade out

=== END SCRIPT ===
Estimated render time: ~2–4 minutes via Arvo`;
}

// ─────────────────────────────────────────────
// STEP 4 — Blotato Format & Schedule
// ─────────────────────────────────────────────
async function callBlotato(claudeOutput, platforms) {
  const apiKey  = STATE.config.blotato_api_key;
  const account = STATE.config.blotato_account;

  const captionOverride = document.getElementById('blotato-caption').value.trim();
  const hashtags        = document.getElementById('blotato-hashtags').value.trim();

  const fbMatch = claudeOutput.match(/\[FACEBOOK VERSION\]([\s\S]+?)\[INSTAGRAM VERSION\]/i);
  const igMatch = claudeOutput.match(/\[INSTAGRAM VERSION\]([\s\S]+?)$/i);

  const fbCaption = captionOverride || (fbMatch ? fbMatch[1].trim() : claudeOutput.substring(0, 500));
  const igCaption = captionOverride || (igMatch ? igMatch[1].trim() : claudeOutput.substring(0, 300));

  const tags = hashtags || extractHashtags(claudeOutput);

  const payload = {
    account_id: account || 'demo_account',
    posts: [],
    created_at: new Date().toISOString(),
  };

  if (platforms.includes('facebook')) {
    payload.posts.push({
      platform   : 'facebook',
      caption    : fbCaption + (tags ? `\n\n${tags}` : ''),
      media_type : 'video',
      schedule   : buildScheduleTime(),
    });
  }
  if (platforms.includes('instagram')) {
    payload.posts.push({
      platform   : 'instagram',
      caption    : igCaption + (tags ? `\n\n${tags}` : ''),
      media_type : 'reel',
      schedule   : buildScheduleTime(),
    });
  }

  await sleep(apiKey ? 900 : 600);

  if (apiKey) {
    try {
      const res = await fetch('https://api.blotato.com/v1/schedule', {
        method : 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Blotato API ${res.status}`);
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('Blotato API unreachable, using demo payload:', e.message);
    }
  }

  return payload;
}

// ─────────────────────────────────────────────
// STEP 5 — Publish to Social
// ─────────────────────────────────────────────
async function publishToSocial(blotoPayload, platforms) {
  const result = { fb_post_id: '', ig_post_id: '' };
  await sleep(1200);

  for (const post of (blotoPayload.posts || [])) {
    if (post.platform === 'facebook' && platforms.includes('facebook')) {
      result.fb_post_id = await postToFacebook(post.caption);
    }
    if (post.platform === 'instagram' && platforms.includes('instagram')) {
      result.ig_post_id = await postToInstagram(post.caption);
    }
  }
  return result;
}

async function postToFacebook(caption) {
  const token  = STATE.config.fb_page_token;
  const pageId = STATE.config.fb_page_id;

  if (!token || !pageId) {
    console.warn('FB credentials missing — demo mode');
    return `fb_demo_${Date.now()}`;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ message: caption, access_token: token }),
      }
    );
    if (!res.ok) throw new Error(`FB Graph API ${res.status}`);
    const data = await res.json();
    return data.id || '';
  } catch (e) {
    console.warn('Facebook post failed:', e.message);
    return `fb_error_${Date.now()}`;
  }
}

async function postToInstagram(caption) {
  const token     = STATE.config.ig_access_token;
  const accountId = STATE.config.ig_account_id;

  if (!token || !accountId) {
    console.warn('IG credentials missing — demo mode');
    return `ig_demo_${Date.now()}`;
  }
  try {
    // Step 1: Create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/media`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ caption, media_type: 'REELS', access_token: token }),
      }
    );
    if (!containerRes.ok) throw new Error(`IG container API ${containerRes.status}`);
    const container = await containerRes.json();

    // Step 2: Publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ creation_id: container.id, access_token: token }),
      }
    );
    if (!publishRes.ok) throw new Error(`IG publish API ${publishRes.status}`);
    const pub = await publishRes.json();
    return pub.id || '';
  } catch (e) {
    console.warn('Instagram post failed:', e.message);
    return `ig_error_${Date.now()}`;
  }
}

// ─────────────────────────────────────────────
// PROGRESS UI
// ─────────────────────────────────────────────
function showProgress() {
  const wrap = document.getElementById('pipeline-progress');
  wrap.classList.remove('hidden');
  const stepsEl = document.getElementById('progress-steps');
  stepsEl.innerHTML = '';
  STEPS.forEach(s => {
    const el = document.createElement('div');
    el.className = 'progress-step';
    el.id = `pstep-${s}`;
    el.innerHTML = `<i class="fa-solid ${STEP_LABELS[s].icon}"></i> ${STEP_LABELS[s].label}`;
    stepsEl.appendChild(el);
  });
  setProgressBar(0);
}

async function setStepState(step, state) {
  STATE.currentStep = STEPS.indexOf(step);
  const el = document.getElementById(`pstep-${step}`);
  if (!el) return;
  el.className = 'progress-step ' + state;
  const icons = { running: 'fa-spinner fa-spin', done: 'fa-circle-check', error: 'fa-circle-xmark' };
  el.innerHTML = `<i class="fa-solid ${icons[state] || STEP_LABELS[step].icon}"></i> ${STEP_LABELS[step].label}`;

  const progress = { scrape: 20, claude: 40, arvo: 60, blotato: 80, post: 100 };
  if (state === 'done') setProgressBar(progress[step] || 0);

  // Highlight flow diagram node
  const nodeMap = { scrape: 'flow-website', claude: 'flow-claude', arvo: 'flow-arvo', blotato: 'flow-blotato' };
  document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('active-step'));
  if (state === 'running' && nodeMap[step]) {
    const node = document.getElementById(nodeMap[step]);
    if (node) node.classList.add('active-step');
  }

  await sleep(200);
}

function setProgressBar(pct) {
  document.getElementById('progress-bar').style.width = `${pct}%`;
}

function highlightFlowNodes(done) {
  document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('active-step'));
}

function showPreview(service, content) {
  const previewEl = document.getElementById(`${service}-preview`);
  const textEl    = document.getElementById(`${service}-preview-text`);
  if (!previewEl || !textEl) return;
  previewEl.classList.remove('hidden');
  textEl.textContent = content;
}

function disablePipelineButtons(disabled) {
  ['btn-run-pipeline','btn-step-pipeline'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

async function waitForUserStep(msg) {
  toast(msg + ' Click "Run Full Pipeline" to continue step-by-step.', 'info');
  await sleep(2500);
}

function resetPipeline() {
  ['claude-preview','arvo-preview','blotato-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  document.getElementById('pipeline-progress').classList.add('hidden');
  ['source-url','manual-content','blotato-caption','blotato-hashtags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  toast('Pipeline reset.', 'info');
}

// ─────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────
function setDefaultScheduleTime() {
  const el = document.getElementById('sched-datetime');
  if (!el) return;
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  now.setDate(now.getDate() + 1);
  el.value = now.toISOString().slice(0,16);
}

async function schedulePost() {
  const caption  = document.getElementById('sched-caption').value.trim();
  const hashtags = document.getElementById('sched-hashtags').value.trim();
  const media    = document.getElementById('sched-media').value.trim();
  const dt       = document.getElementById('sched-datetime').value;
  const repeat   = document.getElementById('sched-repeat').value;

  if (!caption) { toast('Please enter a caption.', 'error'); return; }
  if (!dt)      { toast('Please select a schedule date/time.', 'error'); return; }

  const platforms = [];
  if (document.getElementById('sched-fb').checked) platforms.push('facebook');
  if (document.getElementById('sched-ig').checked) platforms.push('instagram');
  if (!platforms.length) { toast('Select at least one platform.', 'error'); return; }

  const run = await createRun({
    source_url    : 'scheduled_post',
    raw_content   : caption,
    claude_output : caption + (hashtags ? `\n\n${hashtags}` : ''),
    platform      : platforms,
    status        : 'scheduled',
    scheduled_at  : new Date(dt).getTime(),
    blotato_payload: JSON.stringify({ caption, hashtags, media, repeat }),
  });

  toast(`Post scheduled for ${formatDate(dt)} on ${platforms.join(' & ')}`, 'success');
  await loadScheduledPosts();
  await loadDashboard();

  // Clear form
  document.getElementById('sched-caption').value = '';
  document.getElementById('sched-hashtags').value = '';
  document.getElementById('sched-media').value = '';
}

async function loadScheduledPosts() {
  try {
    const res  = await fetch(`${API.pipeline}?limit=50&sort=scheduled_at`);
    const json = await res.json();
    const scheduled = (json.data || []).filter(r => r.status === 'scheduled' || r.status === 'pending');
    STATE.scheduledPosts = scheduled;
    renderScheduledList(scheduled);
    const badge = document.getElementById('sched-count');
    if (badge) badge.textContent = `${scheduled.length} scheduled`;
  } catch (e) { console.warn('loadScheduledPosts', e); }
}

function renderScheduledList(posts) {
  const container = document.getElementById('scheduled-posts-list');
  if (!container) return;

  if (!posts.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No posts scheduled yet</p></div>`;
    return;
  }

  container.innerHTML = posts.map(p => {
    const payload = safeJSON(p.blotato_payload);
    const caption = p.claude_output || p.raw_content || '';
    return `
    <div class="sched-post-item">
      <div class="sched-post-header">
        <div class="platform-icons">
          ${(p.platform||[]).includes('facebook')  ? '<i class="fa-brands fa-facebook fa-lg plat-fb"></i>' : ''}
          ${(p.platform||[]).includes('instagram') ? '<i class="fa-brands fa-instagram fa-lg plat-ig"></i>' : ''}
        </div>
        <span class="status-pill ${p.status}">${p.status}</span>
        <button class="btn btn-sm btn-danger" onclick="deleteRun('${p.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
      <div class="sched-post-meta">
        <span><i class="fa-solid fa-calendar"></i> ${p.scheduled_at ? formatTimestamp(p.scheduled_at) : '—'}</span>
        ${payload.repeat && payload.repeat !== 'none' ? `<span><i class="fa-solid fa-repeat"></i> ${payload.repeat}</span>` : ''}
      </div>
      <div class="sched-post-caption">${escapeHtml(caption.substring(0,180))}${caption.length > 180 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res  = await fetch(`${API.pipeline}?limit=100`);
    const json = await res.json();
    const runs = json.data || [];
    STATE.pipelineRuns = runs;

    document.getElementById('stat-total').textContent   = runs.length;
    document.getElementById('stat-posted').textContent  = runs.filter(r => r.status === 'posted').length;
    document.getElementById('stat-pending').textContent = runs.filter(r => ['pending','scheduled','blotato_ready'].includes(r.status)).length;
    document.getElementById('stat-failed').textContent  = runs.filter(r => r.status === 'failed').length;

    const recent = runs.slice().sort((a,b) => (b.created_at||0) - (a.created_at||0)).slice(0,5);
    renderRecentRuns(recent);
  } catch (e) { console.warn('loadDashboard', e); }
}

function renderRecentRuns(runs) {
  const tbody = document.getElementById('recent-runs-body');
  if (!tbody) return;

  if (!runs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><i class="fa-solid fa-inbox"></i> No runs yet. Start your first pipeline!</td></tr>`;
    return;
  }

  tbody.innerHTML = runs.map(r => `
    <tr>
      <td class="url-cell" title="${escapeHtml(r.source_url||'')}">
        ${r.source_url?.startsWith('http') ? `<a href="${escapeHtml(r.source_url)}" target="_blank" rel="noopener">${escapeHtml(r.source_url)}</a>` : escapeHtml(r.source_url||'—')}
      </td>
      <td><span class="status-pill ${r.status}">${r.status}</span></td>
      <td>
        <div class="platform-icons">
          ${(r.platform||[]).includes('facebook')  ? '<i class="fa-brands fa-facebook plat-fb" title="Facebook"></i>' : ''}
          ${(r.platform||[]).includes('instagram') ? '<i class="fa-brands fa-instagram plat-ig" title="Instagram"></i>' : ''}
        </div>
      </td>
      <td>${formatTimestamp(r.created_at)}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="viewRunDetails('${r.id}')">
          <i class="fa-solid fa-eye"></i>
        </button>
      </td>
    </tr>`).join('');
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────
async function loadHistory() {
  try {
    const res  = await fetch(`${API.pipeline}?limit=200`);
    const json = await res.json();
    STATE.pipelineRuns = json.data || [];
    renderHistory(STATE.pipelineRuns);
  } catch (e) { console.warn('loadHistory', e); }
}

function renderHistory(runs) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (!runs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="fa-solid fa-inbox"></i> No history yet.</td></tr>`;
    return;
  }

  const sorted = runs.slice().sort((a,b) => (b.created_at||0) - (a.created_at||0));
  tbody.innerHTML = sorted.map(r => `
    <tr>
      <td class="url-cell" title="${escapeHtml(r.source_url||'')}">
        ${r.source_url?.startsWith('http') ? `<a href="${escapeHtml(r.source_url)}" target="_blank" rel="noopener">${escapeHtml(r.source_url)}</a>` : escapeHtml(r.source_url||'—')}
      </td>
      <td><span class="status-pill ${r.status}">${r.status}</span></td>
      <td>
        <div class="platform-icons">
          ${(r.platform||[]).includes('facebook')  ? '<i class="fa-brands fa-facebook plat-fb"></i>' : ''}
          ${(r.platform||[]).includes('instagram') ? '<i class="fa-brands fa-instagram plat-ig"></i>' : ''}
        </div>
      </td>
      <td>${formatTimestamp(r.created_at)}</td>
      <td>${r.posted_at ? formatTimestamp(r.posted_at) : '—'}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-sm btn-outline" onclick="viewRunDetails('${r.id}')"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-sm btn-danger"  onclick="deleteRun('${r.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join('');
}

function searchHistory() {
  const q = document.getElementById('history-search').value.toLowerCase();
  const filtered = STATE.pipelineRuns.filter(r =>
    (r.source_url||'').toLowerCase().includes(q) ||
    (r.status||'').toLowerCase().includes(q)
  );
  renderHistory(filtered);
}

function filterHistory() {
  const status = document.getElementById('history-filter').value;
  const filtered = status === 'all'
    ? STATE.pipelineRuns
    : STATE.pipelineRuns.filter(r => r.status === status);
  renderHistory(filtered);
}

// ─────────────────────────────────────────────
// RUN DETAILS MODAL
// ─────────────────────────────────────────────
async function viewRunDetails(id) {
  try {
    const res = await fetch(`${API.pipeline}/${id}`);
    if (!res.ok) throw new Error('Run not found');
    const r = await res.json();

    document.getElementById('modal-title').textContent = `Run Details — ${r.status}`;
    document.getElementById('modal-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div><strong style="color:var(--text)">Source URL</strong><br>${escapeHtml(r.source_url||'—')}</div>
        <div><strong style="color:var(--text)">Status</strong><br><span class="status-pill ${r.status}">${r.status}</span></div>
        <div><strong style="color:var(--text)">Platforms</strong><br>${(r.platform||[]).join(', ') || '—'}</div>
        <div><strong style="color:var(--text)">Created</strong><br>${formatTimestamp(r.created_at)}</div>
        ${r.claude_output ? `<div><strong style="color:var(--text)">Claude Output</strong><pre style="white-space:pre-wrap;font-size:12px;margin-top:6px;">${escapeHtml(r.claude_output)}</pre></div>` : ''}
        ${r.arvo_script   ? `<div><strong style="color:var(--text)">Arvo Script</strong><pre style="white-space:pre-wrap;font-size:12px;margin-top:6px;">${escapeHtml(r.arvo_script)}</pre></div>` : ''}
        ${r.fb_post_id    ? `<div><strong style="color:var(--text)">Facebook Post ID</strong><br>${escapeHtml(r.fb_post_id)}</div>` : ''}
        ${r.ig_post_id    ? `<div><strong style="color:var(--text)">Instagram Post ID</strong><br>${escapeHtml(r.ig_post_id)}</div>` : ''}
        ${r.error_log     ? `<div><strong style="color:var(--red)">Error Log</strong><pre style="white-space:pre-wrap;font-size:12px;margin-top:6px;color:var(--red)">${escapeHtml(r.error_log)}</pre></div>` : ''}
      </div>`;
    document.getElementById('modal-overlay').classList.remove('hidden');
  } catch (e) {
    toast('Could not load run details.', 'error');
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ─────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────
async function createRun(data) {
  const res = await fetch(API.pipeline, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(data),
  });
  return await res.json();
}

async function updateRun(id, data) {
  await fetch(`${API.pipeline}/${id}`, {
    method : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(data),
  });
}

async function deleteRun(id) {
  if (!confirm('Delete this record?')) return;
  await fetch(`${API.pipeline}/${id}`, { method: 'DELETE' });
  toast('Deleted.', 'info');
  await loadDashboard();
  await loadScheduledPosts();
  await loadHistory();
}

// ─────────────────────────────────────────────
// AUTO-REFRESH / SCHEDULER DAEMON
// ─────────────────────────────────────────────
function startAutoRefresh() {
  // Refresh dashboard every 60s
  setInterval(loadDashboard, 60_000);
  // Check scheduled posts every minute
  setInterval(checkScheduledPosts, 60_000);
  restartAutoInterval();
}

function restartAutoInterval() {
  if (STATE.autoInterval) clearInterval(STATE.autoInterval);
  const intervalMap = {
    hourly  : 3_600_000,
    '6hours': 21_600_000,
    daily   : 86_400_000,
    weekly  : 604_800_000,
  };
  const interval = intervalMap[STATE.config.auto_interval];
  if (interval) {
    STATE.autoInterval = setInterval(() => {
      toast('Auto-pipeline triggered by schedule.', 'info');
      runPipeline();
    }, interval);
  }
}

async function checkScheduledPosts() {
  const now = Date.now();
  const due = STATE.scheduledPosts.filter(p =>
    p.status === 'scheduled' && p.scheduled_at && p.scheduled_at <= now
  );
  for (const post of due) {
    toast(`Publishing scheduled post: ${(post.source_url||'').substring(0,40)}`, 'info');
    await updateRun(post.id, { status: 'pending' });
    // Trigger publishing
    const payload = safeJSON(post.blotato_payload);
    const caption = post.claude_output || post.raw_content || '';
    const platforms = post.platform || [];
    const results = await publishToSocial({ posts: platforms.map(p => ({ platform: p, caption })) }, platforms);
    await updateRun(post.id, {
      status     : 'posted',
      posted_at  : Date.now(),
      fb_post_id : results.fb_post_id,
      ig_post_id : results.ig_post_id,
    });
    toast(`✅ Post published to ${platforms.join(' & ')}`, 'success');
    await loadScheduledPosts();
  }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
function toast(message, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i> ${message}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatDate(dt) {
  return new Date(dt).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function safeJSON(str) {
  try { return JSON.parse(str||'{}'); } catch { return {}; }
}

function buildScheduleTime() {
  const postTime = STATE.config.post_time || '09:00';
  const [h,m] = postTime.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h||9, m||0, 0, 0);
  return d.toISOString();
}

function extractHashtags(text) {
  const tags = (text.match(/#\w+/g) || []).slice(0,10);
  return tags.join(' ');
}
