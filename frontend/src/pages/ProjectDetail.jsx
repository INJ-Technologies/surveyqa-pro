import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import api from "../api";
import {
  Select,
  Input,
  Textarea,
  NumberInput,
  DateInput,
  FormGrid,
  FullCol,
  SectionHeader,
} from "../components/FormElements";
import { useCountries } from "../hooks/useCountries";
import {
  ArrowLeft,
  Users,
  Activity,
  Clock,
  Edit2,
  Trash2,
  Plus,
  X,
  AlertCircle,
  CheckCircle,
  Save,
  Eye,
  DollarSign,
  RefreshCw,
  Target,
  Zap,
  TrendingDown,
  StopCircle,
  ChevronRight,
  FileText,
  Download,
  Camera,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  Hash,
  ChevronDown,
  Pencil,
  Copy,
} from "lucide-react";

const FONT =
  "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const API_BASE = import.meta.env.VITE_API_URL || "/api";

const formatLabel = (str) => {
  if (!str) return "—";
  const overrides = {
    surveymonkey: "Survey Monkey",
    brightdata: "Bright Data",
    iproyal: "IPRoyal",
    decodo: "Decodo",
  };
  if (overrides[str]) return overrides[str];
  return str
    .split("_")
    .map((w) =>
      w.toUpperCase() === "AI" ? "AI" : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
};

const fmtDuration = (secs) => {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};
const fmtDate = (dt) => {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
const fmtTime = (dt) => {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const fmtTimeShort = (dt) => {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};
const toOptions = (arr) =>
  arr.map((v) => ({ value: v, label: formatLabel(v) }));

const PLATFORMS = [
  "decipher",
  "qualtrics",
  "confirmit",
  "alchemer",
  "surveymonkey",
  "custom",
  "unknown",
];
const AI_MODES = ["ai", "human", "predefined"];
const STRATEGIES = ["persona_true", "quota_guided", "stress_test"];
const PROVIDERS = ["decodo", "brightdata", "oxylabs", "iproyal", "custom"];

const STATUS_COLORS = {
  draft: { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" },
  review: { bg: "#fef3c7", text: "#92400e", border: "#fde68a" },
  active: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  paused: { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  completed: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  archived: { bg: "#f1f5f9", text: "#94a3b8", border: "#e2e8f0" },
};

const SESSION_STATUS_COLORS = {
  queued: { bg: "#f1f5f9", text: "#64748b" },
  initialising: { bg: "#fef3c7", text: "#92400e" },
  in_progress: { bg: "#dbeafe", text: "#1e40af" },
  completed: { bg: "#dcfce7", text: "#166534" },
  terminated: { bg: "#fce7f3", text: "#9d174d" },
  over_quota: { bg: "#fef3c7", text: "#92400e" },
  error: { bg: "#fef2f2", text: "#dc2626" },
  flagged: { bg: "#fff7ed", text: "#c2410c" },
};

const STATUS_TRANSITIONS = {
  draft: [
    { value: "review", label: "Submit for Review" },
    { value: "active", label: "Launch Now" },
  ],
  review: [
    { value: "active", label: "Approve & Launch" },
    { value: "draft", label: "Send Back" },
  ],
  active: [
    { value: "paused", label: "Pause" },
    { value: "completed", label: "Mark Completed" },
  ],
  paused: [
    { value: "active", label: "Resume" },
    { value: "archived", label: "Archive" },
  ],
  completed: [{ value: "archived", label: "Archive" }],
  archived: [],
};

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, colors = STATUS_COLORS, large }) {
  const c = colors[status] ||
    colors.draft || { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" };
  return (
    <span
      style={{
        background: c.bg,
        color: c.text,
        border: c.border ? `1.5px solid ${c.border}` : "none",
        borderRadius: 20,
        padding: large ? "6px 16px" : "3px 10px",
        fontSize: large ? "0.85rem" : "0.72rem",
        fontWeight: 600,
        fontFamily: FONT,
        whiteSpace: "nowrap",
      }}
    >
      {formatLabel(status)}
    </span>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, []);
  const isErr = type === "error";
  return (
    <div
      style={{
        position: "fixed",
        bottom: 28,
        right: 28,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: isErr ? "#fef2f2" : "#f0fdf4",
        border: `1.5px solid ${isErr ? "#fca5a5" : "#86efac"}`,
        borderRadius: 10,
        padding: "12px 18px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        fontFamily: FONT,
        fontSize: "0.88rem",
        color: isErr ? "#dc2626" : "#166634",
        fontWeight: 500,
      }}
    >
      {isErr ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
      {message}
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          marginLeft: 8,
          padding: 0,
          display: "flex",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmColor,
  icon: Icon = Trash2,
  onConfirm,
  onCancel,
  loading,
}) {
  return (
    <div style={s.overlay}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 32,
          maxWidth: 440,
          width: "100%",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: confirmColor + "18",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon size={24} color={confirmColor} />
        </div>
        <h3
          style={{
            textAlign: "center",
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#1e293b",
            fontFamily: FONT,
            marginBottom: 8,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            textAlign: "center",
            fontSize: "0.88rem",
            color: "#64748b",
            fontFamily: FONT,
            lineHeight: 1.6,
            marginBottom: 24,
          }}
          dangerouslySetInnerHTML={{ __html: message }}
        />
        <div style={{ display: "flex", gap: 12 }}>
          <button style={s.cancelBtnFull} onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            style={{
              flex: 1,
              background: confirmColor,
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
              opacity: loading ? 0.7 : 1,
            }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Run Sessions Modal ───────────────────────────────────────────────────────
function RunSessionsModal({ project, surveys = [], onClose, onTriggered }) {
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allCountries, setAllCountries] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef(null);
  // ── Scenarios ──
  const [allScenarios, setAllScenarios] = useState([]);
  const [selectedScenarios, setSelectedScenarios] = useState([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [testingMode, setTestingMode] = useState("internal"); // 'internal' | 'live'
  const [aiProviders, setAiProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('');

  useEffect(() => {
    api.get('/ai-providers')
      .then(res => {
        const list = res.data.providers || [];
        setAiProviders(list);
        const def = list.find(p => p.is_default && p.is_active);
        if (def) setSelectedProvider(def.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get("/proxy/countries")
      .then((res) => {
        const all = res.data.countries || [];
        const surveyCodes = new Set();
        surveys.forEach((sv) => {
          const codes = Array.isArray(sv.countries)
            ? sv.countries
            : (sv.countries || "")
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean);
          codes.forEach((c) => surveyCodes.add(c.toUpperCase()));
        });
        const filtered =
          surveyCodes.size > 0
            ? all.filter((c) => surveyCodes.has(c.code.toUpperCase()))
            : all;
        setAllCountries(filtered);
        setSelected(
          filtered.map((c) => ({ code: c.code, country: c.country })),
        );
      })
      .catch(() => setAllCountries([]));
  }, [surveys]);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target))
        setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const countries = allCountries;
  const filtered = countries.filter(
    (c) =>
      c.country.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase()),
  );
  const toggleCountry = (c) =>
    setSelected((prev) => {
      const exists = prev.find((s) => s.code === c.code);
      if (exists) return prev.filter((s) => s.code !== c.code);
      return [...prev, { code: c.code, country: c.country }];
    });
  const removeCountry = (code) =>
    setSelected((prev) => prev.filter((s) => s.code !== code));
  const getDistribution = () => {
    if (selected.length === 0) return [];
    const n = parseInt(count) || 1;
    return Array.from({ length: n }, (_, i) => selected[i % selected.length]);
  };

  useEffect(() => {
    api
      .get(`/scenarios/project/${project.id}`)
      .then((res) => {
        // Exclude Country Logic — it runs globally on every session automatically
        const active = (res.data.scenarios || []).filter(
          (s) => s.project_active && s.name !== "Country Logic",
        );
        setAllScenarios(active);
        setSelectedScenarios(active.map((s) => s.id)); // default: all active selected
      })
      .catch(() => {})
      .finally(() => setScenariosLoading(false));
  }, [project.id]);

  const handleRun = async () => {
    setError("");
    setLoading(true);
    try {
      const countryCodes = selected.map((s) => s.code);
      await api.post("/sessions/trigger", {
        projectId: project.id,
        count: parseInt(count),
        proxyCountry: countryCodes.length > 0 ? countryCodes : null,
        scenarioIds: selectedScenarios,
        internalTesting: testingMode === "internal",
        aiProviderId: selectedProvider || null,
      });
      onTriggered();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to trigger sessions");
    } finally {
      setLoading(false);
    }
  };

  const distribution = getDistribution();
  const n = parseInt(count) || 1;

  return (
    <div style={s.overlay}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 28,
          maxWidth: 520,
          width: "100%",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              fontFamily: FONT,
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "#1e293b",
              margin: 0,
            }}
          >
            Run Bot Sessions
          </h3>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
            }}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {/* Testing Mode Toggle */}
        <div
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
            border: "1.5px solid #e2e8f0",
            borderRadius: 10,
            padding: "12px 16px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#1e293b",
                fontFamily: FONT,
              }}
            >
              {testingMode === "internal"
                ? "🧪 Internal Testing"
                : "🌐 Live Testing"}
            </div>
            <div
              style={{
                fontSize: "0.72rem",
                color: "#94a3b8",
                fontFamily: FONT,
                marginTop: 2,
              }}
            >
              {testingMode === "internal"
                ? "Sessions run on your local IP — no proxy used"
                : "Sessions run via proxy with country-specific IPs"}
            </div>
          </div>
          <div
            onClick={() =>
              setTestingMode((m) => (m === "live" ? "internal" : "live"))
            }
            style={{
              width: 52,
              height: 28,
              borderRadius: 14,
              cursor: "pointer",
              position: "relative",
              background: testingMode === "live" ? "#2563eb" : "#e2e8f0",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 3,
                left: testingMode === "live" ? 27 : 3,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "white",
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                transition: "left 0.2s",
              }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              fontFamily: FONT,
              display: "block",
              marginBottom: 6,
            }}
          >
            Number of Sessions
          </label>
          <input
            type="number"
            min="1"
            max="20"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 8,
              fontSize: "0.88rem",
              fontFamily: FONT,
              outline: "none",
              boxSizing: "border-box",
            }}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <div
            style={{
              fontSize: "0.72rem",
              color: "#94a3b8",
              fontFamily: FONT,
              marginTop: 4,
            }}
          >
            Max 20 per trigger. Concurrent limit: {project.concurrent_sessions}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              fontFamily: FONT,
              display: "block",
              marginBottom: 6,
            }}
          >
            Target Countries{" "}
            <span style={{ color: "#94a3b8", fontWeight: 400 }}>
              (optional — distributed round-robin)
            </span>
          </label>
          {selected.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {selected.map((s) => (
                <span
                  key={s.code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "#dbeafe",
                    color: "#1e3a5f",
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    fontFamily: FONT,
                  }}
                >
                  {s.code} — {s.country}
                  <button
                    onClick={() => removeCountry(s.code)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#2563eb",
                      padding: 0,
                      display: "flex",
                      lineHeight: 1,
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setSelected([])}
                style={{
                  background: "none",
                  border: "1px solid #e2e8f0",
                  borderRadius: 20,
                  padding: "3px 10px",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                Clear all
              </button>
            </div>
          )}
          <div ref={dropRef} style={{ position: "relative" }}>
            <div
              onClick={() => setDropOpen((o) => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                cursor: "pointer",
                background: "white",
                fontSize: "0.85rem",
                fontFamily: FONT,
                color: selected.length > 0 ? "#1e293b" : "#94a3b8",
              }}
            >
              <Globe size={14} color="#94a3b8" />
              <span style={{ flex: 1 }}>
                {selected.length > 0
                  ? `${selected.length} countr${selected.length === 1 ? "y" : "ies"} selected`
                  : "Search and select countries..."}
              </span>
              <ChevronDown
                size={14}
                color="#94a3b8"
                style={{
                  transform: dropOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </div>
            {dropOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  background: "white",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  marginTop: 4,
                  maxHeight: 240,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <input
                    autoFocus
                    placeholder="Search country or code..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 6,
                      fontSize: "0.82rem",
                      fontFamily: FONT,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ overflowY: "auto", flex: 1 }}>
                  {filtered.length === 0 ? (
                    <div
                      style={{
                        padding: "12px 14px",
                        fontSize: "0.82rem",
                        color: "#94a3b8",
                        fontFamily: FONT,
                      }}
                    >
                      No countries found
                    </div>
                  ) : (
                    filtered.map((c) => {
                      const isSelected = selected.some(
                        (s) => s.code === c.code,
                      );
                      return (
                        <div
                          key={c.code}
                          onClick={() => toggleCountry(c)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 12px",
                            cursor: "pointer",
                            background: isSelected ? "#f0f7ff" : "white",
                            borderBottom: "1px solid #f8fafc",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected)
                              e.currentTarget.style.background = "#f8fafc";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isSelected
                              ? "#f0f7ff"
                              : "white";
                          }}
                        >
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              border: `2px solid ${isSelected ? "#2563eb" : "#cbd5e1"}`,
                              background: isSelected ? "#2563eb" : "white",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {isSelected && (
                              <CheckCircle size={10} color="white" />
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              color: "#64748b",
                              fontFamily: "monospace",
                              minWidth: 26,
                            }}
                          >
                            {c.code}
                          </span>
                          <span
                            style={{
                              fontSize: "0.83rem",
                              color: "#1e293b",
                              fontFamily: FONT,
                              flex: 1,
                            }}
                          >
                            {c.country}
                          </span>
                          <span
                            style={{
                              fontSize: "0.7rem",
                              color: "#94a3b8",
                              fontFamily: "monospace",
                            }}
                          >
                            {c.endpoint === "gate.decodo.com"
                              ? `gate:${c.port}`
                              : c.endpoint?.split(".")[0]}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {selected.length > 0 && n > 0 && (
          <div
            style={{
              background: "#f8fafc",
              border: "1.5px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#94a3b8",
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Session Distribution Preview
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {distribution.map((c, i) => (
                <span
                  key={i}
                  style={{
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: "0.75rem",
                    fontFamily: FONT,
                    color: "#475569",
                  }}
                >
                  <span style={{ color: "#94a3b8" }}>#{i + 1}</span> {c.code}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scenario selector */}
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              fontFamily: FONT,
              display: "block",
              marginBottom: 6,
            }}
          >
            Scenarios{" "}
            <span style={{ color: "#94a3b8", fontWeight: 400 }}>
              (select which to include — round-robin)
            </span>
          </label>
          {scenariosLoading ? (
            <div
              style={{
                fontSize: "0.82rem",
                color: "#94a3b8",
                fontFamily: FONT,
                padding: "8px 0",
              }}
            >
              Loading scenarios...
            </div>
          ) : allScenarios.length === 0 ? (
            <div
              style={{
                fontSize: "0.82rem",
                color: "#94a3b8",
                fontFamily: FONT,
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              No active scenarios — sessions will use default random answering.
            </div>
          ) : (
            <div
              style={{
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {allScenarios.map((sc, i) => {
                const isSel = selectedScenarios.includes(sc.id);
                const oc =
                  OUTCOME_COLORS[sc.expected_outcome] || OUTCOME_COLORS.any;
                return (
                  <div
                    key={sc.id}
                    onClick={() =>
                      setSelectedScenarios((prev) =>
                        isSel
                          ? prev.filter((id) => id !== sc.id)
                          : [...prev, sc.id],
                      )
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      borderBottom:
                        i < allScenarios.length - 1
                          ? "1px solid #f1f5f9"
                          : "none",
                      cursor: "pointer",
                      background: isSel ? "#f0f7ff" : "white",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSel
                        ? "#f0f7ff"
                        : "white";
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        flexShrink: 0,
                        border: `2px solid ${isSel ? "#2563eb" : "#cbd5e1"}`,
                        background: isSel ? "#2563eb" : "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isSel && <CheckCircle size={10} color="white" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          color: "#1e293b",
                          fontFamily: FONT,
                        }}
                      >
                        {sc.name}
                      </div>
                      {sc.description && (
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "#94a3b8",
                            fontFamily: FONT,
                            marginTop: 1,
                          }}
                        >
                          {sc.description.slice(0, 60)}
                          {sc.description.length > 60 ? "…" : ""}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        background: oc.bg,
                        color: oc.text,
                        borderRadius: 4,
                        padding: "2px 7px",
                        whiteSpace: "nowrap",
                        fontFamily: FONT,
                      }}
                    >
                      {sc.step_count || 0} steps
                    </span>
                  </div>
                );
              })}
              <div
                style={{
                  padding: "8px 14px",
                  borderTop: "1px solid #f1f5f9",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "#94a3b8",
                    fontFamily: FONT,
                  }}
                >
                  {selectedScenarios.length} of {allScenarios.length} selected
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() =>
                      setSelectedScenarios(allScenarios.map((s) => s.id))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.72rem",
                      color: "#2563eb",
                      fontFamily: FONT,
                      fontWeight: 600,
                    }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedScenarios([])}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      fontFamily: FONT,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI Provider selector */}
        {aiProviders.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 6 }}>
              AI Provider
            </label>
            <select
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.88rem', fontFamily: FONT, outline: 'none', background: 'white' }}
              value={selectedProvider}
              onChange={e => setSelectedProvider(e.target.value)}
            >
              <option value="">Use default provider</option>
              {aiProviders.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.model} {p.is_default ? '(default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          style={{
            background: "#f0f7ff",
            border: "1.5px solid #dbeafe",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 18,
            fontSize: "0.82rem",
            color: "#1e3a5f",
            fontFamily: FONT,
            lineHeight: 1.7,
          }}
        >
          <strong>Survey:</strong> {formatLabel(project.survey_platform)} —{" "}
          {project.name}
          <br />
          <strong>Proxy:</strong> Decodo — country-specific endpoints
          <br />
          <strong>Strategy:</strong> {formatLabel(project.ai_strategy)}
        </div>

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#dc2626",
              fontSize: "0.85rem",
              marginBottom: 14,
              fontFamily: FONT,
            }}
          >
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button style={s.cancelBtnFull} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{
              flex: 1,
              background: "#059669",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: loading ? 0.7 : 1,
            }}
            onClick={handleRun}
            disabled={loading}
          >
            <Zap size={16} />{" "}
            {loading
              ? "Queuing..."
              : `Run ${count} Session${parseInt(count) !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const WHEN_TYPES = [
  { value: "question_contains", label: "Question text contains" },
  { value: "question_position", label: "Question position is" },
  { value: "page_number", label: "Page number is" },
  { value: "page_has_timer", label: "Page has timer" },
  { value: "always", label: "Always (every page)" },
];

const ACTIONS = [
  { value: "select_exact", label: "Select exact option(s)" },
  { value: "select_one_of", label: "Select one of option(s)" },
  { value: "select_not_in", label: "Avoid option(s), pick anything else" },
  { value: "select_random", label: "Select randomly (pick any N options)" },
  { value: "numeric_fill", label: "Fill numeric / allocation field" },
  { value: "open_end", label: "Answer open-end field" },
  { value: "wait", label: "Wait N seconds then next" },
  { value: "skip", label: "Skip (click next without answering)" },
  { value: "back", label: "Click back" },
];

const OPEN_END_MODES = [
  { value: "persona_ai", label: "Persona AI (Claude)" },
  { value: "predefined", label: "Use predefined response pool" },
  { value: "specific", label: "Type specific text" },
];

const OUTCOME_OPTS = [
  { value: "any", label: "Any outcome" },
  { value: "completed", label: "Expected: Complete" },
  { value: "terminated", label: "Expected: Terminate" },
  { value: "over_quota", label: "Expected: Over Quota" },
];

const OUTCOME_COLORS = {
  completed: { bg: "#dcfce7", text: "#166534" },
  terminated: { bg: "#fce7f3", text: "#9d174d" },
  over_quota: { bg: "#fef3c7", text: "#92400e" },
  any: { bg: "#f1f5f9", text: "#64748b" },
};

const scenLabel = {
  fontSize: "0.76rem",
  fontWeight: 600,
  color: "#374151",
  fontFamily: FONT,
  display: "block",
  marginBottom: 5,
};
const scenInput = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  fontSize: "0.85rem",
  fontFamily: FONT,
  color: "#1e293b",
  outline: "none",
  boxSizing: "border-box",
  background: "white",
};
const scenBtn = (bg, color) => ({
  background: bg,
  border: `1px solid ${color}22`,
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  color,
  fontFamily: FONT,
  fontSize: "0.8rem",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 4,
});

// ─── Step Builder ─────────────────────────────────────────────────────────────
function StepBuilder({
  step,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) {
  const setF = (k, v) => onChange(index, { ...step, [k]: v });
  const needsWhenValue = !["page_has_timer", "always"].includes(step.when_type);
  const needsActionValues = [
    "select_exact",
    "select_one_of",
    "select_not_in",
  ].includes(step.action);
  const needsMaxSelections = step.action === "select_random";
  const needsNumericFill = step.action === "numeric_fill";
  const needsOpenEndMode = step.action === "open_end";
  const needsDuration = step.action === "wait";

  const addActionValue = () =>
    setF("action_values", [...(step.action_values || []), ""]);
  const setActionValue = (i, v) => {
    const vals = [...(step.action_values || [])];
    vals[i] = v;
    setF("action_values", vals);
  };
  const removeActionValue = (i) =>
    setF(
      "action_values",
      (step.action_values || []).filter((_, idx) => idx !== i),
    );

  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid #e2e8f0",
        borderRadius: 12,
        padding: 18,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 700,
            color: "#1e3a5f",
            fontFamily: FONT,
            background: "#f0f7ff",
            border: "1px solid #dbeafe",
            borderRadius: 6,
            padding: "3px 10px",
          }}
        >
          Step {index + 1}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => onMoveUp(index)}
            disabled={isFirst}
            style={{
              ...scenBtn("#f8fafc", "#94a3b8"),
              opacity: isFirst ? 0.3 : 1,
            }}
          >
            ↑
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={isLast}
            style={{
              ...scenBtn("#f8fafc", "#94a3b8"),
              opacity: isLast ? 0.3 : 1,
            }}
          >
            ↓
          </button>
          <button
            onClick={() => onRemove(index)}
            style={scenBtn("#fef2f2", "#ef4444")}
          >
            ✕
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={scenLabel}>WHEN</label>
          <select
            style={scenInput}
            value={step.when_type}
            onChange={(e) => setF("when_type", e.target.value)}
          >
            {WHEN_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {needsWhenValue && (
          <div>
            <label style={scenLabel}>
              {step.when_type === "question_contains"
                ? "Question contains text"
                : step.when_type === "question_position"
                  ? "Question number (e.g. 3)"
                  : "Page number (e.g. 2)"}
            </label>
            <input
              style={scenInput}
              value={step.when_value || ""}
              placeholder={
                step.when_type === "question_contains"
                  ? "e.g. age group"
                  : "e.g. 2"
              }
              onChange={(e) => setF("when_value", e.target.value)}
            />
          </div>
        )}
        <div>
          <label style={scenLabel}>THEN</label>
          <select
            style={scenInput}
            value={step.action}
            onChange={(e) => setF("action", e.target.value)}
          >
            {ACTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {needsActionValues && (
          <div>
            <label style={scenLabel}>
              {step.action === "select_exact"
                ? "Option number(s) to select"
                : step.action === "select_one_of"
                  ? "Pick one of these option numbers"
                  : "Avoid these option numbers"}
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
              }}
            >
              {(step.action_values || []).map((v, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <input
                    type="number"
                    min="1"
                    value={v}
                    style={{ ...scenInput, width: 60, padding: "6px 8px" }}
                    onChange={(e) => setActionValue(i, e.target.value)}
                  />
                  <button
                    onClick={() => removeActionValue(i)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#ef4444",
                      fontSize: "1rem",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={addActionValue}
                style={{
                  ...scenBtn("#f0f7ff", "#2563eb"),
                  fontSize: "0.75rem",
                  padding: "4px 10px",
                }}
              >
                + Add
              </button>
            </div>
            <div
              style={{
                fontSize: "0.7rem",
                color: "#94a3b8",
                fontFamily: FONT,
                marginTop: 4,
              }}
            >
              Enter option position numbers (1 = first option, 2 = second, etc.)
            </div>
          </div>
        )}
        {needsOpenEndMode && (
          <>
            <div>
              <label style={scenLabel}>Open-End Mode</label>
              <select
                style={scenInput}
                value={step.action_mode || "persona_ai"}
                onChange={(e) => setF("action_mode", e.target.value)}
              >
                {OPEN_END_MODES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {step.action_mode === "specific" && (
              <div>
                <label style={scenLabel}>Specific Text to Type</label>
                <input
                  style={scenInput}
                  value={step.action_text || ""}
                  placeholder="Type the exact response..."
                  onChange={(e) => setF("action_text", e.target.value)}
                />
              </div>
            )}
          </>
        )}
        {needsDuration && (
          <div>
            <label style={scenLabel}>Wait Duration (seconds)</label>
            <input
              type="number"
              min="1"
              style={scenInput}
              value={step.duration_s || ""}
              placeholder="e.g. 65"
              onChange={(e) =>
                setF("duration_s", parseInt(e.target.value) || null)
              }
            />
          </div>
        )}

        {needsMaxSelections && (
          <div>
            <label style={scenLabel}>Max Selections</label>
            <input
              type="number"
              min="1"
              style={scenInput}
              value={step.action_values?.[0] || ""}
              placeholder="e.g. 2 (leave blank for exactly 1)"
              onChange={(e) =>
                setF(
                  "action_values",
                  e.target.value ? [parseInt(e.target.value)] : [],
                )
              }
            />
            <div
              style={{
                fontSize: "0.7rem",
                color: "#94a3b8",
                fontFamily: FONT,
                marginTop: 4,
              }}
            >
              Bot will randomly pick up to this many options. Leave blank to
              pick exactly 1.
            </div>
          </div>
        )}

        {needsNumericFill && (
          <>
            <div>
              <label style={scenLabel}>Min Value</label>
              <input
                type="number"
                style={scenInput}
                value={step.action_values?.[0] ?? ""}
                placeholder="e.g. 0"
                onChange={(e) => {
                  const vals = [...(step.action_values || [null, null])];
                  vals[0] =
                    e.target.value === "" ? null : parseFloat(e.target.value);
                  setF("action_values", vals);
                }}
              />
            </div>
            <div>
              <label style={scenLabel}>Max Value</label>
              <input
                type="number"
                style={scenInput}
                value={step.action_values?.[1] ?? ""}
                placeholder="e.g. 100"
                onChange={(e) => {
                  const vals = [...(step.action_values || [null, null])];
                  vals[1] =
                    e.target.value === "" ? null : parseFloat(e.target.value);
                  setF("action_values", vals);
                }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={scenLabel}>Round to multiple of</label>
              <input
                style={scenInput}
                value={step.action_text || ""}
                placeholder="e.g. 5 — means values like 0, 5, 10, 15... (leave blank for any integer)"
                onChange={(e) => setF("action_text", e.target.value)}
              />
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                  marginTop: 4,
                }}
              >
                For allocation questions (must sum to 100%), set Min: 0, Max:
                100, Round: 5 or 10.
              </div>
            </div>
          </>
        )}
      </div>
      {/* Optional page wait — applies after any action */}
      <div
        style={{
          gridColumn: "1 / -1",
          borderTop: "1px solid #f1f5f9",
          paddingTop: 12,
          marginTop: 4,
        }}
      >
        <label style={{ ...scenLabel, color: "#64748b" }}>
          Wait after answering{" "}
          <span style={{ fontWeight: 400, color: "#94a3b8" }}>
            (optional — simulates reading time)
          </span>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: "0.78rem",
                color: "#94a3b8",
                fontFamily: FONT,
              }}
            >
              Min
            </span>
            <input
              type="number"
              min="0"
              style={{ ...scenInput, width: 70, padding: "6px 8px" }}
              value={step.wait_min_s ?? ""}
              placeholder="e.g. 5"
              onChange={(e) =>
                setF(
                  "wait_min_s",
                  e.target.value === "" ? null : parseInt(e.target.value),
                )
              }
            />
          </div>
          <span
            style={{ fontSize: "0.78rem", color: "#94a3b8", fontFamily: FONT }}
          >
            —
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: "0.78rem",
                color: "#94a3b8",
                fontFamily: FONT,
              }}
            >
              Max
            </span>
            <input
              type="number"
              min="0"
              style={{ ...scenInput, width: 70, padding: "6px 8px" }}
              value={step.wait_max_s ?? ""}
              placeholder="e.g. 15"
              onChange={(e) =>
                setF(
                  "wait_max_s",
                  e.target.value === "" ? null : parseInt(e.target.value),
                )
              }
            />
          </div>
          <span
            style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT }}
          >
            seconds
          </span>
          {(step.wait_min_s || step.wait_max_s) && (
            <span
              style={{
                fontSize: "0.72rem",
                color: "#2563eb",
                fontFamily: FONT,
                background: "#f0f7ff",
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              Will wait {step.wait_min_s || 0}–
              {step.wait_max_s || step.wait_min_s || 0}s after answering
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: "#94a3b8",
            fontFamily: FONT,
            marginTop: 4,
          }}
        >
          Bot waits a random duration in this range after answering — useful for
          pages with timers.
        </div>
      </div>
    </div>
  );
}

// ─── Scenario Edit Modal ──────────────────────────────────────────────────────
function ScenarioModal({ scenario, projectId, onClose, onSaved, showToast }) {
  const isEdit = !!scenario?.id;
  const [name, setName] = useState(scenario?.name || "");
  const [description, setDescription] = useState(scenario?.description || "");
  const [expectedOutcome, setExpectedOutcome] = useState(
    scenario?.expected_outcome || "any",
  );
  const [steps, setSteps] = useState(scenario?.steps || []);
  const [saving, setSaving] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(isEdit);

  const isCountryLogic = scenario?.name === "Country Logic";
  const [countryMapping, setCountryMapping] = useState(
    scenario?.country_mapping || null,
  );
  const [cmQuestionContains, setCmQuestionContains] = useState(scenario?.country_mapping?.questionContains || '');
  const [cmMappings, setCmMappings] = useState(scenario?.country_mapping?.mappings || []);
  const [cmOptions, setCmOptions] = useState([]);
  const [cmWaitMin, setCmWaitMin] = useState(scenario?.country_mapping?.waitMinS ?? null);
  const [cmWaitMax, setCmWaitMax] = useState(scenario?.country_mapping?.waitMaxS ?? null);

  // Load full country_mapping when editing Country Logic
  useEffect(() => {
    if (!isEdit || !scenario?.id || !isCountryLogic) return;
    api
      .get(`/scenarios/${scenario.id}`)
      .then((res) => {
        const cm = res.data.scenario?.country_mapping;
        if (cm) {
          setCmQuestionContains(cm.questionContains || "");
          setCmMappings(cm.mappings || []);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch full scenario (with steps) when editing
  useEffect(() => {
    if (!isEdit || !scenario?.id) return;
    api
      .get(`/scenarios/${scenario.id}`)
      .then((res) => setSteps(res.data.scenario?.steps || []))
      .catch(() => {})
      .finally(() => setLoadingSteps(false));
  }, []);

  const blankStep = () => ({
    when_type: "question_contains",
    when_value: "",
    conditions: [],
    action: "select_exact",
    action_values: [],
    action_mode: "persona_ai",
    action_text: null,
    duration_s: null,
    wait_min_s: null,
    wait_max_s: null,
  });
  const addStep = () => setSteps((s) => [...s, blankStep()]);
  const removeStep = (i) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const updateStep = (i, updated) =>
    setSteps((s) => s.map((step, idx) => (idx === i ? updated : step)));
  const moveUp = (i) => {
    if (i === 0) return;
    const s = [...steps];
    [s[i - 1], s[i]] = [s[i], s[i - 1]];
    setSteps(s);
  };
  const moveDown = (i) => {
    if (i === steps.length - 1) return;
    const s = [...steps];
    [s[i], s[i + 1]] = [s[i + 1], s[i]];
    setSteps(s);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("Scenario name is required", "error");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/scenarios/${scenario.id}`, {
          name,
          description,
          expectedOutcome,
          steps,
          ...(isCountryLogic
            ? {
                countryMapping: {
                  questionContains: cmQuestionContains,
                  mappings: cmMappings,
                  waitMinS: cmWaitMin,
                  waitMaxS: cmWaitMax,
                },
              }
            : {}),
        });
      } else {
        await api.post("/scenarios", {
          projectId,
          name,
          description,
          expectedOutcome,
          steps,
        });
      }
      showToast(`Scenario ${isEdit ? "updated" : "created"} ✓`);
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to save scenario",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const oc = OUTCOME_COLORS[expectedOutcome] || OUTCOME_COLORS.any;

  return (
    <div style={s.overlay}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          width: "100%",
          maxWidth: 760,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "22px 28px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: FONT,
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "#1e293b",
                margin: "0 0 4px",
              }}
            >
              {isEdit ? "Edit Scenario" : "New Scenario"}
            </h2>
            <p
              style={{
                fontFamily: FONT,
                fontSize: "0.82rem",
                color: "#64748b",
                margin: 0,
              }}
            >
              Define conditions the bot should follow during survey sessions.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div>
              <label style={scenLabel}>Scenario Name *</label>
              <input
                style={scenInput}
                value={name}
                placeholder="e.g. Qualifying Male 35-44 UK"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label style={scenLabel}>Expected Outcome</label>
              <select
                style={{
                  ...scenInput,
                  background: oc.bg,
                  color: oc.text,
                  fontWeight: 600,
                }}
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
              >
                {OUTCOME_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={scenLabel}>Description (optional)</label>
              <input
                style={scenInput}
                value={description}
                placeholder="Describe what this scenario is testing..."
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  color: "#1e293b",
                }}
              >
                Steps ({steps.length})
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  marginTop: 2,
                }}
              >
                Bot checks steps in order — first match wins. Unmatched pages
                follow default behaviour.
              </div>
            </div>
            <button
              onClick={addStep}
              style={{ ...scenBtn("#f0f7ff", "#1e3a5f"), padding: "7px 14px" }}
            >
              <Plus size={14} /> Add Step
            </button>
          </div>
          {/* Country Logic mapping section */}
          {isCountryLogic && (
            <div
              style={{
                marginBottom: 24,
                background: "#f0f7ff",
                border: "1.5px solid #dbeafe",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  color: "#1e3a5f",
                  marginBottom: 4,
                }}
              >
                Country Answer Mapping
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: "0.75rem",
                  color: "#64748b",
                  marginBottom: 14,
                }}
              >
                Maps each project country to the correct answer on the country
                question.
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={scenLabel}>Question contains text</label>
                <input
                  style={scenInput}
                  value={cmQuestionContains}
                  onChange={(e) => setCmQuestionContains(e.target.value)}
                  placeholder="e.g. country of residence"
                />
              </div>
              <label style={scenLabel}>Country → Answer</label>
              <div
                style={{
                  border: "1.5px solid #dbeafe",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    background: "#dbeafe",
                  }}
                >
                  <div
                    style={{
                      padding: "7px 12px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#1e3a5f",
                      fontFamily: FONT,
                    }}
                  >
                    COUNTRY
                  </div>
                  <div
                    style={{
                      padding: "7px 12px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#1e3a5f",
                      fontFamily: FONT,
                    }}
                  >
                    ANSWER TEXT
                  </div>
                </div>
                {cmMappings.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 1fr",
                      borderTop: "1px solid #dbeafe",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 12px",
                        fontFamily: "monospace",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "#1e3a5f",
                        background: "#eff6ff",
                      }}
                    >
                      {m.country}
                    </div>
                    <div style={{ padding: "6px 10px" }}>
                      <input
                        style={{ ...scenInput, margin: 0 }}
                        value={m.answer}
                        onChange={(e) =>
                          setCmMappings((prev) =>
                            prev.map((r, ri) =>
                              ri === i ? { ...r, answer: e.target.value } : r,
                            ),
                          )
                        }
                        placeholder="Exact option text from survey"
                      />
                    </div>
                  </div>
                ))}
                {cmMappings.length === 0 && (
                <div style={{ padding: "12px 14px", fontFamily: FONT, fontSize: "0.82rem", color: "#94a3b8" }}>No country mappings found.</div>
              )}
            </div>

            {/* Wait time after answering country question */}
            <div style={{ marginTop: 18, borderTop: "1px solid #dbeafe", paddingTop: 16 }}>
              <label style={{ ...scenLabel, color: "#64748b" }}>
                Wait after answering{" "}
                <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional — simulates reading time)</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontFamily: FONT }}>Min</span>
                  <input
                    type="number"
                    min="0"
                    style={{ ...scenInput, width: 70, padding: "6px 8px" }}
                    value={cmWaitMin ?? ""}
                    placeholder="e.g. 5"
                    onChange={(e) => setCmWaitMin(e.target.value === "" ? null : parseInt(e.target.value))}
                  />
                </div>
                <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontFamily: FONT }}>—</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontFamily: FONT }}>Max</span>
                  <input
                    type="number"
                    min="0"
                    style={{ ...scenInput, width: 70, padding: "6px 8px" }}
                    value={cmWaitMax ?? ""}
                    placeholder="e.g. 15"
                    onChange={(e) => setCmWaitMax(e.target.value === "" ? null : parseInt(e.target.value))}
                  />
                </div>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT }}>seconds</span>
                {(cmWaitMin || cmWaitMax) && (
                  <span style={{ fontSize: "0.72rem", color: "#2563eb", fontFamily: FONT, background: "#eff6ff", padding: "2px 8px", borderRadius: 6 }}>
                    Will wait {cmWaitMin || 0}–{cmWaitMax || cmWaitMin || 0}s after answering
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", fontFamily: FONT, marginTop: 4 }}>
                Bot waits a random duration in this range after selecting the country answer.
              </div>
            </div>
          </div>
          )}
          {loadingSteps ? (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: FONT,
                fontSize: "0.85rem",
                color: "#94a3b8",
              }}
            >
              Loading steps...
            </div>
          ) : steps.length === 0 ? (
            <div
              style={{
                background: "#f8fafc",
                border: "1.5px dashed #e2e8f0",
                borderRadius: 10,
                padding: "40px 20px",
                textAlign: "center",
              }}
            >
              <Target size={36} color="#cbd5e1" style={{ marginBottom: 10 }} />
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: "0.88rem",
                  color: "#94a3b8",
                }}
              >
                No steps yet. Add a step to define what the bot should do at
                specific questions.
              </div>
              <button
                onClick={addStep}
                style={{
                  ...scenBtn("#f0f7ff", "#1e3a5f"),
                  margin: "12px auto 0",
                  padding: "8px 16px",
                }}
              >
                <Plus size={14} /> Add First Step
              </button>
            </div>
          ) : (
            steps.map((step, i) => (
              <StepBuilder
                key={i}
                step={step}
                index={i}
                onChange={updateStep}
                onRemove={removeStep}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
              />
            ))
          )}
        </div>
        <div
          style={{
            padding: "16px 28px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <button style={s.cancelBtnFull} onClick={onClose}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }}
          >
            <Save size={16} />{" "}
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Scenario"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Save as Scenario Modal ───────────────────────────────────────────────────
function SaveAsScenarioModal({
  sessionId,
  sessionOutcome,
  projectId,
  onClose,
  onSaved,
  showToast,
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState(
    sessionOutcome || "any",
  );
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    api
      .get(`/sessions/${sessionId}`)
      .then((res) => {
        const events = (res.data.events || [])
          .filter((e) => e.event_type === "page_answered")
          .map((e) => ({
            ...e,
            payload:
              typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
          }))
          .filter((e) => !e.payload?.isExitPage);
        setPreview(events);
      })
      .catch(() => setPreview([]))
      .finally(() => setLoadingPreview(false));
  }, [sessionId]);

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/scenarios/from-session/${sessionId}`, {
        name,
        description,
        expectedOutcome,
        projectId,
      });
      showToast("Scenario created from session ✓");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to create scenario",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const oc = OUTCOME_COLORS[expectedOutcome] || OUTCOME_COLORS.any;

  return (
    <div style={s.overlay}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          width: "100%",
          maxWidth: 580,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "22px 26px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: FONT,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "#1e293b",
                margin: "0 0 4px",
              }}
            >
              Save as Scenario
            </h2>
            <p
              style={{
                fontFamily: FONT,
                fontSize: "0.8rem",
                color: "#64748b",
                margin: 0,
              }}
            >
              Session{" "}
              <code
                style={{
                  background: "#f1f5f9",
                  padding: "1px 5px",
                  borderRadius: 4,
                  fontSize: "0.75rem",
                }}
              >
                {sessionId.slice(0, 8)}
              </code>{" "}
              will be converted into a reusable scenario.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 26px" }}>
          <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
            <div>
              <label style={scenLabel}>Scenario Name *</label>
              <input
                style={scenInput}
                value={name}
                placeholder="e.g. Qualifying Male 35-44 UK"
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label style={scenLabel}>Expected Outcome</label>
              <select
                style={{
                  ...scenInput,
                  background: oc.bg,
                  color: oc.text,
                  fontWeight: 600,
                }}
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
              >
                {OUTCOME_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={scenLabel}>Description (optional)</label>
              <input
                style={scenInput}
                value={description}
                placeholder="What is this scenario testing?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 10,
            }}
          >
            Steps that will be generated
          </div>
          {loadingPreview ? (
            <div
              style={{
                fontFamily: FONT,
                fontSize: "0.85rem",
                color: "#94a3b8",
                padding: "20px 0",
              }}
            >
              Analysing session...
            </div>
          ) : (
            <div
              style={{
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {(preview || []).length === 0 ? (
                <div
                  style={{
                    padding: 20,
                    fontFamily: FONT,
                    fontSize: "0.85rem",
                    color: "#94a3b8",
                    textAlign: "center",
                  }}
                >
                  No answerable pages found in this session.
                </div>
              ) : (
                (preview || []).map((ev, i) => {
                  const questions = ev.payload?.questions || [];
                  const options = ev.payload?.options || [];
                  const answered = options.filter(
                    (o) =>
                      o.selected &&
                      (Array.isArray(o.selected)
                        ? o.selected.length > 0
                        : true),
                  );
                  return (
                    <div
                      key={i}
                      style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: FONT,
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#1e3a5f",
                          marginBottom: 4,
                        }}
                      >
                        Page {i + 1}
                        {questions[0]
                          ? ` — "${questions[0].slice(0, 60)}${questions[0].length > 60 ? "…" : ""}"`
                          : ""}
                      </div>
                      {answered.map((o, j) => (
                        <div
                          key={j}
                          style={{
                            fontFamily: FONT,
                            fontSize: "0.72rem",
                            color: "#475569",
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              background: "#dbeafe",
                              color: "#1e3a5f",
                              borderRadius: 4,
                              padding: "1px 6px",
                              fontWeight: 600,
                            }}
                          >
                            {o.type}
                          </span>
                          <span>
                            →{" "}
                            {Array.isArray(o.selected)
                              ? o.selected.join(", ")
                              : o.selected}
                          </span>
                        </div>
                      ))}
                      {answered.length === 0 && (
                        <div
                          style={{
                            fontFamily: FONT,
                            fontSize: "0.72rem",
                            color: "#94a3b8",
                          }}
                        >
                          No selections recorded
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div
                style={{
                  padding: "8px 14px",
                  background: "#f0f7ff",
                  fontFamily: FONT,
                  fontSize: "0.72rem",
                  color: "#2563eb",
                }}
              >
                ✦ You can edit individual steps after creating the scenario.
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "14px 26px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <button style={s.cancelBtnFull} onClick={onClose}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loadingPreview}
            style={{
              ...s.saveBtn,
              opacity: saving || loadingPreview ? 0.7 : 1,
            }}
          >
            <Save size={16} /> {saving ? "Creating..." : "Create Scenario"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Save as Country Scenario Modal ──────────────────────────────────────────
function SaveAsCountryScenarioModal({
  sessionId,
  pagePayload,
  projectId,
  onClose,
  onSaved,
  showToast,
}) {
  const questionText = pagePayload?.questions?.[0] || "";
  const pageOptions = pagePayload?.options || [];
  const allOptionTexts = [
    ...new Set(pageOptions.flatMap((og) => og.options || []).filter(Boolean)),
  ];

  const [questionContains, setQuestionContains] = useState(questionText);
  const [mappings, setMappings] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get(`/projects/${projectId}`)
      .then((res) => {
        const svs = res.data.surveys || [];
        const codes = [
          ...new Set(
            svs.flatMap((sv) =>
              Array.isArray(sv.countries)
                ? sv.countries
                : (sv.countries || "")
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean),
            ),
          ),
        ];
        setMappings(codes.map((c) => ({ country: c, answer: "" })));
      })
      .catch(() => {});
  }, [projectId]);

  const setAnswer = (idx, val) =>
    setMappings((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, answer: val } : m)),
    );

  const handleSave = async () => {
    if (!questionContains.trim()) {
      showToast("Question text is required", "error");
      return;
    }
    const incomplete = mappings.filter((m) => !m.answer);
    if (incomplete.length > 0) {
      showToast("All countries must have an answer selected", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/scenarios/country-logic", {
        projectId,
        questionContains,
        mappings,
      });
      showToast("Country Logic scenario created ✓");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to create Country Logic",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.overlay}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          width: "100%",
          maxWidth: 560,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "22px 26px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: FONT,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "#1e293b",
                margin: "0 0 4px",
              }}
            >
              Save as Country Logic
            </h2>
            <p
              style={{
                fontFamily: FONT,
                fontSize: "0.8rem",
                color: "#64748b",
                margin: 0,
              }}
            >
              Maps each project country to the correct survey answer for this
              question.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 26px" }}>
          <div style={{ marginBottom: 14 }}>
            <label style={scenLabel}>Scenario Name</label>
            <div
              style={{
                ...scenInput,
                background: "#f8fafc",
                color: "#94a3b8",
                cursor: "not-allowed",
                display: "flex",
                alignItems: "center",
              }}
            >
              Country Logic
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={scenLabel}>Question contains text *</label>
            <input
              style={scenInput}
              value={questionContains}
              onChange={(e) => setQuestionContains(e.target.value)}
              placeholder="e.g. country of residence"
            />
            <div
              style={{
                fontSize: "0.7rem",
                color: "#94a3b8",
                fontFamily: FONT,
                marginTop: 4,
              }}
            >
              Bot uses this to identify the country question on any page.
            </div>
          </div>
          <div>
            <label style={scenLabel}>Country Answer Mapping</label>
            <div
              style={{
                fontSize: "0.72rem",
                color: "#94a3b8",
                fontFamily: FONT,
                marginBottom: 10,
              }}
            >
              Select the exact option the bot should choose for each country.
              Sessions from unmapped countries will naturally terminate via
              survey logic.
            </div>
            {mappings.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  background: "#f8fafc",
                  borderRadius: 8,
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                Loading project countries...
              </div>
            ) : (
              <div
                style={{
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "100px 1fr",
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#94a3b8",
                      fontFamily: FONT,
                      textTransform: "uppercase",
                    }}
                  >
                    Country
                  </div>
                  <div
                    style={{
                      padding: "8px 14px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#94a3b8",
                      fontFamily: FONT,
                      textTransform: "uppercase",
                    }}
                  >
                    Select option containing
                  </div>
                </div>
                {mappings.map((m, i) => (
                  <div
                    key={m.country}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "100px 1fr",
                      borderBottom:
                        i < mappings.length - 1 ? "1px solid #f1f5f9" : "none",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 14px",
                        fontFamily: "monospace",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "#1e3a5f",
                        background: "#f0f7ff",
                      }}
                    >
                      {m.country}
                    </div>
                    <div style={{ padding: "8px 12px" }}>
                      <select
                        style={{ ...scenInput, margin: 0 }}
                        value={m.answer}
                        onChange={(e) => setAnswer(i, e.target.value)}
                      >
                        <option value="">— select option —</option>
                        {allOptionTexts.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            padding: "14px 26px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <button style={s.cancelBtnFull} onClick={onClose}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || mappings.length === 0}
            style={{
              ...s.saveBtn,
              opacity: saving || mappings.length === 0 ? 0.7 : 1,
            }}
          >
            <Save size={16} /> {saving ? "Creating..." : "Create Country Logic"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Scenarios Tab ────────────────────────────────────────────────────────────
function ScenariosTab({ projectId, showToast }) {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editScenario, setEditScenario] = useState(null);
  const [countryLogicScenario, setCountryLogicScenario] = useState(null);

  const load = async () => {
    try {
      const res = await api.get(`/scenarios/project/${projectId}`);
      setScenarios(res.data.scenarios || []);
    } catch {
      showToast("Failed to load scenarios", "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [projectId]);

  useEffect(() => {
    const cl = scenarios.find((s) => s.name === "Country Logic");
    setCountryLogicScenario(cl || null);
  }, [scenarios]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete scenario "${name}"? This cannot be undone.`))
      return;
    try {
      await api.delete(`/scenarios/${id}`);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      showToast("Scenario deleted");
    } catch {
      showToast("Failed to delete scenario", "error");
    }
  };

  const handleDuplicate = async (id) => {
    try {
      await api.post(`/scenarios/${id}/duplicate`);
      showToast("Scenario duplicated ✓");
      load();
    } catch {
      showToast("Failed to duplicate scenario", "error");
    }
  };

  const handleToggleActive = async (scenario) => {
    try {
      await api.patch(`/scenarios/${scenario.id}`, {
        isActive: !scenario.project_active,
      });
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === scenario.id
            ? { ...s, project_active: !scenario.project_active }
            : s,
        ),
      );
    } catch {
      showToast("Failed to update scenario", "error");
    }
  };

  if (loading) return <div style={s.tabCenter}>Loading scenarios...</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
        }}
      >
        <div>
          <h3 style={s.sectionH}>Test Scenarios</h3>
          <p style={s.sectionP}>
            Define answer logic for the bot to follow. Multiple scenarios run
            round-robin across sessions.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {countryLogicScenario && (
            <button
              onClick={() => setEditScenario(countryLogicScenario)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#f0f7ff",
                border: "1.5px solid #dbeafe",
                borderRadius: 8,
                padding: "9px 16px",
                fontSize: "0.88rem",
                fontWeight: 600,
                cursor: "pointer",
                color: "#1e3a5f",
                fontFamily: FONT,
              }}
            >
              <Globe size={15} /> Edit Country Logic
            </button>
          )}
          <button style={s.primaryBtn} onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Scenario
          </button>
        </div>
      </div>

      {scenarios.length === 0 ? (
        <div style={s.emptyQuota}>
          <Target size={48} color="#cbd5e1" />
          <h4
            style={{ fontFamily: FONT, color: "#1e293b", margin: "12px 0 6px" }}
          >
            No Scenarios Yet
          </h4>
          <p
            style={{
              fontFamily: FONT,
              color: "#64748b",
              fontSize: "0.88rem",
              marginBottom: 16,
            }}
          >
            Create scenarios to define bot behaviour, or save a completed
            session as a scenario.
          </p>
          <button style={s.primaryBtn} onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create First Scenario
          </button>
        </div>
      ) : (
        <div>
          <div
            style={{
              background: "#f0f7ff",
              border: "1.5px solid #dbeafe",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: "0.82rem",
              color: "#1e3a5f",
              fontFamily: FONT,
            }}
          >
            ✦ Active scenarios run round-robin. Session 1 → Scenario A, Session
            2 → Scenario B, etc. Toggle active/inactive to include or exclude
            from runs.
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.theadRow}>
                  {[
                    "Scenario Name",
                    "Expected Outcome",
                    "Steps",
                    "Source",
                    "Active",
                    "Actions",
                  ].map((h) => (
                    <th key={h} style={s.th}>
                      <div style={s.thInner}>{h}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((sc, idx) => {
                  const oc =
                    OUTCOME_COLORS[sc.expected_outcome] || OUTCOME_COLORS.any;
                  return (
                    <tr
                      key={sc.id}
                      style={{
                        ...s.tr,
                        background: idx % 2 === 0 ? "white" : "#f8fafc",
                      }}
                    >
                      <td style={s.td}>
                        <div
                          style={{
                            fontFamily: FONT,
                            fontSize: "0.88rem",
                            fontWeight: 600,
                            color: "#1e293b",
                          }}
                        >
                          {sc.name}
                        </div>
                        {sc.description && (
                          <div
                            style={{
                              fontFamily: FONT,
                              fontSize: "0.75rem",
                              color: "#94a3b8",
                              marginTop: 2,
                            }}
                          >
                            {sc.description.slice(0, 60)}
                            {sc.description.length > 60 ? "…" : ""}
                          </div>
                        )}
                      </td>
                      <td style={s.td}>
                        <span
                          style={{
                            background: oc.bg,
                            color: oc.text,
                            borderRadius: 20,
                            padding: "3px 10px",
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            fontFamily: FONT,
                          }}
                        >
                          {OUTCOME_OPTS.find(
                            (o) => o.value === sc.expected_outcome,
                          )?.label || sc.expected_outcome}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span
                          style={{
                            fontFamily: FONT,
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            color: "#1e3a5f",
                          }}
                        >
                          {sc.step_count || 0}
                        </span>
                        <span
                          style={{
                            fontFamily: FONT,
                            fontSize: "0.75rem",
                            color: "#94a3b8",
                          }}
                        >
                          {" "}
                          steps
                        </span>
                      </td>
                      <td style={s.td}>
                        {sc.source_session_id ? (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.72rem",
                              color: "#2563eb",
                              background: "#eff6ff",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            From session
                          </span>
                        ) : (
                          <span
                            style={{
                              fontFamily: FONT,
                              fontSize: "0.75rem",
                              color: "#94a3b8",
                            }}
                          >
                            Manual
                          </span>
                        )}
                      </td>
                      <td style={s.td}>
                        <button
                          onClick={() => handleToggleActive(sc)}
                          style={{
                            background: sc.project_active
                              ? "#dcfce7"
                              : "#f1f5f9",
                            color: sc.project_active ? "#166534" : "#94a3b8",
                            border: "none",
                            borderRadius: 20,
                            padding: "3px 12px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontFamily: FONT,
                          }}
                        >
                          {sc.project_active ? "● Active" : "○ Inactive"}
                        </button>
                      </td>
                      <td style={s.td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            title="Edit scenario"
                            onClick={() => setEditScenario(sc)}
                            style={{
                              background: "#f0f7ff",
                              border: "1px solid #dbeafe",
                              borderRadius: 6,
                              padding: "5px 8px",
                              cursor: "pointer",
                              color: "#2563eb",
                              display: "flex",
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            title="Duplicate"
                            onClick={() => handleDuplicate(sc.id)}
                            style={{
                              background: "#f0fdf4",
                              border: "1px solid #bbf7d0",
                              borderRadius: 6,
                              padding: "5px 8px",
                              cursor: "pointer",
                              color: "#059669",
                              display: "flex",
                            }}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            title="Delete"
                            onClick={() => handleDelete(sc.id, sc.name)}
                            style={{
                              background: "#fef2f2",
                              border: "1px solid #fecaca",
                              borderRadius: 6,
                              padding: "5px 8px",
                              cursor: "pointer",
                              color: "#ef4444",
                              display: "flex",
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <ScenarioModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onSaved={load}
          showToast={showToast}
        />
      )}
      {editScenario && (
        <ScenarioModal
          scenario={editScenario}
          projectId={projectId}
          onClose={() => setEditScenario(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION REPORT MODAL
// ══════════════════════════════════════════════════════════════════════════════
function SessionReportModal({
  sessionId,
  projectId,
  onClose,
  showToast = () => {},
}) {
  const [showSaveScenario, setShowSaveScenario] = useState(false);
  const [showCountryScenario, setShowCountryScenario] = useState(false);
  const [countryScenarioPage, setCountryScenarioPage] = useState(null);
  const [countryLogicExists, setCountryLogicExists] = useState(false);
  const [countryLogicChecked, setCountryLogicChecked] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [imgError, setImgError] = useState({});
  const printRef = useRef(null);

  useEffect(() => {
    api
      .get(`/sessions/${sessionId}`)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!projectId) return;
    api
      .get(`/scenarios/country-logic/${projectId}`)
      .then((res) => setCountryLogicExists(res.data.exists))
      .catch(() => {})
      .finally(() => setCountryLogicChecked(true));
  }, [projectId]);

  const getPageEvents = () => {
    if (!detail?.events) return [];
    return detail.events
      .filter((e) => e.event_type === "page_answered")
      .map((e) => ({
        ...e,
        payload:
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
      }));
  };
  const getMetaEvent = (type) => {
    if (!detail?.events) return null;
    const ev = detail.events.find((e) => e.event_type === type);
    if (!ev) return null;
    return typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
  };

  const handlePrint = () => {
    const w = window.open("", "_blank");
    const allPagesHtml = pageEvents
      .map((ev, i) => {
        const payload = ev.payload || {};
        const questions = payload.questions || [];
        const options = payload.options || [];
        const isExit = payload.isExitPage;

        let html = `<div style="page-break-after:always;margin-bottom:40px;border:1px solid #e2e8f0;border-radius:8px;padding:20px;">`;
        html += `<h2 style="font-size:1rem;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px;">
        ${isExit ? "Exit Page" : `Page ${i + 1}`}
        ${payload.timeTaken ? `<span style="font-size:0.8rem;color:#94a3b8;margin-left:8px;">⏱ ${fmtDuration(payload.timeTaken)}</span>` : ""}
      </h2>`;

        if (payload.url) {
          html += `<div style="font-size:0.78rem;color:#2563eb;background:#f0f7ff;padding:6px 10px;border-radius:6px;margin-bottom:12px;word-break:break-all;">🔗 ${payload.url}</div>`;
        }

        html += `<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <div style="padding:6px 10px;background:#f8fafc;font-size:0.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Screenshot</div>
        <img src="${API_BASE}/sessions/${session.id}/screenshot/page_${i + 1}.png" style="width:100%;display:block;" onerror="this.parentElement.style.display='none'" />
      </div>`;

        if (questions.length > 0) {
          html += `<div style="margin-bottom:12px;"><div style="font-size:0.72rem;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">Questions Detected</div>`;
          questions.forEach((q, qi) => {
            html += `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:4px;font-size:0.85rem;color:#1e293b;"><span style="color:#94a3b8;">Q${qi + 1}.</span> ${q}</div>`;
          });
          html += `</div>`;
        }

        if (options.length > 0) {
          html += `<div style="margin-bottom:12px;"><div style="font-size:0.72rem;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">All Options & Selection</div>`;
          options.forEach((optGroup) => {
            html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="margin-bottom:8px;"><span style="font-size:0.7rem;font-weight:700;background:#f0f7ff;color:#2563eb;border-radius:4px;padding:2px 8px;text-transform:uppercase;">${optGroup.type}</span></div>`;
            if (optGroup.options) {
              optGroup.options.forEach((opt) => {
                const isSel =
                  optGroup.type === "checkbox"
                    ? optGroup.selected?.includes(opt)
                    : optGroup.selected === opt;
                html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;margin-bottom:2px;background:${isSel ? "#f0fdf4" : "#f8fafc"};border:1px solid ${isSel ? "#86efac" : "#e2e8f0"};">
                <span style="font-size:0.83rem;color:${isSel ? "#166534" : "#475569"};font-weight:${isSel ? "600" : "400"};flex:1;">${opt}</span>
                ${isSel ? `<span style="font-size:0.7rem;background:#059669;color:white;border-radius:4px;padding:1px 6px;font-weight:700;">SELECTED</span>` : ""}
              </div>`;
              });
            }
            if (
              (optGroup.type === "open-end" || optGroup.type === "numeric") &&
              optGroup.selected
            ) {
              html += `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:8px 12px;font-size:0.85rem;color:#166534;">${optGroup.selected}</div>`;
            }
            html += `</div>`;
          });
          html += `</div>`;
        }

        html += `</div>`;
        return html;
      })
      .join("");

    w.document
      .write(`<html><head><title>Session Report — ${session.id.slice(0, 8)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:24px;max-width:900px;margin:0 auto;}
        h1{font-size:1.2rem;margin-bottom:4px;}
        .meta{font-size:0.82rem;color:#64748b;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;}
        @media print{body{padding:12px}}
      </style></head><body>
      <h1>Session Report — ${session.id.slice(0, 8)}</h1>
      <div class="meta">
        Outcome: <strong>${formatLabel(session.outcome)}</strong> &nbsp;|&nbsp;
        Country: ${session.proxy_country || "—"} &nbsp;|&nbsp;
        Duration: ${fmtDuration(session.total_duration_s)} &nbsp;|&nbsp;
        Response ID: ${session.response_id || "—"} &nbsp;|&nbsp;
        IP: ${getMetaEvent("ip_assigned")?.ip || "—"}
      </div>
      ${allPagesHtml || "<p>No page data recorded.</p>"}
    </body></html>`);
    w.document.close();
    w.print();
  };

  if (loading)
    return (
      <div style={s.overlay}>
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
            fontFamily: FONT,
            color: "#64748b",
          }}
        >
          Loading session report...
        </div>
      </div>
    );
  if (!detail)
    return (
      <div style={s.overlay}>
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: 32,
            maxWidth: 440,
            width: "100%",
            textAlign: "center",
          }}
        >
          <p style={{ fontFamily: FONT, color: "#64748b" }}>
            Session details not available yet.
          </p>
          <button style={s.cancelBtnFull} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );

  const { session } = detail;
  const pageEvents = getPageEvents();
  const ipEvent = getMetaEvent("ip_assigned");
  const errorEvent = getMetaEvent("error");
  const activePage = pageEvents[activePageIdx];
  const errorText = session?.error_log || errorEvent?.message || "";

  const outcomeColors = {
    completed: { bg: "#dcfce7", text: "#166534" },
    terminated: { bg: "#fce7f3", text: "#9d174d" },
    over_quota: { bg: "#fef3c7", text: "#92400e" },
    error: { bg: "#fef2f2", text: "#dc2626" },
  };
  const oc = outcomeColors[session.outcome] || outcomeColors.error;

  const canSaveAsScenario = ["completed", "terminated", "over_quota"].includes(
    session.outcome,
  );

  return (
    <div style={{ ...s.overlay, alignItems: "flex-start", paddingTop: 20 }}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          width: "100%",
          maxWidth: 1020,
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 4,
              }}
            >
              <FileText size={18} color="#1e3a5f" />
              <h2
                style={{
                  fontFamily: FONT,
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "#1e293b",
                  margin: 0,
                }}
              >
                Session Report
              </h2>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.82rem",
                  color: "#64748b",
                  background: "#f1f5f9",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                {session.id.slice(0, 8)}
              </span>
              {session.outcome && (
                <span
                  style={{
                    background: oc.bg,
                    color: oc.text,
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    fontFamily: FONT,
                  }}
                >
                  {formatLabel(session.outcome)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                session.persona_name && `👤 ${session.persona_name}`,
                session.proxy_country && `🌍 ${session.proxy_country}`,
                session.device_type && `💻 ${formatLabel(session.device_type)}`,
                session.total_duration_s &&
                  `⏱ ${fmtDuration(session.total_duration_s)}`,
                session.response_id && `🔑 ${session.response_id}`,
                ipEvent?.ip && `🌐 ${ipEvent.ip}`,
              ]
                .filter(Boolean)
                .map((item, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: "0.78rem",
                      color: "#64748b",
                      fontFamily: FONT,
                    }}
                  >
                    {item}
                  </span>
                ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canSaveAsScenario && (
              <button
                onClick={() => setShowSaveScenario(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#f0fdf4",
                  border: "1.5px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "7px 14px",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#059669",
                  fontFamily: FONT,
                }}
              >
                <Save size={14} /> Save as Scenario
              </button>
            )}
            <button
              onClick={handlePrint}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#f0f7ff",
                border: "1.5px solid #dbeafe",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                color: "#1e3a5f",
                fontFamily: FONT,
              }}
            >
              <Download size={14} /> Export PDF
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#64748b",
                padding: 4,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Left panel */}
          <div
            style={{
              width: 210,
              borderRight: "1px solid #f1f5f9",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                padding: "12px 14px 6px",
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#94a3b8",
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Pages ({pageEvents.length})
            </div>
            {pageEvents.length === 0 ? (
              <div
                style={{
                  padding: "12px 14px",
                  fontSize: "0.82rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                No pages recorded yet.
              </div>
            ) : (
              pageEvents.map((ev, i) => (
                <button
                  key={i}
                  onClick={() => setActivePageIdx(i)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    border: "none",
                    background: activePageIdx === i ? "#f0f7ff" : "transparent",
                    borderLeft:
                      activePageIdx === i
                        ? "3px solid #2563eb"
                        : "3px solid transparent",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      color: activePageIdx === i ? "#1e3a5f" : "#1e293b",
                      fontFamily: FONT,
                    }}
                  >
                    {ev.payload?.isExitPage ? "Exit Page" : `Page ${i + 1}`}
                  </div>
                  {ev.payload?.isExitPage && (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        background:
                          ev.payload?.exitOutcome === "terminated"
                            ? "#fce7f3"
                            : ev.payload?.exitOutcome === "over_quota"
                              ? "#fef3c7"
                              : "#dcfce7",
                        color:
                          ev.payload?.exitOutcome === "terminated"
                            ? "#9d174d"
                            : ev.payload?.exitOutcome === "over_quota"
                              ? "#92400e"
                              : "#166534",
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontFamily: FONT,
                        fontWeight: 700,
                      }}
                    >
                      {ev.payload?.exitOutcome === "terminated"
                        ? "⛔ Terminate"
                        : ev.payload?.exitOutcome === "over_quota"
                          ? "📊 Over Quota"
                          : "✅ Complete"}
                    </span>
                  )}
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      fontFamily: FONT,
                    }}
                  >
                    {fmtDuration(ev.payload?.timeTaken)}
                  </div>
                  {!ev.payload?.isExitPage &&
                    ev.payload?.questions?.length > 0 &&
                    !countryLogicExists &&
                    countryLogicChecked && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCountryScenarioPage({
                            index: i,
                            payload: ev.payload,
                          });
                          setShowCountryScenario(true);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          background: "#f0f7ff",
                          border: "1px solid #dbeafe",
                          borderRadius: 5,
                          padding: "3px 8px",
                          cursor: "pointer",
                          color: "#2563eb",
                          fontSize: "0.68rem",
                          fontFamily: FONT,
                          fontWeight: 600,
                          marginTop: 2,
                          width: "100%",
                        }}
                      >
                        <Globe size={10} /> Country Logic
                      </button>
                    )}
                  {countryLogicExists &&
                    !ev.payload?.isExitPage &&
                    ev.payload?.questions?.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.65rem",
                          color: "#059669",
                          fontFamily: FONT,
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <CheckCircle size={9} /> Country Logic set
                      </div>
                    )}
                  {ev.payload?.screenshot && (
                    <div
                      style={{
                        width: "100%",
                        height: 54,
                        background: "#f8fafc",
                        borderRadius: 4,
                        overflow: "hidden",
                        marginTop: 4,
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <img
                        src={`${API_BASE}/sessions/${session.id}/screenshot/page_${i + 1}.png`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                        onError={() =>
                          setImgError((p) => ({ ...p, [i]: true }))
                        }
                        alt={`Page ${i + 1}`}
                      />
                    </div>
                  )}
                </button>
              ))
            )}
            {session.outcome && (
              <div
                style={{
                  margin: "8px 14px",
                  background: oc.bg,
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: oc.text,
                    fontFamily: FONT,
                  }}
                >
                  {session.outcome === "completed"
                    ? "✅ Complete"
                    : session.outcome === "terminated"
                      ? "⛔ Terminate"
                      : session.outcome === "over_quota"
                        ? "📊 Over Quota"
                        : "❌ Error"}
                </div>
              </div>
            )}
          </div>

          {/* Right panel */}
          <div
            style={{ flex: 1, overflowY: "auto", padding: 24 }}
            ref={printRef}
          >
            {session?.outcome === "error" && errorText && (
              <div
                style={{
                  marginBottom: 16,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#991b1b",
                    marginBottom: 4,
                  }}
                >
                  Error details
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    color: "#7f1d1d",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {String(errorText).slice(0, 2000)}
                </div>
              </div>
            )}
            {pageEvents.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 0",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                <Camera
                  size={48}
                  color="#e2e8f0"
                  style={{ marginBottom: 12 }}
                />
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Session data not yet available
                </div>
                <div style={{ fontSize: "0.85rem" }}>
                  {["queued", "initialising", "in_progress"].includes(
                    session.status,
                  )
                    ? "This session is still running. Check back after it completes."
                    : "No page data was recorded for this session."}
                </div>
              </div>
            ) : activePage ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <h3
                    style={{
                      fontFamily: FONT,
                      fontSize: "1rem",
                      fontWeight: 700,
                      color: "#1e293b",
                      margin: 0,
                    }}
                  >
                    Page {activePageIdx + 1} —{" "}
                    {activePage.payload?.title || "Survey Page"}
                  </h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#64748b",
                        fontFamily: FONT,
                        background: "#f1f5f9",
                        padding: "3px 8px",
                        borderRadius: 6,
                      }}
                    >
                      ⏱ {fmtDuration(activePage.payload?.timeTaken)}
                    </span>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "#94a3b8",
                        fontFamily: FONT,
                        background: "#f1f5f9",
                        padding: "3px 8px",
                        borderRadius: 6,
                      }}
                    >
                      {fmtTimeShort(activePage.created_at)}
                    </span>
                  </div>
                </div>
                {activePage.payload?.url && (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#2563eb",
                      fontFamily: FONT,
                      background: "#f0f7ff",
                      padding: "6px 10px",
                      borderRadius: 6,
                      marginBottom: 14,
                      wordBreak: "break-all",
                    }}
                  >
                    🔗 {activePage.payload.url}
                  </div>
                )}
                <div
                  style={{
                    marginBottom: 20,
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "#f8fafc",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid #e2e8f0",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#94a3b8",
                      fontFamily: FONT,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Camera size={13} /> Page Screenshot (with selections)
                  </div>
                  {!imgError[activePageIdx] ? (
                    <img
                      src={`${API_BASE}/sessions/${session.id}/screenshot/page_${activePageIdx + 1}.png`}
                      style={{ width: "100%", display: "block" }}
                      onError={() =>
                        setImgError((p) => ({ ...p, [activePageIdx]: true }))
                      }
                      alt={`Screenshot of page ${activePageIdx + 1}`}
                    />
                  ) : (
                    <div
                      style={{
                        padding: 32,
                        textAlign: "center",
                        color: "#94a3b8",
                        fontFamily: FONT,
                        fontSize: "0.85rem",
                      }}
                    >
                      <Camera
                        size={32}
                        color="#e2e8f0"
                        style={{ marginBottom: 8 }}
                      />
                      <br />
                      Screenshot not available
                    </div>
                  )}
                </div>
                {activePage.payload?.questions?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#94a3b8",
                        fontFamily: FONT,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      Questions Detected
                    </div>
                    {activePage.payload.questions.map((q, qi) => (
                      <div
                        key={qi}
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: "10px 12px",
                          marginBottom: 6,
                          fontSize: "0.85rem",
                          color: "#1e293b",
                          fontFamily: FONT,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: "#94a3b8", marginRight: 6 }}>
                          Q{qi + 1}.
                        </span>{" "}
                        {q}
                      </div>
                    ))}
                  </div>
                )}
                {activePage.payload?.options?.length > 0 &&
                  !activePage.payload?.gridAnswers?.length && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#94a3b8",
                          fontFamily: FONT,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          marginBottom: 8,
                        }}
                      >
                        All Options & Selection
                      </div>
                      {activePage.payload.options.map((optGroup, gi) => (
                        <div
                          key={gi}
                          style={{
                            background: "white",
                            border: "1.5px solid #e2e8f0",
                            borderRadius: 10,
                            padding: 14,
                            marginBottom: 12,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 10,
                            }}
                          >
                            <span
                              style={{
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                background: "#f0f7ff",
                                color: "#2563eb",
                                borderRadius: 6,
                                padding: "2px 8px",
                                fontFamily: FONT,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              {optGroup.type}
                            </span>
                            {optGroup.type === "radio" && optGroup.selected && (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#166534",
                                  fontFamily: FONT,
                                }}
                              >
                                ✓ Selected: <strong>{optGroup.selected}</strong>
                              </span>
                            )}
                            {optGroup.type === "checkbox" &&
                              optGroup.selected?.length > 0 && (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "#166534",
                                    fontFamily: FONT,
                                  }}
                                >
                                  ✓ {optGroup.selected.length} of{" "}
                                  {optGroup.options?.length} selected
                                </span>
                              )}
                            {optGroup.type === "select" &&
                              optGroup.selected && (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "#166534",
                                    fontFamily: FONT,
                                  }}
                                >
                                  ✓ Selected:{" "}
                                  <strong>{optGroup.selected}</strong>
                                </span>
                              )}
                          </div>
                          {optGroup.options?.length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              {optGroup.options.map((opt, oi) => {
                                const isSelected =
                                  optGroup.type === "checkbox"
                                    ? optGroup.selected?.includes(opt)
                                    : optGroup.selected === opt;
                                return (
                                  <div
                                    key={oi}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                      padding: "7px 10px",
                                      borderRadius: 6,
                                      background: isSelected
                                        ? "#f0fdf4"
                                        : "#f8fafc",
                                      border: `1px solid ${isSelected ? "#86efac" : "#e2e8f0"}`,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 16,
                                        height: 16,
                                        borderRadius:
                                          optGroup.type === "checkbox"
                                            ? 4
                                            : "50%",
                                        border: `2px solid ${isSelected ? "#059669" : "#cbd5e1"}`,
                                        background: isSelected
                                          ? "#059669"
                                          : "white",
                                        flexShrink: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      {isSelected && (
                                        <div
                                          style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: "50%",
                                            background: "white",
                                          }}
                                        />
                                      )}
                                    </div>
                                    <span
                                      style={{
                                        fontSize: "0.83rem",
                                        color: isSelected
                                          ? "#166534"
                                          : "#475569",
                                        fontFamily: FONT,
                                        fontWeight: isSelected ? 600 : 400,
                                        flex: 1,
                                      }}
                                    >
                                      {opt}
                                    </span>
                                    {isSelected && (
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          background: "#059669",
                                          color: "white",
                                          borderRadius: 4,
                                          padding: "1px 6px",
                                          fontFamily: FONT,
                                          fontWeight: 700,
                                        }}
                                      >
                                        SELECTED
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        fontSize: "0.7rem",
                                        color: "#94a3b8",
                                        fontFamily: FONT,
                                      }}
                                    >
                                      {oi + 1}/{optGroup.options.length}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {(optGroup.type === "open-end" ||
                            optGroup.type === "numeric") &&
                            optGroup.selected && (
                              <div
                                style={{
                                  background: "#f0fdf4",
                                  border: "1px solid #86efac",
                                  borderRadius: 6,
                                  padding: "8px 12px",
                                  fontSize: "0.85rem",
                                  color: "#166534",
                                  fontFamily: FONT,
                                }}
                              >
                                {optGroup.selected}
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  )}
                {activePage.payload?.gridAnswers?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#94a3b8",
                        fontFamily: FONT,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      Grid Answers — Row → Selection
                    </div>
                    <div
                      style={{
                        border: "1.5px solid #e2e8f0",
                        borderRadius: 10,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 180px",
                          background: "#f8fafc",
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        <div
                          style={{
                            padding: "7px 14px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "#94a3b8",
                            fontFamily: FONT,
                            textTransform: "uppercase",
                          }}
                        >
                          Statement
                        </div>
                        <div
                          style={{
                            padding: "7px 14px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "#94a3b8",
                            fontFamily: FONT,
                            textTransform: "uppercase",
                          }}
                        >
                          Selection
                        </div>
                      </div>
                      {activePage.payload.gridAnswers.map((ga, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 180px",
                            borderBottom:
                              i < activePage.payload.gridAnswers.length - 1
                                ? "1px solid #f1f5f9"
                                : "none",
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              padding: "9px 14px",
                              fontSize: "0.82rem",
                              color: "#475569",
                              fontFamily: FONT,
                              lineHeight: 1.4,
                            }}
                          >
                            {ga.row}
                          </div>
                          <div style={{ padding: "9px 14px" }}>
                            <span
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 600,
                                background: ga.answered ? "#dcfce7" : "#fef2f2",
                                color: ga.answered ? "#166534" : "#dc2626",
                                borderRadius: 6,
                                padding: "3px 10px",
                                fontFamily: FONT,
                                display: "inline-block",
                              }}
                            >
                              {ga.selected}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activePage.payload?.answers?.some(
                  (a) => a?.type === "open-end",
                ) && (
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#94a3b8",
                        fontFamily: FONT,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      Open-End Response
                    </div>
                    {activePage.payload.answers
                      .filter((a) => a?.type === "open-end")
                      .map((a, ai) => (
                        <div
                          key={ai}
                          style={{
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            borderRadius: 8,
                            padding: "10px 12px",
                            marginBottom: 6,
                            fontSize: "0.85rem",
                            color: "#166534",
                            fontFamily: FONT,
                          }}
                        >
                          {a.text}
                        </div>
                      ))}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: "1px solid #f1f5f9",
                  }}
                >
                  <button
                    onClick={() => setActivePageIdx((i) => Math.max(0, i - 1))}
                    disabled={activePageIdx === 0}
                    style={{
                      background: "none",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "7px 14px",
                      fontSize: "0.85rem",
                      cursor: activePageIdx === 0 ? "not-allowed" : "pointer",
                      color: "#64748b",
                      fontFamily: FONT,
                      opacity: activePageIdx === 0 ? 0.4 : 1,
                    }}
                  >
                    ← Previous Page
                  </button>
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontFamily: FONT,
                      alignSelf: "center",
                    }}
                  >
                    {activePageIdx + 1} / {pageEvents.length}
                  </span>
                  <button
                    onClick={() =>
                      setActivePageIdx((i) =>
                        Math.min(pageEvents.length - 1, i + 1),
                      )
                    }
                    disabled={activePageIdx === pageEvents.length - 1}
                    style={{
                      background: "#1e3a5f",
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 14px",
                      fontSize: "0.85rem",
                      cursor:
                        activePageIdx === pageEvents.length - 1
                          ? "not-allowed"
                          : "pointer",
                      color: "white",
                      fontFamily: FONT,
                      opacity:
                        activePageIdx === pageEvents.length - 1 ? 0.4 : 1,
                    }}
                  >
                    Next Page →
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                Select a page from the left panel
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #f1f5f9",
            background: "#f8fafc",
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          {[
            ["Total Pages", pageEvents.length],
            ["Duration", fmtDuration(session.total_duration_s)],
            ["Outcome", formatLabel(session.outcome) || "—"],
            ["Response ID", session.response_id || "—"],
            ["IP Address", ipEvent?.ip || "—"],
            ["Country", session.proxy_country || "—"],
            ["Device", formatLabel(session.device_type)],
            ["Started", fmtTime(session.started_at)],
          ].map(([k, v]) => (
            <div key={k}>
              <div
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  color: "#94a3b8",
                  fontFamily: FONT,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {k}
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#1e293b",
                  fontFamily: FONT,
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCountryScenario && countryScenarioPage && (
        <SaveAsCountryScenarioModal
          sessionId={session.id}
          pagePayload={countryScenarioPage.payload}
          projectId={projectId || session.project_id}
          onClose={() => {
            setShowCountryScenario(false);
            setCountryScenarioPage(null);
          }}
          onSaved={() => {
            setCountryLogicExists(true);
          }}
          showToast={showToast}
        />
      )}

      {showSaveScenario && (
        <SaveAsScenarioModal
          sessionId={session.id}
          sessionOutcome={session.outcome}
          projectId={projectId || session.project_id}
          onClose={() => setShowSaveScenario(false)}
          onSaved={() => {}}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div style={s.statCard}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: color + "18",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Icon size={20} color={color} />
      </div>
      <div
        style={{
          fontSize: "1.8rem",
          fontWeight: 800,
          color: "#1e293b",
          fontFamily: FONT,
          marginBottom: 2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.78rem",
          color: "#64748b",
          fontFamily: FONT,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: "0.72rem",
            color: "#94a3b8",
            fontFamily: FONT,
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Survey Card (read-only) ──────────────────────────────────────────────────
function SurveyCardReadOnly({ survey, index }) {
  const norm = (v) =>
    Array.isArray(v)
      ? v
      : v
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
  return (
    <div style={s.surveyCard}>
      <div style={s.surveyCardHeader}>
        <span style={s.surveyNum}>{survey.label || `Survey ${index + 1}`}</span>
        <span
          style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT }}
        >
          Target: {survey.allocation}
        </span>
      </div>
      <div
        style={{
          fontSize: "0.82rem",
          color: "#2563eb",
          fontFamily: FONT,
          wordBreak: "break-all",
          marginBottom: 8,
        }}
      >
        {survey.url}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {norm(survey.countries).map((c) => (
          <span key={c} style={s.miniChip}>
            {c}
          </span>
        ))}
        {norm(survey.languages).map((l) => (
          <span
            key={l}
            style={{ ...s.miniChip, background: "#f0fdf4", color: "#166534" }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Survey Card (editable) ───────────────────────────────────────────────────
function SurveyCardEdit({ survey, index, onChange, onRemove }) {
  const { asOptions: countryOptions, loading: countriesLoading } =
    useCountries();
  const languageOptions = [
    { value: "en", label: "English" },
    { value: "hi", label: "Hindi" },
    { value: "de", label: "German" },
    { value: "fr", label: "French" },
    { value: "es", label: "Spanish" },
    { value: "pt", label: "Portuguese" },
    { value: "ar", label: "Arabic" },
    { value: "ja", label: "Japanese" },
    { value: "zh", label: "Chinese" },
    { value: "ko", label: "Korean" },
    { value: "id", label: "Indonesian" },
    { value: "ms", label: "Malay" },
  ];
  const norm = (v) =>
    Array.isArray(v)
      ? v
      : v
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
  const setVal = (k) => (e) => onChange(index, k, e.target.value);
  const set = (k) => (v) => onChange(index, k, v);
  return (
    <div style={s.surveyCard}>
      <div style={s.surveyCardHeader}>
        <span style={s.surveyNum}>Survey {index + 1}</span>
        {index > 0 && (
          <button style={s.removeBtn} onClick={() => onRemove(index)}>
            <X size={14} /> Remove
          </button>
        )}
      </div>
      <FormGrid>
        <Input
          label="Label"
          placeholder="Main / Control / Variant A"
          value={survey.label}
          onChange={setVal("label")}
        />
        <NumberInput
          label="Target (completes)"
          min="0"
          value={survey.allocation}
          onChange={setVal("allocation")}
        />
        <FullCol>
          <Input
            label="Survey URL"
            required
            placeholder="https://survey.example.com/start?token=..."
            value={survey.url}
            onChange={setVal("url")}
          />
        </FullCol>
        <Select
          label={
            countriesLoading
              ? "Target Countries (loading...)"
              : `Target Countries (${countryOptions.length})`
          }
          isMulti
          options={countryOptions}
          value={norm(survey.countries)}
          onChange={set("countries")}
          placeholder="Search and select countries..."
        />
        <Select
          label="Languages"
          isMulti
          options={languageOptions}
          value={norm(survey.languages)}
          onChange={set("languages")}
          placeholder="Select languages..."
        />
      </FormGrid>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// QUOTA TAB
// ══════════════════════════════════════════════════════════════════════════════
function QuotaTab({ projectId, targetCompletes, showToast }) {
  const [dimensions, setDimensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api.get(`/projects/${projectId}/quota`);
      if (res.data.cells && res.data.cells.length > 0) {
        const dimMap = {};
        for (const cell of res.data.cells) {
          const dims = cell.dimensions || {};
          for (const [dimName, dimVal] of Object.entries(dims)) {
            if (!dimMap[dimName])
              dimMap[dimName] = { name: dimName, values: [] };
            dimMap[dimName].values.push({
              label: dimVal,
              target: cell.target,
              minimum: cell.minimum || 0,
              quotaType: cell.quota_type || "hard",
              current: cell.current_count || 0,
              status: cell.status,
              pct:
                targetCompletes > 0
                  ? Math.round((cell.target / targetCompletes) * 100)
                  : 0,
            });
          }
        }
        setDimensions(Object.values(dimMap));
      }
    } catch {
      /* no quota yet */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [projectId]);

  const addDimension = () =>
    setDimensions((d) => [
      ...d,
      {
        name: "",
        values: [
          { label: "", target: 0, minimum: 0, quotaType: "hard", pct: 50 },
        ],
      },
    ]);
  const removeDimension = (di) =>
    setDimensions((d) => d.filter((_, i) => i !== di));
  const setDimName = (di, val) =>
    setDimensions((d) => {
      const n = [...d];
      n[di] = { ...n[di], name: val };
      return n;
    });
  const addValue = (di) =>
    setDimensions((d) => {
      const n = [...d];
      n[di] = {
        ...n[di],
        values: [
          ...n[di].values,
          { label: "", target: 0, minimum: 0, quotaType: "hard", pct: 0 },
        ],
      };
      return n;
    });
  const removeValue = (di, vi) =>
    setDimensions((d) => {
      const n = [...d];
      n[di] = { ...n[di], values: n[di].values.filter((_, i) => i !== vi) };
      return n;
    });
  const setValueField = (di, vi, field, val) =>
    setDimensions((d) => {
      const n = [...d];
      const vals = [...n[di].values];
      vals[vi] = { ...vals[vi], [field]: val };
      if (field === "pct")
        vals[vi].target = Math.round((parseFloat(val) / 100) * targetCompletes);
      if (field === "target")
        vals[vi].pct =
          targetCompletes > 0
            ? Math.round((parseInt(val) / targetCompletes) * 100)
            : 0;
      n[di] = { ...n[di], values: vals };
      return n;
    });

  const handleSave = async () => {
    for (const dim of dimensions) {
      if (!dim.name.trim()) {
        showToast("All dimensions must have a name", "error");
        return;
      }
      for (const v of dim.values) {
        if (!v.label.trim()) {
          showToast("All quota values must have a label", "error");
          return;
        }
      }
    }
    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/quota`, { dimensions });
      showToast("Quota plan saved ✓");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to save quota", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={s.tabCenter}>Loading quota plan...</div>;
  const totalAllocated = dimensions.reduce(
    (sum, d) =>
      sum + d.values.reduce((ss, v) => ss + (parseInt(v.target) || 0), 0),
    0,
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
        }}
      >
        <div>
          <h3 style={s.sectionH}>Quota Plan</h3>
          <p style={s.sectionP}>
            Define target distributions. Each dimension manages its own quota
            independently.
          </p>
        </div>
        <button style={s.primaryBtn} onClick={addDimension}>
          <Plus size={16} /> Add Dimension
        </button>
      </div>
      {dimensions.length > 0 && (
        <div style={s.quotaSummaryBar}>
          <span
            style={{ fontFamily: FONT, fontSize: "0.85rem", color: "#1e293b" }}
          >
            Project Target: <strong>{targetCompletes}</strong> completes
          </span>
          <span
            style={{
              fontFamily: FONT,
              fontSize: "0.85rem",
              color: totalAllocated === targetCompletes ? "#166534" : "#92400e",
            }}
          >
            Total Allocated: <strong>{totalAllocated}</strong>
            {totalAllocated !== targetCompletes &&
              ` (${totalAllocated > targetCompletes ? "+" : ""}${totalAllocated - targetCompletes} vs target)`}
          </span>
        </div>
      )}
      {dimensions.length === 0 ? (
        <div style={s.emptyQuota}>
          <Target size={48} color="#cbd5e1" />
          <h4
            style={{ fontFamily: FONT, color: "#1e293b", margin: "12px 0 6px" }}
          >
            No Quota Plan Yet
          </h4>
          <p
            style={{
              fontFamily: FONT,
              color: "#64748b",
              fontSize: "0.88rem",
              marginBottom: 16,
            }}
          >
            Add dimensions to define how sessions should be distributed.
          </p>
          <button style={s.primaryBtn} onClick={addDimension}>
            <Plus size={16} /> Add First Dimension
          </button>
        </div>
      ) : (
        dimensions.map((dim, di) => (
          <div key={di} style={s.dimCard}>
            <div style={s.dimHeader}>
              <div style={{ flex: 1 }}>
                <input
                  style={s.dimNameInput}
                  placeholder="Dimension name (e.g. Gender, Age Group, Region)"
                  value={dim.name}
                  onChange={(e) => setDimName(di, e.target.value)}
                />
              </div>
              <button
                style={s.dimRemoveBtn}
                onClick={() => removeDimension(di)}
              >
                <X size={15} /> Remove Dimension
              </button>
            </div>
            <table style={s.quotaTable}>
              <thead>
                <tr>
                  {[
                    "Value / Label",
                    "Target %",
                    "Target Count",
                    "Min Count",
                    "Type",
                    "Fill",
                    "",
                  ].map((h) => (
                    <th key={h} style={s.quotaTH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dim.values.map((val, vi) => (
                  <tr
                    key={vi}
                    style={{ background: vi % 2 === 0 ? "white" : "#f8fafc" }}
                  >
                    <td style={s.quotaTD}>
                      <input
                        style={s.quotaInput}
                        placeholder="e.g. Male"
                        value={val.label}
                        onChange={(e) =>
                          setValueField(di, vi, "label", e.target.value)
                        }
                      />
                    </td>
                    <td style={s.quotaTD}>
                      <input
                        style={{ ...s.quotaInput, width: 60 }}
                        type="number"
                        min="0"
                        max="100"
                        value={val.pct || ""}
                        placeholder="50"
                        onChange={(e) =>
                          setValueField(di, vi, "pct", e.target.value)
                        }
                      />
                    </td>
                    <td style={s.quotaTD}>
                      <input
                        style={{ ...s.quotaInput, width: 80 }}
                        type="number"
                        min="0"
                        value={val.target || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setValueField(di, vi, "target", e.target.value)
                        }
                      />
                    </td>
                    <td style={s.quotaTD}>
                      <input
                        style={{ ...s.quotaInput, width: 70 }}
                        type="number"
                        min="0"
                        value={val.minimum || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setValueField(di, vi, "minimum", e.target.value)
                        }
                      />
                    </td>
                    <td style={s.quotaTD}>
                      <select
                        style={{ ...s.quotaInput, width: 80 }}
                        value={val.quotaType}
                        onChange={(e) =>
                          setValueField(di, vi, "quotaType", e.target.value)
                        }
                      >
                        <option value="hard">Hard</option>
                        <option value="soft">Soft</option>
                      </select>
                    </td>
                    <td style={s.quotaTD}>
                      {val.current !== undefined ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              height: 6,
                              background: "#f1f5f9",
                              borderRadius: 3,
                              overflow: "hidden",
                              minWidth: 60,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                borderRadius: 3,
                                width: `${val.target > 0 ? Math.min(Math.round((val.current / val.target) * 100), 100) : 0}%`,
                                background:
                                  val.status === "filled"
                                    ? "#059669"
                                    : "#2563eb",
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "#64748b",
                              fontFamily: FONT,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {val.current || 0}/{val.target}
                          </span>
                        </div>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "#94a3b8",
                            fontFamily: FONT,
                          }}
                        >
                          Not started
                        </span>
                      )}
                    </td>
                    <td style={s.quotaTD}>
                      {vi > 0 && (
                        <button
                          style={s.rowRemoveBtn}
                          onClick={() => removeValue(di, vi)}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={s.addValueBtn} onClick={() => addValue(di)}>
              <Plus size={13} /> Add Value
            </button>
          </div>
        ))
      )}
      <div style={{ ...s.saveBar, marginTop: 20 }}>
        <button
          style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />{" "}
          {saving
            ? "Saving..."
            : dimensions.length === 0
              ? "Save (Clear Quota Plan)"
              : "Save Quota Plan"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSIONS TAB
// ══════════════════════════════════════════════════════════════════════════════
function SessionsTab({
  projectId,
  showToast,
  autoRefresh = false,
  refreshTrigger = 0,
}) {
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("squser") || "{}");
    } catch {
      return {};
    }
  })();
  const isAdmin = currentUser?.role === "admin";
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countries, setCountries] = useState([]);
  const [filters, setFilters] = useState({
    status: "",
    outcome: "",
    country: "",
  });

  const [viewSession, setViewSession] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;
  const intervalRef = useRef(null);

  useEffect(() => {
    api
      .get("/proxy/countries")
      .then((res) => setCountries(res.data.countries || []))
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (isRefresh = false, currentPage = page) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.append("status", filters.status);
        if (filters.outcome) params.append("outcome", filters.outcome);
        if (filters.country) params.append("country", filters.country);
        params.append("limit", PAGE_SIZE);
        params.append("offset", (currentPage - 1) * PAGE_SIZE);
        const res = await api.get(`/projects/${projectId}/sessions?${params}`);
        setSessions(res.data.sessions || []);
        setStats(res.data.stats || null);
        setTotalCount(
          parseInt(res.data.total || res.data.sessions?.length || 0),
        );
      } catch {
        showToast("Failed to load sessions", "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, filters, page, refreshTrigger],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActive =
      stats && (parseInt(stats.active) > 0 || parseInt(stats.queued) > 0);
    if (hasActive || autoRefresh) {
      intervalRef.current = setInterval(() => load(true), 8000);
    }
    return () => clearInterval(intervalRef.current);
  }, [stats, autoRefresh]);

  // Returns live elapsed time for active sessions, stored duration for completed ones
  const getLiveDuration = (session) => {
    if (["queued", "initialising"].includes(session.status)) return "Waiting...";
    if (session.status === "in_progress") {
      const start = session.started_at;
      if (!start) return "—";
      const elapsed = Math.round((Date.now() - new Date(start).getTime()) / 1000);
      return fmtDuration(elapsed) + " ⏳";
    }
    return fmtDuration(session.total_duration_s);
  };

  const handleClearSessions = async () => {
    setClearing(true);
    try {
      const res = await api.delete(`/sessions/project/${projectId}/all`);
      showToast(`${res.data.deleted} session(s) cleared ✓`);
      setShowClearConfirm(false);
      setSessions([]);
      setStats(null);
      setTotalCount(0);
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to clear sessions",
        "error",
      );
    } finally {
      setClearing(false);
    }
  };

  const handleStopSessions = async () => {
    setStopping(true);
    try {
      const res = await api.post(`/sessions/project/${projectId}/stop`);
      showToast(`${res.data.stopped} session(s) stopped ✓`);
      setShowStopConfirm(false);
      load(true);
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to stop sessions",
        "error",
      );
    } finally {
      setStopping(false);
    }
  };

  const handleStopOne = async (sessionId) => {
    try {
      await api.post(`/sessions/${sessionId}/stop`);
      showToast("Session stopped ✓");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to stop session", "error");
    }
  };

  const handleDeleteOne = async (sessionId) => {
    if (!window.confirm("Delete this session? This cannot be undone.")) return;
    try {
      await api.delete(`/sessions/${sessionId}`);
      showToast("Session deleted ✓");
      load(true);
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to delete session",
        "error",
      );
    }
  };

  const setF = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const hasFilters = filters.status || filters.outcome || filters.country;
  const clearFilters = () => {
    setFilters({ status: "", outcome: "", country: "" });
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const statusOpts = [
    "queued",
    "initialising",
    "in_progress",
    "completed",
    "terminated",
    "over_quota",
    "error",
    "flagged",
  ];
  const outcomeOpts = ["completed", "terminated", "over_quota", "error"];

  if (loading) return <div style={s.tabCenter}>Loading sessions...</div>;

  return (
    <div>
      {stats && (
        <div style={s.sessionStatsRow}>
          {[
            { label: "Total", val: stats.total || 0, color: "#64748b" },
            { label: "Active", val: stats.active || 0, color: "#2563eb" },
            { label: "Completed", val: stats.completed || 0, color: "#059669" },
            {
              label: "Terminated",
              val: stats.terminated || 0,
              color: "#9d174d",
            },
            { label: "Errors", val: stats.errors || 0, color: "#dc2626" },
            {
              label: "Over Quota",
              val: stats.over_quota || 0,
              color: "#92400e",
            },
            {
              label: "Avg Duration",
              val: fmtDuration(stats.avg_duration),
              color: "#0891b2",
            },
            {
              label: "Avg Quality",
              val: stats.avg_quality ? `${stats.avg_quality}/100` : "—",
              color: "#7c3aed",
            },
          ].map(({ label, val, color }) => (
            <div key={label} style={s.sessionStat}>
              <div
                style={{
                  fontSize: "1.3rem",
                  fontWeight: 800,
                  color,
                  fontFamily: FONT,
                }}
              >
                {val}
              </div>
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={s.sessionFilters}>
        <select
          style={s.filterSel}
          value={filters.status}
          onChange={(e) => setF("status", e.target.value)}
        >
          <option value="">All Status</option>
          {statusOpts.map((o) => (
            <option key={o} value={o}>
              {formatLabel(o)}
            </option>
          ))}
        </select>
        <select
          style={s.filterSel}
          value={filters.outcome}
          onChange={(e) => setF("outcome", e.target.value)}
        >
          <option value="">All Outcomes</option>
          {outcomeOpts.map((o) => (
            <option key={o} value={o}>
              {formatLabel(o)}
            </option>
          ))}
        </select>
        <select
          style={s.filterSel}
          value={filters.country}
          onChange={(e) => setF("country", e.target.value)}
        >
          <option value="">All Countries</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.country}
            </option>
          ))}
        </select>
        <button
          style={s.refreshBtn}
          onClick={() => load(true)}
          disabled={refreshing}
        >
          <RefreshCw
            size={14}
            style={{
              animation: refreshing ? "spin 1s linear infinite" : "none",
            }}
          />{" "}
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        {isAdmin && sessions.length > 0 && (
          <button
            onClick={() => setShowClearConfirm(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#fef2f2",
              border: "1.5px solid #fecaca",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              color: "#dc2626",
              fontFamily: FONT,
            }}
          >
            <Trash2 size={13} /> Clear All Sessions
          </button>
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#fef2f2",
              border: "1.5px solid #fecaca",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              color: "#dc2626",
              fontFamily: FONT,
            }}
          >
            <X size={13} /> Clear Filters
          </button>
        )}
        {(parseInt(stats?.active) > 0 || parseInt(stats?.queued) > 0) && (
          <>
            <button
              onClick={() => setShowStopConfirm(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "#fff7ed",
                border: "1.5px solid #fed7aa",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                color: "#c2410c",
                fontFamily: FONT,
              }}
            >
              <StopCircle size={13} /> Stop All Running
            </button>
            <span
              style={{
                fontSize: "0.75rem",
                color: "#2563eb",
                fontFamily: FONT,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#2563eb",
                  display: "inline-block",
                }}
              />
              Auto-refreshing
            </span>
          </>
        )}
      </div>

      {sessions.length === 0 ? (
        <div style={s.emptyQuota}>
          <Activity size={48} color="#cbd5e1" />
          <h4
            style={{ fontFamily: FONT, color: "#1e293b", margin: "12px 0 6px" }}
          >
            No Sessions Found
          </h4>
          <p
            style={{ fontFamily: FONT, color: "#64748b", fontSize: "0.88rem" }}
          >
            {hasFilters
              ? "No sessions match your current filters."
              : "Sessions will appear here once bot runs are triggered."}
          </p>
          {hasFilters && (
            <button
              style={{ ...s.primaryBtn, marginTop: 12 }}
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#94a3b8",
              fontFamily: FONT,
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              Use the <strong>View</strong> button on each row to open the
              session report.
            </span>
            <span>
              {totalCount > 0
                ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount}`
                : ""}
            </span>
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.theadRow}>
                  {[
                    "Session ID",
                    "Response ID",
                    "Country",
                    "IP Address",
                    "Persona",
                    "Scenario",
                    "Device",
                    "Started",
                    "Ended",
                    "Duration",
                    "Mode",
                    "State",
                    "Status",
                    "Quality",
                    "Actions",
                  ].map((h) => (
                    <th key={h} style={s.th}>
                      <div style={s.thInner}>{h}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, idx) => (
                  <tr
                    key={session.id}
                    style={{
                      ...s.tr,
                      background: idx % 2 === 0 ? "white" : "#f8fafc",
                    }}
                  >
                    {/* 1. Session ID */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          color: "#64748b",
                          background: "#f1f5f9",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {session.id.slice(0, 8)}
                      </span>
                    </td>
                    {/* 2. Response ID */}
                    <td style={s.td}>
                      {session.response_id ? (
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            color: "#2563eb",
                            background: "#eff6ff",
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          {session.response_id}
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                          —
                        </span>
                      )}
                    </td>
                    {/* 3. Country */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.82rem",
                          color: "#475569",
                          fontFamily: FONT,
                        }}
                      >
                        {session.proxy_country || "—"}
                      </span>
                    </td>
                    {/* 4. IP Address */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          color: "#475569",
                        }}
                      >
                        {session.ip_address || "—"}
                      </span>
                    </td>
                    {/* 5. Persona */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.82rem",
                          color: "#1e293b",
                          fontFamily: FONT,
                        }}
                      >
                        {session.persona_name || "—"}
                      </span>
                    </td>
                    {/* 6. Scenario */}
                    <td style={s.td}>
                      {session.scenario_name ? (
                        <span
                          style={{
                            background: "#f0f7ff",
                            color: "#1e3a5f",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            fontFamily: FONT,
                          }}
                        >
                          {session.scenario_name.slice(0, 20)}
                          {session.scenario_name.length > 20 ? "…" : ""}
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                          Default
                        </span>
                      )}
                    </td>
                    {/* 7. Device */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "#64748b",
                          fontFamily: FONT,
                        }}
                      >
                        {session.device_type
                          ? session.device_type.charAt(0).toUpperCase() +
                            session.device_type.slice(1)
                          : "—"}
                      </span>
                    </td>
                    {/* 8. Started */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "#94a3b8",
                          fontFamily: FONT,
                        }}
                      >
                        {fmtTime(session.started_at || session.created_at)}
                      </span>
                    </td>
                    {/* 9. Ended */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "#94a3b8",
                          fontFamily: FONT,
                        }}
                      >
                        {session.completed_at
                          ? fmtTime(session.completed_at)
                          : "—"}
                      </span>
                    </td>
                    {/* 10. Duration */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.82rem",
                          fontFamily: FONT,
                          fontWeight: [
                            "queued",
                            "initialising",
                            "in_progress",
                          ].includes(session.status)
                            ? 600
                            : 400,
                          color: [
                            "queued",
                            "initialising",
                            "in_progress",
                          ].includes(session.status)
                            ? "#2563eb"
                            : "#475569",
                        }}
                      >
                        {getLiveDuration(session)}
                      </span>
                    </td>
                    {/* 11. Mode */}
                    <td style={s.td}>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          background: session.internal_testing
                            ? "#fef3c7"
                            : "#dbeafe",
                          color: session.internal_testing
                            ? "#92400e"
                            : "#1e40af",
                          borderRadius: 20,
                          padding: "2px 8px",
                          fontFamily: FONT,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {session.internal_testing ? "🧪 Test" : "🌐 Live"}
                      </span>
                    </td>
                    {/* 12. State */}
                    <td style={s.td}>
                      <StatusBadge
                        status={session.status}
                        colors={SESSION_STATUS_COLORS}
                      />
                    </td>
                    {/* 13. Status / Outcome */}
                    <td style={s.td}>
                      {session.outcome ? (
                        <StatusBadge
                          status={session.outcome}
                          colors={SESSION_STATUS_COLORS}
                        />
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          —
                        </span>
                      )}
                    </td>
                    {/* 14. Quality */}
                    <td style={s.td}>
                      {session.quality_score != null ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              width: 40,
                              height: 5,
                              background: "#f1f5f9",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${session.quality_score}%`,
                                background:
                                  session.quality_score >= 70
                                    ? "#059669"
                                    : session.quality_score >= 40
                                      ? "#f59e0b"
                                      : "#ef4444",
                                borderRadius: 3,
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "#64748b",
                              fontFamily: FONT,
                            }}
                          >
                            {session.quality_score}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          —
                        </span>
                      )}
                    </td>
                    {/* 15. Actions */}
                    <td style={s.td}>
                      <div
                        style={{
                          display: "flex",
                          gap: 5,
                          alignItems: "center",
                        }}
                      >
                        <button
                          onClick={() => setViewSession(session.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            background: "#f0f7ff",
                            border: "1px solid #dbeafe",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            color: "#2563eb",
                            fontSize: "0.72rem",
                            fontFamily: FONT,
                            fontWeight: 600,
                          }}
                        >
                          <FileText size={11} /> View
                        </button>
                        {["queued", "initialising", "in_progress"].includes(
                          session.status,
                        ) && (
                          <button
                            onClick={() => handleStopOne(session.id)}
                            title="Stop this session"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              background: "#fff7ed",
                              border: "1px solid #fed7aa",
                              borderRadius: 6,
                              padding: "5px 7px",
                              cursor: "pointer",
                              color: "#c2410c",
                            }}
                          >
                            <StopCircle size={11} />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteOne(session.id)}
                            title="Delete this session"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              background: "#fef2f2",
                              border: "1px solid #fecaca",
                              borderRadius: 6,
                              padding: "5px 7px",
                              cursor: "pointer",
                              color: "#ef4444",
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 16,
              }}
            >
              <button
                onClick={() => {
                  setPage(1);
                  load(false, 1);
                }}
                disabled={page === 1}
                style={paginationBtn(page === 1)}
              >
                «
              </button>
              <button
                onClick={() => {
                  const p = page - 1;
                  setPage(p);
                  load(false, p);
                }}
                disabled={page === 1}
                style={paginationBtn(page === 1)}
              >
                ‹
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 7) pageNum = i + 1;
                else if (page <= 4) pageNum = i + 1;
                else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
                else pageNum = page - 3 + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => {
                      setPage(pageNum);
                      load(false, pageNum);
                    }}
                    style={{
                      ...paginationBtn(false),
                      background: pageNum === page ? "#1e3a5f" : "white",
                      color: pageNum === page ? "white" : "#475569",
                      borderColor: pageNum === page ? "#1e3a5f" : "#e2e8f0",
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => {
                  const p = page + 1;
                  setPage(p);
                  load(false, p);
                }}
                disabled={page === totalPages}
                style={paginationBtn(page === totalPages)}
              >
                ›
              </button>
              <button
                onClick={() => {
                  setPage(totalPages);
                  load(false, totalPages);
                }}
                disabled={page === totalPages}
                style={paginationBtn(page === totalPages)}
              >
                »
              </button>
              <span
                style={{
                  fontSize: "0.78rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                  marginLeft: 8,
                }}
              >
                Page {page} of {totalPages}
              </span>
            </div>
          )}
        </>
      )}
      {viewSession && (
        <SessionReportModal
          sessionId={viewSession}
          projectId={projectId}
          onClose={() => setViewSession(null)}
          showToast={showToast}
        />
      )}
      {showClearConfirm && (
        <ConfirmModal
          title="Clear All Sessions"
          message={`This will permanently delete <strong>all ${totalCount} session(s)</strong> for this project, including all events, screenshots, and logs.<br/><br/><strong>This cannot be undone.</strong>`}
          confirmLabel="Yes, Clear All Sessions"
          confirmColor="#ef4444"
          icon={Trash2}
          onConfirm={handleClearSessions}
          onCancel={() => setShowClearConfirm(false)}
          loading={clearing}
        />
      )}
      {showStopConfirm && (
        <ConfirmModal
          title="Stop All Running Sessions"
          message={`This will immediately terminate all <strong>queued and in-progress sessions</strong> for this project.<br/><br/>Already-running browser sessions will be marked as stopped. <strong>This cannot be undone.</strong>`}
          confirmLabel="Yes, Stop All Sessions"
          confirmColor="#c2410c"
          icon={StopCircle}
          onConfirm={handleStopSessions}
          onCancel={() => setShowStopConfirm(false)}
          loading={stopping}
        />
      )}
    </div>
  );
}

const paginationBtn = (disabled) => ({
  minWidth: 32,
  height: 32,
  border: "1.5px solid #e2e8f0",
  borderRadius: 6,
  background: "white",
  cursor: disabled ? "not-allowed" : "pointer",
  color: disabled ? "#cbd5e1" : "#475569",
  fontFamily: FONT,
  fontSize: "0.85rem",
  fontWeight: 500,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: disabled ? 0.5 : 1,
  padding: "0 8px",
});

// ══════════════════════════════════════════════════════════════════════════════
// COSTS TAB
// ══════════════════════════════════════════════════════════════════════════════
function CostsTab({ projectId, showToast }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/projects/${projectId}/costs`)
      .then((res) => setSummary(res.data.summary))
      .catch(() => showToast("Failed to load cost data", "error"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div style={s.tabCenter}>Loading cost data...</div>;

  const completed = parseInt(summary?.completed_sessions) || 0;
  const terminated = parseInt(summary?.terminated_sessions) || 0;
  const errors = parseInt(summary?.error_sessions) || 0;
  const active = parseInt(summary?.active_sessions) || 0;
  const total = parseInt(summary?.total_sessions) || 0;
  const target = parseInt(summary?.target_completes) || 0;
  const completionPct =
    target > 0 ? Math.min(Math.round((completed / target) * 100), 100) : 0;

  return (
    <div>
      <div style={s.statsGrid}>
        <StatCard
          label="URL Hits"
          value={total}
          icon={Activity}
          color="#f59e0b"
        />
        <StatCard
          label="Completes"
          value={completed}
          sub={`${completionPct}% of target`}
          icon={CheckCircle}
          color="#059669"
        />
        <StatCard
          label="Incompletes"
          value={active}
          sub="In progress or errored"
          icon={TrendingDown}
          color="#f97316"
        />
        <StatCard
          label="Terminates"
          value={terminated}
          sub="Screener fails + OQ"
          icon={StopCircle}
          color="#ef4444"
        />
      </div>
      {target > 0 && (
        <div style={s.progressCard}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "#1e293b",
                fontFamily: FONT,
              }}
            >
              Completion Progress
            </span>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#2563eb",
                fontFamily: FONT,
              }}
            >
              {completionPct}%
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "#f1f5f9",
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${completionPct}%`,
                background: "linear-gradient(90deg, #1e3a5f, #2563eb)",
                borderRadius: 4,
              }}
            />
          </div>
          <div
            style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT }}
          >
            {completed} of {target} target completes
          </div>
        </div>
      )}
      <div style={{ ...s.detailCard, marginBottom: 16 }}>
        <div style={s.detailCardTitle}>Session Breakdown</div>
        {[
          ["Total Sessions", total],
          ["Completed", completed],
          ["Terminated", terminated],
          ["Errors / Flagged", errors],
          ["Active / Running", active],
          ["Avg Duration", fmtDuration(summary?.avg_duration_s)],
          [
            "Avg Quality Score",
            summary?.avg_quality ? `${summary.avg_quality} / 100` : "—",
          ],
        ].map(([k, v]) => (
          <div key={k} style={s.detailRow}>
            <span style={s.detailKey}>{k}</span>
            <span style={s.detailVal}>{v}</span>
          </div>
        ))}
      </div>
      <div style={s.detailCard}>
        <div style={s.detailCardTitle}>Cost Breakdown</div>
        <div style={s.costNotice}>
          <DollarSign size={20} color="#94a3b8" />
          <div>
            <div
              style={{
                fontSize: "0.88rem",
                fontWeight: 600,
                color: "#1e293b",
                fontFamily: FONT,
                marginBottom: 4,
              }}
            >
              Pricing rates not configured
            </div>
            <div
              style={{
                fontSize: "0.82rem",
                color: "#64748b",
                fontFamily: FONT,
                lineHeight: 1.6,
              }}
            >
              Configurable in <strong>Settings → Billing</strong>.
            </div>
          </div>
        </div>
        {[
          ["AI Token Cost", "—", "Rate not configured"],
          ["Proxy Cost", "—", "Rate not configured"],
          ["Total Spend", "—", "Awaiting rate config"],
          ["Cost per Complete", "—", "Awaiting rate config"],
        ].map(([k, v, note]) => (
          <div key={k} style={s.detailRow}>
            <span style={s.detailKey}>{k}</span>
            <div style={{ textAlign: "right" }}>
              <span style={s.detailVal}>{v}</span>
              {note && (
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#94a3b8",
                    fontFamily: FONT,
                  }}
                >
                  {note}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ProjectDetail
// ══════════════════════════════════════════════════════════════════════════════
export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [autoRefreshSessions, setAutoRefreshSessions] = useState(false);
  const [sessionRefreshTrigger, setSessionRefreshTrigger] = useState(0);

  const showToast = (message, type = "success") => setToast({ message, type });

  const initForm = (p, svs) =>
    setEditForm({
      name: p.name || "",
      clientName: p.client_name || "",
      referenceId: p.reference_id || "",
      description: p.description || "",
      surveyPlatform: p.survey_platform || "unknown",
      targetCompletes: p.target_completes || 100,
      targetLoi: p.target_loi_minutes || 15,
      aiModeOpenend: p.ai_mode_openend || "ai",
      aiModeImage: p.ai_mode_image || "ai",
      aiStrategy: p.ai_strategy || "persona_true",
      proxyProvider: p.proxy_provider || "decodo",
      concurrentSessions: p.concurrent_sessions || 5,
      startDate: p.start_date ? p.start_date.split("T")[0] : "",
      endDate: p.end_date ? p.end_date.split("T")[0] : "",
      surveys:
        svs.length > 0
          ? svs
          : [
              {
                label: "Main",
                url: "",
                countries: [],
                languages: [],
                allocation: 1,
              },
            ],
    });

  const load = async () => {
    try {
      const res = await api.get(`/projects/${id}`);
      setProject(res.data.project);
      setSurveys(res.data.surveys || []);
      initForm(res.data.project, res.data.surveys || []);
    } catch {
      showToast("Failed to load project", "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [id]);

  const setF = (k, v) => setEditForm((f) => ({ ...f, [k]: v }));
  const handleSurveyChange = (i, k, v) => {
    const u = [...editForm.surveys];
    u[i] = { ...u[i], [k]: v };
    setF("surveys", u);
  };
  const addSurvey = () =>
    setF("surveys", [
      ...editForm.surveys,
      {
        label: `Variant ${editForm.surveys.length + 1}`,
        url: "",
        countries: [],
        languages: [],
        allocation: 0,
      },
    ]);
  const removeSurvey = (i) =>
    setF(
      "surveys",
      editForm.surveys.filter((_, idx) => idx !== i),
    );

  const doSave = async () => {
    setSaving(true);
    setShowSaveConfirm(false);
    try {
      const norm = (v) =>
        Array.isArray(v)
          ? v
          : v
            ? v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
            : [];
      const payload = {
        ...editForm,
        targetCompletes: parseInt(editForm.targetCompletes),
        targetLoi: parseInt(editForm.targetLoi),
        concurrentSessions: parseInt(editForm.concurrentSessions),
        surveys: editForm.surveys.map((sv) => ({
          ...sv,
          countries: norm(sv.countries),
          languages: norm(sv.languages),
          allocation: parseInt(sv.allocation) || 100,
        })),
      };
      await api.patch(`/projects/${id}`, payload);
      const fresh = await api.get(`/projects/${id}`);
      setProject(fresh.data.project);
      setSurveys(fresh.data.surveys || payload.surveys);
      showToast("Project saved successfully ✓");
      setActiveTab("overview");
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to save project", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await api.patch(`/projects/${id}`, { status: newStatus });
      const fresh = await api.get(`/projects/${id}`);
      setProject(fresh.data.project);
      showToast(`Status updated to ${formatLabel(newStatus)} ✓`);
    } catch {
      showToast("Failed to update status", "error");
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/projects/${id}`);
      navigate("/projects");
    } catch {
      showToast("Failed to delete project", "error");
      setDeleting(false);
      setShowDelete(false);
    }
  };

  if (loading)
    return (
      <Layout title="Project">
        <div
          style={{
            textAlign: "center",
            padding: 80,
            color: "#64748b",
            fontFamily: FONT,
          }}
        >
          Loading project...
        </div>
      </Layout>
    );
  if (!project)
    return (
      <Layout title="Project">
        <div
          style={{
            textAlign: "center",
            padding: 80,
            color: "#64748b",
            fontFamily: FONT,
          }}
        >
          Project not found.
        </div>
      </Layout>
    );

  const transitions = STATUS_TRANSITIONS[project.status] || [];
  const completionPct =
    project.target_completes > 0
      ? Math.min(
          Math.round(
            (project.total_completes / project.target_completes) * 100,
          ),
          100,
        )
      : 0;

  const tabStyle = (key) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    border: "none",
    borderBottom:
      activeTab === key ? "2px solid #1e3a5f" : "2px solid transparent",
    marginBottom: -2,
    background: activeTab === key ? "#f8fafc" : "transparent",
    cursor: "pointer",
    fontSize: "0.88rem",
    fontWeight: activeTab === key ? 700 : 500,
    color: activeTab === key ? "#1e3a5f" : "#64748b",
    fontFamily: FONT,
    transition: "all 0.15s",
  });

  const TABS = [
    { key: "overview", label: "Overview", icon: Eye },
    { key: "quota", label: "Quota", icon: Target },
    { key: "scenarios", label: "Scenarios", icon: Zap },
    { key: "sessions", label: "Sessions", icon: Activity },
    { key: "costs", label: "Costs", icon: DollarSign },
    { key: "edit", label: "Edit", icon: Edit2 },
  ];

  return (
    <Layout title={project.name}>
      <button style={s.backBtn} onClick={() => navigate("/projects")}>
        <ArrowLeft size={16} /> Back to Projects
      </button>

      <div style={s.pageHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 4,
            }}
          >
            {project.reference_id && (
              <span style={s.refId}>{project.reference_id} ::</span>
            )}
            <h1 style={s.pageTitle}>{project.name}</h1>
          </div>
          {project.client_name && (
            <div style={s.clientName}>{project.client_name}</div>
          )}
        </div>
        <div style={s.headerRight}>
          <StatusBadge status={project.status} large />
          {transitions.map(({ value, label }) => (
            <button
              key={value}
              style={s.transitionBtn}
              onClick={() => handleStatusChange(value)}
            >
              {label}
            </button>
          ))}
          {project.status === "active" && (
            <button style={s.runBtn} onClick={() => setShowRunModal(true)}>
              <Zap size={15} /> Run Sessions
            </button>
          )}
          <button
            style={s.deleteBtn}
            onClick={() => setShowDelete(true)}
            title="Delete project"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          borderBottom: "2px solid #f1f5f9",
          marginBottom: 24,
          gap: 2,
        }}
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            style={tabStyle(key)}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div>
          <div style={s.statsGrid}>
            <StatCard
              label="Target Completes"
              value={project.target_completes}
              icon={Users}
              color="#2563eb"
            />
            <StatCard
              label="URL Hits"
              value={project.session_count || 0}
              sub="Total survey attempts"
              icon={Activity}
              color="#f59e0b"
            />
            <StatCard
              label="Completes"
              value={project.total_completes || 0}
              sub={`${completionPct}% of target`}
              icon={CheckCircle}
              color="#059669"
            />
            <StatCard
              label="Target LOI"
              value={`${project.target_loi_minutes}m`}
              icon={Clock}
              color="#0891b2"
            />
          </div>
          {project.target_completes > 0 && (
            <div style={s.progressCard}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#1e293b",
                    fontFamily: FONT,
                  }}
                >
                  Quota Progress
                </span>
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    color: "#2563eb",
                    fontFamily: FONT,
                  }}
                >
                  {completionPct}%
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "#f1f5f9",
                  borderRadius: 4,
                  overflow: "hidden",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${completionPct}%`,
                    background: "linear-gradient(90deg, #1e3a5f, #2563eb)",
                    borderRadius: 4,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  fontFamily: FONT,
                }}
              >
                {project.total_completes || 0} of {project.target_completes}{" "}
                completes
              </div>
            </div>
          )}
          <div style={s.twoCol}>
            <div style={s.detailCard}>
              <div style={s.detailCardTitle}>Project Details</div>
              {[
                ["Reference ID", project.reference_id || "—"],
                ["Platform", formatLabel(project.survey_platform)],
                ["Open-End Mode", formatLabel(project.ai_mode_openend)],
                ["Image Mode", formatLabel(project.ai_mode_image)],
                ["AI Strategy", formatLabel(project.ai_strategy)],
                ["Proxy Provider", formatLabel(project.proxy_provider)],
                ["Concurrent Sessions", project.concurrent_sessions],
                ["Start Date", fmtDate(project.start_date)],
                ["End Date", fmtDate(project.end_date)],
                ["Created", fmtDate(project.created_at)],
                ["Owner", project.owner_name || "—"],
              ].map(([k, v]) => (
                <div key={k} style={s.detailRow}>
                  <span style={s.detailKey}>{k}</span>
                  <span style={s.detailVal}>{v}</span>
                </div>
              ))}
            </div>
            <div style={s.detailCard}>
              <div style={s.detailCardTitle}>
                Survey URLs ({surveys.length})
              </div>
              {surveys.length === 0 ? (
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.85rem",
                    fontFamily: FONT,
                  }}
                >
                  No survey URLs configured.
                </div>
              ) : (
                surveys.map((sv, i) => (
                  <SurveyCardReadOnly key={i} survey={sv} index={i} />
                ))
              )}
            </div>
          </div>
          {project.description && (
            <div style={{ ...s.detailCard, marginTop: 16 }}>
              <div style={s.detailCardTitle}>Description</div>
              <p
                style={{
                  fontSize: "0.88rem",
                  color: "#475569",
                  fontFamily: FONT,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {project.description}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "quota" && (
        <QuotaTab
          projectId={id}
          targetCompletes={project.target_completes}
          showToast={showToast}
        />
      )}
      {activeTab === "scenarios" && (
        <ScenariosTab projectId={id} showToast={showToast} />
      )}
      {activeTab === "sessions" && (
        <SessionsTab
          projectId={id}
          showToast={showToast}
          autoRefresh={autoRefreshSessions}
          refreshTrigger={sessionRefreshTrigger}
        />
      )}
      {activeTab === "costs" && (
        <CostsTab projectId={id} showToast={showToast} />
      )}

      {activeTab === "edit" && editForm && (
        <div style={s.editContainer}>
          <SectionHeader
            title="Project Details"
            subtitle="Update the core project configuration."
          />
          <FormGrid>
            <FullCol>
              <Input
                label="Project Name"
                required
                placeholder="Q3 Brand Tracker — India"
                value={editForm.name}
                onChange={(e) => setF("name", e.target.value)}
              />
            </FullCol>
            <Input
              label="Client Name"
              placeholder="Acme Corp"
              value={editForm.clientName}
              onChange={(e) => setF("clientName", e.target.value)}
            />
            <Input
              label="Reference ID"
              placeholder="INJXXX0000"
              value={editForm.referenceId}
              onChange={(e) => setF("referenceId", e.target.value)}
            />
            <FullCol>
              <Textarea
                label="Description"
                placeholder="Brief description..."
                rows={3}
                value={editForm.description}
                onChange={(e) => setF("description", e.target.value)}
              />
            </FullCol>
            <Select
              label="Survey Platform"
              options={toOptions(PLATFORMS)}
              value={editForm.surveyPlatform}
              onChange={(v) => setF("surveyPlatform", v)}
            />
            <NumberInput
              label="Target Completes"
              required
              min="1"
              value={editForm.targetCompletes}
              onChange={(e) => setF("targetCompletes", e.target.value)}
            />
            <NumberInput
              label="Target LOI"
              suffix="min"
              min="1"
              value={editForm.targetLoi}
              onChange={(e) => setF("targetLoi", e.target.value)}
            />
            <DateInput
              label="Start Date"
              value={editForm.startDate}
              onChange={(e) => setF("startDate", e.target.value)}
            />
            <DateInput
              label="End Date"
              value={editForm.endDate}
              onChange={(e) => setF("endDate", e.target.value)}
            />
          </FormGrid>
          <div style={s.editDivider} />
          <SectionHeader
            title="Survey URLs"
            subtitle="Update survey links and target countries."
            action={
              <button style={s.addBtn} onClick={addSurvey}>
                <Plus size={14} /> Add Variant
              </button>
            }
          />
          {editForm.surveys.map((sv, i) => (
            <SurveyCardEdit
              key={i}
              survey={sv}
              index={i}
              onChange={handleSurveyChange}
              onRemove={removeSurvey}
            />
          ))}
          <div style={s.editDivider} />
          <SectionHeader
            title="AI & Automation Settings"
            subtitle="Configure how the AI behaves during test sessions."
          />
          <FormGrid>
            <Select
              label="Open-End Mode"
              options={toOptions(AI_MODES)}
              value={editForm.aiModeOpenend}
              onChange={(v) => setF("aiModeOpenend", v)}
            />
            <Select
              label="Image Question Mode"
              options={toOptions(AI_MODES)}
              value={editForm.aiModeImage}
              onChange={(v) => setF("aiModeImage", v)}
            />
            <Select
              label="AI Strategy"
              options={toOptions(STRATEGIES)}
              value={editForm.aiStrategy}
              onChange={(v) => setF("aiStrategy", v)}
            />
            <Select
              label="Proxy Provider"
              options={toOptions(PROVIDERS)}
              value={editForm.proxyProvider}
              onChange={(v) => setF("proxyProvider", v)}
            />
            <NumberInput
              label="Concurrent Sessions"
              min="1"
              max="100"
              value={editForm.concurrentSessions}
              onChange={(e) => setF("concurrentSessions", e.target.value)}
            />
          </FormGrid>
          <div style={s.saveBar}>
            <button
              style={s.cancelBtnFull}
              onClick={() => {
                initForm(project, surveys);
                setActiveTab("overview");
              }}
            >
              Cancel
            </button>
            <button
              style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }}
              onClick={() => setShowSaveConfirm(true)}
              disabled={saving}
            >
              <Save size={16} /> {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {showDelete && (
        <ConfirmModal
          title="Delete Project"
          message={`Are you sure you want to delete <strong>"${project.name}"</strong>?<br/><br/>This will permanently delete all sessions, quota plans, and logs. <strong>This cannot be undone.</strong>`}
          confirmLabel="Yes, Delete Project"
          confirmColor="#ef4444"
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          loading={deleting}
        />
      )}
      {showSaveConfirm && (
        <ConfirmModal
          title="Save Changes"
          icon={Save}
          message="Are you sure you want to save the changes made to this project?"
          confirmLabel="Yes, Save Changes"
          confirmColor="#1e3a5f"
          onConfirm={doSave}
          onCancel={() => setShowSaveConfirm(false)}
          loading={saving}
        />
      )}
      {showRunModal && (
        <RunSessionsModal
          project={project}
          surveys={surveys}
          onClose={() => setShowRunModal(false)}
          onTriggered={() => {
            setShowRunModal(false);
            setActiveTab("sessions");
            setAutoRefreshSessions(true);
            setSessionRefreshTrigger((t) => t + 1);
            setTimeout(() => setAutoRefreshSessions(false), 60000);
            showToast("Sessions queued successfully ✓");
          }}
        />
      )}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </Layout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  backBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#64748b",
    fontSize: "0.85rem",
    fontFamily: FONT,
    padding: "0 0 14px 0",
    fontWeight: 500,
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  refId: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#2563eb",
    fontFamily: FONT,
    letterSpacing: 0.5,
  },
  pageTitle: {
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "#1e293b",
    fontFamily: FONT,
    margin: 0,
  },
  clientName: { fontSize: "0.85rem", color: "#64748b", fontFamily: FONT },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  transitionBtn: {
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    padding: "7px 14px",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
    fontFamily: FONT,
  },
  runBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#059669",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: "0.88rem",
    fontWeight: 700,
    cursor: "pointer",
    color: "white",
    fontFamily: FONT,
    boxShadow: "0 2px 8px rgba(5,150,105,0.3)",
  },
  deleteBtn: {
    display: "flex",
    alignItems: "center",
    background: "#fef2f2",
    border: "1.5px solid #fecaca",
    borderRadius: 8,
    padding: "7px 10px",
    cursor: "pointer",
    color: "#ef4444",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 20,
  },
  statCard: {
    background: "white",
    borderRadius: 12,
    padding: "18px 16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #f1f5f9",
  },
  progressCard: {
    background: "white",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #f1f5f9",
    marginBottom: 20,
  },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  detailCard: {
    background: "white",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #f1f5f9",
  },
  detailCardTitle: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#94a3b8",
    fontFamily: FONT,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid #f1f5f9",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "7px 0",
    borderBottom: "1px solid #f8fafc",
  },
  detailKey: {
    fontSize: "0.8rem",
    color: "#94a3b8",
    fontFamily: FONT,
    fontWeight: 500,
  },
  detailVal: {
    fontSize: "0.82rem",
    color: "#1e293b",
    fontFamily: FONT,
    fontWeight: 500,
    textAlign: "right",
  },
  surveyCard: {
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  surveyCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  surveyNum: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "#1e3a5f",
    fontFamily: FONT,
  },
  removeBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    color: "#ef4444",
    fontSize: "0.78rem",
    fontWeight: 600,
    fontFamily: FONT,
  },
  miniChip: {
    background: "#dbeafe",
    color: "#1e3a5f",
    borderRadius: 6,
    padding: "2px 7px",
    fontSize: "0.72rem",
    fontWeight: 600,
    fontFamily: FONT,
  },
  editContainer: {
    background: "white",
    borderRadius: 12,
    padding: 28,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #f1f5f9",
  },
  editDivider: { height: 1, background: "#f1f5f9", margin: "24px 0" },
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#f0f7ff",
    border: "1.5px solid #dbeafe",
    borderRadius: 6,
    padding: "7px 14px",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "#1e3a5f",
    fontFamily: FONT,
  },
  saveBar: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 28,
    paddingTop: 20,
    borderTop: "1px solid #f1f5f9",
  },
  saveBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#1e3a5f",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  cancelBtnFull: {
    background: "none",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: "0.88rem",
    cursor: "pointer",
    color: "#64748b",
    fontWeight: 500,
    fontFamily: FONT,
  },
  primaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#1e3a5f",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "9px 18px",
    fontSize: "0.88rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  tabCenter: {
    textAlign: "center",
    padding: "60px 0",
    color: "#64748b",
    fontFamily: FONT,
  },
  quotaSummaryBar: {
    display: "flex",
    justifyContent: "space-between",
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 16px",
    marginBottom: 16,
  },
  emptyQuota: {
    background: "white",
    borderRadius: 12,
    padding: "60px 40px",
    textAlign: "center",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #f1f5f9",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  dimCard: {
    background: "white",
    borderRadius: 12,
    padding: 20,
    border: "1.5px solid #e2e8f0",
    marginBottom: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  dimHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  dimNameInput: {
    width: "100%",
    padding: "9px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.9rem",
    fontWeight: 600,
    fontFamily: FONT,
    color: "#1e293b",
    outline: "none",
  },
  dimRemoveBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    color: "#ef4444",
    fontSize: "0.78rem",
    fontWeight: 600,
    fontFamily: FONT,
    whiteSpace: "nowrap",
  },
  quotaTable: { width: "100%", borderCollapse: "collapse", marginBottom: 12 },
  quotaTH: {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#94a3b8",
    fontFamily: FONT,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: "1.5px solid #f1f5f9",
  },
  quotaTD: { padding: "8px 6px", verticalAlign: "middle" },
  quotaInput: {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: "0.85rem",
    fontFamily: FONT,
    color: "#1e293b",
    outline: "none",
    width: "100%",
  },
  addValueBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#f0f7ff",
    border: "1.5px solid #dbeafe",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "#1e3a5f",
    fontFamily: FONT,
  },
  rowRemoveBtn: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "4px 6px",
    cursor: "pointer",
    color: "#ef4444",
    display: "flex",
    alignItems: "center",
  },
  sectionH: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#1e293b",
    fontFamily: FONT,
    marginBottom: 4,
  },
  sectionP: { fontSize: "0.82rem", color: "#64748b", fontFamily: FONT },
  sessionStatsRow: {
    display: "flex",
    gap: 0,
    background: "white",
    border: "1.5px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
  },
  sessionStat: {
    flex: 1,
    padding: "14px 12px",
    textAlign: "center",
    borderRight: "1px solid #f1f5f9",
  },
  sessionFilters: {
    display: "flex",
    gap: 10,
    marginBottom: 14,
    flexWrap: "wrap",
    alignItems: "center",
  },
  filterSel: {
    padding: "8px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.85rem",
    fontFamily: FONT,
    color: "#1e293b",
    outline: "none",
    background: "white",
  },
  refreshBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
    fontFamily: FONT,
  },
  tableWrap: {
    background: "white",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1.5px solid #e2e8f0",
    overflow: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 960 },
  theadRow: { background: "#f8fafc", borderBottom: "2px solid #e2e8f0" },
  th: { padding: "12px 14px", textAlign: "left", whiteSpace: "nowrap" },
  thInner: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#374151",
    fontFamily: FONT,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tr: { borderBottom: "1px solid #f1f5f9", transition: "background 0.1s" },
  td: { padding: "11px 14px", verticalAlign: "middle" },
  costNotice: {
    display: "flex",
    gap: 14,
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 16,
    alignItems: "flex-start",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 20,
  },
};
