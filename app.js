/* Nachhilfe-Lernraum – eigenständige Web-App (Supabase-Backend) */
"use strict";

const SUBJECTS = ["Mathe","Deutsch","Englisch","Bio","Chemie","Geschichte"];
const SVAR = {Mathe:"--s-mathe",Deutsch:"--s-deutsch",Englisch:"--s-englisch",Bio:"--s-bio",Chemie:"--s-chemie",Geschichte:"--s-geschichte"};
const KINDS = {video:"▶ Erklärvideo", link:"↗ Link", aufgabe:"✎ Übung"};
const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const TOKEN_KEY = "lernraum.token";

let sb = null;               // Supabase-Client
let teacherUser = null;      // eingeloggte Lehrerin (Supabase-Auth)
let studentToken = null;     // Sitzungs-Token einer/eines SchülerIn
const S = {students:[], lessons:[], homework:[], questions:[], resources:[], loaded:false};
const ui = {
  mode:"login", loginAs:"student", studentId:null, tab:"start", filter:"Alle",
  tStudent:null, tTab:"stunden", loginErr:"", busy:false, lastSync:null
};

/* ---------- Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const col = s => `var(${SVAR[s]||"--ink-3"})`;
const subjChip = s => s ? `<span class="chip subj" style="background:${col(s)}">${esc(s)}</span>` : "";
const pad = n => String(n).padStart(2,"0");
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const parseDay = s => { if(!s) return null; const [y,m,d]=s.slice(0,10).split("-").map(Number); return new Date(y,m-1,d); };
const fmtDate = s => { const d=parseDay(s); return d ? d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}) : ""; };
const fmtShort = s => { const d=parseDay(s); return d ? d.toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit"}) : ""; };
const daysUntil = s => { const d=parseDay(s); if(!d) return null; return Math.round((d-parseDay(today()))/86400000); };
const relDays = n => n===0?"heute":n===1?"morgen":n===-1?"gestern":n>0?`in ${n} Tagen`:`vor ${-n} Tagen`;
const initials = n => (n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const firstName = n => (n||"").split(" ")[0];
function url(u){ try{ const x=new URL(u); return /^https?:$/.test(x.protocol)?x.href:null; }catch(e){ return null; } }
/* Zeitstempel (UTC) -> "YYYY-MM-DDTHH:MM" in Ortszeit, wie ihn <input type=datetime-local> braucht */
function toLocalInput(ts){ if(!ts) return ""; const d=new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2800); }
function store(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){} }
function load(k){ try{ return localStorage.getItem(k);}catch(e){ return null; } }
const byStudent = (arr,id) => arr.filter(x=>x.studentId===id);
const student = id => S.students.find(s=>s.id===id);
function resourcesFor(id){ return S.resources.filter(r=>!r.studentIds || r.studentIds.length===0 || r.studentIds.includes(id)); }
function hwStatus(h){
  if(h.done) return `<span class="chip ok">✓ erledigt</span>`;
  const n=daysUntil(h.due); if(n==null) return "";
  if(n<0) return `<span class="chip bad">überfällig · ${fmtShort(h.due)}</span>`;
  if(n<=2) return `<span class="chip warn">fällig ${relDays(n)}</span>`;
  return `<span class="chip">fällig ${fmtShort(h.due)}</span>`;
}
const sortHw = (a,b) => (a.done-b.done) || String(a.due||"9").localeCompare(String(b.due||"9"));

/* ---------- Datenbank-Zeilen -> App-Objekte ---------- */
const mapStudent = r => ({id:r.id, name:r.name, grade:r.grade||"", subjects:r.subjects||[], nextAppt:toLocalInput(r.next_appt), apptNote:r.appt_note||""});
const mapLesson = (r,sid) => ({id:r.id, studentId:r.student_id||sid, date:r.date, subject:r.subject, topic:r.topic, notes:r.notes||"", created:r.created_at});
const mapHw = (r,sid) => ({id:r.id, studentId:r.student_id||sid, title:r.title, description:r.description||"", subject:r.subject, due:r.due||"", resourceId:r.resource_id||"", done:!!r.done});
const mapQ = (r,sid) => ({id:r.id, studentId:r.student_id||sid, subject:r.subject, text:r.text, askedAt:r.asked_at, answer:r.answer||"", seen:!!r.seen});
const mapRes = r => ({id:r.id, title:r.title, url:r.url, kind:r.kind, subject:r.subject, note:r.note||"", studentIds:r.student_ids||[], created:r.created_at});

/* ---------- Laden ---------- */
async function loadTeacher(){
  const [st,le,hw,qu,re] = await Promise.all([
    sb.from("students").select("id,name,grade,subjects,next_appt,appt_note").order("name"),
    sb.from("lessons").select("*"),
    sb.from("homework").select("*"),
    sb.from("questions").select("*"),
    sb.from("resources").select("*")
  ]);
  const err = [st,le,hw,qu,re].find(x=>x.error);
  if(err){ console.error(err.error); toast("Daten konnten nicht geladen werden."); return; }
  S.students = st.data.map(mapStudent);
  S.lessons = le.data.map(r=>mapLesson(r));
  S.homework = hw.data.map(r=>mapHw(r));
  S.questions = qu.data.map(r=>mapQ(r));
  S.resources = re.data.map(mapRes);
  S.loaded = true; ui.lastSync = new Date();
}
async function loadStudent(){
  const {data, error} = await sb.rpc("student_dashboard", {p_token: studentToken});
  if(error){ console.error(error); toast("Keine Verbindung – bitte gleich nochmal versuchen."); return; }
  if(!data || !data.ok){ studentToken=null; store(TOKEN_KEY,null); ui.mode="login"; ui.loginErr="Bitte melde dich neu an."; return; }
  const sid = data.student.id;
  S.students = [mapStudent(data.student)];
  S.lessons = data.lessons.map(r=>mapLesson(r,sid));
  S.homework = data.homework.map(r=>mapHw(r,sid));
  S.questions = data.questions.map(r=>mapQ(r,sid));
  S.resources = data.resources.map(mapRes);
  ui.studentId = sid; ui.mode = "student"; S.loaded = true; ui.lastSync = new Date();
}
async function refresh(){
  if(ui.busy) return;
  if(teacherUser) await loadTeacher();
  else if(studentToken) await loadStudent();
  render();
}
/* Schreibvorgang ausführen, danach neu laden */
async function run(promise, okMsg){
  const res = await promise;
  if(res && res.error){ console.error(res.error); toast(friendlyError(res.error)); return false; }
  if(res && res.data===false){ toast("Das hat nicht geklappt. Bitte neu einloggen und nochmal versuchen."); return false; }
  if(okMsg) toast(okMsg);
  await refresh();
  return true;
}
function friendlyError(e){
  const m = (e && (e.message||e.details)) || "";
  if(/pin_format/.test(m)) return "Die PIN muss aus 4–6 Ziffern bestehen.";
  if(/students_name_uniq|duplicate key/.test(m)) return "Diesen Namen gibt es schon – bitte eindeutig machen (z. B. mit Nachnamen).";
  if(/url/.test(m) && /check/.test(m)) return "Bitte einen gültigen Link mit https:// eingeben.";
  if(/JWT|not_authenticated/.test(m)) return "Deine Anmeldung ist abgelaufen – bitte neu einloggen.";
  return "Speichern hat nicht geklappt. Bitte gleich nochmal versuchen.";
}

/* ---------- Start ---------- */
(async function boot(){
  const cfg = window.LERNRAUM_CONFIG || {};
  if(!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase){ $("#app").innerHTML = setupView(); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const {data:{session}} = await sb.auth.getSession();
  if(session){ teacherUser = session.user; ui.mode="teacher"; await loadTeacher(); }
  else if(load(TOKEN_KEY)){ studentToken = load(TOKEN_KEY); await loadStudent(); }
  render();
  window.addEventListener("focus", refresh);
  setInterval(()=>{ if(document.visibilityState==="visible") refresh(); }, 60000);
})();

function setupView(){
  return `<div class="login setup stack" style="max-width:620px">
    <div class="brand"><span class="logo" aria-hidden="true">✎</span>Nachhilfe-Lernraum</div>
    <div class="panel stack"><h1>Fast fertig!</h1>
      <p class="muted">Der Lernraum ist noch nicht mit einer Datenbank verbunden.</p>
      <ol>
        <li>Kostenloses Projekt auf <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> anlegen.</li>
        <li>Im SQL-Editor den Inhalt von <code>supabase/schema.sql</code> ausführen.</li>
        <li>Unter <em>Authentication → Users</em> deinen Lehrerinnen-Account anlegen und unter <em>Sign In / Providers</em> „Allow new users to sign up“ ausschalten.</li>
        <li>In <code>config.js</code> Project URL und anon key eintragen.</li>
      </ol>
      <p class="small muted">Details stehen in der README.</p></div></div>`;
}

/* ---------- Rendern ---------- */
let lastKey="";
function render(){
  const app=$("#app");
  const key=[ui.mode,ui.loginAs,ui.studentId,ui.tab,ui.tStudent,ui.tTab].join("|");
  const ae=document.activeElement, focusId=ae&&ae.id?ae.id:null;
  let selS=null, selE=null; try{ selS=ae.selectionStart; selE=ae.selectionEnd; }catch(e){}
  const drafts={};
  if(key===lastKey) app.querySelectorAll("input[id],textarea[id],select[id]").forEach(el=>{ drafts[el.id]= el.type==="checkbox"?el.checked:el.value; });
  lastKey=key;
  let html;
  if(ui.mode==="teacher" && teacherUser) html = teacherView();
  else if(ui.mode==="student" && student(ui.studentId)) html = studentView(student(ui.studentId));
  else { ui.mode="login"; html = loginView(); }
  app.innerHTML = html;
  for(const [id,v] of Object.entries(drafts)){ const el=document.getElementById(id); if(!el) continue; if(el.type==="checkbox") el.checked=v; else el.value=v; }
  if(focusId){ const el=document.getElementById(focusId); if(el){ el.focus(); try{ if(selS!=null) el.setSelectionRange(selS,selE); }catch(e){} } }
}
function syncNote(){ return ui.lastSync ? `<span class="sync">aktualisiert ${ui.lastSync.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}</span>` : ""; }

/* ---------- Login ---------- */
function loginView(){
  const teacher = ui.loginAs==="teacher";
  return `
  <div class="login stack">
    <div class="brand"><span class="logo" aria-hidden="true">✎</span>Nachhilfe-Lernraum</div>
    <div class="panel stack">
      ${teacher ? `
        <div><h1>Login für die <span class="mark">Lehrerin</span></h1></div>
        <div class="field"><label for="lg-mail">E-Mail</label><input id="lg-mail" type="text" autocomplete="username" inputmode="email"></div>
        <div class="field"><label for="lg-pw">Passwort</label><input id="lg-pw" type="password" autocomplete="current-password"></div>
        ${ui.loginErr?`<p class="err">${esc(ui.loginErr)}</p>`:""}
        <button class="btn primary" style="justify-content:center" onclick="teacherLogin()">Einloggen</button>
        <div><button class="linkbtn" onclick="switchLogin('student')">← Zum Login für SchülerInnen</button></div>`
      : `
        <div><h1>Hallo! <span class="mark">Wer bist du?</span></h1>
        <p class="muted" style="margin-top:6px">Gib deinen Namen und deine PIN ein. Beides bekommst du von deiner Nachhilfelehrerin.</p></div>
        <div class="field"><label for="lg-name">Name</label><input id="lg-name" type="text" autocomplete="username" placeholder="z. B. Mia Schneider"></div>
        <div class="field"><label for="lg-pin">PIN</label><input id="lg-pin" type="password" inputmode="numeric" maxlength="6" class="pin" autocomplete="off" placeholder="••••"></div>
        ${ui.loginErr?`<p class="err">${esc(ui.loginErr)}</p>`:""}
        <button class="btn primary" style="justify-content:center" onclick="studentLogin()" ${ui.busy?"disabled":""}>Einloggen</button>
        <div><button class="linkbtn" onclick="switchLogin('teacher')">Ich bin die Lehrerin</button></div>`}
    </div>
  </div>`;
}
function switchLogin(to){ ui.loginAs=to; ui.loginErr=""; render(); }
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter") return;
  if(e.target.id==="lg-pin"||e.target.id==="lg-name") studentLogin();
  if(e.target.id==="lg-pw") teacherLogin();
});
async function studentLogin(){
  const name=$("#lg-name").value.trim(), pin=$("#lg-pin").value.trim();
  if(!name || !pin){ ui.loginErr="Bitte Name und PIN eingeben."; return render(); }
  ui.busy=true; render();
  const {data, error} = await sb.rpc("student_login", {p_name:name, p_pin:pin});
  ui.busy=false;
  if(error || !data){ ui.loginErr="Keine Verbindung. Bitte gleich nochmal versuchen."; return render(); }
  if(!data.ok){
    ui.loginErr = {
      unknown:"Diesen Namen kenne ich nicht. Schreib ihn so, wie deine Lehrerin ihn angelegt hat.",
      ambiguous:"Den Namen gibt es mehrmals – bitte mit Nachnamen eingeben.",
      wrong_pin:"Die PIN stimmt nicht.",
      locked:"Zu viele Versuche. Bitte warte 10 Minuten."
    }[data.error] || "Login hat nicht geklappt.";
    $("#lg-pin").value=""; return render();
  }
  studentToken=data.token; store(TOKEN_KEY,data.token); ui.loginErr=""; ui.tab="start";
  await loadStudent(); render();
}
async function teacherLogin(){
  const email=$("#lg-mail").value.trim(), password=$("#lg-pw").value;
  const {data, error} = await sb.auth.signInWithPassword({email, password});
  if(error){ ui.loginErr="E-Mail oder Passwort stimmt nicht."; return render(); }
  teacherUser=data.user; ui.mode="teacher"; ui.loginErr=""; store(TOKEN_KEY,null); studentToken=null;
  await loadTeacher(); render();
}
async function logout(){
  if(teacherUser){ await sb.auth.signOut(); teacherUser=null; }
  if(studentToken){ sb.rpc("student_logout",{p_token:studentToken}); studentToken=null; store(TOKEN_KEY,null); }
  Object.assign(S,{students:[],lessons:[],homework:[],questions:[],resources:[],loaded:false});
  ui.mode="login"; ui.studentId=null; ui.loginAs="student"; render();
}

/* ---------- Ansicht SchülerIn ---------- */
function nextCard(s, teacher){
  const a=s.nextAppt;
  if(!a || new Date(a) < new Date(Date.now()-3*3600e3)){
    return `<div class="panel"><div class="label">Nächster Termin</div><p class="muted" style="margin-top:4px">${teacher?"Noch kein Termin eingetragen.":"Noch kein neuer Termin eingetragen – wird bald ergänzt."}</p></div>`;
  }
  const d=new Date(a); const n=daysUntil(a.slice(0,10));
  const time=d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
  return `<div class="next">
    <div class="cal" aria-hidden="true"><div class="m">${MONTHS[d.getMonth()]}</div><div class="d">${d.getDate()}</div><div class="w">${WD[d.getDay()].slice(0,2)}</div></div>
    <div><div class="label" style="color:inherit;opacity:.8">Nächste Stunde · ${relDays(n)}</div>
      <div class="big">${WD[d.getDay()]}, ${d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})} · ${time} Uhr</div>
      ${s.apptNote?`<div class="sub">${esc(s.apptNote)}</div>`:""}</div>
  </div>`;
}
function studentView(s){
  const hw=byStudent(S.homework,s.id).sort(sortHw), open=hw.filter(h=>!h.done);
  const qs=byStudent(S.questions,s.id), newAns=qs.filter(q=>q.answer && !q.seen).length;
  const tabs=[["start","Übersicht"],["aufgaben","Hausaufgaben",open.length],["material","Material"],["fragen","Fragen",newAns],["verlauf","Mein Verlauf"]];
  let body="";
  if(ui.tab==="start") body=studentStart(s,open,qs);
  if(ui.tab==="aufgaben") body=hwList(hw,false);
  if(ui.tab==="material") body=materialView(s);
  if(ui.tab==="fragen") body=questionsStudent(s,qs);
  if(ui.tab==="verlauf") body=progressView(s);
  return `
  <div class="bar"><div class="brand"><span class="logo" aria-hidden="true">✎</span>Nachhilfe-Lernraum</div>
    <div class="bar-actions">${syncNote()}<button class="btn sm ghost" onclick="logout()">Abmelden</button></div></div>
  <h1>Hi ${esc(firstName(s.name))}!</h1>
  <p class="muted" style="margin-top:4px">${s.grade?esc(s.grade)+" · ":""}${(s.subjects||[]).map(esc).join(", ")}</p>
  <nav class="tabs" role="tablist">${tabs.map(([k,l,c])=>`<button class="tab" role="tab" aria-selected="${ui.tab===k}" onclick="setTab('${k}')">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("")}</nav>
  ${body}`;
}
function setTab(t){ ui.tab=t; render(); if(t==="fragen") markSeen(); }
async function markSeen(){
  if(!byStudent(S.questions,ui.studentId).some(q=>q.answer && !q.seen)) return;
  await sb.rpc("student_mark_seen",{p_token:studentToken});
  S.questions.forEach(q=>{ if(q.answer) q.seen=true; }); render();
}
function studentStart(s,open,qs){
  const ans=qs.filter(q=>q.answer && !q.seen);
  const recent=resourcesFor(s.id).slice(0,3);
  const last=byStudent(S.lessons,s.id).sort((a,b)=>b.date.localeCompare(a.date))[0];
  return `<div class="stack" style="gap:16px">
    ${nextCard(s)}
    <div class="grid2">
      <div class="panel"><div class="panel-h"><h2>Bis zur nächsten Stunde</h2><button class="btn sm ghost" onclick="setTab('aufgaben')">Alle ansehen →</button></div>
        <div class="stack">${open.length?hwItems(open.slice(0,4),false):`<div class="empty">Keine offenen Hausaufgaben. Stark!</div>`}</div></div>
      <div class="stack" style="gap:16px">
        ${ans.length?`<div class="panel"><div class="panel-h"><h2>Neue Antworten</h2></div><p class="muted small">Deine Lehrerin hat ${ans.length===1?"eine Frage":ans.length+" Fragen"} beantwortet.</p><div style="margin-top:10px"><button class="btn primary sm" onclick="setTab('fragen')">Antworten lesen</button></div></div>`:""}
        ${last?`<div class="panel"><div class="label">Letzte Stunde · ${fmtDate(last.date)}</div><h3 style="margin-top:4px">${esc(last.topic)}</h3>${last.notes?`<p class="muted small" style="margin-top:4px;white-space:pre-wrap">${esc(last.notes)}</p>`:""}<div class="meta row" style="margin-top:8px">${subjChip(last.subject)}</div></div>`:""}
        <div class="panel"><div class="panel-h"><h2>Neu im Material</h2><button class="btn sm ghost" onclick="setTab('material')">Alles →</button></div>
          <div class="stack">${recent.length?recent.map(resCard).join(""):`<div class="empty">Noch kein Material.</div>`}</div></div>
      </div>
    </div></div>`;
}
function hwItems(list,teacher){
  return list.map(h=>{
    const res = h.resourceId ? S.resources.find(r=>r.id===h.resourceId) : null;
    return `<div class="item ${h.done?"done":""}">
      ${teacher?`<span class="stripe" style="background:${col(h.subject)}"></span>`:`<button class="tick ${h.done?"on":""}" aria-label="${h.done?"Als offen markieren":"Als erledigt markieren"}" onclick="toggleHw('${h.id}')">${h.done?"✓":""}</button>`}
      <div class="main"><div class="t">${esc(h.title)}</div>
        ${h.description?`<div class="d">${esc(h.description)}</div>`:""}
        <div class="meta">${subjChip(h.subject)} ${hwStatus(h)} ${res&&url(res.url)?`<a class="chip" href="${esc(url(res.url))}" target="_blank" rel="noopener">${KINDS[res.kind]||"↗"}: ${esc(res.title)}</a>`:""}</div></div>
      ${teacher?`<div class="row"><button class="btn sm ghost" onclick="toggleHw('${h.id}')">${h.done?"Wieder öffnen":"Erledigt"}</button><button class="btn sm ghost danger" aria-label="Löschen" onclick="delRow('homework','${h.id}')">✕</button></div>`:""}
    </div>`;}).join("");
}
function hwList(hw,teacher){
  const open=hw.filter(h=>!h.done), done=hw.filter(h=>h.done);
  return `<div class="stack">
    ${open.length?hwItems(open,teacher):`<div class="empty">Keine offenen Hausaufgaben.</div>`}
    ${done.length?`<div class="label" style="margin-top:10px">Erledigt (${done.length})</div>${hwItems(done,teacher)}`:""}
  </div>`;
}
async function toggleHw(id){
  const h=S.homework.find(x=>x.id===id); if(!h) return;
  const done=!h.done;
  if(teacherUser) await run(sb.from("homework").update({done, done_at: done?new Date().toISOString():null}).eq("id",id), done?"Als erledigt markiert":"Wieder offen");
  else await run(sb.rpc("student_toggle_homework",{p_token:studentToken,p_homework:id,p_done:done}), done?"Abgehakt ✓":"Wieder offen");
}
function resCard(r){
  const u=url(r.url);
  return `<a class="rcard" ${u?`href="${esc(u)}" target="_blank" rel="noopener"`:""}>
    <div class="rkind"><span class="dot" style="background:${col(r.subject)}"></span>${KINDS[r.kind]||"Link"} · ${esc(r.subject||"")}</div>
    <div style="font-weight:700">${esc(r.title)}</div>
    ${r.note?`<div class="muted small">${esc(r.note)}</div>`:""}
  </a>`;
}
function materialView(s){
  const all=resourcesFor(s.id);
  const subs=["Alle",...SUBJECTS.filter(x=>all.some(r=>r.subject===x))];
  if(!subs.includes(ui.filter)) ui.filter="Alle";
  const list=all.filter(r=>ui.filter==="Alle"||r.subject===ui.filter);
  return `<div class="filters">${subs.map(x=>`<button class="fbtn" aria-pressed="${ui.filter===x}" onclick="ui.filter='${x}';render()">${x}</button>`).join("")}</div>
    ${list.length?`<div class="res">${list.map(resCard).join("")}</div>`:`<div class="empty">Hier ist noch kein Material.</div>`}`;
}
function questionsStudent(s,qs){
  qs=qs.slice().sort((a,b)=>String(b.askedAt).localeCompare(String(a.askedAt)));
  const subs=(s.subjects&&s.subjects.length?s.subjects:SUBJECTS);
  return `<div class="grid2">
    <div class="panel stack"><h2>Neue Frage notieren</h2>
      <p class="muted small">Was ist dir beim Üben unklar geblieben? Schreib es auf – du bekommst hier eine Antwort, oder wir klären es in der nächsten Stunde.</p>
      <div class="field"><label for="q-subj">Fach</label><select id="q-subj">${subs.map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div class="field"><label for="q-text">Deine Frage</label><textarea id="q-text" placeholder="z. B. Warum muss ich beim Teilen durch einen Bruch mit dem Kehrwert malnehmen?"></textarea></div>
      <button class="btn primary" onclick="askQuestion()">Frage speichern</button>
    </div>
    <div class="stack">${qs.length?qs.map(q=>qCard(q,false)).join(""):`<div class="empty">Noch keine Fragen notiert.</div>`}</div>
  </div>`;
}
function qCard(q,teacher){
  const s=student(q.studentId);
  return `<div class="q"><div class="ask">
      <div class="meta row" style="margin-bottom:6px">${subjChip(q.subject)} ${teacher&&s?`<span class="chip">${esc(s.name)}</span>`:""}<span class="tiny muted">${q.askedAt?new Date(q.askedAt).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"}):""}</span>
      ${q.answer?`<span class="chip ok">beantwortet</span>`:`<span class="chip warn">offen</span>`}</div>
      <div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(q.text)}</div></div>
    ${q.answer?`<div class="ans"><span class="label">Antwort</span>${esc(q.answer)}</div>`:""}
    ${teacher?`<div class="ans stack" style="gap:8px">
      <label class="label" for="ans-${q.id}">${q.answer?"Antwort bearbeiten":"Antworten"}</label>
      <textarea id="ans-${q.id}" placeholder="Deine Erklärung …">${q.answer?esc(q.answer):""}</textarea>
      <div class="row"><button class="btn primary sm" onclick="answerQ('${q.id}')">Antwort speichern</button><button class="btn sm ghost danger" onclick="delRow('questions','${q.id}')">Frage löschen</button></div></div>`:""}
  </div>`;
}
async function askQuestion(){
  const text=$("#q-text").value.trim(); if(!text){ toast("Schreib zuerst deine Frage auf."); return; }
  const subject=$("#q-subj").value;
  $("#q-text").value="";
  const ok=await run(sb.rpc("student_ask",{p_token:studentToken,p_subject:subject,p_text:text}),"Frage gespeichert");
  if(!ok){ const el=$("#q-text"); if(el) el.value=text; }
}
function progressView(s){
  const ls=byStudent(S.lessons,s.id).sort((a,b)=>b.date.localeCompare(a.date));
  const hw=byStudent(S.homework,s.id), done=hw.filter(h=>h.done).length;
  const per={}; ls.forEach(l=>per[l.subject]=(per[l.subject]||0)+1);
  const max=Math.max(1,...Object.values(per));
  const qs=byStudent(S.questions,s.id).length;
  return `<div class="stats">
      <div class="stat"><div class="label">Stunden</div><div class="n">${ls.length}</div></div>
      <div class="stat"><div class="label">Hausaufgaben erledigt</div><div class="n">${done}<span class="muted" style="font-size:18px"> / ${hw.length}</span></div></div>
      <div class="stat"><div class="label">Fragen gestellt</div><div class="n">${qs}</div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h2 style="margin-bottom:12px">Stunden-Log</h2>
        ${ls.length?`<div class="log">${ls.map(l=>`<div class="entry" style="--c:${col(l.subject)}"><div class="date">${fmtShort(l.date)} · ${esc(l.subject)}</div><div style="font-weight:700">${esc(l.topic)}</div>${l.notes?`<div class="muted small" style="white-space:pre-wrap">${esc(l.notes)}</div>`:""}</div>`).join("")}</div>`:`<div class="empty">Noch keine Stunden eingetragen.</div>`}
      </div>
      <div class="panel"><h2 style="margin-bottom:12px">Stunden pro Fach</h2>
        ${Object.keys(per).length?`<div class="bars">${SUBJECTS.filter(x=>per[x]).map(x=>`<div class="brow"><span>${x}</span><div class="btrack"><div class="bfill" style="width:${per[x]/max*100}%;background:${col(x)}"></div></div><span class="v">${per[x]}</span></div>`).join("")}</div>`:`<div class="empty">Noch keine Daten.</div>`}
      </div>
    </div>`;
}

/* ---------- Ansicht Lehrerin ---------- */
function teacherView(){
  const studs=S.students.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const openQ=S.questions.filter(q=>!q.answer);
  if(ui.tStudent && ui.tStudent[0]!=="_" && !student(ui.tStudent)) ui.tStudent=null;
  const side = `<aside class="side panel" style="padding:12px">
    <div class="slist">
      <button class="sbtn" aria-current="${!ui.tStudent}" onclick="pickStudent(null)"><span class="avatar">≡</span><span class="nm">Übersicht</span>${openQ.length?`<span class="pill q">${openQ.length}</span>`:""}</button>
      <button class="sbtn" aria-current="${ui.tStudent==="__mat"}" onclick="pickStudent('__mat')"><span class="avatar">▶</span><span class="nm">Material-Bibliothek</span><span class="tiny muted">${S.resources.length}</span></button>
    </div>
    <div class="divider"></div>
    <div class="label" style="padding:0 10px 6px">SchülerInnen</div>
    <div class="slist">${studs.map(s=>{const q=openQ.filter(x=>x.studentId===s.id).length;return `<button class="sbtn" aria-current="${ui.tStudent===s.id}" onclick="pickStudent('${s.id}')"><span class="avatar">${esc(initials(s.name))}</span><span class="nm">${esc(s.name)}</span>${q?`<span class="pill q" title="offene Fragen">${q}?</span>`:""}</button>`}).join("")||`<p class="tiny muted" style="padding:0 10px">Noch niemand angelegt.</p>`}
      <button class="sbtn" aria-current="${ui.tStudent==="__new"}" onclick="pickStudent('__new')"><span class="avatar">+</span><span class="nm">SchülerIn anlegen</span></button>
    </div></aside>`;
  let main;
  if(ui.tStudent==="__new") main=newStudentForm();
  else if(ui.tStudent==="__mat") main=libraryView();
  else if(ui.tStudent) main=teacherStudent(student(ui.tStudent));
  else main=overview(studs,openQ);
  return `<div class="bar"><div class="brand"><span class="logo" aria-hidden="true">✎</span>Nachhilfe-Lernraum <span class="chip">Lehrerin</span></div>
      <div class="bar-actions">${syncNote()}<button class="btn sm ghost" onclick="refresh()">Aktualisieren</button><button class="btn sm ghost" onclick="logout()">Abmelden</button></div></div>
    <div class="tlayout">${side}<main class="stack" style="gap:16px;min-width:0">${main}</main></div>`;
}
function pickStudent(id){ ui.tStudent=id; if(id && id[0]!=="_") ui.tTab="stunden"; render(); window.scrollTo({top:0}); }
function overview(studs,openQ){
  const upcoming=studs.filter(s=>s.nextAppt && new Date(s.nextAppt)>new Date(Date.now()-3*3600e3)).sort((a,b)=>a.nextAppt.localeCompare(b.nextAppt));
  const overdue=S.homework.filter(h=>!h.done && h.due && daysUntil(h.due)<0);
  return `<div><h1>Guten Tag!</h1><p class="muted" style="margin-top:4px">${studs.length} SchülerInnen · ${openQ.length} offene ${openQ.length===1?"Frage":"Fragen"} · ${overdue.length} überfällige Hausaufgaben</p></div>
  <div class="grid2">
    <div class="panel"><div class="panel-h"><h2>Nächste Termine</h2></div>
      <div class="stack">${upcoming.length?upcoming.map(s=>{const d=new Date(s.nextAppt);return `<button class="item" style="text-align:left;cursor:pointer" onclick="pickStudent('${s.id}')"><span class="avatar">${esc(initials(s.name))}</span><div class="main"><div class="t">${esc(s.name)}</div><div class="d">${WD[d.getDay()]}, ${d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})} · ${d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})} Uhr ${s.apptNote?"· "+esc(s.apptNote):""}</div></div><span class="chip">${relDays(daysUntil(s.nextAppt.slice(0,10)))}</span></button>`}).join(""):`<div class="empty">Keine Termine eingetragen.</div>`}</div></div>
    <div class="panel"><div class="panel-h"><h2>Überfällige Hausaufgaben</h2></div>
      <div class="stack">${overdue.length?overdue.map(h=>`<div class="item"><span class="stripe" style="background:${col(h.subject)}"></span><div class="main"><div class="t">${esc(h.title)}</div><div class="meta"><span class="chip">${esc(student(h.studentId)?.name||"?")}</span>${hwStatus(h)}</div></div></div>`).join(""):`<div class="empty">Nichts überfällig.</div>`}</div></div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Offene Fragen</h2></div>
    <div class="stack">${openQ.length?openQ.sort((a,b)=>String(a.askedAt).localeCompare(String(b.askedAt))).map(q=>qCard(q,true)).join(""):`<div class="empty">Alle Fragen beantwortet.</div>`}</div></div>`;
}
function newStudentForm(){
  return `<div class="panel stack"><h1>SchülerIn anlegen</h1>
    <div class="fgrid">
      <div class="field"><label for="ns-name">Name (damit loggt sie/er sich ein)</label><input id="ns-name" type="text" placeholder="Vorname Nachname"></div>
      <div class="field"><label for="ns-grade">Klasse / Schulform</label><input id="ns-grade" type="text" placeholder="z. B. 8. Klasse, Gymnasium"></div>
      <div class="field"><label for="ns-pin">PIN (4–6 Ziffern)</label><input id="ns-pin" type="text" inputmode="numeric" maxlength="6" placeholder="z. B. 4821"></div>
    </div>
    <div class="field"><label>Fächer</label><div class="checks">${SUBJECTS.map(x=>`<label><input type="checkbox" id="ns-s-${x}"> ${x}</label>`).join("")}</div></div>
    <div><button class="btn primary" onclick="createStudent()">Anlegen</button></div>
    <p class="tiny muted">Die PIN wird nur verschlüsselt gespeichert – notier sie dir. Vergessene PINs kannst du im Profil neu vergeben.</p>
  </div>`;
}
async function createStudent(){
  const name=$("#ns-name").value.trim(), pin=$("#ns-pin").value.trim();
  if(!name) return toast("Bitte einen Namen eingeben.");
  if(!/^\d{4,6}$/.test(pin)) return toast("Die PIN muss aus 4–6 Ziffern bestehen.");
  const subjects=SUBJECTS.filter(x=>$("#ns-s-"+x).checked);
  const res=await sb.rpc("teacher_create_student",{p_name:name,p_grade:$("#ns-grade").value.trim(),p_subjects:subjects,p_pin:pin});
  if(res.error){ toast(friendlyError(res.error)); return; }
  toast(name+" angelegt"); await loadTeacher(); ui.tStudent=res.data; ui.tTab="stunden"; render();
}
function teacherStudent(s){
  const hw=byStudent(S.homework,s.id).sort(sortHw), qs=byStudent(S.questions,s.id).sort((a,b)=>(!!a.answer-!!b.answer)||String(b.askedAt).localeCompare(String(a.askedAt)));
  const openQ=qs.filter(q=>!q.answer).length, openH=hw.filter(h=>!h.done).length;
  const tabs=[["stunden","Stunden & Termin"],["hausaufgaben","Hausaufgaben",openH],["fragen","Fragen",openQ],["material","Material"],["verlauf","Verlauf"],["profil","Profil"]];
  let body="";
  if(ui.tTab==="stunden") body=lessonTab(s);
  if(ui.tTab==="hausaufgaben") body=hwTab(s,hw);
  if(ui.tTab==="fragen") body=`<div class="stack">${qs.length?qs.map(q=>qCard(q,true)).join(""):`<div class="empty">${esc(firstName(s.name))} hat noch keine Fragen notiert.</div>`}</div>`;
  if(ui.tTab==="material") body=assignView(s);
  if(ui.tTab==="verlauf") body=progressView(s)+lessonAdmin(s);
  if(ui.tTab==="profil") body=profileTab(s);
  return `<div><h1>${esc(s.name)}</h1><p class="muted" style="margin-top:2px">${s.grade?esc(s.grade)+" · ":""}${(s.subjects||[]).map(subjChip).join(" ")}</p></div>
    <nav class="tabs" role="tablist" style="margin-top:6px">${tabs.map(([k,l,c])=>`<button class="tab" role="tab" aria-selected="${ui.tTab===k}" onclick="ui.tTab='${k}';render()">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("")}</nav>
    ${body}`;
}
function subjSelect(id,s,sel){ const subs=(s&&s.subjects&&s.subjects.length)?s.subjects:SUBJECTS; return `<select id="${id}">${subs.map(x=>`<option ${x===sel?"selected":""}>${x}</option>`).join("")}</select>`; }
function lessonTab(s){
  const last=byStudent(S.lessons,s.id).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
  const cur=s.nextAppt||"";
  return `<div class="grid2">
    <div class="panel stack"><h2>Stunde dokumentieren</h2>
      <div class="fgrid"><div class="field"><label for="ls-date">Datum</label><input id="ls-date" type="date" value="${today()}"></div>
        <div class="field"><label for="ls-subj">Fach</label>${subjSelect("ls-subj",s)}</div></div>
      <div class="field"><label for="ls-topic">Thema</label><input id="ls-topic" type="text" placeholder="z. B. Brüche dividieren"></div>
      <div class="field"><label for="ls-notes">Was haben wir gemacht? (sieht die/der SchülerIn)</label><textarea id="ls-notes" placeholder="Kehrwert-Regel hergeleitet, 6 Aufgaben gemeinsam, 2 allein – bei Textaufgaben noch unsicher."></textarea></div>
      <div><button class="btn primary" onclick="addLesson('${s.id}')">Stunde speichern</button></div>
      ${last.length?`<div class="divider"></div><div class="label">Zuletzt</div>${last.map(l=>`<div class="small"><strong>${fmtShort(l.date)}</strong> · ${esc(l.subject)} · ${esc(l.topic)}</div>`).join("")}`:""}
    </div>
    <div class="stack" style="gap:16px">
      ${nextCard(s,true)}
      <div class="panel stack"><h2>Nächsten Termin setzen</h2>
        <div class="field"><label for="ap-when">Datum & Uhrzeit</label><input id="ap-when" type="datetime-local" value="${esc(cur)}"></div>
        <div class="field"><label for="ap-note">Hinweis (optional)</label><input id="ap-note" type="text" value="${esc(s.apptNote||"")}" placeholder="z. B. online per Zoom / Heft mitbringen"></div>
        <div class="row"><button class="btn primary" onclick="setAppt('${s.id}')">Termin speichern</button>${cur?`<button class="btn ghost" onclick="clearAppt('${s.id}')">Termin entfernen</button>`:""}</div>
      </div>
    </div></div>`;
}
async function addLesson(sid){
  const topic=$("#ls-topic").value.trim(); if(!topic) return toast("Bitte ein Thema eintragen.");
  const row={student_id:sid,date:$("#ls-date").value||today(),subject:$("#ls-subj").value,topic,notes:$("#ls-notes").value.trim()};
  if(await run(sb.from("lessons").insert(row),"Stunde gespeichert")){ ["ls-topic","ls-notes"].forEach(i=>{ const el=$("#"+i); if(el) el.value=""; }); }
}
async function setAppt(sid){
  const v=$("#ap-when").value; if(!v) return toast("Bitte Datum und Uhrzeit wählen.");
  await run(sb.from("students").update({next_appt:new Date(v).toISOString(),appt_note:$("#ap-note").value.trim()}).eq("id",sid),"Termin gespeichert");
}
async function clearAppt(sid){ await run(sb.from("students").update({next_appt:null,appt_note:""}).eq("id",sid),"Termin entfernt"); }
function hwTab(s,hw){
  const res=resourcesFor(s.id);
  return `<div class="grid2">
    <div class="panel stack"><h2>Hausaufgabe stellen</h2>
      <div class="field"><label for="hw-title">Aufgabe</label><input id="hw-title" type="text" placeholder="z. B. Buch S. 54, Nr. 3a–f"></div>
      <div class="field"><label for="hw-desc">Hinweise (optional)</label><textarea id="hw-desc" placeholder="Erst das Video schauen, dann die Aufgaben. Rechenweg aufschreiben!"></textarea></div>
      <div class="fgrid"><div class="field"><label for="hw-subj">Fach</label>${subjSelect("hw-subj",s)}</div>
        <div class="field"><label for="hw-due">Fällig bis</label><input id="hw-due" type="date" value="${(s.nextAppt||"").slice(0,10)}"></div></div>
      <div class="field"><label for="hw-res">Material verknüpfen (optional)</label><select id="hw-res"><option value="">– keins –</option>${res.map(r=>`<option value="${r.id}">${esc(r.subject)} · ${esc(r.title)}</option>`).join("")}</select></div>
      <div><button class="btn primary" onclick="addHw('${s.id}')">Aufgabe stellen</button></div>
    </div>
    <div>${hwList(hw,true)}</div></div>`;
}
async function addHw(sid){
  const title=$("#hw-title").value.trim(); if(!title) return toast("Bitte die Aufgabe beschreiben.");
  const row={student_id:sid,title,description:$("#hw-desc").value.trim(),subject:$("#hw-subj").value,due:$("#hw-due").value||null,resource_id:$("#hw-res").value||null};
  if(await run(sb.from("homework").insert(row),"Hausaufgabe gestellt")){ ["hw-title","hw-desc"].forEach(i=>{ const el=$("#"+i); if(el) el.value=""; }); }
}
async function answerQ(id){
  const a=$("#ans-"+id).value.trim(); if(!a) return toast("Die Antwort ist noch leer.");
  await run(sb.from("questions").update({answer:a,answered_at:new Date().toISOString(),seen:false}).eq("id",id),"Antwort gespeichert");
}
const pending={};
function confirmDel(id){ if(pending[id]){ delete pending[id]; return true; } pending[id]=1; toast("Zum Löschen nochmal klicken."); setTimeout(()=>delete pending[id],3500); return false; }
async function delRow(table,id){ if(!confirmDel(id)) return; await run(sb.from(table).delete().eq("id",id),"Gelöscht"); }
function lessonAdmin(s){
  const ls=byStudent(S.lessons,s.id).sort((a,b)=>b.date.localeCompare(a.date));
  if(!ls.length) return "";
  return `<details class="box" style="margin-top:16px"><summary>Stunden-Einträge bearbeiten</summary><div class="inner stack">${ls.map(l=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line-2);padding-bottom:6px"><span class="small"><strong>${fmtShort(l.date)}</strong> · ${esc(l.subject)} · ${esc(l.topic)}</span><button class="btn sm ghost danger" onclick="delRow('lessons','${l.id}')">Löschen</button></div>`).join("")}</div></details>`;
}
function resForm(prefix){
  return `<div class="panel stack"><h2>Material hinzufügen</h2>
    <div class="field"><label for="${prefix}-title">Titel</label><input id="${prefix}-title" type="text" placeholder="z. B. Brüche dividieren einfach erklärt"></div>
    <div class="field"><label for="${prefix}-url">Link (YouTube, Arbeitsblatt, Übungsseite …)</label><input id="${prefix}-url" type="url" placeholder="https://"></div>
    <div class="fgrid"><div class="field"><label for="${prefix}-kind">Art</label><select id="${prefix}-kind"><option value="video">Erklärvideo</option><option value="aufgabe">Übung / Arbeitsblatt</option><option value="link">Sonstiger Link</option></select></div>
      <div class="field"><label for="${prefix}-subj">Fach</label>${subjSelect(prefix+"-subj",null)}</div></div>
    <div class="field"><label for="${prefix}-note">Kurzer Hinweis (optional)</label><input id="${prefix}-note" type="text" placeholder="z. B. ab Minute 2:30 wichtig"></div>
    <div class="field"><label>Sichtbar für</label><div class="checks"><label><input type="checkbox" id="${prefix}-all" ${prefix==="lib"?"checked":""}> Alle</label>${S.students.map(s=>`<label><input type="checkbox" id="${prefix}-st-${s.id}" ${prefix!=="lib"&&ui.tStudent===s.id?"checked":""}> ${esc(s.name)}</label>`).join("")}</div></div>
    <div><button class="btn primary" onclick="addRes('${prefix}')">Material speichern</button></div>
  </div>`;
}
async function addRes(p){
  const title=$("#"+p+"-title").value.trim(), u=url($("#"+p+"-url").value.trim());
  if(!title) return toast("Bitte einen Titel eingeben.");
  if(!u) return toast("Bitte einen gültigen Link mit https:// eingeben.");
  const all=$("#"+p+"-all").checked;
  const ids=all?[]:S.students.filter(s=>$("#"+p+"-st-"+s.id)?.checked).map(s=>s.id);
  if(!all && !ids.length) return toast("Wähle aus, wer das Material sehen soll.");
  const row={title,url:u,kind:$("#"+p+"-kind").value,subject:$("#"+p+"-subj").value,note:$("#"+p+"-note").value.trim(),student_ids:ids};
  if(await run(sb.from("resources").insert(row),"Material gespeichert")){ ["title","url","note"].forEach(i=>{ const el=$("#"+p+"-"+i); if(el) el.value=""; }); }
}
function resRow(r){
  const who=!r.studentIds||!r.studentIds.length?"Alle":r.studentIds.map(id=>student(id)?.name).filter(Boolean).join(", ");
  const u=url(r.url);
  return `<div class="item"><span class="stripe" style="background:${col(r.subject)}"></span><div class="main"><div class="t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(r.title)}</a>`:esc(r.title)}</div>
    <div class="meta"><span class="chip">${KINDS[r.kind]||"Link"}</span>${subjChip(r.subject)}<span class="tiny muted">für: ${esc(who)}</span></div></div>
    <button class="btn sm ghost danger" aria-label="Löschen" onclick="delRow('resources','${r.id}')">✕</button></div>`;
}
function libraryView(){
  const list=S.resources.slice().sort((a,b)=>String(b.created||"").localeCompare(String(a.created||"")));
  return `<h1>Material-Bibliothek</h1><div class="grid2">${resForm("lib")}<div class="stack">${list.length?list.map(resRow).join(""):`<div class="empty">Noch kein Material.</div>`}</div></div>`;
}
function assignView(s){
  const list=resourcesFor(s.id).sort((a,b)=>String(b.created||"").localeCompare(String(a.created||"")));
  return `<div class="grid2">${resForm("sm")}<div class="stack"><div class="label">Sieht ${esc(firstName(s.name))} (${list.length})</div>${list.length?list.map(resRow).join(""):`<div class="empty">Noch kein Material.</div>`}</div></div>`;
}
function profileTab(s){
  return `<div class="grid2"><div class="panel stack"><h2>Profil</h2>
      <div class="field"><label for="pf-name">Name (Login-Name)</label><input id="pf-name" type="text" value="${esc(s.name)}"></div>
      <div class="field"><label for="pf-grade">Klasse / Schulform</label><input id="pf-grade" type="text" value="${esc(s.grade||"")}"></div>
      <div class="field"><label>Fächer</label><div class="checks">${SUBJECTS.map(x=>`<label><input type="checkbox" id="pf-s-${x}" ${(s.subjects||[]).includes(x)?"checked":""}> ${x}</label>`).join("")}</div></div>
      <div><button class="btn primary" onclick="saveProfile('${s.id}')">Speichern</button></div></div>
    <div class="stack" style="gap:16px"><div class="panel stack"><h2>Neue PIN vergeben</h2>
      <p class="muted small">Entsperrt das Profil auch nach zu vielen Fehlversuchen und meldet alle Geräte ab.</p>
      <div class="field"><label for="pf-pin">Neue PIN (4–6 Ziffern)</label><input id="pf-pin" type="text" inputmode="numeric" maxlength="6"></div>
      <div><button class="btn" onclick="resetPin('${s.id}')">PIN ändern</button></div></div>
      <div class="panel stack"><h2>SchülerIn löschen</h2><p class="muted small">Löscht das Profil mit allen Stunden, Hausaufgaben und Fragen endgültig.</p>
      <div><button class="btn danger" onclick="removeStudent('${s.id}')">Endgültig löschen</button></div></div></div></div>`;
}
async function saveProfile(id){
  const name=$("#pf-name").value.trim(); if(!name) return toast("Der Name darf nicht leer sein.");
  await run(sb.from("students").update({name,grade:$("#pf-grade").value.trim(),subjects:SUBJECTS.filter(x=>$("#pf-s-"+x).checked)}).eq("id",id),"Profil gespeichert");
}
async function resetPin(id){
  const pin=$("#pf-pin").value.trim(); if(!/^\d{4,6}$/.test(pin)) return toast("Die PIN muss aus 4–6 Ziffern bestehen.");
  if(await run(sb.rpc("teacher_set_pin",{p_student:id,p_pin:pin}),"PIN geändert")){ const el=$("#pf-pin"); if(el) el.value=""; }
}
async function removeStudent(id){ if(!confirmDel(id)) return; if(await run(sb.from("students").delete().eq("id",id),"Gelöscht")){ ui.tStudent=null; render(); } }
