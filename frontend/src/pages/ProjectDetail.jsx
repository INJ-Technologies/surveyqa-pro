import React, { useState, useEffect } from "react";
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
  };
  if (overrides[str]) return overrides[str];
  return str
    .split("_")
    .map((w) =>
      w.toUpperCase() === "AI" ? "AI" : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
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
const PROVIDERS = ["brightdata", "oxylabs", "smartproxy", "iproyal", "custom"];

const STATUS_COLORS = {
  draft: { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" },
  review: { bg: "#fef3c7", text: "#92400e", border: "#fde68a" },
  active: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  paused: { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  completed: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  archived: { bg: "#f1f5f9", text: "#94a3b8", border: "#e2e8f0" },
};

const STATUS_TRANSITIONS = {
  draft: [
    { value: "review", label: "Submit for Review" },
    { value: "active", label: "Launch Now" },
  ],
  review: [
    { value: "active", label: "Approve & Launch" },
    { value: "draft", label: "Send Back to Draft" },
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
function StatusBadge({ status, large }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      style={{
        background: c.bg,
        color: c.text,
        border: `1.5px solid ${c.border}`,
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
  const isError = type === "error";
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
        background: isError ? "#fef2f2" : "#f0fdf4",
        border: `1.5px solid ${isError ? "#fca5a5" : "#86efac"}`,
        borderRadius: 10,
        padding: "12px 18px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        fontFamily: FONT,
        fontSize: "0.88rem",
        color: isError ? "#dc2626" : "#166534",
        fontWeight: 500,
      }}
    >
      {isError ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
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
          <Trash2 size={24} color={confirmColor} />
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

// ─── Main ProjectDetail Page ──────────────────────────────────────────────────
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
      proxyProvider: p.proxy_provider || "brightdata",
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
      setSurveys(payload.surveys); // ← ADD THIS LINE
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

  // ─── Tab style helper — no spread conflict ────────────────────────────────
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

  return (
    <Layout title={project.name}>
      {/* Back */}
      <button style={s.backBtn} onClick={() => navigate("/projects")}>
        <ArrowLeft size={16} /> Back to Projects
      </button>

      {/* Header */}
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
          <button
            style={s.deleteBtn}
            onClick={() => setShowDelete(true)}
            title="Delete project"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Tabs — inline styles, no spread */}
      <div
        style={{
          display: "flex",
          borderBottom: "2px solid #f1f5f9",
          marginBottom: 24,
          gap: 4,
        }}
      >
        <button
          style={tabStyle("overview")}
          onClick={() => setActiveTab("overview")}
        >
          <Eye size={15} /> Overview
        </button>
        <button style={tabStyle("edit")} onClick={() => setActiveTab("edit")}>
          <Edit2 size={15} /> Edit Project
        </button>
      </div>

      {/* ══════════════ OVERVIEW ══════════════ */}
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
              label="Sessions Run"
              value={project.session_count || 0}
              icon={Activity}
              color="#7c3aed"
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
                [
                  "Start Date",
                  project.start_date
                    ? new Date(project.start_date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—",
                ],
                [
                  "End Date",
                  project.end_date
                    ? new Date(project.end_date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—",
                ],
                [
                  "Created",
                  new Date(project.created_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                ],
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

      {/* ══════════════ EDIT ══════════════ */}
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

      {/* Delete confirm */}
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

      {/* Save confirm */}
      {showSaveConfirm && (
        <ConfirmModal
          title="Save Changes"
          message="Are you sure you want to save the changes made to this project?"
          confirmLabel="Yes, Save Changes"
          confirmColor="#1e3a5f"
          onConfirm={doSave}
          onCancel={() => setShowSaveConfirm(false)}
          loading={saving}
        />
      )}

      {/* Toast */}
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
