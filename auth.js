/**
 * auth.js
 * Supabase auth using direct REST API — no SDK needed.
 */

const SUPABASE_URL = "https://amqxelapdljxeujuduye.supabase.co";
const SUPABASE_KEY = "sb_publishable_8qHiiWNTtJYiol2NanLZow_kVBKdQmz";

const AUTH_URL = `${SUPABASE_URL}/auth/v1`;

const HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
};

// ─── Sign Up ──────────────────────────────────────────────────────────────────

async function signUp(email, password) {
  const res = await fetch(`${AUTH_URL}/signup`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.message || "Sign up failed.");
  return data;
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || "Invalid email or password.");

  // Save session to chrome storage
  await chrome.storage.local.set({
    havenSession: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      email: data.user?.email,
      expires_at: Date.now() + data.expires_in * 1000,
    },
  });

  return data;
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────

async function signOut() {
  const stored = await chrome.storage.local.get("havenSession");
  const token = stored.havenSession?.access_token;

  if (token) {
    await fetch(`${AUTH_URL}/logout`, {
      method: "POST",
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  await chrome.storage.local.remove("havenSession");
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

async function forgotPassword(email) {
  const res = await fetch(`${AUTH_URL}/recover`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.msg || "Could not send reset email.");
  }
}

// ─── Get Session ──────────────────────────────────────────────────────────────

async function getSession() {
  const stored = await chrome.storage.local.get("havenSession");
  const session = stored.havenSession;
  if (!session) return null;

  // Check if expired
  if (Date.now() > session.expires_at) {
    // Try to refresh
    const refreshed = await refreshSession(session.refresh_token);
    return refreshed;
  }

  return session;
}

// ─── Refresh Session ──────────────────────────────────────────────────────────

async function refreshSession(refreshToken) {
  try {
    const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      await chrome.storage.local.remove("havenSession");
      return null;
    }

    const newSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      email: data.user?.email,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    await chrome.storage.local.set({ havenSession: newSession });
    return newSession;
  } catch {
    await chrome.storage.local.remove("havenSession");
    return null;
  }
}

// Export for use in popup.js
window.havenAuth = { signUp, signIn, signOut, forgotPassword, getSession };