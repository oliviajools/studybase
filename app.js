/* Nachhilfe-Lernraum – eigenständige Web-App (Supabase-Backend) */
"use strict";

const SUBJECTS = ["Mathe","Deutsch","Englisch","Bio","Chemie","Geschichte"];
const SVAR = {Mathe:"--s-mathe",Deutsch:"--s-deutsch",Englisch:"--s-englisch",Bio:"--s-bio",Chemie:"--s-chemie",Geschichte:"--s-geschichte"};
const KINDS = {video:"Erklärvideo", link:"Link", aufgabe:"Übung"};
const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const TOKEN_KEY = "lernraum.token";

let sb = null;               // Supabase-Client
let teacherUser = null;      // eingeloggte Lehrerin (Supabase-Auth)
let studentToken = null;     // Sitzungs-Token einer/eines SchülerIn
const S = {students:[], lessons:[], homework:[], questions:[], resources:[], loaded:false};
const ui = {
  mode:"login", loginAs:"student", studentId:null, tab:"start", filter:"Alle",
  tStudent:null, tTab:"stunden", loginErr:"", busy:false, lastSync:null, ex:null, openPack:"", reviewReady:false, tasksReady:false
};

/* ---------- Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const col = s => `var(${SVAR[s]||"--ink-3"})`;
const subjChip = s => s ? `<span class="chip subj" style="--c:${col(s)}">${esc(s)}</span>` : "";
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
function toast(msg, bad){
  const old=$("#toast"); const t=old.cloneNode(false);        // neu einsetzen = Animation startet neu
  t.textContent=msg; t.className="toast"+(bad?" bad":""); t.hidden=false; old.replaceWith(t);
  clearTimeout(toast._t); toast._t=setTimeout(()=>{ const x=$("#toast"); if(x) x.hidden=true; },2800);
}
/* Hell/Dunkel */
function applyTheme(){ const t=load("lernraum.theme"); if(t==="light") document.documentElement.dataset.theme="light"; else document.documentElement.removeAttribute("data-theme"); }
function toggleTheme(){ store("lernraum.theme", document.documentElement.dataset.theme==="light" ? null : "light"); applyTheme(); render(); }
applyTheme();
const ICON = {
  logo:`<svg class="logo" viewBox="0 0 26 26" fill="none" aria-hidden="true"><circle cx="13" cy="13" r="11.5" stroke="currentColor" stroke-width="1.2"/><path d="M13 1.5A11.5 11.5 0 0 1 24.5 13" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="13" r="2.2" fill="currentColor"/></svg>`,
  check:`<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3 5 8.7 9.7 3.6"/></svg>`,
  theme:`<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>`
};
function brand(extra){ return `<div class="brand">${ICON.logo}<span>studybase</span><small>${extra||"Nachhilfe-Lernraum"}</small></div>`; }
function themeBtn(){ return `<button class="btn ghost icon" onclick="toggleTheme()" aria-label="Hell/Dunkel umschalten" title="Hell/Dunkel">${ICON.theme}</button>`; }
function todayLabel(){ const d=new Date(); return `${WD[d.getDay()]} · ${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; }
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
const mapStudent = r => ({id:r.id, name:r.name, grade:r.grade||"", subjects:r.subjects||[], nextAppt:toLocalInput(r.next_appt), apptNote:r.appt_note||"", recordingConsent:!!r.recording_consent, autoHomework:!!r.auto_homework});
const mapLesson = (r,sid) => ({id:r.id, studentId:r.student_id||sid, date:r.date, subject:r.subject, topic:r.topic, notes:r.notes||"", created:r.created_at,
  transcript:r.transcript||"", reviewStatus:r.review_status||"none", reviewError:r.review_error||"", summary:r.summary||"", practice:Array.isArray(r.practice)?r.practice:[],
  review:r.review||null, published:!!r.review_published, duration:r.duration_sec||0});
const mapHw = (r,sid) => ({id:r.id, studentId:r.student_id||sid, title:r.title, description:r.description||"", subject:r.subject, due:r.due||"", resourceId:r.resource_id||"", done:!!r.done,
  exercises:Array.isArray(r.exercises)?r.exercises:[], weakness:r.weakness||"", fromLesson:r.from_lesson||""});
const mapQ = (r,sid) => ({id:r.id, studentId:r.student_id||sid, subject:r.subject, text:r.text, askedAt:r.asked_at, answer:r.answer||"", seen:!!r.seen});
const mapRes = r => ({id:r.id, title:r.title, url:r.url, kind:r.kind, subject:r.subject, note:r.note||"", studentIds:r.student_ids||[], created:r.created_at});

/* ---------- Laden ---------- */
async function loadTeacher(){
  const cols = "id,name,grade,subjects,next_appt,appt_note";
  let st = await sb.from("students").select(cols+",recording_consent,auto_homework").order("name");
  ui.reviewReady = ui.tasksReady = !st.error;
  if(st.error){                                             // tasks.sql noch nicht ausgeführt?
    st = await sb.from("students").select(cols+",recording_consent").order("name");
    ui.reviewReady = !st.error;
    if(st.error) st = await sb.from("students").select(cols).order("name");   // auch review.sql fehlt
  }
  const [le,hw,qu,re] = await Promise.all([
    sb.from("lessons").select("*"),
    sb.from("homework").select("*"),
    sb.from("questions").select("*"),
    sb.from("resources").select("*")
  ]);
  const err = [st,le,hw,qu,re].find(x=>x.error);
  if(err){ console.error(err.error); toast("Daten konnten nicht geladen werden.", true); return; }
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
  setSaving(1);
  let res; try{ res = await promise; }catch(e){ res={error:e}; }
  setSaving(-1);
  if(res && res.error){ console.error(res.error); toast(friendlyError(res.error), true); return false; }
  if(res && res.data===false){ toast("Das hat nicht geklappt. Bitte neu einloggen und nochmal versuchen.", true); return false; }
  if(okMsg) toast(okMsg);
  await refresh();
  return true;
}
let savingN=0;
function setSaving(d){ savingN=Math.max(0,savingN+d); const el=$("#sync"); if(el){ el.classList.toggle("saving",savingN>0); el.lastChild.textContent = savingN>0 ? "speichert…" : syncText(); } }
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
  return `<div class="bar">${brand()}</div>
  <div class="login setup" style="max-width:640px;justify-self:start">
    <div class="panel"><div class="eyebrow">Einrichtung</div><h1 style="font-size:56px">Fast <em>fertig.</em></h1>
      <p class="muted">Der Lernraum ist noch nicht mit einer Datenbank verbunden.</p>
      <ol>
        <li>Kostenloses Projekt auf <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> anlegen.</li>
        <li>Im SQL-Editor den Inhalt von <code>supabase/schema.sql</code> ausführen.</li>
        <li>Unter <em>Authentication → Users</em> deinen Lehrerinnen-Account anlegen und neue Registrierungen ausschalten.</li>
        <li>In <code>config.js</code> Project URL und Publishable key eintragen.</li>
      </ol></div></div>`;
}
/* ---------- Rendern ---------- */
let lastKey="";
function render(){
  const app=$("#app");
  const key=[ui.mode,ui.loginAs,ui.studentId,ui.tab,ui.tStudent,ui.tTab,ui.ex?"ex"+ui.ex.hw+ui.ex.i+ui.ex.hint+ui.ex.sol:"",ui.openPack].join("|");
  const changed = key!==lastKey;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = () => {
    const ae=document.activeElement, focusId=ae&&ae.id?ae.id:null;
    let selS=null, selE=null; try{ selS=ae.selectionStart; selE=ae.selectionEnd; }catch(e){}
    const drafts={};
    if(!changed) app.querySelectorAll("input[id],textarea[id],select[id]").forEach(el=>{ drafts[el.id]= el.type==="checkbox"?el.checked:el.value; });
    lastKey=key;
    let html;
    if(ui.mode==="teacher" && teacherUser) html = teacherView();
    else if(ui.mode==="student" && student(ui.studentId)) html = studentView(student(ui.studentId));
    else { ui.mode="login"; html = loginView(); }
    app.innerHTML = html;
    for(const [id,v] of Object.entries(drafts)){ const el=document.getElementById(id); if(!el) continue; if(el.type==="checkbox") el.checked=v; else el.value=v; }
    if(focusId && !changed){ const el=document.getElementById(focusId); if(el){ el.focus({preventScroll:true}); try{ if(selS!=null) el.setSelectionRange(selS,selE); }catch(e){} } }
    if(changed && !reduce && !ui.ex){
      // gestaffeltes Einblenden der Inhalte
      app.querySelectorAll(".hero, .next, .tabs, .stats, .panel, .item, .rcard, .q, .login-copy > *, .login").forEach((el,i)=>{ if(i<28){ el.classList.add("rv"); el.style.setProperty("--i", i); } });
      app.classList.remove("enter"); void app.offsetWidth; app.classList.add("enter");
      clearTimeout(render._t); render._t=setTimeout(()=>app.classList.remove("enter"), 2600);
    }
    tickCountdown();
  };
  if(changed && lastKey && !reduce && document.startViewTransition) document.startViewTransition(paint);
  else paint();
}
function syncText(){ return ui.lastSync ? "sync " + ui.lastSync.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}) : "verbunden"; }
function syncNote(){ return `<span class="sync${savingN>0?" saving":""}" id="sync"><i></i>${savingN>0?"speichert…":syncText()}</span>`; }
/* ---------- Login ---------- */
function loginView(){
  const teacher = ui.loginAs==="teacher";
  return `
  <div class="bar">${brand()}<div class="bar-actions">${themeBtn()}</div></div>
  <div class="login-wrap">
    <div class="login-copy">
      <div class="eyebrow">${todayLabel()}</div>
      <h1 style="margin-top:22px">Lernen<br>zwischen den <em>Stunden.</em></h1>
      <p>Dein nächster Termin, deine Aufgaben, Erklärvideos und Antworten auf deine Fragen – an einem ruhigen Ort.</p>
      <div class="facts">
        <div><b>6</b><span class="label">Fächer</span></div>
        <div><b>1</b><span class="label">Ort für alles</span></div>
        <div><b>24/7</b><span class="label">Fragen notieren</span></div>
      </div>
    </div>
    <div class="login">
      <div class="panel">
        <div class="seg" data-pos="${teacher?1:0}" role="group" aria-label="Login-Art">
          <button aria-pressed="${!teacher}" onclick="switchLogin('student')">SchülerIn</button>
          <button aria-pressed="${teacher}" onclick="switchLogin('teacher')">Lehrerin</button>
        </div>
        ${teacher ? `
          <div class="field"><label for="lg-mail">E-Mail</label><input id="lg-mail" type="email" autocomplete="username"></div>
          <div class="field"><label for="lg-pw">Passwort</label><input id="lg-pw" type="password" autocomplete="current-password"></div>`
        : `
          <div class="field"><label for="lg-name">Dein Name</label><input id="lg-name" type="text" autocomplete="username" placeholder="Vorname Nachname"></div>
          <div class="field"><label for="lg-pin">PIN</label><input id="lg-pin" type="password" inputmode="numeric" maxlength="6" class="pin" autocomplete="off" placeholder="••••"></div>`}
        ${ui.loginErr?`<p class="err" role="alert">${esc(ui.loginErr)}</p>`:""}
        <button class="btn primary" style="padding:13px 18px" onclick="${teacher?"teacherLogin()":"studentLogin()"}" ${ui.busy?"disabled":""}>${ui.busy?"Einen Moment …":"Einloggen"} <span class="arr">→</span></button>
        <p class="tiny muted">${teacher?"Nur für die Nachhilfelehrerin.":"Name und PIN bekommst du von deiner Nachhilfelehrerin."}</p>
      </div>
    </div>
  </div>`;
}
function switchLogin(to){
  if(ui.loginAs===to) return;
  ui.loginAs=to; ui.loginErr="";
  const seg=document.querySelector(".seg"); if(seg) seg.dataset.pos = to==="teacher"?1:0;   // Schieber gleitet zuerst
  setTimeout(render, 180);
}
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
  if(!email || !password){ ui.loginErr="Bitte E-Mail und Passwort eingeben."; return render(); }
  ui.busy=true; render();
  const {data, error} = await sb.auth.signInWithPassword({email, password});
  ui.busy=false;
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
    return `<div class="next empty-appt"><div class="label">Nächste Stunde</div><div class="when" style="font-size:34px;color:var(--ink-2)">${teacher?"Noch kein Termin.":"Termin folgt."}</div>
      <div class="sub">${teacher?"Rechts kannst du den nächsten Termin setzen.":"Deine Lehrerin trägt den nächsten Termin bald ein."}</div></div>`;
  }
  const d=new Date(a); const n=daysUntil(a.slice(0,10));
  const time=d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
  return `<div class="next">
    <div><div class="label">Nächste Stunde · ${relDays(n)}</div>
      <div class="when">${WD[d.getDay()]}, <em>${d.getDate()}. ${MONTHS[d.getMonth()]}</em> · ${time}</div>
      ${s.apptNote?`<div class="sub">${esc(s.apptNote)}</div>`:""}</div>
    <div class="count-down" data-countdown="${esc(a)}" aria-label="Zeit bis zur nächsten Stunde"></div>
  </div>`;
}
/* Live-Countdown: Tage / Std / Min, aktualisiert sich jede halbe Minute */
function tickCountdown(){
  document.querySelectorAll("[data-countdown]").forEach(el=>{
    let ms=Math.max(0,new Date(el.dataset.countdown)-Date.now());
    const d=Math.floor(ms/864e5); ms-=d*864e5; const h=Math.floor(ms/36e5); ms-=h*36e5; const m=Math.floor(ms/6e4);
    el.innerHTML=`<div><b>${pad(d)}</b><span>Tage</span></div><div><b>${pad(h)}</b><span>Std</span></div><div><b>${pad(m)}</b><span>Min</span></div>`;
  });
}
setInterval(tickCountdown, 30000);
function studentView(s){
  const hw=byStudent(S.homework,s.id).sort(sortHw), open=hw.filter(h=>!h.done);
  const qs=byStudent(S.questions,s.id), newAns=qs.filter(q=>q.answer && !q.seen).length;
  const tabs=[["start","Übersicht"],["aufgaben","Aufgaben",open.length],["material","Material"],["fragen","Fragen",newAns],["verlauf","Verlauf"]];
  let body="";
  if(ui.tab==="start") body=studentStart(s,open,qs);
  if(ui.tab==="aufgaben") body=hwList(hw,false);
  if(ui.tab==="material") body=materialView(s);
  if(ui.tab==="fragen") body=questionsStudent(s,qs);
  if(ui.tab==="verlauf") body=progressView(s);
  const greet = (()=>{ const h=new Date().getHours(); return h<11?"Guten Morgen,":h<18?"Hi":"Guten Abend,"; })();
  return `
  <div class="bar">${brand()}
    <div class="bar-actions">${syncNote()}${themeBtn()}<button class="btn sm" onclick="logout()">Abmelden</button></div></div>
  <div class="hero">
    <div class="eyebrow">${todayLabel()}</div>
    <h1>${greet} <em>${esc(firstName(s.name))}.</em></h1>
    <div class="sub">${s.grade?`<span>${esc(s.grade)}</span>`:""}${(s.subjects||[]).map(subjChip).join("")}</div>
  </div>
  <nav class="tabs" role="tablist">${tabs.map(([k,l,c])=>`<button class="tab" role="tab" aria-selected="${ui.tab===k}" onclick="setTab('${k}')">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("")}</nav>
  ${body}
  ${practiceSheet()}`;
}

/* ---------- Übungsmodus: eine Aufgabe nach der anderen ---------- */
function openPractice(hwId){ ui.ex={hw:hwId, i:0, hint:false, sol:false}; render(); }
function closePractice(){ ui.ex=null; render(); }
function exStep(d){
  const h=S.homework.find(x=>x.id===ui.ex.hw); if(!h) return closePractice();
  const i=Math.min(h.exercises.length-1, Math.max(0, ui.ex.i+d));
  ui.ex={hw:ui.ex.hw, i, hint:false, sol:false}; render();
}
async function finishPractice(){
  const id=ui.ex.hw; ui.ex=null; render();
  const h=S.homework.find(x=>x.id===id);
  if(h && !h.done) await toggleHw(id); else render();
}
function practiceSheet(){
  if(!ui.ex) return "";
  const h=S.homework.find(x=>x.id===ui.ex.hw);
  if(!h || !h.exercises.length) return "";
  const e=h.exercises[ui.ex.i], n=h.exercises.length, last=ui.ex.i===n-1;
  return `<div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="Übungsaufgaben">
    <div class="sheet-bg" onclick="closePractice()"></div>
    <div class="sheet">
      <div class="sheet-head"><div><div class="label">${esc(h.title)}</div>${h.weakness?`<div class="tiny muted" style="margin-top:4px">Übt: ${esc(h.weakness)}</div>`:""}</div>
        <button class="btn ghost icon" onclick="closePractice()" aria-label="Schließen">✕</button></div>
      <div class="sheet-dots">${h.exercises.map((_,i)=>`<span class="${i<ui.ex.i?"ok":i===ui.ex.i?"now":""}"></span>`).join("")}</div>
      <div class="sheet-body">
        <div class="label">Aufgabe ${pad(ui.ex.i+1)} von ${pad(n)}</div>
        <p class="ex-q">${esc(e.question)}</p>
        ${ui.ex.hint&&e.hint?`<div class="ex-hint"><span class="label">Tipp</span>${esc(e.hint)}</div>`:""}
        ${ui.ex.sol?`<div class="ex-sol"><span class="label">Lösung</span>${esc(e.solution)}</div>`:""}
      </div>
      <div class="sheet-actions">
        ${e.hint&&!ui.ex.hint?`<button class="btn sm ghost" onclick="ui.ex.hint=true;render()">Tipp</button>`:""}
        ${!ui.ex.sol?`<button class="btn sm" onclick="ui.ex.sol=true;render()">Lösung zeigen</button>`:""}
        <span style="flex:1"></span>
        ${ui.ex.i>0?`<button class="btn sm ghost" onclick="exStep(-1)">Zurück</button>`:""}
        ${last?`<button class="btn primary sm" onclick="finishPractice()">Fertig & abhaken <span class="arr">→</span></button>`
              :`<button class="btn primary sm" onclick="exStep(1)">Weiter <span class="arr">→</span></button>`}
      </div>
    </div></div>`;
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
  return `<div class="stack" style="gap:18px">
    ${nextCard(s)}
    <div class="grid2">
      <div class="panel"><div class="panel-h"><h2>Bis zur nächsten Stunde <span class="label">${pad(open.length)}</span></h2><button class="btn sm ghost" onclick="setTab('aufgaben')">Alle →</button></div>
        <div class="stack">${open.length?hwItems(open.slice(0,4),false):`<div class="empty">Keine offenen Aufgaben. Stark.</div>`}</div></div>
      <div class="stack" style="gap:18px">
        ${ans.length?`<div class="panel"><div class="label">Neue Antwort${ans.length>1?"en":""}</div><h3 style="margin-top:10px">Deine Lehrerin hat ${ans.length===1?"eine Frage":ans.length+" Fragen"} beantwortet.</h3><div style="margin-top:16px"><button class="btn primary sm" onclick="setTab('fragen')">Lesen <span class="arr">→</span></button></div></div>`:""}
        ${last?`<div class="panel"><div class="label">Letzte Stunde · ${fmtDate(last.date)}</div><h3 style="margin-top:10px;font-family:var(--serif);font-size:30px;font-weight:400;line-height:1.05">${esc(last.topic)}</h3>${last.summary?`<p class="small" style="margin-top:10px;white-space:pre-wrap">${esc(last.summary)}</p>`:""}${last.notes?`<p class="muted small" style="margin-top:10px;white-space:pre-wrap">${esc(last.notes)}</p>`:""}<div class="row" style="margin-top:14px">${subjChip(last.subject)}</div></div>`:""}
        ${last&&last.practice&&last.practice.length?`<div class="panel"><div class="label">Zum Üben · aus der letzten Stunde</div><div class="stack" style="margin-top:14px">${last.practice.map(p=>`<div class="item"><span class="stripe" style="--c:${col(last.subject)}"></span><div class="main"><div class="t">${esc(p.title)}</div><div class="d">${esc(p.description||"")}</div></div></div>`).join("")}</div></div>`:""}
        <div class="panel"><div class="panel-h"><h2>Neu im Material</h2><button class="btn sm ghost" onclick="setTab('material')">Alles →</button></div>
          <div class="stack">${recent.length?recent.map(resCard).join(""):`<div class="empty">Noch kein Material.</div>`}</div></div>
      </div>
    </div></div>`;
}
function hwItems(list,teacher){
  return list.map(h=>{
    const res = h.resourceId ? S.resources.find(r=>r.id===h.resourceId) : null;
    return `<div class="item ${h.done?"done":""}" data-hw="${h.id}">
      ${teacher?`<span class="stripe" style="--c:${col(h.subject)}"></span>`:`<button class="tick ${h.done?"on":""}" aria-pressed="${h.done}" aria-label="${h.done?"Als offen markieren":"Als erledigt markieren"}" onclick="toggleHw('${h.id}')">${ICON.check}</button>`}
      <div class="main"><div class="t">${esc(h.title)}</div>
        ${h.description?`<div class="d">${esc(h.description)}</div>`:""}
        <div class="meta">${subjChip(h.subject)} ${hwStatus(h)} ${res&&url(res.url)?`<a class="chip" href="${esc(url(res.url))}" target="_blank" rel="noopener">${KINDS[res.kind]||"Link"} ↗</a>`:""}
          ${h.exercises&&h.exercises.length?(teacher?`<span class="chip">${h.exercises.length} ${h.exercises.length===1?"Aufgabe":"Aufgaben"}</span>`:`<button class="btn sm" onclick="openPractice('${h.id}')">Üben · ${h.exercises.length} ${h.exercises.length===1?"Aufgabe":"Aufgaben"} <span class="arr">→</span></button>`):""}</div></div>
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
/* Optimistisch: sofort abhaken, im Hintergrund speichern, bei Fehler zurücksetzen */
async function toggleHw(id){
  const h=S.homework.find(x=>x.id===id); if(!h) return;
  const done=!h.done; h.done=done;
  const el=document.querySelector(`[data-hw="${id}"]`);
  if(el){ el.classList.toggle("done",done); const t=el.querySelector(".tick"); if(t){ t.classList.toggle("on",done); t.setAttribute("aria-pressed",done); } }
  if(done) toast("Abgehakt");
  ui.busy=true; setSaving(1);
  const res = teacherUser
    ? await sb.from("homework").update({done, done_at: done?new Date().toISOString():null}).eq("id",id)
    : await sb.rpc("student_toggle_homework",{p_token:studentToken,p_homework:id,p_done:done});
  setSaving(-1); ui.busy=false;
  if(res.error || res.data===false){ h.done=!done; toast("Konnte nicht gespeichert werden.", true); }
  setTimeout(()=>{ render(); }, 450);   // sanft neu sortieren, nachdem der Haken gezeichnet ist
}
function resCard(r){
  const u=url(r.url);
  return `<a class="rcard" ${u?`href="${esc(u)}" target="_blank" rel="noopener"`:""}>
    <div class="rkind"><span class="dot" style="background:${col(r.subject)}"></span>${KINDS[r.kind]||"Link"} · ${esc(r.subject||"")}</div>
    <span class="go" aria-hidden="true">→</span>
    <div class="rt">${esc(r.title)}</div>
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
      <div class="row" style="margin-bottom:12px">${subjChip(q.subject)} ${teacher&&s?`<span class="chip">${esc(s.name)}</span>`:""}<span class="label">${q.askedAt?new Date(q.askedAt).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"}):""}</span>
      ${q.answer?`<span class="chip ok">beantwortet</span>`:`<span class="chip warn">offen</span>`}</div>
      <div class="qt">${esc(q.text)}</div></div>
    ${q.answer?`<div class="ans"><span class="label">Antwort</span>${esc(q.answer)}</div>`:""}
    ${teacher?`<div class="ans stack" style="gap:10px">
      <label class="label" for="ans-${q.id}">${q.answer?"Antwort bearbeiten":"Antworten"}</label>
      <textarea id="ans-${q.id}" placeholder="Deine Erklärung …">${q.answer?esc(q.answer):""}</textarea>
      <div class="row"><button class="btn primary sm" onclick="answerQ('${q.id}')">Antwort senden <span class="arr">→</span></button><button class="btn sm ghost danger" onclick="delRow('questions','${q.id}')">Frage löschen</button></div></div>`:""}
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
  const entry = l => `<div class="entry" style="--c:${col(l.subject)}"><div class="date">${fmtShort(l.date)} · ${esc(l.subject)}</div><div class="tt">${esc(l.topic)}</div>
      ${l.notes?`<div class="muted small" style="white-space:pre-wrap;margin-top:4px">${esc(l.notes)}</div>`:""}
      ${l.summary&&(l.published||!teacherUser)?`<div class="small" style="margin-top:8px;white-space:pre-wrap">${esc(l.summary)}</div>`:""}
      ${l.practice&&l.practice.length&&(l.published||!teacherUser)?`<div class="practice-mini">${l.practice.map(p=>`<span class="chip">✎ ${esc(p.title)}</span>`).join("")}</div>`:""}</div>`;
  return `<div class="stats">
      <div class="stat"><div class="label">Stunden</div><div class="n">${ls.length}</div></div>
      <div class="stat"><div class="label">Aufgaben erledigt</div><div class="n">${done}<small> / ${hw.length}</small></div></div>
      <div class="stat"><div class="label">Fragen gestellt</div><div class="n">${qs}</div></div>
    </div>
    <div class="grid2">
      <div class="panel"><div class="panel-h"><h2>Stunden-Log</h2></div>
        ${ls.length?`<div class="log">${ls.map(entry).join("")}</div>`:`<div class="empty">Noch keine Stunden eingetragen.</div>`}
      </div>
      <div class="panel"><div class="panel-h"><h2>Stunden pro Fach</h2></div>
        ${Object.keys(per).length?`<div class="bars">${SUBJECTS.filter(x=>per[x]).map((x,i)=>`<div class="brow"><span>${x}</span><div class="btrack"><div class="bfill" style="width:${per[x]/max*100}%;background:${col(x)};animation-delay:${i*80}ms"></div></div><span class="v">${per[x]}</span></div>`).join("")}</div>`:`<div class="empty">Noch keine Daten.</div>`}
      </div>
    </div>`;
}
/* ---------- Ansicht Lehrerin ---------- */
function teacherView(){
  const studs=S.students.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const openQ=S.questions.filter(q=>!q.answer);
  if(ui.tStudent && ui.tStudent[0]!=="_" && !student(ui.tStudent)) ui.tStudent=null;
  const side = `<aside class="side">
    <div class="slist">
      <button class="sbtn" aria-current="${!ui.tStudent}" onclick="pickStudent(null)"><span class="avatar">≡</span><span class="nm">Übersicht</span>${openQ.length?`<span class="pill q">${openQ.length}</span>`:""}</button>
      <button class="sbtn" aria-current="${ui.tStudent==="__mat"}" onclick="pickStudent('__mat')"><span class="avatar">▶</span><span class="nm">Material</span><span class="label">${S.resources.length}</span></button>
    </div>
    <div class="label">SchülerInnen · ${pad(studs.length)}</div>
    <div class="slist">${studs.map(s=>{const q=openQ.filter(x=>x.studentId===s.id).length;return `<button class="sbtn" aria-current="${ui.tStudent===s.id}" onclick="pickStudent('${s.id}')"><span class="avatar">${esc(initials(s.name))}</span><span class="nm">${esc(s.name)}</span>${q?`<span class="pill q" title="offene Fragen">${q}</span>`:""}</button>`}).join("")||`<p class="tiny muted" style="padding:0 10px">Noch niemand angelegt.</p>`}
      <button class="sbtn" aria-current="${ui.tStudent==="__new"}" onclick="pickStudent('__new')"><span class="avatar">+</span><span class="nm">SchülerIn anlegen</span></button>
    </div></aside>`;
  let main;
  if(ui.tStudent==="__new") main=newStudentForm();
  else if(ui.tStudent==="__mat") main=libraryView();
  else if(ui.tStudent) main=teacherStudent(student(ui.tStudent));
  else main=overview(studs,openQ);
  return `<div class="bar">${brand("Lehrerin")}
      <div class="bar-actions">${REC.active?`<button class="btn sm rec-pill" onclick="ui.tStudent='${REC.studentId}';ui.tTab='stunden';render()"><span class="rec-dot ${REC.paused?"paused":""}"></span><span id="rec-time-bar" class="mono">${fmtDur(recElapsed())}</span></button>`:""}${syncNote()}<button class="btn ghost sm" onclick="refresh()">Aktualisieren</button>${themeBtn()}<button class="btn sm" onclick="logout()">Abmelden</button></div></div>
    <div class="tlayout">${side}<main class="stack" style="gap:18px;min-width:0">${main}</main></div>`;
}
function pickStudent(id){ ui.tStudent=id; if(id && id[0]!=="_") ui.tTab="stunden"; render(); window.scrollTo({top:0}); }
function overview(studs,openQ){
  const upcoming=studs.filter(s=>s.nextAppt && new Date(s.nextAppt)>new Date(Date.now()-3*3600e3)).sort((a,b)=>a.nextAppt.localeCompare(b.nextAppt));
  const overdue=S.homework.filter(h=>!h.done && h.due && daysUntil(h.due)<0);
  const h=new Date().getHours(); const greet=h<11?"Guten Morgen.":h<18?"Guten Tag.":"Guten Abend.";
  return `<div class="hero" style="margin-bottom:10px"><div class="eyebrow">${todayLabel()}</div><h1>${greet.replace(/(\w+)\.$/,"<em>$1.</em>")}</h1></div>
  <div class="stats">
    <div class="stat"><div class="label">SchülerInnen</div><div class="n">${studs.length}</div></div>
    <div class="stat"><div class="label">Offene Fragen</div><div class="n" style="${openQ.length?"color:var(--accent)":""}">${openQ.length}</div></div>
    <div class="stat"><div class="label">Überfällig</div><div class="n" style="${overdue.length?"color:var(--bad)":""}">${overdue.length}</div></div>
    <div class="stat"><div class="label">Termine</div><div class="n">${upcoming.length}</div></div>
  </div>
  <div class="grid2">
    <div class="panel"><div class="panel-h"><h2>Nächste Termine</h2></div>
      <div class="stack">${upcoming.length?upcoming.map(s=>{const d=new Date(s.nextAppt);return `<button class="item" onclick="pickStudent('${s.id}')"><span class="avatar">${esc(initials(s.name))}</span><div class="main"><div class="t">${esc(s.name)}</div><div class="d mono" style="font-size:12.5px">${WD[d.getDay()].slice(0,2).toUpperCase()} ${d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})} · ${d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}${s.apptNote?` · ${esc(s.apptNote)}`:""}</div></div><span class="chip">${relDays(daysUntil(s.nextAppt.slice(0,10)))}</span></button>`}).join(""):`<div class="empty">Keine Termine eingetragen.</div>`}</div></div>
    <div class="panel"><div class="panel-h"><h2>Überfällige Aufgaben</h2></div>
      <div class="stack">${overdue.length?overdue.map(h=>`<div class="item"><span class="stripe" style="--c:${col(h.subject)}"></span><div class="main"><div class="t">${esc(h.title)}</div><div class="meta"><span class="chip">${esc(student(h.studentId)?.name||"?")}</span>${hwStatus(h)}</div></div></div>`).join(""):`<div class="empty">Nichts überfällig.</div>`}</div></div>
  </div>
  ${pendingReviewsPanel()}
  <div class="panel"><div class="panel-h"><h2>Offene Fragen <span class="label">${pad(openQ.length)}</span></h2></div>
    <div class="stack">${openQ.length?openQ.sort((a,b)=>String(a.askedAt).localeCompare(String(b.askedAt))).map(q=>qCard(q,true)).join(""):`<div class="empty">Alle Fragen beantwortet.</div>`}</div></div>`;
}
function newStudentForm(){
  return `<div class="hero" style="margin-bottom:6px"><div class="eyebrow">Neu</div><h1 style="font-size:clamp(40px,5.5vw,68px)">SchülerIn <em>anlegen.</em></h1></div>
  <div class="panel stack" style="gap:18px">
    <div class="fgrid">
      <div class="field"><label for="ns-name">Name · Login</label><input id="ns-name" type="text" placeholder="Vorname Nachname"></div>
      <div class="field"><label for="ns-grade">Klasse / Schulform</label><input id="ns-grade" type="text" placeholder="z. B. 8. Klasse, Gymnasium"></div>
      <div class="field"><label for="ns-pin">PIN · 4–6 Ziffern</label><input id="ns-pin" type="text" inputmode="numeric" maxlength="6" placeholder="z. B. 4821" class="mono"></div>
    </div>
    <div class="field"><label>Fächer</label><div class="checks">${SUBJECTS.map(x=>`<label><input type="checkbox" id="ns-s-${x}"> ${x}</label>`).join("")}</div></div>
    <div><button class="btn primary" onclick="createStudent()">Anlegen <span class="arr">→</span></button></div>
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
  const tabs=[["stunden","Stunde & Termin"],["hausaufgaben","Aufgaben",openH],["fragen","Fragen",openQ],["material","Material"],["verlauf","Verlauf"],["profil","Profil"]];
  let body="";
  if(ui.tTab==="stunden") body=lessonTab(s);
  if(ui.tTab==="hausaufgaben") body=hwTab(s,hw);
  if(ui.tTab==="fragen") body=`<div class="stack">${qs.length?qs.map(q=>qCard(q,true)).join(""):`<div class="empty">${esc(firstName(s.name))} hat noch keine Fragen notiert.</div>`}</div>`;
  if(ui.tTab==="material") body=assignView(s);
  if(ui.tTab==="verlauf") body=reviewsView(s)+progressView(s)+lessonAdmin(s);
  if(ui.tTab==="profil") body=profileTab(s);
  return `<div class="hero" style="margin-bottom:6px"><div class="eyebrow">${s.grade?esc(s.grade):"SchülerIn"}</div><h1 style="font-size:clamp(40px,5.5vw,68px)">${esc(s.name)}</h1><div class="sub">${(s.subjects||[]).map(subjChip).join("")}</div></div>
    <nav class="tabs" role="tablist">${tabs.map(([k,l,c])=>`<button class="tab" role="tab" aria-selected="${ui.tTab===k}" onclick="ui.tTab='${k}';render()">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("")}</nav>
    ${body}`;
}
function subjSelect(id,s,sel){ const subs=(s&&s.subjects&&s.subjects.length)?s.subjects:SUBJECTS; return `<select id="${id}">${subs.map(x=>`<option ${x===sel?"selected":""}>${x}</option>`).join("")}</select>`; }
function lessonTab(s){
  const last=byStudent(S.lessons,s.id).sort((a,b)=>b.date.localeCompare(a.date)||String(b.created).localeCompare(String(a.created)));
  const latestReview=last.find(l=>l.reviewStatus!=="none");
  const cur=s.nextAppt||"";
  return `<div class="stack" style="gap:18px">
  ${recPanel(s)}
  ${latestReview && latestReview.reviewStatus!=="recording" ? reviewCard(latestReview) : ""}
  <div class="grid2">
    <div class="panel stack"><h2>Stunde manuell eintragen</h2>
      <div class="fgrid"><div class="field"><label for="ls-date">Datum</label><input id="ls-date" type="date" value="${today()}"></div>
        <div class="field"><label for="ls-subj">Fach</label>${subjSelect("ls-subj",s)}</div></div>
      <div class="field"><label for="ls-topic">Thema</label><input id="ls-topic" type="text" placeholder="z. B. Brüche dividieren"></div>
      <div class="field"><label for="ls-notes">Was haben wir gemacht? (sieht die/der SchülerIn)</label><textarea id="ls-notes" placeholder="Kehrwert-Regel hergeleitet, 6 Aufgaben gemeinsam, 2 allein – bei Textaufgaben noch unsicher."></textarea></div>
      <div><button class="btn primary" onclick="addLesson('${s.id}')">Stunde speichern</button></div>
      ${last.length?`<div class="divider"></div><div class="label">Zuletzt</div>${last.slice(0,3).map(l=>`<div class="small"><span class="mono">${fmtShort(l.date)}</span> · ${esc(l.subject)} · ${esc(l.topic)}</div>`).join("")}`:""}
    </div>
    <div class="stack" style="gap:16px">
      ${nextCard(s,true)}
      <div class="panel stack"><h2>Nächsten Termin setzen</h2>
        <div class="field"><label for="ap-when">Datum & Uhrzeit</label><input id="ap-when" type="datetime-local" value="${esc(cur)}"></div>
        <div class="field"><label for="ap-note">Hinweis (optional)</label><input id="ap-note" type="text" value="${esc(s.apptNote||"")}" placeholder="z. B. online per Zoom / Heft mitbringen"></div>
        <div class="row"><button class="btn primary" onclick="setAppt('${s.id}')">Termin speichern</button>${cur?`<button class="btn ghost" onclick="clearAppt('${s.id}')">Termin entfernen</button>`:""}</div>
      </div>
    </div></div></div>`;
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
  return `<div class="item"><span class="stripe" style="--c:${col(r.subject)}"></span><div class="main"><div class="t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(r.title)}</a>`:esc(r.title)}</div>
    <div class="meta"><span class="chip">${KINDS[r.kind]||"Link"}</span>${subjChip(r.subject)}<span class="label">für ${esc(who)}</span></div></div>
    <button class="btn sm ghost danger" aria-label="Löschen" onclick="delRow('resources','${r.id}')">✕</button></div>`;
}
function libraryView(){
  const list=S.resources.slice().sort((a,b)=>String(b.created||"").localeCompare(String(a.created||"")));
  return `<div class="hero" style="margin-bottom:6px"><div class="eyebrow">Bibliothek · ${pad(list.length)}</div><h1 style="font-size:clamp(40px,5.5vw,68px)">Material<em>.</em></h1></div><div class="grid2">${resForm("lib")}<div class="stack">${list.length?list.map(resRow).join(""):`<div class="empty">Noch kein Material.</div>`}</div></div>`;
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
      ${ui.reviewReady?`<label class="switch"><input type="checkbox" id="pf-consent" ${s.recordingConsent?"checked":""}><span class="track"></span><span><strong>Einverständnis zur Aufnahme liegt vor</strong><br><span class="muted small">Schriftlich, bei Minderjährigen von den Eltern. Erst dann lassen sich Stunden aufnehmen.</span></span></label>`:""}
      ${ui.tasksReady?`<label class="switch"><input type="checkbox" id="pf-auto" ${s.autoHomework?"checked":""}><span class="track"></span><span><strong>Übungen automatisch als Hausaufgabe stellen</strong><br><span class="muted small">Sobald du eine Auswertung freigibst, werden alle Übungspakete gestellt – fällig zum nächsten Termin.</span></span></label>`:""}
      <div><button class="btn primary" onclick="saveProfile('${s.id}')">Speichern</button></div></div>
    <div class="stack" style="gap:16px"><div class="panel stack"><h2>Neue PIN vergeben</h2>
      <p class="muted small">Entsperrt das Profil auch nach zu vielen Fehlversuchen und meldet alle Geräte ab.</p>
      <div class="field"><label for="pf-pin">Neue PIN (4–6 Ziffern)</label><input id="pf-pin" type="text" inputmode="numeric" maxlength="6"></div>
      <div><button class="btn" onclick="resetPin('${s.id}')">PIN ändern</button></div></div>
      <div class="panel stack"><h2>SchülerIn löschen</h2><p class="muted small">Löscht das Profil mit allen Stunden, Hausaufgaben, Fragen, Transkripten und Auswertungen endgültig.</p>
      <div><button class="btn danger" onclick="removeStudent('${s.id}')">Endgültig löschen</button></div></div></div></div>`;
}
async function saveProfile(id){
  const name=$("#pf-name").value.trim(); if(!name) return toast("Der Name darf nicht leer sein.");
  const row={name,grade:$("#pf-grade").value.trim(),subjects:SUBJECTS.filter(x=>$("#pf-s-"+x).checked)};
  const c=$("#pf-consent"); if(c) row.recording_consent=c.checked;
  const a=$("#pf-auto"); if(a) row.auto_homework=a.checked;
  await run(sb.from("students").update(row).eq("id",id),"Profil gespeichert");
}
async function resetPin(id){
  const pin=$("#pf-pin").value.trim(); if(!/^\d{4,6}$/.test(pin)) return toast("Die PIN muss aus 4–6 Ziffern bestehen.");
  if(await run(sb.rpc("teacher_set_pin",{p_student:id,p_pin:pin}),"PIN geändert")){ const el=$("#pf-pin"); if(el) el.value=""; }
}
async function removeStudent(id){ if(!confirmDel(id)) return; if(await run(sb.from("students").delete().eq("id",id),"Gelöscht")){ ui.tStudent=null; render(); } }


/* ============================================================
   Aufnahme, Transkription & Auswertung (nur Lehrerin)
   Ablauf: Mikrofon → Abschnitte à 8 Min. → Edge Function "transcribe"
   (Whisper, Audio wird nicht gespeichert) → nach dem Beenden
   Edge Function "review" (Claude) → Entwurf → Freigabe.
   ============================================================ */
const SEG_MS = 8*60*1000;
const REC = {active:false, paused:false, stopping:false, lessonId:null, studentId:null, stream:null, recorder:null, mime:"",
  acc:0, resumedAt:0, segAt:0, queue:[], uploading:false, done:0, total:0, failed:0, finalize:new Set(), analyzing:new Set(),
  actx:null, analyser:null, raf:0, wake:null, segTimer:0};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const recElapsed = () => REC.acc + (REC.active && !REC.paused ? Date.now()-REC.resumedAt : 0);
const fmtDur = ms => { const s=Math.floor(ms/1000); return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`; };
function pickMime(){ if(!window.MediaRecorder) return null; for(const m of ["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4"]) if(MediaRecorder.isTypeSupported(m)) return m; return ""; }

async function callFn(name, body){
  const cfg=window.LERNRAUM_CONFIG, {data:{session}}=await sb.auth.getSession();
  if(!session) throw new Error("not_authenticated");
  const isForm = body instanceof FormData;
  const headers={apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${session.access_token}`};
  if(!isForm) headers["Content-Type"]="application/json";
  const r=await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`,{method:"POST",headers,body:isForm?body:JSON.stringify(body)});
  let j={}; try{ j=await r.json(); }catch(e){}
  if(!r.ok) { const e=new Error(j.error||("HTTP "+r.status)); e.status=r.status; e.info=j; throw e; }
  return j;
}
function fnErrorText(e){
  const c=e&&e.message||"";
  if(c==="missing_openai_key") return "OpenAI-Key fehlt in den Supabase-Secrets.";
  if(c==="missing_anthropic_key") return "Anthropic-Key fehlt in den Supabase-Secrets.";
  if(c==="transcript_too_short") return "Das Transkript ist zu kurz für eine Auswertung.";
  if(c==="file_too_large") return "Die Datei ist größer als 25 MB.";
  if(e&&e.status===404&&!e.info?.error) return "Die Edge Function ist noch nicht eingerichtet (siehe README).";
  if(c==="Failed to fetch"||c.includes("NetworkError")) return "Keine Verbindung zur Edge Function (CORS/Deploy prüfen).";
  return "Das hat nicht geklappt ("+c+").";
}

async function startRecording(sid){
  const s=student(sid);
  if(!s.recordingConsent) return toast("Bitte zuerst im Profil das Einverständnis bestätigen.", true);
  if(REC.active) return toast("Es läuft bereits eine Aufnahme.", true);
  const mime=pickMime(); if(mime===null) return toast("Dieser Browser kann nicht aufnehmen. Bitte Chrome oder Safari nutzen.", true);
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}}); }
  catch(e){ return toast("Kein Zugriff aufs Mikrofon – bitte im Browser erlauben.", true); }
  const subject=$("#rec-subj")?.value||s.subjects[0]||SUBJECTS[0], topic=$("#rec-topic")?.value.trim();
  const {data,error}=await sb.from("lessons").insert({student_id:sid,date:today(),subject,topic:topic||"Aufnahme läuft …",review_status:"recording"}).select("id").single();
  if(error){ stream.getTracks().forEach(t=>t.stop()); return toast(friendlyError(error), true); }
  Object.assign(REC,{active:true,paused:false,stopping:false,lessonId:data.id,studentId:sid,stream,mime,acc:0,resumedAt:Date.now(),done:0,total:0,failed:0});
  startSegment(); startMeter();
  try{ REC.wake=await navigator.wakeLock?.request("screen"); }catch(e){}
  toast("Aufnahme läuft");
  await refresh();
}
function startSegment(){
  const opts={audioBitsPerSecond:32000}; if(REC.mime) opts.mimeType=REC.mime;
  const r=new MediaRecorder(REC.stream,opts), parts=[], lessonId=REC.lessonId, segStartElapsed=recElapsed();
  r.ondataavailable=e=>{ if(e.data&&e.data.size) parts.push(e.data); };
  r.onstop=()=>{
    const blob=new Blob(parts,{type:r.mimeType||REC.mime||"audio/webm"});
    if(blob.size>3000) enqueue({lessonId, blob, secs:(recElapsed()-segStartElapsed)/1000});
    if(REC.active && !REC.stopping){ startSegment(); if(REC.paused) REC.recorder.pause(); }
    else { REC.finalize.add(lessonId); pump(); }   // erst nach dem letzten Abschnitt auswerten
  };
  r.start(1000); REC.recorder=r;
  clearTimeout(REC.segTimer); REC.segTimer=setTimeout(()=>{ if(r.state!=="inactive") r.stop(); }, SEG_MS);
}
function togglePause(){
  if(!REC.active) return;
  if(REC.paused){ REC.recorder.resume(); REC.resumedAt=Date.now(); REC.paused=false; }
  else { REC.recorder.pause(); REC.acc+=Date.now()-REC.resumedAt; REC.paused=true; }
  render();
}
async function stopRecording(discard){
  if(!REC.active) return;
  if(discard && !confirmDel("rec")) return;
  const id=REC.lessonId;
  if(!REC.paused) REC.acc+=Date.now()-REC.resumedAt;
  REC.stopping=true; REC.active=false; clearTimeout(REC.segTimer);
  if(discard){ REC.queue=REC.queue.filter(j=>j.lessonId!==id); REC.recorder.onstop=null; }
  if(REC.recorder.state!=="inactive") REC.recorder.stop();
  REC.stream.getTracks().forEach(t=>t.stop()); stopMeter();
  try{ await REC.wake?.release(); }catch(e){}
  if(discard){ await run(sb.from("lessons").delete().eq("id",id),"Aufnahme verworfen"); return; }
  toast("Aufnahme beendet – wird ausgewertet");
  render();
}
function enqueue(job){ job.tries=0; REC.queue.push(job); REC.total++; pump(); render(); }
async function pump(){
  if(REC.uploading) return;
  const job=REC.queue[0];
  if(!job){ for(const id of [...REC.finalize]){ REC.finalize.delete(id); analyzeLesson(id); } return; }
  REC.uploading=true; setSaving(1);
  const fd=new FormData();
  const ext=(job.blob.type||"").includes("mp4")?"m4a":(job.blob.type||"").includes("mpeg")?"mp3":(job.blob.type||"").includes("wav")?"wav":"webm";
  fd.append("file", job.blob, job.name||`abschnitt.${ext}`); fd.append("lesson_id", job.lessonId); fd.append("seconds", String(Math.round(job.secs||0)));
  try{ await callFn("transcribe", fd); REC.queue.shift(); REC.done++; }
  catch(e){
    job.tries++;
    if(job.tries>=3 || e.status===413 || e.message==="missing_openai_key"){ REC.queue.shift(); REC.failed++; toast(fnErrorText(e), true); }
    else await sleep(2500*job.tries);
  }
  REC.uploading=false; setSaving(-1);
  await refresh(); pump();
}
async function analyzeLesson(id){
  REC.analyzing.add(id); render(); setSaving(1);
  try{ await callFn("review",{lesson_id:id}); toast("Auswertung fertig – bitte prüfen und freigeben"); }
  catch(e){ toast(fnErrorText(e), true); }
  REC.analyzing.delete(id); setSaving(-1); await refresh();
}
/* Vorhandene Aufnahme hochladen (z. B. vom Handy), max. 25 MB */
async function uploadAudio(sid, input){
  const f=input.files&&input.files[0]; input.value=""; if(!f) return;
  const s=student(sid);
  if(!s.recordingConsent) return toast("Bitte zuerst im Profil das Einverständnis bestätigen.", true);
  if(f.size>25*1024*1024) return toast("Die Datei ist größer als 25 MB – bitte kürzer oder komprimiert aufnehmen.", true);
  const subject=$("#rec-subj")?.value||s.subjects[0]||SUBJECTS[0], topic=$("#rec-topic")?.value.trim();
  const {data,error}=await sb.from("lessons").insert({student_id:sid,date:today(),subject,topic:topic||"Aufnahme wird ausgewertet",review_status:"transcribing"}).select("id").single();
  if(error) return toast(friendlyError(error), true);
  REC.finalize.add(data.id); enqueue({lessonId:data.id, blob:f, name:f.name, secs:0});
  toast("Datei wird transkribiert …");
}
/* Pegelanzeige */
function startMeter(){
  try{
    REC.actx=new (window.AudioContext||window.webkitAudioContext)();
    const src=REC.actx.createMediaStreamSource(REC.stream); REC.analyser=REC.actx.createAnalyser(); REC.analyser.fftSize=256; src.connect(REC.analyser);
  }catch(e){ REC.analyser=null; }
  const buf=REC.analyser?new Uint8Array(REC.analyser.frequencyBinCount):null; let last=0;
  const hist=new Array(48).fill(0);
  const frame=t=>{
    REC.raf=requestAnimationFrame(frame);
    if(t-last<50) return; last=t;
    const tEl=$("#rec-time"); if(tEl) tEl.textContent=fmtDur(recElapsed());
    const tBar=$("#rec-time-bar"); if(tBar) tBar.textContent=fmtDur(recElapsed());
    const cv=$("#rec-meter"); if(!cv) return;
    let lvl=0; if(buf && !REC.paused){ REC.analyser.getByteTimeDomainData(buf); for(const v of buf) lvl=Math.max(lvl,Math.abs(v-128)); lvl=Math.min(1,lvl/64); }
    hist.push(lvl); hist.shift();
    const dpr=window.devicePixelRatio||1, w=cv.clientWidth, h=cv.clientHeight;
    if(cv.width!==w*dpr){ cv.width=w*dpr; cv.height=h*dpr; }
    const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement), ink=css.getPropertyValue("--ink").trim(), acc=css.getPropertyValue("--accent").trim();
    const bw=w/hist.length;
    hist.forEach((v,i)=>{ const bh=Math.max(2,v*h*.9); g.fillStyle = i>hist.length-6 ? acc : ink; g.globalAlpha=.25+.75*(i/hist.length);
      g.beginPath(); g.roundRect ? g.roundRect(i*bw+bw*.25,(h-bh)/2,bw*.5,bh,bw*.25) : g.rect(i*bw+bw*.25,(h-bh)/2,bw*.5,bh); g.fill(); });
    g.globalAlpha=1;
  };
  REC.raf=requestAnimationFrame(frame);
}
function stopMeter(){ cancelAnimationFrame(REC.raf); try{ REC.actx?.close(); }catch(e){} REC.actx=null; REC.analyser=null; }
window.addEventListener("beforeunload",e=>{ if(REC.active||REC.queue.length){ e.preventDefault(); e.returnValue=""; } });

/* ---------- Aufnahme-Panel ---------- */
function recPanel(s){
  if(!ui.reviewReady) return `<div class="panel rec"><div class="label">Aufnahme & Auswertung</div><p class="muted small" style="margin-top:8px">Noch nicht eingerichtet: Führe <span class="mono">supabase/review.sql</span> im SQL-Editor aus und richte die Edge Functions ein (siehe README).</p></div>`;
  if(REC.active && REC.studentId!==s.id) return `<div class="panel rec"><div class="label">Aufnahme</div><p class="muted small" style="margin-top:8px">Es läuft gerade eine Aufnahme bei ${esc(student(REC.studentId)?.name||"einer/einem anderen SchülerIn")}.</p></div>`;
  if(REC.active){
    const pending=REC.queue.length+(REC.uploading?0:0);
    return `<div class="panel rec live">
      <div class="rec-head"><span class="rec-dot ${REC.paused?"paused":""}"></span><span class="label">${REC.paused?"Pausiert":"Aufnahme läuft"} · Abschnitt ${pad(REC.total+1)}</span>
        <span class="label" style="margin-left:auto">${REC.done} transkribiert${pending?` · ${pending} in Arbeit`:""}</span></div>
      <div class="rec-body"><div id="rec-time" class="rec-time">${fmtDur(recElapsed())}</div><canvas id="rec-meter" class="rec-meter" aria-hidden="true"></canvas></div>
      <div class="row"><button class="btn primary" onclick="stopRecording(false)">Beenden & auswerten <span class="arr">→</span></button>
        <button class="btn" onclick="togglePause()">${REC.paused?"Fortsetzen":"Pause"}</button>
        <button class="btn ghost danger" onclick="stopRecording(true)">Verwerfen</button></div>
      <p class="tiny muted">Alle 8 Minuten wird ein Abschnitt transkribiert – das Audio selbst wird nicht gespeichert. Tab bitte geöffnet lassen.</p>
    </div>`;
  }
  if(!s.recordingConsent) return `<div class="panel rec"><div class="rec-head"><span class="label">Stunde aufnehmen</span></div>
      <p class="muted small" style="margin-top:10px;max-width:60ch">Für Aufnahmen brauchst du ein schriftliches Einverständnis – bei Minderjährigen von den Eltern. Bestätige es im Profil, dann erscheint hier die Aufnahme.</p>
      <div style="margin-top:14px"><button class="btn sm" onclick="ui.tTab='profil';render()">Zum Profil →</button></div></div>`;
  return `<div class="panel rec">
    <div class="rec-head"><span class="label">Stunde aufnehmen</span><span class="label" style="margin-left:auto">Whisper · Claude</span></div>
    <div class="fgrid" style="margin-top:16px">
      <div class="field"><label for="rec-subj">Fach</label>${subjSelect("rec-subj",s)}</div>
      <div class="field"><label for="rec-topic">Thema (optional)</label><input id="rec-topic" type="text" placeholder="wird sonst automatisch erkannt"></div>
    </div>
    <div class="row" style="margin-top:16px">
      <button class="btn primary rec-start" onclick="startRecording('${s.id}')"><span class="rec-dot"></span> Aufnahme starten</button>
      <label class="btn">Audiodatei hochladen<input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm" hidden onchange="uploadAudio('${s.id}',this)"></label>
    </div>
    <p class="tiny muted" style="margin-top:12px">Nach dem Beenden: Transkript → Zusammenfassung, Stärken, Schwachstellen und Übungsvorschläge. ${esc(firstName(s.name))} sieht nur Zusammenfassung und Übungen – und erst, wenn du sie freigibst.</p>
  </div>`;
}

/* ---------- Auswertungs-Karte ---------- */
function reviewSteps(l){
  const busy = REC.analyzing.has(l.id);
  const st = busy ? "analyzing" : l.reviewStatus;
  const order=["recording","transcribing","analyzing","done"], idx=order.indexOf(st);
  const names=["Aufnahme","Transkript","Auswertung","Fertig"];
  return `<div class="steps">${names.map((n,i)=>`<span class="step ${i<idx?"ok":i===idx?"now":""}">${n}</span>`).join('<span class="step-line"></span>')}</div>`;
}
function reviewCard(l){
  const s=student(l.studentId), rv=l.review||{};
  const inProgress = ["recording","transcribing","analyzing"].includes(l.reviewStatus) || REC.analyzing.has(l.id);
  const head=`<div class="rev-head"><div><div class="label">${fmtShort(l.date)} · ${esc(l.subject)}${l.duration?` · ${Math.round(l.duration/60)} Min`:""}</div>
      <h3 class="rev-title">${esc(l.topic)}</h3></div>
      ${l.reviewStatus==="done"?(l.published?`<span class="chip ok">freigegeben</span>`:`<span class="chip warn">Entwurf · nur für dich</span>`):l.reviewStatus==="error"?`<span class="chip bad">Fehler</span>`:""}</div>`;
  if(inProgress && l.reviewStatus!=="done"){
    // Läuft die Aufnahme wirklich noch, oder ist sie abgebrochen (Akku leer, Tab geschlossen)?
    const live = REC.active && REC.lessonId===l.id, busy = REC.analyzing.has(l.id) || REC.queue.some(j=>j.lessonId===l.id) || REC.uploading;
    const stuck = !live && !busy && l.reviewStatus!=="analyzing";
    return `<div class="panel review">${head}${reviewSteps(l)}
      ${stuck?`<div class="banner" style="margin:0 0 16px">Diese Aufnahme wurde unterbrochen – vermutlich war der Akku leer oder der Tab geschlossen. Alles bis zum letzten vollständigen 8-Minuten-Abschnitt ist gesichert; nur der angefangene Abschnitt danach ist verloren.</div>
        <div class="row">${l.transcript?`<button class="btn primary sm" onclick="analyzeLesson('${l.id}')">Mit dem vorhandenen Transkript auswerten <span class="arr">→</span></button>`:""}
          <button class="btn sm ghost danger" onclick="delRow('lessons','${l.id}')">Stunde löschen</button></div>`
      :`<p class="muted small">${busy&&(REC.analyzing.has(l.id)||l.reviewStatus==="analyzing")?"Claude wertet die Stunde aus und baut die Übungsaufgaben – das dauert meist ein bis zwei Minuten.":"Transkription läuft …"}</p>`}
      ${transcriptBox(l)}</div>`;
  }
  if(l.reviewStatus==="error") return `<div class="panel review">${head}<p class="err" style="margin:10px 0 14px">${esc(l.reviewError||"Unbekannter Fehler")}</p>
      <div class="row">${l.transcript?`<button class="btn sm" onclick="analyzeLesson('${l.id}')">Erneut auswerten</button>`:""}<button class="btn sm ghost danger" onclick="delRow('lessons','${l.id}')">Stunde löschen</button></div>${transcriptBox(l)}</div>`;
  if(l.reviewStatus!=="done") return "";
  const sev={hoch:"bad",mittel:"warn",niedrig:""};
  const list=(arr)=>arr&&arr.length?`<ul class="rev-list">${arr.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p class="muted small">—</p>`;
  const given=byStudent(S.homework,l.studentId).filter(h=>h.fromLesson===l.id);
  const pack=(l.practice||[]).map((p,i)=>{
    const res=p.resource_id?S.resources.find(r=>r.id===p.resource_id):null;
    const already=given.some(h=>h.title===p.title);
    return `<div class="pack ${already?"given":""}">
      <label class="pack-h"><input type="checkbox" id="pk-${l.id}-${i}" ${already?"disabled":"checked"}>
        <span class="main"><span class="t">${esc(p.title)}</span>${p.weakness?`<span class="label">zu: ${esc(p.weakness)}</span>`:""}</span>
        ${already?`<span class="chip ok">gestellt</span>`:`<span class="chip">${(p.exercises||[]).length} ${(p.exercises||[]).length===1?"Aufgabe":"Aufgaben"}</span>`}</label>
      <div class="d">${esc(p.description||"")}</div>
      <div class="row" style="margin-top:8px">
        ${res&&url(res.url)?`<a class="chip" href="${esc(url(res.url))}" target="_blank" rel="noopener">${KINDS[res.kind]||"Link"}: ${esc(res.title)} ↗</a>`:`<span class="label">kein Material verknüpft</span>`}
        ${(p.exercises||[]).length?`<button class="linkbtn" onclick="ui.openPack=ui.openPack==='${l.id}-${i}'?'':'${l.id}-${i}';render()">${ui.openPack===l.id+"-"+i?"Aufgaben ausblenden":"Aufgaben ansehen"}</button>`:""}
      </div>
      ${ui.openPack===l.id+"-"+i?`<div class="ex-list">${(p.exercises||[]).map((e,n)=>`<div class="ex"><div class="q"><span class="mono">${pad(n+1)}</span> ${esc(e.question)}</div>
        ${e.hint?`<div class="small muted">Tipp: ${esc(e.hint)}</div>`:""}<div class="small sol">Lösung: ${esc(e.solution)}</div></div>`).join("")}</div>`:""}
    </div>`;}).join("");
  return `<div class="panel review">${head}
    ${rv.transcript_quality&&rv.transcript_quality!=="gut"?`<div class="banner" style="margin:14px 0 0">Transkript-Qualität: ${esc(rv.transcript_quality)} – Auswertung mit Vorsicht lesen.</div>`:""}
    <div class="rev-grid">
      <section>
        <div class="label">Für ${esc(firstName(s?.name||""))} · Zusammenfassung</div>
        <textarea id="sum-${l.id}" class="rev-sum">${esc(l.summary)}</textarea>
        <div class="label" style="margin-top:18px">Übungspakete aus den Schwachstellen</div>
        <div class="stack" style="margin-top:10px">${pack||`<p class="muted small">—</p>`}</div>
        ${(l.practice||[]).length?`<div class="row" style="margin-top:14px"><button class="btn sm" onclick="assignPack('${l.id}')">Ausgewählte als Hausaufgabe stellen</button>
          ${s&&s.autoHomework?`<span class="label">Automatik an</span>`:""}</div>`:""}
      </section>
      <section>
        <div class="label">Schwachstellen · nur für dich</div>
        <div class="stack" style="margin-top:10px">${(rv.weaknesses||[]).map(w=>`<div class="weak"><div class="row"><strong>${esc(w.skill)}</strong><span class="chip ${sev[w.severity]||""}">${esc(w.severity||"")}</span></div>
          <blockquote>${esc(w.evidence)}</blockquote><div class="small muted">→ ${esc(w.suggestion)}</div></div>`).join("")||`<p class="muted small">Keine belegten Schwachstellen.</p>`}</div>
        <div class="rev-cols">
          <div><div class="label">Stärken</div>${list(rv.strengths)}</div>
          <div><div class="label">Missverständnisse</div>${list(rv.misconceptions)}</div>
        </div>
        ${rv.next_focus?`<div class="label" style="margin-top:16px">Fokus nächste Stunde</div><p class="small" style="margin-top:6px">${esc(rv.next_focus)}</p>`:""}
        ${rv.teacher_notes?`<div class="label" style="margin-top:16px">Beobachtungen zur Stunde</div><p class="small muted" style="margin-top:6px">${esc(rv.teacher_notes)}</p>`:""}
      </section>
    </div>
    <div class="row rev-actions">
      ${l.published?`<button class="btn sm" onclick="publishReview('${l.id}',false)">Freigabe zurückziehen</button><button class="btn sm ghost" onclick="publishReview('${l.id}',true)">Zusammenfassung aktualisieren</button>`
        :`<button class="btn primary sm" onclick="publishReview('${l.id}',true)">Für ${esc(firstName(s?.name||"SchülerIn"))} freigeben <span class="arr">→</span></button>`}
      <button class="btn sm ghost" onclick="analyzeLesson('${l.id}')">Neu auswerten</button>
    </div>
    ${transcriptBox(l)}
  </div>`;
}
/* Übungspakete als Hausaufgaben anlegen */
function packRow(l,p){
  const s=student(l.studentId);
  return {student_id:l.studentId, title:p.title, description:p.description||"", subject:l.subject,
    due:(s?.nextAppt||"").slice(0,10)||null, resource_id:p.resource_id||null,
    exercises:p.exercises||[], weakness:p.weakness||"", from_lesson:l.id};
}
async function assignPack(lid, silent){
  const l=S.lessons.find(x=>x.id===lid); if(!l) return;
  const given=byStudent(S.homework,l.studentId).filter(h=>h.fromLesson===l.id).map(h=>h.title);
  const rows=(l.practice||[]).filter((p,i)=>{
    if(given.includes(p.title)) return false;
    if(silent) return true;
    const box=$(`#pk-${lid}-${i}`); return !box || box.checked;
  }).map(p=>packRow(l,p));
  if(!rows.length){ if(!silent) toast("Nichts ausgewählt oder schon gestellt."); return; }
  await run(sb.from("homework").insert(rows), `${rows.length} ${rows.length===1?"Aufgabe":"Aufgaben"} gestellt`);
}
function transcriptBox(l){
  if(!l.transcript) return "";
  return `<details class="box" style="margin-top:16px"><summary>Transkript · ${l.transcript.split(/\s+/).length} Wörter</summary>
    <div class="inner"><div class="transcript">${esc(l.transcript)}</div>
    <div class="row" style="margin-top:12px"><button class="btn sm ghost danger" onclick="clearTranscript('${l.id}')">Transkript löschen</button></div></div></details>`;
}
async function publishReview(id, on){
  const el=$("#sum-"+id); const row={review_published:on}; if(el) row.summary=el.value.trim();
  const ok=await run(sb.from("lessons").update(row).eq("id",id), on?"Für SchülerIn freigegeben":"Freigabe zurückgezogen");
  if(!ok || !on) return;
  const l=S.lessons.find(x=>x.id===id), s=l&&student(l.studentId);
  if(s&&s.autoHomework) await assignPack(id, true);   // Automatik: alle Übungen direkt stellen
}
async function practiceToHw(lid,i){
  const l=S.lessons.find(x=>x.id===lid); const p=l&&l.practice[i]; if(!p) return;
  await run(sb.from("homework").insert(packRow(l,p)),"Als Hausaufgabe gestellt");
}
async function clearTranscript(id){ if(!confirmDel("tr"+id)) return; await run(sb.from("lessons").update({transcript:""}).eq("id",id),"Transkript gelöscht"); }

/* ---------- Verlauf: Schwachstellen-Radar + Auswertungen ---------- */
function reviewsView(s){
  const ls=byStudent(S.lessons,s.id).filter(l=>l.reviewStatus!=="none").sort((a,b)=>b.date.localeCompare(a.date)||String(b.created).localeCompare(String(a.created)));
  if(!ls.length) return "";
  const rank={hoch:3,mittel:2,niedrig:1}, agg={};
  ls.filter(l=>l.review).slice(0,6).forEach(l=>(l.review.weaknesses||[]).forEach(w=>{
    const k=(w.skill||"").trim(); if(!k) return; const key=k.toLowerCase();
    const a=agg[key]||(agg[key]={skill:k,n:0,sev:0,last:l.date,subject:l.subject}); a.n++; a.sev=Math.max(a.sev,rank[w.severity]||1); if(l.date>a.last) a.last=l.date;
  }));
  const top=Object.values(agg).sort((a,b)=>b.n-a.n||b.sev-a.sev).slice(0,8);
  const sevName=["","niedrig","mittel","hoch"], sevCls=["","","warn","bad"];
  return `${top.length?`<div class="panel"><div class="panel-h"><h2>Schwachstellen-Radar <span class="label">letzte ${Math.min(6,ls.length)} Auswertungen</span></h2></div>
      <div class="radar">${top.map(a=>`<div class="radar-row"><span class="dot" style="background:${col(a.subject)}"></span><span class="radar-skill">${esc(a.skill)}</span>
        <span class="radar-bar"><i style="width:${Math.min(100,a.n/Math.max(...top.map(t=>t.n))*100)}%"></i></span><span class="mono small">${a.n}×</span><span class="chip ${sevCls[a.sev]}">${sevName[a.sev]}</span></div>`).join("")}</div></div>`:""}
    <div class="stack" style="gap:18px;margin:18px 0 22px">${ls.map(reviewCard).join("")}</div>`;
}
function pendingReviewsPanel(){
  const p=S.lessons.filter(l=>l.reviewStatus==="done"&&!l.published).sort((a,b)=>b.date.localeCompare(a.date));
  if(!p.length) return "";
  return `<div class="panel"><div class="panel-h"><h2>Auswertungen zur Freigabe <span class="label">${pad(p.length)}</span></h2></div>
    <div class="stack">${p.map(l=>`<button class="item" onclick="ui.tStudent='${l.studentId}';ui.tTab='verlauf';render()"><span class="stripe" style="--c:${col(l.subject)}"></span>
      <div class="main"><div class="t">${esc(l.topic)}</div><div class="d mono" style="font-size:12.5px">${esc(student(l.studentId)?.name||"")} · ${fmtShort(l.date)} · ${(l.review?.weaknesses||[]).length} Schwachstellen</div></div><span class="chip warn">prüfen</span></button>`).join("")}</div></div>`;
}
