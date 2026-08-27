// Emails a plain-text digest of every not-yet-reviewed offer to your own inbox, with a
// one-click approve/reject link per offer. Run scan-gmail first, then this.
import { handleOptions, withCors } from "../_shared/cors.ts";
import { requireAdminToken } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import { sendMessage } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const denied = requireAdminToken(req);
  if (denied) return withCors(denied);

  try {
    const db = adminClient();

    const { data: offers, error } = await db
      .from("job_offers")
      .select("*")
      .eq("status", "new")
      .order("received_at", { ascending: false });
    if (error) throw error;

    if (!offers || offers.length === 0) {
      return withCors(Response.json({ ok: true, sent: false, count: 0 }));
    }

    const functionsBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const { data: tokenRow } = await db.from("gmail_tokens").select("email").eq("id", 1).maybeSingle();
    const to = Deno.env.get("DIGEST_TO_EMAIL") || tokenRow?.email;
    if (!to) throw new Error("No recipient: set DIGEST_TO_EMAIL or connect Gmail first.");

    const sections: string[] = [];
    for (const offer of offers) {
      const token = crypto.randomUUID();
      await db.from("job_offers").update({ status: "digested", action_token: token }).eq("id", offer.id);

      const approveUrl = `${functionsBase}/offer-action?id=${offer.id}&action=approve&token=${token}`;
      const rejectUrl = `${functionsBase}/offer-action?id=${offer.id}&action=reject&token=${token}`;
      const links = (offer.apply_links || []).slice(0, 3).join("\n    ");

      sections.push(
        [
          `${offer.company || "(nieznana firma)"} — ${offer.role || offer.subject}`,
          `Od: ${offer.from_email}`,
          offer.snippet ? `Fragment: ${offer.snippet}` : "",
          links ? `Link(i) do oferty:\n    ${links}` : "",
          `ZATWIERDŹ (wygeneruj CV): ${approveUrl}`,
          `ODRZUĆ: ${rejectUrl}`,
        ].filter(Boolean).join("\n"),
      );
    }

    const text = [
      `Znaleziono ${offers.length} nowych ofert do przejrzenia.`,
      "",
      "Kliknij ZATWIERDŹ, żeby wygenerować dopasowane CV z Twojego projektu Claude i (jeśli da się aplikować mailem) przygotować szkic w Gmailu. Jeśli aplikacja wymaga portalu/linku, dostaniesz CV do ręcznego wgrania.",
      "",
      sections.join("\n\n----------------------------------------\n\n"),
    ].join("\n");

    await sendMessage({
      to,
      subject: `Oferty pracy do przejrzenia (${offers.length})`,
      text,
    });

    return withCors(Response.json({ ok: true, sent: true, count: offers.length }));
  } catch (e) {
    return withCors(Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 }));
  }
});
