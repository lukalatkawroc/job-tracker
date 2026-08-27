# Job Offers Agent — setup

This adds a pipeline that scans your Gmail for job postings, emails you a
digest with one-click approve/reject links, generates a tailored CV for
anything you approve (recreating your Claude "CV creation" project via the
API), and either drafts a reply to the employer in Gmail (if it found an
application email address) or flags the offer as needing a manual apply
(most postings only accept applications through a LinkedIn/portal link,
which this deliberately does **not** auto-submit — that would mean scripted
form-filling on third-party sites, which is unreliable and often against
their terms).

Nothing sends automatically. Every offer needs your explicit **Approve**
before a CV is generated, and drafts are left in Gmail's Drafts folder for
you to review and send yourself.

## What you need to create yourself

I (Claude) can write the code, but the following steps involve your own
Google/Supabase/Anthropic accounts and consoles — I can't click through
OAuth consent screens or dashboards on your behalf.

### 1. Google Cloud OAuth client (for Gmail access)

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   reuse) a project, then enable the **Gmail API**
   (APIs & Services → Library → Gmail API → Enable).
2. Configure the OAuth consent screen (External is fine; you can leave it in
   "Testing" mode and add your own Gmail address as a test user — that's
   enough since only you will authorize it).
3. Create an OAuth Client ID (Credentials → Create Credentials → OAuth
   client ID → Web application).
   - Authorized redirect URI: `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-oauth-callback`
4. Note the **Client ID** and **Client Secret**.

### 2. Supabase project secrets

In your Supabase project (the one already backing this app —
`yoerfdvvtokunrmcjfri`), go to Edge Functions → Secrets (or use the CLI) and
set:

```
supabase secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://yoerfdvvtokunrmcjfri.supabase.co/functions/v1/gmail-oauth-callback \
  OAUTH_STATE_SECRET=<any random string> \
  ANTHROPIC_API_KEY=sk-ant-... \
  ADMIN_TOKEN=<any random string, e.g. `openssl rand -hex 20`> \
  DIGEST_TO_EMAIL=you@gmail.com
```

- `ADMIN_TOKEN` protects the scan/digest/generate/approve endpoints from
  being called by anyone who finds the URL (they run with `verify_jwt =
  false` because the frontend only uses the anon key, not real user auth).
  Paste the same value into the app's "CV profile & admin token" panel.
- `DIGEST_TO_EMAIL` is optional — it defaults to whatever Gmail account you
  authorize below.

### 3. Apply the database migration

Run the SQL in `supabase/migrations/0001_job_agent.sql` against your
Supabase database (SQL Editor in the dashboard, or `supabase db push` if
you use the CLI/link this repo to the project).

### 4. Deploy the edge functions

```
supabase functions deploy gmail-oauth-start
supabase functions deploy gmail-oauth-callback
supabase functions deploy scan-gmail
supabase functions deploy send-digest
supabase functions deploy offer-action
supabase functions deploy generate-cv
```

(`supabase/config.toml` already marks which ones skip JWT verification.)

### 5. Connect your Gmail account (one-time)

Visit, in a browser, while logged into the Gmail account you want scanned:

```
https://yoerfdvvtokunrmcjfri.supabase.co/functions/v1/gmail-oauth-start
```

Approve the consent screen (requests read + compose + send scope on that
mailbox only). You'll land on a "Gmail connected as ..." page. The refresh
token is stored in the `gmail_tokens` table.

### 6. Paste your CV project into the app

Claude.ai Projects don't have a public API to call from a backend, so the
app recreates yours: open the **Job Offers Inbox** tab → **CV profile &
admin token**, and paste:
- your project's custom instructions (system prompt) into "CV project
  instructions"
- your base CV / resume content into "Base resume"
- your `ADMIN_TOKEN` value from step 2

`generate-cv` sends these plus the offer's details to the Claude API on
every approval.

### 7. Use it

- **Scan Gmail now** — searches the inbox for job-offer-shaped emails
  (keywords in `scan-gmail/index.ts`, tweak `SCAN_QUERY` secret to
  override) and lists new ones in the Job Offers Inbox tab.
- **Email me a digest** — sends yourself a summary email with an
  Approve/Reject link per offer (works from your phone, no login needed —
  each link is single-use and scoped to that one offer).
- Approving (from the email link, or the in-app button) generates a
  tailored CV + short cover note. If an application email address was
  found in the offer, a draft reply with the CV attached is created in
  Gmail for you to send. Otherwise the offer is flagged **"Needs manual
  apply"** — open the listed link, and copy the generated CV/cover note
  into the portal's form yourself.

### Optional: run the scan/digest on a schedule

Supabase supports scheduled Edge Function invocations (Database →
Cron/`pg_cron`, or the dashboard's Scheduled Triggers). Point a schedule at
`scan-gmail` followed by `send-digest` (e.g. every morning), passing the
`x-admin-token` header, so the digest shows up in your inbox without you
running it by hand.

## Known limitations (by design)

- No application is ever auto-submitted through a third-party site/portal —
  only Gmail drafts, and only when there's a plain email address to apply
  to.
- CV attachments are plain Markdown/text files, not formatted PDF/DOCX —
  generating real document formatting inside a Deno edge function needs
  extra tooling; ask if you'd like that added next.
- The offer→company/role guess from `scan-gmail` is a cheap heuristic; the
  CV generation step re-reads the full email body, so it's less dependent
  on getting this exactly right.
