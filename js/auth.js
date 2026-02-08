import { loadSettings, loadToken, saveToken, clearToken } from "./storage.js";

/**
 * Google Identity Services (GSI) Token Client — Popup Mode.
 *
 * Uses Antigravity's OAuth Client ID with popup-based token request.
 * Popup mode doesn't need redirect_uri whitelisting, so it works
 * with Desktop-type Client IDs on any origin.
 */

// Antigravity OAuth credentials (same as their VS Code extension / CLI)
const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ── GSI Library Loader ────────────────────────────────────────────────

let gsiLoaded = false;
let gsiLoadPromise = null;

function loadGSI() {
  if (gsiLoaded) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;

  gsiLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      gsiLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      gsiLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load GSI library"));
    document.head.appendChild(script);
  });

  return gsiLoadPromise;
}

// ── Token storage ─────────────────────────────────────────────────────

export function getStoredAccessToken() {
  const token = loadToken();
  if (!token || !token.access_token) return null;
  if (token.expires_at && token.expires_at <= nowSec() + 10) return null;
  return token.access_token;
}

export function clearStoredToken() {
  clearToken();
}

// ── Handle OAuth redirect (legacy — no longer used but kept for compat)

export async function handleOAuthRedirect() {
  // GSI popup mode doesn't use redirects.
  // Check if there's a stored token from a previous session.
  return getStoredAccessToken() !== null;
}

// ── Request new token (GSI popup) ─────────────────────────────────────

export async function requestAccessToken() {
  await loadGSI();

  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          reject(new Error(`OAuth error: ${tokenResponse.error} — ${tokenResponse.error_description || ""}`));
          return;
        }

        const expiresAt = tokenResponse.expires_in
          ? nowSec() + Number(tokenResponse.expires_in)
          : null;

        saveToken({
          access_token: tokenResponse.access_token,
          token_type: tokenResponse.token_type || "Bearer",
          scope: tokenResponse.scope || SCOPES,
          expires_at: expiresAt,
          obtained_at: nowSec(),
        });

        resolve(tokenResponse.access_token);
      },
      error_callback: (error) => {
        reject(new Error(`GSI error: ${error.type || "unknown"} — ${error.message || ""}`));
      },
    });

    // This opens a popup for the user to pick their Google account
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

// ── Public API ────────────────────────────────────────────────────────

export async function getAccessTokenInteractive() {
  // 1. Check stored token
  const stored = getStoredAccessToken();
  if (stored) return stored;

  // 2. No refresh in GSI popup mode — request new token
  return await requestAccessToken();
}

export async function getAccessTokenSilentIfPossible() {
  return getStoredAccessToken();
}
