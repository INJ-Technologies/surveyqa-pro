import React, { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import api from '../api'
import {
  Select, Input, Textarea, NumberInput, FormGrid, FullCol, SectionHeader
} from '../components/FormElements'
import {
  Users, Plus, X, Monitor, Smartphone, Tablet,
  ChevronRight, Tag, Globe, AlertCircle, Trash2, Search
} from 'lucide-react'

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

// ─── Options ──────────────────────────────────────────────────────────────────
const GENDER_OPTIONS = [
  { value: 'male',       label: 'Male'       },
  { value: 'female',     label: 'Female'     },
  { value: 'non_binary', label: 'Non-Binary' },
  { value: 'any',        label: 'Any'        },
]

const COUNTRY_OPTIONS = [
  { value: 'IN', label: '🇮🇳 India' },
  { value: 'US', label: '🇺🇸 United States' },
  { value: 'GB', label: '🇬🇧 United Kingdom' },
  { value: 'AU', label: '🇦🇺 Australia' },
  { value: 'CA', label: '🇨🇦 Canada' },
  { value: 'DE', label: '🇩🇪 Germany' },
  { value: 'FR', label: '🇫🇷 France' },
  { value: 'SG', label: '🇸🇬 Singapore' },
  { value: 'AE', label: '🇦🇪 UAE' },
  { value: 'JP', label: '🇯🇵 Japan' },
  { value: 'BR', label: '🇧🇷 Brazil' },
  { value: 'MX', label: '🇲🇽 Mexico' },
  { value: 'ZA', label: '🇿🇦 South Africa' },
  { value: 'NG', label: '🇳🇬 Nigeria' },
  { value: 'ID', label: '🇮🇩 Indonesia' },
  { value: 'PH', label: '🇵🇭 Philippines' },
  { value: 'MY', label: '🇲🇾 Malaysia' },
  { value: 'TH', label: '🇹🇭 Thailand' },
  { value: 'VN', label: '🇻🇳 Vietnam' },
  { value: 'KR', label: '🇰🇷 South Korea' },
  { value: 'CN', label: '🇨🇳 China' },
]

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
]

const DEPARTMENT_OPTIONS = [
  { value: 'IT',           label: 'IT / Technology'         },
  { value: 'Finance',      label: 'Finance / Accounting'    },
  { value: 'HR',           label: 'HR / People'             },
  { value: 'Marketing',    label: 'Marketing'               },
  { value: 'Sales',        label: 'Sales / Business Dev'    },
  { value: 'Operations',   label: 'Operations'              },
  { value: 'Procurement',  label: 'Procurement / Sourcing'  },
  { value: 'Legal',        label: 'Legal / Compliance'      },
  { value: 'C-Suite',      label: 'C-Suite / Executive'     },
  { value: 'Product',      label: 'Product / Design'        },
  { value: 'Engineering',  label: 'Engineering / R&D'       },
  { value: 'Other',        label: 'Other'                   },
]

const REVENUE_OPTIONS = [
  { value: 'under_1m',     label: 'Under $1M'        },
  { value: '1m_10m',       label: '$1M – $10M'       },
  { value: '10m_50m',      label: '$10M – $50M'      },
  { value: '50m_500m',     label: '$50M – $500M'     },
  { value: '500m_1b',      label: '$500M – $1B'      },
  { value: 'over_1b',      label: 'Over $1B'         },
]

const EMPLOYEE_OPTIONS = [
  { value: '1_50',         label: '1 – 50'           },
  { value: '51_200',       label: '51 – 200'         },
  { value: '201_1000',     label: '201 – 1,000'      },
  { value: '1001_5000',    label: '1,001 – 5,000'    },
  { value: '5000_plus',    label: '5,000+'           },
]

const BEHAVIOURAL_TAGS = [
  'Online Shopper', 'Brand Conscious', 'Early Adopter', 'Budget Conscious',
  'Health Conscious', 'Frequent Traveller', 'Social Media Active', 'Tech Savvy',
  'Environmentally Conscious', 'Luxury Buyer', 'Deal Hunter', 'Impulse Buyer',
  'Research-Driven', 'Loyalty Programme Member', 'Mobile-First', 'Decision Maker',
]

const DEVICE_OS_MAP = {
  desktop: [
    { value: 'windows', label: 'Windows' },
    { value: 'macos',   label: 'macOS'   },
    { value: 'linux',   label: 'Linux'   },
  ],
  mobile: [
    { value: 'android', label: 'Android' },
    { value: 'ios',     label: 'iOS'     },
  ],
  tablet: [
    { value: 'android', label: 'Android' },
    { value: 'ios',     label: 'iPadOS'  },
  ],
}

const BROWSER_OPTIONS = [
  { value: 'chrome',  label: 'Chrome'  },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari',  label: 'Safari'  },
  { value: 'edge',    label: 'Edge'    },
]

const READING_SPEED_OPTIONS = [
  { value: 'slow',   label: 'Slow — reads carefully, takes longer'      },
  { value: 'normal', label: 'Normal — average reading pace'             },
  { value: 'fast',   label: 'Fast — skims quickly through content'      },
]

const RESPONSE_STYLE_OPTIONS = [
  { value: 'conservative', label: 'Conservative — neutral, measured answers'    },
  { value: 'neutral',      label: 'Neutral — balanced, neither extreme'          },
  { value: 'expressive',   label: 'Expressive — detailed, opinionated responses' },
]

// ─── Tag Input ────────────────────────────────────────────────────────────────
function TagInput({ value = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput] = useState('')
  const [showSug, setShowSug] = useState(false)

  const add = (tag) => {
    const t = tag.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
    setShowSug(false)
  }

  const remove = (tag) => onChange(value.filter(t => t !== tag))

  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  )

  return (
    <div style={t.wrap}>
      <div style={t.tagBox}>
        {value.map(tag => (
          <span key={tag} style={t.tag}>
            {tag}
            <button style={t.tagX} onClick={() => remove(tag)}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          style={t.tagInput}
          value={input}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={e => { setInput(e.target.value); setShowSug(true) }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
              e.preventDefault(); add(input)
            }
            if (e.key === 'Backspace' && !input && value.length > 0) {
              remove(value[value.length - 1])
            }
          }}
          onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
        />
      </div>
      {showSug && input && filtered.length > 0 && (
        <div style={t.sugBox}>
          {filtered.slice(0, 6).map(s => (
            <div key={s} style={t.sugItem} onMouseDown={() => add(s)}>{s}</div>
          ))}
        </div>
      )}
      {showSug && !input && suggestions.length > 0 && (
        <div style={t.sugBox}>
          <div style={t.sugLabel}>Suggestions</div>
          {suggestions.filter(s => !value.includes(s)).slice(0, 8).map(s => (
            <div key={s} style={t.sugItem} onMouseDown={() => add(s)}>{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

const t = {
  wrap:     { position: 'relative' },
  tagBox:   { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, background: 'white', minHeight: 42, cursor: 'text', alignItems: 'center' },
  tag:      { display: 'flex', alignItems: 'center', gap: 4, background: '#dbeafe', color: '#1e3a5f', borderRadius: 6, padding: '3px 8px', fontSize: '0.78rem', fontWeight: 600, fontFamily: FONT },
  tagX:     { background: 'none', border: 'none', cursor: 'pointer', color: '#1e3a5f', padding: 0, display: 'flex', alignItems: 'center' },
  tagInput: { border: 'none', outline: 'none', fontSize: '0.88rem', fontFamily: FONT, color: '#1e293b', flex: 1, minWidth: 120, background: 'transparent' },
  sugBox:   { position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, marginTop: 4, overflow: 'hidden' },
  sugLabel: { fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', padding: '8px 12px 4px', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.5 },
  sugItem:  { padding: '9px 12px', fontSize: '0.85rem', cursor: 'pointer', color: '#1e293b', fontFamily: FONT, transition: 'background 0.1s' },
}

// ─── Device Selector ─────────────────────────────────────────────────────────
function DeviceSelector({ value, onChange }) {
  const devices = [
    { key: 'desktop', label: 'Desktop', icon: Monitor  },
    { key: 'mobile',  label: 'Mobile',  icon: Smartphone },
    { key: 'tablet',  label: 'Tablet',  icon: Tablet   },
  ]
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {devices.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, padding: '14px 8px', border: '1.5px solid',
            borderColor: value === key ? '#2563eb' : '#e2e8f0',
            borderRadius: 10, background: value === key ? '#f0f7ff' : 'white',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          <Icon size={22} color={value === key ? '#2563eb' : '#94a3b8'} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: FONT,
            color: value === key ? '#1e3a5f' : '#64748b' }}>
            {label}
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Create Persona Modal ─────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step,    setStep]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const [form, setForm] = useState({
    // Step 1 — Core
    name:            '',
    tags:            [],
    country:         '',
    language:        'en',
    ageMin:          '',
    ageMax:          '',
    gender:          '',
    designation:     '',
    department:      '',
    companyRevenue:  '',
    employeeSize:    '',
    // Step 2 — Secondary
    secondaryDescription: '',
    behaviouralTags:      [],
    // Step 3 — Execution
    deviceType:     'desktop',
    deviceOs:       '',
    browser:        'chrome',
    readingSpeed:   'normal',
    responseStyle:  'neutral',
  })

  const setF  = (k, v)    => setForm(f => ({ ...f, [k]: v }))
  const setFE = (k) => (e) => setF(k, e.target.value)

  const handleSubmit = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/personas', form)
      onCreated(res.data.persona)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create persona')
    } finally {
      setLoading(false)
    }
  }

  const STEPS = ['Core Demographics', 'Secondary Demographics', 'Execution Settings']

  return (
    <div style={s.overlay}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>New Persona</h2>
            <p style={s.modalSub}>Step {step} of 3 — {STEPS[step - 1]}</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Step indicators */}
        <div style={s.stepRow}>
          {STEPS.map((label, i) => (
            <div key={i} style={s.stepItem}>
              <div style={{
                ...s.stepDot,
                background: step > i + 1 ? '#059669' : step === i + 1 ? '#1e3a5f' : '#e2e8f0',
                color: step >= i + 1 ? 'white' : '#94a3b8',
              }}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span style={{ ...s.stepLabel, color: step === i + 1 ? '#1e3a5f' : '#94a3b8' }}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div style={{ ...s.stepLine, background: step > i + 1 ? '#059669' : '#e2e8f0' }} />
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
                  <Input label="Persona Name" required
                    placeholder='e.g. "Senior IT Manager — India" or "Urban Female Consumer — 25-34"'
                    value={form.name}
                    onChange={setFE('name')}
                  />
                </FullCol>
                <FullCol>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={s.label}>Tags <span style={s.hint}>— for filtering in library</span></label>
                    <TagInput
                      value={form.tags}
                      onChange={v => setF('tags', v)}
                      placeholder="Type a tag and press Enter..."
                      suggestions={['B2B', 'B2C', 'Tech', 'Finance', 'Healthcare', 'FMCG', 'Automotive', 'India', 'US', 'Enterprise', 'SMB', 'Consumer']}
                    />
                  </div>
                </FullCol>
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="Demographics"
                subtitle="Fill what's relevant. Non-mandatory fields can be left blank for consumer personas."
              />
              <FormGrid>
                <Select label="Country"
                  options={COUNTRY_OPTIONS} value={form.country}
                  onChange={v => setF('country', v)}
                  placeholder="Select country..."
                />
                <Select label="Language"
                  options={LANGUAGE_OPTIONS} value={form.language}
                  onChange={v => setF('language', v)}
                />
                <NumberInput label="Age Min" min="16" max="80" placeholder="e.g. 28"
                  value={form.ageMin} onChange={setFE('ageMin')} />
                <NumberInput label="Age Max" min="16" max="80" placeholder="e.g. 45"
                  value={form.ageMax} onChange={setFE('ageMax')} />
                <Select label="Gender"
                  options={GENDER_OPTIONS} value={form.gender}
                  onChange={v => setF('gender', v)}
                  placeholder="Select gender..."
                />
                <Input label="Designation / Job Title"
                  placeholder="e.g. IT Manager, CTO, Homemaker"
                  value={form.designation} onChange={setFE('designation')}
                />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="Company Profile"
                subtitle="Optional — leave blank for consumer (B2C) personas."
              />
              <FormGrid>
                <Select label="Function / Department"
                  options={DEPARTMENT_OPTIONS} value={form.department}
                  onChange={v => setF('department', v)}
                  placeholder="Select department..."
                />
                <div /> {/* spacer */}
                <Select label="Company Revenue"
                  options={REVENUE_OPTIONS} value={form.companyRevenue}
                  onChange={v => setF('companyRevenue', v)}
                  placeholder="Select revenue range..."
                />
                <Select label="Employee Size"
                  options={EMPLOYEE_OPTIONS} value={form.employeeSize}
                  onChange={v => setF('employeeSize', v)}
                  placeholder="Select company size..."
                />
              </FormGrid>
            </div>
          )}

          {/* ── Step 2: Secondary Demographics ── */}
          {step === 2 && (
            <div>
              <SectionHeader
                title="Persona Description"
                subtitle="Describe this persona in plain language. The AI reads this directly when answering survey questions — the more detail you provide, the more accurate and consistent the responses will be."
              />

              <div style={s.aiHint}>
                <span style={s.aiHintIcon}>✦</span>
                <span>Write as if briefing a human respondent. Include mindset, motivations, habits, pain points, preferences — anything relevant to the survey topic.</span>
              </div>

              <Textarea
                label="Persona Description"
                required
                placeholder={`Example:\n\n"This is a senior IT decision-maker at a mid-size manufacturing company with 500-1000 employees. He is 38 years old, based in Mumbai, and has been in the industry for 12+ years. He is responsible for approving software and infrastructure purchases above $50K. He is tech-savvy but budget-conscious, frustrated with vendor lock-in, and actively looking for cloud-first solutions. He reads CIO magazines, attends industry webinars, and trusts peer recommendations over vendor marketing. He is skeptical of sales pitches and responds well to ROI-based arguments."`}
                rows={10}
                value={form.secondaryDescription}
                onChange={setFE('secondaryDescription')}
              />

              <div style={s.divider} />
              <SectionHeader
                title="Behavioural Tags"
                subtitle="Quick-select tags that describe this persona's behaviour. These supplement the description above."
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={s.label}>Behavioural Tags</label>
                <TagInput
                  value={form.behaviouralTags}
                  onChange={v => setF('behaviouralTags', v)}
                  placeholder="Select or type custom tags..."
                  suggestions={BEHAVIOURAL_TAGS}
                />
                <span style={s.hintText}>Click suggestions or type your own. Press Enter to add.</span>
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
                onChange={v => { setF('deviceType', v); setF('deviceOs', '') }}
              />

              <div style={s.divider} />
              <SectionHeader
                title="Device & Browser Settings"
                subtitle="These settings configure the browser automation environment for this persona."
              />
              <FormGrid>
                <Select label="Device OS"
                  options={DEVICE_OS_MAP[form.deviceType] || []}
                  value={form.deviceOs}
                  onChange={v => setF('deviceOs', v)}
                  placeholder="Select OS..."
                />
                <Select label="Browser"
                  options={BROWSER_OPTIONS}
                  value={form.browser}
                  onChange={v => setF('browser', v)}
                />
              </FormGrid>

              <div style={s.divider} />
              <SectionHeader
                title="AI Behaviour Settings"
                subtitle="Control how this persona's reading and response style is simulated."
              />
              <FormGrid>
                <Select
                  label="Reading Speed"
                  options={READING_SPEED_OPTIONS}
                  value={form.readingSpeed}
                  onChange={v => setF('readingSpeed', v)}
                  hint="Affects how long the bot waits on each survey page."
                />
                <Select
                  label="Response Style"
                  options={RESPONSE_STYLE_OPTIONS}
                  value={form.responseStyle}
                  onChange={v => setF('responseStyle', v)}
                  hint="Affects tone and length of open-ended responses."
                />
              </FormGrid>

              {/* Summary preview */}
              <div style={s.divider} />
              <SectionHeader title="Summary" subtitle="Review before creating." />
              <div style={s.summary}>
                <div style={s.summaryRow}><span style={s.summaryKey}>Name</span><span style={s.summaryVal}>{form.name || '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Country</span><span style={s.summaryVal}>{COUNTRY_OPTIONS.find(c => c.value === form.country)?.label || '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Age Range</span><span style={s.summaryVal}>{form.ageMin && form.ageMax ? `${form.ageMin} – ${form.ageMax}` : '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Gender</span><span style={s.summaryVal}>{form.gender || '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Device</span><span style={s.summaryVal}>{form.deviceType} / {form.deviceOs || '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Tags</span><span style={s.summaryVal}>{form.tags.length > 0 ? form.tags.join(', ') : '—'}</span></div>
                <div style={s.summaryRow}><span style={s.summaryKey}>Description</span><span style={s.summaryVal}>{form.secondaryDescription ? `${form.secondaryDescription.slice(0, 80)}...` : '—'}</span></div>
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
          {step > 1 && <button style={s.cancelBtn} onClick={() => setStep(s => s - 1)}>← Back</button>}
          {step < 3
            ? <button style={s.nextBtn} onClick={() => {
                if (step === 1 && !form.name) { setError('Persona name is required'); return }
                if (step === 2 && !form.secondaryDescription) { setError('Persona description is required'); return }
                setError(''); setStep(s => s + 1)
              }}>Next →</button>
            : <button style={{ ...s.nextBtn, opacity: loading ? 0.7 : 1 }}
                onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating...' : 'Create Persona'}
              </button>
          }
        </div>

      </div>
    </div>
  )
}

// ─── Persona Card ─────────────────────────────────────────────────────────────
const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet }

function PersonaCard({ persona, onDelete }) {
  const attrs   = persona.behavioural_attrs || {}
  const country = COUNTRY_OPTIONS.find(c => c.value === persona.country)
  const DevIcon = DEVICE_ICONS[persona.device_type] || Monitor

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={s.cardTitle}>{persona.name}</h3>
          {country && <span style={s.cardCountry}>{country.label}</span>}
        </div>
        <button style={s.deleteBtn} onClick={e => { e.stopPropagation(); onDelete(persona.id) }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Age / Gender / Designation row */}
      <div style={s.cardMeta}>
        {persona.age_min && persona.age_max && (
          <span style={s.metaChip}>Age {persona.age_min}–{persona.age_max}</span>
        )}
        {persona.gender && (
          <span style={s.metaChip}>{persona.gender.charAt(0).toUpperCase() + persona.gender.slice(1)}</span>
        )}
        {attrs.designation && (
          <span style={s.metaChip}>{attrs.designation}</span>
        )}
      </div>

      {/* Description preview */}
      {attrs.secondaryDescription && (
        <p style={s.cardDesc}>{attrs.secondaryDescription}</p>
      )}

      {/* Behavioural tags */}
      {attrs.behaviouralTags && attrs.behaviouralTags.length > 0 && (
        <div style={s.tagRow}>
          {attrs.behaviouralTags.slice(0, 3).map(tag => (
            <span key={tag} style={s.tagChip}>{tag}</span>
          ))}
          {attrs.behaviouralTags.length > 3 && (
            <span style={s.tagMore}>+{attrs.behaviouralTags.length - 3}</span>
          )}
        </div>
      )}

      {/* Tags */}
      {persona.tags && persona.tags.length > 0 && (
        <div style={s.tagRow}>
          {persona.tags.map(tag => (
            <span key={tag} style={s.libTag}>{tag}</span>
          ))}
        </div>
      )}

      <div style={s.cardFooter}>
        <div style={s.deviceBadge}>
          <DevIcon size={13} />
          <span>{persona.device_type} {attrs.deviceOs ? `/ ${attrs.deviceOs}` : ''}</span>
        </div>
        <span style={s.cardDate}>
          {new Date(persona.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </div>
  )
}

// ─── Main Personas Page ───────────────────────────────────────────────────────
export default function Personas() {
  const [personas,  setPersonas]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [search,    setSearch]    = useState('')

  const load = async () => {
    try {
      const res = await api.get('/personas')
      setPersonas(res.data?.personas || [])
    } catch (err) {
      console.error('Failed to load personas', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this persona? This cannot be undone.')) return
    try {
      await api.delete(`/personas/${id}`)
      setPersonas(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      alert('Failed to delete persona')
    }
  }

  const filtered = personas.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase())) ||
    ((p.behavioural_attrs?.designation || '')).toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout title="Persona Library">

      <div style={s.toolbar}>
        <div style={s.searchWrap}>
          <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            style={s.search}
            placeholder="Search personas by name, tag or designation..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button style={s.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Persona
        </button>
      </div>

      {!loading && (
        <div style={s.resultsBar}>
          {filtered.length} persona{filtered.length !== 1 ? 's' : ''} in library
        </div>
      )}

      {loading ? (
        <div style={s.center}>Loading personas...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <Users size={52} color="#cbd5e1" />
          <h3 style={s.emptyTitle}>{search ? 'No personas match your search' : 'No Personas Yet'}</h3>
          <p style={s.emptyDesc}>
            {search ? 'Try a different search term.' : 'Build respondent personas to guide AI answer behaviour across survey sessions.'}
          </p>
          {!search && (
            <button style={s.createBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Persona
            </button>
          )}
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map(p => (
            <PersonaCard key={p.id} persona={p} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreated={persona => setPersonas(prev => [persona, ...prev])}
        />
      )}

    </Layout>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  toolbar:    { display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' },
  searchWrap: { flex: 1, position: 'relative' },
  search:     { width: '100%', padding: '10px 16px 10px 38px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.88rem', outline: 'none', background: 'white', color: '#1e293b', fontFamily: FONT },
  createBtn:  { display: 'flex', alignItems: 'center', gap: 8, background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: FONT },
  resultsBar: { fontSize: '0.8rem', color: '#94a3b8', marginBottom: 16, fontFamily: FONT },

  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  card:       { background: 'linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%)', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1.5px solid #ede9fe', transition: 'all 0.15s', cursor: 'default' },
  cardTop:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  cardTitle:  { fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT, marginBottom: 3 },
  cardCountry:{ fontSize: '0.78rem', color: '#64748b', fontFamily: FONT },
  deleteBtn:  { background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', padding: 4, borderRadius: 6, display: 'flex', transition: 'color 0.15s' },
  cardMeta:   { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaChip:   { background: '#f1f5f9', color: '#475569', borderRadius: 6, padding: '3px 8px', fontSize: '0.75rem', fontWeight: 500, fontFamily: FONT },
  cardDesc:   { fontSize: '0.80rem', color: '#64748b', lineHeight: 1.55, marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontFamily: FONT },
  tagRow:     { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 },
  tagChip:    { background: '#ede9fe', color: '#5b21b6', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, fontFamily: FONT },
  libTag:     { background: '#f0fdf4', color: '#166534', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, fontFamily: FONT },
  tagMore:    { background: '#f1f5f9', color: '#94a3b8', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', fontFamily: FONT },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #ede9fe', paddingTop: 10, marginTop: 4 },
  deviceBadge:{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: '#64748b', fontFamily: FONT },
  cardDate:   { fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT },

  center:     { textAlign: 'center', padding: 60, color: '#64748b', fontFamily: FONT },
  empty:      { background: 'white', borderRadius: 12, padding: '80px 40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT },
  emptyDesc:  { color: '#64748b', fontSize: '0.9rem', maxWidth: 400, lineHeight: 1.6, fontFamily: FONT },

  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal:      { background: 'white', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' },
  modalHeader:{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 28px 0' },
  modalTitle: { fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', marginBottom: 4, fontFamily: FONT },
  modalSub:   { fontSize: '0.82rem', color: '#64748b', fontFamily: FONT },
  closeBtn:   { background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 },

  stepRow:    { display: 'flex', alignItems: 'center', padding: '16px 28px 0', gap: 0 },
  stepItem:   { display: 'flex', alignItems: 'center', flex: 1 },
  stepDot:    { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0, fontFamily: FONT, transition: 'all 0.2s' },
  stepLabel:  { fontSize: '0.72rem', fontWeight: 600, marginLeft: 6, fontFamily: FONT, whiteSpace: 'nowrap', transition: 'color 0.2s' },
  stepLine:   { flex: 1, height: 2, margin: '0 8px', transition: 'background 0.2s', minWidth: 20 },

  modalBody:  { flex: 1, overflowY: 'auto', padding: '20px 28px' },
  modalFooter:{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 28px', borderTop: '1px solid #f1f5f9' },

  divider:    { height: 1, background: '#f1f5f9', margin: '20px 0' },
  label:      { fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT },
  hint:       { fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 },
  hintText:   { fontSize: '0.75rem', color: '#94a3b8', fontFamily: FONT },

  aiHint:     { display: 'flex', gap: 10, background: '#f0f7ff', border: '1.5px solid #dbeafe', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: '0.82rem', color: '#1e3a5f', fontFamily: FONT, lineHeight: 1.6, alignItems: 'flex-start' },
  aiHintIcon: { fontSize: '1rem', flexShrink: 0, marginTop: 1 },

  summary:    { background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 16 },
  summaryRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid #f1f5f9' },
  summaryKey: { fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', fontFamily: FONT, minWidth: 100 },
  summaryVal: { fontSize: '0.82rem', color: '#1e293b', fontFamily: FONT, textAlign: 'right', maxWidth: '70%' },

  error:      { display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: '0.85rem', marginTop: 12, fontFamily: FONT },
  cancelBtn:  { background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 20px', fontSize: '0.88rem', cursor: 'pointer', color: '#64748b', fontWeight: 500, fontFamily: FONT },
  nextBtn:    { background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '9px 24px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT },
}