import React, { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";

const FONT =
  "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
const PROVIDERS = ["decodo", "brightdata", "oxylabs", "iproyal", "custom"]; // decodo first

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
        color: isErr ? "#dc2626" : "#166534",
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

// ─── Run Sessions Modal — defined OUTSIDE ProjectDetail ───────────────────────
function RunSessionsModal({ project, onClose, onTriggered }) {
  const [count, setCount] = useState(5);
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setError("");
    setLoading(true);
    try {
      await api.post("/sessions/trigger", {
        projectId: project.id,
        count: parseInt(count),
        proxyCountry: country || null,
      });
      onTriggered();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to trigger sessions");
    } finally {
      setLoading(false);
    }
  };

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

        <div style={{ marginBottom: 14 }}>
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
              fontSize: "0.75rem",
              color: "#94a3b8",
              fontFamily: FONT,
              marginTop: 4,
            }}
          >
            Max 20 per trigger. Project concurrent limit:{" "}
            {project.concurrent_sessions}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
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
            Proxy Country (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. IN, US, GB — leave blank for auto"
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
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </div>

        <div
          style={{
            background: "#f0f7ff",
            border: "1.5px solid #dbeafe",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: "0.82rem",
            color: "#1e3a5f",
            fontFamily: FONT,
            lineHeight: 1.7,
          }}
        >
          <strong>Survey:</strong> {formatLabel(project.survey_platform)} —{" "}
          {project.name}
          <br />
          <strong>Proxy:</strong> Decodo Residential
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
            <Zap size={16} /> {loading ? "Queuing..." : `Run ${count} Sessions`}
          </button>
        </div>
      </div>
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
          {survey.allocation}% allocation
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
  const countryOptions = [
    { value: "IN", label: "🇮🇳 India" },
    { value: "US", label: "🇺🇸 United States" },
    { value: "GB", label: "🇬🇧 United Kingdom" },
    { value: "AU", label: "🇦🇺 Australia" },
    { value: "CA", label: "🇨🇦 Canada" },
    { value: "DE", label: "🇩🇪 Germany" },
    { value: "FR", label: "🇫🇷 France" },
    { value: "SG", label: "🇸🇬 Singapore" },
    { value: "AE", label: "🇦🇪 UAE" },
    { value: "JP", label: "🇯🇵 Japan" },
    { value: "BR", label: "🇧🇷 Brazil" },
    { value: "MX", label: "🇲🇽 Mexico" },
    { value: "ZA", label: "🇿🇦 South Africa" },
    { value: "NG", label: "🇳🇬 Nigeria" },
    { value: "ID", label: "🇮🇩 Indonesia" },
    { value: "PH", label: "🇵🇭 Philippines" },
  ];
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
          label="Allocation %"
          min="0"
          max="100"
          suffix="%"
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
          label="Target Countries"
          isMulti
          options={countryOptions}
          value={norm(survey.countries)}
          onChange={set("countries")}
          placeholder="Select countries..."
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

      {dimensions.length > 0 && (
        <div style={s.saveBar}>
          <button
            style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }}
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={16} /> {saving ? "Saving..." : "Save Quota Plan"}
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSIONS TAB
// ══════════════════════════════════════════════════════════════════════════════
function SessionsTab({ projectId, showToast }) {
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({
    status: "",
    outcome: "",
    country: "",
  });

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.append("status", filters.status);
        if (filters.outcome) params.append("outcome", filters.outcome);
        if (filters.country) params.append("country", filters.country);
        const res = await api.get(`/projects/${projectId}/sessions?${params}`);
        setSessions(res.data.sessions || []);
        setStats(res.data.stats || null);
      } catch {
        showToast("Failed to load sessions", "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, filters],
  );

  useEffect(() => {
    load();
  }, [load]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
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
          <option value="">All Statuses</option>
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
        <input
          style={s.filterSel}
          placeholder="Country code (e.g. IN)"
          value={filters.country}
          onChange={(e) => setF("country", e.target.value)}
        />
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
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div style={s.emptyQuota}>
          <Activity size={48} color="#cbd5e1" />
          <h4
            style={{ fontFamily: FONT, color: "#1e293b", margin: "12px 0 6px" }}
          >
            No Sessions Yet
          </h4>
          <p
            style={{ fontFamily: FONT, color: "#64748b", fontSize: "0.88rem" }}
          >
            Sessions will appear here once bot runs are triggered.
          </p>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr style={s.theadRow}>
                {[
                  "Session ID",
                  "Status",
                  "Persona",
                  "Country",
                  "Device",
                  "Duration",
                  "Quality",
                  "Outcome",
                  "Started",
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
                  <td style={s.td}>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: "0.78rem",
                        color: "#64748b",
                        background: "#f1f5f9",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {session.id.slice(0, 8)}
                    </span>
                  </td>
                  <td style={s.td}>
                    <StatusBadge
                      status={session.status}
                      colors={SESSION_STATUS_COLORS}
                    />
                  </td>
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
                  <td style={s.td}>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        color: "#64748b",
                        fontFamily: FONT,
                      }}
                    >
                      {session.device_type || "—"}
                    </span>
                  </td>
                  <td style={s.td}>
                    <span
                      style={{
                        fontSize: "0.82rem",
                        color: "#475569",
                        fontFamily: FONT,
                      }}
                    >
                      {fmtDuration(session.total_duration_s)}
                    </span>
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
              Cost per AI token, proxy bandwidth rate, and other pricing will be
              configurable in
              <strong> Settings → Billing</strong>. Once configured, cost per
              session, cost per complete, and total project spend will be
              calculated automatically.
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
  const [showRunModal, setShowRunModal] = useState(false); // ← correct location
  const [toast, setToast] = useState(null);
  const [editForm, setEditForm] = useState(null);

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
                allocation: 100,
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
    const updated = [...editForm.surveys];
    updated[i] = { ...updated[i], [k]: v };
    setF("surveys", updated);
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
      const res = await api.patch(`/projects/${id}`, payload);
      setProject(res.data.project);
      setSurveys(payload.surveys);
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
      const res = await api.patch(`/projects/${id}`, { status: newStatus });
      setProject(res.data.project);
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
    project.total_target > 0
      ? Math.min(
          Math.round((project.total_completes / project.total_target) * 100),
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
          <button style={s.runBtn} onClick={() => setShowRunModal(true)}>
            <Zap size={15} /> Run Sessions
          </button>
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
              icon={Activity}
              color="#f59e0b"
              sub="Total survey attempts"
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

          {project.total_target > 0 && (
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
                {project.total_completes || 0} of {project.total_target}{" "}
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
      {activeTab === "sessions" && (
        <SessionsTab projectId={id} showToast={showToast} />
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
          onClose={() => setShowRunModal(false)}
          onTriggered={() => {
            setShowRunModal(false);
            setActiveTab("sessions");
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
    padding: "7px 14px",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    color: "white",
    fontFamily: FONT,
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
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
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
  tr: { borderBottom: "1px solid #f1f5f9" },
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
