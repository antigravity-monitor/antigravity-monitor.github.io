import { loadSettings, loadToken, saveToken, clearToken } from "./storage.js";

/**
 * OAuth2 implicit flow via popup redirect.
 * Works with any client ID (including desktop/installed app types)
 * without requiring authorized JavaScript origins in GCP Console.
 */

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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
 * Parse the hash fragment from the OAuth redirect.
 * Returns an object with access_token, expires_in, etc., or null.
 */
function parseHashParams(hash) {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    token_type: params.get("token_type") || "Bearer",
    expires_in: params.get("expires_in"),
    scope: params.get("scope"),
  };
}

/**
 * On page load, check if we arrived here via an OAuth redirect (hash contains access_token).
 * If so, save the token and clean up the URL.
 */
export function handleOAuthRedirect() {
  const result = parseHashParams(window.location.hash);
  if (!result) return false;

  const expiresAt = result.expires_in ? nowSec() + Number(result.expires_in) : null;
  saveToken({
    access_token: result.access_token,
    token_type: result.token_type,
    scope: result.scope || "",
    expires_at: expiresAt,
    obtained_at: nowSec(),
  });

  // Clean up the URL hash
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

/**
 * Build the Google OAuth2 authorization URL for implicit flow.
 */
function buildAuthUrl(settings) {
  // Normalize redirect_uri to match typical GCP whitelists:
  // - strip trailing "index.html"
  // - ensure root path is exactly "/"
  // - otherwise, strip any trailing "/" (e.g. "/repo/" -> "/repo")
  let path = window.location.pathname || "";
  if (path.endsWith("index.html")) {
    path = path.slice(0, -("index.html".length));
  }

  // After stripping index.html, treat empty and "/" as the site root.
  // This matches GitHub Pages/GCP redirect URI expectations (origin + "/").
  if (path === "" || path === "/") {
    path = "/";
  } else if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const redirectUri = window.location.origin + path;
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: settings.scopes,
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

/**
 * Open a popup for Google OAuth login.
 * The popup redirects back to our page with the token in the hash fragment.
 */
export async function requestAccessToken() {
  const settings = loadSettings();

  const authUrl = buildAuthUrl(settings);
  const width = 500;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    authUrl,
    "ag_oauth",
    `width=${width},height=${height},left=${left},top=${top},popup=yes`
  );

  if (!popup) {
    // Popup blocked — fall back to redirect in same window
    window.location.href = authUrl;
    return new Promise(() => {}); // never resolves; page will redirect
  }

  // Poll the popup for the redirect with the token
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          // Check if token was saved (popup redirected back and we caught it)
          const stored = getStoredAccessToken();
          if (stored) {
            resolve(stored);
          } else {
            reject(new Error("Sign-in cancelled or popup closed."));
          }
          return;
        }

        // Try to read the popup's URL (will throw if cross-origin)
        const popupUrl = popup.location.href;
        if (popupUrl && popupUrl.startsWith(window.location.origin)) {
          const hash = popup.location.hash;
          const result = parseHashParams(hash);
          if (result) {
            clearInterval(interval);
            popup.close();

            const expiresAt = result.expires_in ? nowSec() + Number(result.expires_in) : null;
            saveToken({
              access_token: result.access_token,
              token_type: result.token_type,
              scope: result.scope || "",
              expires_at: expiresAt,
              obtained_at: nowSec(),
            });
            resolve(result.access_token);
          }
        }
      } catch {
        // Cross-origin — popup is still on Google's domain, keep waiting
      }
    }, 200);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      try { popup.close(); } catch {}
      reject(new Error("Sign-in timed out."));
    }, 300000);
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
  // No silent flow available without GSI; return null to trigger interactive
  return null;
}
