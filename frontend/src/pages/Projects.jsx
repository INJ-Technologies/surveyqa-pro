import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import api from "../api";
import { useCountries } from "../hooks/useCountries";
import {
  FolderKanban,
  Plus,
  X,
  Globe,
  ChevronRight,
  Clock,
  Users,
  Activity,
  AlertCircle,
} from "lucide-react";
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

const FONT =
  "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Format option labels ─────────────────────────────────────────────────────
const formatLabel = (str) => {
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

// ─── Options ──────────────────────────────────────────────────────────────────
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

const toOptions = (arr) =>
  arr.map((v) => ({ value: v, label: formatLabel(v) }));

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  draft: { bg: "#f1f5f9", text: "#64748b" },
  review: { bg: "#fef3c7", text: "#92400e" },
  active: { bg: "#dcfce7", text: "#166534" },
  paused: { bg: "#fce7f3", text: "#9d174d" },
  completed: { bg: "#dbeafe", text: "#1e40af" },
  archived: { bg: "#f1f5f9", text: "#94a3b8" },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.text }}>
      {formatLabel(status)}
    </span>
  );
}

// ─── Survey URL Card ──────────────────────────────────────────────────────────
function SurveyCard({ survey, index, onChange, onRemove }) {
  const set = (k) => (val) => onChange(index, k, val);
  const setVal = (k) => (e) => onChange(index, k, e.target.value);

  const { asOptions: countryOptions, loading: countriesLoading } = useCountries();

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

  const normaliseArr = (v) =>
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
          label={countriesLoading ? "Target Countries (loading...)" : `Target Countries (${countryOptions.length})`}
          isMulti
          options={countryOptions}
          value={normaliseArr(survey.countries)}
          onChange={set("countries")}
          placeholder="Search and select countries..."
        />
        <Select
          label="Languages"
          isMulti
          options={languageOptions}
          value={normaliseArr(survey.languages)}
          onChange={set("languages")}
          placeholder="Select languages..."
        />
      </FormGrid>
    </div>
  );
}

// ─── Create Project Modal ─────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    clientName: "",
    referenceId: "",
    description: "",
    surveyPlatform: "unknown",
    targetCompletes: 100,
    targetLoi: 15,
    aiModeOpenend: "ai",
    aiModeImage: "ai",
    aiStrategy: "persona_true",
    proxyProvider: "brightdata",
    concurrentSessions: 5,
    startDate: "",
    endDate: "",
    surveys: [
      { label: "Main", url: "", countries: [], languages: [], allocation: 100 },
    ],
  });

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSurveyChange = (i, k, v) => {
    const surveys = [...form.surveys];
    surveys[i] = { ...surveys[i], [k]: v };
    setForm((f) => ({ ...f, surveys }));
  };

  const addSurvey = () =>
    setForm((f) => ({
      ...f,
      surveys: [
        ...f.surveys,
        {
          label: `Variant ${f.surveys.length + 1}`,
          url: "",
          countries: [],
          languages: [],
          allocation: 0,
        },
      ],
    }));

  const removeSurvey = (i) =>
    setForm((f) => ({
      ...f,
      surveys: f.surveys.filter((_, idx) => idx !== i),
    }));

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const normaliseArr = (v) =>
        Array.isArray(v)
          ? v
          : v
            ? v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
            : [];
      const payload = {
        ...form,
        targetCompletes: parseInt(form.targetCompletes),
        targetLoi: parseInt(form.targetLoi),
        concurrentSessions: parseInt(form.concurrentSessions),
        surveys: form.surveys.map((sv) => ({
          ...sv,
          countries: normaliseArr(sv.countries),
          languages: normaliseArr(sv.languages),
          allocation: parseInt(sv.allocation) || 100,
        })),
      };
      const res = await api.post("/projects", payload);
      onCreated(res.data.project);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>New Project</h2>
            <p style={s.modalSub}>
              Step {step} of 2 —{" "}
              {step === 1 ? "Project Details" : "Survey URLs & Settings"}
            </p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div style={s.progress}>
          <div style={{ ...s.progressBar, width: `${step * 50}%` }} />
        </div>

        <div style={s.modalBody}>
          {/* ── Step 1 ── */}
          {step === 1 && (
            <FormGrid>
              <FullCol>
                <Input
                  label="Project Name"
                  required
                  placeholder="Q3 Brand Tracker — India"
                  value={form.name}
                  onChange={(e) => setF("name", e.target.value)}
                />
              </FullCol>
              <Input
                label="Client Name"
                placeholder="Acme Corp"
                value={form.clientName}
                onChange={(e) => setF("clientName", e.target.value)}
              />
              <Input
                label="Reference ID"
                placeholder="INJXXX0000"
                value={form.referenceId}
                onChange={(e) => setF("referenceId", e.target.value)}
              />
              <FullCol>
                <Textarea
                  label="Description"
                  placeholder="Brief description of this project..."
                  rows={3}
                  value={form.description}
                  onChange={(e) => setF("description", e.target.value)}
                />
              </FullCol>
              <Select
                label="Survey Platform"
                options={toOptions(PLATFORMS)}
                value={form.surveyPlatform}
                onChange={(v) => setF("surveyPlatform", v)}
              />
              <NumberInput
                label="Target Completes"
                required
                min="1"
                value={form.targetCompletes}
                onChange={(e) => setF("targetCompletes", e.target.value)}
              />
              <NumberInput
                label="Target LOI"
                suffix="min"
                min="1"
                value={form.targetLoi}
                onChange={(e) => setF("targetLoi", e.target.value)}
              />
              <DateInput
                label="Start Date"
                value={form.startDate}
                onChange={(e) => setF("startDate", e.target.value)}
              />
              <DateInput
                label="End Date"
                value={form.endDate}
                onChange={(e) => setF("endDate", e.target.value)}
              />
            </FormGrid>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div>
              <SectionHeader
                title="Survey URLs"
                subtitle="Add one or more survey links. Use variants for A/B testing."
                action={
                  <button style={s.addBtn} onClick={addSurvey}>
                    <Plus size={14} /> Add Variant
                  </button>
                }
              />
              {form.surveys.map((survey, i) => (
                <SurveyCard
                  key={i}
                  survey={survey}
                  index={i}
                  onChange={handleSurveyChange}
                  onRemove={removeSurvey}
                />
              ))}
              <div style={{ marginTop: 28 }}>
                <SectionHeader
                  title="AI & Automation Settings"
                  subtitle="Configure how the AI behaves during test sessions."
                />
                <FormGrid>
                  <Select
                    label="Open-End Mode"
                    options={toOptions(AI_MODES)}
                    value={form.aiModeOpenend}
                    onChange={(v) => setF("aiModeOpenend", v)}
                  />
                  <Select
                    label="Image Question Mode"
                    options={toOptions(AI_MODES)}
                    value={form.aiModeImage}
                    onChange={(v) => setF("aiModeImage", v)}
                  />
                  <Select
                    label="AI Strategy"
                    options={toOptions(STRATEGIES)}
                    value={form.aiStrategy}
                    onChange={(v) => setF("aiStrategy", v)}
                  />
                  <Select
                    label="Proxy Provider"
                    options={toOptions(PROVIDERS)}
                    value={form.proxyProvider}
                    onChange={(v) => setF("proxyProvider", v)}
                  />
                  <NumberInput
                    label="Concurrent Sessions"
                    min="1"
                    max="100"
                    value={form.concurrentSessions}
                    onChange={(e) => setF("concurrentSessions", e.target.value)}
                  />
                </FormGrid>
              </div>
            </div>
          )}

          {error && (
            <div style={s.error}>
              <AlertCircle size={16} /> {error}
            </div>
          )}
        </div>

        <div style={s.modalFooter}>
          {step === 1 ? (
            <>
              <button style={s.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button
                style={s.nextBtn}
                onClick={() => {
                  if (!form.name) {
                    setError("Project name is required");
                    return;
                  }
                  setError("");
                  setStep(2);
                }}
              >
                Next — Survey URLs →
              </button>
            </>
          ) : (
            <>
              <button style={s.cancelBtn} onClick={() => setStep(1)}>
                ← Back
              </button>
              <button
                style={{ ...s.nextBtn, opacity: loading ? 0.7 : 1 }}
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? "Creating..." : "Create Project"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick }) {
  return (
    <div style={s.card} onClick={onClick}>
      <div style={s.cardTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.cardTitleRow}>
            {project.reference_id && (
              <span style={s.cardRef}>{project.reference_id} :: </span>
            )}
            <span style={s.cardTitle}>{project.name}</span>
          </div>
          {project.client_name && (
            <div style={s.cardClient}>{project.client_name}</div>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      {project.description && <p style={s.cardDesc}>{project.description}</p>}

      <div style={s.cardMeta}>
        <span style={s.metaItem}>
          <Globe size={13} /> {formatLabel(project.survey_platform)}
        </span>
        <span style={s.metaItem}>
          <Users size={13} /> {project.total_completes || 0} /{" "}
          {project.target_completes}
        </span>
        <span style={s.metaItem}>
          <Activity size={13} /> {project.session_count || 0} sessions
        </span>
        <span style={s.metaItem}>
          <Clock size={13} /> {project.target_loi_minutes}m LOI
        </span>
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardDate}>
          Created{" "}
          {new Date(project.created_at).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <ChevronRight size={16} color="#94a3b8" />
      </div>
    </div>
  );
}

// ─── Main Projects Page ───────────────────────────────────────────────────────
export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/projects");
      setProjects(res.data?.projects || []);
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clientNames = [
    ...new Set(projects.map((p) => p.client_name).filter(Boolean)),
  ];
  const activeStatuses = [
    ...new Set(projects.map((p) => p.status).filter(Boolean)),
  ];

  const filtered = (projects || []).filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.client_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.reference_id || "").toLowerCase().includes(search.toLowerCase());
    const matchClient = clientFilter ? p.client_name === clientFilter : true;
    const matchStatus = statusFilter ? p.status === statusFilter : true;
    return matchSearch && matchClient && matchStatus;
  });

  const hasFilters = search || clientFilter || statusFilter;
  const clearAll = () => {
    setSearch("");
    setClientFilter("");
    setStatusFilter("");
  };

  return (
    <Layout title="Projects">
      {/* Toolbar */}
      <div style={s.toolbar}>
        <input
          style={s.search}
          placeholder="Search by name, client or reference ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={s.filterSelect}
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="">All Clients</option>
          {clientNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          style={s.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          {activeStatuses.map((st) => (
            <option key={st} value={st}>
              {formatLabel(st)}
            </option>
          ))}
        </select>
        <button style={s.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Project
        </button>
      </div>

      {/* Results bar */}
      {!loading && projects.length > 0 && (
        <div style={s.resultsBar}>
          Showing {filtered.length} of {projects.length} project
          {projects.length !== 1 ? "s" : ""}
          {hasFilters && (
            <button style={s.clearBtn} onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={s.center}>Loading projects...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <FolderKanban size={52} color="#cbd5e1" />
          <h3 style={s.emptyTitle}>
            {hasFilters ? "No projects match your filters" : "No Projects Yet"}
          </h3>
          <p style={s.emptyDesc}>
            {hasFilters
              ? "Try adjusting your search or filters."
              : "Create your first survey testing project to get started."}
          </p>
          {hasFilters ? (
            <button style={s.cancelBtn} onClick={clearAll}>
              Clear all filters
            </button>
          ) : (
            <button style={s.createBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Project
            </button>
          )}
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => navigate(`/projects/${p.id}`)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreated={(project) => setProjects((prev) => [project, ...prev])}
        />
      )}
    </Layout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  toolbar: {
    display: "flex",
    gap: 12,
    marginBottom: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  search: {
    flex: 1,
    minWidth: 200,
    padding: "10px 16px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.88rem",
    outline: "none",
    background: "white",
    color: "#1e293b",
    fontFamily: FONT,
  },
  filterSelect: {
    padding: "10px 14px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.88rem",
    outline: "none",
    background: "white",
    color: "#1e293b",
    cursor: "pointer",
    minWidth: 150,
    fontFamily: FONT,
  },
  createBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#1e3a5f",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: FONT,
  },
  resultsBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: "0.8rem",
    color: "#94a3b8",
    marginBottom: 16,
    fontFamily: FONT,
  },
  clearBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: "0.8rem",
    cursor: "pointer",
    fontWeight: 600,
    fontFamily: FONT,
    padding: 0,
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: 16,
  },
  card: {
    background: "linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%)",
    borderRadius: 12,
    padding: 22,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(30,58,95,0.08)",
    border: "1.5px solid #dbeafe",
    transition: "all 0.15s",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 12,
  },
  cardTitleRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 2,
    marginBottom: 3,
  },
  cardRef: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#2563eb",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    fontFamily: FONT,
  },
  cardTitle: {
    fontSize: "0.95rem",
    fontWeight: 700,
    color: "#1e3a5f",
    fontFamily: FONT,
  },
  cardClient: {
    fontSize: "0.78rem",
    color: "#64748b",
    marginTop: 3,
    fontFamily: FONT,
  },
  cardDesc: {
    fontSize: "0.82rem",
    color: "#64748b",
    lineHeight: 1.5,
    marginBottom: 14,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    fontFamily: FONT,
  },
  cardMeta: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  metaItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: "0.78rem",
    color: "#64748b",
    fontFamily: FONT,
  },
  cardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid #dbeafe",
    paddingTop: 12,
  },
  cardDate: { fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT },
  badge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: "0.72rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
    fontFamily: FONT,
  },

  center: {
    textAlign: "center",
    padding: 60,
    color: "#64748b",
    fontFamily: FONT,
  },
  empty: {
    background: "white",
    borderRadius: 12,
    padding: "80px 40px",
    textAlign: "center",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#1e293b",
    fontFamily: FONT,
  },
  emptyDesc: {
    color: "#64748b",
    fontSize: "0.9rem",
    marginBottom: 8,
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
  modal: {
    background: "white",
    borderRadius: 16,
    width: "100%",
    maxWidth: 700,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "24px 28px 0",
  },
  modalTitle: {
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "#1e293b",
    marginBottom: 4,
    fontFamily: FONT,
  },
  modalSub: { fontSize: "0.82rem", color: "#64748b", fontFamily: FONT },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#64748b",
    padding: 4,
  },
  progress: { height: 3, background: "#f1f5f9", margin: "16px 28px 0" },
  progressBar: {
    height: "100%",
    background: "#1e3a5f",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  modalBody: { flex: 1, overflowY: "auto", padding: "24px 28px" },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    padding: "16px 28px",
    borderTop: "1px solid #f1f5f9",
  },

  surveyCard: {
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: 18,
    marginBottom: 14,
  },
  surveyCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
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

  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#dc2626",
    fontSize: "0.85rem",
    marginTop: 16,
    fontFamily: FONT,
  },
  cancelBtn: {
    background: "none",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    padding: "9px 20px",
    fontSize: "0.88rem",
    cursor: "pointer",
    color: "#64748b",
    fontWeight: 500,
    fontFamily: FONT,
  },
  nextBtn: {
    background: "#1e3a5f",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "9px 24px",
    fontSize: "0.88rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};
