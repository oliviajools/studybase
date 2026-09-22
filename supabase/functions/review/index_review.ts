// ============================================================
//  Edge Function "review"
//  Wertet das Transkript einer Stunde mit Claude aus:
//  Zusammenfassung (für SchülerIn), Stärken, Schwachstellen mit Belegen,
//  Missverständnisse, Übungsempfehlungen, Fokus für die nächste Stunde.
//  Das Ergebnis wird gespeichert, aber erst nach Freigabe durch die
//  Lehrerin für die/den SchülerIn sichtbar.
//
//  Secrets (Supabase → Edge Functions → Secrets):
//    ANTHROPIC_API_KEY     (Pflicht)
//    ANTHROPIC_MODEL       (optional, Standard: claude-sonnet-5)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Struktur, die Claude zurückgeben muss (erzwungener Tool-Aufruf = verlässliches JSON)
const REVIEW_TOOL = {
  name: "save_review",
  description: "Speichert die pädagogische Auswertung einer Nachhilfestunde.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Kurzer Titel der Stunde, max. 6 Wörter, z. B. 'Brüche dividieren'." },
      summary_student: { type: "string", description: "2–4 Sätze an die/den SchülerIn in Du-Form: was ihr gemacht habt und was schon gut klappt. Ermutigend, konkret, ohne Schwächen-Aufzählung." },
      covered: { type: "array", items: { type: "string" }, description: "Behandelte Inhalte/Teilthemen in der Reihenfolge der Stunde." },
      strengths: { type: "array", items: { type: "string" }, description: "Was die/der SchülerIn nachweislich gut konnte." },
      weaknesses: {
        type: "array",
        description: "Nur Schwachstellen mit Beleg im Transkript. Lieber wenige, gut belegte als viele vermutete.",
        items: {
          type: "object",
          properties: {
            skill: { type: "string", description: "Die konkrete Fähigkeit/das Teilthema, z. B. 'Kehrwert bilden bei gemischten Zahlen'." },
            evidence: { type: "string", description: "Kurzes Zitat oder genaue Umschreibung der Stelle im Transkript." },
            severity: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
            suggestion: { type: "string", description: "Didaktischer Vorschlag für die Lehrerin, wie man daran arbeitet." },
          },
          required: ["skill", "evidence", "severity", "suggestion"],
        },
      },
      misconceptions: { type: "array", items: { type: "string" }, description: "Fehlvorstellungen/systematische Fehler, falls erkennbar." },
      practice: {
        type: "array",
        description: "2–4 Übungsempfehlungen für zuhause, an die/den SchülerIn formuliert, passend zu den Schwachstellen.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string", description: "Was genau zu tun ist, 1–2 Sätze." },
          },
          required: ["title", "description"],
        },
      },
      next_focus: { type: "string", description: "Empfehlung für den Schwerpunkt der nächsten Stunde (für die Lehrerin)." },
      teacher_notes: { type: "string", description: "Beobachtungen zur Stunde selbst: Redeanteile, Tempo, Aktivierung, was didaktisch gut/weniger gut lief." },
      transcript_quality: { type: "string", enum: ["gut", "lückenhaft", "schlecht"], description: "Wie verlässlich das Transkript für die Auswertung war." },
    },
    required: ["topic", "summary_student", "covered", "strengths", "weaknesses", "misconceptions", "practice", "next_focus", "teacher_notes", "transcript_quality"],
  },
};

const SYSTEM = `Du bist erfahrene Lernberaterin und Fachdidaktikerin und unterstützt eine Nachhilfelehrerin.
Du bekommst das automatisch erstellte Transkript einer Nachhilfestunde (ohne Sprecher-Kennzeichnung – leite vorsichtig aus dem Kontext ab, wer spricht) sowie Kontext zur/zum SchülerIn.

Regeln:
- Stütze jede Schwachstelle auf eine konkrete Stelle im Transkript. Keine Vermutungen ohne Beleg.
- Transkriptionsfehler sind häufig (v. a. bei Zahlen, Formeln, Fachwörtern). Werte nicht jeden Versprecher als Fehler.
- Keine Aussagen über Gesundheit, Diagnosen (z. B. Dyskalkulie, ADHS), Persönlichkeit, Intelligenz oder Familie.
- Die Zusammenfassung und die Übungen richten sich an eine/n Jugendliche/n: klar, freundlich, auf Augenhöhe, Du-Form.
- Die Analyse für die Lehrerin ist sachlich, präzise und handlungsorientiert.
- Berücksichtige den Verlauf der letzten Stunden: Wiederkehrende Schwachstellen haben höhere Priorität.
- Antworte ausschließlich über das Werkzeug save_review, auf Deutsch.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, apikey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not_authenticated" }, 401);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_anthropic_key" }, 500);

  let lessonId = "";
  try { lessonId = (await req.json()).lesson_id; } catch { /* leer */ }
  if (!lessonId) return json({ error: "missing_lesson_id" }, 400);

  const { data: lesson } = await sb.from("lessons").select("*").eq("id", lessonId).single();
  if (!lesson) return json({ error: "lesson_not_found" }, 404);
  if (!lesson.transcript || lesson.transcript.trim().length < 80) {
    await sb.from("lessons").update({ review_status: "error", review_error: "Transkript zu kurz für eine Auswertung." }).eq("id", lessonId);
    return json({ error: "transcript_too_short" }, 422);
  }
  await sb.from("lessons").update({ review_status: "analyzing", review_error: "" }).eq("id", lessonId);

  // Kontext: SchülerIn, letzte ausgewertete Stunden, offene Hausaufgaben
  const [{ data: st }, { data: prev }, { data: hw }] = await Promise.all([
    sb.from("students").select("name, grade, subjects").eq("id", lesson.student_id).single(),
    sb.from("lessons").select("date, subject, topic, review").eq("student_id", lesson.student_id)
      .neq("id", lessonId).not("review", "is", null).order("date", { ascending: false }).limit(5),
    sb.from("homework").select("title, subject, due, done").eq("student_id", lesson.student_id).eq("done", false).limit(10),
  ]);
  const history = (prev ?? []).map((l: any) =>
    `- ${l.date} (${l.subject}) ${l.topic}: Schwachstellen: ${(l.review?.weaknesses ?? []).map((w: any) => w.skill).join("; ") || "keine notiert"}`
  ).join("\n") || "keine";
  const context = `SchülerIn: ${st?.name?.split(" ")[0] ?? "?"}, ${st?.grade || "Klasse unbekannt"}
Fach dieser Stunde: ${lesson.subject}${lesson.topic && !/^Aufnahme/.test(lesson.topic) ? ` · angegebenes Thema: ${lesson.topic}` : ""}
Datum: ${lesson.date} · Dauer: ${Math.round((lesson.duration_sec || 0) / 60)} Min.
Letzte ausgewertete Stunden:
${history}
Offene Hausaufgaben: ${(hw ?? []).map((h: any) => `${h.title} (${h.subject})`).join("; ") || "keine"}`;

  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: SYSTEM,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: "save_review" },
      messages: [{
        role: "user",
        content: `<kontext>\n${context}\n</kontext>\n\n<transkript>\n${lesson.transcript.slice(0, 180000)}\n</transkript>\n\nWerte diese Stunde aus.`,
      }],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 400);
    await sb.from("lessons").update({ review_status: "error", review_error: `Auswertung fehlgeschlagen (${r.status})` }).eq("id", lessonId);
    return json({ error: "review_failed", status: r.status, detail }, 502);
  }
  const out = await r.json();
  const call = (out.content ?? []).find((c: any) => c.type === "tool_use");
  if (!call) {
    await sb.from("lessons").update({ review_status: "error", review_error: "Keine verwertbare Antwort erhalten." }).eq("id", lessonId);
    return json({ error: "no_tool_output" }, 502);
  }
  const rv = call.input;

  const update: Record<string, unknown> = {
    summary: rv.summary_student ?? "",
    practice: (rv.practice ?? []).map((p: any) => ({ title: p.title, description: p.description })),
    review: {
      covered: rv.covered ?? [], strengths: rv.strengths ?? [], weaknesses: rv.weaknesses ?? [],
      misconceptions: rv.misconceptions ?? [], next_focus: rv.next_focus ?? "", teacher_notes: rv.teacher_notes ?? "",
      transcript_quality: rv.transcript_quality ?? "", suggested_topic: rv.topic ?? "", model, created_at: new Date().toISOString(),
    },
    review_status: "done",
    review_published: false,
  };
  // Platzhalter-Thema durch den Vorschlag ersetzen
  if (!lesson.topic || /^Aufnahme/.test(lesson.topic)) update.topic = rv.topic || lesson.topic;

  const { error } = await sb.from("lessons").update(update).eq("id", lessonId);
  if (error) return json({ error: "save_failed", detail: error.message }, 500);
  return json({ ok: true });
});
