import { useState, useEffect, useRef } from "react";

// Supabase config
const SUPABASE_URL = "https://yoerfdvvtokunrmcjfri.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvZXJmZHZ2dG9rdW5ybWNqZnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjYyMTIsImV4cCI6MjA5MDAwMjIxMn0.KxqXBqctZUFTrwLmU7QvAfaRzUAabz7ZMSqovgbKcms";
const HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON,
  "Authorization": "Bearer " + SUPABASE_ANON
};
const DB = SUPABASE_URL + "/rest/v1/applications";

const toRow = (a) => ({
  company: a.company, role: a.role, status: a.status, date: a.date,
  cv_sent: a.cvSent, cover_letter_sent: a.coverLetterSent,
  cv_link: a.cvLink, cover_letter_link: a.coverLetterLink, notes: a.notes,
});
const fromRow = (r) => ({
  id: r.id, company: r.company, role: r.role || "", status: r.status,
  date: r.date, cvSent: r.cv_sent, coverLetterSent: r.cover_letter_sent,
  cvLink: r.cv_link || "", coverLetterLink: r.cover_letter_link || "", notes: r.notes || "",
});

async function dbFetch() {
  const res = await fetch(DB + "?order=created_at.desc", { headers: { ...HEADERS, "Prefer": "return=representation" } });
  const data = await res.json();
  return data.map(fromRow);
}
async function dbInsert(app) {
  const res = await fetch(DB, { method: "POST", headers: { ...HEADERS, "Prefer": "return=representation" }, body: JSON.stringify(toRow(app)) });
  const data = await res.json();
  return fromRow(data[0]);
}
async function dbUpdate(id, app) {
  await fetch(DB + "?id=eq." + id, { method: "PATCH", headers: HEADERS, body: JSON.stringify(toRow(app)) });
}
async function dbDelete(id) {
  await fetch(DB + "?id=eq." + id, { method: "DELETE", headers: HEADERS });
}

const STATUS = {
  applied:           { label: "Applied",           color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  recruiter_session: { label: "Recruiter Session", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  interview:         { label: "Interview",          color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  offer:             { label: "Offer",              color: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
  rejected:          { label: "Rejected",           color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  ghosted:           { label: "Ghosted",            color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
};

const EMPTY = {
  company: "", role: "", status: "applied",
  date: new Date().toISOString().slice(0, 10),
  cvSent: false, coverLetterSent: false,
  cvLink: "", coverLetterLink: "", notes: "",
};

async function parseWithAI(raw) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = "Extract job application info from this text and return ONLY a valid JSON object (no markdown, no explanation).\nText: \"" + raw + "\"\nReturn this exact shape:\n{\"company\":\"Company name or empty string\",\"role\":\"Job title or empty string\",\"date\":\"YYYY-MM-DD use today (" + today + ") if not specified\",\"cvSent\":true,\"coverLetterSent\":false,\"cvLink\":\"URL if mentioned else empty string\",\"coverLetterLink\":\"URL if mentioned else empty string\",\"notes\":\"Any extra info\"}";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = data.content?.map((b) => b.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export default function JobTracker() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [quickText, setQuickText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [toast, setToast] = useState(null);
  const inputRef = useRef();

  useEffect(() => {
    dbFetch()
      .then((data) => { setApps(data); setLoading(false); })
      .catch(() => { showToast("Could not connect to database", "err"); setLoading(false); });
  }, []);

  const showToast = (msg, type) => {
    setToast({ msg, type: type || "ok" });
    setTimeout(() => setToast(null), 3200);
  };

  const handleQuickAdd = async () => {
    const text = quickText.trim();
    if (!text) return;
    setParsing(true);
    try {
      const parsed = await parseWithAI(text);
      const saved = await dbInsert({ ...EMPTY, ...parsed, status: "applied" });
      setApps((prev) => [saved, ...prev]);
      setQuickText("");
      showToast("Added " + (saved.company || "application"));
    } catch (e) {
      showToast("Could not parse - try the form instead", "err");
    }
    setParsing(false);
  };

  const handleQuickKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuickAdd(); }
  };

  const submit = async () => {
    if (!form.company.trim()) return;
    try {
      if (editId !== null) {
        await dbUpdate(editId, form);
        setApps((prev) => prev.map((a) => a.id === editId ? { ...form, id: editId } : a));
        setEditId(null);
        showToast("Application updated");
      } else {
        const saved = await dbInsert(form);
        setApps((prev) => [saved, ...prev]);
        showToast("Added " + saved.company);
      }
    } catch (e) {
      showToast("Save failed - check your connection", "err");
    }
    setForm(EMPTY);
    setShowForm(false);
  };

  const deleteApp = async (id) => {
    try {
      await dbDelete(id);
      setApps((prev) => prev.filter((a) => a.id !== id));
      showToast("Deleted");
    } catch (e) {
      showToast("Delete failed", "err");
    }
  };

  const startEdit = (app) => {
    setForm({ ...app });
    setEditId(app.id);
    setShowForm(true);
    setExpandedId(null);
  };

  const filtered = apps
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) =>
      a.company.toLowerCase().includes(search.toLowerCase()) ||
      (a.role || "").toLowerCase().includes(search.toLowerCase())
    );

  const counts = Object.fromEntries(Object.keys(STATUS).map((s) => [s, apps.filter((a) => a.status === s).length]));

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#1e293b", fontFamily: "'Outfit', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Lora:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:#f1f5f9}
        ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
        input,textarea,select{font-family:inherit;}
        .fi{border:1.5px solid #e2e8f0;background:#fff;color:#1e293b;padding:9px 13px;border-radius:8px;width:100%;outline:none;font-size:13.5px;transition:border-color .15s,box-shadow .15s;}
        .fi:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,0.1);}
        .row{transition:background .15s,box-shadow .15s;cursor:pointer;border-radius:10px;margin-bottom:6px;}
        .row:hover{background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.07);}
        .btn{cursor:pointer;border:none;transition:all .15s;font-family:inherit;}
        .btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.1);}
        .chip{cursor:pointer;transition:all .15s;user-select:none;}
        .chip:hover{transform:translateY(-1px);}
        @keyframes fadeSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        .fade{animation:fadeSlide .2s ease;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin .8s linear infinite;display:inline-block;}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        .pulse{animation:pulse 1.5s ease infinite;}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .toast{animation:toastIn .25s ease;}
      `}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1.5px solid #e2e8f0", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 38, height: 38, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>&#127919;</div>
          <div>
            <div style={{ fontFamily: "'Lora', serif", fontSize: 21, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.3px", lineHeight: 1.2 }}>Opportunity Board</div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400, letterSpacing: ".01em" }}>
              created by Lukasz Latka &nbsp;&middot;&nbsp; <span style={{ color: loading ? "#f59e0b" : "#10b981", fontWeight: 500 }}>{loading ? "connecting..." : "live"}</span>
            </div>
          </div>
        </div>
        <button className="btn" onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", padding: "9px 20px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, letterSpacing: ".01em", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>
          + New Application
        </button>
      </div>

      {/* Quick-add */}
      <div style={{ background: "linear-gradient(135deg, #eef2ff, #f5f3ff)", borderBottom: "1.5px solid #e0e7ff", padding: "16px 32px" }}>
        <div style={{ fontSize: 11, color: "#6366f1", marginBottom: 8, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>
          Quick Add
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            ref={inputRef}
            className="fi"
            rows={2}
            placeholder="Company: Acme, Position: Designer, CV sent, cover letter: https://..."
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={handleQuickKey}
            style={{ resize: "none", flex: 1, background: "rgba(255,255,255,0.8)" }}
          />
          <button className="btn" onClick={handleQuickAdd} disabled={parsing}
            style={{ padding: "0 22px", background: parsing ? "#e0e7ff" : "linear-gradient(135deg, #6366f1, #8b5cf6)", color: parsing ? "#6366f1" : "#fff", borderRadius: 9, fontSize: 13.5, fontWeight: 600, minWidth: 90, alignSelf: "stretch", boxShadow: parsing ? "none" : "0 2px 8px rgba(99,102,241,0.25)" }}>
            {parsing ? <span className="spin">...</span> : "Add"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "#818cf8", marginTop: 7 }}>AI extracts company, role, date and links automatically. Press Enter to submit.</div>
      </div>

      {/* Filters */}
      <div style={{ padding: "14px 32px", display: "flex", gap: 7, flexWrap: "wrap", background: "#fff", borderBottom: "1.5px solid #e2e8f0" }}>
        <div className="chip" onClick={() => setFilter("all")}
          style={{ padding: "5px 13px", borderRadius: 20, fontSize: 12.5, fontWeight: 500, background: filter === "all" ? "#0f172a" : "#f1f5f9", color: filter === "all" ? "#fff" : "#64748b", border: "1.5px solid " + (filter === "all" ? "#0f172a" : "#e2e8f0") }}>
          All ({apps.length})
        </div>
        {Object.entries(STATUS).map(([key, cfg]) => (
          <div key={key} className="chip" onClick={() => setFilter(key)}
            style={{ padding: "5px 13px", borderRadius: 20, fontSize: 12.5, fontWeight: 500, background: filter === key ? cfg.bg : "#f8fafc", color: filter === key ? cfg.color : "#94a3b8", border: "1.5px solid " + (filter === key ? cfg.border : "#e2e8f0") }}>
            {cfg.label}{counts[key] > 0 ? " (" + counts[key] + ")" : ""}
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: "12px 32px", background: "#fff", borderBottom: "1.5px solid #f1f5f9" }}>
        <div style={{ position: "relative", maxWidth: 340 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 14 }}>&#128269;</span>
          <input className="fi" placeholder="Search company or role..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
      </div>

      {/* List */}
      <div style={{ padding: "16px 32px 48px" }}>
        {loading && (
          <div className="pulse" style={{ textAlign: "center", padding: "56px 0", color: "#94a3b8", fontSize: 14 }}>Loading from database...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#128203;</div>
            <div style={{ color: "#94a3b8", fontSize: 14 }}>{apps.length === 0 ? "No applications yet - use Quick Add above!" : "Nothing matches your filter."}</div>
          </div>
        )}
        {filtered.map((app) => {
          const cfg = STATUS[app.status] || STATUS.applied;
          const isOpen = expandedId === app.id;
          return (
            <div key={app.id} className="row" style={{ background: isOpen ? "#fff" : "transparent", boxShadow: isOpen ? "0 2px 16px rgba(0,0,0,0.08)" : "none", padding: "0 16px", border: isOpen ? "1.5px solid #e2e8f0" : "1.5px solid transparent" }}>
              <div onClick={() => setExpandedId(isOpen ? null : app.id)}
                style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: 12, padding: "14px 0" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>{app.company}</div>
                  {app.role && <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 2, fontWeight: 400 }}>{app.role}</div>}
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: app.cvSent ? "#ecfdf5" : "#f8fafc", color: app.cvSent ? "#059669" : "#cbd5e1", fontWeight: 600, border: "1px solid " + (app.cvSent ? "#a7f3d0" : "#e2e8f0") }}>CV</span>
                  <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: app.coverLetterSent ? "#ecfdf5" : "#f8fafc", color: app.coverLetterSent ? "#059669" : "#cbd5e1", fontWeight: 600, border: "1px solid " + (app.coverLetterSent ? "#a7f3d0" : "#e2e8f0") }}>CL</span>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", minWidth: 86, textAlign: "right" }}>{app.date}</div>
                <div style={{ padding: "4px 11px", borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11.5, fontWeight: 600, textAlign: "center", minWidth: 100, whiteSpace: "nowrap", border: "1.5px solid " + cfg.border }}>{cfg.label}</div>
                <div style={{ color: "#cbd5e1", fontSize: 11, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s" }}>&#9654;</div>
              </div>

              {isOpen && (
                <div className="fade" style={{ paddingBottom: 16, borderTop: "1px solid #f1f5f9", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {(app.cvLink || app.coverLetterLink) && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {app.cvLink && <a href={app.cvLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#6366f1", background: "#eef2ff", padding: "6px 14px", borderRadius: 7, textDecoration: "none", fontWeight: 500, border: "1px solid #e0e7ff" }}>CV Document &#8599;</a>}
                      {app.coverLetterLink && <a href={app.coverLetterLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#7c3aed", background: "#f5f3ff", padding: "6px 14px", borderRadius: 7, textDecoration: "none", fontWeight: 500, border: "1px solid #ede9fe" }}>Cover Letter &#8599;</a>}
                    </div>
                  )}
                  {app.notes && (
                    <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#475569", lineHeight: 1.65 }}>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>Notes</div>
                      {app.notes}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => startEdit(app)} style={{ padding: "7px 16px", background: "#eef2ff", color: "#6366f1", borderRadius: 7, fontSize: 13, fontWeight: 600 }}>Edit</button>
                    <button className="btn" onClick={() => deleteApp(app.id)} style={{ padding: "7px 16px", background: "#fef2f2", color: "#dc2626", borderRadius: 7, fontSize: 13, fontWeight: 600 }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {showForm && (
        <div onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setEditId(null); } }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, backdropFilter: "blur(4px)" }}>
          <div className="fade" style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: 28, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ fontFamily: "'Lora', serif", fontSize: 22, fontWeight: 700, color: "#0f172a", marginBottom: 20 }}>
              {editId ? "Edit Application" : "New Application"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Company *"><input className="fi" placeholder="e.g. Google" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}/></Field>
              <Field label="Role"><input className="fi" placeholder="e.g. Product Designer" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}/></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Date Applied"><input className="fi" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}/></Field>
                <Field label="Status">
                  <select className="fi" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                <Check label="CV sent" checked={form.cvSent} onChange={(v) => setForm((f) => ({ ...f, cvSent: v }))}/>
                <Check label="Cover Letter sent" checked={form.coverLetterSent} onChange={(v) => setForm((f) => ({ ...f, coverLetterSent: v }))}/>
              </div>
              <Field label="CV Link"><input className="fi" placeholder="https://..." value={form.cvLink} onChange={(e) => setForm((f) => ({ ...f, cvLink: e.target.value }))}/></Field>
              <Field label="Cover Letter Link"><input className="fi" placeholder="https://..." value={form.coverLetterLink} onChange={(e) => setForm((f) => ({ ...f, coverLetterLink: e.target.value }))}/></Field>
              <Field label="Notes"><textarea className="fi" rows={3} placeholder="Contacts, impressions, next steps..." value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }}/></Field>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button className="btn" onClick={submit}
                  style={{ flex: 1, padding: "11px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", borderRadius: 9, fontSize: 14, fontWeight: 600, boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>
                  {editId ? "Save Changes" : "Add Application"}
                </button>
                <button className="btn" onClick={() => { setShowForm(false); setEditId(null); }}
                  style={{ padding: "11px 18px", background: "#f1f5f9", color: "#64748b", borderRadius: 9, fontSize: 14, fontWeight: 500 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "err" ? "#fef2f2" : "#ecfdf5",
          color: toast.type === "err" ? "#dc2626" : "#059669",
          border: "1.5px solid " + (toast.type === "err" ? "#fecaca" : "#a7f3d0"),
          padding: "10px 22px", borderRadius: 10, fontSize: 13.5, zIndex: 200, whiteSpace: "nowrap",
          fontWeight: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11.5, color: "#64748b", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#475569", cursor: "pointer", fontWeight: 400 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "#6366f1", width: 15, height: 15 }}/>
      {label}
    </label>
  );
}
