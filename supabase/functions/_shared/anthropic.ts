// Recreates the "CV creation" Claude Project via the Messages API: Claude.ai Projects
// have no external API, so cv_profile.instructions / base_resume (edited in the app UI)
// stand in for the project's system prompt + knowledge files.
import { adminClient } from "./supabase.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";

export interface CvResult {
  cv: string;
  coverNote: string;
}

export async function generateTailoredCv(offer: {
  company: string | null;
  role: string | null;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
}): Promise<CvResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const db = adminClient();
  const { data: profile, error } = await db.from("cv_profile").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!profile?.base_resume) {
    throw new Error("cv_profile.base_resume is empty — paste your base CV in the app first.");
  }

  const system = [
    "Jesteś asystentem tworzącym dopasowane CV i krótką notatkę aplikacyjną na podstawie bazowego CV kandydata i treści konkretnej oferty pracy.",
    "Zachowuj się dokładnie zgodnie z poniższymi instrukcjami z projektu 'CV creation', jeśli zostały podane:",
    profile.instructions || "(brak dodatkowych instrukcji — dopasuj CV w sposób zwięzły i prawdziwy, nie wymyślaj doświadczenia).",
    "",
    "Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez komentarzy) w formacie:",
    '{"cv": "pełna treść dopasowanego CV w markdown", "coverNote": "krótka notatka/mail aplikacyjny (4-6 zdań) w języku oferty"}',
  ].join("\n");

  const offerDescription = [
    `Firma: ${offer.company || "nieznana"}`,
    `Stanowisko: ${offer.role || offer.subject || "nieznane"}`,
    `Treść oferty:\n${(offer.body_text || offer.snippet || "").slice(0, 6000)}`,
  ].join("\n\n");

  const user = [
    "BAZOWE CV KANDYDATA:",
    profile.base_resume,
    "",
    "OFERTA PRACY DO DOPASOWANIA:",
    offerDescription,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map((b: any) => b.text || "").join("").trim();
  const cleaned = text.replace(/^```json\s*|```$/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed.cv || !parsed.coverNote) throw new Error("Model response missing cv/coverNote fields.");
  return { cv: parsed.cv, coverNote: parsed.coverNote };
}
