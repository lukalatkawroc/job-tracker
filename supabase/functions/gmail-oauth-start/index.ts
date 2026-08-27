// Visit this function's URL in a browser (while logged into the Gmail account you want to
// scan) to kick off the one-time Google OAuth consent flow. See SETUP.md.
import { GMAIL_SCOPES } from "../_shared/gmail.ts";

Deno.serve((req) => {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!; // must equal the deployed gmail-oauth-callback URL
  const state = Deno.env.get("OAUTH_STATE_SECRET") || "job-tracker";

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // force a refresh_token even on repeat authorization
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("state", state);

  return Response.redirect(url.toString(), 302);
});
