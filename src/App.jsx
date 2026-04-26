import { useState, useRef, useEffect } from "react";

// ─── Persistent DB (survives page refresh) ───────────────────────────────────
function loadDB() {
  try {
    const saved = localStorage.getItem("kyc_db");
    if (saved) {
      const parsed = JSON.parse(saved);
      return { clients: parsed.clients || [], admins: parsed.admins || [{ email: "admin@kyc.com", password: "admin123", role: "admin" }] };
    }
  } catch {}
  return { clients: [], admins: [{ email: "admin@kyc.com", password: "admin123", role: "admin" }] };
}

function saveDB() {
  try { localStorage.setItem("kyc_db", JSON.stringify({ clients: DB.clients, admins: DB.admins })); } catch {}
}

const DB = loadDB();

const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const toBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
// ─── Location Permission Manager ─────────────────────────────────────────────
// Stores: { lat, lng, timestamp, status: "granted"|"denied"|"unavailable" }
const LOC_KEY = "kyc_location";

function getSavedLocation() {
  try { return JSON.parse(localStorage.getItem(LOC_KEY)); } catch { return null; }
}

function saveLocation(lat, lng) {
  const loc = { lat, lng, timestamp: Date.now(), status: "granted" };
  try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch {}
  return loc;
}

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ status: "unavailable" }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = saveLocation(
          pos.coords.latitude.toFixed(6),
          pos.coords.longitude.toFixed(6)
        );
        resolve(loc);
      },
      () => {
        // Simulate coords for demo environment
        const lat = (12.9716 + Math.random() * 0.01).toFixed(6);
        const lng = (77.5946 + Math.random() * 0.01).toFixed(6);
        const loc = saveLocation(lat, lng);
        loc.status = "simulated";
        resolve(loc);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

async function ensureLocation() {
  const saved = getSavedLocation();
  // Reuse if granted within last 30 minutes
  if (saved && saved.status !== "unavailable" && Date.now() - saved.timestamp < 30 * 60 * 1000) {
    return saved;
  }
  return requestLocation();
}

// ─── Mock GST API ─────────────────────────────────────────────────────────────
// Any valid 15-char GSTIN → eligible (all on time)
// GSTIN ending ZG or ZB → not eligible (simulates late filing)
function mockFetchGSTReturns(gstin) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!gstin || gstin.length < 15) { resolve(null); return; }
      const simulateLate = gstin.endsWith("ZG") || gstin.endsWith("ZB");
      const now = new Date();
      const returns = [];
      for (let i = 1; i <= 4; i++) {
        const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const gstr1Day = 8 + Math.floor(Math.random() * 3);
        const gstr3bDay = (simulateLate && i === 3) ? 22 : 16 + Math.floor(Math.random() * 4);
        returns.push({
          period: month.toLocaleString("en-IN", { month: "short", year: "numeric" }),
          gstr1Filed: new Date(month.getFullYear(), month.getMonth() + 1, gstr1Day).toLocaleDateString("en-IN"),
          gstr1Day, gstr1OnTime: gstr1Day <= 11,
          gstr3bFiled: new Date(month.getFullYear(), month.getMonth() + 1, gstr3bDay).toLocaleDateString("en-IN"),
          gstr3bDay, gstr3bOnTime: gstr3bDay <= 20,
        });
      }
      // Multiple registered addresses from GSTN
      const stateCode = gstin.slice(0, 2);
      const stateMap = { "27": "Maharashtra", "29": "Karnataka", "07": "Delhi", "06": "Haryana", "33": "Tamil Nadu", "09": "Uttar Pradesh" };
      const stateName = stateMap[stateCode] || "Karnataka";
      const addresses = [
        {
          id: "addr1", type: "Principal Place of Business",
          line1: "Shop No. 12, Ground Floor, " + gstin.slice(2, 5).toUpperCase() + " Complex",
          line2: "MG Road, Near City Mall",
          city: stateName === "Maharashtra" ? "Mumbai" : stateName === "Delhi" ? "New Delhi" : stateName === "Tamil Nadu" ? "Chennai" : "Bengaluru",
          state: stateName, pincode: stateCode === "27" ? "400001" : stateCode === "07" ? "110001" : "560001",
          isDefault: true,
        },
        {
          id: "addr2", type: "Additional Place of Business",
          line1: "Office No. 301, " + gstin.slice(5, 8).toUpperCase() + " Business Park",
          line2: "Industrial Area, Phase 2",
          city: stateName === "Maharashtra" ? "Pune" : stateName === "Delhi" ? "Noida" : "Mangaluru",
          state: stateName, pincode: stateCode === "27" ? "411001" : stateCode === "07" ? "201301" : "575001",
          isDefault: false,
        },
      ];
      resolve({
        gstin,
        legalName: "M/s " + gstin.slice(2, 7).toUpperCase() + " Enterprises",
        tradeName: gstin.slice(2, 7).toUpperCase() + " Trading Co.",
        status: "Active", registrationDate: "01/04/2019",
        addresses, returns,
      });
    }, 1000);
  });
}

// ─── Design ───────────────────────────────────────────────────────────────────
// ─── Theme system ─────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg: "#0B0F1A", card: "#111827", border: "#1E293B",
    accent: "#38BDF8", success: "#10B981", danger: "#EF4444",
    warn: "#F59E0B", text: "#F1F5F9", muted: "#64748B", subtle: "#1E293B",
  },
  light: {
    bg: "#F1F5F9", card: "#FFFFFF", border: "#CBD5E1",
    accent: "#0284C7", success: "#059669", danger: "#DC2626",
    warn: "#D97706", text: "#0F172A", muted: "#64748B", subtle: "#E2E8F0",
  },
};
// Module-level G defaults to dark — components use useTheme() for live G
const G = THEMES.dark;

function mkS(G) { return {
  app: { minHeight: "100vh", background: G.bg, color: G.text, fontFamily: "'DM Sans','Segoe UI',sans-serif", backgroundImage: G.bg === "#F1F5F9" ? "none" : "radial-gradient(ellipse 80% 50% at 50% -20%,rgba(56,189,248,0.07),transparent)" },
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: `1px solid ${G.border}`, background: G.bg === "#F1F5F9" ? "rgba(241,245,249,0.97)" : "rgba(11,15,26,0.97)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 },
  logo: { fontSize: 18, fontWeight: 700, color: G.text, display: "flex", alignItems: "center", gap: 10 },
  logoDot: { width: 8, height: 8, borderRadius: "50%", background: G.accent, boxShadow: `0 0 8px ${G.accent}` },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 61px)", padding: "28px 16px" },
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 16, padding: "28px 28px", width: "100%", maxWidth: 520, boxShadow: G.bg === "#F1F5F9" ? "0 4px 24px rgba(0,0,0,0.08)" : "0 20px 60px rgba(0,0,0,0.4)" },
  wideCard: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 16, padding: "28px 28px", width: "100%", maxWidth: 900, boxShadow: G.bg === "#F1F5F9" ? "0 4px 24px rgba(0,0,0,0.08)" : "0 20px 60px rgba(0,0,0,0.4)" },
  label: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: G.muted, marginBottom: 6 },
  input: { width: "100%", background: G.subtle, border: `1px solid ${G.border}`, borderRadius: 8, padding: "10px 14px", color: G.text, fontSize: 14, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s" },
  btn: { width: "100%", padding: "11px", borderRadius: 8, border: "none", background: G.accent, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  btnSm: { padding: "7px 14px", borderRadius: 6, border: "none", background: G.accent, color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" },
  btnGhost: { padding: "7px 14px", borderRadius: 6, border: `1px solid ${G.border}`, background: "transparent", color: G.muted, fontWeight: 600, fontSize: 12, cursor: "pointer" },
  btnOutline: { padding: "9px 22px", borderRadius: 6, border: `1px solid ${G.border}`, background: "transparent", color: G.muted, fontWeight: 600, fontSize: 13, cursor: "pointer" },
  btnDanger: { padding: "7px 14px", borderRadius: 6, border: "none", background: G.danger, color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" },
  btnSuccess: { padding: "7px 14px", borderRadius: 6, border: "none", background: G.success, color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" },
  row: { display: "flex", gap: 14 },
  col: { flex: 1, minWidth: 0 },
  field: { marginBottom: 16 },
  err: { color: G.danger, fontSize: 12, marginTop: 4 },
  tag: (c) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c + "20", color: c, border: `1px solid ${c}40` }),
  divider: { borderColor: G.border + "60", margin: "18px 0" },
  sec: { fontSize: 12, fontWeight: 700, color: G.accent, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "9px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: G.muted, letterSpacing: "0.5px", textTransform: "uppercase", borderBottom: `1px solid ${G.border}` },
  td: { padding: "9px 10px", borderBottom: `1px solid ${G.border}15`, verticalAlign: "top" },
  tabBar: { display: "flex", gap: 4, borderBottom: `1px solid ${G.border}`, marginBottom: 20 },
  tab: (a) => ({ padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: a ? `2px solid ${G.accent}` : "2px solid transparent", color: a ? G.accent : G.muted }),
  stepDot: (a, d) => ({ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: d ? G.success : a ? G.accent : G.subtle, color: d || a ? "#fff" : G.muted, border: `2px solid ${d ? G.success : a ? G.accent : G.border}`, flexShrink: 0 }),
  stepLine: (d) => ({ flex: 1, height: 2, background: d ? G.success : G.border }),
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: G.bg === "#F1F5F9" ? "0 8px 40px rgba(0,0,0,0.15)" : "0 32px 80px rgba(0,0,0,0.6)" },
  modalHdr: { padding: "16px 20px", borderBottom: `1px solid ${G.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  modalBody: { padding: "16px 20px", overflowY: "auto", flex: 1 },
  modalFtr: { padding: "14px 20px", borderTop: `1px solid ${G.border}`, flexShrink: 0 },
}; }
// Module-level S defaults to dark — components use useTheme() for live S
const S = mkS(THEMES.dark);

// ─── Theme hook — call in every component to get reactive S & G ───────────────
function useTheme() {
  const [, tick] = useState(0);
  useEffect(() => {
    function onThemeChange() { tick(t => t + 1); }
    window.addEventListener("kyc-theme-change", onThemeChange);
    return () => window.removeEventListener("kyc-theme-change", onThemeChange);
  }, []);
  const mode = typeof window !== "undefined" ? (window.__kyc_theme || "dark") : "dark";
  const g = THEMES[mode];
  return { G: g, S: mkS(g), isDark: mode === "dark" };
}

// ─── Base UI ──────────────────────────────────────────────────────────────────
function FInput({ label, error, ...props }) {
  const [f, setF] = useState(false);
  return (
    <div style={S.field}>
      {label && <label style={S.label}>{label}</label>}
      <input {...props} style={{ ...S.input, ...(f ? { borderColor: G.accent } : {}), ...(error ? { borderColor: G.danger } : {}) }} onFocus={() => setF(true)} onBlur={() => setF(false)} />
      {error && <div style={S.err}>{error}</div>}
    </div>
  );
}

function FSelect({ label, error, children, ...props }) {
  return (
    <div style={S.field}>
      {label && <label style={S.label}>{label}</label>}
      <select {...props} style={{ ...S.input, ...(error ? { borderColor: G.danger } : {}) }}>{children}</select>
      {error && <div style={S.err}>{error}</div>}
    </div>
  );
}

function Alrt({ type, children }) {
  const c = { success: G.success, error: G.danger, warn: G.warn, info: G.accent }[type] || G.accent;
  return <div style={{ padding: "10px 14px", borderRadius: 8, background: c + "14", border: `1px solid ${c}28`, color: c, fontSize: 13, marginBottom: 14 }}>{children}</div>;
}

function STag({ status }) {
  const m = { pending: [G.warn, "⏳ Pending"], verified: [G.success, "✓ Verified"], rejected: [G.danger, "✗ Rejected"] };
  const [color, label] = m[status] || [G.muted, status];
  return <span style={S.tag(color)}>{label}</span>;
}

function Steps({ current, steps }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={S.stepDot(i === current, i < current)}>{i < current ? "✓" : i + 1}</div>
              <div style={{ fontSize: 9, color: i === current ? G.text : G.muted, marginTop: 3, textAlign: "center", width: 56, marginLeft: -15, lineHeight: 1.3 }}>{s}</div>
            </div>
            {i < steps.length - 1 && <div style={{ ...S.stepLine(i < current), marginTop: -12 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OTP INPUT ────────────────────────────────────────────────────────────────
function OTPInput({ value, onChange }) {
  const refs = useRef([]);
  const arr = Array.from({ length: 6 }, (_, i) => (value || "")[i] || "");
  function handleChange(i, e) {
    const v = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...arr]; next[i] = v;
    onChange(next.join(""));
    if (v && i < 5) setTimeout(() => refs.current[i + 1]?.focus(), 0);
  }
  function handleKeyDown(i, e) {
    if (e.key === "Backspace") {
      if (arr[i]) { const n = [...arr]; n[i] = ""; onChange(n.join("")); }
      else if (i > 0) { const n = [...arr]; n[i - 1] = ""; onChange(n.join("")); setTimeout(() => refs.current[i - 1]?.focus(), 0); }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  }
  function handlePaste(e) {
    e.preventDefault();
    const p = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(p.padEnd(6, "").slice(0, 6).trimEnd());
    setTimeout(() => refs.current[Math.min(p.length, 5)]?.focus(), 0);
  }
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "16px 0" }}>
      {arr.map((d, i) => (
        <input key={i} ref={(r) => (refs.current[i] = r)}
          type="tel" inputMode="numeric" maxLength={1} value={d}
          onChange={(e) => handleChange(i, e)} onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste} onFocus={(e) => e.target.select()}
          style={{ width: 44, height: 52, textAlign: "center", fontSize: 22, fontWeight: 700, background: G.subtle, border: `2px solid ${d ? G.accent : G.border}`, borderRadius: 10, color: G.text, outline: "none" }}
        />
      ))}
    </div>
  );
}

// ─── NATIVE UPLOAD TILE ───────────────────────────────────────────────────────
// Uses <label> wrapping <input type="file"> directly — NO JavaScript .click() needed
// This works in ALL iframe/sandbox environments
function UploadTile({ label, required, accept, value, onChange, error }) {
  const inputId = useRef("up_" + Math.random().toString(36).slice(2));
  const icon = label.includes("GSTIN") ? "🧾" : label.includes("PAN") ? "🪪" : label.includes("Aadhaar") ? "🆔" : "📸";

  async function handleChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await toBase64(file);
      onChange({ name: file.name, type: file.type, data });
    } catch (err) { console.error(err); }
  }

  return (
    <div style={S.field}>
      <div style={S.label}>{label}{required && <span style={{ color: G.danger }}> *</span>}</div>
      {!value ? (
        <label htmlFor={inputId.current} style={{
          display: "block", border: `2px dashed ${error ? G.danger : G.border}`,
          borderRadius: 10, padding: "16px 10px", textAlign: "center",
          cursor: "pointer", background: G.subtle, userSelect: "none",
        }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
          <div style={{ fontSize: 13, color: G.muted, marginBottom: 2 }}>Tap to upload</div>
          <div style={{ fontSize: 11, color: G.muted }}>JPG, PNG or PDF</div>
          <input id={inputId.current} type="file" accept={accept}
            style={{ display: "none" }} onChange={handleChange} />
        </label>
      ) : (
        <div style={{ border: `2px solid ${G.success}`, borderRadius: 10, overflow: "hidden", background: G.success + "08" }}>
          {value.type === "application/pdf"
            ? <div style={{ padding: "12px", textAlign: "center" }}><div style={{ fontSize: 28 }}>📄</div><div style={{ fontSize: 12, color: G.success, fontWeight: 600, marginTop: 4 }}>✓ {value.name}</div></div>
            : <img src={value.data} alt={label} style={{ width: "100%", maxHeight: 80, objectFit: "cover", display: "block" }} />}
          <div style={{ padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${G.success}20` }}>
            <span style={{ fontSize: 11, color: G.success, fontWeight: 600 }}>✓ Uploaded</span>
            <div style={{ display: "flex", gap: 8 }}>
              <label htmlFor={inputId.current + "_r"} style={{ fontSize: 11, color: G.accent, cursor: "pointer" }}>
                Replace
                <input id={inputId.current + "_r"} type="file" accept={accept} style={{ display: "none" }} onChange={handleChange} />
              </label>
              <button onClick={() => onChange(null)} style={{ background: "none", border: "none", color: G.danger, fontSize: 11, cursor: "pointer", padding: 0 }}>Remove</button>
            </div>
          </div>
        </div>
      )}
      {error && <div style={S.err}>{error}</div>}
    </div>
  );
}

// ─── LIVE CAPTURE with UPLOAD FALLBACK ────────────────────────────────────────
function LiveCapture({ onCapture, onClose }) {

  const { G, S } = useTheme();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const fallbackId = useRef("lc_" + Math.random().toString(36).slice(2));

  const [mode, setMode] = useState("photo");
  const [camState, setCamState] = useState("requesting");
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewType, setPreviewType] = useState("photo");
  const [tab, setTab] = useState("camera"); // camera | upload

  useEffect(() => {
    if (tab !== "camera") return;
    let active = true;
    async function startCam() {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      setCamState("requesting");
      setPreview(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: mode === "video",
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setCamState("granted");
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play().catch(() => {});
          }
        }, 80);
      } catch (e) {
        if (!active) return;
        setCamState(e.name === "NotFoundError" ? "nodevice" : "denied");
      }
    }
    startCam();
    return () => { active = false; if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); clearInterval(recTimerRef.current); };
  }, [mode, tab]);

  function capturePhoto() {
    const v = videoRef.current; if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    c.getContext("2d").drawImage(v, 0, 0);
    setPreview(c.toDataURL("image/jpeg", 0.92)); setPreviewType("photo");
  }

  function startRecording() {
    chunksRef.current = [];
    const mime = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    try {
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : {});
      rec.ondataavailable = e => e.data?.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => { setPreview(URL.createObjectURL(new Blob(chunksRef.current, { type: mime.split(";")[0] || "video/webm" }))); setPreviewType("video"); };
      rec.start(100); mediaRecRef.current = rec;
      setRecording(true); setRecTime(0);
      recTimerRef.current = setInterval(() => setRecTime(t => { if (t >= 29) { stopRecording(); return 30; } return t + 1; }), 1000);
    } catch (e) { setCamState("error"); }
  }

  function stopRecording() {
    if (mediaRecRef.current?.state !== "inactive") mediaRecRef.current?.stop();
    clearInterval(recTimerRef.current); setRecording(false);
  }

  async function confirmCapture() {
    if (previewType === "photo") { onCapture({ type: "photo", data: preview, name: "live_photo.jpg" }); return; }
    try {
      const blob = await (await fetch(preview)).blob();
      const reader = new FileReader();
      reader.onload = () => onCapture({ type: "video", data: reader.result, name: "live_video.webm" });
      reader.readAsDataURL(blob);
    } catch { onCapture({ type: "video", data: preview, name: "live_video.webm", blobUrl: true }); }
  }

  async function handleFallbackUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const data = await toBase64(file);
    const isVid = file.type.startsWith("video");
    onCapture({ type: isVid ? "video" : "photo", data, name: file.name });
  }

  function closeModal() {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    onClose();
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 500 }}>
        <div style={S.modalHdr}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🤳 Live Capture — Genuity Verification</div>
            <div style={{ fontSize: 12, color: G.muted }}>Selfie photo or short video for identity proof</div>
          </div>
          <button onClick={closeModal} style={{ background: "none", border: "none", color: G.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={S.modalBody}>

          {/* Tab: Camera vs Upload Fallback */}
          <div style={S.tabBar}>
            <button style={S.tab(tab === "camera")} onClick={() => { setTab("camera"); setPreview(null); }}>📷 Live Camera</button>
            <button style={S.tab(tab === "upload")} onClick={() => { setTab("upload"); if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }}>📁 Upload from Gallery</button>
          </div>

          {/* ── UPLOAD FALLBACK TAB ── */}
          {tab === "upload" && (
            <div>
              <Alrt type="info">
                If camera is not working, upload a <strong>clear selfie photo</strong> or a <strong>short video</strong> from your device gallery. Make sure your face is clearly visible.
              </Alrt>
              <label htmlFor={fallbackId.current} style={{
                display: "block", border: `2px dashed ${G.accent}40`, borderRadius: 12,
                padding: "32px 16px", textAlign: "center", cursor: "pointer", background: G.subtle,
              }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>🤳</div>
                <div style={{ fontSize: 14, color: G.text, fontWeight: 600, marginBottom: 6 }}>Tap to choose photo or video</div>
                <div style={{ fontSize: 12, color: G.muted }}>JPG, PNG, MP4 or MOV accepted</div>
                <input id={fallbackId.current} type="file" accept="image/*,video/*" capture="user"
                  style={{ display: "none" }} onChange={handleFallbackUpload} />
              </label>
              <div style={{ marginTop: 12, fontSize: 11, color: G.muted, textAlign: "center" }}>
                💡 On mobile, this will open your camera or gallery directly
              </div>
            </div>
          )}

          {/* ── CAMERA TAB ── */}
          {tab === "camera" && (
            <>
              {/* Requesting */}
              {camState === "requesting" && (
                <div style={{ textAlign: "center", padding: "28px 0" }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Requesting Camera Access…</div>
                  <div style={{ background: G.accent + "12", border: `1px solid ${G.accent}28`, borderRadius: 10, padding: "14px", textAlign: "left", fontSize: 12, color: G.text, lineHeight: 1.9 }}>
                    <strong style={{ color: G.accent }}>A browser popup will appear. Please:</strong><br />
                    1. Click <strong>"Allow"</strong> when asked for camera access<br />
                    2. The camera will start automatically<br />
                    3. If no popup appears, tap <strong>"Upload from Gallery"</strong> tab above
                  </div>
                </div>
              )}

              {/* Denied / No device */}
              {(camState === "denied" || camState === "nodevice" || camState === "error") && (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: G.danger, marginBottom: 8 }}>
                    {camState === "nodevice" ? "No Camera Found" : "Camera Access Blocked"}
                  </div>
                  <div style={{ background: G.warn + "12", border: `1px solid ${G.warn}28`, borderRadius: 10, padding: "14px", textAlign: "left", fontSize: 12, color: G.text, lineHeight: 1.9, marginBottom: 16 }}>
                    <strong style={{ color: G.warn }}>To enable camera in browser:</strong><br />
                    1. Tap the 🔒 <strong>lock icon</strong> in the address bar<br />
                    2. Find <strong>Camera</strong> → set to <strong>Allow</strong><br />
                    3. Refresh page and try again<br /><br />
                    <strong style={{ color: G.accent }}>Or use the easier option:</strong><br />
                    👉 Switch to <strong>"Upload from Gallery"</strong> tab above
                  </div>
                  <button style={{ ...S.btn, background: G.accent, maxWidth: 220, margin: "0 auto" }}
                    onClick={() => setTab("upload")}>
                    📁 Upload from Gallery Instead
                  </button>
                </div>
              )}

              {/* Camera granted */}
              {camState === "granted" && (
                <>
                  <div style={S.tabBar}>
                    <button style={S.tab(mode === "photo")} onClick={() => { if (!recording) setMode("photo"); }}>📷 Photo</button>
                    <button style={S.tab(mode === "video")} onClick={() => { if (!recording) setMode("video"); }}>🎥 Video</button>
                  </div>
                  <Alrt type="info">
                    {mode === "photo" ? "Look at the camera and take a clear selfie." : "Record 5–30 sec. Say your name & today's date clearly."}
                  </Alrt>
                  {!preview ? (
                    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#000", marginBottom: 10 }}>
                      <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", display: "block", minHeight: 200, objectFit: "cover" }} />
                      {recording && (
                        <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(239,68,68,0.9)", color: "#fff", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
                          REC {recTime}s
                        </div>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px", background: "linear-gradient(transparent,rgba(0,0,0,0.8))", display: "flex", justifyContent: "center", gap: 10 }}>
                        {mode === "photo" && <button onClick={capturePhoto} style={{ ...S.btnSm, padding: "8px 22px" }}>📷 Capture</button>}
                        {mode === "video" && !recording && <button onClick={startRecording} style={{ ...S.btnSm, background: G.danger, padding: "8px 22px" }}>⏺ Record</button>}
                        {mode === "video" && recording && <button onClick={stopRecording} style={{ ...S.btnSm, background: G.warn, color: "#000", padding: "8px 22px" }}>⏹ Stop ({30 - recTime}s)</button>}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ borderRadius: 10, overflow: "hidden", background: "#000", marginBottom: 10 }}>
                        {previewType === "photo" ? <img src={preview} alt="Preview" style={{ width: "100%", display: "block" }} /> : <video src={preview} controls style={{ width: "100%", display: "block" }} />}
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button style={{ ...S.btnOutline, flex: 1 }} onClick={() => { setPreview(null); setTimeout(() => { if (videoRef.current && streamRef.current) { videoRef.current.srcObject = streamRef.current; videoRef.current.play().catch(() => {}); } }, 80); }}>↺ Retake</button>
                        <button style={{ ...S.btn, flex: 2, background: G.success }} onClick={confirmCapture}>✓ Use This {previewType === "photo" ? "Photo" : "Video"}</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AGREEMENT MODAL ──────────────────────────────────────────────────────────
function AgreementModal({ form, onAgree, onClose }) {

  const { G, S } = useTheme();
  const [agreed, setAgreed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const bodyRef = useRef();
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const clauses = [
    { icon: "🏛️", title: "1. Purpose & Scope of KYC", body: "This KYC process complies with PMLA 2002, Income Tax Act 1961, CBDT guidelines, and FIU-IND regulations. KYC is mandatory for all trade activities on this Platform." },
    { icon: "🧾", title: "2. GST Compliance", body: "(a) GST info is accurate per CGST Act 2017.\n(b) GSTR-1 filed by 11th and GSTR-3B by 20th of every month.\n(c) Records maintained 6 years per Section 36 CGST Act.\n(d) Platform may seek GST compliance certificates from GSTN." },
    { icon: "💰", title: "3. Income Tax Compliance", body: "(a) All income reported in ITR.\n(b) PAN linked with Aadhaar per Section 139AA.\n(c) TDS per Section 194Q and TCS per Section 206C(1H).\n(d) Transactions >₹10L reported under Section 285BA.\n(e) No tax evasion or fraudulent ITC claims." },
    { icon: "🔐", title: "4. Data Privacy", body: "Data processed per IT Act 2000 and DPDP Act 2023. Not shared except as required by SEBI, RBI, CBDT, FIU-IND, or courts." },
    { icon: "🚫", title: "5. AML & CFT Declaration", body: "Funds are from legitimate sources. Not involved in money laundering under PMLA 2002, FEMA 1999, or UAPA 1967." },
    { icon: "⚖️", title: "6. Ongoing Due Diligence", body: "Re-KYC periodic per RBI/SEBI guidelines. Platform may request audited statements or trade licenses anytime. Misrepresentation causes immediate suspension." },
    { icon: "📱", title: "7. OTP & Electronic Consent", body: "Dual OTP (email + mobile) constitutes valid electronic consent per Indian Contract Act 1872 and IT Act 2000." },
    { icon: "⚠️", title: "8. Liability", body: "Client indemnifies Platform against all claims from false info, non-compliance with GST/Income Tax/PMLA, or unauthorized account use." },
    { icon: "📍", title: "9. Governing Law", body: "Governed by Indian law. Disputes resolved by arbitration under Arbitration and Conciliation Act 1996, seated in India." },
  ];
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.modalHdr}>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>📜 KYC Registration Agreement</div><div style={{ fontSize: 12, color: G.muted }}>Read fully before agreeing</div></div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: G.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div ref={bodyRef} onScroll={() => { const el = bodyRef.current; if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 30) setScrolled(true); }} style={S.modalBody}>
          <div style={{ background: G.subtle, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: G.muted }}>
            Date: <strong style={{ color: G.text }}>{today}</strong> · Between <strong style={{ color: G.text }}>{form.firstName} {form.lastName}</strong> and <strong style={{ color: G.text }}>KYC Verify Platform</strong>
          </div>
          {clauses.map(c => (
            <div key={c.title} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${G.border}20` }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5, color: G.accent }}>{c.icon} {c.title}</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8, whiteSpace: "pre-line" }}>{c.body}</div>
            </div>
          ))}
          {!scrolled && <div style={{ textAlign: "center", color: G.warn, fontSize: 12, padding: 10, background: G.warn + "10", borderRadius: 8 }}>↓ Scroll to bottom to enable checkbox</div>}
          {scrolled && <div style={{ textAlign: "center", color: G.success, fontSize: 12, padding: 8, background: G.success + "10", borderRadius: 8 }}>✓ You have read the full agreement</div>}
        </div>
        <div style={S.modalFtr}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: scrolled ? "pointer" : "not-allowed", marginBottom: 12 }}>
            <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
                    width:20, height:20, borderRadius:4, border:`2px solid ${G.accent}`,
                    background: agreed ? G.accent : G.card, cursor: scrolled?"pointer":"not-allowed",
                    flexShrink:0, marginTop:2, transition:"all 0.15s" }}
                  onClick={() => scrolled && setAgreed(a => !a)}>
                  {agreed && <span style={{ color:"#fff", fontSize:13, fontWeight:900, lineHeight:1 }}>✓</span>}
                </span>
                <input type="checkbox" checked={agreed} onChange={() => {}} style={{ display:"none" }} />
            <span style={{ fontSize: 12, color: scrolled ? G.text : G.muted, lineHeight: 1.6 }}>
              I, <strong>{form.firstName} {form.lastName}</strong>, have read and agree to all terms including GST compliance, Income Tax, AML declarations, and OTP consent.
            </span>
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...S.btnOutline, flex: 1 }} onClick={onClose}>Cancel</button>
            <button style={{ ...S.btn, flex: 2, opacity: agreed ? 1 : 0.35, cursor: agreed ? "pointer" : "not-allowed" }} disabled={!agreed} onClick={() => agreed && onAgree()}>✓ I Agree — Proceed to OTP →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── OTP API helpers — all calls go to your backend, never Twilio directly ────
// Set window.__KYC_API_URL__ in index.html or via env before deploying
const API = window.__KYC_API_URL__ || "http://localhost:4000";

async function apiSendOtp(type, destination) {
  // type: "email" | "sms"   destination: email address or E.164 phone e.g. +919876543210
  const res = await fetch(`${API}/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, destination }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to send OTP");
  }
  return res.json(); // { success: true }
}

async function apiVerifyOtp(type, destination, code) {
  const res = await fetch(`${API}/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, destination, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Verification failed");
  return body; // { success: true }
}

// ─── OTP MODAL ────────────────────────────────────────────────────────────────
function OTPModal({ form, onVerified, onClose }) {

  const { G, S } = useTheme();
  const [stage, setStage] = useState("sending_email"); // sending_email | email | email_done | sending_mobile | mobile | done
  const [emailOtp, setEmailOtp] = useState("");
  const [mobileOtp, setMobileOtp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef();

  // Format mobile to E.164 (assumes India +91 — adjust prefix as needed)
  const e164 = (num) => num.startsWith("+") ? num : `+91${num}`;

  function startTimer() {
    setCanResend(false); setTimer(30);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => {
      if (t <= 1) { clearInterval(timerRef.current); setCanResend(true); return 0; }
      return t - 1;
    }), 1000);
  }

  // Send email OTP on mount
  useEffect(() => {
    (async () => {
      try {
        await apiSendOtp("email", form.email);
        setStage("email"); startTimer();
      } catch (e) {
        setErr(e.message); setStage("email");
      }
    })();
    return () => clearInterval(timerRef.current);
  }, []);

  async function resend(type) {
    setBusy(true); setErr("");
    try {
      if (type === "email") {
        await apiSendOtp("email", form.email);
        setEmailOtp("");
      } else {
        await apiSendOtp("sms", e164(form.mobile));
        setMobileOtp("");
      }
      startTimer();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function verifyEmail() {
    if (emailOtp.replace(/\s/g,"").length !== 6) { setErr("Enter the complete 6-digit OTP"); return; }
    setBusy(true); setErr("");
    try {
      await apiVerifyOtp("email", form.email, emailOtp.trim());
      setStage("email_done");
      // Now send mobile OTP
      await apiSendOtp("sms", e164(form.mobile));
      setTimeout(() => { setStage("mobile"); startTimer(); }, 800);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function verifyMobile() {
    if (mobileOtp.replace(/\s/g,"").length !== 6) { setErr("Enter the complete 6-digit OTP"); return; }
    setBusy(true); setErr("");
    try {
      await apiVerifyOtp("sms", e164(form.mobile), mobileOtp.trim());
      setStage("done");
      setTimeout(() => onVerified(), 800);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const emailDone = ["email_done","sending_mobile","mobile","done"].includes(stage);
  const mobileDone = stage === "done";

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 440 }}>
        <div style={S.modalHdr}>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>🔐 OTP Verification</div><div style={{ fontSize: 12, color: G.muted }}>Verify your email then mobile number</div></div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: G.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={S.modalBody}>
          {/* Step indicators */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[
              { label: "📧 Email",  done: emailDone,  active: stage === "email" || stage === "sending_email" },
              { label: "📱 Mobile", done: mobileDone, active: stage === "mobile" || stage === "sending_mobile" },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, padding: "9px", borderRadius: 8, textAlign: "center", background: s.done ? G.success+"18" : s.active ? G.accent+"12" : G.subtle, border: `1px solid ${s.done ? G.success+"40" : s.active ? G.accent+"30" : G.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: s.done ? G.success : s.active ? G.accent : G.muted }}>{s.done ? "✓ " : ""}{s.label}</div>
                <div style={{ fontSize: 10, color: G.muted }}>{s.done ? "Verified" : s.active ? "In Progress" : "Pending"}</div>
              </div>
            ))}
          </div>

          {/* Sending email spinner */}
          {stage === "sending_email" && (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ width: 36, height: 36, border: `3px solid ${G.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
              <div style={{ fontSize: 13, color: G.muted }}>Sending OTP to <strong style={{ color: G.text }}>{form.email}</strong>…</div>
            </div>
          )}

          {/* Email OTP entry */}
          {stage === "email" && (<>
            <div style={{ fontSize: 13, color: G.muted, marginBottom: 4 }}>
              OTP sent to <strong style={{ color: G.text }}>📧 {form.email}</strong>
            </div>
            <div style={{ fontSize: 11, color: G.muted, marginBottom: 14 }}>Check your inbox (and spam folder)</div>
            <OTPInput value={emailOtp} onChange={v => { setEmailOtp(v); setErr(""); }} />
            {err && <div style={{ color: G.danger, fontSize: 12, textAlign: "center", marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: G.muted, marginBottom: 12 }}>
              <span>{!canResend && `Resend in ${timer}s`}</span>
              {canResend && <button disabled={busy} style={{ background: "none", border: "none", color: G.accent, cursor: "pointer", fontSize: 12, padding: 0 }} onClick={() => resend("email")}>↻ Resend OTP</button>}
            </div>
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={verifyEmail}>
              {busy ? "Verifying…" : "Verify Email OTP →"}
            </button>
          </>)}

          {/* Email verified transition */}
          {stage === "email_done" && (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: 44 }}>✅</div>
              <div style={{ fontWeight: 700, color: G.success, marginTop: 8 }}>Email Verified!</div>
              <div style={{ color: G.muted, fontSize: 12, marginTop: 4 }}>Sending OTP to your mobile…</div>
            </div>
          )}

          {/* Mobile OTP entry */}
          {stage === "mobile" && (<>
            <div style={{ fontSize: 13, color: G.muted, marginBottom: 4 }}>
              OTP sent to <strong style={{ color: G.text }}>📱 {e164(form.mobile)}</strong>
            </div>
            <div style={{ fontSize: 11, color: G.muted, marginBottom: 14 }}>Check your SMS messages</div>
            <OTPInput value={mobileOtp} onChange={v => { setMobileOtp(v); setErr(""); }} />
            {err && <div style={{ color: G.danger, fontSize: 12, textAlign: "center", marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: G.muted, marginBottom: 12 }}>
              <span>{!canResend && `Resend in ${timer}s`}</span>
              {canResend && <button disabled={busy} style={{ background: "none", border: "none", color: G.accent, cursor: "pointer", fontSize: 12, padding: 0 }} onClick={() => resend("mobile")}>↻ Resend OTP</button>}
            </div>
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={verifyMobile}>
              {busy ? "Verifying…" : "Verify Mobile OTP →"}
            </button>
          </>)}

          {/* All done */}
          {stage === "done" && (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: 44 }}>🎉</div>
              <div style={{ fontWeight: 700, color: G.success, marginTop: 8 }}>Both Verified!</div>
              <div style={{ color: G.muted, fontSize: 12, marginTop: 4 }}>Creating your account…</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FORGOT PASSWORD MODAL ────────────────────────────────────────────────────
function ForgotPasswordModal({ onClose }) {

  const { G, S } = useTheme();
  // steps: "find" → "otp" → "newpass" → "done"
  const [step, setStep] = useState("find");
  const [findBy, setFindBy] = useState("email"); // email | mobile
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef();
  const [foundClient, setFoundClient] = useState(null);
  // Simulated OTP for demo (real: call /otp/send)
  const [sentOtp, setSentOtp] = useState("");

  function startTimer() {
    setCanResend(false); setTimer(30);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => {
      if (t <= 1) { clearInterval(timerRef.current); setCanResend(true); return 0; }
      return t - 1;
    }), 1000);
  }
  useEffect(() => () => clearInterval(timerRef.current), []);

  async function handleFind() {
    setErr("");
    const val = identifier.trim();
    if (!val) { setErr("Please enter your email or mobile number"); return; }
    // Look up account
    let client = null;
    if (findBy === "email") {
      client = DB.clients.find(c => c.email === val);
    } else {
      client = DB.clients.find(c => c.mobile === val);
    }
    if (!client) { setErr("No account found with this " + findBy + ". Please check and try again."); return; }
    setFoundClient(client);
    setBusy(true);
    try {
      const dest = findBy === "email" ? client.email : `+91${client.mobile}`;
      const type = findBy === "email" ? "email" : "sms";
      // In production: await apiSendOtp(type, dest)
      // Demo: generate and show OTP
      const code = genOTP();
      setSentOtp(code);
      console.log("Reset OTP:", code); // remove in production
      setStep("otp");
      startTimer();
    } catch (e) {
      setErr(e.message || "Failed to send OTP");
    }
    setBusy(false);
  }

  async function handleVerifyOtp() {
    setErr("");
    if (otp.trim().length !== 6) { setErr("Enter the 6-digit OTP"); return; }
    setBusy(true);
    try {
      // Production: await apiVerifyOtp(type, dest, otp.trim())
      // Demo: compare against sentOtp
      if (otp.trim() !== sentOtp) throw new Error("Incorrect OTP. Please try again.");
      setStep("newpass");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function handleResend() {
    const code = genOTP();
    setSentOtp(code);
    console.log("Resent OTP:", code);
    setOtp("");
    setErr("");
    startTimer();
  }

  function handleSetPassword() {
    setErr("");
    if (!newPass || newPass.length < 6) { setErr("Password must be at least 6 characters"); return; }
    if (newPass !== confirmPass) { setErr("Passwords do not match"); return; }
    // Update password in DB
    const idx = DB.clients.findIndex(c => c.id === foundClient.id);
    if (idx !== -1) { DB.clients[idx].password = newPass; saveDB(); }
    setStep("done");
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...S.modal, maxWidth: 420 }}>
        <div style={S.modalHdr}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🔑 Reset Password</div>
            <div style={{ fontSize: 11, color: G.muted }}>
              {step === "find" && "Enter your registered email or mobile"}
              {step === "otp" && `OTP sent to your ${findBy}`}
              {step === "newpass" && "Create a new password"}
              {step === "done" && "Password updated successfully"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: G.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <div style={S.modalBody}>
          {/* Step 1: Find account */}
          {step === "find" && (
            <div>
              {/* Toggle email / mobile */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {["email", "mobile"].map(t => (
                  <button key={t} onClick={() => { setFindBy(t); setIdentifier(""); setErr(""); }}
                    style={{ flex: 1, padding: "8px", borderRadius: 6, border: `1px solid ${findBy === t ? G.accent : G.border}`, background: findBy === t ? G.accent + "14" : "transparent", color: findBy === t ? G.accent : G.muted, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                    {t === "email" ? "📧 Email" : "📱 Mobile"}
                  </button>
                ))}
              </div>
              <FInput
                label={findBy === "email" ? "Registered Email Address" : "Registered Mobile Number"}
                type={findBy === "email" ? "email" : "tel"}
                placeholder={findBy === "email" ? "john@company.com" : "10-digit number"}
                value={identifier}
                onChange={e => { setIdentifier(e.target.value); setErr(""); }}
                maxLength={findBy === "mobile" ? 10 : undefined}
              />
              {err && <div style={{ ...S.err, marginBottom: 10 }}>{err}</div>}
              <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} onClick={handleFind} disabled={busy}>
                {busy ? "Searching…" : "Send OTP →"}
              </button>
            </div>
          )}

          {/* Step 2: OTP verification */}
          {step === "otp" && (
            <div>
              <div style={{ background: G.accent + "10", border: `1px solid ${G.accent}25`, borderRadius: 9, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: G.accent, lineHeight: 1.6 }}>
                OTP sent to <strong>{findBy === "email" ? foundClient?.email : foundClient?.mobile}</strong>
                <br /><span style={{ color: G.muted, fontSize: 11 }}>Check your {findBy === "email" ? "inbox" : "messages"} and enter the 6-digit code</span>
              </div>
              <label style={S.label}>Enter OTP</label>
              <OTPInput value={otp} onChange={v => { setOtp(v); setErr(""); }} />
              {err && <div style={{ ...S.err, marginBottom: 10 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 11, color: G.muted }}>
                {canResend
                  ? <button onClick={handleResend} style={{ background: "none", border: "none", color: G.accent, fontSize: 11, cursor: "pointer", fontWeight: 600, padding: 0 }}>↺ Resend OTP</button>
                  : <span>Resend in {timer}s</span>}
                <button onClick={() => { setStep("find"); setOtp(""); setErr(""); }} style={{ background: "none", border: "none", color: G.muted, fontSize: 11, cursor: "pointer", padding: 0 }}>← Change {findBy}</button>
              </div>
              <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} onClick={handleVerifyOtp} disabled={busy}>
                {busy ? "Verifying…" : "Verify OTP →"}
              </button>
            </div>
          )}

          {/* Step 3: New password */}
          {step === "newpass" && (
            <div>
              <div style={{ background: G.success + "10", border: `1px solid ${G.success}25`, borderRadius: 9, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: G.success }}>
                ✓ Identity verified — set your new password below
              </div>
              <FInput label="New Password *" type="password" placeholder="Min 6 characters"
                value={newPass} onChange={e => { setNewPass(e.target.value); setErr(""); }} />
              <FInput label="Confirm New Password *" type="password" placeholder="Repeat your new password"
                value={confirmPass} onChange={e => { setConfirmPass(e.target.value); setErr(""); }} />
              {/* Password strength indicator */}
              {newPass.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    {[1, 2, 3, 4].map(lvl => {
                      const strength = newPass.length >= 12 && /[A-Z]/.test(newPass) && /[0-9]/.test(newPass) && /[^A-Za-z0-9]/.test(newPass) ? 4
                        : newPass.length >= 8 && /[A-Z]/.test(newPass) && /[0-9]/.test(newPass) ? 3
                        : newPass.length >= 6 ? 2 : 1;
                      const colors = { 1: G.danger, 2: G.warn, 3: G.accent, 4: G.success };
                      return <div key={lvl} style={{ flex: 1, height: 4, borderRadius: 2, background: lvl <= strength ? colors[strength] : G.border }} />;
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: G.muted }}>
                    {newPass.length < 6 ? "Too short" : newPass.length < 8 ? "Weak — add uppercase & numbers" : /[A-Z]/.test(newPass) && /[0-9]/.test(newPass) && /[^A-Za-z0-9]/.test(newPass) ? "Strong ✓" : "Good — add a symbol for stronger"}
                  </div>
                </div>
              )}
              {err && <div style={{ ...S.err, marginBottom: 10 }}>{err}</div>}
              <button style={S.btn} onClick={handleSetPassword}>Update Password ✓</button>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Password Updated!</div>
              <div style={{ fontSize: 13, color: G.muted, marginBottom: 24, lineHeight: 1.6 }}>
                Your password has been reset successfully.<br />You can now sign in with your new password.
              </div>
              <button style={S.btn} onClick={onClose}>Go to Sign In →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {

  const { G, S } = useTheme();
  const [mode, setMode] = useState("login");
  const [loginType, setLoginType] = useState("email");
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [showAgreement, setShowAgreement] = useState(false);
  const [showOTP, setShowOTP] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function validateReg() {
    const e = {};
    if (!form.firstName?.trim()) e.firstName = "Required";
    if (!form.lastName?.trim()) e.lastName = "Required";
    if (!form.email || !/\S+@\S+\.\S+/.test(form.email)) e.email = "Valid email required";
    if (!form.mobile || !/^\d{10}$/.test(form.mobile)) e.mobile = "10-digit number";
    if (!form.password || form.password.length < 6) e.password = "Min 6 characters";
    setErrors(e); return !Object.keys(e).length;
  }

  function handleContinue() {
    if (!validateReg()) return;
    if (DB.clients.find(c => c.email === form.email || c.mobile === form.mobile)) { setAlert({ type: "error", msg: "Account already exists." }); return; }
    setAlert(null); setShowAgreement(true);
  }

  function handleOTPVerified() {
    DB.clients.push({ id: uid(), ...form, role: "client", status: "pending", kycComplete: false, createdAt: new Date().toISOString(), documents: [], invoiceSets: [], emailVerified: true, mobileVerified: true }); saveDB();
    setShowOTP(false);
    setAlert({ type: "success", msg: "✓ Account created & verified! Please sign in." });
    setMode("login"); setForm({});
  }

  function handleLogin() {
    const e = {};
    if (loginType === "email" && (!form.email || !/\S+@\S+\.\S+/.test(form.email))) e.email = "Valid email required";
    if (loginType === "mobile" && (!form.mobile || !/^\d{10}$/.test(form.mobile))) e.mobile = "10-digit number";
    if (!form.password) e.password = "Required";
    setErrors(e); if (Object.keys(e).length) return;
    const admin = DB.admins.find(a => a.email === form.email && a.password === form.password);
    if (admin) { onLogin({ ...admin, id: "admin-1" }); return; }
    const client = DB.clients.find(c => (loginType === "email" ? c.email === form.email : c.mobile === form.mobile) && c.password === form.password);
    if (!client) { setAlert({ type: "error", msg: "Invalid credentials." }); return; }
    onLogin(client);
  }

  return (
    <div style={S.center}>
      {showAgreement && <AgreementModal form={form} onAgree={() => { setShowAgreement(false); setShowOTP(true); }} onClose={() => setShowAgreement(false)} />}
      {showOTP && <OTPModal form={form} onVerified={handleOTPVerified} onClose={() => setShowOTP(false)} />}
      {showForgot && <ForgotPasswordModal onClose={() => { setShowForgot(false); setAlert({ type: "success", msg: "Password updated. Sign in with your new password." }); }} />}
      <div style={S.card}>
        <div style={{ ...S.logo, marginBottom: 24, justifyContent: "center" }}><div style={S.logoDot} />KYC Verify</div>
        <div style={S.tabBar}>
          <button style={S.tab(mode === "login")} onClick={() => { setMode("login"); setAlert(null); setErrors({}); }}>Sign In</button>
          <button style={S.tab(mode === "register")} onClick={() => { setMode("register"); setAlert(null); setErrors({}); }}>Register</button>
        </div>
        {alert && <Alrt type={alert.type}>{alert.msg}</Alrt>}
        {mode === "register" ? (
          <>
            <div style={S.row}>
              <div style={S.col}><FInput label="First Name *" placeholder="John" value={form.firstName || ""} onChange={set("firstName")} error={errors.firstName} /></div>
              <div style={S.col}><FInput label="Last Name *" placeholder="Doe" value={form.lastName || ""} onChange={set("lastName")} error={errors.lastName} /></div>
            </div>
            <FInput label="Email Address *" type="email" placeholder="john@company.com" value={form.email || ""} onChange={set("email")} error={errors.email} />
            <FInput label="Mobile Number *" placeholder="10-digit number" value={form.mobile || ""} onChange={set("mobile")} error={errors.mobile} maxLength={10} />
            <FInput label="Password *" type="password" placeholder="Min 6 characters" value={form.password || ""} onChange={set("password")} error={errors.password} />
            <div style={{ fontSize: 11, color: G.muted, marginBottom: 14, padding: "9px 12px", background: G.subtle, borderRadius: 7, lineHeight: 1.7 }}>
              🔐 Next: Review compliance agreement → Verify email + mobile via OTP
            </div>
            <button style={S.btn} onClick={handleContinue}>Continue to Agreement →</button>
          </>
        ) : (
          <>
            <div style={{ ...S.row, marginBottom: 14 }}>
              {["email", "mobile"].map(t => (
                <button key={t} onClick={() => setLoginType(t)} style={{ ...S.col, padding: "7px", borderRadius: 6, border: `1px solid ${loginType === t ? G.accent : G.border}`, background: loginType === t ? G.accent + "14" : "transparent", color: loginType === t ? G.accent : G.muted, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  {t === "email" ? "📧 Email" : "📱 Mobile"}
                </button>
              ))}
            </div>
            {loginType === "email"
              ? <FInput label="Email" type="email" placeholder="john@company.com" value={form.email || ""} onChange={set("email")} error={errors.email} />
              : <FInput label="Mobile Number" placeholder="10-digit number" value={form.mobile || ""} onChange={set("mobile")} error={errors.mobile} maxLength={10} />}
            <FInput label="Password" type="password" placeholder="Your password" value={form.password || ""} onChange={set("password")} error={errors.password} />
            <button style={S.btn} onClick={handleLogin}>Sign In →</button>
            {/* Forgot password link */}
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button onClick={() => setShowForgot(true)}
                style={{ background: "none", border: "none", color: G.accent, fontSize: 12, cursor: "pointer", fontWeight: 600, textDecoration: "underline", padding: 0 }}>
                Forgot password?
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── KYC FORM ─────────────────────────────────────────────────────────────────
const KYC_STEPS = ["Business Info", "GST & Compliance", "Address", "Docs & Photos", "Review"];

function KYCForm({ client, onSubmit }) {

  const { G, S } = useTheme();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    businessName: "", businessType: "", pan: "", gst: "",
    altMobile: "", altEmail: "", website: "", yearEst: "",
    gstData: null, gstFetching: false, gstEligible: null,
    address1: "", address2: "", city: "", state: "", pincode: "", country: "India",
    lat: "", lng: "", locationStatus: "",
    frontPhotos: [], insidePhotos: [],
    gstinCopy: null, panCopy: null, aadharCopy: null, liveCapture: null,
  });
  const [errors, setErrors] = useState({});
  const [locating, setLocating] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showAddrPicker, setShowAddrPicker] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setVal = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function fetchGST() {
    if (!form.gst || form.gst.length < 15) { setErrors(e => ({ ...e, gst: "Enter valid 15-char GSTIN" })); return; }
    setVal("gstFetching", true); setVal("gstData", null); setVal("gstEligible", null);
    const data = await mockFetchGSTReturns(form.gst);
    if (!data) { setVal("gstFetching", false); setErrors(e => ({ ...e, gst: "GSTIN not found" })); return; }
    const eligible = data.returns.every(r => r.gstr1OnTime && r.gstr3bOnTime);
    setForm(f => ({ ...f, gstData: data, gstFetching: false, gstEligible: eligible }));
  }

  // Autofill address from selected GSTN address
  function applyGSTAddress(addr) {
    setForm(f => ({ ...f, address1: addr.line1, address2: addr.line2, city: addr.city, state: addr.state, pincode: addr.pincode }));
    setShowAddrPicker(false);
  }

  // Location permission prompt shown when entering address step
  const [locPermState, setLocPermState] = useState("idle"); // idle|requesting|granted|denied|simulated

  async function captureLocation() {
    setLocating(true);
    setLocPermState("requesting");
    try {
      const loc = await ensureLocation();
      setLocPermState(loc.status === "simulated" ? "simulated" : "granted");
      setForm(f => ({ ...f, lat: loc.lat, lng: loc.lng, locationStatus: loc.status === "simulated" ? "simulated" : "captured" }));
    } catch {
      setLocPermState("denied");
    }
    setLocating(false);
  }

  // Auto-request location when address step loads (if not already saved)
  useEffect(() => {
    if (step === 2 && !form.lat) {
      setLocating(true);
      setLocPermState("requesting");
      ensureLocation().then(loc => {
        setLocPermState(loc.status === "simulated" ? "simulated" : "granted");
        setForm(f => ({ ...f, lat: loc.lat, lng: loc.lng, locationStatus: loc.status === "simulated" ? "simulated" : "captured" }));
        setLocating(false);
      });
    }
  }, [step]);

  // Native label-based upload for premises photos — attach saved GPS coords
  const frontId = useRef("fp_" + Math.random().toString(36).slice(2));
  const insideId = useRef("ip_" + Math.random().toString(36).slice(2));

  async function handlePremisesUpload(key, files) {
    const arr = [];
    // Silently use already-saved location (no extra prompt)
    const loc = getSavedLocation();
    for (const file of Array.from(files)) {
      try {
        arr.push({
          name: file.name,
          data: await toBase64(file),
          lat: loc?.lat || form.lat || null,
          lng: loc?.lng || form.lng || null,
          capturedAt: new Date().toISOString(),
        });
      } catch {}
    }
    setForm(f => ({ ...f, [key]: [...f[key], ...arr].slice(0, 5) }));
  }

  function validateStep(s) {
    const e = {};
    if (s === 0) {
      if (!form.businessName) e.businessName = "Required";
      if (!form.businessType) e.businessType = "Required";
      if (!form.pan || form.pan.length < 10) e.pan = "Valid 10-char PAN required";
    }
    if (s === 1) {
      if (!form.gst || form.gst.length < 15) e.gst = "Valid GSTIN required";
      if (!form.gstData) e.gstFetch = "Fetch and verify GST returns first";
      if (form.gstEligible === false) e.gstEligible = "Not eligible — returns not filed on time";
    }
    if (s === 2) {
      if (!form.address1) e.address1 = "Required";
      if (!form.city) e.city = "Required";
      if (!form.state) e.state = "Required";
      if (!form.pincode || !/^\d{6}$/.test(form.pincode)) e.pincode = "6-digit pincode";
    }
    if (s === 3) {
      if (!form.frontPhotos.length) e.frontPhotos = "At least 1 front photo required";
      if (!form.insidePhotos.length) e.insidePhotos = "At least 1 inside photo required";
      if (!form.gstinCopy) e.gstinCopy = "Required";
      if (!form.panCopy) e.panCopy = "Required";
      if (!form.aadharCopy) e.aadharCopy = "Required";
      if (!form.liveCapture) e.liveCapture = "Live capture required";
    }
    setErrors(e); return !Object.keys(e).length;
  }

  function next() { if (validateStep(step)) setStep(s => s + 1); }
  function submit() {
    if (!validateStep(step)) return;
    const updated = { ...client, kyc: { ...form, submittedAt: new Date().toISOString() }, kycComplete: true, status: "pending" };
    const idx = DB.clients.findIndex(c => c.id === client.id);
    if (idx !== -1) DB.clients[idx] = updated; else DB.clients.push(updated);
    onSubmit(updated); saveDB();
  }

  // Address picker modal
  const AddrPicker = () => (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 480 }}>
        <div style={S.modalHdr}>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>📍 Select Registered Address</div><div style={{ fontSize: 12, color: G.muted }}>From GSTN — choose your primary business address</div></div>
          <button onClick={() => setShowAddrPicker(false)} style={{ background: "none", border: "none", color: G.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={S.modalBody}>
          {(form.gstData?.addresses || []).map((addr, i) => (
            <div key={addr.id} onClick={() => applyGSTAddress(addr)}
              style={{ border: `2px solid ${addr.isDefault ? G.accent + "60" : G.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", background: addr.isDefault ? G.accent + "08" : G.subtle, transition: "all 0.15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: addr.isDefault ? G.accent : G.text }}>{addr.type}</div>
                {addr.isDefault && <span style={S.tag(G.accent)}>Principal</span>}
              </div>
              <div style={{ fontSize: 13, color: G.text, marginBottom: 2 }}>{addr.line1}</div>
              {addr.line2 && <div style={{ fontSize: 12, color: G.muted, marginBottom: 2 }}>{addr.line2}</div>}
              <div style={{ fontSize: 12, color: G.muted }}>{addr.city}, {addr.state} - {addr.pincode}</div>
              <button style={{ ...S.btnSm, marginTop: 10, fontSize: 11, padding: "5px 14px" }}>Use This Address</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ ...S.center, padding: "16px 12px", alignItems: "stretch" }}>
      {showLive && <LiveCapture onCapture={cap => { setVal("liveCapture", cap); setShowLive(false); }} onClose={() => setShowLive(false)} />}
      {showAddrPicker && <AddrPicker />}

      <div style={{ ...S.wideCard, padding: "clamp(16px, 4vw, 36px)", maxWidth: "100%", width: "100%", boxSizing: "border-box" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>KYC Application</div>
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 20 }}>Complete all steps for admin verification</div>
        <Steps current={step} steps={KYC_STEPS} />

        {/* ── STEP 0: Business Info ── */}
        {step === 0 && <>
          <div style={S.sec}>🏢 Business Information</div>
          <div style={S.row}>
            <div style={S.col}><FInput label="Business / Trade Name *" placeholder="ABC Traders Pvt Ltd" value={form.businessName} onChange={set("businessName")} error={errors.businessName} /></div>
            <div style={S.col}>
              <FSelect label="Business Type *" value={form.businessType} onChange={set("businessType")} error={errors.businessType}>
                <option value="">Select type</option>
                {["Sole Proprietorship","Partnership","Private Limited","Public Limited","LLP","Trust","Society","HUF"].map(t => <option key={t}>{t}</option>)}
              </FSelect>
            </div>
          </div>
          <div style={S.row}>
            <div style={S.col}><FInput label="PAN Number *" placeholder="ABCDE1234F" value={form.pan} onChange={e => setVal("pan", e.target.value.toUpperCase())} error={errors.pan} maxLength={10} /></div>
            <div style={S.col}><FInput label="Website (optional)" placeholder="https://company.com" value={form.website} onChange={set("website")} /></div>
          </div>
          <hr style={S.divider} />
          <div style={S.sec}>📞 Additional Contact</div>
          <div style={S.row}>
            <div style={S.col}><FInput label="Alternate Mobile" placeholder="10-digit (optional)" value={form.altMobile} onChange={set("altMobile")} maxLength={10} /></div>
            <div style={S.col}><FInput label="Alternate Email" type="email" placeholder="accounts@company.com" value={form.altEmail} onChange={set("altEmail")} /></div>
          </div>
          <FInput label="Year Established" placeholder="e.g. 2015" value={form.yearEst} onChange={set("yearEst")} />
        </>}

        {/* ── STEP 1: GST Compliance ── */}
        {step === 1 && <>
          <div style={S.sec}>🧾 GST Registration & Return Compliance</div>
          <Alrt type="info">Enter GSTIN → Fetch Returns to verify last 4 months. <strong>GSTR-1 due: 11th</strong> | <strong>GSTR-3B due: 20th</strong>. All 4 must be on time.</Alrt>
          <div style={{ background: G.warn + "12", border: `1px solid ${G.warn}28`, borderRadius: 8, padding: "9px 12px", marginBottom: 14, fontSize: 11, color: G.warn }}>
            🧪 Demo: Any 15-char GSTIN → ✅ Eligible &nbsp;|&nbsp; GSTIN ending <strong>ZG</strong> or <strong>ZB</strong> → ❌ Not eligible
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <FInput label="GSTIN *" placeholder="27ABCDE1234F1Z5" value={form.gst}
                onChange={e => { setVal("gst", e.target.value.toUpperCase()); setVal("gstData", null); setVal("gstEligible", null); }}
                error={errors.gst} maxLength={15} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <button style={{ ...S.btnSm, padding: "10px 16px", opacity: form.gstFetching ? 0.6 : 1 }} onClick={fetchGST} disabled={form.gstFetching}>
                {form.gstFetching ? "⏳…" : "🔍 Fetch Returns"}
              </button>
            </div>
          </div>
          {errors.gstFetch && <div style={{ color: G.danger, fontSize: 12, marginBottom: 10, marginTop: -8 }}>{errors.gstFetch}</div>}
          {form.gstFetching && <div style={{ textAlign: "center", padding: "24px", color: G.muted, fontSize: 13 }}><div style={{ fontSize: 26 }}>🔄</div>Fetching from GSTN…</div>}
          {form.gstData && <>
            <div style={{ background: G.subtle, borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: `1px solid ${form.gstEligible ? G.success + "40" : G.danger + "40"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{form.gstData.legalName}</div>
                  <div style={{ fontSize: 11, color: G.muted }}>{form.gstData.tradeName} · {form.gstData.gstin}</div>
                </div>
                <span style={S.tag(G.success)}>Active</span>
              </div>
              {form.gstEligible
                ? <div style={{ background: G.success + "15", border: `1px solid ${G.success}30`, borderRadius: 7, padding: "8px 12px", color: G.success, fontSize: 13, fontWeight: 600 }}>✅ Eligible — All 4 returns filed on time</div>
                : <div style={{ background: G.danger + "15", border: `1px solid ${G.danger}30`, borderRadius: 7, padding: "8px 12px", color: G.danger, fontSize: 13, fontWeight: 600 }}>❌ Not Eligible — Returns filed late</div>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...S.table, fontSize: 11 }}>
                <thead><tr>{["Period","GSTR-1","Due 11th","GSTR-3B","Due 20th","Status"].map(h => <th key={h} style={{ ...S.th, fontSize: 9, padding: "6px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {form.gstData.returns.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, padding: "7px 8px", fontWeight: 600 }}>{r.period}</td>
                      <td style={{ ...S.td, padding: "7px 8px", color: r.gstr1OnTime ? G.success : G.danger }}>{r.gstr1Filed}</td>
                      <td style={{ ...S.td, padding: "7px 8px" }}><span style={S.tag(r.gstr1OnTime ? G.success : G.danger)}>{r.gstr1OnTime ? "✓" : `✗ D${r.gstr1Day}`}</span></td>
                      <td style={{ ...S.td, padding: "7px 8px", color: r.gstr3bOnTime ? G.success : G.danger }}>{r.gstr3bFiled}</td>
                      <td style={{ ...S.td, padding: "7px 8px" }}><span style={S.tag(r.gstr3bOnTime ? G.success : G.danger)}>{r.gstr3bOnTime ? "✓" : `✗ D${r.gstr3bDay}`}</span></td>
                      <td style={{ ...S.td, padding: "7px 8px" }}><span style={S.tag(r.gstr1OnTime && r.gstr3bOnTime ? G.success : G.danger)}>{r.gstr1OnTime && r.gstr3bOnTime ? "✓ OK" : "✗ Late"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {form.gstEligible === false && <Alrt type="error">⚠️ Cannot proceed. File GSTR-1 by 11th and GSTR-3B by 20th for 4 consecutive months and re-apply.</Alrt>}
            {errors.gstEligible && <div style={S.err}>{errors.gstEligible}</div>}
          </>}
        </>}

        {/* ── STEP 2: Address ── */}
        {step === 2 && <>
          <div style={S.sec}>📍 Registered Business Address</div>

          {/* Location permission banner */}
          {locPermState === "requesting" && (
            <div style={{ background: G.accent+"12", border: `1px solid ${G.accent}30`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 16, height: 16, border: `2px solid ${G.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.accent }}>📍 Requesting Location Access…</div>
                <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>A browser popup will appear — tap <strong>"Allow"</strong> to enable auto-location detection</div>
              </div>
            </div>
          )}
          {(locPermState === "granted" || locPermState === "simulated") && form.lat && (
            <div style={{ background: G.success+"10", border: `1px solid ${G.success}25`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>📍</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.success }}>Location Captured Automatically{locPermState === "simulated" ? " (Demo)" : ""}</div>
                <div style={{ fontSize: 11, color: G.muted }}>Lat: {form.lat} · Lng: {form.lng} — saved securely for this session</div>
              </div>
              <button onClick={captureLocation} style={{ background: "none", border: "none", color: G.accent, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>↺ Refresh</button>
            </div>
          )}

          {/* Autofill from GSTIN */}
          {form.gstData?.addresses?.length > 0 && (
            <div style={{ background: G.accent+"10", border: `1px solid ${G.accent}28`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: G.accent, marginBottom: 2 }}>📋 Autofill from GSTIN</div>
                  <div style={{ fontSize: 11, color: G.muted }}>{form.gstData.addresses.length} registered address{form.gstData.addresses.length > 1 ? "es" : ""} found on GSTN</div>
                </div>
                <button style={{ ...S.btnSm, whiteSpace: "nowrap", flexShrink: 0 }} onClick={() => {
                  if (form.gstData.addresses.length === 1) applyGSTAddress(form.gstData.addresses[0]);
                  else setShowAddrPicker(true);
                }}>
                  {form.gstData.addresses.length > 1 ? "📋 Choose Address" : "✓ Auto Fill"}
                </button>
              </div>
              {/* Preview all addresses inline if multiple */}
              {form.gstData.addresses.length > 1 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {form.gstData.addresses.map((addr, i) => (
                    <div key={addr.id} onClick={() => applyGSTAddress(addr)}
                      style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: G.text }}>{addr.type}</span>
                        {addr.isDefault && <span style={S.tag(G.accent)}>Principal</span>}
                      </div>
                      <div style={{ fontSize: 12, color: G.text }}>{addr.line1}</div>
                      {addr.line2 && <div style={{ fontSize: 11, color: G.muted }}>{addr.line2}</div>}
                      <div style={{ fontSize: 11, color: G.muted }}>{addr.city}, {addr.state} - {addr.pincode}</div>
                      <div style={{ marginTop: 6 }}>
                        <button style={{ ...S.btnSm, fontSize: 10, padding: "4px 12px" }}>Use This Address</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <FInput label="Address Line 1 *" placeholder="Shop/Office No., Building Name" value={form.address1} onChange={set("address1")} error={errors.address1} />
          <FInput label="Address Line 2" placeholder="Street, Area, Landmark" value={form.address2} onChange={set("address2")} />
          <FInput label="Address Line 3 / Locality" placeholder="Area, Sector, Nearby landmark" value={form.address3 || ""} onChange={e => setForm(f => ({...f, address3: e.target.value}))} />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}><FInput label="City *" value={form.city} onChange={set("city")} error={errors.city} placeholder="Bengaluru" /></div>
            <div style={{ flex: 1, minWidth: 140 }}><FInput label="State *" value={form.state} onChange={set("state")} error={errors.state} placeholder="Karnataka" /></div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}><FInput label="Pincode *" placeholder="560001" value={form.pincode} onChange={set("pincode")} error={errors.pincode} maxLength={6} /></div>
            <div style={{ flex: 1, minWidth: 120 }}><FInput label="Country" value={form.country} onChange={set("country")} /></div>
          </div>

          {/* GPS — always shown, auto-captured on step load */}
          <div style={{ background: form.lat ? G.success+"08" : G.subtle, border: `1px solid ${form.lat ? G.success+"30" : G.border}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: G.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>GPS Coordinates</div>
            {form.lat ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: G.success }}>✓ Location Saved</div>
                  <div style={{ fontSize: 11, color: G.muted }}>Lat: {form.lat} · Lng: {form.lng}</div>
                  <div style={{ fontSize: 10, color: G.muted }}>Will be attached to premises photos automatically</div>
                </div>
                <button style={{ ...S.btnSm, background: G.muted+"30", color: G.text, fontSize: 11 }} onClick={captureLocation} disabled={locating}>
                  {locating ? "⏳" : "↺ Re-capture"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {locating
                  ? <><div style={{ width: 14, height: 14, border: `2px solid ${G.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><span style={{ fontSize: 12, color: G.accent }}>Detecting location…</span></>
                  : <button style={{ ...S.btnSm }} onClick={captureLocation}>📡 Capture Location</button>}
              </div>
            )}
          </div>
        </>}

        {/* ── STEP 3: Documents & Photos ── */}
        {step === 3 && <>
          <div style={S.sec}>📄 KYC Documents</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 8 }}>
            <UploadTile label="GSTIN Certificate Copy" required accept="image/*,.pdf" value={form.gstinCopy} onChange={v => setVal("gstinCopy", v)} error={errors.gstinCopy} />
            <UploadTile label="PAN Card Copy" required accept="image/*,.pdf" value={form.panCopy} onChange={v => setVal("panCopy", v)} error={errors.panCopy} />
            <UploadTile label="Aadhaar Card Copy" required accept="image/*,.pdf" value={form.aadharCopy} onChange={v => setVal("aadharCopy", v)} error={errors.aadharCopy} />

            {/* Live Capture */}
            <div style={S.field}>
              <div style={S.label}>Live Photo / Video <span style={{ color: G.danger }}>*</span></div>
              {!form.liveCapture ? (
                <div onClick={() => setShowLive(true)} style={{ border: `2px dashed ${errors.liveCapture ? G.danger : G.border}`, borderRadius: 10, padding: "16px 10px", textAlign: "center", cursor: "pointer", background: G.subtle }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>🤳</div>
                  <div style={{ fontSize: 13, color: G.muted, marginBottom: 2 }}>Tap to open camera</div>
                  <div style={{ fontSize: 11, color: G.muted }}>or upload from gallery</div>
                </div>
              ) : (
                <div style={{ border: `2px solid ${G.success}`, borderRadius: 10, overflow: "hidden", background: G.success + "08" }}>
                  {form.liveCapture.type === "video"
                    ? <video src={form.liveCapture.data} controls style={{ width: "100%", maxHeight: 80, display: "block" }} />
                    : <img src={form.liveCapture.data} alt="Live" style={{ width: "100%", maxHeight: 80, objectFit: "cover", display: "block" }} />}
                  <div style={{ padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: G.success, fontWeight: 600 }}>✓ {form.liveCapture.type === "video" ? "Video" : "Photo"} captured</span>
                    <button onClick={() => setShowLive(true)} style={{ background: "none", border: "none", color: G.accent, fontSize: 11, cursor: "pointer" }}>Retake</button>
                  </div>
                </div>
              )}
              {errors.liveCapture && <div style={S.err}>{errors.liveCapture}</div>}
            </div>
          </div>

          <hr style={S.divider} />
          <div style={S.sec}>📸 Premises Photos</div>
          {form.lat && (
            <div style={{ background: G.success+"08", border: `1px solid ${G.success}20`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: G.success }}>
              📍 GPS coordinates (Lat: {form.lat}, Lng: {form.lng}) will be automatically attached to all uploaded photos
            </div>
          )}
          {[
            { key: "frontPhotos", label: "Office / Shop Front View *", inputId: frontId, err: errors.frontPhotos },
            { key: "insidePhotos", label: "Office / Shop Inside View *", inputId: insideId, err: errors.insidePhotos },
          ].map(({ key, label, inputId, err }) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={S.label}>{label}</div>
              <label htmlFor={inputId.current} style={{ display: "block", border: `2px dashed ${err ? G.danger : G.border}`, borderRadius: 10, padding: "16px 10px", textAlign: "center", cursor: "pointer", background: G.subtle, userSelect: "none" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>📤</div>
                <div style={{ fontSize: 12, color: G.muted }}>Tap to upload photos (max 5)</div>
                <div style={{ fontSize: 10, color: G.muted, marginTop: 2 }}>GPS coords attached automatically</div>
                <input id={inputId.current} type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={e => { handlePremisesUpload(key, e.target.files); e.target.value = ""; }} />
              </label>
              {err && <div style={S.err}>{err}</div>}
              {form[key].length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {form[key].map((p, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={p.data} alt="" style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 6, border: `1px solid ${G.border}`, display: "block" }} />
                      {p.lat && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(16,185,129,0.85)", borderRadius: "0 0 6px 6px", padding: "1px 3px", fontSize: 8, color: "#fff", textAlign: "center" }}>📍 GPS</div>}
                      <button onClick={e => { e.preventDefault(); setForm(f => ({ ...f, [key]: f[key].filter((_, idx) => idx !== i) })); }}
                        style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: G.danger, color: "#fff", border: "none", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>}

        {/* ── STEP 4: Review ── */}
        {step === 4 && <>
          <div style={S.sec}>✅ Review & Submit</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              ["Applicant", `${client.firstName} ${client.lastName}`],
              ["Email", client.email], ["Mobile", client.mobile],
              ["Alt Mobile", form.altMobile || "—"], ["Alt Email", form.altEmail || "—"],
              ["Business", form.businessName], ["Type", form.businessType],
              ["PAN", form.pan], ["GSTIN", form.gst],
              ["GST Eligible", form.gstEligible ? "✓ Yes" : "✗ No"],
              ["Address", `${form.address1}, ${form.city}, ${form.state} - ${form.pincode}`],
              ["Location", form.lat ? `${form.lat}, ${form.lng}` : "Not captured"],
              ["GSTIN Copy", form.gstinCopy ? "✓" : "—"], ["PAN Copy", form.panCopy ? "✓" : "—"],
              ["Aadhaar Copy", form.aadharCopy ? "✓" : "—"], ["Live Capture", form.liveCapture ? `✓ ${form.liveCapture.type}` : "—"],
              ["Front Photos", `${form.frontPhotos.length} uploaded`], ["Inside Photos", `${form.insidePhotos.length} uploaded`],
            ].map(([k, v]) => (
              <div key={k} style={{ background: G.subtle, borderRadius: 7, padding: "8px 11px" }}>
                <div style={{ fontSize: 10, color: G.muted, marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 500, wordBreak: "break-word" }}>{v}</div>
              </div>
            ))}
          </div>
          <Alrt type="info">Application goes to compliance team for review. You will be notified upon verification.</Alrt>
        </>}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "space-between", flexWrap: "wrap" }}>
          {step > 0 ? <button style={{ ...S.btnOutline, flex: "0 0 auto" }} onClick={() => setStep(s => s - 1)}>← Back</button> : <div />}
          {step < KYC_STEPS.length - 1
            ? <button style={{ ...S.btn, flex: 1, minWidth: 120, maxWidth: 200, opacity: step === 1 && form.gstEligible === false ? 0.4 : 1, cursor: step === 1 && form.gstEligible === false ? "not-allowed" : "pointer" }}
                onClick={next} disabled={step === 1 && form.gstEligible === false}>
                {step === 1 && form.gstEligible === false ? "🚫 Not Eligible" : "Continue →"}
              </button>
            : <button style={{ ...S.btn, flex: 1, minWidth: 140, background: G.success }} onClick={submit}>Submit Application ✓</button>}
        </div>
      </div>
    </div>
  );
}

// ─── COMPLIANCE CHECKER ──────────────────────────────────────────────────────
// Simulates government compliance validation for invoice PDFs
function validateInvoiceCompliance(file, slotKey, clientKyc) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const errors = [];
      const warnings = [];
      // All checks are simulated — in production these would call real APIs
      const pan = clientKyc?.pan || "";
      const gstin = clientKyc?.gst || "";
      const businessName = clientKyc?.businessName || "";

      if (slotKey === "invoice" || slotKey === "einvoice") {
        // Check PAN details on invoice
        if (!pan) { errors.push("PAN number not found in KYC records. Please update KYC before uploading."); }
        else {
          // Simulate: 90% pass, 10% PAN mismatch
          const panOk = Math.random() > 0.08;
          if (!panOk) errors.push(`PAN mismatch: Supplier PAN on invoice does not match KYC PAN (${pan}). Verify the invoice is issued against the correct entity.`);
          else warnings.push(`PAN verified: ${pan} ✓`);
        }
        // GST compliance check
        if (!gstin) { errors.push("GSTIN not found in KYC records."); }
        else {
          const gstOk = Math.random() > 0.08;
          if (!gstOk) errors.push(`GSTIN mismatch on invoice. Expected: ${gstin}. Ensure the invoice is raised by your registered entity.`);
          else warnings.push(`GSTIN verified: ${gstin} ✓`);
        }
        // HSN code check
        const hsnOk = Math.random() > 0.06;
        if (!hsnOk) errors.push("HSN/SAC code missing or invalid on the invoice. All line items must have valid HSN codes as per GST Invoice Rules 2017.");
        else warnings.push("HSN/SAC codes validated ✓");
        // IRN check for e-invoice
        if (slotKey === "einvoice") {
          const irnOk = Math.random() > 0.07;
          if (!irnOk) errors.push("IRN (Invoice Reference Number) not found or invalid. E-Invoice must be generated on the IRP (Invoice Registration Portal) under e-invoicing mandate.");
          else warnings.push("IRN validated ✓");
          const qrOk = Math.random() > 0.05;
          if (!qrOk) errors.push("QR code missing on e-Invoice. Mandatory for taxpayers with turnover above ₹5 Cr as per CGST Notification No. 01/2020.");
          else warnings.push("QR code present ✓");
        }
        // Tax amount check
        const taxOk = Math.random() > 0.05;
        if (!taxOk) errors.push("CGST/SGST/IGST amounts appear incorrect. Please verify tax calculations against the applicable GST rate for your HSN codes.");
        else warnings.push("Tax amounts validated ✓");
      }

      if (slotKey === "eway") {
        // E-way bill compliance
        const ewaOk = Math.random() > 0.07;
        if (!ewaOk) errors.push("E-Way Bill number invalid or expired. E-Way Bills are valid for 1 day per 200 km. Please generate a fresh E-Way Bill on the GSTN E-Way portal.");
        else warnings.push("E-Way Bill number validated ✓");
        const vehicleOk = Math.random() > 0.06;
        if (!vehicleOk) errors.push("Vehicle number or transporter ID missing on E-Way Bill. Required fields under E-Way Bill Rules 2017.");
        else warnings.push("Transporter details verified ✓");
        // Check invoice number match
        warnings.push("E-Way Bill linked to invoice number ✓");
      }

      if (slotKey === "docket") {
        const courierOk = Math.random() > 0.05;
        if (!courierOk) errors.push("Docket/AWB number not legible. Ensure the courier docket is clear and the tracking number is visible.");
        else warnings.push("Docket verified ✓");
      }

      resolve({ passed: errors.length === 0, errors, warnings });
    }, 1500 + Math.random() * 500);
  });
}

// Parse Excel file and check for duplicate IMEI / serial numbers
function validateIMEIExcel(file) {
  return new Promise((resolve) => {
    // Read file as binary array buffer for SheetJS parsing
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Parse using SheetJS (loaded globally)
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        if (rows.length < 2) { resolve({ passed: false, errors: ["Excel file appears empty or has no data rows."], warnings: [], imeiList: [] }); return; }

        // Find IMEI/Serial column — search header row
        const header = rows[0].map(h => String(h).toLowerCase().trim());
        let imeiCol = header.findIndex(h => h.includes("imei") || h.includes("serial") || h.includes("sr no") || h.includes("srno") || h.includes("barcode"));
        if (imeiCol === -1) imeiCol = 0; // fallback to first column

        const allValues = [];
        const duplicates = [];
        const seen = new Set();
        const errors = [];
        const warnings = [];

        for (let r = 1; r < rows.length; r++) {
          const val = String(rows[r][imeiCol] || "").trim();
          if (!val) continue;
          if (seen.has(val)) { duplicates.push({ row: r + 1, value: val }); }
          else { seen.add(val); allValues.push(val); }
        }

        // IMEI format check (15 digits for telecom)
        const invalidFormat = allValues.filter(v => v.length > 0 && v.length !== 15 && /^\d+$/.test(v));
        if (invalidFormat.length > 0 && invalidFormat.length < 5) {
          warnings.push(`${invalidFormat.length} IMEI(s) don't have standard 15-digit format: ${invalidFormat.slice(0, 3).join(", ")}${invalidFormat.length > 3 ? "..." : ""}`);
        }

        if (duplicates.length > 0) {
          errors.push(`Found ${duplicates.length} duplicate IMEI/Serial number${duplicates.length > 1 ? "s" : ""}:`);
          duplicates.slice(0, 5).forEach(d => errors.push(`  • Row ${d.row}: ${d.value} (duplicate)`));
          if (duplicates.length > 5) errors.push(`  • ...and ${duplicates.length - 5} more duplicates`);
        } else {
          warnings.push(`${allValues.length} unique IMEI/Serial numbers found ✓`);
          warnings.push(`Column detected: "${rows[0][imeiCol]}" (col ${imeiCol + 1}) ✓`);
        }

        resolve({ passed: duplicates.length === 0, errors, warnings, imeiList: allValues, duplicates, totalRows: allValues.length + duplicates.length });
      } catch (err) {
        resolve({ passed: false, errors: ["Could not parse Excel file. Please ensure it is a valid .xlsx or .xls file."], warnings: [] });
      }
    };
    reader.onerror = () => resolve({ passed: false, errors: ["Failed to read file."], warnings: [] });
    reader.readAsArrayBuffer(file);
  });
}

// ─── CLIENT DASHBOARD ─────────────────────────────────────────────────────────
const INV_SLOTS = [
  { key: "invoice",  label: "Invoice",    icon: "🧾", accept: ".pdf,application/pdf",           note: "PDF only",       validate: true },
  { key: "einvoice", label: "E-Invoice",  icon: "📋", accept: ".pdf,application/pdf",           note: "PDF only",       validate: true },
  { key: "eway",     label: "E-Way Bill", icon: "🚚", accept: ".pdf,application/pdf",           note: "PDF only",       validate: true },
  { key: "imei",     label: "IMEI List",  icon: "📱", accept: ".pdf,.xlsx,.xls,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", note: "PDF or Excel", validate: true },
  { key: "docket",   label: "Docket",     icon: "📦", accept: ".pdf,image/*,application/pdf",   note: "PDF or Image",   validate: true },
];

function getLiveClient(id) { return DB.clients.find(c => c.id === id) || null; }

function ClientDashboard({ client, onKYCStart, onUserUpdate }) {

  const { G, S } = useTheme();
  const [tab, setTab] = useState("overview");
  const [, forceUpdate] = useState(0);
  const refresh = () => { forceUpdate(n => n + 1); };

  const [newInvNo, setNewInvNo] = useState("");
  const [newInvErr, setNewInvErr] = useState("");
  const [expandedSet, setExpandedSet] = useState(null);
  const [invSearchQ, setInvSearchQ] = useState(""); // client invoice search
  const [validating, setValidating] = useState({}); // { "invNo_slotKey": true }
  const [slotErrors, setSlotErrors] = useState({}); // { "invNo_slotKey": { errors, warnings } }
  const [lightbox, setLightbox] = useState(null);
  const [resubmitReason, setResubmitReason] = useState({});

  const live = getLiveClient(client.id) || client;
  const isVerified = live.status === "verified";
  const invoiceSets = live.invoiceSets || [];
  const filteredInvoiceSets = invSearchQ.trim()
    ? invoiceSets.filter(s => s.invNo.toLowerCase().includes(invSearchQ.toLowerCase()))
    : invoiceSets;

  useEffect(() => {
    const fresh = getLiveClient(client.id);
    if (fresh && onUserUpdate) onUserUpdate(fresh);
  }, [tab]);

  function setSlotErr(invNo, slotKey, result) {
    setSlotErrors(prev => ({ ...prev, [`${invNo}_${slotKey}`]: result }));
  }
  function getSlotErr(invNo, slotKey) { return slotErrors[`${invNo}_${slotKey}`] || null; }
  function setValidatingKey(invNo, slotKey, val) { setValidating(prev => ({ ...prev, [`${invNo}_${slotKey}`]: val })); }
  function isValidatingKey(invNo, slotKey) { return !!validating[`${invNo}_${slotKey}`]; }

  function createInvoiceSet() {
    const invNo = newInvNo.trim().toUpperCase();
    if (!invNo) { setNewInvErr("Invoice number is required"); return; }
    if (invoiceSets.find(s => s.invNo === invNo)) { setNewInvErr("Invoice number already exists"); return; }
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    const newSet = { id: uid(), invNo, createdAt: new Date().toISOString(), submissionStatus: "draft", adminReview: null, files: {} };
    DB.clients[idx].invoiceSets = [...(DB.clients[idx].invoiceSets || []), newSet];
    saveDB(); setNewInvNo(""); setNewInvErr(""); setExpandedSet(invNo); refresh();
  }

  async function handleSlotUpload(invNo, slotKey, file, clientKyc) {
    if (!file) return;
    setValidatingKey(invNo, slotKey, true);
    setSlotErr(invNo, slotKey, null);

    let validationResult = { passed: true, errors: [], warnings: [] };

    try {
      const isExcel = file.name?.match(/\.xlsx?$/i);
      if (slotKey === "imei" && isExcel) {
        // Excel IMEI duplicate check
        validationResult = await validateIMEIExcel(file);
      } else if (["invoice","einvoice","eway","docket"].includes(slotKey)) {
        // Government compliance check
        validationResult = await validateInvoiceCompliance(file, slotKey, clientKyc);
      }
    } catch(e) {
      validationResult = { passed: false, errors: ["Validation error: " + e.message], warnings: [] };
    }

    setValidatingKey(invNo, slotKey, false);

    if (!validationResult.passed) {
      setSlotErr(invNo, slotKey, validationResult);
      return; // Block upload
    }

    // Validation passed — save file
    const data = await toBase64(file);
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const setIdx = sets.findIndex(s => s.invNo === invNo);
    if (setIdx === -1) return;
    sets[setIdx] = {
      ...sets[setIdx],
      files: {
        ...sets[setIdx].files,
        [slotKey]: {
          name: file.name, type: file.type, size: file.size, data,
          uploadedAt: new Date().toISOString(),
          validationResult,
        }
      }
    };
    const allFilled = INV_SLOTS.every(sl => sets[setIdx].files[sl.key]);
    if (allFilled && sets[setIdx].submissionStatus === "draft") sets[setIdx].status = "complete";
    else sets[setIdx].status = allFilled ? "complete" : "incomplete";
    DB.clients[idx].invoiceSets = sets;
    saveDB();
    setSlotErr(invNo, slotKey, { passed: true, warnings: validationResult.warnings, errors: [] });
    refresh();
  }

  function removeSlotFile(invNo, slotKey) {
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const setIdx = sets.findIndex(s => s.invNo === invNo);
    if (setIdx === -1) return;
    const files = { ...sets[setIdx].files };
    delete files[slotKey];
    sets[setIdx] = { ...sets[setIdx], files, status: "incomplete" };
    DB.clients[idx].invoiceSets = sets;
    saveDB(); setSlotErr(invNo, slotKey, null); refresh();
  }

  function submitInvoiceSet(invNo) {
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const setIdx = sets.findIndex(s => s.invNo === invNo);
    if (setIdx === -1) return;
    sets[setIdx] = { ...sets[setIdx], submissionStatus: "submitted", submittedAt: new Date().toISOString(), adminReview: null };
    DB.clients[idx].invoiceSets = sets;
    saveDB(); refresh();
  }

  function resubmitInvoiceSet(invNo) {
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const setIdx = sets.findIndex(s => s.invNo === invNo);
    if (setIdx === -1) return;
    const set = sets[setIdx];
    // For partial reject: keep approved files, only clear rejected slots
    let newFiles = { ...set.files };
    if (set.adminReview?.status === "partial_reject" && set.adminReview?.rejectedSlots?.length) {
      set.adminReview.rejectedSlots.forEach(k => { delete newFiles[k]; });
    } else {
      newFiles = {}; // full resubmit
    }
    sets[setIdx] = { ...sets[setIdx], submissionStatus: "draft", status: "incomplete", adminReview: null, files: newFiles };
    DB.clients[idx].invoiceSets = sets;
    saveDB(); setResubmitReason(prev => { const n={...prev}; delete n[invNo]; return n; }); refresh();
  }

  function deleteInvoiceSet(invNo) {
    const idx = DB.clients.findIndex(c => c.id === live.id);
    if (idx === -1) return;
    DB.clients[idx].invoiceSets = (DB.clients[idx].invoiceSets || []).filter(s => s.invNo !== invNo);
    saveDB(); if (expandedSet === invNo) setExpandedSet(null); refresh();
  }

  function getCompletionCount(set) { return INV_SLOTS.filter(sl => set.files?.[sl.key]).length; }

  function downloadFile(file, name) {
    const a = document.createElement("a");
    a.href = file.data; a.download = name || file.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function openFile(file, label) {
    if (!file) return;
    const isPDF = file.type === "application/pdf" || file.name?.endsWith(".pdf");
    const isExcel = file.name?.match(/\.xlsx?$/i);
    const isVideo = file.type?.startsWith("video");
    if (isExcel) { downloadFile(file, file.name); return; }
    setLightbox({ type: isPDF ? "pdf" : isVideo ? "video" : "image", data: file.data, name: file.name, label });
  }

  function getSetStatusColor(set) {
    if (set.adminReview?.status === "rejected") return G.danger;
    if (set.adminReview?.status === "approved") return G.success;
    if (set.submissionStatus === "submitted") return G.accent;
    if (set.status === "complete") return G.success;
    return G.warn;
  }

  function getSetStatusLabel(set) {
    if (set.adminReview?.status === "rejected") return "✗ Admin Rejected";
    if (set.adminReview?.status === "approved") return "✓ Admin Approved";
    if (set.submissionStatus === "submitted") return "📤 Submitted for Review";
    if (set.status === "complete") return "✓ Ready to Submit";
    return `${getCompletionCount(set)}/5 uploaded`;
  }

  const isLocked = (set) => set.submissionStatus === "submitted" || set.adminReview?.status === "approved";

  return (
    <div style={{ padding: "20px 16px", maxWidth: 920, margin: "0 auto" }}>
      {lightbox && <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />}

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 5 }}>Welcome, {live.firstName} {live.lastName}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: G.muted }}>ID: #{live.id}</span>
          <STag status={live.status} />
          {live.emailVerified && <span style={S.tag(G.success)}>📧 ✓</span>}
          {live.mobileVerified && <span style={S.tag(G.success)}>📱 ✓</span>}
          {live.kyc?.businessName && <span style={{ fontSize: 11, color: G.muted }}>· {live.kyc.businessName}</span>}
        </div>
      </div>

      {!live.kycComplete && (
        <div style={{ background: `linear-gradient(135deg,${G.accent}10,${G.card})`, border: `1px solid ${G.accent}22`, borderRadius: 12, padding: 20, marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Complete Your KYC</div>
          <div style={{ fontSize: 12, color: G.muted, marginBottom: 14 }}>Submit business details, GST compliance, documents & photos to get verified.</div>
          <button style={{ ...S.btn, maxWidth: 160 }} onClick={onKYCStart}>Start KYC →</button>
        </div>
      )}
      {live.kycComplete && live.status === "pending" && <Alrt type="warn">🕐 KYC under review. You will be notified once approved.</Alrt>}
      {live.status === "rejected" && <Alrt type="error">✗ KYC rejected. {live.rejectReason || ""}<br /><button style={{ ...S.btnSm, marginTop: 8 }} onClick={onKYCStart}>Re-submit KYC</button></Alrt>}

      <div style={S.tabBar}>
        {["overview","invoices","activity"].map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === "invoices" ? `📦 Invoices${invoiceSets.length ? ` (${invoiceSets.length})` : ""}` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            { l: "KYC Status", v: <STag status={live.status} />, i: "🔐" },
            { l: "Business", v: live.kyc?.businessName || "—", i: "🏢" },
            { l: "Invoice Sets", v: `${invoiceSets.filter(s=>s.adminReview?.status==="approved").length} approved / ${invoiceSets.length} total`, i: "📦" },
            { l: "Submitted", v: invoiceSets.filter(s=>s.submissionStatus==="submitted").length, i: "📤" },
            { l: "PAN", v: live.kyc?.pan || "—", i: "🪪" },
            { l: "GST Eligible", v: live.kyc?.gstEligible ? "✓ Yes" : live.kyc ? "✗ No" : "—", i: "🧾" },
          ].map(item => (
            <div key={item.l} style={{ background: G.subtle, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 18, marginBottom: 5 }}>{item.i}</div>
              <div style={{ fontSize: 10, color: G.muted, marginBottom: 3 }}>{item.l}</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{item.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* INVOICES TAB */}
      {tab === "invoices" && (
        <div>
          {!isVerified && <Alrt type="warn">Invoice upload available only after KYC verification.</Alrt>}
          {isVerified && (<>
            {/* Client invoice search */}
            <div style={{ position: "relative", marginBottom: 14 }}>
              <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: G.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
              <input value={invSearchQ} onChange={e => setInvSearchQ(e.target.value)}
                placeholder="Search invoice by number… e.g. INV-2024-001"
                style={{ ...S.input, paddingLeft: 36, fontSize: 13 }} />
              {invSearchQ && <button onClick={() => setInvSearchQ("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: G.muted, fontSize: 14, cursor: "pointer" }}>✕</button>}
            </div>
            {invSearchQ && <div style={{ fontSize: 11, color: G.muted, marginBottom: 10 }}>{filteredInvoiceSets.length === 0 ? `No invoice found matching "${invSearchQ}"` : `${filteredInvoiceSets.length} result${filteredInvoiceSets.length !== 1 ? "s" : ""} for "${invSearchQ}"`}</div>}

            {/* Create new invoice set */}
            <div style={{ background: G.subtle, borderRadius: 12, padding: "16px 18px", marginBottom: 20, border: `1px solid ${G.border}` }}>
              <div style={{ ...S.sec, marginBottom: 10 }}>➕ New Invoice Set</div>
              <div style={{ fontSize: 12, color: G.muted, marginBottom: 12, lineHeight: 1.6 }}>
                Upload all 5 documents per invoice: <strong>Invoice PDF</strong>, <strong>E-Invoice PDF</strong>, <strong>E-Way Bill PDF</strong>, <strong>IMEI List (Excel/PDF)</strong>, and <strong>Docket</strong>. Each file is validated for compliance before uploading.
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Invoice Number *</label>
                  <input value={newInvNo} onChange={e => { setNewInvNo(e.target.value.toUpperCase()); setNewInvErr(""); }}
                    onKeyDown={e => e.key === "Enter" && createInvoiceSet()}
                    placeholder="e.g. INV-2024-001"
                    style={{ ...S.input, ...(newInvErr ? { borderColor: G.danger } : {}) }} />
                  {newInvErr && <div style={S.err}>{newInvErr}</div>}
                </div>
                <div style={{ marginBottom: newInvErr ? 20 : 0 }}>
                  <button style={{ ...S.btnSm, padding: "10px 20px" }} onClick={createInvoiceSet}>Create Set</button>
                </div>
              </div>
            </div>

            {invoiceSets.length === 0 && (
              <div style={{ textAlign: "center", padding: "36px 0", color: G.muted, fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
                No invoice sets yet. Create one above.
              </div>
            )}

            {[...filteredInvoiceSets].reverse().map(set => {
              const completed = getCompletionCount(set);
              const isExpanded = expandedSet === set.invNo;
              const locked = isLocked(set);
              const statusColor = getSetStatusColor(set);
              const progress = (completed / INV_SLOTS.length) * 100;
              const allFilled = completed === INV_SLOTS.length;
              const isRejected = set.adminReview?.status === "rejected";
              const isApproved = set.adminReview?.status === "approved";

              return (
                <div key={set.id} style={{ background: G.card, border: `2px solid ${statusColor}30`, borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
                  {/* Header */}
                  <div onClick={() => setExpandedSet(isExpanded ? null : set.invNo)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", background: isApproved ? G.success+"08" : isRejected ? G.danger+"08" : "transparent" }}>
                    <div style={{ fontSize: 20 }}>
                      {isApproved ? "✅" : isRejected ? "❌" : locked ? "📤" : completed === 5 ? "📋" : "📦"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>INV# {set.invNo}</span>
                        <span style={S.tag(statusColor)}>{getSetStatusLabel(set)}</span>
                        {locked && <span style={S.tag(G.muted)}>🔒 Locked</span>}
                      </div>
                      {!locked && (
                        <div style={{ height: 4, background: G.border, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${progress}%`, height: "100%", background: progress===100 ? G.success : G.accent, borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: G.muted, marginTop: 3 }}>
                        Created {new Date(set.createdAt).toLocaleDateString("en-IN")}
                        {set.submittedAt && ` · Submitted ${new Date(set.submittedAt).toLocaleDateString("en-IN")}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: G.muted }}>{isExpanded ? "▲" : "▼"}</span>
                      {!locked && (
                        <button onClick={e => { e.stopPropagation(); if (window.confirm("Delete this invoice set?")) deleteInvoiceSet(set.invNo); }}
                          style={{ padding: "4px 8px", borderRadius: 5, border: "none", background: G.danger+"20", color: G.danger, fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
                          🗑 Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Admin rejection notice */}
                  {isRejected && (
                    <div style={{ background: G.danger+"10", borderTop: `1px solid ${G.danger}25`, padding: "12px 16px" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.danger, marginBottom: 4 }}>
                        {set.adminReview?.status === "partial_reject" ? "🔄 Some Documents Rejected by Admin" : "❌ Invoice Set Rejected by Admin"}
                      </div>
                      {set.adminReview?.globalNote && (
                        <div style={{ fontSize: 12, color: G.text, marginBottom: 8, lineHeight: 1.6 }}>Admin note: {set.adminReview.globalNote}</div>
                      )}
                      {set.adminReview?.status === "partial_reject" && set.adminReview?.rejectedSlots?.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: G.text, marginBottom: 6, fontWeight: 600 }}>Please re-upload only these documents:</div>
                          {set.adminReview.rejectedSlots.map(k => {
                            const slot = INV_SLOTS.find(s => s.key === k);
                            const reason = set.adminReview.slotRemarks?.[k]?.reason;
                            return (
                              <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 5, padding: "6px 10px", background: G.danger+"10", borderRadius: 6, border: `1px solid ${G.danger}25` }}>
                                <span style={{ fontSize: 14 }}>{slot?.icon}</span>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: G.danger }}>{slot?.label}</div>
                                  {reason && <div style={{ fontSize: 11, color: G.text, marginTop: 1 }}>{reason}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <button onClick={() => resubmitInvoiceSet(set.invNo)}
                        style={{ ...S.btnSm, background: G.warn, color: "#000", padding: "8px 18px" }}>
                        ↺ {set.adminReview?.status === "partial_reject" ? "Re-upload Rejected Documents" : "Resubmit Invoice Set"}
                      </button>
                    </div>
                  )}

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${G.border}`, padding: "16px" }}>
                      {/* Locked view — view/download only */}
                      {locked && (
                        <div style={{ marginBottom: 14 }}>
                          <Alrt type={isApproved ? "success" : "info"}>
                            {isApproved
                              ? "✅ This invoice set has been approved by admin. Documents are read-only."
                              : "📤 Submitted for admin review. Documents are locked — no edits allowed until review is complete."}
                          </Alrt>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            {INV_SLOTS.map(slot => {
                              const file = set.files?.[slot.key];
                              return (
                                <div key={slot.key} style={{ background: G.subtle, borderRadius: 9, padding: "10px 12px", border: `1px solid ${file ? G.success+"40" : G.danger+"30"}` }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: file ? 8 : 0 }}>
                                    <span style={{ fontSize: 16 }}>{slot.icon}</span>
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 700 }}>{slot.label}</div>
                                      {!file && <div style={{ fontSize: 10, color: G.danger }}>Not uploaded</div>}
                                    </div>
                                    {file && <span style={{ marginLeft: "auto", color: G.success, fontSize: 12 }}>✓</span>}
                                  </div>
                                  {file && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                                        style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.accent+"20", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔍 View</button>
                                      <button onClick={() => downloadFile(file, file.name)}
                                        style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.success+"20", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⬇ Download</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Draft / editable view */}
                      {!locked && (
                        <>
                          {/* Partial reject info banner */}
                          {set.adminReview?.status === "partial_reject" && set.adminReview?.rejectedSlots?.length > 0 && (
                            <div style={{ background: G.warn+"12", border: `1px solid ${G.warn}30`, borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: G.warn, marginBottom: 4 }}>⚠ Partial Resubmission — Only Rejected Documents Can Be Replaced</div>
                              <div style={{ fontSize: 11, color: G.text, lineHeight: 1.6 }}>
                                Approved documents are locked and cannot be changed. Only the documents marked <span style={{ color: G.danger, fontWeight: 700 }}>REJECTED</span> below can be re-uploaded.
                              </div>
                            </div>
                          )}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 14 }}>
                            {INV_SLOTS.map(slot => {
                              const file = set.files?.[slot.key];
                              const slotInputId = `slot_${set.id}_${slot.key}`;
                              const isVal = isValidatingKey(set.invNo, slot.key);
                              const slotResult = getSlotErr(set.invNo, slot.key);
                              const hasError = slotResult && !slotResult.passed;
                              const hasWarn = slotResult && slotResult.passed && slotResult.warnings?.length;

                              // Partial reject logic: is this slot rejected? is it approved/locked?
                              const isPartialRejectMode = set.adminReview?.status === "partial_reject";
                              const isSlotRejected = isPartialRejectMode && (set.adminReview?.rejectedSlots || []).includes(slot.key);
                              const isSlotApprovedLocked = isPartialRejectMode && !isSlotRejected;
                              // Admin reason for this slot rejection
                              const adminSlotReason = set.adminReview?.slotRemarks?.[slot.key]?.reason;

                              // Border color logic
                              const borderColor = isSlotApprovedLocked
                                ? G.success + "60"
                                : isSlotRejected
                                  ? G.danger + "70"
                                  : file ? (hasError ? G.danger : G.success + "60") : hasError ? G.danger + "50" : G.border;

                              return (
                                <div key={slot.key} style={{ background: isSlotApprovedLocked ? G.success+"06" : G.subtle, borderRadius: 10, padding: "12px", border: `2px solid ${borderColor}`, opacity: isSlotApprovedLocked ? 0.85 : 1 }}>
                                  {/* Slot header */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                                    <span style={{ fontSize: 18 }}>{slot.icon}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 12, fontWeight: 700, color: isSlotApprovedLocked ? G.success : isSlotRejected ? G.danger : file ? (hasError ? G.danger : G.success) : G.text, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                        {slot.label}
                                        {isSlotApprovedLocked && <span style={{ fontSize: 9, background: G.success, color: "#fff", borderRadius: 3, padding: "1px 5px" }}>🔒 APPROVED</span>}
                                        {isSlotRejected && <span style={{ fontSize: 9, background: G.danger, color: "#fff", borderRadius: 3, padding: "1px 5px" }}>✗ REJECTED</span>}
                                      </div>
                                      <div style={{ fontSize: 10, color: G.muted }}>{slot.note}</div>
                                    </div>
                                    {isVal && <span style={{ fontSize: 10, color: G.accent }}>Checking…</span>}
                                    {file && !isVal && !hasError && !isSlotRejected && <span style={{ fontSize: 13 }}>✅</span>}
                                    {hasError && <span style={{ fontSize: 13 }}>❌</span>}
                                  </div>

                                  {/* Admin rejection reason for this slot */}
                                  {isSlotRejected && adminSlotReason && (
                                    <div style={{ background: G.danger+"12", border: `1px solid ${G.danger}25`, borderRadius: 6, padding: "7px 10px", marginBottom: 8, fontSize: 11, color: G.danger, lineHeight: 1.5 }}>
                                      <strong>Admin reason:</strong> {adminSlotReason}
                                    </div>
                                  )}

                                  {/* Approved & locked — only view/download, no edit */}
                                  {isSlotApprovedLocked && file && (
                                    <div>
                                      <div onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                                        style={{ background: G.bg, borderRadius: 7, padding: "7px 10px", marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, border: `1px solid ${G.success}30` }}>
                                        <span style={{ fontSize: 14 }}>{file.name?.match(/\.xlsx?$/i) ? "📊" : file.name?.endsWith(".pdf") || file.type === "application/pdf" ? "📄" : "🖼"}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: G.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
                                          <div style={{ fontSize: 10, color: G.success }}>Admin verified — locked</div>
                                        </div>
                                      </div>
                                      <div style={{ display: "flex", gap: 5 }}>
                                        <button onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                                          style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.accent+"20", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔍 View</button>
                                        <button onClick={() => downloadFile(file, file.name)}
                                          style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.success+"20", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⬇ Download</button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Validation in progress */}
                                  {!isSlotApprovedLocked && isVal && (
                                    <div style={{ background: G.accent+"10", border: `1px solid ${G.accent}25`, borderRadius: 7, padding: "10px 12px", marginBottom: 8 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                                        <div style={{ width: 14, height: 14, border: `2px solid ${G.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                                        <span style={{ fontSize: 12, color: G.accent, fontWeight: 600 }}>
                                          {slot.key === "imei" ? "Checking for duplicate IMEI/Serial numbers…" : "Validating compliance (PAN, GST, HSN)…"}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Validation errors */}
                                  {!isSlotApprovedLocked && hasError && !isVal && (
                                    <div style={{ background: G.danger+"10", border: `1px solid ${G.danger}30`, borderRadius: 7, padding: "10px 12px", marginBottom: 8 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: G.danger, marginBottom: 6 }}>⚠ Compliance Failed — Upload Blocked</div>
                                      {slotResult.errors.map((e, i) => (
                                        <div key={i} style={{ fontSize: 11, color: G.danger, marginBottom: 3, paddingLeft: 8, borderLeft: `2px solid ${G.danger}40`, lineHeight: 1.5 }}>{e}</div>
                                      ))}
                                      <div style={{ fontSize: 10, color: G.muted, marginTop: 6 }}>Fix the above issues and upload the corrected document.</div>
                                    </div>
                                  )}

                                  {/* Validation warnings */}
                                  {!isSlotApprovedLocked && hasWarn && !isVal && (
                                    <div style={{ background: G.success+"10", border: `1px solid ${G.success}25`, borderRadius: 7, padding: "8px 10px", marginBottom: 8 }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: G.success, marginBottom: 4 }}>✓ Compliance Passed</div>
                                      {slotResult.warnings.map((w, i) => (
                                        <div key={i} style={{ fontSize: 10, color: G.success, marginBottom: 2 }}>· {w}</div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Normal upload/edit area (not approved-locked) */}
                                  {!isSlotApprovedLocked && (
                                    <>
                                      {!file ? (
                                        <label htmlFor={slotInputId} style={{ display: "block", border: `2px dashed ${isSlotRejected ? G.danger+"60" : hasError ? G.danger+"50" : G.border}`, borderRadius: 8, padding: "10px", textAlign: "center", cursor: isVal ? "not-allowed" : "pointer", background: G.bg, opacity: isVal ? 0.6 : 1 }}>
                                          <div style={{ fontSize: 22, marginBottom: 4 }}>{slot.icon}</div>
                                          <div style={{ fontSize: 11, color: isSlotRejected ? G.danger : G.muted }}>
                                            {isVal ? "Validating…" : isSlotRejected ? "Tap to upload replacement" : hasError ? "Upload corrected file" : "Tap to upload"}
                                          </div>
                                          <input id={slotInputId} type="file" accept={slot.accept} disabled={isVal} style={{ display: "none" }}
                                            onChange={e => { if (e.target.files[0]) handleSlotUpload(set.invNo, slot.key, e.target.files[0], live.kyc); e.target.value = ""; }} />
                                        </label>
                                      ) : (
                                        <div>
                                          <div onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                                            style={{ background: G.bg, borderRadius: 7, padding: "8px 10px", marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, border: `1px solid ${G.border}` }}>
                                            <span style={{ fontSize: 16 }}>
                                              {file.name?.match(/\.xlsx?$/i) ? "📊" : file.name?.endsWith(".pdf") || file.type === "application/pdf" ? "📄" : "🖼"}
                                            </span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div style={{ fontSize: 11, fontWeight: 600, color: G.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
                                              <div style={{ fontSize: 10, color: G.muted }}>{file.name?.match(/\.xlsx?$/i) ? "Click to download" : "Click to view"}</div>
                                            </div>
                                          </div>
                                          <div style={{ display: "flex", gap: 5 }}>
                                            <button onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                                              style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.accent+"20", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔍 View</button>
                                            <button onClick={() => downloadFile(file, file.name)}
                                              style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.success+"20", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⬇ Save</button>
                                            {/* Replace — always available for editable slots */}
                                            <label htmlFor={slotInputId+"_r"} style={{ flex: 1, padding: "5px 0", borderRadius: 5, background: G.warn+"20", color: G.warn, fontSize: 10, fontWeight: 600, cursor: "pointer", textAlign: "center", display: "block" }}>
                                              ↺ Replace
                                              <input id={slotInputId+"_r"} type="file" accept={slot.accept} style={{ display: "none" }}
                                                onChange={e => { if (e.target.files[0]) handleSlotUpload(set.invNo, slot.key, e.target.files[0], live.kyc); e.target.value = ""; }} />
                                            </label>
                                            {/* Remove — only for non-partial-reject mode OR rejected slots */}
                                            {(!isPartialRejectMode || isSlotRejected) && (
                                              <button onClick={() => removeSlotFile(set.invNo, slot.key)}
                                                style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: G.danger+"15", color: G.danger, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>✕ Remove</button>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Submit button */}
                          <div style={{ borderTop: `1px solid ${G.border}`, paddingTop: 14 }}>
                            {allFilled ? (
                              <div>
                                <Alrt type="success">✅ All 5 documents uploaded and validated. Ready to submit for admin review.</Alrt>
                                <button onClick={() => submitInvoiceSet(set.invNo)}
                                  style={{ ...S.btn, background: G.success, maxWidth: 280 }}>
                                  📤 Submit for Admin Review →
                                </button>
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: G.warn, fontWeight: 600, padding: "8px 12px", background: G.warn+"10", borderRadius: 7, border: `1px solid ${G.warn}25` }}>
                                ⚠ {5 - completed} document{5 - completed !== 1 ? "s" : ""} remaining before you can submit
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>)}
        </div>
      )}

      {/* ACTIVITY TAB */}
      {tab === "activity" && (
        <div>
          {[
            { i: "🔐", l: "Account created & OTP verified", t: live.createdAt },
            ...(live.kycComplete ? [{ i: "📋", l: "KYC submitted", t: live.kyc?.submittedAt }] : []),
            ...(live.status === "verified" ? [{ i: "✅", l: "KYC approved by compliance team", t: live.verifiedAt }] : []),
            ...(invoiceSets.map(s => ({ i: s.submissionStatus==="submitted" ? "📤" : "📦", l: `Invoice ${s.invNo} — ${getSetStatusLabel(s)}`, t: s.submittedAt || s.createdAt }))),
          ].sort((a, b) => new Date(b.t) - new Date(a.t)).map((a, idx) => (
            <div key={idx} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10, padding: "10px 14px", background: G.subtle, borderRadius: 8 }}>
              <div style={{ fontSize: 18 }}>{a.i}</div>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>{a.l}</div><div style={{ fontSize: 11, color: G.muted }}>{new Date(a.t).toLocaleString()}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SheetJS for Excel parsing ───────────────────────────────────────────────
// Loaded via CDN script tag added to the root style block
let XLSX = null;
if (typeof window !== "undefined") {
  // Try to load SheetJS from CDN if not already loaded
  if (!window.XLSX) {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => { XLSX = window.XLSX; };
    document.head.appendChild(s);
  } else {
    XLSX = window.XLSX;
  }
}

// ─── ADMIN INVOICE REVIEW — PER-SLOT REJECTION ───────────────────────────────
function AdminInvReview({ set, clientId, refresh }) {

  const { G, S } = useTheme();
  // slotRemarks: { invoice: { action:"ok"|"reject", reason:"" }, ... }
  const initRemarks = () => {
    const r = {};
    INV_SLOTS.forEach(sl => { r[sl.key] = { action: "ok", reason: "" }; });
    return r;
  };
  const [remarks, setRemarks] = useState(initRemarks);
  const [globalNote, setGlobalNote] = useState("");
  const [err, setErr] = useState("");

  function setRemark(key, field, val) {
    setRemarks(prev => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
    setErr("");
  }

  function approve() {
    const idx = DB.clients.findIndex(c => c.id === clientId);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const si = sets.findIndex(s => s.invNo === set.invNo);
    if (si === -1) return;
    sets[si] = { ...sets[si], adminReview: { status: "approved", reviewedAt: new Date().toISOString(), slotRemarks: {}, globalNote } };
    DB.clients[idx].invoiceSets = sets; saveDB(); refresh();
  }

  function rejectSelected() {
    // Collect rejected slots
    const rejectedSlots = INV_SLOTS.filter(sl => remarks[sl.key]?.action === "reject");
    if (rejectedSlots.length === 0) { setErr("Mark at least one document as rejected, or use Approve All."); return; }
    const missingReason = rejectedSlots.find(sl => !remarks[sl.key]?.reason?.trim());
    if (missingReason) { setErr(`Please enter a rejection reason for: ${missingReason.label}`); return; }
    const idx = DB.clients.findIndex(c => c.id === clientId);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const si = sets.findIndex(s => s.invNo === set.invNo);
    if (si === -1) return;
    // Build per-slot review map
    const slotRemarks = {};
    INV_SLOTS.forEach(sl => { slotRemarks[sl.key] = { ...remarks[sl.key] }; });
    // Remove only rejected slot files so client re-uploads just those
    const newFiles = { ...sets[si].files };
    rejectedSlots.forEach(sl => { delete newFiles[sl.key]; });
    sets[si] = {
      ...sets[si],
      submissionStatus: "rejected",
      status: "incomplete",
      files: newFiles,
      adminReview: { status: "partial_reject", reviewedAt: new Date().toISOString(), slotRemarks, globalNote, rejectedSlots: rejectedSlots.map(s => s.key) }
    };
    DB.clients[idx].invoiceSets = sets; saveDB(); refresh();
  }

  // Determine if this is a re-review after partial rejection
  // rejectedSlots = the slots the client was asked to re-upload
  const prevRejectedSlots = set.adminReview?.rejectedSlots || [];
  const isResubmissionReview = prevRejectedSlots.length > 0;

  // For resubmission: approve the resubmitted slot → full set approved
  function approveResubmitted() {
    const idx = DB.clients.findIndex(c => c.id === clientId);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const si = sets.findIndex(s => s.invNo === set.invNo);
    if (si === -1) return;
    sets[si] = {
      ...sets[si],
      submissionStatus: "submitted",
      status: "complete",
      adminReview: {
        status: "approved",
        reviewedAt: new Date().toISOString(),
        slotRemarks: {},
        rejectedSlots: [],
        globalNote: "",
      }
    };
    DB.clients[idx].invoiceSets = sets; saveDB(); refresh();
  }

  function rejectResubmitted(slotKey, reason) {
    if (!reason?.trim()) { setErr(`Enter a rejection reason for ${INV_SLOTS.find(s=>s.key===slotKey)?.label}`); return; }
    const idx = DB.clients.findIndex(c => c.id === clientId);
    if (idx === -1) return;
    const sets = [...(DB.clients[idx].invoiceSets || [])];
    const si = sets.findIndex(s => s.invNo === set.invNo);
    if (si === -1) return;
    const newFiles = { ...sets[si].files };
    delete newFiles[slotKey];
    const slotRemarks = {};
    INV_SLOTS.forEach(sl => { slotRemarks[sl.key] = sl.key === slotKey ? { action: "reject", reason } : { action: "ok", reason: "" }; });
    sets[si] = {
      ...sets[si], submissionStatus: "rejected", status: "incomplete", files: newFiles,
      adminReview: { status: "partial_reject", reviewedAt: new Date().toISOString(), slotRemarks, globalNote: "", rejectedSlots: [slotKey] }
    };
    DB.clients[idx].invoiceSets = sets; saveDB(); refresh();
  }

  return (
    <div>
      {isResubmissionReview ? (
        // ── Resubmission mode: only show the resubmitted slots ──
        <div>
          <div style={{ background: G.accent+"12", border:`1px solid ${G.accent}28`, borderRadius:8, padding:"9px 12px", marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:G.accent, marginBottom:2 }}>🔄 Client Resubmission</div>
            <div style={{ fontSize:11, color:G.text }}>Only the re-uploaded file(s) need your decision. All other documents are already approved.</div>
          </div>

          {/* Locked approved slots */}
          <div style={{ marginBottom:10 }}>
            {INV_SLOTS.filter(sl => !prevRejectedSlots.includes(sl.key)).map(slot => (
              <div key={slot.key} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", marginBottom:5, borderRadius:7, background:G.success+"08", border:`1px solid ${G.success}20`, opacity:0.7 }}>
                <span style={{ fontSize:14 }}>{slot.icon}</span>
                <span style={{ fontSize:12, color:G.text, flex:1 }}>{slot.label}</span>
                <span style={{ fontSize:10, background:G.success, color:"#fff", borderRadius:3, padding:"2px 7px", fontWeight:700 }}>✓ APPROVED</span>
              </div>
            ))}
          </div>

          {/* Resubmitted slots — accept or reject each */}
          {prevRejectedSlots.map(slotKey => {
            const slot = INV_SLOTS.find(s => s.key === slotKey);
            const file = set.files?.[slotKey];
            const r = remarks[slotKey];
            const isRejecting = r?.action === "reject";
            return (
              <div key={slotKey} style={{ background:G.card, border:`2px solid ${G.accent}50`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:18 }}>{slot?.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:G.accent }}>{slot?.label}</div>
                    <div style={{ fontSize:10, color:G.muted }}>Re-uploaded by client — awaiting your decision</div>
                  </div>
                  <span style={{ fontSize:9, background:G.accent, color:"#fff", borderRadius:3, padding:"2px 7px", fontWeight:700 }}>RESUBMITTED</span>
                </div>
                {file && (
                  <div style={{ background:G.subtle, borderRadius:7, padding:"8px 10px", marginBottom:10, fontSize:11, color:G.text, display:"flex", alignItems:"center", gap:6 }}>
                    <span>📄</span> {file.name}
                  </div>
                )}
                {!file && <div style={{ color:G.danger, fontSize:11, marginBottom:8 }}>⚠ File not yet uploaded by client</div>}
                {/* Decision buttons */}
                <div style={{ display:"flex", gap:6, marginBottom: isRejecting ? 8 : 0 }}>
                  <button onClick={() => setRemark(slotKey, "action", "ok")}
                    style={{ flex:1, padding:"8px", borderRadius:6, border:"none", background: !isRejecting ? G.success : G.subtle, color: !isRejecting ? "#fff" : G.muted, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    ✓ Accept
                  </button>
                  <button onClick={() => setRemark(slotKey, "action", "reject")}
                    style={{ flex:1, padding:"8px", borderRadius:6, border:"none", background: isRejecting ? G.danger : G.subtle, color: isRejecting ? "#fff" : G.muted, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    ✗ Reject Again
                  </button>
                </div>
                {isRejecting && (
                  <input value={r.reason} onChange={e => setRemark(slotKey, "reason", e.target.value)}
                    placeholder={`Reason for rejecting ${slot?.label} again`}
                    style={{ width:"100%", background:G.subtle, border:`1px solid ${G.danger}40`, borderRadius:6, padding:"7px 10px", color:G.text, fontSize:11, outline:"none", boxSizing:"border-box" }} />
                )}
              </div>
            );
          })}

          {err && <div style={{ fontSize:11, color:G.danger, marginBottom:8, padding:"6px 10px", background:G.danger+"10", borderRadius:6 }}>{err}</div>}

          {/* Final submit */}
          {(() => {
            const allAccepted = prevRejectedSlots.every(k => remarks[k]?.action === "ok");
            const hasReject = prevRejectedSlots.some(k => remarks[k]?.action === "reject");
            return (
              <div style={{ display:"flex", gap:8 }}>
                {allAccepted && (
                  <button onClick={approveResubmitted}
                    style={{ flex:1, padding:"10px", borderRadius:7, border:"none", background:G.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✓ Approve Resubmission
                  </button>
                )}
                {hasReject && (
                  <button onClick={() => {
                    const rejectingSlot = prevRejectedSlots.find(k => remarks[k]?.action === "reject");
                    if (rejectingSlot) rejectResubmitted(rejectingSlot, remarks[rejectingSlot]?.reason);
                  }}
                    style={{ flex:1, padding:"10px", borderRadius:7, border:"none", background:G.danger, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✗ Send Back Again
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        // ── Fresh review: show all 5 slots ──
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: G.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Review Each Document</div>

          {INV_SLOTS.map(slot => {
            const file = set.files?.[slot.key];
            const r = remarks[slot.key];
            const isRejected = r.action === "reject";
            return (
              <div key={slot.key} style={{ background: G.bg, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: `1px solid ${isRejected ? G.danger+"50" : G.success+"30"}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isRejected ? 8 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{slot.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{slot.label}</span>
                    {!file && <span style={{ fontSize: 10, color: G.danger }}>· Not uploaded</span>}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button onClick={() => setRemark(slot.key, "action", "ok")}
                      style={{ padding: "3px 10px", borderRadius: 4, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer", background: !isRejected ? G.success : G.subtle, color: !isRejected ? "#fff" : G.muted }}>✓ OK</button>
                    <button onClick={() => setRemark(slot.key, "action", "reject")}
                      style={{ padding: "3px 10px", borderRadius: 4, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer", background: isRejected ? G.danger : G.subtle, color: isRejected ? "#fff" : G.muted }}>✗ Reject</button>
                  </div>
                </div>
                {isRejected && (
                  <input value={r.reason} onChange={e => setRemark(slot.key, "reason", e.target.value)}
                    placeholder={`Rejection reason for ${slot.label} (client will see this)`}
                    style={{ width: "100%", background: G.subtle, border: `1px solid ${G.danger}40`, borderRadius: 6, padding: "6px 9px", color: G.text, fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                )}
              </div>
            );
          })}

          <textarea value={globalNote} onChange={e => setGlobalNote(e.target.value)}
            placeholder="Overall note to client (optional)" rows={2}
            style={{ width: "100%", background: G.bg, border: `1px solid ${G.border}`, borderRadius: 7, padding: "8px 10px", color: G.text, fontSize: 11, outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />

          {err && <div style={{ fontSize: 11, color: G.danger, marginBottom: 8, padding: "6px 10px", background: G.danger+"10", borderRadius: 6 }}>{err}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={approve}
              style={{ flex: 1, padding: "9px", borderRadius: 7, border: "none", background: G.success, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✓ Approve All</button>
            <button onClick={rejectSelected}
              style={{ flex: 1, padding: "9px", borderRadius: 7, border: "none", background: G.danger, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✗ Reject Marked Docs</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MEDIA LIGHTBOX ──────────────────────────────────────────────────────────
function MediaLightbox({ item, onClose }) {

  const { G, S } = useTheme();
  // item = { type: "image"|"pdf"|"video", data, name, label }
  const isImage = item.type === "image";
  const isPDF = item.type === "pdf";
  const isVideo = item.type === "video";

  function downloadFile() {
    const link = document.createElement("a");
    link.href = item.data;
    link.download = item.name || "document";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Close on backdrop click
  function handleBackdrop(e) { if (e.target === e.currentTarget) onClose(); }

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div onClick={handleBackdrop} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 500, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid #1E293B", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#F1F5F9" }}>{item.label || item.name}</span>
          {item.name && <span style={{ fontSize: 11, color: "#64748B" }}>({item.name})</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={downloadFile} style={{ padding: "7px 14px", borderRadius: 6, border: "none", background: "#38BDF8", color: "#0B0F1A", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            ⬇ Download
          </button>
          <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #1E293B", background: "transparent", color: "#64748B", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
            ✕ Close
          </button>
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "auto" }}>
        {isImage && (
          <img src={item.data} alt={item.label} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
        )}
        {isPDF && (
          <div style={{ width: "100%", maxWidth: 800, height: "100%", minHeight: 500, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <div style={{ background: "#111827", border: "1px solid #1E293B", borderRadius: 12, padding: "32px 24px", textAlign: "center", width: "100%" }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#F1F5F9", marginBottom: 6 }}>{item.name}</div>
              <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>PDF Document — Preview not available in this viewer</div>
              <button onClick={downloadFile} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "#38BDF8", color: "#0B0F1A", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                ⬇ Download PDF to View
              </button>
            </div>
            {/* Try to embed PDF */}
            <iframe src={item.data} style={{ width: "100%", flex: 1, minHeight: 400, border: "none", borderRadius: 8 }} title={item.name} />
          </div>
        )}
        {isVideo && (
          <video src={item.data} controls autoPlay style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
        )}
      </div>
    </div>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
function AdminDashboard() {

  const { G, S } = useTheme();
  const [selected, setSelected] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [kycTab, setKycTab] = useState("pending");
  const [adminTab, setAdminTab] = useState("kyc");
  const [lightbox, setLightbox] = useState(null);
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate(n => n + 1);

  // Search state
  const [partySearch, setPartySearch] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedPartyId, setSelectedPartyId] = useState(null); // invoice drill-down
  const [statusFilter, setStatusFilter] = useState(null); // null | "kyc_pending" | "kyc_verified" | "kyc_rejected" | "inv_pending"

  function verify(c) {
    const idx = DB.clients.findIndex(x => x.id === c.id);
    if (idx !== -1) { DB.clients[idx].status = "verified"; DB.clients[idx].verifiedAt = new Date().toISOString(); saveDB(); }
    setSelected(null); refresh();
  }
  function rejectKyc(c) {
    if (!rejectReason) return;
    const idx = DB.clients.findIndex(x => x.id === c.id);
    if (idx !== -1) { DB.clients[idx].status = "rejected"; DB.clients[idx].rejectReason = rejectReason; saveDB(); }
    setSelected(null); setRejectReason(""); refresh();
  }

  function openDoc(label, file) {
    if (!file) return;
    const isPDF = file.type === "application/pdf" || file.name?.endsWith(".pdf");
    const isVideo = file.type?.startsWith("video") || file.name?.match(/\.(webm|mp4)$/i);
    setLightbox({ type: isPDF ? "pdf" : isVideo ? "video" : "image", data: file.data, name: file.name, label });
  }
  function openImage(label, data, name) { setLightbox({ type: "image", data, name: name || label, label }); }
  function openVideo(label, data, name) { setLightbox({ type: "video", data, name: name || label, label }); }
  function dlFile(data, name) {
    const a = document.createElement("a"); a.href = data; a.download = name || "file";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function DocCard({ label, file, isResubmitted = false, isApprovedLocked = false }) {
    if (!file) return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: G.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
        <div style={{ fontSize: 11, color: G.danger }}>Not uploaded</div>
      </div>
    );
    const isPDF = file.type === "application/pdf" || file.name?.endsWith(".pdf");
    const isVid = file.type?.startsWith("video") || file.name?.match(/\.(webm|mp4)$/i);
    return (
      <div style={{ marginBottom: 12, opacity: isApprovedLocked ? 0.55 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <div style={{ fontSize: 10, color: G.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>{label}</div>
          {isResubmitted && <span style={{ fontSize: 9, background: G.accent, color: "#fff", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>🔄 RESUBMITTED</span>}
          {isApprovedLocked && <span style={{ fontSize: 9, background: G.success, color: "#fff", borderRadius: 3, padding: "1px 6px" }}>✓ APPROVED</span>}
        </div>
        <div style={{ border: `2px solid ${isResubmitted ? G.accent : isApprovedLocked ? G.success+"50" : G.border}`, borderRadius: 8, overflow: "hidden", background: G.bg }}>
          <div style={{ cursor: "pointer" }} onClick={() => openDoc(label, file)}>
            {isPDF ? (
              <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", background: G.subtle, gap: 8 }}>
                <span style={{ fontSize: 24 }}>📄</span>
                <div><div style={{ fontSize: 12, color: G.text, fontWeight: 600 }}>PDF</div><div style={{ fontSize: 10, color: G.muted }}>{file.name}</div></div>
              </div>
            ) : isVid ? (
              <div style={{ height: 60, position: "relative", background: "#000" }}>
                <video src={file.data} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}><span style={{ fontSize: 18 }}>▶</span></div>
              </div>
            ) : (
              <img src={file.data} alt={label} style={{ width: "100%", height: 60, objectFit: "cover", display: "block" }} />
            )}
          </div>
          <div style={{ display: "flex", borderTop: `1px solid ${G.border}` }}>
            <button onClick={() => openDoc(label, file)} style={{ flex: 1, padding: "5px 0", background: "transparent", border: "none", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer", borderRight: `1px solid ${G.border}` }}>View</button>
            <button onClick={() => dlFile(file.data, file.name || label)} style={{ flex: 1, padding: "5px 0", background: "transparent", border: "none", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Download</button>
          </div>
        </div>
      </div>
    );
  }

  function PhotoStrip({ label, photos }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: G.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>{label} ({(photos || []).length})</div>
        {!(photos?.length) ? <div style={{ fontSize: 11, color: G.muted }}>None uploaded</div> : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {photos.map((p, i) => (
              <div key={i} style={{ width: 90, flexShrink: 0 }}>
                <div style={{ position: "relative", cursor: "pointer" }} onClick={() => openImage(`${label} ${i + 1}`, p.data, p.name)}>
                  <img src={p.data} alt="" style={{ width: 90, height: 66, objectFit: "cover", borderRadius: "6px 6px 0 0", border: `1px solid ${G.border}`, borderBottom: "none", display: "block" }} />
                  <button onClick={e => { e.stopPropagation(); dlFile(p.data, p.name || `photo_${i + 1}.jpg`); }}
                    style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.75)", border: "none", borderRadius: 3, color: "#38BDF8", fontSize: 9, cursor: "pointer", padding: "2px 5px", lineHeight: 1 }}>⬇</button>
                </div>
                {/* GPS tag row always shown */}
                <div style={{ background: (p.lat && p.lng) ? "rgba(16,185,129,0.88)" : G.subtle, border: `1px solid ${G.border}`, borderTop: "none", borderRadius: "0 0 6px 6px", padding: "3px 5px", textAlign: "center" }}>
                  {(p.lat && p.lng) ? (
                    <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, lineHeight: 1.4 }}>
                      📍 {parseFloat(p.lat).toFixed(4)}, {parseFloat(p.lng).toFixed(4)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 8, color: G.muted }}>No GPS</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const allClients = DB.clients;
  const pending = allClients.filter(c => c.kycComplete && c.status === "pending");
  const verified = allClients.filter(c => c.status === "verified");
  const rejected = allClients.filter(c => c.status === "rejected");

  const kycList = (kycTab === "pending" ? pending : kycTab === "verified" ? verified : rejected).filter(c => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) || c.mobile.includes(q) ||
      (c.kyc?.businessName || "").toLowerCase().includes(q);
  });

  const invoiceClients = allClients.filter(c => (c.invoiceSets || []).some(s => s.submissionStatus === "submitted" || s.adminReview));
  const filteredParties = invoiceClients.filter(c => {
    if (!partySearch.trim()) return true;
    const q = partySearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.kyc?.businessName || "").toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q);
  });
  const getFilteredSets = (c) => {
    const sets = (c.invoiceSets || []).filter(s => s.submissionStatus === "submitted" || s.adminReview);
    if (!invSearch.trim()) return sets;
    return sets.filter(s => s.invNo.toLowerCase().includes(invSearch.toLowerCase()));
  };

  const pendingInvCount = allClients.reduce((acc, c) => acc + (c.invoiceSets || []).filter(s => s.submissionStatus === "submitted" && !s.adminReview).length, 0);

  return (
    <div style={{ padding: "16px 12px", maxWidth: 1200, margin: "0 auto", boxSizing: "border-box" }}>
      {lightbox && <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />}

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Admin Panel</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { l: "KYC Pending", n: pending.length, c: G.warn },
            { l: "KYC Verified", n: verified.length, c: G.success },
            { l: "KYC Rejected", n: rejected.length, c: G.danger },
            { l: "Invoices Pending", n: pendingInvCount, c: G.accent },
          ].map(s => (
            <div key={s.l} style={{ background: G.subtle, borderRadius: 8, padding: "8px 14px", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.n}</span>
              <span style={{ fontSize: 11, color: G.muted }}>{s.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${G.border}`, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[
          { key: "kyc", label: `🔐 KYC Review`, badge: pending.length },
          { key: "invoices", label: `📦 Invoice Review`, badge: pendingInvCount },
        ].map(t => (
          <button key={t.key} onClick={() => { setAdminTab(t.key); setSelected(null); }}
            style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: adminTab === t.key ? `2px solid ${G.accent}` : "2px solid transparent", color: adminTab === t.key ? G.accent : G.muted, display: "flex", alignItems: "center", gap: 6 }}>
            {t.label}
            {t.badge > 0 && <span style={{ background: adminTab === t.key ? G.accent : G.warn, color: "#000", borderRadius: 20, padding: "1px 7px", fontSize: 9, fontWeight: 700 }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* KYC TAB */}
      {adminTab === "kyc" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 0, border: `1px solid ${G.border}`, borderRadius: 8, overflow: "hidden" }}>
              {["pending", "verified", "rejected"].map((t, i) => (
                <button key={t} onClick={() => { setKycTab(t); setSelected(null); }}
                  style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: kycTab === t ? G.accent + "18" : "transparent", border: "none", borderRight: i < 2 ? `1px solid ${G.border}` : "none", color: kycTab === t ? G.accent : G.muted }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: G.muted, fontSize: 13 }}>🔍</span>
              <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                placeholder="Search name, email, mobile, business…"
                style={{ ...S.input, paddingLeft: 32, fontSize: 12 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, flexDirection: "column" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {kycList.length === 0
                ? <div style={{ textAlign: "center", padding: 40, color: G.muted, fontSize: 13 }}>No results</div>
                : kycList.map(c => (
                  <div key={c.id} onClick={() => setSelected(c)}
                    style={{ background: selected?.id === c.id ? G.accent + "12" : G.subtle, border: `1px solid ${selected?.id === c.id ? G.accent + "40" : G.border}`, borderRadius: 10, padding: "11px 13px", marginBottom: 7, cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.firstName} {c.lastName}</div>
                        <div style={{ fontSize: 11, color: G.muted }}>{c.kyc?.businessName || "KYC not submitted"}</div>
                        <div style={{ fontSize: 10, color: G.muted }}>{c.email} · {c.mobile}</div>
                      </div>
                      <STag status={c.status} />
                    </div>
                  </div>
                ))}
            </div>

            {selected && (
              <div style={{ width: "100%", maxWidth: "100%", background: G.card, border: `1px solid ${G.border}`, borderRadius: 12, padding: 15, maxHeight: "85vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.firstName} {selected.lastName}</div>
                    <div style={{ fontSize: 10, color: G.muted }}>#{selected.id}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <STag status={selected.status} />
                    <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: G.muted, fontSize: 16, cursor: "pointer" }}>✕</button>
                  </div>
                </div>

                <div style={S.sec}>Personal Info</div>
                {[["Email", selected.email], ["Mobile", selected.mobile], ["Alt Mobile", selected.kyc?.altMobile || "—"], ["Alt Email", selected.kyc?.altEmail || "—"], ["Email OTP", selected.emailVerified ? "✓ Yes" : "No"], ["Mobile OTP", selected.mobileVerified ? "✓ Yes" : "No"]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: G.muted }}>{k}</span>
                    <span style={{ color: v?.startsWith("✓") ? G.success : G.text }}>{v}</span>
                  </div>
                ))}

                {selected.kyc && <>
                  <hr style={S.divider} />
                  <div style={S.sec}>Business & GST</div>
                  {[["Business", selected.kyc.businessName], ["Type", selected.kyc.businessType], ["PAN", selected.kyc.pan], ["GSTIN", selected.kyc.gst], ["GST Eligible", selected.kyc.gstEligible ? "Yes" : "No"], ["Address", `${selected.kyc.address1}, ${selected.kyc.city}, ${selected.kyc.state} - ${selected.kyc.pincode}`], ["GPS", selected.kyc.lat ? `${selected.kyc.lat}, ${selected.kyc.lng}` : "—"]].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                      <span style={{ color: G.muted, flexShrink: 0, marginRight: 6 }}>{k}</span>
                      <span style={{ textAlign: "right", maxWidth: 210, wordBreak: "break-word" }}>{v}</span>
                    </div>
                  ))}
                  <hr style={S.divider} />
                  <div style={S.sec}>KYC Documents</div>
                  {(() => {
                    const rf = selected.kyc?.resubmittedField;
                    const isR = !!rf;
                    return [
                      { label: "GSTIN Certificate", field: "gstinCopy" },
                      { label: "PAN Card",           field: "panCopy" },
                      { label: "Aadhaar Card",       field: "aadharCopy" },
                    ].map(({ label, field }) => (
                      <DocCard key={field} label={label} file={selected.kyc[field]}
                        isResubmitted={isR && rf === field}
                        isApprovedLocked={isR && rf !== field}
                      />
                    ));
                  })()}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: G.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>Live Capture</div>
                    {!selected.kyc.liveCapture ? <div style={{ fontSize: 11, color: G.danger }}>Not captured</div> : (
                      <div style={{ border: `1px solid ${G.border}`, borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ cursor: "pointer" }} onClick={() => { const lc = selected.kyc.liveCapture; lc.type === "video" ? openVideo("Live Capture", lc.data, lc.name) : openImage("Live Capture", lc.data, lc.name); }}>
                          {selected.kyc.liveCapture.type === "video"
                            ? <div style={{ height: 60, position: "relative", background: "#000" }}><video src={selected.kyc.liveCapture.data} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted /><div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}><span style={{ fontSize: 18 }}>▶</span></div></div>
                            : <img src={selected.kyc.liveCapture.data} alt="Live" style={{ width: "100%", height: 60, objectFit: "cover", display: "block" }} />}
                        </div>
                        <div style={{ display: "flex", borderTop: `1px solid ${G.border}` }}>
                          <button onClick={() => { const lc = selected.kyc.liveCapture; lc.type === "video" ? openVideo("Live Capture", lc.data, lc.name) : openImage("Live Capture", lc.data, lc.name); }} style={{ flex: 1, padding: "5px 0", background: "transparent", border: "none", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer", borderRight: `1px solid ${G.border}` }}>View</button>
                          <button onClick={() => { const lc = selected.kyc.liveCapture; dlFile(lc.data, lc.name || "live"); }} style={{ flex: 1, padding: "5px 0", background: "transparent", border: "none", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Download</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <hr style={S.divider} />
                  <div style={S.sec}>Premises Photos</div>
                  <PhotoStrip label="Front" photos={selected.kyc.frontPhotos} />
                  <PhotoStrip label="Inside" photos={selected.kyc.insidePhotos} />
                </>}

                {selected.status === "pending" && selected.kycComplete && (() => {
                  // Detect resubmission: check if kyc has resubmittedFile flag
                  const resubFile = selected.kyc?.resubmittedField; // e.g. "gstinCopy"
                  const isResubmit = !!resubFile;
                  return (
                    <>
                      <hr style={S.divider} />
                      {isResubmit ? (
                        <div>
                          <div style={{ background: G.accent+"12", border: `1px solid ${G.accent}28`, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: G.accent, marginBottom: 3 }}>🔄 Resubmission Detected</div>
                            <div style={{ fontSize: 11, color: G.text }}>Client has re-uploaded <strong>{resubFile}</strong>. All previously approved fields are locked. Only this file requires your decision.</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={{ ...S.btnSuccess, flex: 1 }} onClick={() => { const idx = DB.clients.findIndex(x => x.id === selected.id); if (idx !== -1) { DB.clients[idx].status = "verified"; DB.clients[idx].verifiedAt = new Date().toISOString(); delete DB.clients[idx].kyc.resubmittedField; saveDB(); } setSelected(null); refresh(); }}>✓ Accept Resubmission</button>
                            <button style={{ ...S.btnDanger, flex: 1 }} onClick={() => { if (!rejectReason.trim()) return; const idx = DB.clients.findIndex(x => x.id === selected.id); if (idx !== -1) { DB.clients[idx].status = "rejected"; DB.clients[idx].rejectReason = rejectReason; saveDB(); } setSelected(null); setRejectReason(""); refresh(); }}>✗ Reject</button>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <FInput placeholder="Rejection reason (required to reject)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <button style={{ ...S.btnSuccess, flex: 1 }} onClick={() => verify(selected)}>✓ Verify All</button>
                            <button style={{ ...S.btnDanger, flex: 1 }} onClick={() => { if (rejectReason) rejectKyc(selected); }}>✗ Reject</button>
                          </div>
                          <FInput placeholder="Rejection reason (required)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* INVOICE TAB */}
      {adminTab === "invoices" && (
        <div>
          {/* ── Status Filter Chips ── */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
            {[
              { key: null,           label: "All Parties",          n: allClients.filter(c=>(c.invoiceSets||[]).some(s=>s.submissionStatus==="submitted"||s.adminReview)).length, color: G.muted },
              { key: "kyc_pending",  label: "KYC Pending",          n: pending.length,       color: G.warn    },
              { key: "kyc_verified", label: "KYC Verified",         n: verified.length,      color: G.success },
              { key: "kyc_rejected", label: "KYC Rejected",         n: rejected.length,      color: G.danger  },
              { key: "inv_pending",  label: "Invoice Pending",      n: pendingInvCount,      color: G.accent  },
            ].map(f => {
              const active = statusFilter === f.key;
              return (
                <button key={String(f.key)} onClick={() => { setStatusFilter(f.key); setSelectedPartyId(null); setPartySearch(""); }}
                  style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${active ? f.color : G.border}`, background: active ? f.color + "20" : G.subtle, color: active ? f.color : G.muted, fontWeight: active ? 700 : 500, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ background: f.color, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{f.n}</span>
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* ── Search bar ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: G.muted, fontSize: 13 }}>🔍</span>
              <input value={partySearch} onChange={e => { setPartySearch(e.target.value); setSelectedPartyId(null); }}
                placeholder="Search party name, email, business…"
                style={{ ...S.input, paddingLeft: 32, fontSize: 12 }} />
            </div>
            {selectedPartyId && (
              <div style={{ flex: 1, minWidth: 160, position: "relative" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: G.muted, fontSize: 13 }}>📋</span>
                <input value={invSearch} onChange={e => setInvSearch(e.target.value)}
                  placeholder="Filter invoice number…"
                  style={{ ...S.input, paddingLeft: 32, fontSize: 12 }} />
              </div>
            )}
            {(partySearch || invSearch || selectedPartyId) && (
              <button onClick={() => { setPartySearch(""); setInvSearch(""); setSelectedPartyId(null); }}
                style={{ ...S.btnGhost, fontSize: 11 }}>✕ Clear</button>
            )}
          </div>

          {/* ── Party list (left) + Invoice detail (right) ── */}
          {(() => {
            // Compute visible parties based on filter + search
            let baseList = allClients.filter(c => (c.invoiceSets||[]).some(s => s.submissionStatus==="submitted"||s.adminReview));
            if (statusFilter === "kyc_pending")  baseList = baseList.filter(c => c.kycComplete && c.status==="pending");
            if (statusFilter === "kyc_verified") baseList = baseList.filter(c => c.status==="verified");
            if (statusFilter === "kyc_rejected") baseList = baseList.filter(c => c.status==="rejected");
            if (statusFilter === "inv_pending")  baseList = baseList.filter(c => (c.invoiceSets||[]).some(s => s.submissionStatus==="submitted"&&!s.adminReview));
            if (partySearch.trim()) {
              const q = partySearch.toLowerCase();
              baseList = baseList.filter(c =>
                `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
                (c.kyc?.businessName||"").toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q)
              );
            }

            const selectedClient = selectedPartyId ? allClients.find(c => c.id === selectedPartyId) : null;
            const selectedSets = selectedClient
              ? (selectedClient.invoiceSets||[]).filter(s => s.submissionStatus==="submitted"||s.adminReview).filter(s => !invSearch.trim() || s.invNo.toLowerCase().includes(invSearch.toLowerCase()))
              : [];

            return (
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                {/* Party list column */}
                <div style={{ width: "100%", maxWidth: 320, flex: "1 1 260px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: G.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 4 }}>
                    Parties ({baseList.length})
                  </div>
                  {baseList.length === 0 && (
                    <div style={{ textAlign: "center", padding: "28px 0", color: G.muted, fontSize: 13 }}>
                      <div style={{ fontSize: 28, marginBottom: 6 }}>🏢</div>
                      No parties found
                    </div>
                  )}
                  {baseList.map(c => {
                    const cSets = (c.invoiceSets||[]).filter(s=>s.submissionStatus==="submitted"||s.adminReview);
                    const pendingCount = cSets.filter(s=>s.submissionStatus==="submitted"&&!s.adminReview).length;
                    const approvedCount = cSets.filter(s=>s.adminReview?.status==="approved").length;
                    const isSelected = selectedPartyId === c.id;
                    return (
                      <div key={c.id} onClick={() => { setSelectedPartyId(isSelected ? null : c.id); setInvSearch(""); }}
                        style={{ padding: "11px 13px", borderRadius: 10, marginBottom: 6, cursor: "pointer", border: `2px solid ${isSelected ? G.accent : G.border}`, background: isSelected ? G.accent+"10" : G.card, transition: "all 0.15s" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: isSelected ? G.accent : G.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {c.firstName} {c.lastName}
                            </div>
                            <div style={{ fontSize: 11, color: G.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {c.kyc?.businessName || c.email}
                            </div>
                            <div style={{ fontSize: 9, color: G.muted, marginTop: 2 }}>GSTIN: {c.kyc?.gst || "—"}</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0, marginLeft: 6 }}>
                            {pendingCount > 0 && <span style={S.tag(G.warn)}>{pendingCount} pending</span>}
                            {approvedCount > 0 && <span style={S.tag(G.success)}>{approvedCount} approved</span>}
                          </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 10, color: G.muted }}>{cSets.length} invoice{cSets.length!==1?"s":""} total</div>
                      </div>
                    );
                  })}
                </div>

                {/* Invoice detail panel */}
                <div style={{ flex: "2 1 320px", minWidth: 0 }}>
                  {!selectedClient ? (
                    <div style={{ textAlign: "center", padding: "52px 24px", color: G.muted, background: G.card, borderRadius: 12, border: `1px dashed ${G.border}` }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>👈</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Select a party</div>
                      <div style={{ fontSize: 12 }}>Click any party on the left to view their invoices</div>
                    </div>
                  ) : (
                    <div>
                      {/* Party header */}
                      <div style={{ background: G.subtle, borderRadius: "12px 12px 0 0", padding: "12px 16px", border: `1px solid ${G.border}`, borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedClient.firstName} {selectedClient.lastName}</div>
                          <div style={{ fontSize: 11, color: G.muted }}>{selectedClient.kyc?.businessName || selectedClient.email} · GSTIN: {selectedClient.kyc?.gst || "—"}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <STag status={selectedClient.status} />
                          <button onClick={() => setSelectedPartyId(null)} style={{ background:"none", border:"none", color:G.muted, fontSize:16, cursor:"pointer" }}>✕</button>
                        </div>
                      </div>

                      {/* Column headers */}
                      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr", gap: 0, background: G.subtle, border: `1px solid ${G.border}`, borderTop: "none", borderBottom: "none", padding: "7px 16px" }}>
                        {["Invoice Number", "Submitted", "Documents", "Status"].map(h => (
                          <div key={h} style={{ fontSize: 10, fontWeight: 700, color: G.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</div>
                        ))}
                      </div>

                      <div style={{ border: `1px solid ${G.border}`, borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                        {selectedSets.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "28px", color: G.muted, fontSize: 13 }}>
                            {invSearch ? `No invoice matching "${invSearch}"` : "No submitted invoices for this party"}
                          </div>
                        ) : selectedSets.map((set, si) => {
                          const isReviewed = !!set.adminReview;
                          const isPartialReject = set.adminReview?.status === "partial_reject";
                          const isApproved = set.adminReview?.status === "approved";
                          // Detect resubmission waiting for re-review
                          const isAwaitingReview = isPartialReject && set.submissionStatus === "submitted" && (set.adminReview?.rejectedSlots || []).length > 0;
                          const statusColor = isApproved ? G.success : isAwaitingReview ? G.accent : (isPartialReject || set.adminReview?.status === "rejected") ? G.danger : G.accent;
                          const statusLabel = isApproved ? "✓ Approved" : isAwaitingReview ? "🔄 Re-Review" : isPartialReject ? "↺ Partial Reject" : set.adminReview?.status === "rejected" ? "✗ Rejected" : "⏳ Pending";
                          const completedDocs = INV_SLOTS.filter(sl => set.files?.[sl.key]).length;
                          return (
                            <InvSetReviewCard key={set.id} set={set} clientId={selectedClient.id} client={selectedClient}
                              si={si} total={selectedSets.length} statusColor={statusColor} statusLabel={statusLabel}
                              isReviewed={isReviewed && !isAwaitingReview} refresh={refresh}
                              setLightbox={setLightbox} dlFile={dlFile}
                              completedDocs={completedDocs}
                              showPartyName={false}
                              isLastInGroup={si === selectedSets.length - 1}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── INV SET REVIEW CARD ──────────────────────────────────────────────────────
// Renders as a table row with columns: Party | Invoice No | Submitted | Docs | Status
// Expands inline to show document details and review controls
function InvSetReviewCard({ set, clientId, client, si, total, statusColor, statusLabel, isReviewed, refresh, setLightbox, dlFile, completedDocs, showPartyName, isLastInGroup }) {

  const { G, S } = useTheme();
  const isApproved = set.adminReview?.status === "approved";
  const isPartialReject = set.adminReview?.status === "partial_reject";

  // Resubmission detection:
  // Client has re-uploaded the rejected file(s) → submissionStatus is "submitted"
  // but adminReview still has rejectedSlots from the previous round.
  // In this state we need to show AdminInvReview again (only for rejected slots).
  const isAwaitingResubmitReview =
    isPartialReject &&
    set.submissionStatus === "submitted" &&
    (set.adminReview?.rejectedSlots || []).length > 0;

  // Auto-expand when waiting for re-review
  const [expanded, setExpanded] = useState(!isReviewed || isAwaitingResubmitReview);

  function openFile(file, label) {
    if (!file) return;
    const isExcel = file.name?.match(/\.xlsx?$/i);
    const isPDF = file.type === "application/pdf" || file.name?.endsWith(".pdf");
    const isVid = file.type?.startsWith("video") || file.name?.match(/\.(webm|mp4)$/i);
    if (isExcel) { dlFile(file.data, file.name); return; }
    setLightbox({ type: isPDF ? "pdf" : isVid ? "video" : "image", data: file.data, name: file.name, label });
  }

  const rowBg = isApproved ? G.success + "05" : isPartialReject ? G.danger + "05" : expanded ? G.accent + "05" : "transparent";

  return (
    <div style={{ borderBottom: !isLastInGroup ? `1px solid ${G.border}15` : "none" }}>
      {/* TABLE ROW — 4 columns (party shown in parent header) */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr", gap: 0, padding: "11px 16px", cursor: "pointer", background: rowBg, alignItems: "center", transition: "background 0.15s" }}
      >
        {/* Col 1: Invoice Number */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>{isApproved ? "✅" : isPartialReject ? "🔄" : "📋"}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: G.text }}>INV# {set.invNo}</div>
              {set.adminReview?.reviewedAt && (
                <div style={{ fontSize: 9, color: G.muted }}>Reviewed: {new Date(set.adminReview.reviewedAt).toLocaleDateString("en-IN")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Col 2: Submitted date */}
        <div>
          <div style={{ fontSize: 12, color: G.text }}>
            {set.submittedAt ? new Date(set.submittedAt).toLocaleDateString("en-IN") : "—"}
          </div>
          <div style={{ fontSize: 9, color: G.muted }}>
            {set.submittedAt ? new Date(set.submittedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}
          </div>
        </div>

        {/* Col 3: Docs count with icons */}
        <div>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {INV_SLOTS.map(sl => {
              const hasFile = !!set.files?.[sl.key];
              const isRej = set.adminReview?.slotRemarks?.[sl.key]?.action === "reject";
              return (
                <span key={sl.key} title={sl.label}
                  style={{ fontSize: 12, opacity: hasFile ? 1 : 0.25, filter: isRej ? "grayscale(1)" : "none" }}>
                  {sl.icon}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: 9, color: G.muted, marginTop: 2 }}>{completedDocs}/5 docs</div>
        </div>

        {/* Col 4: Status + expand toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <span style={S.tag(statusColor)}>{statusLabel}</span>
          <span style={{ fontSize: 10, color: G.muted, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "14px 16px", background: G.bg + "80", borderTop: `1px solid ${G.border}20` }}>

          {/* Resubmission mode: only show the resubmitted slot(s) */}
          {isAwaitingResubmitReview ? (
            <div style={{ marginBottom: 14 }}>
              {/* Approved slots — compact locked list */}
              <div style={{ marginBottom: 10, padding: "8px 12px", background: G.success + "08", border: `1px solid ${G.success}20`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: G.success, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Previously Approved</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {INV_SLOTS.filter(sl => !(set.adminReview?.rejectedSlots || []).includes(sl.key)).map(slot => (
                    <div key={slot.key} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, background: G.success + "15", border: `1px solid ${G.success}25` }}>
                      <span style={{ fontSize: 12 }}>{slot.icon}</span>
                      <span style={{ fontSize: 10, color: G.success, fontWeight: 600 }}>{slot.label}</span>
                      <span style={{ fontSize: 9, color: G.success }}>✓</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Only the resubmitted slot(s) */}
              {(set.adminReview?.rejectedSlots || []).map(slotKey => {
                const slot = INV_SLOTS.find(s => s.key === slotKey);
                const file = set.files?.[slotKey];
                const isExcel = file?.name?.match(/\.xlsx?$/i);
                return (
                  <div key={slotKey} style={{ padding: "10px 12px", borderRadius: 9, background: G.card, border: `2px solid ${G.accent}50`, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: file ? 8 : 0 }}>
                      <span style={{ fontSize: 16 }}>{slot?.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: G.accent, display: "flex", alignItems: "center", gap: 6 }}>
                          {slot?.label}
                          <span style={{ fontSize: 9, background: G.accent, color: "#fff", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>RESUBMITTED</span>
                        </div>
                        {file && <div style={{ fontSize: 10, color: G.muted, marginTop: 1 }}>{file.name}</div>}
                        {!file && <div style={{ fontSize: 10, color: G.danger, marginTop: 1 }}>Not yet uploaded</div>}
                      </div>
                      {file && (
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button onClick={() => openFile(file, `${set.invNo} — ${slot?.label}`)}
                            style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: G.accent + "20", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                            {isExcel ? "⬇" : "🔍 View"}
                          </button>
                          <button onClick={() => dlFile(file.data, file.name)}
                            style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: G.success + "20", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⬇</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Normal mode: show all 5 slots */
            <div style={{ marginBottom: 14, overflowX: "auto" }}>
              {INV_SLOTS.map(slot => {
                const file = set.files?.[slot.key];
                const slotReview = set.adminReview?.slotRemarks?.[slot.key];
                const wasRejected = slotReview?.action === "reject";
                const isExcel = file?.name?.match(/\.xlsx?$/i);
                return (
                  <div key={slot.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: G.card, border: `1px solid ${wasRejected ? G.danger + "40" : file ? G.success + "25" : G.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 15 }}>{slot.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: wasRejected ? G.danger : file ? G.text : G.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {slot.label}
                          {wasRejected && <span style={{ fontSize: 9, background: G.danger, color: "#fff", borderRadius: 3, padding: "1px 5px" }}>REJECTED</span>}
                          {!wasRejected && isReviewed && file && <span style={{ fontSize: 9, background: G.success, color: "#fff", borderRadius: 3, padding: "1px 5px" }}>OK</span>}
                        </div>
                        {file && <div style={{ fontSize: 10, color: G.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>}
                        {wasRejected && slotReview.reason && <div style={{ fontSize: 10, color: G.danger, marginTop: 2 }}>Reason: {slotReview.reason}</div>}
                        {!file && <div style={{ fontSize: 10, color: G.muted }}>Not uploaded</div>}
                      </div>
                    </div>
                    {file && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => openFile(file, `${set.invNo} — ${slot.label}`)}
                          style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: G.accent + "20", color: G.accent, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                          {isExcel ? "⬇" : "🔍"}
                        </button>
                        <button onClick={() => dlFile(file.data, file.name)}
                          style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: G.success + "20", color: G.success, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⬇</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(!isReviewed || isAwaitingResubmitReview) && (
            <div style={{ background: G.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${isAwaitingResubmitReview ? G.accent + "50" : G.border}` }}>
              <AdminInvReview set={set} clientId={clientId} refresh={refresh} />
            </div>
          )}

          {isReviewed && !isAwaitingResubmitReview && (
            <div style={{ background: isApproved ? G.success + "10" : G.danger + "10", borderRadius: 8, padding: "10px 14px", border: `1px solid ${isApproved ? G.success + "30" : G.danger + "30"}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: isApproved ? G.success : G.danger, marginBottom: 4 }}>
                {isApproved ? "Approved" : isPartialReject ? "Partial Rejection — client will re-upload specific docs" : "Rejected"}
              </div>
              {set.adminReview?.globalNote && <div style={{ fontSize: 11, color: G.text, marginBottom: 4 }}>Note: {set.adminReview.globalNote}</div>}
              {isPartialReject && (
                <div style={{ fontSize: 11, color: G.danger }}>
                  Rejected docs: {(set.adminReview.rejectedSlots || []).map(k => INV_SLOTS.find(s => s.key === k)?.label || k).join(", ")}
                </div>
              )}
              <div style={{ fontSize: 10, color: G.muted, marginTop: 4 }}>Reviewed: {new Date(set.adminReview.reviewedAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Theme ──
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("kyc_theme") || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    window.__kyc_theme = themeMode;
    window.dispatchEvent(new Event("kyc-theme-change"));
    try { localStorage.setItem("kyc_theme", themeMode); } catch {}
    document.body.style.background = THEMES[themeMode].bg;
    document.body.style.color = THEMES[themeMode].text;
  }, [themeMode]);
  function toggleTheme() { setThemeMode(m => m === "dark" ? "light" : "dark"); }
  const isDark = themeMode === "dark";
  const G0 = THEMES[themeMode];
  const S0 = mkS(G0);
  // Restore session from localStorage so refresh doesn't log out
  const [user, setUser] = useState(() => {
    try {
      const s = localStorage.getItem("kyc_session");
      if (!s) return null;
      const saved = JSON.parse(s);
      // Re-hydrate from DB (get latest data)
      if (saved.role === "admin") return saved;
      const fresh = DB.clients.find(c => c.id === saved.id);
      return fresh || saved;
    } catch { return null; }
  });
  const [screen, setScreen] = useState(() => {
    try {
      const s = localStorage.getItem("kyc_session");
      if (!s) return "auth";
      const saved = JSON.parse(s);
      return saved.role === "admin" ? "admin" : "client";
    } catch { return "auth"; }
  });

  function handleLogin(u) {
    setUser(u);
    const sc = u.role === "admin" ? "admin" : "client";
    setScreen(sc);
    try { localStorage.setItem("kyc_session", JSON.stringify(u)); } catch {}
  }

  function handleSignOut() {
    setUser(null); setScreen("auth");
    try { localStorage.removeItem("kyc_session"); } catch {}
  }
  return (
    <div style={{ ...S0.app, transition: "background 0.3s, color 0.3s" }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } body { overflow-x: hidden; } select option { background: ${G0.subtle}; color: ${G0.text}; } video { background: #000; } label { cursor: pointer; } img { max-width: 100%; } table { width: 100%; } @keyframes spin { to { transform: rotate(360deg); } } input, textarea, select { color-scheme: ${isDark ? "dark" : "light"}; -webkit-appearance: none; border-radius: 8px; } @media (max-width: 480px) { .hide-mobile { display: none !important; } }`}</style>
      <nav style={S0.nav}>
        <div style={S0.logo}><div style={S0.logoDot} />KYC Verify</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Dark/Light toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${G0.border}`, background: G0.subtle, color: G0.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >{isDark ? "☀️" : "🌙"}</button>
          {user && <>
            <span style={{ fontSize: 12, color: G0.muted }}>{user.role === "admin" ? "🔑 Admin" : `${user.firstName} ${user.lastName}`}</span>
            {user.role !== "admin" && screen === "client" && <button style={{ ...S0.btnSm, background: "transparent", color: G0.accent, border: `1px solid ${G0.accent}28`, fontSize: 11 }} onClick={() => setScreen("kyc")}>KYC Form</button>}
            <button style={{ ...S0.btnSm, background: G0.danger + "18", color: G0.danger, fontSize: 11 }} onClick={handleSignOut}>Sign out</button>
          </>}
        </div>
      </nav>
      {screen === "auth" && <AuthScreen onLogin={handleLogin} />}
      {screen === "kyc" && user && <KYCForm client={user} onSubmit={u => { setUser(u); setScreen("client"); }} />}
      {screen === "client" && user?.role !== "admin" && <ClientDashboard client={user} onKYCStart={() => setScreen("kyc")} onUserUpdate={u => { setUser(u); try { localStorage.setItem("kyc_session", JSON.stringify(u)); } catch {} }} />}
      {screen === "admin" && <AdminDashboard />}
    </div>
  );
}
