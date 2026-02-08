import { loadSettings, loadToken, saveToken, clearToken } from "./storage.js";

/**
 * OAuth2 PKCE Authorization Code Flow.
 *
 * Uses Antigravity's Desktop-type OAuth Client ID + Secret.
 * Desktop OAuth clients accept ANY redirect_uri (no whitelist needed).
 * This replicates the same auth flow that Antigravity's VS Code extension uses,
 * adapted for browser instead of localhost callback.
 */

// Antigravity OAuth credentials (same as their VS Code extension / CLI)
const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET = "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";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ── PKCE helpers ──────────────────────────────────────────────────────

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  return { verifier, challenge };
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

// ── Handle OAuth redirect (page load) ─────────────────────────────────

/**
 * On page load, check if we arrived here via an OAuth redirect with ?code=...
 * If so, exchange the code for tokens using PKCE.
 */
export async function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const storedVerifier = sessionStorage.getItem("ag_pkce_verifier");

  if (!code || !storedVerifier) return false;

  // Clean up URL immediately
  history.replaceState(null, "", window.location.pathname);
  sessionStorage.removeItem("ag_pkce_verifier");

  try {
    // Exchange authorization code for tokens
    const redirectUri = window.location.origin + window.location.pathname;
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: storedVerifier,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Token exchange failed:", errText);
      return false;
    }

    const data = await response.json();
    const expiresAt = data.expires_in ? nowSec() + Number(data.expires_in) : null;

    saveToken({
      access_token: data.access_token,
      token_type: data.token_type || "Bearer",
      scope: SCOPES.join(" "),
      expires_at: expiresAt,
      obtained_at: nowSec(),
      refresh_token: data.refresh_token || null,
    });

    return true;
  } catch (err) {
    console.error("OAuth token exchange error:", err);
    return false;
  }
}

// ── Refresh token ─────────────────────────────────────────────────────

async function refreshAccessToken() {
  const token = loadToken();
  if (!token?.refresh_token) return null;

  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const expiresAt = data.expires_in ? nowSec() + Number(data.expires_in) : null;

    saveToken({
      access_token: data.access_token,
      token_type: data.token_type || "Bearer",
      scope: token.scope || SCOPES.join(" "),
      expires_at: expiresAt,
      obtained_at: nowSec(),
      refresh_token: data.refresh_token || token.refresh_token,
    });

    return data.access_token;
  } catch {
    return null;
  }
}

// ── Request new token (redirect to Google) ────────────────────────────

export async function requestAccessToken() {
  const { verifier, challenge } = await generatePKCE();

  // Store verifier for when Google redirects back
  sessionStorage.setItem("ag_pkce_verifier", verifier);

  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  // Redirect to Google's OAuth consent screen
  window.location.href = `${AUTH_URL}?${params.toString()}`;

  // This promise never resolves — page will redirect
  return new Promise(() => {});
}

// ── Public API ────────────────────────────────────────────────────────

export async function getAccessTokenInteractive() {
  // 1. Check stored token
  const stored = getStoredAccessToken();
  if (stored) return stored;

  // 2. Try refresh
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;

  // 3. Start new OAuth flow
  return await requestAccessToken();
}

export async function getAccessTokenSilentIfPossible() {
  const stored = getStoredAccessToken();
  if (stored) return stored;

  // Try refresh silently
  return await refreshAccessToken();
}
