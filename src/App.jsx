import { useState, useEffect, useRef } from “react”;

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPABASE_URL = “https://yoerfdvvtokunrmcjfri.supabase.co”;
const SUPABASE_ANON = “eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvZXJmZHZ2dG9rdW5ybWNqZnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjYyMTIsImV4cCI6MjA5MDAwMjIxMn0.KxqXBqctZUFTrwLmU7QvAfaRzUAabz7ZMSqovgbKcms”;
const HEADERS = { “Content-Type”: “application/json”, “apikey”: SUPABASE_ANON, “Authorization”: `Bearer ${SUPABASE_ANON}` };
const DB = `${SUPABASE_URL}/rest/v1/applications`;

// ── DB helpers ────────────────────────────────────────────────────────────────
const toRow = (a) => ({
company: a.company, role: a.role, status: a.status, date: a.date,
cv_sent: a.cvSent, cover_letter_sent: a.coverLetterSent,
cv_link: a.cvLink, cover_letter_link: a.coverLetterLink, notes: a.notes,
});
const fromRow = (r) => ({
id: r.id, company: r.company, role: r.role || “”, status: r.status,
date: r.date, cvSent: r.cv_sent, coverLetterSent: r.cover_letter_sent,
cvLink: r.cv_link || “”, coverLetterLink: r.cover_letter_link || “”, notes: r.notes || “”,
});

async function dbFetch() {
const res = await fetch(`${DB}?order=created_at.desc`, { headers: { …HEADERS, “Prefer”: “return=representation” } });
const data = await res.json();
return data.map(fromRow);
}
async function dbInsert(app) {
const res = await fetch(DB, { method: “POST”, headers: { …HEADERS, “Prefer”: “return=representation” }, body: JSON.stringify(toRow(app)) });
const data = await res.json();
return fromRow(data[0]);
}
async function dbUpdate(id, app) {
await fetch(`${DB}?id=eq.${id}`, { method: “PATCH”, headers: HEADERS, body: JSON.stringify(toRow(app)) });
}
async function dbDelete(id) {
await fetch(`${DB}?id=eq.${id}`, { method: “DELETE”, headers: HEADERS });
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS = {
applied:           { label: “Applied”,           color: “#6B9FD4”, bg: “#0e1a2b” },
recruiter_session: { label: “Recruiter Session”, color: “#C9A0E8”, bg: “#1e1030” },
interview:         { label: “Interview”,          color: “#F0C84A”, bg: “#271f08” },
offer:             { label: “Offer”,              color: “#5ECFA0”, bg: “#082519” },
rejected:          { label: “Rejected”,           color: “#E07070”, bg: “#2a0e0e” },
ghosted:           { label: “Ghosted”,            color: “#666”,    bg: “#161616” },
};

const EMPTY = {
company: “”, role: “”, status: “applied”,
date: new Date().toISOString().slice(0, 10),
cvSent: false, coverLetterSent: false,
cvLink: “”, coverLetterLink: “”, notes: “”,
};

// ── AI parse ──────────────────────────────────────────────────────────────────
async function parseWithAI(raw) {
const today = new Date().toISOString().slice(0, 10);
const prompt = `Extract job application info from this text and return ONLY a valid JSON object (no markdown, no explanation). Text: "${raw}" Return this exact shape: {"company":"Company name or empty string","role":"Job title or empty string","date":"YYYY-MM-DD use today (${today}) if not specified","cvSent":true or false,"coverLetterSent":true or false,"cvLink":"URL if mentioned else empty string","coverLetterLink":"URL if mentioned else empty string","notes":"Any extra info"}`;

const res = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify({ model: “claude-sonnet-4-20250514”, max_tokens: 500, messages: [{ role: “user”, content: prompt }] }),
});
const data = await res.json();
const text = data.content?.map(b => b.text || “”).join(””) || “”;
return JSON.parse(text.replace(/`json|`/g, “”).trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function JobTracker() {
const [apps, setApps] = useState([]);
const [loading, setLoading] = useState(true);
const [showForm, setShowForm] = useState(false);
const [form, setForm] = useState(EMPTY);
const [editId, setEditId] = useState(null);
const [filter, setFilter] = useState(“all”);
const [expandedId, setExpandedId] = useState(null);
const [search, setSearch] = useState(””);
const [quickText, setQuickText] = useState(””);
const [parsing, setParsing] = useState(false);
const [toast, setToast] = useState(null);
const inputRef = useRef();

// Load from DB on mount
useEffect(() => {
dbFetch().then(data => { setApps(data); setLoading(false); })
.catch(() => { showToast(“Could not connect to database”, “err”); setLoading(false); });
}, []);

const showToast = (msg, type = “ok”) => {
setToast({ msg, type });
setTimeout(() => setToast(null), 3200);
};

// Quick add
const handleQuickAdd = async () => {
const text = quickText.trim();
if (!text) return;
setParsing(true);
try {
const parsed = await parseWithAI(text);
const saved = await dbInsert({ …EMPTY, …parsed, status: “applied” });
setApps(prev => [saved, …prev]);
setQuickText(””);
showToast(`Added "${saved.company || "application"}" to the board`);
} catch {
showToast(“Could not parse — try the form instead”, “err”);
}
setParsing(false);
};

const handleQuickKey = (e) => {
if (e.key === “Enter” && !e.shiftKey) { e.preventDefault(); handleQuickAdd(); }
};

// Form submit
const submit = async () => {
if (!form.company.trim()) return;
try {
if (editId !== null) {
await dbUpdate(editId, form);
setApps(prev => prev.map(a => a.id === editId ? { …form, id: editId } : a));
setEditId(null);
showToast(“Application updated”);
} else {
const saved = await dbInsert(form);
setApps(prev => [saved, …prev]);
showToast(`Added "${saved.company}"`);
}
} catch {
showToast(“Save failed — check your connection”, “err”);
}
setForm(EMPTY); setShowForm(false);
};

const deleteApp = async (id) => {
try {
await dbDelete(id);
setApps(prev => prev.filter(a => a.id !== id));
showToast(“Deleted”);
} catch { showToast(“Delete failed”, “err”); }
};

const startEdit = (app) => {
setForm({ …app }); setEditId(app.id);
setShowForm(true); setExpandedId(null);
};

const filtered = apps
.filter(a => filter === “all” || a.status === filter)
.filter(a =>
a.company.toLowerCase().includes(search.toLowerCase()) ||
(a.role || “”).toLowerCase().includes(search.toLowerCase())
);

const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, apps.filter(a => a.status === s).length]));

return (
<div style={{ minHeight: “100vh”, background: “#09090f”, color: “#ddd8ce”, fontFamily: “‘DM Mono’,monospace” }}>
<style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Playfair+Display:wght@700;900&display=swap'); *{box-sizing:border-box;margin:0;padding:0;} ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d0d14}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:2px} input,textarea,select{font-family:inherit;} .fi{border:1px solid #1e1e2e;background:#0d0d18;color:#ddd8ce;padding:8px 12px;border-radius:5px;width:100%;outline:none;font-size:13px;} .fi:focus{border-color:#6B9FD4;} .row{transition:background .15s;cursor:pointer;} .row:hover{background:#111120;} .btn{cursor:pointer;border:none;transition:opacity .15s;} .btn:hover{opacity:.78;} .chip{cursor:pointer;transition:all .15s;} @keyframes fadeSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}} .fade{animation:fadeSlide .2s ease;} @keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin .8s linear infinite;display:inline-block;} @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}} .pulse{animation:pulse 1.5s ease infinite;}`}</style>

```
  {/* Header */}
  <div style={{ background:"#07070d", borderBottom:"1px solid #161625", padding:"22px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
    <div>
      <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, fontWeight:900, color:"#fff", letterSpacing:"-0.5px" }}>Job Hunt</div>
      <div style={{ fontSize:11, color:"#444", marginTop:2, letterSpacing:".1em", textTransform:"uppercase" }}>
        Application Registry · <span style={{ color: loading ? "#F0C84A" : "#5ECFA0" }}>{loading ? "connecting…" : "live"}</span>
      </div>
    </div>
    <button className="btn" onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
      style={{ background:"#6B9FD4", color:"#07070d", padding:"9px 18px", borderRadius:6, fontFamily:"inherit", fontSize:13, fontWeight:500 }}>
      + New Application
    </button>
  </div>

  {/* Quick-add */}
  <div style={{ background:"#0b0b16", borderBottom:"1px solid #161625", padding:"14px 28px" }}>
    <div style={{ fontSize:10, color:"#3a3a5a", marginBottom:7, letterSpacing:".12em", textTransform:"uppercase" }}>⚡ Quick Add — paste info and press Enter</div>
    <div style={{ display:"flex", gap:8 }}>
      <textarea ref={inputRef} className="fi" rows={2}
        placeholder="Company: Acme, Position: Designer, CV sent, cover letter: https://…"
        value={quickText} onChange={e => setQuickText(e.target.value)} onKeyDown={handleQuickKey}
        style={{ resize:"none", flex:1 }} />
      <button className="btn" onClick={handleQuickAdd} disabled={parsing}
        style={{ padding:"0 20px", background:parsing?"#1e2535":"#6B9FD4", color:parsing?"#6B9FD4":"#07070d", borderRadius:6, fontSize:13, fontWeight:500, minWidth:80, alignSelf:"stretch" }}>
        {parsing ? <span className="spin">⟳</span> : "Add"}
      </button>
    </div>
    <div style={{ fontSize:11, color:"#2a2a44", marginTop:6 }}>AI extracts company, role, date, CV/CL links — saved instantly to database</div>
  </div>

  {/* Filters */}
  <div style={{ padding:"12px 28px", display:"flex", gap:6, flexWrap:"wrap", borderBottom:"1px solid #13131e" }}>
    <div className="chip" onClick={() => setFilter("all")}
      style={{ padding:"4px 11px", borderRadius:20, fontSize:11, background:filter==="all"?"#1e1e30":"#111", color:filter==="all"?"#fff":"#444", border:filter==="all"?"1px solid #555":"1px solid transparent" }}>
      All ({apps.length})
    </div>
    {Object.entries(STATUS).map(([key, cfg]) => (
      <div key={key} className="chip" onClick={() => setFilter(key)}
        style={{ padding:"4px 11px", borderRadius:20, fontSize:11, background:filter===key?cfg.bg:"#111", color:filter===key?cfg.color:"#444", border:filter===key?`1px solid ${cfg.color}`:"1px solid transparent" }}>
        {cfg.label}{counts[key] > 0 ? ` (${counts[key]})` : ""}
      </div>
    ))}
  </div>

  {/* Search */}
  <div style={{ padding:"10px 28px", borderBottom:"1px solid #13131e" }}>
    <input className="fi" placeholder="Search company or role…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth:320 }} />
  </div>

  {/* List */}
  <div style={{ padding:"0 28px 48px" }}>
    {loading && (
      <div className="pulse" style={{ textAlign:"center", padding:"56px 0", color:"#2a2a4a", fontSize:13 }}>Loading from database…</div>
    )}
    {!loading && filtered.length === 0 && (
      <div style={{ textAlign:"center", padding:"56px 0", color:"#2a2a3a", fontSize:13 }}>
        {apps.length === 0 ? "No applications yet — use Quick Add above!" : "Nothing matches."}
      </div>
    )}
    {filtered.map(app => {
      const cfg = STATUS[app.status] || STATUS.applied;
      const isOpen = expandedId === app.id;
      return (
        <div key={app.id} style={{ borderBottom:"1px solid #111120" }}>
          <div className="row" onClick={() => setExpandedId(isOpen ? null : app.id)}
            style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto auto", alignItems:"center", gap:10, padding:"13px 0" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:500, color:"#f0ece4" }}>{app.company}</div>
              {app.role && <div style={{ fontSize:12, color:"#444", marginTop:2 }}>{app.role}</div>}
            </div>
            <div style={{ display:"flex", gap:4 }}>
              <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3, background:app.cvSent?"#0a2018":"#111", color:app.cvSent?"#5ECFA0":"#2a2a3a" }}>CV</span>
              <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3, background:app.coverLetterSent?"#0a2018":"#111", color:app.coverLetterSent?"#5ECFA0":"#2a2a3a" }}>CL</span>
            </div>
            <div style={{ fontSize:11, color:"#383838", minWidth:86, textAlign:"right" }}>{app.date}</div>
            <div style={{ padding:"3px 9px", borderRadius:4, background:cfg.bg, color:cfg.color, fontSize:10, letterSpacing:".05em", textAlign:"center", minWidth:90, whiteSpace:"nowrap" }}>{cfg.label}</div>
            <div style={{ color:"#2a2a3a", fontSize:11, transform:isOpen?"rotate(90deg)":"none", transition:"transform .2s" }}>▶</div>
          </div>

          {isOpen && (
            <div className="fade" style={{ paddingBottom:14, display:"flex", flexDirection:"column", gap:10 }}>
              {(app.cvLink || app.coverLetterLink) && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {app.cvLink && <a href={app.cvLink} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"#6B9FD4", background:"#0e1a2b", padding:"5px 12px", borderRadius:4, textDecoration:"none" }}>CV Document →</a>}
                  {app.coverLetterLink && <a href={app.coverLetterLink} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"#C9A0E8", background:"#1e1030", padding:"5px 12px", borderRadius:4, textDecoration:"none" }}>Cover Letter →</a>}
                </div>
              )}
              {app.notes && (
                <div style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:5, padding:"10px 12px", fontSize:12, color:"#666", lineHeight:1.6 }}>
                  <div style={{ fontSize:10, color:"#333", marginBottom:5, textTransform:"uppercase", letterSpacing:".1em" }}>Notes</div>
                  {app.notes}
                </div>
              )}
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn" onClick={() => startEdit(app)} style={{ padding:"7px 14px", background:"#1e2535", color:"#6B9FD4", borderRadius:5, fontSize:12, fontFamily:"inherit" }}>Edit</button>
                <button className="btn" onClick={() => deleteApp(app.id)} style={{ padding:"7px 14px", background:"#2a0e0e", color:"#E07070", borderRadius:5, fontSize:12, fontFamily:"inherit" }}>Delete</button>
              </div>
            </div>
          )}
        </div>
      );
    })}
  </div>

  {/* Modal */}
  {showForm && (
    <div onClick={e => { if (e.target===e.currentTarget){setShowForm(false);setEditId(null);} }}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
      <div style={{ background:"#0e0e1a", border:"1px solid #2a2a3a", borderRadius:10, padding:26, width:"100%", maxWidth:500, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"#fff", marginBottom:18 }}>
          {editId ? "Edit Application" : "New Application"}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
          <Field label="Company *"><input className="fi" placeholder="e.g. Anthropic" value={form.company} onChange={e=>setForm(f=>({...f,company:e.target.value}))}/></Field>
          <Field label="Role"><input className="fi" placeholder="e.g. Product Designer" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}/></Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Date Applied"><input className="fi" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>
            <Field label="Status">
              <select className="fi" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display:"flex", gap:20 }}>
            <Check label="CV sent" checked={form.cvSent} onChange={v=>setForm(f=>({...f,cvSent:v}))}/>
            <Check label="Cover Letter sent" checked={form.coverLetterSent} onChange={v=>setForm(f=>({...f,coverLetterSent:v}))}/>
          </div>
          <Field label="CV Link"><input className="fi" placeholder="https://…" value={form.cvLink} onChange={e=>setForm(f=>({...f,cvLink:e.target.value}))}/></Field>
          <Field label="Cover Letter Link"><input className="fi" placeholder="https://…" value={form.coverLetterLink} onChange={e=>setForm(f=>({...f,coverLetterLink:e.target.value}))}/></Field>
          <Field label="Notes"><textarea className="fi" rows={3} placeholder="Contacts, impressions, next steps…" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:"vertical"}}/></Field>
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            <button className="btn" onClick={submit} style={{ flex:1, padding:"10px", background:"#6B9FD4", color:"#07070d", borderRadius:6, fontFamily:"inherit", fontSize:13, fontWeight:500 }}>
              {editId ? "Save Changes" : "Add Application"}
            </button>
            <button className="btn" onClick={()=>{setShowForm(false);setEditId(null);}} style={{ padding:"10px 16px", background:"#1e1e2e", color:"#666", borderRadius:6, fontFamily:"inherit", fontSize:13 }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )}

  {/* Toast */}
  {toast && (
    <div className="fade" style={{
      position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
      background:toast.type==="err"?"#2a0e0e":"#0a2018",
      color:toast.type==="err"?"#E07070":"#5ECFA0",
      border:`1px solid ${toast.type==="err"?"#E07070":"#5ECFA0"}`,
      padding:"10px 20px", borderRadius:8, fontSize:13, zIndex:200, whiteSpace:"nowrap",
    }}>{toast.msg}</div>
  )}
</div>
```

);
}

function Field({ label, children }) {
return (
<div>
<label style={{ fontSize:11, color:”#444”, display:“block”, marginBottom:5, textTransform:“uppercase”, letterSpacing:”.08em” }}>{label}</label>
{children}
</div>
);
}
function Check({ label, checked, onChange }) {
return (
<label style={{ display:“flex”, alignItems:“center”, gap:7, fontSize:13, color:”#888”, cursor:“pointer” }}>
<input type=“checkbox” checked={checked} onChange={e=>onChange(e.target.checked)} style={{ accentColor:”#6B9FD4”, width:14, height:14 }}/>
{label}
</label>
);
}
