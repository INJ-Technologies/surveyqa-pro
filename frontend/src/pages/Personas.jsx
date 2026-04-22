import React, { useState, useEffect, useRef } from "react";
import Layout from "../components/Layout";
import api from "../api";
import {
  Textarea,
  NumberInput,
  FormGrid,
  FullCol,
  SectionHeader,
} from "../components/FormElements";
import {
  Users,
  Plus,
  X,
  Monitor,
  Smartphone,
  Tablet,
  AlertCircle,
  Trash2,
  Search,
  ChevronUp,
  ChevronDown,
  Pencil,
  Copy,
} from "lucide-react";

const FONT =
  "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Options ──────────────────────────────────────────────────────────────────
const GENDER_LIST = ["Male", "Female", "Non-Binary", "Any"];
const COUNTRY_LIST = [
  "🇮🇳 India",
  "🇺🇸 United States",
  "🇬🇧 United Kingdom",
  "🇦🇺 Australia",
  "🇨🇦 Canada",
  "🇩🇪 Germany",
  "🇫🇷 France",
  "🇸🇬 Singapore",
  "🇦🇪 UAE",
  "🇯🇵 Japan",
  "🇧🇷 Brazil",
  "🇲🇽 Mexico",
  "🇿🇦 South Africa",
  "🇳🇬 Nigeria",
  "🇮🇩 Indonesia",
  "🇵🇭 Philippines",
  "🇲🇾 Malaysia",
  "🇹🇭 Thailand",
  "🇻🇳 Vietnam",
  "🇰🇷 South Korea",
  "🇨🇳 China",
];
const LANGUAGE_LIST = [
  "English",
  "Hindi",
  "German",
  "French",
  "Spanish",
  "Portuguese",
  "Arabic",
  "Japanese",
  "Chinese",
  "Korean",
  "Indonesian",
  "Malay",
  "Tamil",
  "Telugu",
  "Marathi",
];
const DEPARTMENT_LIST = [
  "IT / Technology",
  "Finance / Accounting",
  "HR / People",
  "Marketing",
  "Sales / Business Dev",
  "Operations",
  "Procurement / Sourcing",
  "Legal / Compliance",
  "C-Suite / Executive",
  "Product / Design",
  "Engineering / R&D",
  "Customer Success",
  "Other",
];
const INDUSTRY_LIST = [
  "Technology / Software",
  "Banking / Financial Svcs",
  "Insurance",
  "Healthcare / Pharma",
  "Manufacturing",
  "Retail / E-Commerce",
  "FMCG / Consumer Goods",
  "Automotive",
  "Telecom / Media",
  "Education",
  "Real Estate / Construction",
  "Logistics / Supply Chain",
  "Energy / Utilities",
  "Government / Public Sector",
  "Hospitality / Travel",
  "Agriculture",
  "Professional Services",
  "Other",
];
const REVENUE_LIST = [
  "Under $1M",
  "$1M – $10M",
  "$10M – $50M",
  "$50M – $500M",
  "$500M – $1B",
  "Over $1B",
];
const EMPLOYEE_LIST = [
  "1 – 50",
  "51 – 200",
  "201 – 1,000",
  "1,001 – 5,000",
  "5,000+",
];
const BROWSER_LIST = ["Chrome", "Firefox", "Safari", "Edge", "Brave", "Opera"];
const READING_LIST = [
  "Slow — reads carefully",
  "Normal — average pace",
  "Fast — skims quickly",
];
const RESPONSE_LIST = [
  "Conservative — neutral, measured",
  "Neutral — balanced",
  "Expressive — detailed, opinionated",
];
const DEVICE_OS_MAP = {
  desktop: ["Windows", "macOS", "Linux"],
  mobile: ["Android", "iOS"],
  tablet: ["Android", "iPadOS"],
};
const BEHAVIOURAL_TAGS = [
  "Online Shopper",
  "Brand Conscious",
  "Early Adopter",
  "Budget Conscious",
  "Health Conscious",
  "Frequent Traveller",
  "Social Media Active",
  "Tech Savvy",
  "Environmentally Conscious",
  "Luxury Buyer",
  "Deal Hunter",
  "Impulse Buyer",
  "Research-Driven",
  "Loyalty Programme Member",
  "Mobile-First",
  "Decision Maker",
];

// ─── CreatableSingle — type or pick one value ─────────────────────────────────
function CreatableSingle({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
  required,
}) {
  const [input, setInput] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(-1);
  const ref = useRef(null);

  // sync if external value changes (edit mode)
  useEffect(() => {
    setInput(value || "");
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes(input.toLowerCase()),
  );

  const select = (val) => {
    setInput(val);
    onChange(val);
    setOpen(false);
    setHovered(-1);
  };

  const handleKey = (e) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHovered((h) => Math.min(h + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHovered((h) => Math.max(h - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (hovered >= 0 && filtered[hovered]) select(filtered[hovered]);
      else if (input.trim()) select(input.trim());
    }
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} ref={ref}>
      {label && (
        <label style={cs.label}>
          {label}
          {required && <span style={cs.req}> *</span>}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          style={cs.input}
          value={input}
          placeholder={placeholder || `Select or type ${label || ""}...`}
          onChange={(e) => {
            setInput(e.target.value);
            onChange(e.target.value);
            setOpen(true);
            setHovered(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
        />
        {input && (
          <button
            style={cs.clearBtn}
            onMouseDown={(e) => {
              e.preventDefault();
              select("");
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div style={cs.dropdown}>
          {filtered.length === 0 && input.trim() ? (
            <div style={cs.createRow} onMouseDown={() => select(input.trim())}>
              <span style={cs.createLabel}>Create</span> "{input.trim()}"
            </div>
          ) : (
            <>
              {input.trim() &&
                !suggestions.find(
                  (s) => s.toLowerCase() === input.toLowerCase(),
                ) && (
                  <div
                    style={cs.createRow}
                    onMouseDown={() => select(input.trim())}
                  >
                    <span style={cs.createLabel}>Create</span> "{input.trim()}"
                  </div>
                )}
              {filtered.map((s, i) => (
                <div
                  key={s}
                  style={{
                    ...cs.option,
                    background: hovered === i ? "#f0f7ff" : "white",
                  }}
                  onMouseDown={() => select(s)}
                  onMouseEnter={() => setHovered(i)}
                >
                  {s}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const cs = {
  label: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#374151",
    fontFamily: FONT,
  },
  req: { color: "#ef4444" },
  input: {
    width: "100%",
    padding: "10px 32px 10px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.88rem",
    outline: "none",
    color: "#1e293b",
    background: "white",
    fontFamily: FONT,
    boxSizing: "border-box",
  },
  clearBtn: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
    padding: 2,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "white",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
    zIndex: 200,
    maxHeight: 220,
    overflowY: "auto",
    marginTop: 4,
  },
  option: {
    padding: "9px 14px",
    fontSize: "0.88rem",
    cursor: "pointer",
    color: "#1e293b",
    fontFamily: FONT,
    transition: "background 0.1s",
  },
  createRow: {
    padding: "9px 14px",
    fontSize: "0.88rem",
    cursor: "pointer",
    color: "#1e3a5f",
    fontFamily: FONT,
    borderBottom: "1px solid #f1f5f9",
    background: "#f8fafc",
  },
  createLabel: { fontWeight: 700, color: "#2563eb", marginRight: 4 },
};

// ─── Multi Tag Input (unchanged) ──────────────────────────────────────────────
function TagInput({ value = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput] = useState("");
  const [showSug, setShowSug] = useState(false);

  const add = (tag) => {
    const tt = tag.trim();
    if (tt && !value.includes(tt)) onChange([...value, tt]);
    setInput("");
    setShowSug(false);
  };
  const remove = (tag) => onChange(value.filter((t) => t !== tag));
  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s),
  );

  return (
    <div style={{ position: "relative" }}>
      <div style={ti.tagBox}>
        {value.map((tag) => (
          <span key={tag} style={ti.tag}>
            {tag}
            <button style={ti.tagX} onClick={() => remove(tag)}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          style={ti.tagInput}
          value={input}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSug(true);
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && input.trim()) {
              e.preventDefault();
              add(input);
            }
            if (e.key === "Backspace" && !input && value.length > 0)
              remove(value[value.length - 1]);
          }}
          onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
        />
      </div>
      {showSug &&
        (input
          ? filtered.length > 0
          : suggestions.filter((s) => !value.includes(s)).length > 0) && (
          <div style={ti.sugBox}>
            {!input && <div style={ti.sugLabel}>Suggestions</div>}
            {(input ? filtered : suggestions.filter((s) => !value.includes(s)))
              .slice(0, 8)
              .map((s) => (
                <div key={s} style={ti.sugItem} onMouseDown={() => add(s)}>
                  {s}
                </div>
              ))}
          </div>
        )}
    </div>
  );
}

const ti = {
  tagBox: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "8px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    background: "white",
    minHeight: 42,
    alignItems: "center",
  },
  tag: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#dbeafe",
    color: "#1e3a5f",
    borderRadius: 6,
    padding: "3px 8px",
    fontSize: "0.78rem",
    fontWeight: 600,
    fontFamily: FONT,
  },
  tagX: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#1e3a5f",
    padding: 0,
    display: "flex",
    alignItems: "center",
  },
  tagInput: {
    border: "none",
    outline: "none",
    fontSize: "0.88rem",
    fontFamily: FONT,
    color: "#1e293b",
    flex: 1,
    minWidth: 120,
    background: "transparent",
  },
  sugBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "white",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
    zIndex: 100,
    marginTop: 4,
    overflow: "hidden",
  },
  sugLabel: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#94a3b8",
    padding: "8px 12px 4px",
    fontFamily: FONT,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sugItem: {
    padding: "9px 12px",
    fontSize: "0.85rem",
    cursor: "pointer",
    color: "#1e293b",
    fontFamily: FONT,
  },
};

// ─── Device Selector ─────────────────────────────────────────────────────────
function DeviceSelector({ value, onChange }) {
  const devices = [
    { key: "desktop", label: "Desktop", icon: Monitor },
    { key: "mobile", label: "Mobile", icon: Smartphone },
    { key: "tablet", label: "Tablet", icon: Tablet },
  ];
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {devices.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "14px 8px",
            border: `1.5px solid ${value === key ? "#2563eb" : "#e2e8f0"}`,
            borderRadius: 10,
            background: value === key ? "#f0f7ff" : "white",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <Icon size={22} color={value === key ? "#2563eb" : "#94a3b8"} />
          <span
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              fontFamily: FONT,
              color: value === key ? "#1e3a5f" : "#64748b",
            }}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Persona Form (shared by Create & Edit) ───────────────────────────────────
function PersonaForm({ initial, onSubmit, onClose, mode = "create" }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const blank = {
    name: "",
    tags: [],
    country: "",
    language: "English",
    ageMin: "",
    ageMax: "",
    gender: "",
    designation: "",
    department: "",
    industry: "",
    companyRevenue: "",
    employeeSize: "",
    secondaryDescription: "",
    behaviouralTags: [],
    deviceType: "desktop",
    deviceOs: "",
    browser: "Chrome",
    readingSpeed: "Normal — average pace",
    responseStyle: "Neutral — balanced",
  };

  const [form, setForm] = useState(() => ({ ...blank, ...initial }));
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFE = (k) => (e) => setF(k, e.target.value);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save persona");
    } finally {
      setLoading(false);
    }
  };

  const STEPS = [
    "Core Demographics",
    "Secondary Demographics",
    "Execution Settings",
  ];

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>
              {mode === "edit" ? "Edit Persona" : "New Persona"}
            </h2>
            <p style={s.modalSub}>
              Step {step} of 3 — {STEPS[step - 1]}
            </p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Step indicators */}
        <div style={s.stepRow}>
          {STEPS.map((label, i) => (
            <div key={i} style={s.stepItem}>
              <div
                style={{
                  ...s.stepDot,
                  background:
                    step > i + 1
                      ? "#059669"
                      : step === i + 1
                        ? "#1e3a5f"
                        : "#e2e8f0",
                  color: step >= i + 1 ? "white" : "#94a3b8",
                }}
              >
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span
                style={{
                  ...s.stepLabel,
                  color: step === i + 1 ? "#1e3a5f" : "#94a3b8",
                }}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    ...s.stepLine,
                    background: step > i + 1 ? "#059669" : "#e2e8f0",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div style={s.modalBody}>
          {/* ── Step 1: Core Demographics ── */}
          {step === 1 && (
            <div>
              <SectionHeader
                title="Identity"
                subtitle="Name this persona and add searchable tags."
              />
              <FormGrid>
                <FullCol>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <label style={cs.label}>
                      Persona Name <span style={cs.req}>*</span>
                    </label>
                    <input
                      style={{ ...cs.input, paddingRight: 12 }}
                      placeholder='"Senior IT Manager — India" or "Urban Female Consumer — 25-34"'
                      value={form.name}
                      onChange={setFE("name")}
                    />
                  </div>
                </FullCol>
                <FullCol>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <label style={cs.label}>
                      Tags{" "}
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "#94a3b8",
                          fontWeight: 400,
                        }}
                      >
                        — for filtering in library (multi-select)
                      </span>
                    </label>
                    <TagInput
                      value={form.tags}
                      onChange={(v) => setF("tags", v)}
                      placeholder="Type a tag and press Enter..."
                      suggestions={[
                        "B2B",
                        "B2C",
                        "Tech",
                        "Finance",
                        "Healthcare",
                        "FMCG",
                        "Automotive",
                        "India",
                        "US",
                        "Enterprise",
                        "SMB",
                        "Consumer",
                      ]}
                    />
                  </div>
                </FullCol>
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="Demographics"
                subtitle="Fill what's relevant. Company fields can be left blank for consumer personas."
              />
              <FormGrid>
                <CreatableSingle
                  label="Country"
                  value={form.country}
                  onChange={(v) => setF("country", v)}
                  suggestions={COUNTRY_LIST}
                  placeholder="Select or type country..."
                />
                <CreatableSingle
                  label="Language"
                  value={form.language}
                  onChange={(v) => setF("language", v)}
                  suggestions={LANGUAGE_LIST}
                  placeholder="Select or type language..."
                />
                <NumberInput
                  label="Age Min"
                  min="16"
                  max="80"
                  placeholder="e.g. 28"
                  value={form.ageMin}
                  onChange={setFE("ageMin")}
                />
                <NumberInput
                  label="Age Max"
                  min="16"
                  max="80"
                  placeholder="e.g. 45"
                  value={form.ageMax}
                  onChange={setFE("ageMax")}
                />
                <CreatableSingle
                  label="Gender"
                  value={form.gender}
                  onChange={(v) => setF("gender", v)}
                  suggestions={GENDER_LIST}
                  placeholder="Select or type gender..."
                />
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label style={cs.label}>Designation / Job Title</label>
                  <input
                    style={{ ...cs.input, paddingRight: 12 }}
                    placeholder="e.g. IT Manager, CTO, Homemaker"
                    value={form.designation}
                    onChange={setFE("designation")}
                  />
                </div>
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="Company Profile"
                subtitle="Optional — leave blank for consumer (B2C) personas."
              />
              <FormGrid>
                <CreatableSingle
                  label="Function / Department"
                  value={form.department}
                  onChange={(v) => setF("department", v)}
                  suggestions={DEPARTMENT_LIST}
                  placeholder="Select or type department..."
                />
                <CreatableSingle
                  label="Industry"
                  value={form.industry}
                  onChange={(v) => setF("industry", v)}
                  suggestions={INDUSTRY_LIST}
                  placeholder="Select or type industry..."
                />
                <CreatableSingle
                  label="Company Revenue"
                  value={form.companyRevenue}
                  onChange={(v) => setF("companyRevenue", v)}
                  suggestions={REVENUE_LIST}
                  placeholder="Select or type revenue..."
                />
                <CreatableSingle
                  label="Employee Size"
                  value={form.employeeSize}
                  onChange={(v) => setF("employeeSize", v)}
                  suggestions={EMPLOYEE_LIST}
                  placeholder="Select or type size..."
                />
              </FormGrid>
            </div>
          )}

          {/* ── Step 2: Secondary Demographics ── */}
          {step === 2 && (
            <div>
              <SectionHeader
                title="Persona Description"
                subtitle="Describe this persona in plain language. The AI reads this directly when answering survey questions — the more detail you provide, the more accurate the responses."
              />
              <div style={s.aiHint}>
                <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>
                  ✦
                </span>
                <span>
                  Write as if briefing a human respondent. Include mindset,
                  motivations, habits, pain points, preferences — anything
                  relevant to the survey topic.
                </span>
              </div>
              <Textarea
                label="Persona Description"
                required
                placeholder={`Example:\n\n"This is a senior IT decision-maker at a mid-size manufacturing company with 500–1000 employees. He is 38 years old, based in Mumbai, and has been in the industry for 12+ years. He is responsible for approving software and infrastructure purchases above $50K. He is tech-savvy but budget-conscious, frustrated with vendor lock-in, and actively looking for cloud-first solutions..."`}
                rows={10}
                value={form.secondaryDescription}
                onChange={setFE("secondaryDescription")}
              />

              <div style={s.divider} />
              <SectionHeader
                title="Behavioural Tags"
                subtitle="Quick-select tags that describe this persona's behaviour."
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={cs.label}>
                  Behavioural Tags{" "}
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#94a3b8",
                      fontWeight: 400,
                    }}
                  >
                    — multi-select
                  </span>
                </label>
                <TagInput
                  value={form.behaviouralTags}
                  onChange={(v) => setF("behaviouralTags", v)}
                  placeholder="Select or type custom tags..."
                  suggestions={BEHAVIOURAL_TAGS}
                />
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    fontFamily: FONT,
                  }}
                >
                  Click suggestions or type your own. Press Enter to add.
                </span>
              </div>
            </div>
          )}

          {/* ── Step 3: Execution Settings ── */}
          {step === 3 && (
            <div>
              <SectionHeader
                title="Device Type"
                subtitle="Which device will this persona simulate during survey sessions?"
              />
              <DeviceSelector
                value={form.deviceType}
                onChange={(v) => {
                  setF("deviceType", v);
                  setF("deviceOs", "");
                }}
              />

              <div style={s.divider} />
              <SectionHeader
                title="Device & Browser Settings"
                subtitle="Configure the browser automation environment for this persona."
              />
              <FormGrid>
                <CreatableSingle
                  label="Device OS"
                  value={form.deviceOs}
                  onChange={(v) => setF("deviceOs", v)}
                  suggestions={DEVICE_OS_MAP[form.deviceType] || []}
                  placeholder="Select or type OS..."
                />
                <CreatableSingle
                  label="Browser"
                  value={form.browser}
                  onChange={(v) => setF("browser", v)}
                  suggestions={BROWSER_LIST}
                  placeholder="Select or type browser..."
                />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="AI Behaviour Settings"
                subtitle="Control how this persona's reading and response style is simulated."
              />
              <FormGrid>
                <CreatableSingle
                  label="Reading Speed"
                  value={form.readingSpeed}
                  onChange={(v) => setF("readingSpeed", v)}
                  suggestions={READING_LIST}
                  placeholder="Select or type..."
                />
                <CreatableSingle
                  label="Response Style"
                  value={form.responseStyle}
                  onChange={(v) => setF("responseStyle", v)}
                  suggestions={RESPONSE_LIST}
                  placeholder="Select or type..."
                />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader title="Summary" subtitle="Review before saving." />
              <div style={s.summary}>
                {[
                  ["Name", form.name || "—"],
                  ["Country", form.country || "—"],
                  ["Language", form.language || "—"],
                  [
                    "Age Range",
                    form.ageMin && form.ageMax
                      ? `${form.ageMin} – ${form.ageMax}`
                      : "—",
                  ],
                  ["Gender", form.gender || "—"],
                  ["Designation", form.designation || "—"],
                  ["Department", form.department || "—"],
                  ["Industry", form.industry || "—"],
                  [
                    "Device",
                    `${form.deviceType}${form.deviceOs ? " / " + form.deviceOs : ""}`,
                  ],
                  ["Tags", form.tags.length > 0 ? form.tags.join(", ") : "—"],
                  [
                    "Description",
                    form.secondaryDescription
                      ? form.secondaryDescription.slice(0, 100) + "..."
                      : "—",
                  ],
                ].map(([k, v]) => (
                  <div key={k} style={s.summaryRow}>
                    <span style={s.summaryKey}>{k}</span>
                    <span style={s.summaryVal}>{v}</span>
                  </div>
                ))}
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
          {step > 1 && (
            <button style={s.cancelBtn} onClick={() => setStep((ss) => ss - 1)}>
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              style={s.nextBtn}
              onClick={() => {
                if (step === 1 && !form.name) {
                  setError("Persona name is required");
                  return;
                }
                if (step === 2 && !form.secondaryDescription) {
                  setError("Persona description is required");
                  return;
                }
                setError("");
                setStep((ss) => ss + 1);
              }}
            >
              Next →
            </button>
          ) : (
            <button
              style={{ ...s.nextBtn, opacity: loading ? 0.7 : 1 }}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading
                ? "Saving..."
                : mode === "edit"
                  ? "Save Changes"
                  : "Create Persona"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Parse stored attrs back to form fields ────────────────────────────────────
function attrsToForm(persona) {
  if (!persona) return {};
  const a = persona.behavioural_attrs || {};
  return {
    name: persona.name || "",
    tags: persona.tags || [],
    country: persona.country || "",
    language: persona.language || "English",
    ageMin: persona.age_min || "",
    ageMax: persona.age_max || "",
    gender: persona.gender || "",
    designation: a.designation || "",
    department: a.department || "",
    industry: a.industry || "",
    companyRevenue: a.companyRevenue || "",
    employeeSize: a.employeeSize || "",
    secondaryDescription: a.secondaryDescription || "",
    behaviouralTags: a.behaviouralTags || [],
    deviceType: persona.device_type || "desktop",
    deviceOs: a.deviceOs || "",
    browser: a.browser || "Chrome",
    readingSpeed: a.readingSpeed || "Normal — average pace",
    responseStyle: a.responseStyle || "Neutral — balanced",
  };
}

// ─── Personas Table ───────────────────────────────────────────────────────────
const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

function PersonasTable({ personas, onDelete, onEdit, onDuplicate }) {
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...personas].sort((a, b) => {
    let av, bv;
    if (sortKey === "name") {
      av = a.name;
      bv = b.name;
    }
    if (sortKey === "country") {
      av = a.country;
      bv = b.country;
    }
    if (sortKey === "age") {
      av = a.age_min;
      bv = b.age_min;
    }
    if (sortKey === "device") {
      av = a.device_type;
      bv = b.device_type;
    }
    if (sortKey === "created_at") {
      av = a.created_at;
      bv = b.created_at;
    }
    if (av == null) av = "";
    if (bv == null) bv = "";
    const cmp = String(av).localeCompare(String(bv), undefined, {
      numeric: true,
    });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={13} color="#cbd5e1" />;
    return sortDir === "asc" ? (
      <ChevronUp size={13} color="#2563eb" />
    ) : (
      <ChevronDown size={13} color="#2563eb" />
    );
  };

  const TH = ({ label, col }) => (
    <th style={s.th} onClick={() => col && toggleSort(col)}>
      <div style={s.thInner}>
        {label}
        {col && <SortIcon col={col} />}
      </div>
    </th>
  );

  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <TH label="Persona Name" col="name" />
            <TH label="Country" col="country" />
            <TH label="Age" col="age" />
            <TH label="Gender" />
            <TH label="Designation" />
            <TH label="Dept / Industry" />
            <TH label="Tags" />
            <TH label="Device" col="device" />
            <TH label="Created" col="created_at" />
            <th style={{ ...s.th, width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((persona, idx) => {
            const attrs = persona.behavioural_attrs || {};
            const DevIcon = DEVICE_ICONS[persona.device_type] || Monitor;
            const deptInd = [attrs.department, attrs.industry]
              .filter(Boolean)
              .join(" / ");
            return (
              <tr
                key={persona.id}
                style={{
                  ...s.tr,
                  background: idx % 2 === 0 ? "#ffffff" : "#f8fafc",
                }}
              >
                <td style={s.td}>
                  <div style={s.nameCell}>
                    <span style={s.nameText}>{persona.name}</span>
                    {attrs.secondaryDescription && (
                      <span
                        style={s.descPreview}
                        title={attrs.secondaryDescription}
                      >
                        {attrs.secondaryDescription.slice(0, 55)}…
                      </span>
                    )}
                  </div>
                </td>
                <td style={s.td}>
                  <span style={s.cellText}>{persona.country || "—"}</span>
                </td>
                <td style={s.td}>
                  <span style={s.cellText}>
                    {persona.age_min && persona.age_max
                      ? `${persona.age_min}–${persona.age_max}`
                      : "—"}
                  </span>
                </td>
                <td style={s.td}>
                  {persona.gender ? (
                    <span style={s.chip}>
                      {persona.gender.charAt(0).toUpperCase() +
                        persona.gender.slice(1)}
                    </span>
                  ) : (
                    <span style={s.cellMuted}>—</span>
                  )}
                </td>
                <td style={s.td}>
                  <span style={s.cellText}>{attrs.designation || "—"}</span>
                </td>
                <td style={s.td}>
                  <span style={s.cellText}>{deptInd || "—"}</span>
                </td>
                <td style={s.td}>
                  <div style={s.tagCell}>
                    {(persona.tags || []).slice(0, 2).map((tag) => (
                      <span key={tag} style={s.tagPill}>
                        {tag}
                      </span>
                    ))}
                    {(persona.tags || []).length > 2 && (
                      <span style={s.tagMore}>+{persona.tags.length - 2}</span>
                    )}
                    {(!persona.tags || persona.tags.length === 0) && (
                      <span style={s.cellMuted}>—</span>
                    )}
                  </div>
                </td>
                <td style={s.td}>
                  <div style={s.deviceCell}>
                    <DevIcon size={14} color="#64748b" />
                    <span style={s.cellText}>
                      {persona.device_type}
                      {attrs.deviceOs ? ` / ${attrs.deviceOs}` : ""}
                    </span>
                  </div>
                </td>
                <td style={s.td}>
                  <span style={s.cellMuted}>
                    {new Date(persona.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: "center" }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      style={s.dupBtn}
                      title="Duplicate persona"
                      onClick={() => onDuplicate(persona)}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      style={s.editBtn}
                      title="Edit persona"
                      onClick={() => onEdit(persona)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      style={s.deleteBtn}
                      title="Delete persona"
                      onClick={() => onDelete(persona.id)}
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
  );
}

// ─── Main Personas Page ───────────────────────────────────────────────────────
export default function Personas() {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editPersona, setEditPersona] = useState(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/personas");
      setPersonas(res.data?.personas || []);
    } catch (err) {
      console.error("Failed to load personas", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (form) => {
    const res = await api.post("/personas", form);
    setPersonas((prev) => [res.data.persona, ...prev]);
  };

  const handleEdit = async (form) => {
    const res = await api.patch(`/personas/${editPersona.id}`, form);
    setPersonas((prev) =>
      prev.map((p) => (p.id === editPersona.id ? res.data.persona : p)),
    );
    setEditPersona(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this persona? This cannot be undone.")) return;
    try {
      await api.delete(`/personas/${id}`);
      setPersonas((prev) => prev.filter((p) => p.id !== id));
    } catch {
      alert("Failed to delete persona");
    }
  };

  const handleDuplicate = async (persona) => {
    try {
      const form = attrsToForm(persona);
      form.name = `Copy of ${form.name}`;
      const res = await api.post("/personas", form);
      setPersonas((prev) => [res.data.persona, ...prev]);
    } catch {
      alert("Failed to duplicate persona");
    }
  };

  const filtered = personas.filter((p) => {
    const a = p.behavioural_attrs || {};
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(q)) ||
      (a.designation || "").toLowerCase().includes(q) ||
      (a.department || "").toLowerCase().includes(q) ||
      (a.industry || "").toLowerCase().includes(q) ||
      (p.country || "").toLowerCase().includes(q)
    );
  });

  return (
    <Layout title="Persona Library">
      <div style={s.toolbar}>
        <div style={s.searchWrap}>
          <Search
            size={16}
            color="#94a3b8"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          />
          <input
            style={s.search}
            placeholder="Search by name, tag, designation, department or industry..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button style={s.createBtn} onClick={() => setShowCreate(true)}>
          <Plus size={18} /> New Persona
        </button>
      </div>

      {!loading && (
        <div style={s.resultsBar}>
          {filtered.length} persona{filtered.length !== 1 ? "s" : ""} in library
          {search &&
            filtered.length !== personas.length &&
            ` (filtered from ${personas.length})`}
        </div>
      )}

      {loading ? (
        <div style={s.center}>Loading personas...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <Users size={52} color="#cbd5e1" />
          <h3 style={s.emptyTitle}>
            {search ? "No personas match your search" : "No Personas Yet"}
          </h3>
          <p style={s.emptyDesc}>
            {search
              ? "Try a different search term."
              : "Build respondent personas to guide AI answer behaviour across survey sessions."}
          </p>
          {!search && (
            <button style={s.createBtn} onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New Persona
            </button>
          )}
        </div>
      ) : (
        <PersonasTable
          personas={filtered}
          onDelete={handleDelete}
          onEdit={(p) => setEditPersona(p)}
          onDuplicate={handleDuplicate}
        />
      )}

      {showCreate && (
        <PersonaForm
          mode="create"
          initial={{}}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editPersona && (
        <PersonaForm
          mode="edit"
          initial={attrsToForm(editPersona)}
          onSubmit={handleEdit}
          onClose={() => setEditPersona(null)}
        />
      )}
    </Layout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  toolbar: { display: "flex", gap: 12, marginBottom: 12, alignItems: "center" },
  searchWrap: { flex: 1, position: "relative" },
  search: {
    width: "100%",
    padding: "10px 16px 10px 38px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.88rem",
    outline: "none",
    background: "white",
    color: "#1e293b",
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
    fontSize: "0.8rem",
    color: "#94a3b8",
    marginBottom: 14,
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
    maxWidth: 400,
    lineHeight: 1.6,
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
  th: {
    padding: "12px 14px",
    textAlign: "left",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
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
  nameCell: { display: "flex", flexDirection: "column", gap: 3 },
  nameText: {
    fontSize: "0.88rem",
    fontWeight: 600,
    color: "#1e293b",
    fontFamily: FONT,
  },
  descPreview: {
    fontSize: "0.73rem",
    color: "#94a3b8",
    fontFamily: FONT,
    cursor: "help",
  },
  cellText: { fontSize: "0.82rem", color: "#475569", fontFamily: FONT },
  cellMuted: { fontSize: "0.82rem", color: "#cbd5e1", fontFamily: FONT },
  chip: {
    background: "#f1f5f9",
    color: "#475569",
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: "0.75rem",
    fontWeight: 500,
    fontFamily: FONT,
  },
  tagCell: { display: "flex", flexWrap: "wrap", gap: 4 },
  tagPill: {
    background: "#dbeafe",
    color: "#1e3a5f",
    borderRadius: 6,
    padding: "2px 7px",
    fontSize: "0.72rem",
    fontWeight: 600,
    fontFamily: FONT,
  },
  tagMore: {
    background: "#f1f5f9",
    color: "#94a3b8",
    borderRadius: 6,
    padding: "2px 7px",
    fontSize: "0.72rem",
    fontFamily: FONT,
  },
  deviceCell: { display: "flex", alignItems: "center", gap: 5 },
  editBtn: {
    background: "#f0f7ff",
    border: "1px solid #dbeafe",
    cursor: "pointer",
    color: "#2563eb",
    padding: "5px 6px",
    borderRadius: 6,
    display: "flex",
    transition: "all 0.15s",
  },
  deleteBtn: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    cursor: "pointer",
    color: "#ef4444",
    padding: "5px 6px",
    borderRadius: 6,
    display: "flex",
    transition: "all 0.15s",
  },
  dupBtn: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    cursor: "pointer",
    color: "#059669",
    padding: "5px 6px",
    borderRadius: 6,
    display: "flex",
    transition: "all 0.15s",
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
    maxWidth: 680,
    maxHeight: "92vh",
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
  stepRow: {
    display: "flex",
    alignItems: "center",
    padding: "16px 28px 0",
    gap: 0,
  },
  stepItem: { display: "flex", alignItems: "center", flex: 1 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.78rem",
    fontWeight: 700,
    flexShrink: 0,
    fontFamily: FONT,
    transition: "all 0.2s",
  },
  stepLabel: {
    fontSize: "0.72rem",
    fontWeight: 600,
    marginLeft: 6,
    fontFamily: FONT,
    whiteSpace: "nowrap",
    transition: "color 0.2s",
  },
  stepLine: {
    flex: 1,
    height: 2,
    margin: "0 8px",
    transition: "background 0.2s",
    minWidth: 20,
  },
  modalBody: { flex: 1, overflowY: "auto", padding: "20px 28px" },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    padding: "16px 28px",
    borderTop: "1px solid #f1f5f9",
  },
  divider: { height: 1, background: "#f1f5f9", margin: "20px 0" },
  aiHint: {
    display: "flex",
    gap: 10,
    background: "#f0f7ff",
    border: "1.5px solid #dbeafe",
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 16,
    fontSize: "0.82rem",
    color: "#1e3a5f",
    fontFamily: FONT,
    lineHeight: 1.6,
    alignItems: "flex-start",
  },
  summary: {
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: 16,
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "7px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  summaryKey: {
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "#94a3b8",
    fontFamily: FONT,
    minWidth: 100,
  },
  summaryVal: {
    fontSize: "0.82rem",
    color: "#1e293b",
    fontFamily: FONT,
    textAlign: "right",
    maxWidth: "70%",
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
    marginTop: 12,
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
