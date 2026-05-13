// ContentFlow app script

const CONTENTFLOW_SERVICES = ["claude", "arvo", "blotato", "facebook", "instagram", "automation"];
const PIPELINE_STEP_IDS = ["flow-website", "flow-claude", "flow-arvo", "flow-blotato"];
const PIPELINE_STATE = {
  scraped: null,
  claude: null,
  arvo: null,
  blotato: null
};

document.addEventListener("DOMContentLoaded", () => {
  console.log("ContentFlow app.js loaded");

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const page = item.getAttribute("data-page");
      navigateTo(page);
    });
  });

  const sidebarToggle = document.getElementById("sidebar-toggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.toggle("open");
    });
  }

  loadLocalSettings();
  showToast("ContentFlow loaded");
});

function navigateTo(page) {
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.remove("active");
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) targetPage.classList.add("active");

  const targetNav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (targetNav) targetNav.classList.add("active");

  showToast(`Opened ${page}`);
}

function toggleEye(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.type = input.type === "password" ? "text" : "password";
}

function saveSettings(service) {
  const selector = service === "automation" ? `[id^="cfg-auto"]` : `[id^="cfg-${service}"]`;
  const settings = {};

  document.querySelectorAll(selector).forEach((input) => {
    if (input.type === "checkbox") {
      settings[input.id] = input.checked;
    } else {
      settings[input.id] = input.value;
    }
  });

  localStorage.setItem(`contentflow_${service}_settings`, JSON.stringify(settings));

  if (service !== "automation") {
    updateConnectionBadge(service, "Set", true);
  }

  showToast(`${service} settings saved locally`);
}

function loadLocalSettings() {
  CONTENTFLOW_SERVICES.forEach((service) => {
    const saved = getStoredSettings(service);
    if (!saved) return;

    Object.entries(saved).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (!input) return;

      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else if (typeof value === "string" || typeof value === "number") {
        input.value = value;
      }
    });

    if (service !== "automation") {
      updateConnectionBadge(service, "Set", true);
    }
  });
}

async function testConnection(service, options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setResultBox(`<strong>Testing ${escapeHtml(service)}...</strong>`);
  }

  try {
    let response;

    if (service === "claude") {
      response = await postJson("/api/claude-rewrite", {
        test: true,
        config: getServiceSettings("claude")
      });
    } else if (service === "arvo") {
      response = await postJson("/api/arvo-generate", {
        test: true,
        config: getServiceSettings("arvo")
      });
    } else if (service === "blotato") {
      response = await postJson("/api/blotato-format", {
        test: true,
        config: getServiceSettings("blotato")
      });
    } else if (service === "facebook" || service === "instagram") {
      response = await postJson("/api/publish-post", {
        test: true,
        platform: service,
        platformConfigs: {
          [service]: getServiceSettings(service)
        }
      });
    } else {
      response = { ok: true, message: "No live test required" };
    }

    updateConnectionBadge(service, "Ready", true);

    if (!silent) {
      setResultBox(
        `<strong>${escapeHtml(service)} ready</strong><br>${escapeHtml(
          response.message || response.status || "Connection test passed"
        )}`
      );
      showToast(`${service} connection ready`);
    }

    return response;
  } catch (error) {
    updateConnectionBadge(service, "Error", false);

    if (!silent) {
      setResultBox(
        `<strong>${escapeHtml(service)} failed</strong><br>${escapeHtml(
          error.message || "Connection test failed"
        )}`
      );
      showToast(`${service} connection failed`);
    }

    throw error;
  }
}

async function testAllConnections() {
  const services = ["claude", "arvo", "blotato", "facebook", "instagram"];
  const lines = [];

  setResultBox("<strong>Testing all services...</strong>");

  for (const service of services) {
    try {
      const response = await testConnection(service, { silent: true });
      lines.push(`✅ ${service}: ${response.message || response.status || "Ready"}`);
    } catch (error) {
      lines.push(`❌ ${service}: ${error.message || "Failed"}`);
    }
  }

  setResultBox(`<strong>Connection test summary</strong><br>${lines.map(escapeHtml).join("<br>")}`);
  showToast("All connection tests finished");
}

async function runPipeline() {
  resetStepStatuses();
  hidePreviews();

  const websiteUrl = firstFilledValue([
    "website-url",
    "source-url",
    "scrape-url",
    "pipeline-url",
    "cfg-auto-source-url"
  ]);
  const sourceTextFallback = firstFilledValue([
    "source-text",
    "website-content",
    "claude-source-text",
    "sched-caption"
  ]);

  if (!websiteUrl && !sourceTextFallback) {
    showToast("Add a website URL or source text first");
    setResultBox("<strong>Pipeline blocked</strong><br>Add a website URL or source text first.");
    return;
  }

  try {
    let sourceText = sourceTextFallback;
    let scrapeSummary = "Skipped website scrape";

    if (websiteUrl) {
      const scrapeResult = await postJson("/api/scrape-website", { url: websiteUrl });
      PIPELINE_STATE.scraped = scrapeResult;
      setStepStatus("flow-website");

      sourceText = scrapeResult.content || sourceTextFallback;
      scrapeSummary = scrapeResult.title || scrapeResult.url || websiteUrl;

      assignFirstExistingValue(["source-text", "website-content", "claude-source-text"], sourceText);
    }

    if (!sourceText) {
      throw new Error("No source content was available after scraping");
    }

    const businessName =
      firstFilledValue(["business-name", "brand-name", "company-name", "cfg-auto-business-name"]) ||
      humanizeUrl(websiteUrl) ||
      "Your business";
    const tone =
      firstFilledValue(["claude-tone", "content-tone", "rewrite-tone", "cfg-claude-tone"]) ||
      "confident, local, and helpful";
    const goal =
      firstFilledValue(["content-goal", "post-goal", "rewrite-goal", "cfg-auto-goal"]) ||
      "Generate a high-converting social post";
    const extraInstructions =
      firstFilledValue(["claude-instructions", "rewrite-instructions", "cfg-claude-instructions"]) || "";

    const claudeResult = await postJson("/api/claude-rewrite", {
      sourceText,
      businessName,
      tone,
      goal,
      extraInstructions,
      config: getServiceSettings("claude")
    });

    PIPELINE_STATE.claude = claudeResult;
    setStepStatus("flow-claude");

    renderPreview(
      "claude-preview",
      "claude-preview-text",
      claudeResult.caption || claudeResult.shortCaption || claudeResult.rawText || ""
    );

    const arvoResult = await postJson("/api/arvo-generate", {
      caption: claudeResult.caption || claudeResult.shortCaption || sourceText,
      businessName,
      videoGoal: goal,
      durationSeconds: Number(firstFilledValue(["arvo-duration", "video-duration", "cfg-arvo-duration"]) || 20),
      config: getServiceSettings("arvo")
    });

    PIPELINE_STATE.arvo = arvoResult;
    setStepStatus("flow-arvo");

    renderPreview(
      "arvo-preview",
      "arvo-preview-text",
      arvoResult.script || formatShotList(arvoResult.shots || [])
    );

    const blotatoResult = await postJson("/api/blotato-format", {
      caption: claudeResult.caption || sourceText,
      shortCaption: claudeResult.shortCaption || "",
      hashtags: claudeResult.hashtags || [],
      videoScript: arvoResult.script || "",
      platforms: getSelectedPlatforms(),
      config: getServiceSettings("blotato")
    });

    PIPELINE_STATE.blotato = blotatoResult;
    setStepStatus("flow-blotato");

    renderPreview(
      "blotato-preview",
      "blotato-preview-text",
      JSON.stringify(blotatoResult.payloads || blotatoResult, null, 2)
    );

    setResultBox(
      `<strong>Pipeline completed</strong><br>${escapeHtml(scrapeSummary)}<br>${escapeHtml(
        blotatoResult.message || "Formatted payload ready for publishing"
      )}`
    );
    showToast("Pipeline completed");
  } catch (error) {
    setResultBox(`<strong>Pipeline failed</strong><br>${escapeHtml(error.message || "Unknown error")}`);
    showToast(error.message || "Pipeline failed");
  }
}

function runStepByStep() {
  showToast("Step-by-step mode started");
  runPipeline();
}

function resetPipeline() {
  document.querySelectorAll("textarea").forEach((el) => {
    el.value = "";
  });

  hidePreviews();
  resetStepStatuses();

  PIPELINE_STATE.scraped = null;
  PIPELINE_STATE.claude = null;
  PIPELINE_STATE.arvo = null;
  PIPELINE_STATE.blotato = null;

  const resultBox = document.getElementById("test-results");
  if (resultBox) {
    resultBox.classList.add("hidden");
    resultBox.innerHTML = "";
  }

  showToast("Pipeline reset");
}

async function schedulePost() {
  const caption =
    document.getElementById("sched-caption")?.value ||
    PIPELINE_STATE.claude?.caption ||
    PIPELINE_STATE.claude?.shortCaption ||
    "";
  const mediaUrl = firstFilledValue(["sched-media-url", "media-url", "publish-media-url"]);
  const list = document.getElementById("scheduled-posts-list");
  const count = document.getElementById("sched-count");
  const scheduledAt = buildScheduleTimestamp();
  const platforms = getSelectedPlatforms();

  if (!caption.trim()) {
    showToast("Add a caption before scheduling");
    return;
  }

  try {
    const response = await postJson("/api/publish-post", {
      platforms,
      caption,
      mediaUrl,
      scheduledAt,
      formattedPayload: PIPELINE_STATE.blotato?.payloads || null,
      platformConfigs: {
        facebook: getServiceSettings("facebook"),
        instagram: getServiceSettings("instagram")
      }
    });

    if (list) {
      list.innerHTML = response.results
        .map(
          (item) => `
            <div class="scheduled-item">
              <strong>${escapeHtml(item.platform)}</strong>
              <p>${escapeHtml(item.status)}${item.remoteId ? ` · ${escapeHtml(item.remoteId)}` : ""}</p>
            </div>
          `
        )
        .join("");
    }

    if (count) {
      count.textContent = `${response.results.length} scheduled`;
    }

    showToast(scheduledAt ? "Post scheduled" : "Publish payload prepared");
  } catch (error) {
    showToast(error.message || "Scheduling failed");
    setResultBox(`<strong>Schedule failed</strong><br>${escapeHtml(error.message || "Unknown error")}`);
  }
}

function searchHistory() {
  showToast("History search running locally");
}

function filterHistory() {
  showToast("History filter changed");
}

function closeModal() {
  document.getElementById("modal-overlay")?.classList.add("hidden");
}

function setStepStatus(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function resetStepStatuses() {
  PIPELINE_STEP_IDS.forEach((id) => {
    document.getElementById(id)?.classList.remove("active");
  });
}

function updateConnectionBadge(service, text, good) {
  const map = {
    claude: ["conn-claude", "dot-claude", "lbl-claude"],
    arvo: ["conn-arvo", "dot-arvo", "lbl-arvo"],
    blotato: ["conn-blotato", "dot-blotato", "lbl-blotato"],
    facebook: ["conn-fb", "dot-fb", "lbl-fb"],
    instagram: ["conn-ig", "dot-ig", "lbl-ig"]
  };

  const ids = map[service];
  if (!ids) return;

  const badge = document.getElementById(ids[0]);
  const dot = document.getElementById(ids[1]);
  const label = document.getElementById(ids[2]);

  if (badge) {
    badge.innerHTML = `<i class="fa-solid fa-circle"></i> ${escapeHtml(text)}`;
    badge.classList.toggle("connected", good);
  }

  if (dot) dot.classList.toggle("connected", good);
  if (label) label.textContent = text;
}

function showToast(message) {
  const container = document.getElementById("toast-container");

  if (!container) {
    console.log(message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function hidePreviews() {
  document.querySelectorAll(".output-preview").forEach((el) => {
    el.classList.add("hidden");
  });
}

function renderPreview(wrapperId, textId, value) {
  const wrapper = document.getElementById(wrapperId);
  const target = document.getElementById(textId);

  if (wrapper) wrapper.classList.remove("hidden");
  if (target) target.textContent = value || "";
}

function setResultBox(html) {
  const resultBox = document.getElementById("test-results");
  if (!resultBox) return;

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = html;
}

function getStoredSettings(service) {
  try {
    const raw = localStorage.getItem(`contentflow_${service}_settings`);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`Could not parse settings for ${service}`, error);
    return null;
  }
}

function getServiceSettings(service) {
  const selector = service === "automation" ? `[id^="cfg-auto"]` : `[id^="cfg-${service}"]`;
  const saved = getStoredSettings(service) || {};
  const live = {};

  document.querySelectorAll(selector).forEach((input) => {
    live[input.id] = input.type === "checkbox" ? input.checked : input.value;
  });

  return { ...saved, ...live };
}

function getSelectedPlatforms() {
  const explicit = Array.from(
    document.querySelectorAll(
      'input[name="publish-platform"]:checked, input[name="platforms"]:checked, [data-platform-toggle]:checked'
    )
  )
    .map((input) => (input.value || input.getAttribute("data-platform-toggle") || "").toLowerCase())
    .filter(Boolean);

  if (explicit.length) {
    return Array.from(new Set(explicit));
  }

  return ["facebook", "instagram"];
}

function buildScheduleTimestamp() {
  const dateValue = firstFilledValue(["sched-date", "schedule-date", "publish-date"]);
  const timeValue = firstFilledValue(["sched-time", "schedule-time", "publish-time"]);

  if (!dateValue) return null;
  return `${dateValue}T${timeValue || "09:00"}:00`;
}

function assignFirstExistingValue(ids, value) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
      return;
    }
  }
}

function firstFilledValue(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;

    const value = typeof el.value === "string" ? el.value.trim() : "";
    if (value) return value;
  }

  return "";
}

function humanizeUrl(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch (error) {
    return "";
  }
}

function formatShotList(shots) {
  if (!Array.isArray(shots) || !shots.length) {
    return "No shot list returned";
  }

  return shots
    .map((shot, index) => `${index + 1}. ${shot.time || ""} ${shot.visual || ""} ${shot.voiceover || ""}`.trim())
    .join("\n");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text || "Invalid JSON response" };
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
