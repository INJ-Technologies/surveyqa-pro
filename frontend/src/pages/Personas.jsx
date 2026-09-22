import React, { useState, useEffect, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import api from "../api";
import { useCountries } from "../hooks/useCountries";
import { Textarea, NumberInput, FormGrid, FullCol, SectionHeader } from "../components/FormElements";
import {
  Users, Plus, X, Monitor, Smartphone, Tablet,
  AlertCircle, Trash2, Search, ChevronUp, ChevronDown,
  Pencil, Copy, Eye, Sparkles, Loader,
} from "lucide-react";

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ══════════════════════════════════════════════════════════════════════════════
// REFERENCE LISTS — Extended for full persona coverage
// ══════════════════════════════════════════════════════════════════════════════

const GENDER_LIST = ["Male", "Female", "Non-Binary", "Any / No Preference"];

const LANGUAGE_LIST = [
  "English","Mandarin Chinese","Hindi","Spanish","Arabic",
  "Bengali","Portuguese","Russian","Japanese","German",
  "French","Korean","Telugu","Marathi","Tamil","Urdu",
  "Turkish","Indonesian","Vietnamese","Italian","Polish",
  "Dutch","Swedish","Norwegian","Danish","Finnish",
  "Greek","Romanian","Hungarian","Czech","Slovak",
  "Thai","Malay","Tagalog","Swahili","Amharic",
  "Gujarati","Kannada","Malayalam","Punjabi","Sindhi",
  "Pashto","Persian / Farsi","Hebrew","Ukrainian","Serbian",
  "Croatian","Bulgarian","Catalan","Basque",
];

const DESIGNATION_LIST = [
  // C-Suite
  "CEO / Co-Founder","Founder / Entrepreneur","President","COO","CFO","CTO","CMO",
  "CISO","CIO","CPO","CDO","CHRO","CXO","Managing Director","Executive Director",
  // VP Level
  "Vice President","SVP","EVP","Group Vice President",
  // Director Level
  "Director","Associate Director","Deputy Director","General Manager",
  // Manager Level
  "Senior Manager","Manager","Assistant Manager","Deputy Manager","Branch Manager",
  // Team Lead / Supervisor
  "Team Lead","Senior Team Lead","Supervisor","Group Lead",
  // Professionals
  "Senior Executive","Executive","Senior Analyst","Analyst","Junior Analyst",
  "Senior Consultant","Consultant","Principal Consultant","Associate Consultant",
  "Senior Specialist","Specialist","Senior Coordinator","Coordinator",
  "Senior Engineer","Lead Engineer","Principal Engineer","Engineer","Junior Engineer",
  "Senior Developer","Developer","Junior Developer","Full Stack Developer",
  "Senior Designer","UX Designer","Product Designer","Graphic Designer",
  "Senior Scientist","Research Scientist","Scientist","Lab Technician",
  "Senior Researcher","Researcher","Data Scientist","Machine Learning Engineer",
  "Architect","Solution Architect","Enterprise Architect",
  "Senior Accountant","Accountant","Finance Analyst","Financial Controller",
  "Senior Doctor","Doctor","GP","Specialist Doctor","Surgeon",
  "Nurse","Senior Nurse","Nurse Practitioner","Head Nurse",
  "Pharmacist","Dentist","Physiotherapist","Radiologist",
  "Senior Professor","Professor","Associate Professor","Assistant Professor",
  "Teacher","Senior Teacher","Head of Department","Principal",
  "Lawyer","Senior Lawyer","Partner","Associate","Solicitor","Barrister",
  "Chartered Accountant","Auditor","Tax Consultant",
  "Journalist","Senior Journalist","Editor","Chief Editor",
  "Architect (Built Environment)","Civil Engineer","Structural Engineer",
  "Homemaker","Self-Employed","Freelancer","Gig Worker",
  "Student — Undergraduate","Student — Postgraduate","PhD Scholar",
  "Retired","Pensioner","Business Owner","Proprietor","Partner (Business)",
];

const DEPARTMENT_LIST = [
  "C-Suite / Executive","Strategy & Planning","Business Development",
  "IT / Technology","Information Security / CISO","Data & Analytics",
  "Software Engineering","Product Management","Product Design / UX",
  "Research & Development","Innovation","AI & Machine Learning",
  "Finance / Accounting","Treasury","Tax & Compliance","Audit & Risk",
  "HR / People & Culture","Talent Acquisition","Learning & Development",
  "Marketing","Brand Management","Performance Marketing","Content & SEO",
  "Social Media","Public Relations","Communications",
  "Sales","Inside Sales","Key Account Management","Channel Sales",
  "Customer Success","Customer Support","Customer Experience",
  "Operations","Process Excellence / Six Sigma","Quality Assurance",
  "Supply Chain","Procurement / Sourcing","Logistics & Distribution",
  "Manufacturing","Production","Maintenance & Engineering",
  "Legal / Compliance","Regulatory Affairs","Government Relations",
  "Healthcare / Clinical","Medical Affairs","Pharmacy","Nursing",
  "Real Estate & Facilities","Administration & Secretarial",
  "Internal Audit","Risk Management","Corporate Affairs",
  "Other / Cross-Functional",
];

const INDUSTRY_LIST = [
  // Technology
  "Technology / Software (SaaS)","Enterprise Software","Cybersecurity",
  "Cloud Computing / Infrastructure","Semiconductors / Hardware",
  "IT Services / Managed Services","AI / Machine Learning",
  "Data Analytics / BI","Robotics / Automation","Deep Tech",
  // Financial Services
  "Banking / Retail Banking","Investment Banking","Capital Markets",
  "Insurance (Life)","Insurance (General)","Reinsurance",
  "Wealth Management / Private Banking","Asset Management",
  "Fintech / Digital Payments","Microfinance / NBFCs",
  "Venture Capital / Private Equity","Hedge Funds",
  // Healthcare & Life Sciences
  "Pharmaceuticals","Biotechnology / Life Sciences",
  "Medical Devices & Equipment","Hospitals & Healthcare Systems",
  "Diagnostics & Pathology","Digital Health / HealthTech",
  "CROs / Clinical Research","Nutraceuticals / Supplements",
  "Dental & Optics","Veterinary / Animal Health",
  // Consumer & Retail
  "Retail (Physical)","E-Commerce / D2C","FMCG — Food & Beverage",
  "FMCG — Personal Care / Beauty","FMCG — Home Care",
  "Apparel / Fashion / Luxury","Consumer Electronics",
  "Sporting Goods & Fitness","Toys & Gaming (Consumer)",
  "Jewellery & Accessories","Furniture & Home Décor",
  // Industrial & Manufacturing
  "Manufacturing — General","Automotive OEM","Auto Components / Ancillaries",
  "Aerospace & Defence","Chemicals & Speciality Chemicals",
  "Metals & Mining","Plastics & Rubber","Paper & Packaging",
  "Textile / Yarn / Fabric","Cement & Construction Materials",
  "Heavy Engineering / Capital Goods","Industrial Automation",
  // Energy & Utilities
  "Oil & Gas (Upstream)","Oil & Gas (Downstream / Refining)",
  "Petrochemicals","Renewable Energy (Solar / Wind)",
  "Power Generation & Utilities","Water & Sanitation",
  "Nuclear Energy","Energy Storage / Batteries",
  // Infrastructure & Real Estate
  "Real Estate — Residential","Real Estate — Commercial",
  "Real Estate — Industrial / Warehousing","Construction & EPC",
  "Infrastructure — Roads / Ports / Airports","Smart Cities / Urban Dev",
  // Telecom & Media
  "Telecom — Carriers","Telecom — Equipment",
  "Media & Entertainment","OTT / Streaming","Digital Media / AdTech",
  "Publishing","Music & Audio","Gaming (B2B / Studios)","Esports",
  // Education
  "K-12 Education","Higher Education / Universities",
  "EdTech / Online Learning","Vocational Training / Skilling",
  "Test Prep / Coaching","Corporate Training",
  // Logistics & Supply Chain
  "Logistics & 3PL","Freight & Cargo","Last-Mile Delivery",
  "Warehousing / Cold Chain","Supply Chain Technology",
  // Professional & Business Services
  "Management Consulting","IT Consulting","Accounting & Audit Firms",
  "Legal Services","Staffing & Recruitment",
  "Market Research / Insights","PR & Communications Agencies",
  "Advertising Agencies","Events & Experiential",
  // Hospitality & Travel
  "Hotels & Hospitality","Restaurants & QSR","Food Delivery / Cloud Kitchens",
  "Travel & Tourism","Airlines","Cruise & Luxury Travel",
  "Online Travel Agencies (OTA)",
  // Government & Non-Profit
  "Government / Public Sector","Defence & Military",
  "Non-Profit / NGO","Social Enterprise","International Organisations",
  // Agriculture & Food
  "Agriculture / Agribusiness","AgriTech","Animal Husbandry / Dairy",
  "Aquaculture / Fisheries","Food Processing & Manufacturing",
  // Other
  "Sports & Fitness (B2B)","Environment & Sustainability","Other",
];

const REVENUE_LIST = [
  // Micro / Small
  "Under ₹10L / Under $10K","₹10L – ₹50L / $10K – $60K",
  "₹50L – ₹1Cr / $60K – $120K","₹1Cr – ₹5Cr / $120K – $600K",
  "₹5Cr – ₹10Cr / $600K – $1.2M",
  // SMB
  "₹10Cr – ₹25Cr / $1.2M – $3M","₹25Cr – ₹50Cr / $3M – $6M",
  "₹50Cr – ₹100Cr / $6M – $12M","₹100Cr – ₹250Cr / $12M – $30M",
  "₹250Cr – ₹500Cr / $30M – $60M",
  // Mid-Market
  "$50M – $100M","$100M – $250M","$250M – $500M","$500M – $1B",
  // Enterprise
  "$1B – $2B","$2B – $5B","$5B – $10B","$10B – $25B",
  "$25B – $50B","Over $50B",
  // Non-corporate
  "Not applicable (Individual / Consumer)","Prefer not to disclose",
];

const EMPLOYEE_LIST = [
  "Just me (Solo / Freelancer)",
  "2 – 5","6 – 10","11 – 25","26 – 50","51 – 100",
  "101 – 250","251 – 500","501 – 1,000","1,001 – 2,500",
  "2,501 – 5,000","5,001 – 10,000","10,001 – 25,000",
  "25,001 – 50,000","50,001 – 1,00,000","Over 1,00,000",
  "Not applicable (Individual / Consumer)",
];

const INCOME_LIST = [
  // India brackets
  "Under ₹3L / year","₹3L – ₹6L / year","₹6L – ₹10L / year",
  "₹10L – ₹15L / year","₹15L – ₹25L / year","₹25L – ₹50L / year",
  "₹50L – ₹1Cr / year","Over ₹1Cr / year",
  // Global brackets
  "Under $20K / year","$20K – $40K / year","$40K – $75K / year",
  "$75K – $125K / year","$125K – $200K / year","Over $200K / year",
  "Prefer not to disclose",
];

const EDUCATION_LIST = [
  "Below Secondary / High School","Secondary / High School / SSCE",
  "Diploma / Vocational Training","Bachelor's Degree",
  "Post Graduate Diploma","Master's Degree (MBA / MA / MSc / ME)",
  "PhD / Doctorate","Professional Qualification (CA / CFA / ACCA / Bar)",
  "Medical Degree (MBBS / MD)","Law Degree (LLB / LLM)",
  "Currently Studying — Undergraduate","Currently Studying — Postgraduate",
];

const MARITAL_STATUS_LIST = [
  "Single","Married / Partnered","Divorced / Separated","Widowed","Prefer not to say",
];

const KIDS_LIST = [
  "No children","1 child (under 5)","1 child (5–12)","1 child (13–18)","1 child (18+)",
  "2 children","3+ children","Children of mixed ages","Prefer not to say",
];

const BEHAVIOURAL_TAGS = [
  // Digital behaviour
  "Online Shopper","Heavy E-Commerce User","App-First User","Digital Native",
  "Mobile-First","Social Media Active","Content Creator","Influencer",
  "Podcast Listener","Video Streamer","News Reader","Blog / Forum Reader",
  "Online Community Member","WhatsApp Power User","Email Heavy User",
  // Purchasing behaviour
  "Brand Conscious","Luxury Buyer","Budget Conscious","Price Sensitive",
  "Deal Hunter","Impulse Buyer","Research-Driven Buyer","Comparison Shopper",
  "Loyalty Programme Member","Subscription User","Early Adopter",
  "Late Adopter","Traditional Buyer","Word-of-Mouth Driven",
  "Peer-Recommendation Driven","Review Reader","Coupon / Voucher User",
  // Professional & Decision-Making
  "Decision Maker","Budget Holder","Key Influencer","Recommender",
  "Committee Decision","Individual Decision","Risk Averse","Risk Taker",
  "Analytical / Data-Driven","Gut-Feel Decision Maker",
  "Long Consideration Cycle","Short Consideration Cycle",
  "Vendor-Loyal","Open to Switching Vendors","Multi-Vendor Strategy",
  // Lifestyle
  "Health Conscious","Fitness Enthusiast","Gym Goer","Yoga / Meditation Practitioner",
  "Runner / Cyclist","Outdoor / Adventure Seeker","Gamer","Sports Fan",
  "Foodie / Food Explorer","Home Cook","Traveller — Frequent","Traveller — Occasional",
  "Luxury Traveller","Budget Traveller","Business Traveller",
  "Pet Owner","Parent — Actively Involved","Eco-Conscious","Sustainability Advocate",
  "DIY Enthusiast","Gadget Enthusiast","Car Enthusiast","Fashionista",
  "Book Reader","Movie Buff","Music Lover","Art & Culture Enthusiast",
  // Financial
  "Investor — Stock Market","Investor — Mutual Funds","Investor — Real Estate",
  "Crypto Enthusiast","Insurance Buyer","EMI / Credit User",
  "Financially Conservative","High Net Worth Individual (HNI)",
  // Work style
  "Remote Worker","Hybrid Worker","Office-First","Frequent Business Traveller",
  "Freelancer / Gig Worker","Side Hustle / Entrepreneur",
  "Work-Life Balance Focused","Career-Driven / Ambitious",
  // Tech & Privacy
  "Tech Savvy","Technophobe / Late Adopter","Cybersecurity Conscious",
  "Data Privacy Conscious","AI Tool User","Cloud-First","SaaS Buyer",
  // Other
  "Commuter","Night Owl","Early Bird","Introvert","Extrovert",
  "Community Leader","Volunteer / NGO Active","Religious / Faith-Driven",
];

const BROWSER_LIST = [
  "Chrome","Firefox","Safari","Edge","Brave","Opera",
  "Samsung Internet","UC Browser","Vivaldi","Arc",
];

const READING_LIST = [
  "Slow — reads every word carefully",
  "Normal — average reading pace",
  "Fast — skims, reads headings first",
];

const RESPONSE_LIST = [
  "Conservative — short, neutral, measured responses",
  "Neutral — balanced, moderate responses",
  "Expressive — detailed, opinionated, elaborate responses",
  "Terse — minimal, one-word or very short answers",
];

const DEVICE_OS_MAP = {
  desktop: ["Windows 11","Windows 10","macOS Sonoma","macOS Ventura","Linux","Chrome OS"],
  mobile:  ["Android 14","Android 13","Android 12","iOS 17","iOS 16"],
  tablet:  ["Android 14","Android 13","iPadOS 17","iPadOS 16","Windows 11"],
};

// ══════════════════════════════════════════════════════════════════════════════
// CREATABLE SINGLE SELECT
// ══════════════════════════════════════════════════════════════════════════════
function CreatableSingle({ value, onChange, suggestions, placeholder, label, required }) {
  const [input,   setInput]   = useState(value || "");
  const [open,    setOpen]    = useState(false);
  const [hovered, setHovered] = useState(-1);
  const ref = useRef(null);

  // Keep internal input in sync when value prop changes (edit mode fix)
  useEffect(() => { setInput(value || ""); }, [value]);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = suggestions.filter(s => s.toLowerCase().includes(input.toLowerCase()));
  const showCreate = input.trim() && !suggestions.find(s => s.toLowerCase() === input.trim().toLowerCase());

  const select = (val) => { setInput(val); onChange(val); setOpen(false); setHovered(-1); };

  const handleKey = (e) => {
    if (!open) { setOpen(true); return; }
    if (e.key === "ArrowDown")  { e.preventDefault(); setHovered(h => Math.min(h + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setHovered(h => Math.max(h - 1, 0)); }
    if (e.key === "Enter")      { e.preventDefault(); if (hovered >= 0 && filtered[hovered]) select(filtered[hovered]); else if (input.trim()) select(input.trim()); }
    if (e.key === "Escape")     { setOpen(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && <label style={cs.label}>{label}{required && <span style={cs.req}> *</span>}</label>}
      <div style={{ position: "relative" }} ref={ref}>
        <input
          style={cs.input}
          value={input}
          placeholder={placeholder || "Select or type..."}
          onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); setHovered(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
        />
        {input && (
          <button style={cs.clearBtn} onMouseDown={e => { e.preventDefault(); select(""); }}>
            <X size={13} />
          </button>
        )}
        {open && (showCreate || filtered.length > 0 || (!input && suggestions.length > 0)) && (
          <div style={cs.dropdown}>
            {showCreate && (
              <div style={cs.createRow} onMouseDown={() => select(input.trim())}>
                <span style={cs.createLabel}>Create</span> "{input.trim()}"
              </div>
            )}
            {(input ? filtered : suggestions).map((s, i) => (
              <div key={s} style={{ ...cs.option, background: hovered === i ? "#f0f7ff" : "white" }}
                onMouseDown={() => select(s)}
                onMouseEnter={() => setHovered(i)}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const cs = {
  label:    { fontSize: "0.8rem", fontWeight: 600, color: "#374151", fontFamily: FONT },
  req:      { color: "#ef4444" },
  input:    { width: "100%", padding: "10px 32px 10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: "0.88rem", outline: "none", color: "#1e293b", background: "white", fontFamily: FONT, boxSizing: "border-box" },
  clearBtn: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center", padding: 2 },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, maxHeight: 240, overflowY: "auto", marginTop: 4 },
  option:   { padding: "9px 14px", fontSize: "0.88rem", cursor: "pointer", color: "#1e293b", fontFamily: FONT },
  createRow:{ padding: "9px 14px", fontSize: "0.88rem", cursor: "pointer", color: "#1e3a5f", fontFamily: FONT, borderBottom: "1px solid #f1f5f9", background: "#f8fafc" },
  createLabel: { fontWeight: 700, color: "#2563eb", marginRight: 4 },
};

// ══════════════════════════════════════════════════════════════════════════════
// TAG INPUT
// ══════════════════════════════════════════════════════════════════════════════
function TagInput({ value = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput] = useState("");
  const [show,  setShow]  = useState(false);

  const add = (tag) => {
    const tt = tag.trim();
    if (tt && !value.includes(tt)) onChange([...value, tt]);
    setInput(""); setShow(false);
  };
  const remove = (tag) => onChange(value.filter(t => t !== tag));
  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  );

  return (
    <div style={{ position: "relative" }}>
      <div style={ti.tagBox}>
        {value.map(tag => (
          <span key={tag} style={ti.tag}>
            {tag}
            <button style={ti.tagX} onClick={() => remove(tag)}><X size={11} /></button>
          </span>
        ))}
        <input
          style={ti.tagInput}
          value={input}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={e => { setInput(e.target.value); setShow(true); }}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === ",") && input.trim()) { e.preventDefault(); add(input); }
            if (e.key === "Backspace" && !input && value.length > 0) remove(value[value.length - 1]);
          }}
          onFocus={() => setShow(true)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
        />
      </div>
      {show && (
        <div style={ti.sugBox}>
          {!input && <div style={ti.sugLabel}>Click to add</div>}
          {(input ? filtered : suggestions.filter(s => !value.includes(s))).slice(0, 12).map(s => (
            <div key={s} style={ti.sugItem} onMouseDown={() => add(s)}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const ti = {
  tagBox:   { display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 8, background: "white", minHeight: 42, alignItems: "center" },
  tag:      { display: "flex", alignItems: "center", gap: 4, background: "#dbeafe", color: "#1e3a5f", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem", fontWeight: 600, fontFamily: FONT },
  tagX:     { background: "none", border: "none", cursor: "pointer", color: "#1e3a5f", padding: 0, display: "flex", alignItems: "center" },
  tagInput: { border: "none", outline: "none", fontSize: "0.88rem", fontFamily: FONT, color: "#1e293b", flex: 1, minWidth: 120, background: "transparent" },
  sugBox:   { position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, marginTop: 4, maxHeight: 260, overflowY: "auto" },
  sugLabel: { fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", padding: "8px 12px 4px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 },
  sugItem:  { padding: "9px 12px", fontSize: "0.85rem", cursor: "pointer", color: "#1e293b", fontFamily: FONT },
};

// ══════════════════════════════════════════════════════════════════════════════
// DEVICE SELECTOR
// ══════════════════════════════════════════════════════════════════════════════
function DeviceSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {[
        { key: "desktop", label: "Desktop", icon: Monitor },
        { key: "mobile",  label: "Mobile",  icon: Smartphone },
        { key: "tablet",  label: "Tablet",  icon: Tablet },
      ].map(({ key, label, icon: Icon }) => (
        <button key={key} type="button" onClick={() => onChange(key)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "14px 8px", border: `1.5px solid ${value === key ? "#2563eb" : "#e2e8f0"}`,
          borderRadius: 10, background: value === key ? "#f0f7ff" : "white",
          cursor: "pointer", transition: "all 0.15s",
        }}>
          <Icon size={22} color={value === key ? "#2563eb" : "#94a3b8"} />
          <span style={{ fontSize: "0.8rem", fontWeight: 600, fontFamily: FONT, color: value === key ? "#1e3a5f" : "#64748b" }}>
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════════════════════════════════════════
const toProper = (str) => {
  if (!str) return "—";
  return str.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
};

// Parse stored persona back to form fields
function attrsToForm(persona) {
  if (!persona) return {};
  const a = persona.behavioural_attrs || {};
  return {
    name:                persona.name                  || "",
    tags:                Array.isArray(persona.tags) ? persona.tags : [],
    country:             persona.country               || "",
    language:            persona.language              || "English",
    ageMin:              persona.age_min  != null ? String(persona.age_min)  : "",
    ageMax:              persona.age_max  != null ? String(persona.age_max)  : "",
    gender:              persona.gender               || "",
    designation:         a.designation               || "",
    department:          a.department                || "",
    industry:            a.industry                  || "",
    companyRevenue:      a.companyRevenue             || "",
    employeeSize:        a.employeeSize               || "",
    annualIncome:        a.annualIncome               || "",
    educationLevel:      a.educationLevel             || "",
    maritalStatus:       a.maritalStatus              || "",
    childrenStatus:      a.childrenStatus             || "",
    secondaryDescription:a.secondaryDescription       || "",
    behaviouralTags:     Array.isArray(a.behaviouralTags) ? a.behaviouralTags : [],
    deviceType:          persona.device_type          || "desktop",
    deviceOs:            a.deviceOs                  || "",
    browser:             a.browser                   || "Chrome",
    readingSpeed:        a.readingSpeed               || "Normal — average reading pace",
    responseStyle:       a.responseStyle              || "Neutral — balanced, moderate responses",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PERSONA FORM — Create & Edit (3 steps)
// ══════════════════════════════════════════════════════════════════════════════
function PersonaForm({ initial, onSubmit, onClose, mode = "create" }) {
  const [step,        setStep]        = useState(1);
  const [loading,     setLoading]     = useState(false);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [error,       setError]       = useState("");
  const { countries: dbCountries }    = useCountries();
  const countryNames = dbCountries.map(c => c.country);

  const blank = {
    name: "", tags: [], country: "", language: "English",
    ageMin: "", ageMax: "", gender: "",
    designation: "", department: "", industry: "", companyRevenue: "",
    employeeSize: "", annualIncome: "", educationLevel: "",
    maritalStatus: "", childrenStatus: "",
    secondaryDescription: "", behaviouralTags: [],
    deviceType: "desktop", deviceOs: "", browser: "Chrome",
    readingSpeed: "Normal — average reading pace",
    responseStyle: "Neutral — balanced, moderate responses",
  };

  // Edit mode: merge initial values over blank (ensures all keys exist)
  const [form, setForm] = useState(() => ({ ...blank, ...initial }));
  const setF  = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setFE = (k)    => (e) => setF(k, e.target.value);

  // When editing, sync prop changes into form state
  // (handles the case where the modal is re-opened for a different persona)
  useEffect(() => {
    if (mode === "edit" && initial) {
      setForm({ ...blank, ...initial });
      setStep(1);
    }
  }, [initial?.name]); // keyed on name — changes when different persona is opened

  // ── AI Generate Description ──────────────────────────────────────────────
  const generateDescription = async () => {
    setAiLoading(true);
    setError("");
    try {
      const res = await api.post("/personas/generate-description", {
        name:            form.name,
        country:         form.country,
        language:        form.language,
        ageMin:          form.ageMin,
        ageMax:          form.ageMax,
        gender:          form.gender,
        designation:     form.designation,
        department:      form.department,
        industry:        form.industry,
        companyRevenue:  form.companyRevenue,
        employeeSize:    form.employeeSize,
        annualIncome:    form.annualIncome,
        educationLevel:  form.educationLevel,
        maritalStatus:   form.maritalStatus,
        childrenStatus:  form.childrenStatus,
        behaviouralTags: form.behaviouralTags,
      });
      setF("secondaryDescription", res.data.description);
    } catch (err) {
      setError(err.response?.data?.error || "AI generation failed. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try { await onSubmit(form); onClose(); }
    catch (err) { setError(err.response?.data?.error || "Failed to save persona"); }
    finally { setLoading(false); }
  };

  const STEPS = ["Core Demographics", "Behaviour & Description", "Execution Settings"];

  // B2B detection
  const isB2B = !!(form.designation || form.department || form.industry);

  const summaryRows = [
    ["Persona Name",     form.name],
    ["Country",          form.country],
    ["Language",         form.language],
    ["Age Range",        form.ageMin && form.ageMax ? `${form.ageMin} – ${form.ageMax}` : ""],
    ["Gender",           form.gender],
    ["Designation",      form.designation],
    ["Department",       form.department],
    ["Industry",         form.industry],
    ["Company Revenue",  form.companyRevenue],
    ["Employee Size",    form.employeeSize],
    ["Annual Income",    form.annualIncome],
    ["Education",        form.educationLevel],
    ["Marital Status",   form.maritalStatus],
    ["Device",           `${toProper(form.deviceType)}${form.deviceOs ? " / " + form.deviceOs : ""}`],
    ["Browser",          form.browser],
    ["Reading Speed",    form.readingSpeed],
    ["Response Style",   form.responseStyle],
    ["Tags",             form.tags.length > 0 ? form.tags.join(", ") : ""],
    ["Behavioural Tags", form.behaviouralTags.length > 0 ? form.behaviouralTags.join(", ") : ""],
    ["Description",      form.secondaryDescription
      ? form.secondaryDescription.slice(0, 120) + (form.secondaryDescription.length > 120 ? "…" : "")
      : ""],
  ].filter(([, v]) => v);

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>{mode === "edit" ? "Edit Persona" : "New Persona"}</h2>
            <p style={s.modalSub}>Step {step} of 3 — {STEPS[step - 1]}</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Step indicator */}
        <div style={s.stepRow}>
          {STEPS.map((label, i) => (
            <div key={i} style={s.stepItem}>
              <div style={{
                ...s.stepDot,
                background: step > i+1 ? "#059669" : step === i+1 ? "#1e3a5f" : "#e2e8f0",
                color: step >= i+1 ? "white" : "#94a3b8",
              }}>
                {step > i+1 ? "✓" : i+1}
              </div>
              <span style={{ ...s.stepLabel, color: step === i+1 ? "#1e3a5f" : "#94a3b8" }}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div style={{ ...s.stepLine, background: step > i+1 ? "#059669" : "#e2e8f0" }} />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={s.modalBody}>

          {/* ── STEP 1: Core Demographics ─────────────────────────────────── */}
          {step === 1 && (
            <div>
              <SectionHeader title="Identity" subtitle="Name this persona and add searchable tags." />
              <FormGrid>
                <FullCol>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={cs.label}>Persona Name <span style={cs.req}>*</span></label>
                    <input style={{ ...cs.input, paddingRight: 12 }}
                      placeholder='"Senior IT Manager — India B2B" or "Urban Female Millennial — Mumbai B2C"'
                      value={form.name} onChange={setFE("name")} />
                  </div>
                </FullCol>
                <FullCol>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={cs.label}>
                      Library Tags
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 400 }}>
                        {" "}— for filtering in project assignment
                      </span>
                    </label>
                    <TagInput value={form.tags} onChange={v => setF("tags", v)}
                      placeholder="e.g. B2B, B2C, Tech, Finance, India..."
                      suggestions={[
                        "B2B","B2C","Tech","Finance","Healthcare","FMCG","Automotive","India",
                        "UK","US","UAE","Enterprise","SMB","Mid-Market","Consumer",
                        "Decision Maker","Influencer","C-Suite","Manager","Young Adult",
                        "Senior","Female","Male","Urban","Rural","Tier-1","Tier-2",
                      ]} />
                  </div>
                </FullCol>
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader title="Core Demographics" subtitle="All fields are mandatory." />
              <FormGrid>
                <CreatableSingle label="Country" required value={form.country} onChange={v => setF("country", v)} suggestions={countryNames} placeholder="Select or type country..." />
                <CreatableSingle label="Language" required value={form.language} onChange={v => setF("language", v)} suggestions={LANGUAGE_LIST} placeholder="Select or type language..." />
                <NumberInput label="Age Min" required min="13" max="90" placeholder="e.g. 28" value={form.ageMin} onChange={setFE("ageMin")} />
                <NumberInput label="Age Max" required min="13" max="90" placeholder="e.g. 45" value={form.ageMax} onChange={setFE("ageMax")} />
                <CreatableSingle label="Gender" required value={form.gender} onChange={v => setF("gender", v)} suggestions={GENDER_LIST} placeholder="Select gender..." />
                <CreatableSingle label="Education Level" value={form.educationLevel} onChange={v => setF("educationLevel", v)} suggestions={EDUCATION_LIST} placeholder="Select or type..." />
                <CreatableSingle label="Marital Status" value={form.maritalStatus} onChange={v => setF("maritalStatus", v)} suggestions={MARITAL_STATUS_LIST} placeholder="Select..." />
                <CreatableSingle label="Children / Dependants" value={form.childrenStatus} onChange={v => setF("childrenStatus", v)} suggestions={KIDS_LIST} placeholder="Select..." />
                <CreatableSingle label="Annual Income (Personal)" value={form.annualIncome} onChange={v => setF("annualIncome", v)} suggestions={INCOME_LIST} placeholder="Select or type income range..." />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader title="Company Profile" subtitle="Fill for B2B personas. Leave blank for pure B2C / consumer personas." />
              <FormGrid>
                <CreatableSingle label="Designation / Job Title" value={form.designation} onChange={v => setF("designation", v)} suggestions={DESIGNATION_LIST} placeholder="Select or type designation..." />
                <CreatableSingle label="Function / Department" value={form.department} onChange={v => setF("department", v)} suggestions={DEPARTMENT_LIST} placeholder="Select or type department..." />
                <CreatableSingle label="Industry" value={form.industry} onChange={v => setF("industry", v)} suggestions={INDUSTRY_LIST} placeholder="Select or type industry..." />
                <CreatableSingle label="Company Revenue" value={form.companyRevenue} onChange={v => setF("companyRevenue", v)} suggestions={REVENUE_LIST} placeholder="Select or type revenue..." />
                <CreatableSingle label="Employee Size" value={form.employeeSize} onChange={v => setF("employeeSize", v)} suggestions={EMPLOYEE_LIST} placeholder="Select or type size..." />
              </FormGrid>
            </div>
          )}

          {/* ── STEP 2: Behaviour & Description ──────────────────────────── */}
          {step === 2 && (
            <div>
              <SectionHeader title="Behavioural Tags" subtitle="Multi-select tags that describe this persona's habits and mindset." />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                <label style={cs.label}>
                  Behavioural Tags
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 400 }}> — multi-select</span>
                </label>
                <TagInput value={form.behaviouralTags} onChange={v => setF("behaviouralTags", v)}
                  placeholder="Type or click suggestions to add tags..."
                  suggestions={BEHAVIOURAL_TAGS} />
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: FONT }}>
                  Click suggestions or type your own. Press Enter to add.
                </span>
              </div>

              <div style={s.divider} />

              <SectionHeader title="Persona Description"
                subtitle="A rich character brief that AI reads when answering survey questions. The more detail here, the more accurate and consistent the responses." />

              {/* AI Generate button */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 10,
              }}>
                <div style={s.aiHint}>
                  <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>✦</span>
                  <span>
                    Write as if briefing a human respondent. Include mindset, motivations,
                    habits, pain points, brand preferences, decision-making style, and
                    anything relevant to the survey topic. Or click <strong>Generate with AI</strong>.
                  </span>
                </div>
                <button
                  onClick={generateDescription}
                  disabled={aiLoading || !form.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: aiLoading ? "#f1f5f9" : "#ede9fe",
                    color: aiLoading ? "#94a3b8" : "#7c3aed",
                    border: "1.5px solid",
                    borderColor: aiLoading ? "#e2e8f0" : "#c4b5fd",
                    borderRadius: 8, padding: "9px 16px",
                    fontSize: "0.82rem", fontWeight: 600,
                    cursor: aiLoading || !form.name ? "not-allowed" : "pointer",
                    fontFamily: FONT, whiteSpace: "nowrap",
                    flexShrink: 0, marginLeft: 12,
                  }}
                  title={!form.name ? "Fill in Persona Name first" : "Generate persona description using AI"}
                >
                  {aiLoading
                    ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Generating...</>
                    : <><Sparkles size={14} /> Generate with AI</>
                  }
                </button>
              </div>

              <Textarea
                label="Persona Description"
                required
                placeholder={`Example:\n\n"Rajiv is a 40-year-old IT Manager at a mid-size manufacturing firm in Pune, India. He manages a team of 12 and is responsible for IT infrastructure and software procurement. He has a tight annual budget of ₹2 crore and requires CFO approval for purchases above ₹25 lakh. He is tech-savvy but cautious — frustrated by overpromising vendors and failed ERP migrations. He prefers cloud-first solutions with strong data residency controls, reads CIO blogs, and trusts peer recommendations over ads. He evaluates vendors on TCO, security certifications, and SLA quality..."`}
                rows={10}
                value={form.secondaryDescription}
                onChange={setFE("secondaryDescription")}
              />
            </div>
          )}

          {/* ── STEP 3: Execution Settings ────────────────────────────────── */}
          {step === 3 && (
            <div>
              <SectionHeader title="Device Type" subtitle="Which device does this persona use during survey sessions?" />
              <DeviceSelector
                value={form.deviceType}
                onChange={v => { setF("deviceType", v); setF("deviceOs", ""); }}
              />

              <div style={s.divider} />
              <SectionHeader title="Device & Browser" subtitle="Browser automation environment for this persona." />
              <FormGrid>
                <CreatableSingle label="Device OS" value={form.deviceOs} onChange={v => setF("deviceOs", v)}
                  suggestions={DEVICE_OS_MAP[form.deviceType] || []} placeholder="Select or type OS..." />
                <CreatableSingle label="Browser" value={form.browser} onChange={v => setF("browser", v)}
                  suggestions={BROWSER_LIST} placeholder="Select or type browser..." />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader title="AI Behaviour Settings" subtitle="Control how this persona's reading pace and response style is simulated." />
              <FormGrid>
                <CreatableSingle label="Reading Speed" value={form.readingSpeed} onChange={v => setF("readingSpeed", v)}
                  suggestions={READING_LIST} placeholder="Select..." />
                <CreatableSingle label="Response Style" value={form.responseStyle} onChange={v => setF("responseStyle", v)}
                  suggestions={RESPONSE_LIST} placeholder="Select..." />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader title="Summary" subtitle="Review before saving." />
              <div style={s.summary}>
                {summaryRows.map(([k, v]) => (
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

        {/* Footer */}
        <div style={s.modalFooter}>
          {step > 1 && (
            <button style={s.cancelBtn} onClick={() => setStep(ss => ss - 1)}>← Back</button>
          )}
          {step < 3 ? (
            <button style={s.nextBtn} onClick={() => {
              if (step === 1) {
                if (!form.name)     { setError("Persona name is required"); return; }
                if (!form.country)  { setError("Country is required"); return; }
                if (!form.language) { setError("Language is required"); return; }
                if (!form.ageMin)   { setError("Age Min is required"); return; }
                if (!form.ageMax)   { setError("Age Max is required"); return; }
                if (!form.gender)   { setError("Gender is required"); return; }
              }
              if (step === 2 && !form.secondaryDescription) {
                setError("Persona description is required — or click Generate with AI");
                return;
              }
              setError(""); setStep(ss => ss + 1);
            }}>
              Next →
            </button>
          ) : (
            <button
              style={{ ...s.nextBtn, opacity: loading ? 0.7 : 1 }}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Saving..." : mode === "edit" ? "Save Changes" : "Create Persona"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// VIEW PERSONA MODAL
// ══════════════════════════════════════════════════════════════════════════════
function ViewModal({ persona, onClose }) {
  const a = persona.behavioural_attrs || {};

  const Section = ({ title, rows }) => {
    const filled = rows.filter(([, v]) => v);
    if (filled.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={vm.sectionTitle}>{title}</div>
        {filled.map(([k, v]) => (
          <div key={k} style={vm.row}>
            <span style={vm.key}>{k}</span>
            <span style={vm.val}>{Array.isArray(v) ? v.join(", ") : v}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={s.overlay}>
      <div style={{ ...s.modal, maxWidth: 640 }}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>{persona.name}</h2>
            <p style={s.modalSub}>
              Persona Details
              {persona.ai_generated && (
                <span style={{ marginLeft: 8, background: "#ede9fe", color: "#7c3aed", borderRadius: 6, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                  ✦ AI Generated
                </span>
              )}
            </p>
          </div>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ ...s.modalBody, paddingTop: 16 }}>
          {/* Tags */}
          {((persona.tags?.length > 0) || (a.behaviouralTags?.length > 0)) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {(persona.tags || []).map(t => <span key={t} style={vm.tagLib}>{t}</span>)}
              {(a.behaviouralTags || []).map(t => <span key={t} style={vm.tagBeh}>{t}</span>)}
            </div>
          )}

          <Section title="Core Demographics" rows={[
            ["Country",          persona.country],
            ["Language",         persona.language],
            ["Age Range",        persona.age_min && persona.age_max ? `${persona.age_min} – ${persona.age_max}` : ""],
            ["Gender",           persona.gender ? toProper(persona.gender) : ""],
            ["Education",        a.educationLevel],
            ["Marital Status",   a.maritalStatus],
            ["Children",         a.childrenStatus],
            ["Annual Income",    a.annualIncome],
          ]} />

          <Section title="Company Profile" rows={[
            ["Designation",     a.designation],
            ["Department",      a.department],
            ["Industry",        a.industry],
            ["Company Revenue", a.companyRevenue],
            ["Employee Size",   a.employeeSize],
          ]} />

          <Section title="Execution Settings" rows={[
            ["Device Type",    toProper(persona.device_type)],
            ["Device OS",      a.deviceOs],
            ["Browser",        a.browser],
            ["Reading Speed",  a.readingSpeed],
            ["Response Style", a.responseStyle],
          ]} />

          {a.secondaryDescription && (
            <div style={{ marginBottom: 20 }}>
              <div style={vm.sectionTitle}>Persona Description</div>
              <div style={vm.descBox}>{a.secondaryDescription}</div>
            </div>
          )}
        </div>

        <div style={s.modalFooter}>
          <button style={s.nextBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const vm = {
  sectionTitle: { fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #f1f5f9" },
  row:     { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f8fafc" },
  key:     { fontSize: "0.82rem", fontWeight: 600, color: "#64748b", fontFamily: FONT, minWidth: 140 },
  val:     { fontSize: "0.82rem", color: "#1e293b", fontFamily: FONT, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" },
  tagLib:  { background: "#dbeafe", color: "#1e3a5f", borderRadius: 6, padding: "3px 9px", fontSize: "0.75rem", fontWeight: 600, fontFamily: FONT },
  tagBeh:  { background: "#ede9fe", color: "#5b21b6", borderRadius: 6, padding: "3px 9px", fontSize: "0.75rem", fontWeight: 600, fontFamily: FONT },
  descBox: { background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", fontSize: "0.85rem", color: "#1e293b", fontFamily: FONT, lineHeight: 1.7, whiteSpace: "pre-wrap" },
};

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAS TABLE
// ══════════════════════════════════════════════════════════════════════════════
const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

function PersonasTable({ personas, onDelete, onEdit, onDuplicate, onView }) {
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = [...personas].sort((a, b) => {
    let av, bv;
    if (sortKey === "name")       { av = a.name;        bv = b.name; }
    if (sortKey === "country")    { av = a.country;     bv = b.country; }
    if (sortKey === "age")        { av = a.age_min;     bv = b.age_min; }
    if (sortKey === "device")     { av = a.device_type; bv = b.device_type; }
    if (sortKey === "created_at") { av = a.created_at;  bv = b.created_at; }
    if (av == null) av = ""; if (bv == null) bv = "";
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ col }) => sortKey !== col
    ? <ChevronUp size={13} color="#cbd5e1" />
    : sortDir === "asc" ? <ChevronUp size={13} color="#2563eb" /> : <ChevronDown size={13} color="#2563eb" />;

  const TH = ({ label, col }) => (
    <th style={s.th} onClick={() => col && toggleSort(col)}>
      <div style={s.thInner}>{label}{col && <SortIcon col={col} />}</div>
    </th>
  );

  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <TH label="Persona Name"    col="name" />
            <TH label="Country"         col="country" />
            <TH label="Age"             col="age" />
            <TH label="Gender" />
            <TH label="Designation" />
            <TH label="Dept / Industry" />
            <TH label="Tags" />
            <TH label="Device"          col="device" />
            <TH label="Created"         col="created_at" />
            <th style={{ ...s.th, width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((persona, idx) => {
            const a       = persona.behavioural_attrs || {};
            const DevIcon = DEVICE_ICONS[persona.device_type] || Monitor;
            const deptInd = [a.department, a.industry].filter(Boolean).join(" / ");
            const allTags = [...(persona.tags || [])];

            return (
              <tr key={persona.id} style={{ ...s.tr, background: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                <td style={s.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={s.nameText}>{persona.name}</span>
                    {persona.ai_generated && (
                      <span title="AI Generated" style={{ fontSize: "0.65rem", color: "#7c3aed", background: "#ede9fe", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>✦ AI</span>
                    )}
                  </div>
                </td>
                <td style={s.td}><span style={s.cellText}>{persona.country || "—"}</span></td>
                <td style={s.td}>
                  <span style={s.cellText}>
                    {persona.age_min && persona.age_max ? `${persona.age_min}–${persona.age_max}` : "—"}
                  </span>
                </td>
                <td style={s.td}>
                  {persona.gender
                    ? <span style={s.chip}>{toProper(persona.gender)}</span>
                    : <span style={s.cellMuted}>—</span>}
                </td>
                <td style={s.td}><span style={s.cellText}>{a.designation || "—"}</span></td>
                <td style={s.td}><span style={s.cellText}>{deptInd || "—"}</span></td>
                <td style={s.td}>
                  <div style={s.tagCell}>
                    {allTags.length > 0
                      ? allTags.map(tag => <span key={tag} style={s.tagPill}>{tag}</span>)
                      : <span style={s.cellMuted}>—</span>}
                  </div>
                </td>
                <td style={s.td}>
                  <div style={s.deviceCell}>
                    <DevIcon size={14} color="#64748b" />
                    <span style={s.cellText}>
                      {toProper(persona.device_type)}{a.deviceOs ? ` / ${a.deviceOs}` : ""}
                    </span>
                  </div>
                </td>
                <td style={s.td}>
                  <span style={s.cellMuted}>
                    {new Date(persona.created_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    <button style={s.viewBtn}   title="View"      onClick={() => onView(persona)}>      <Eye     size={13} /></button>
                    <button style={s.dupBtn}    title="Duplicate" onClick={() => onDuplicate(persona)}> <Copy    size={13} /></button>
                    <button style={s.editBtn}   title="Edit"      onClick={() => onEdit(persona)}>      <Pencil  size={13} /></button>
                    <button style={s.deleteBtn} title="Delete"    onClick={() => onDelete(persona.id)}> <Trash2  size={13} /></button>
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

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function Personas() {
  const [personas,    setPersonas]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [editPersona, setEditPersona] = useState(null);
  const [viewPersona, setViewPersona] = useState(null);
  const [search,      setSearch]      = useState("");
  const [filterType,  setFilterType]  = useState("all"); // all | b2b | b2c
  const [filterTag,   setFilterTag]   = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/personas");
      setPersonas(res.data?.personas || []);
    } catch (err) {
      console.error("Failed to load personas", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    const res = await api.post("/personas", form);
    setPersonas(prev => [res.data.persona, ...prev]);
  };

  const handleEdit = async (form) => {
    const res = await api.patch(`/personas/${editPersona.id}`, form);
    setPersonas(prev => prev.map(p => p.id === editPersona.id ? res.data.persona : p));
    setEditPersona(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this persona? This cannot be undone.")) return;
    try {
      await api.delete(`/personas/${id}`);
      setPersonas(prev => prev.filter(p => p.id !== id));
    } catch { alert("Failed to delete persona"); }
  };

  const handleDuplicate = async (persona) => {
    try {
      const form = attrsToForm(persona);
      form.name = `Copy of ${form.name}`;
      const res = await api.post("/personas", form);
      setPersonas(prev => [res.data.persona, ...prev]);
    } catch { alert("Failed to duplicate persona"); }
  };

  // Collect all unique library tags for filter dropdown
  const allTags = [...new Set(personas.flatMap(p => p.tags || []))].sort();

  const filtered = personas.filter(p => {
    const a  = p.behavioural_attrs || {};
    const q  = search.toLowerCase();
    const isB2B = !!(a.designation || a.department || a.industry);

    if (filterType === "b2b" && !isB2B) return false;
    if (filterType === "b2c" && isB2B)  return false;
    if (filterTag && !(p.tags || []).includes(filterTag)) return false;

    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (a.designation || "").toLowerCase().includes(q) ||
      (a.department  || "").toLowerCase().includes(q) ||
      (a.industry    || "").toLowerCase().includes(q) ||
      (p.country     || "").toLowerCase().includes(q) ||
      (a.behaviouralTags || []).some(t => t.toLowerCase().includes(q))
    );
  });

  return (
    <Layout title="Persona Library">
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
          <Search size={16} color="#94a3b8" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            style={{ ...s.search, paddingLeft: 38 }}
            placeholder="Search by name, tag, designation, industry..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {/* B2B / B2C filter */}
        <select
          style={s.filterSel}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All Types</option>
          <option value="b2b">B2B Only</option>
          <option value="b2c">B2C Only</option>
        </select>
        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            style={s.filterSel}
            value={filterTag}
            onChange={e => setFilterTag(e.target.value)}
          >
            <option value="">All Tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button style={s.createBtn} onClick={() => setShowCreate(true)}>
          <Plus size={18} /> New Persona
        </button>
      </div>

      {/* Results bar */}
      {!loading && (
        <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 14, fontFamily: FONT }}>
          {filtered.length} persona{filtered.length !== 1 ? "s" : ""} in library
          {(search || filterType !== "all" || filterTag) && filtered.length !== personas.length
            ? ` (filtered from ${personas.length})`
            : ""}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={s.center}>Loading personas...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <Users size={52} color="#cbd5e1" />
          <h3 style={s.emptyTitle}>
            {search || filterType !== "all" || filterTag
              ? "No personas match your filters"
              : "No Personas Yet"}
          </h3>
          <p style={s.emptyDesc}>
            {search || filterType !== "all" || filterTag
              ? "Try adjusting your search or filters."
              : "Build respondent personas to guide AI answer behaviour across survey sessions."}
          </p>
          {!search && filterType === "all" && !filterTag && (
            <button style={s.createBtn} onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New Persona
            </button>
          )}
        </div>
      ) : (
        <PersonasTable
          personas={filtered}
          onDelete={handleDelete}
          onEdit={p => setEditPersona(p)}
          onDuplicate={handleDuplicate}
          onView={p => setViewPersona(p)}
        />
      )}

      {/* Modals */}
      {showCreate && (
        <PersonaForm
          key="create"
          mode="create"
          initial={{}}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editPersona && (
        <PersonaForm
          key={editPersona.id}       // ← forces full remount when different persona is edited
          mode="edit"
          initial={attrsToForm(editPersona)}
          onSubmit={handleEdit}
          onClose={() => setEditPersona(null)}
        />
      )}
      {viewPersona && (
        <ViewModal persona={viewPersona} onClose={() => setViewPersona(null)} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════════════════
const s = {
  search:     { width: "100%", padding: "10px 16px 10px 38px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: "0.88rem", outline: "none", background: "white", color: "#1e293b", fontFamily: FONT, boxSizing: "border-box" },
  filterSel:  { padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: "0.85rem", fontFamily: FONT, outline: "none", background: "white", color: "#1e293b", cursor: "pointer" },
  createBtn:  { display: "flex", alignItems: "center", gap: 8, background: "#1e3a5f", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: FONT },
  center:     { textAlign: "center", padding: 60, color: "#64748b", fontFamily: FONT },
  empty:      { background: "white", borderRadius: 12, padding: "80px 40px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  emptyTitle: { fontSize: "1.1rem", fontWeight: 700, color: "#1e293b", fontFamily: FONT },
  emptyDesc:  { color: "#64748b", fontSize: "0.9rem", maxWidth: 400, lineHeight: 1.6, fontFamily: FONT },

  tableWrap:  { background: "white", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1.5px solid #e2e8f0", overflow: "auto" },
  table:      { width: "100%", borderCollapse: "collapse", minWidth: 1000 },
  theadRow:   { background: "#f8fafc", borderBottom: "2px solid #e2e8f0" },
  th:         { padding: "12px 14px", textAlign: "left", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" },
  thInner:    { display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: "#374151", fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.4 },
  tr:         { borderBottom: "1px solid #f1f5f9", transition: "background 0.1s" },
  td:         { padding: "11px 14px", verticalAlign: "middle" },
  nameText:   { fontSize: "0.88rem", fontWeight: 600, color: "#1e293b", fontFamily: FONT },
  cellText:   { fontSize: "0.82rem", color: "#475569", fontFamily: FONT },
  cellMuted:  { fontSize: "0.82rem", color: "#cbd5e1", fontFamily: FONT },
  chip:       { background: "#f1f5f9", color: "#475569", borderRadius: 6, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 500, fontFamily: FONT },
  tagCell:    { display: "flex", flexWrap: "wrap", gap: 4 },
  tagPill:    { background: "#dbeafe", color: "#1e3a5f", borderRadius: 6, padding: "2px 7px", fontSize: "0.72rem", fontWeight: 600, fontFamily: FONT },
  deviceCell: { display: "flex", alignItems: "center", gap: 5 },

  viewBtn:    { background: "#f8fafc", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b", padding: "5px 6px", borderRadius: 6, display: "flex" },
  dupBtn:     { background: "#f0fdf4", border: "1px solid #bbf7d0", cursor: "pointer", color: "#059669", padding: "5px 6px", borderRadius: 6, display: "flex" },
  editBtn:    { background: "#f0f7ff", border: "1px solid #dbeafe", cursor: "pointer", color: "#2563eb", padding: "5px 6px", borderRadius: 6, display: "flex" },
  deleteBtn:  { background: "#fef2f2", border: "1px solid #fecaca", cursor: "pointer", color: "#ef4444", padding: "5px 6px", borderRadius: 6, display: "flex" },

  overlay:    { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  modal:      { background: "white", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 50px rgba(0,0,0,0.3)" },
  modalHeader:{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px 0" },
  modalTitle: { fontSize: "1.2rem", fontWeight: 700, color: "#1e293b", marginBottom: 4, fontFamily: FONT },
  modalSub:   { fontSize: "0.82rem", color: "#64748b", fontFamily: FONT },
  closeBtn:   { background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4 },
  stepRow:    { display: "flex", alignItems: "center", padding: "16px 28px 0", gap: 0 },
  stepItem:   { display: "flex", alignItems: "center", flex: 1 },
  stepDot:    { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", fontWeight: 700, flexShrink: 0, fontFamily: FONT, transition: "all 0.2s" },
  stepLabel:  { fontSize: "0.72rem", fontWeight: 600, marginLeft: 6, fontFamily: FONT, whiteSpace: "nowrap", transition: "color 0.2s" },
  stepLine:   { flex: 1, height: 2, margin: "0 8px", transition: "background 0.2s", minWidth: 20 },
  modalBody:  { flex: 1, overflowY: "auto", padding: "20px 28px" },
  modalFooter:{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "16px 28px", borderTop: "1px solid #f1f5f9" },
  divider:    { height: 1, background: "#f1f5f9", margin: "20px 0" },
  aiHint:     { display: "flex", gap: 10, background: "#f0f7ff", border: "1.5px solid #dbeafe", borderRadius: 10, padding: "12px 16px", fontSize: "0.82rem", color: "#1e3a5f", fontFamily: FONT, lineHeight: 1.6, alignItems: "flex-start", flex: 1 },
  summary:    { background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 16 },
  summaryRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #f1f5f9" },
  summaryKey: { fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", fontFamily: FONT, minWidth: 130 },
  summaryVal: { fontSize: "0.82rem", color: "#1e293b", fontFamily: FONT, textAlign: "right", maxWidth: "65%", wordBreak: "break-word" },
  error:      { display: "flex", alignItems: "center", gap: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: "0.85rem", marginTop: 12, fontFamily: FONT },
  cancelBtn:  { background: "none", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "9px 20px", fontSize: "0.88rem", cursor: "pointer", color: "#64748b", fontWeight: 500, fontFamily: FONT },
  nextBtn:    { background: "#1e3a5f", color: "white", border: "none", borderRadius: 8, padding: "9px 24px", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", fontFamily: FONT },
};