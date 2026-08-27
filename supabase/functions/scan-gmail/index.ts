// Scans the connected inbox for candidate job-offer emails and inserts new ones into
// job_offers (status='new'). Safe to call repeatedly / on a schedule — dedupes on
// gmail_message_id. Does NOT send anything; see send-digest for that.
import { handleOptions, withCors } from "../_shared/cors.ts";
import { requireAdminToken } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import { listMessageIds, getMessage, extractPlainText, headerValue } from "../_shared/gmail.ts";

// Polish + English keywords for job offers / recruiter outreach / job-board alerts.
const DEFAULT_QUERY = [
  "newer_than:21d",
  "(",
  "\"oferta pracy\" OR \"oferty pracy\" OR rekrutacja OR rekruter OR",
  "\"we are hiring\" OR \"job offer\" OR \"job opportunity\" OR",
  "\"apply now\" OR aplikuj OR \"nowa oferta\" OR \"new job\" OR",
  "linkedin.com/jobs OR indeed.com OR pracuj.pl OR nofluffjobs OR justjoin.it",
  ")",
].join(" ");

const JOB_LINK_HINTS = [
  "linkedin.com/jobs", "linkedin.com/comm/jobs", "indeed.com", "pracuj.pl",
  "nofluffjobs.com", "justjoin.it", "glassdoor.com", "rocketjobs.pl",
  "theprotocol.it", "bulldogjob.pl", "greenhouse.io", "lever.co", "workable.com",
  "myworkdayjobs.com", "smartrecruiters.com", "teamtailor.com",
];

function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const unique = [...new Set(found)];
  const jobLinks = unique.filter((u) => JOB_LINK_HINTS.some((h) => u.includes(h)));
  return (jobLinks.length ? jobLinks : unique).slice(0, 5);
}

// Heuristic: an email address in the body that isn't the sender's own domain and looks
// like an application inbox (hr@, recruitment@, jobs@, or explicitly "send your CV to X").
function extractApplyEmail(text: string, fromEmail: string): string | null {
  const fromDomain = fromEmail.split("@")[1]?.toLowerCase();
  const emails = [...new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []))];
  const candidate = emails.find((e) => {
    const local = e.split("@")[0].toLowerCase();
    const domain = e.split("@")[1]?.toLowerCase();
    if (domain === fromDomain) return false;
    return /^(hr|jobs?|careers?|rekrutacja|recruit(ment)?|cv)[.@_-]?/.test(local);
  });
  return candidate || null;
}

function guessCompanyAndRole(subject: string, fromName: string): { company: string; role: string } {
  // Best-effort only; generate-cv re-derives this more carefully from the full body.
  const m = subject.match(/^(.*?)\s*[-–|]\s*(.*)$/);
  if (m) return { company: fromName || m[1].trim(), role: m[2].trim() };
  return { company: fromName, role: subject };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const denied = requireAdminToken(req);
  if (denied) return withCors(denied);

  try {
    const query = Deno.env.get("SCAN_QUERY") || DEFAULT_QUERY;
    const db = adminClient();

    const ids = await listMessageIds(query, 50);
    let inserted = 0;
    let skipped = 0;

    for (const id of ids) {
      const { data: existing } = await db
        .from("job_offers")
        .select("id")
        .eq("gmail_message_id", id)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      const msg = await getMessage(id);
      const fromHeader = headerValue(msg.payload, "From");
      const fromEmailMatch = fromHeader.match(/<([^>]+)>/);
      const fromEmail = fromEmailMatch ? fromEmailMatch[1] : fromHeader;
      const fromName = fromHeader.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
      const subject = headerValue(msg.payload, "Subject");
      const dateHeader = headerValue(msg.payload, "Date");
      const bodyText = extractPlainText(msg.payload);
      const { company, role } = guessCompanyAndRole(subject, fromName);

      const { error } = await db.from("job_offers").insert({
        gmail_message_id: id,
        gmail_thread_id: msg.threadId,
        received_at: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
        from_email: fromEmail,
        subject,
        snippet: msg.snippet || "",
        body_text: bodyText.slice(0, 20000),
        apply_links: extractLinks(bodyText),
        apply_email: extractApplyEmail(bodyText, fromEmail),
        company,
        role,
        status: "new",
      });
      if (error) throw error;
      inserted++;
    }

    return withCors(Response.json({ ok: true, scanned: ids.length, inserted, skipped }));
  } catch (e) {
    return withCors(Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 }));
  }
});
