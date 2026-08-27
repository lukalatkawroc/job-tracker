// Standalone HTTP wrapper around generateTailoredCv, for manual re-generation from the
// app UI (e.g. "regenerate" button). offer-action calls the shared helper directly.
import { handleOptions, withCors } from "../_shared/cors.ts";
import { requireAdminToken } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import { generateTailoredCv } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const denied = requireAdminToken(req);
  if (denied) return withCors(denied);

  try {
    const { offerId } = await req.json();
    if (!offerId) throw new Error("offerId is required");

    const db = adminClient();
    const { data: offer, error } = await db.from("job_offers").select("*").eq("id", offerId).maybeSingle();
    if (error) throw error;
    if (!offer) throw new Error("Offer not found");

    const { cv, coverNote } = await generateTailoredCv(offer);

    const { error: updateError } = await db.from("job_offers").update({
      generated_cv: cv,
      generated_cover_note: coverNote,
    }).eq("id", offerId);
    if (updateError) throw updateError;

    return withCors(Response.json({ ok: true, cv, coverNote }));
  } catch (e) {
    return withCors(Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 }));
  }
});
