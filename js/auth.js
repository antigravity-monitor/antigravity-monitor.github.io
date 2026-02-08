import { loadSettings, loadToken, saveToken, clearToken } from "./storage.js";

/**
 * OAuth2 via Google Identity Services (GSI) Token Client.
 * Uses popup-based consent — NO redirect_uri needed.
 * Works with any OAuth Client ID type (web, desktop, etc.)
 */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function getStoredAccessToken() {
  const token = loadToken();
  if (!token || !token.access_token) return null;
  if (token.expires_at && token.expires_at <= nowSec() + 10) return null;
  return token.access_token;
}

export function clearStoredToken() {
  clearToken();
}

/**
 * On page load, check if we arrived here via an old-style OAuth redirect.
 * (Kept for backward compatibility — new flow doesn't use redirects.)
 */
export function handleOAuthRedirect() {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return false;
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  if (!accessToken) return false;

  const expiresIn = params.get("expires_in");
  const expiresAt = expiresIn ? nowSec() + Number(expiresIn) : null;
  saveToken({
    access_token: accessToken,
    token_type: params.get("token_type") || "Bearer",
    scope: params.get("scope") || "",
    expires_at: expiresAt,
    obtained_at: nowSec(),
  });
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

/** Load the GSI library dynamically if not already present. */
function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(script);
  });
}

/**
 * Request an access token via GSI popup.
 * No redirect_uri needed — Google handles everything in-popup.
 */
export async function requestAccessToken() {
  await loadGsiScript();
  const settings = loadSettings();

  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: settings.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          reject(new Error(tokenResponse.error_description || tokenResponse.error));
          return;
        }
        const expiresAt = tokenResponse.expires_in
          ? nowSec() + Number(tokenResponse.expires_in)
          : null;
        saveToken({
          access_token: tokenResponse.access_token,
          token_type: tokenResponse.token_type || "Bearer",
          scope: tokenResponse.scope || "",
          expires_at: expiresAt,
          obtained_at: nowSec(),
        });
        resolve(tokenResponse.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || "Sign-in failed."));
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

export async function getAccessTokenInteractive() {
  const stored = getStoredAccessToken();
  if (stored) return stored;
  return await requestAccessToken();
}

export async function getAccessTokenSilentIfPossible() {
  const stored = getStoredAccessToken();
  if (stored) return stored;
  return null;
}
