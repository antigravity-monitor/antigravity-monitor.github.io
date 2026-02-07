import { loadSettings, loadToken, saveToken, clearToken } from "./storage.js";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isGsiReady() {
  return (
    typeof window !== "undefined" &&
    window.google &&
    window.google.accounts &&
    window.google.accounts.oauth2 &&
    typeof window.google.accounts.oauth2.initTokenClient === "function"
  );
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

export async function waitForGsi({ timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (!isGsiReady()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Google Identity Services failed to load (timeout).");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function requestAccessToken({ prompt = "consent" } = {}) {
  const settings = loadSettings();

  await waitForGsi();

  return await new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: settings.scopes,
      callback: (resp) => {
        if (!resp) {
          reject(new Error("Empty OAuth response."));
          return;
        }
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }

        // resp: { access_token, expires_in, token_type, scope }
        const expiresAt = resp.expires_in ? nowSec() + Number(resp.expires_in) : null;
        saveToken({
          access_token: resp.access_token,
          token_type: resp.token_type || "Bearer",
          scope: resp.scope || settings.scopes,
          expires_at: expiresAt,
          obtained_at: nowSec(),
        });
        resolve(resp.access_token);
      },
    });

    try {
      tokenClient.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
}

export async function getAccessTokenInteractive() {
  // Use stored token if it is still valid.
  const stored = getStoredAccessToken();
  if (stored) return stored;
  return await requestAccessToken({ prompt: "consent" });
}

export async function getAccessTokenSilentIfPossible() {
  const stored = getStoredAccessToken();
  if (stored) return stored;
  // Attempt silent acquisition; may fail with e.g. "interaction_required".
  return await requestAccessToken({ prompt: "none" });
}

