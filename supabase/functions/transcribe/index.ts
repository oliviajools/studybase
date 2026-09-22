// ============================================================
//  Edge Function "transcribe"
//  Nimmt einen Audio-Abschnitt (max. 25 MB) entgegen, lässt ihn von
//  OpenAI transkribieren und hängt den Text an die Stunde an.
//  Das Audio wird nirgends gespeichert – es existiert nur während
//  dieses Aufrufs im Arbeitsspeicher.
//
//  Secrets (Supabase → Edge Functions → Secrets):
//    OPENAI_API_KEY        (Pflicht)
//    TRANSCRIBE_MODEL      (optional, Standard: whisper-1)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- Anmeldung prüfen: nur die eingeloggte Lehrerin darf das ---
  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, apikey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not_authenticated" }, 401);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "missing_openai_key" }, 500);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "bad_form" }, 400); }
  const file = form.get("file");
  const lessonId = String(form.get("lesson_id") ?? "");
  const seconds = Number(form.get("seconds") ?? 0) || 0;
  if (!(file instanceof File) || !lessonId) return json({ error: "missing_fields" }, 400);
  if (file.size > 25 * 1024 * 1024) return json({ error: "file_too_large" }, 413);

  // Stunde laden (RLS sorgt dafür, dass nur eigene Stunden sichtbar sind)
  const { data: lesson } = await sb.from("lessons").select("id, subject, topic, transcript").eq("id", lessonId).single();
  if (!lesson) return json({ error: "lesson_not_found" }, 404);
  await sb.from("lessons").update({ review_status: "transcribing", review_error: "" }).eq("id", lessonId);

  // Kontext-Prompt: Fach + Thema + Ende des bisherigen Transkripts → bessere Fachbegriffe & Übergänge
  const tail = (lesson.transcript ?? "").slice(-400);
  const prompt = `Nachhilfestunde ${lesson.subject}${lesson.topic ? ", Thema: " + lesson.topic : ""}. Gespräch zwischen Lehrerin und SchülerIn auf Deutsch. ${tail}`.slice(0, 900);

  const model = Deno.env.get("TRANSCRIBE_MODEL") || "whisper-1";
  const body = new FormData();
  body.append("file", file, file.name || "abschnitt.webm");
  body.append("model", model);
  body.append("response_format", "json");
  if (model === "gpt-transcribe") body.append("languages[]", "de"); else body.append("language", "de");
  body.append("prompt", prompt);

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}` }, body,
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    await sb.from("lessons").update({ review_status: "error", review_error: `Transkription fehlgeschlagen (${r.status})` }).eq("id", lessonId);
    return json({ error: "transcription_failed", status: r.status, detail }, 502);
  }
  const { text } = await r.json();
  const clean = String(text ?? "").trim();

  if (clean) {
    const { error } = await sb.rpc("teacher_append_transcript", { p_lesson: lessonId, p_text: clean, p_seconds: Math.round(seconds) });
    if (error) return json({ error: "save_failed", detail: error.message }, 500);
  }
  return json({ ok: true, text: clean });
});
