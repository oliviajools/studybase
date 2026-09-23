# Nachhilfe-Lernraum

Ein kleines Dashboard für die Nachhilfe. SchülerInnen sehen dort zwischen den Stunden ihren nächsten Termin, ihre Hausaufgaben, Erklärvideos und ihren Lernverlauf, und sie können Fragen notieren. Die Lehrerin dokumentiert die Stunden, stellt Hausaufgaben, teilt Material und beantwortet Fragen.

- **Frontend:** reines HTML/CSS/JS ohne Build-Schritt. Läuft auf GitHub Pages.
- **Backend:** [Supabase](https://supabase.com) (Postgres). Der kostenlose Plan reicht.
- **Fächer:** Mathe, Deutsch, Englisch, Bio, Chemie, Geschichte. Die Liste steht in `app.js` unter `SUBJECTS`.

## Funktionen

| SchülerIn (Login mit Name + PIN) | Lehrerin (Login mit E-Mail + Passwort) |
|---|---|
| Nächster Termin mit Countdown | SchülerInnen anlegen, PIN vergeben oder zurücksetzen |
| Hausaufgaben abhaken, mit verknüpftem Video | Stunden dokumentieren und nächsten Termin setzen |
| Material nach Fach gefiltert | Hausaufgaben stellen und mit Material verknüpfen |
| Fragen notieren und Antworten lesen | Material-Bibliothek, für alle oder einzelne SchülerInnen |
| Verlauf: Stunden-Log, erledigte Aufgaben, Stunden pro Fach | Übersicht: nächste Termine, Überfälliges, offene Fragen |

## Einrichtung (ca. 10 Minuten)

1. **Supabase-Projekt anlegen:** Auf supabase.com ein neues Projekt erstellen. Als Region eignet sich Frankfurt.
2. **Datenbank einrichten:** *SQL Editor → New query* öffnen, den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und auf *Run* klicken.
3. **Lehrerinnen-Account anlegen:** Unter *Authentication → Users → Add user* E-Mail und Passwort eintragen und „Auto Confirm User“ anhaken.
4. **Registrierung schließen:** Unter *Authentication → Sign In / Providers* die Option **„Allow new users to sign up“ ausschalten**. So kann sich niemand sonst einen Account anlegen.
5. **App verbinden:** In [`config.js`](config.js) die Project URL (`https://<projekt-id>.supabase.co`, die ID steht in der Adresszeile des Dashboards) und den *Publishable key* eintragen. Den Key findest du unter *Project Settings → API Keys*.
6. **Veröffentlichen:** Im GitHub-Repo unter *Settings → Pages* die *Source* „Deploy from a branch“ wählen, dann `main` und `/ (root)`. Nach etwa einer Minute ist die Seite unter `https://oliviajools.github.io/studybase/` erreichbar.

Lokal testen geht mit `python3 -m http.server` im Projektordner. Danach http://localhost:8000 öffnen.

## Stunden aufnehmen & auswerten (optional)

Die Lehrerin kann eine Stunde im Tab **Stunde & Termin** aufnehmen oder eine vorhandene Audiodatei hochladen. Danach passiert automatisch:

1. **Transkription:** Die Aufnahme wird alle 8 Minuten in einem Abschnitt an die Edge Function `transcribe` geschickt (OpenAI Whisper, Deutsch). Das Audio wird **nicht gespeichert**, nur der Text.
2. **Auswertung:** Nach dem Beenden wertet die Edge Function `review` das Transkript mit Claude aus. Heraus kommen eine Zusammenfassung für die/den SchülerIn, Stärken, belegte Schwachstellen (mit Zitat), Missverständnisse, Übungsempfehlungen, der Fokus für die nächste Stunde und Beobachtungen zur Stunde. Die letzten Auswertungen fließen als Kontext ein, deshalb erkennt Claude wiederkehrende Schwächen.
3. **Freigabe:** Die Auswertung ist zuerst ein Entwurf, den nur die Lehrerin sieht. Erst nach **„Freigeben“** sehen SchülerInnen die Zusammenfassung und die Übungen im Verlauf. Transkript und Schwachstellen bekommen sie nie zu sehen.
4. **Übungspakete:** Zu jeder Schwachstelle baut Claude ein Übungspaket: 3–6 fertige Aufgaben mit Tipp und Lösung, dazu – wenn etwas passt – ein verknüpftes Material aus deiner Bibliothek. Du wählst aus, was gestellt wird, und klickst auf „Ausgewählte als Hausaufgabe stellen“. Im Profil kannst du pro SchülerIn auf automatisch umstellen: Dann werden bei der Freigabe alle Pakete gestellt, fällig zum nächsten Termin.
5. **Üben:** SchülerInnen öffnen die Aufgabe im Lernraum und arbeiten sie einzeln durch – mit Tipp, Lösung zum Aufdecken und Abhaken am Ende.
6. **Verlauf:** Das **Schwachstellen-Radar** fasst die letzten 6 Auswertungen zusammen.

### Einrichtung (ca. 10 Minuten)

1. **Datenbank erweitern:** Im SQL-Editor nacheinander [`supabase/review.sql`](supabase/review.sql) und [`supabase/tasks.sql`](supabase/tasks.sql) ausführen.
2. **API-Keys besorgen:**
   - OpenAI: platform.openai.com → API keys (Transkription ca. 0,006 $ pro Minute, also ca. 0,36 $ pro Stunde)
   - Anthropic: console.anthropic.com → API Keys (Auswertung ca. 3–6 Cent pro Stunde)
3. **Secrets hinterlegen:** In Supabase unter *Edge Functions → Secrets* diese Einträge anlegen:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - optional `ANTHROPIC_MODEL` (Standard: `claude-sonnet-5`) und `TRANSCRIBE_MODEL` (Standard: `whisper-1`)
4. **Functions anlegen:** Unter *Edge Functions → Deploy a new function → Via Editor* zwei Functions erstellen:
   - `transcribe` mit dem Inhalt von [`supabase/functions/transcribe/index.ts`](supabase/functions/transcribe/index.ts)
   - `review` mit dem Inhalt von [`supabase/functions/review/index.ts`](supabase/functions/review/index.ts)

   Bei beiden unter *Details / Settings* die Option **„Verify JWT“ (Enforce JWT verification) ausschalten**. Die Functions prüfen die Anmeldung selbst.

   Mit der Supabase-CLI geht es auch so: `supabase functions deploy transcribe --no-verify-jwt` und `supabase functions deploy review --no-verify-jwt`.
5. **Einverständnis setzen:** Im Profil der/des SchülerIn „Einverständnis zur Aufnahme liegt vor“ einschalten. Ohne dieses Häkchen ist die Aufnahme gesperrt.

### Datenschutz – bitte beachten

- Aufnahmen von Minderjährigen brauchen die **schriftliche Einwilligung der Eltern** (DSGVO Art. 6/8). Informiere vorab, wofür die Aufnahme dient und dass das Audio an OpenAI (USA) und das Transkript an Anthropic (USA) übertragen wird.
- Nach einer Auswertung kannst du das Transkript im Verlauf jederzeit löschen („Transkript löschen“). Die Auswertung bleibt dann erhalten.
- Die KI-Auswertung ist ein Vorschlag, keine Diagnose. Prüf sie deshalb vor der Freigabe und korrigier die Zusammenfassung bei Bedarf.
- Auch generierte Aufgaben und Lösungen können Fehler enthalten. Schau sie über „Aufgaben ansehen“ durch, bevor du sie stellst – besonders wenn du die Automatik einschaltest.
- Browser: Chrome oder Safari. Während der Aufnahme den Tab geöffnet lassen, der Bildschirm bleibt automatisch an.

## Sicherheit

- Der *Publishable key* in `config.js` ist öffentlich gedacht. Die Daten schützt die Datenbank über Row Level Security.
- Die Lehrerin sieht und bearbeitet nur ihre eigenen Daten.
- SchülerInnen haben **keinen direkten Zugriff auf die Tabellen**. Sie melden sich mit Name und PIN über `student_login()` an und bekommen ein zufälliges Sitzungs-Token. Mit diesem Token liefern die Datenbank-Funktionen nur die eigenen Daten.
- PINs werden nur als bcrypt-Hash gespeichert. Nach 5 falschen Versuchen ist ein Profil 10 Minuten gesperrt. Eine neue PIN entsperrt es sofort und meldet alle Geräte ab.
- Eine 4-stellige PIN ist kein starkes Passwort. Für Nachhilfe-Notizen reicht sie aus, aber sensible Daten wie Noten oder Diagnosen gehören hier nicht hinein.

## Dateien

```
index.html            Seite
styles.css            Design (hell/dunkel)
app.js                gesamte App-Logik
config.js             Supabase-Zugangsdaten (URL + anon key)
supabase/schema.sql   Tabellen, Zugriffsregeln, Funktionen
supabase/review.sql   Erweiterung: Transkript & Auswertung
supabase/tasks.sql    Erweiterung: Übungsaufgaben & Automatik
supabase/functions/   Edge Functions transcribe (Whisper) + review (Claude)
```
