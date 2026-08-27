// Google redirects here after consent. Exchanges the auth code for a refresh token
// and stores it (single row) in gmail_tokens.
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = Deno.env.get("OAUTH_STATE_SECRET") || "job-tracker";
  const err = url.searchParams.get("error");

  if (err) return new Response(`Google OAuth error: ${err}`, { status: 400 });
  if (!code) return new Response("Missing ?code from Google.", { status: 400 });
  if (state !== expectedState) return new Response("State mismatch.", { status: 400 });

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`Token exchange failed: ${await tokenRes.text()}`, { status: 400 });
  }
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return new Response(
      "Google did not return a refresh_token. Revoke prior access at " +
        "https://myaccount.google.com/permissions and try again (the consent screen must show " +
        "the permission request, not silently re-approve).",
      { status: 400 },
    );
  }

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

  const db = adminClient();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 0) * 1000).toISOString();
  const { error } = await db.from("gmail_tokens").upsert({
    id: 1,
    email: userInfo.email || null,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) return new Response(`DB error: ${error.message}`, { status: 500 });

  return new Response(
    `Gmail connected${userInfo.email ? " as " + userInfo.email : ""}. You can close this tab.`,
    { headers: { "Content-Type": "text/plain" } },
  );
});
