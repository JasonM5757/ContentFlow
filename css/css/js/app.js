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
    'cfg-ar<span class="cursor">█</span>
