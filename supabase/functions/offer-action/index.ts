// The endpoint behind the "ZATWIERDŹ" / "ODRZUĆ" links in the digest email.
// GET so it works as a plain clickable link — protected by a per-offer random token
// instead of a login. On approve: generates a tailored CV, and either drafts a Gmail
// reply to the employer (if we found an application email address) or marks the offer
// manual_apply_needed (most postings only accept applications through a portal/link,
// which cannot be safely auto-submitted).
import { handleOptions, withCors } from "../_shared/cors.ts";
import { hasValidAdminToken } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import { generateTailoredCv } from "../_shared/anthropic.ts";
import { createDraft } from "../_shared/gmail.ts";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
     <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#1c1c1c;line-height:1.6}
     h1{font-size:20px}pre{white-space:pre-wrap;background:#f4f4f0;padding:16px;border-radius:8px}</style>
     </head><body><h1>${title}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const action = url.searchParams.get("action");
    const token = url.searchParams.get("token");
    const adminOk = hasValidAdminToken(req);
    if (!id || (!token && !adminOk) || (action !== "approve" && action !== "reject")) {
      return withCors(page("Nieprawidłowe żądanie", "<p>Brakuje id, action lub token.</p>", 400));
    }

    const db = adminClient();
    const { data: offer, error } = await db.from("job_offers").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!offer) return withCors(page("Nie znaleziono oferty", "", 404));

    if (offer.status !== "digested" && offer.status !== "new") {
      return withCors(page(
        "Ta oferta została już obsłużona",
        `<p>Aktualny status: <b>${offer.status}</b>. Nie trzeba nic więcej robić.</p>`,
      ));
    }
    if (offer.action_token !== token && !adminOk) {
      return withCors(page("Nieprawidłowy token", "<p>Link jest nieaktualny lub uszkodzony.</p>", 403));
    }

    if (action === "reject") {
      await db.from("job_offers").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", id);
      return withCors(page("Odrzucono", `<p>${offer.company || ""} — ${offer.role || offer.subject}</p>`));
    }

    // approve
    await db.from("job_offers").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);

    const { cv, coverNote } = await generateTailoredCv(offer);
    await db.from("job_offers").update({ generated_cv: cv, generated_cover_note: coverNote, status: "cv_generated" }).eq("id", id);

    if (offer.apply_email) {
      const draft = await createDraft({
        to: offer.apply_email,
        subject: `Aplikacja na stanowisko: ${offer.role || offer.subject || ""}`,
        text: coverNote,
        attachment: { filename: "CV.md", content: cv, mimeType: "text/markdown" },
      });
      await db.from("job_offers").update({ status: "drafted", gmail_draft_id: draft.id }).eq("id", id);
      return withCors(page(
        "CV wygenerowane i szkic gotowy",
        `<p>${offer.company || ""} — ${offer.role || offer.subject}</p>
         <p>Utworzono szkic maila do <b>${offer.apply_email}</b> w Twoim Gmailu (folder Wersje robocze) z załączonym CV. Sprawdź go i wyślij ręcznie.</p>`,
      ));
    }

    const links = (offer.apply_links || []) as string[];
    await db.from("job_offers").update({ status: "manual_apply_needed" }).eq("id", id);
    return withCors(page(
      "CV wygenerowane — wymaga ręcznej aplikacji",
      `<p>${offer.company || ""} — ${offer.role || offer.subject}</p>
       <p>Ta oferta nie ma adresu e-mail do aplikacji — najpewniej trzeba aplikować przez link/portal, czego agent celowo nie robi automatycznie.</p>
       ${links.length ? `<p>Link(i) do aplikacji:</p><pre>${links.join("\n")}</pre>` : ""}
       <p>Dopasowane CV i notatkę znajdziesz w aplikacji Job Tracker — skopiuj je do formularza aplikacyjnego.</p>`,
    ));
  } catch (e) {
    return withCors(page("Błąd", `<pre>${String((e as any)?.message || e)}</pre>`, 500));
  }
});
