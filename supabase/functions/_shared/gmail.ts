// Minimal Gmail API client for Deno edge functions.
// Auth model: one mailbox, one stored refresh token (see gmail_tokens table).
import { adminClient } from "./supabase.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// Returns a valid access token, refreshing + persisting it if the cached one is stale.
export async function getAccessToken(): Promise<string> {
  const db = adminClient();
  const { data: row, error } = await db.from("gmail_tokens").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!row?.refresh_token) {
    throw new Error("Gmail is not connected yet. Run gmail-oauth-start first.");
  }
  const stillValid = row.access_token && row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - Date.now() > 60_000;
  if (stillValid) return row.access_token as string;

  const { access_token, expires_in } = await refreshAccessToken(row.refresh_token);
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
  await db.from("gmail_tokens").update({
    access_token,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return access_token;
}

async function gmailFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function listMessageIds(query: string, maxResults = 25): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gmailFetch(`/messages?${qs.toString()}`);
    for (const m of data.messages || []) out.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < 200);
  return out;
}

export async function getMessage(id: string) {
  return gmailFetch(`/messages/${id}?format=full`);
}

function decodeBody(data?: string): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

// Flattens the MIME tree and returns the best-effort plain text body.
export function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBody(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractPlainText(part);
      if (nested) return nested;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

export function headerValue(payload: any, name: string): string {
  const h = (payload?.headers || []).find((x: any) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function toBase64Url(input: string): string {
  return btoa(unescape(encodeURIComponent(input)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMime(opts: {
  to: string; subject: string; text: string;
  attachment?: { filename: string; content: string; mimeType: string };
}): string {
  const boundary = `bnd_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.text,
    "",
  ];
  if (opts.attachment) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${opts.attachment.mimeType}; name="${opts.attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${opts.attachment.filename}"`,
      "",
      toBase64Url(opts.attachment.content).replace(/-/g, "+").replace(/_/g, "/"),
      "",
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

export async function sendMessage(opts: { to: string; subject: string; text: string }) {
  const raw = toBase64Url(buildMime(opts));
  return gmailFetch(`/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

export async function createDraft(opts: {
  to: string; subject: string; text: string;
  attachment?: { filename: string; content: string; mimeType: string };
}) {
  const raw = toBase64Url(buildMime(opts));
  return gmailFetch(`/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
}
