import { loadSettings, saveSettings, clearToken, loadToken } from "./storage.js";
import {
  getAccessTokenInteractive,
  getAccessTokenSilentIfPossible,
  clearStoredToken,
  handleOAuthRedirect,
} from "./auth.js";
import { fetchAvailableModels, fetchSubscriptionTier, fetchUserInfo } from "./api.js";
import { buildQuotaRow, tierBadgeEl, updateCountdowns, formatClock } from "./ui.js";

const el = {
  hero: document.getElementById("hero"),
  dash: document.getElementById("dash"),
  statusPill: document.getElementById("statusPill"),
  authBtn: document.getElementById("authBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  settingsBtn: document.getElementById("settingsBtn"),

  heroSignInBtn: document.getElementById("heroSignInBtn"),
  heroNextRefresh: document.getElementById("heroNextRefresh"),

  settingsModal: document.getElementById("settingsModal"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  clearTokenBtn: document.getElementById("clearTokenBtn"),
  signOutBtn: document.getElementById("signOutBtn"),

  clientIdInput: document.getElementById("clientIdInput"),
  scopesInput: document.getElementById("scopesInput"),
  duetProjectInput: document.getElementById("duetProjectInput"),
  quotaProjectInput: document.getElementById("quotaProjectInput"),
  hostModeSelect: document.getElementById("hostModeSelect"),
  refreshIntervalInput: document.getElementById("refreshIntervalInput"),

  tierBadge: document.getElementById("tierBadge"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  onlineDot: document.getElementById("onlineDot"),
  nextRefresh: document.getElementById("nextRefresh"),
  apiHost: document.getElementById("apiHost"),
  lastUpdate: document.getElementById("lastUpdate"),
  lastError: document.getElementById("lastError"),
  quotaList: document.getElementById("quotaList"),
  otherModels: document.getElementById("otherModels"),
  quotaListOther: document.getElementById("quotaListOther"),
  expandOtherBtn: document.getElementById("expandOtherBtn"),
};

const state = {
  settings: loadSettings(),
  accessToken: null,
  host: null,
  tier: "unknown",
  refreshTimer: null,
  refreshTickTimer: null,
  countdownTimer: null,
  nextRefreshAtMs: null,
  showOther: false,
};

function setStatus(text, { kind = "idle" } = {}) {
  if (!text) {
    el.statusPill.classList.add("hidden");
    el.statusPill.textContent = "";
    return;
  }
  el.statusPill.textContent = text;
  el.statusPill.classList.remove("hidden");
  el.statusPill.className =
    "rounded-full border px-2 py-0.5 text-[11px] " +
    (kind === "ok"
      ? "border-ag-cyan/25 bg-ag-cyan/10 text-ag-cyan"
      : kind === "err"
        ? "border-ag-red/25 bg-ag-red/10 text-ag-red"
        : "border-white/10 bg-white/5 text-ag-muted");
}

function showModal(show) {
  el.settingsModal.classList.toggle("hidden", !show);
  if (show) syncSettingsToForm();
}

function syncSettingsToForm() {
  const s = state.settings;
  el.clientIdInput.value = s.clientId || "";
  el.scopesInput.value = s.scopes || "";
  el.duetProjectInput.value = s.duetProject || "";
  el.quotaProjectInput.value = s.quotaProject || "";
  el.hostModeSelect.value = s.hostMode || "auto";
  el.refreshIntervalInput.value = String(s.refreshIntervalSec ?? 30);
}

function syncFormToSettings() {
  const s = { ...state.settings };
  s.clientId = el.clientIdInput.value.trim();
  s.scopes = el.scopesInput.value.trim() || "openid email profile https://www.googleapis.com/auth/cloud-platform";
  s.duetProject = el.duetProjectInput.value.trim() || "rising-fact-p41fc";
  s.quotaProject = el.quotaProjectInput.value.trim();
  s.hostMode = el.hostModeSelect.value;
  s.refreshIntervalSec = Math.max(10, Number(el.refreshIntervalInput.value || 30));
  state.settings = s;
  saveSettings(s);
}

function setSignedInUi(isSignedIn) {
  el.hero.classList.toggle("hidden", isSignedIn);
  el.dash.classList.toggle("hidden", !isSignedIn);
  el.refreshBtn.classList.toggle("hidden", !isSignedIn);
  el.authBtn.textContent = isSignedIn ? "Signed in" : "Sign in";
  el.authBtn.classList.toggle("bg-gradient-to-r", !isSignedIn);
  el.authBtn.classList.toggle("from-ag-neon/90", !isSignedIn);
  el.authBtn.classList.toggle("to-ag-cyan/80", !isSignedIn);
  el.authBtn.classList.toggle("text-black", !isSignedIn);
  el.authBtn.classList.toggle("bg-white/5", isSignedIn);
  el.authBtn.classList.toggle("border", isSignedIn);
  el.authBtn.classList.toggle("border-white/10", isSignedIn);
  el.authBtn.classList.toggle("text-ag-text", isSignedIn);
  el.authBtn.classList.toggle("shadow-glowCyan", !isSignedIn);
}

function setError(err) {
  if (!err) {
    el.lastError.classList.add("hidden");
    el.lastError.textContent = "";
    return;
  }
  el.lastError.textContent = String(err.message || err);
  el.lastError.classList.remove("hidden");
}

function pinnedModelLabel(modelId) {
  const id = String(modelId || "").toLowerCase();
  const isClaude = id.startsWith("claude-");
  const isGemini = id.startsWith("gemini-");
  if (isClaude && id.includes("opus")) return { label: "Claude Opus", family: "CLAUDE" };
  if (isClaude && id.includes("sonnet")) return { label: "Claude Sonnet", family: "CLAUDE" };
  if (isGemini && id.includes("flash")) return { label: "Gemini Flash", family: "GEMINI" };
  if (isGemini && (id.includes("pro") || id.includes("premium"))) return { label: "Gemini Pro", family: "GEMINI" };
  if (isClaude) return { label: modelId, family: "CLAUDE" };
  if (isGemini) return { label: modelId, family: "GEMINI" };
  return { label: modelId, family: "MODEL" };
}

function modelSortKey(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("claude-opus")) return 0;
  if (id.includes("claude-sonnet")) return 1;
  if (id.includes("gemini") && id.includes("pro")) return 2;
  if (id.includes("gemini") && id.includes("flash")) return 3;
  if (id.startsWith("claude-")) return 10;
  if (id.startsWith("gemini-")) return 11;
  return 50;
}

function renderQuota(modelsObj) {
  const entries = Object.entries(modelsObj || {}).map(([modelId, modelData]) => {
    const quotaInfo = modelData?.quotaInfo || modelData?.quota_info || null;
    const remainingFraction = quotaInfo?.remainingFraction ?? quotaInfo?.remaining_fraction ?? null;
    const resetTime = quotaInfo?.resetTime ?? quotaInfo?.reset_time ?? null;
    const remainingPct =
      typeof remainingFraction === "number" ? Math.max(0, Math.min(100, remainingFraction * 100)) : NaN;
    const { label, family } = pinnedModelLabel(modelId);
    return {
      modelId,
      label,
      family,
      remainingPct,
      resetIso: resetTime,
      sortKey: modelSortKey(modelId),
    };
  });

  entries.sort((a, b) => (a.sortKey - b.sortKey) || a.modelId.localeCompare(b.modelId));

  const pinned = [];
  const other = [];
  for (const e of entries) {
    if (e.sortKey <= 3 || e.modelId.toLowerCase().startsWith("claude-") || e.modelId.toLowerCase().startsWith("gemini-")) {
      pinned.push(e);
    } else {
      other.push(e);
    }
  }

  el.quotaList.replaceChildren();
  for (const e of pinned) {
    el.quotaList.append(buildQuotaRow(e));
  }

  el.quotaListOther.replaceChildren();
  for (const e of other) {
    el.quotaListOther.append(buildQuotaRow(e));
  }

  const hasOther = other.length > 0;
  el.expandOtherBtn.classList.toggle("hidden", !hasOther);
  el.otherModels.classList.toggle("hidden", !hasOther || !state.showOther);
  el.expandOtherBtn.textContent = state.showOther ? "Hide other models" : "Show all models";
}

function setTierBadge(tier) {
  el.tierBadge.replaceChildren();
  el.tierBadge.append(tierBadgeEl(tier));
  el.tierBadge.classList.remove("hidden");
}

function setUserInfo(user) {
  el.userName.textContent = user?.name || user?.given_name || "—";
  el.userEmail.textContent = user?.email || "—";
  const pic = user?.picture || "";
  if (pic) {
    el.userAvatar.src = pic;
    el.userAvatar.alt = user?.name || "User avatar";
  } else {
    el.userAvatar.removeAttribute("src");
    el.userAvatar.alt = "";
  }
}

function clearDashboard() {
  el.userName.textContent = "—";
  el.userEmail.textContent = "—";
  el.userAvatar.removeAttribute("src");
  el.userAvatar.alt = "";
  el.tierBadge.classList.add("hidden");
  el.quotaList.replaceChildren();
  el.quotaListOther.replaceChildren();
  el.otherModels.classList.add("hidden");
  el.apiHost.textContent = "—";
  el.lastUpdate.textContent = "—";
  setError(null);
}

function scheduleRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.refreshTickTimer) clearInterval(state.refreshTickTimer);

  const intervalMs = Math.max(10, Number(state.settings.refreshIntervalSec || 30)) * 1000;
  state.nextRefreshAtMs = Date.now() + intervalMs;

  state.refreshTimer = setInterval(() => {
    runRefresh({ reason: "interval" }).catch(() => {});
  }, intervalMs);

  state.refreshTickTimer = setInterval(() => {
    const msLeft = (state.nextRefreshAtMs ?? Date.now()) - Date.now();
    const txt = formatClock(msLeft);
    el.nextRefresh.textContent = txt;
    el.heroNextRefresh.textContent = txt;
  }, 250);
}

function scheduleCountdowns() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    updateCountdowns(document);
  }, 1000);
}

async function ensureSignedIn({ interactive = false } = {}) {
  try {
    const token = interactive ? await getAccessTokenInteractive() : await getAccessTokenSilentIfPossible();
    state.accessToken = token;
    return token;
  } catch (e) {
    if (!interactive) return null;
    throw e;
  }
}

async function runRefresh({ reason = "manual" } = {}) {
  try {
    setError(null);
    setStatus(reason === "interval" ? "Refreshing…" : "Loading…", { kind: "idle" });
    el.onlineDot.classList.remove("bg-ag-cyan");
    el.onlineDot.classList.add("bg-ag-muted");

    const token = await ensureSignedIn({ interactive: false });
    if (!token) {
      setSignedInUi(false);
      setStatus("Sign in required", { kind: "err" });
      return;
    }

    setSignedInUi(true);

    // Subscription first (tier + potential project id).
    const sub = await fetchSubscriptionTier({ accessToken: token });
    state.host = sub.host;
    state.tier = sub.tier;
    el.apiHost.textContent = new URL(sub.host).host;
    setTierBadge(sub.tier);

    // User info (name/email/picture).
    try {
      const user = await fetchUserInfo({ accessToken: token });
      setUserInfo(user);
    } catch {
      // Non-fatal: UI can still show quotas without profile.
    }

    const project = state.settings.quotaProject || sub.projectId || "";
    const quota = await fetchAvailableModels({ accessToken: token, project: project || undefined });
    state.host = quota.host || state.host;
    el.apiHost.textContent = new URL(state.host).host;

    renderQuota(quota.models);

    const ts = new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    el.lastUpdate.textContent = ts;

    setStatus("Live", { kind: "ok" });
    el.onlineDot.classList.remove("bg-ag-muted");
    el.onlineDot.classList.add("bg-ag-cyan");

    // Reset the next refresh countdown.
    state.nextRefreshAtMs = Date.now() + Math.max(10, Number(state.settings.refreshIntervalSec || 30)) * 1000;
  } catch (e) {
    // On auth-ish failures, clear token so user can retry cleanly.
    const status = e?.status;
    const msg = String(e?.message || "");
    if (status === 401 || /invalid_token|unauthorized|permission|insufficient/i.test(msg)) {
      clearStoredToken();
      state.accessToken = null;
      setSignedInUi(false);
      clearDashboard();
      setStatus("Auth error: sign in again", { kind: "err" });
    } else {
      setStatus("Refresh failed", { kind: "err" });
    }
    setError(e);
    throw e;
  }
}

async function signInClick() {
  syncFormToSettings(); // ensures latest client id if user typed and hit sign-in quickly
  setError(null);
  setStatus("Opening Google sign-in…", { kind: "idle" });

  const token = await ensureSignedIn({ interactive: true });
  state.accessToken = token;
  setSignedInUi(true);
  scheduleRefresh();
  scheduleCountdowns();
  await runRefresh({ reason: "manual" });
}

function signOut() {
  clearStoredToken();
  clearToken();
  state.accessToken = null;
  state.host = null;
  state.tier = "unknown";
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.refreshTickTimer) clearInterval(state.refreshTickTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.refreshTimer = null;
  state.refreshTickTimer = null;
  state.countdownTimer = null;
  state.nextRefreshAtMs = null;
  clearDashboard();
  setSignedInUi(false);
  setStatus("Signed out", { kind: "idle" });
}

function attachEvents() {
  el.settingsBtn.addEventListener("click", () => showModal(true));
  el.settingsCloseBtn.addEventListener("click", () => showModal(false));
  el.settingsBackdrop.addEventListener("click", () => showModal(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") showModal(false);
  });

  el.saveSettingsBtn.addEventListener("click", () => {
    syncFormToSettings();
    showModal(false);
    scheduleRefresh();
    setStatus("Settings saved", { kind: "ok" });
  });

  el.clearTokenBtn.addEventListener("click", () => {
    clearStoredToken();
    setStatus("Token cleared", { kind: "ok" });
  });

  el.signOutBtn.addEventListener("click", () => {
    showModal(false);
    signOut();
  });

  el.authBtn.addEventListener("click", () => {
    if (state.accessToken) showModal(true);
    else signInClick().catch((e) => setError(e));
  });

  el.heroSignInBtn.addEventListener("click", () => {
    signInClick().catch((e) => {
      setError(e);
      if (String(e.message || "").toLowerCase().includes("client id")) showModal(true);
    });
  });

  el.refreshBtn.addEventListener("click", () => {
    runRefresh({ reason: "manual" }).catch((e) => setError(e));
  });

  el.expandOtherBtn.addEventListener("click", () => {
    state.showOther = !state.showOther;
    el.otherModels.classList.toggle("hidden", !state.showOther);
    el.expandOtherBtn.textContent = state.showOther ? "Hide other models" : "Show all models";
  });
}

async function bootstrap() {
  // Handle OAuth redirect (token in URL hash)
  handleOAuthRedirect();

  attachEvents();
  syncSettingsToForm();
  scheduleCountdowns();
  scheduleRefresh();

  // If we have a stored token, try a refresh immediately; otherwise show hero.
  const t = loadToken();
  if (t?.access_token) {
    setSignedInUi(true);
    try {
      await runRefresh({ reason: "manual" });
    } catch (e) {
      setError(e);
      setSignedInUi(false);
    }
  } else {
    setSignedInUi(false);
    setStatus("", { kind: "idle" });
  }
}

bootstrap().catch((e) => {
  setError(e);
  setStatus("Init error", { kind: "err" });
});
