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
5. **App verbinden:** In [`config.js`](config.js) die *Project URL* und den *anon public key* eintragen. Beides steht unter *Project Settings → API*.
6. **Veröffentlichen:** Im GitHub-Repo unter *Settings → Pages* die *Source* „Deploy from a branch“ wählen, dann `main` und `/ (root)`. Nach etwa einer Minute ist die Seite unter `https://<dein-name>.github.io/nachhilfe-lernraum/` erreichbar.

Lokal testen geht mit `python3 -m http.server` im Projektordner. Danach http://localhost:8000 öffnen.

## Sicherheit

- Der *anon key* in `config.js` ist öffentlich gedacht. Die Daten schützt die Datenbank über Row Level Security.
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
```
