// ContentFlow app script

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
  const settings = {};

  document.querySelectorAll(`[id^="cfg-${service}"], [id^="cfg-auto"]`).forEach((input) => {
    if (input.type === "checkbox") {
      settings[input.id] = input.checked;
    } else {
      settings[input.id] = input.value;
    }
  });

  localStorage.setItem(`contentflow_${service}_settings`, JSON.stringify(settings));
  updateConnectionBadge(service, "Set", true);
  showToast(`${service} settings saved locally`);
}

function loadLocalSettings() {
  ["claude", "arvo", "blotato", "facebook", "instagram", "automation"].forEach((service) => {
    const saved = localStorage.getItem(`contentflow_${service}_settings`);
    if (saved) {
      updateConnectionBadge(service, "Set", true);
    }
  });
}

function testConnection(service) {
  const resultBox = document.getElementById("test-results");
  if (resultBox) {
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<strong>Testing ${service}...</strong><br>This front-end button is working. Live API validation still requires a backend route.`;
  }

  updateConnectionBadge(service, "Ready", true);
  showToast(`${service} test button works`);
}

function testAllConnections() {
  ["claude", "arvo", "blotato", "facebook", "instagram"].forEach(testConnection);
  showToast("All connection test buttons ran");
}

function runPipeline() {
  setStepStatus("flow-website");
  setTimeout(() => setStepStatus("flow-claude"), 300);
  setTimeout(() => setStepStatus("flow-arvo"), 600);
  setTimeout(() => setStepStatus("flow-blotato"), 900);

  const claudePreview = document.getElementById("claude-preview");
  const claudeText = document.getElementById("claude-preview-text");
  if (claudePreview && claudeText) {
    claudePreview.classList.remove("hidden");
    claudeText.textContent =
      "Demo Claude output: Heavy-duty containers, mobile offices, and custom builds for Southern Arizona job sites, ranches, and businesses.";
  }

  const arvoPreview = document.getElementById("arvo-preview");
  const arvoText = document.getElementById("arvo-preview-text");
  if (arvoPreview && arvoText) {
    arvoPreview.classList.remove("hidden");
    arvoText.textContent =
      "Demo Arvo script: Show containers, custom builds, and call to action.";
  }

  const blotatoPreview = document.getElementById("blotato-preview");
  const blotatoText = document.getElementById("blotato-preview-text");
  if (blotatoPreview && blotatoText) {
    blotatoPreview.classList.remove("hidden");
    blotatoText.textContent = JSON.stringify(
      {
        platforms: ["Facebook", "Instagram"],
        status: "Demo payload ready",
        note: "Backend needed for live posting"
      },
      null,
      2
    );
  }

  showToast("Pipeline demo ran");
}

function runStepByStep() {
  showToast("Step-by-step demo started");
  runPipeline();
}

function resetPipeline() {
  document.querySelectorAll("textarea").forEach((el) => {
    el.value = "";
  });

  document.querySelectorAll(".output-preview").forEach((el) => {
    el.classList.add("hidden");
  });

  showToast("Pipeline reset");
}

function schedulePost() {
  const caption = document.getElementById("sched-caption")?.value || "";
  const list = document.getElementById("scheduled-posts-list");
  const count = document.getElementById("sched-count");

  if (!caption.trim()) {
    showToast("Add a caption before scheduling");
    return;
  }

  if (list) {
    list.innerHTML = `
      <div class="scheduled-item">
        <strong>${escapeHtml(caption)}</strong>
        <p>Scheduled locally. Backend needed for live publishing.</p>
      </div>
    `;
  }

  if (count) count.textContent = "1 scheduled";
  showToast("Post scheduled locally");
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
    badge.innerHTML = `<i class="fa-solid fa-circle"></i> ${text}`;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
