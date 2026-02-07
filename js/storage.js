const KEY = "ag_monitor_settings_v1";
const TOKEN_KEY = "ag_monitor_token_v1";

export function loadSettings() {
  const defaults = {
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    scopes: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    duetProject: "rising-fact-p41fc",
    quotaProject: "",
    hostMode: "auto", // auto | primary | daily
    refreshIntervalSec: 30,
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const merged = { ...defaults, ...parsed };
    // Ensure critical fields are never empty (overrides stale localStorage)
    if (!merged.clientId) merged.clientId = defaults.clientId;
    if (!merged.scopes) merged.scopes = defaults.scopes;
    return merged;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function loadToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || typeof t !== "object") return null;
    return t;
  } catch {
    return null;
  }
}

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

