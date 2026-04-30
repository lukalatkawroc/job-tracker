import { useState, useEffect, useRef } from "react";

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
  applied:           { label: "Applied",           color: "#c2410c", bg: "#fff7ed", border: "#fed7aa" },
  recruiter_session: { label: "Recruiter Session", color: "#9a3412", bg: "#ffedd5", border: "#fb923c" },
  interview:         { label: "Interview",          color: "#b45309", bg: "#fffbeb", border: "#fcd34d" },
  offer:             { label: "Offer",              color: "#15803d", bg: "#f0fdf4", border: "#86efac" },
  rejected:          { label: "Rejected",           color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb" },
  ghosted:           { label: "Ghosted",            color: "#6b7280", bg: "#f3f4f6", border: "#d1d5db" },
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
  const [sortBy, setSortBy] = useState("date");
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

  // Sort logic: rejected always at bottom, then by chosen sort
  const sorted = [...apps]
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) =>
      a.company.toLowerCase().includes(search.toLowerCase()) ||
      (a.role || "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aRej = a.status === "rejected" ? 1 : 0;
      const bRej = b.status === "rejected" ? 1 : 0;
      if (aRej !== bRej) return aRej - bRej;
      if (sortBy === "az") return a.company.localeCompare(b.company);
      return new Date(b.date) - new Date(a.date);
    });

  const counts = Object.fromEntries(Object.keys(STATUS).map((s) => [s, apps.filter((a) => a.status === s).length]));

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f0", color: "#1c1c1c", fontFamily: "'Outfit', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#eeede8}
        ::-webkit-scrollbar-thumb{background:#d1cfc8;border-radius:2px}
        input,textarea,select{font-family:inherit;}
        .fi{border:1.5px solid #e2dfd8;background:#fff;color:#1c1c1c;padding:9px 13px;border-radius:8px;width:100%;outline:none;font-size:13.5px;transition:border-color .15s,box-shadow .15s;}
        .fi:focus{border-color:#ea6c1a;box-shadow:0 0 0 3px rgba(234,108,26,0.1);}
        .row{transition:all .15s;cursor:pointer;border-radius:10px;margin-bottom:5px;border:1.5px solid transparent;}
        .row:hover{background:#fff;border-color:#e8e4dc;box-shadow:0 2px 14px rgba(0,0,0,0.06);}
        .btn{cursor:pointer;border:none;transition:all .15s;font-family:inherit;}
        .btn:hover{transform:translateY(-1px);}
        .chip{cursor:pointer;transition:all .15s;user-select:none;}
        .chip:hover{transform:translateY(-1px);}
        .sort-btn{cursor:pointer;border:none;font-family:inherit;transition:all .15s;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;}
        .sort-btn:hover{background:#efe8de;}
        @keyframes fadeSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        .fade{animation:fadeSlide .2s ease;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin .8s linear infinite;display:inline-block;}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        .pulse{animation:pulse 1.5s ease infinite;}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .toast{animation:toastIn .25s ease;}
      `}</style>

      {/* Banner image */}
      <div style={{ width: "100%", background: "#1e1b4b", overflow: "hidden", maxHeight: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img
          src="/IMG_3385.jpeg"
          alt="Job Search App - Opportunity Board by Lukasz Latka"
          style={{ width: "100%", maxWidth: 1200, objectFit: "cover", display: "block" }}
          onError={(e) => {
            e.target.style.display = "none";
            e.target.parentElement.style.background = "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e3a5f 100%)";
            e.target.parentElement.style.padding = "18px 32px";
            e.target.parentElement.innerHTML = "<div style=\"display:flex;align-items:center;gap:14px\"><div style=\"width:42px;height:42px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px\">&#127919;</div><div><div style=\"font-family:Georgia,serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px\">JOB <span style='color:#93c5fd'>SEARCH APP</span></div><div style=\"font-size:13px;color:#a5b4fc;font-style:italic;margin-top:1px\">Opportunity Board by Lukasz Latka</div></div></div>";
          }}
        />
      </div>

      {/* Sub-header */}
      <div style={{ background: "#fff", borderBottom: "1.5px solid #e8e4dc", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: loading ? "#ea6c1a" : "#16a34a", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
            {loading ? "Connecting..." : "Live"}
          </div>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: loading ? "#ea6c1a" : "#16a34a" }}/>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{apps.length} application{apps.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn" onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          style={{ background: "#ea6c1a", color: "#fff", padding: "8px 20px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, boxShadow: "0 2px 8px rgba(234,108,26,0.3)" }}>
          + New Application
        </button>
      </div>

      {/* Quick-add */}
      <div style={{ background: "#fef6ee", borderBottom: "1.5px solid #fde8d0", padding: "14px 32px" }}>
        <div style={{ fontSize: 10, color: "#ea6c1a", marginBottom: 7, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>
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
            style={{ padding: "0 22px", background: parsing ? "#fde8d0" : "#ea6c1a", color: parsing ? "#ea6c1a" : "#fff", borderRadius: 8, fontSize: 13.5, fontWeight: 600, minWidth: 90, alignSelf: "stretch", boxShadow: parsing ? "none" : "0 2px 8px rgba(234,108,26,0.25)" }}>
            {parsing ? <span className="spin">...</span> : "Add"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "#f59e50", marginTop: 6 }}>AI extracts company, role, date and links. Press Enter to submit.</div>
      </div>

      {/* Filters + Sort */}
      <div style={{ padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, background: "#fff", borderBottom: "1.5px solid #e8e4dc" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <div className="chip" onClick={() => setFilter("all")}
            style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, background: filter === "all" ? "#1c1c1c" : "#f4f4f0", color: filter === "all" ? "#fff" : "#6b7280", border: "1.5px solid " + (filter === "all" ? "#1c1c1c" : "#e8e4dc") }}>
            All ({apps.length})
          </div>
          {Object.entries(STATUS).map(([key, cfg]) => (
            <div key={key} className="chip" onClick={() => setFilter(key)}
              style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, background: filter === key ? cfg.bg : "#f4f4f0", color: filter === key ? cfg.color : "#9ca3af", border: "1.5px solid " + (filter === key ? cfg.border : "#e8e4dc") }}>
              {cfg.label}{counts[key] > 0 ? " (" + counts[key] + ")" : ""}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#9ca3af", marginRight: 4, fontWeight: 500 }}>Sort:</span>
          <button className="sort-btn" onClick={() => setSortBy("date")}
            style={{ background: sortBy === "date" ? "#fde8d0" : "transparent", color: sortBy === "date" ? "#ea6c1a" : "#6b7280" }}>
            Date
          </button>
          <button className="sort-btn" onClick={() => setSortBy("az")}
            style={{ background: sortBy === "az" ? "#fde8d0" : "transparent", color: sortBy === "az" ? "#ea6c1a" : "#6b7280" }}>
            A to Z
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 32px", background: "#fff", borderBottom: "1.5px solid #f0ede8" }}>
        <div style={{ position: "relative", maxWidth: 340 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#c4bfb8", fontSize: 14 }}>&#128269;</span>
          <input className="fi" placeholder="Search company or role..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 34, background: "#f9f8f6" }} />
        </div>
      </div>

      {/* List */}
      <div style={{ padding: "16px 32px 48px" }}>
        {loading && (
          <div className="pulse" style={{ textAlign: "center", padding: "56px 0", color: "#c4bfb8", fontSize: 14 }}>Loading from database...</div>
        )}
        {!loading && sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <div style={{ fontSize: 38, marginBottom: 12 }}>&#128203;</div>
            <div style={{ color: "#9ca3af", fontSize: 14 }}>{apps.length === 0 ? "No applications yet - use Quick Add above!" : "Nothing matches."}</div>
          </div>
        )}
        {sorted.map((app) => {
          const cfg = STATUS[app.status] || STATUS.applied;
          const isOpen = expandedId === app.id;
          const isRejected = app.status === "rejected";
          return (
            <div key={app.id} className="row"
              style={{ background: isOpen ? "#fff" : (isRejected ? "#fafaf9" : "transparent"), boxShadow: isOpen ? "0 2px 16px rgba(0,0,0,0.07)" : "none", padding: "0 16px", opacity: isRejected ? 0.6 : 1 }}>
              <div onClick={() => setExpandedId(isOpen ? null : app.id)}
                style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: 12, padding: "13px 0" }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: isRejected ? "#9ca3af" : "#1c1c1c" }}>{app.company}</div>
                  {app.role && <div style={{ fontSize: 12.5, color: "#9ca3af", marginTop: 2 }}>{app.role}</div>}
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, background: app.cvSent ? "#f0fdf4" : "#f4f4f0", color: app.cvSent ? "#16a34a" : "#d1d5db", fontWeight: 700, border: "1px solid " + (app.cvSent ? "#86efac" : "#e8e4dc") }}>CV</span>
                  <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, background: app.coverLetterSent ? "#f0fdf4" : "#f4f4f0", color: app.coverLetterSent ? "#16a34a" : "#d1d5db", fontWeight: 700, border: "1px solid " + (app.coverLetterSent ? "#86efac" : "#e8e4dc") }}>CL</span>
                </div>
                <div style={{ fontSize: 12, color: "#c4bfb8", minWidth: 86, textAlign: "right" }}>{app.date}</div>
                <div style={{ padding: "4px 11px", borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11.5, fontWeight: 700, textAlign: "center", minWidth: 100, whiteSpace: "nowrap", border: "1.5px solid " + cfg.border }}>{cfg.label}</div>
                <div style={{ color: "#d1cfc8", fontSize: 11, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s" }}>&#9654;</div>
              </div>

              {isOpen && (
                <div className="fade" style={{ paddingBottom: 16, borderTop: "1px solid #f0ede8", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {(app.cvLink || app.coverLetterLink) && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {app.cvLink && <a href={app.cvLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#ea6c1a", background: "#fef6ee", padding: "6px 14px", borderRadius: 7, textDecoration: "none", fontWeight: 600, border: "1px solid #fde8d0" }}>CV Document &#8599;</a>}
                      {app.coverLetterLink && <a href={app.coverLetterLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#c2410c", background: "#fff7ed", padding: "6px 14px", borderRadius: 7, textDecoration: "none", fontWeight: 600, border: "1px solid #fed7aa" }}>Cover Letter &#8599;</a>}
                    </div>
                  )}
                  {app.notes && (
                    <div style={{ background: "#f9f8f6", border: "1.5px solid #e8e4dc", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#6b7280", lineHeight: 1.65 }}>
                      <div style={{ fontSize: 10.5, color: "#c4bfb8", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>Notes</div>
                      {app.notes}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => startEdit(app)} style={{ padding: "7px 16px", background: "#fef6ee", color: "#ea6c1a", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "1px solid #fde8d0" }}>Edit</button>
                    <button className="btn" onClick={() => deleteApp(app.id)} style={{ padding: "7px 16px", background: "#fef2f2", color: "#dc2626", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "1px solid #fecaca" }}>Delete</button>
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
          style={{ position: "fixed", inset: 0, background: "rgba(28,28,28,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, backdropFilter: "blur(4px)" }}>
          <div className="fade" style={{ background: "#fff", border: "1.5px solid #e8e4dc", borderRadius: 14, padding: 28, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 800, color: "#1c1c1c", marginBottom: 20 }}>
              {editId ? "Edit Application" : "New Application"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Company *"><input className="fi" placeholder="e.g. Google" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}/></Field>
              <Field label="Role"><input className="fi" placeholder="e.g. Product Manager" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}/></Field>
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
                  style={{ flex: 1, padding: "11px", background: "#ea6c1a", color: "#fff", borderRadius: 9, fontSize: 14, fontWeight: 700, boxShadow: "0 2px 8px rgba(234,108,26,0.3)" }}>
                  {editId ? "Save Changes" : "Add Application"}
                </button>
                <button className="btn" onClick={() => { setShowForm(false); setEditId(null); }}
                  style={{ padding: "11px 18px", background: "#f4f4f0", color: "#6b7280", borderRadius: 9, fontSize: 14, fontWeight: 500 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "err" ? "#fef2f2" : "#f0fdf4",
          color: toast.type === "err" ? "#dc2626" : "#16a34a",
          border: "1.5px solid " + (toast.type === "err" ? "#fecaca" : "#86efac"),
          padding: "10px 22px", borderRadius: 10, fontSize: 13.5, zIndex: 200, whiteSpace: "nowrap",
          fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11.5, color: "#9ca3af", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#6b7280", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "#ea6c1a", width: 15, height: 15 }}/>
      {label}
    </label>
  );
}
