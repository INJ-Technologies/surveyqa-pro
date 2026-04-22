import React from 'react'
import ReactSelect from 'react-select'

// ─── Google Sans applied globally via CSS ─────────────────────────────────────
const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

// ─── react-select shared theme ────────────────────────────────────────────────
export const selectStyles = {
  control: (base, state) => ({
    ...base,
    fontFamily: FONT,
    fontSize: '0.88rem',
    borderRadius: 8,
    borderColor: state.isFocused ? '#2563eb' : '#e2e8f0',
    borderWidth: '1.5px',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none',
    minHeight: 40,
    background: 'white',
    cursor: 'pointer',
    '&:hover': { borderColor: '#2563eb' },
  }),
  option: (base, state) => ({
    ...base,
    fontFamily: FONT,
    fontSize: '0.88rem',
    background: state.isSelected
      ? '#1e3a5f'
      : state.isFocused
      ? '#f0f7ff'
      : 'white',
    color: state.isSelected ? 'white' : '#1e293b',
    cursor: 'pointer',
    padding: '10px 14px',
  }),
  menu: (base) => ({
    ...base,
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    border: '1.5px solid #e2e8f0',
    overflow: 'hidden',
    zIndex: 9999,
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  placeholder: (base) => ({
    ...base,
    color: '#94a3b8',
    fontFamily: FONT,
    fontSize: '0.88rem',
  }),
  singleValue: (base) => ({
    ...base,
    color: '#1e293b',
    fontFamily: FONT,
    fontSize: '0.88rem',
  }),
  multiValue: (base) => ({
    ...base,
    background: '#dbeafe',
    borderRadius: 6,
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: '#1e3a5f',
    fontFamily: FONT,
    fontSize: '0.82rem',
    fontWeight: 600,
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#1e3a5f',
    '&:hover': { background: '#bfdbfe', color: '#1e3a5f' },
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base) => ({ ...base, color: '#94a3b8' }),
}

// ─── Select wrapper ───────────────────────────────────────────────────────────
export function Select({ label, options, value, onChange, placeholder, isMulti, required, error }) {
  const selected = isMulti
    ? options.filter(o => (value || []).includes(o.value))
    : options.find(o => o.value === value) || null

  const handleChange = (selected) => {
    if (isMulti) {
      onChange(selected ? selected.map(s => s.value) : [])
    } else {
      onChange(selected ? selected.value : '')
    }
  }

  return (
    <div style={f.field}>
      {label && (
        <label style={f.label}>
          {label} {required && <span style={f.required}>*</span>}
        </label>
      )}
      <ReactSelect
        options={options}
        value={selected}
        onChange={handleChange}
        placeholder={placeholder || `Select ${label || ''}...`}
        isMulti={isMulti}
        styles={selectStyles}
        menuPortalTarget={document.body}
        menuPosition="fixed"
      />
      {error && <span style={f.errorText}>{error}</span>}
    </div>
  )
}

// ─── Text Input ───────────────────────────────────────────────────────────────
export function Input({ label, required, error, hint, ...props }) {
  return (
    <div style={f.field}>
      {label && (
        <label style={f.label}>
          {label} {required && <span style={f.required}>*</span>}
        </label>
      )}
      <input
        style={{
          ...f.input,
          borderColor: error ? '#ef4444' : '#e2e8f0',
        }}
        {...props}
      />
      {hint  && !error && <span style={f.hint}>{hint}</span>}
      {error && <span style={f.errorText}>{error}</span>}
    </div>
  )
}

// ─── Textarea ─────────────────────────────────────────────────────────────────
export function Textarea({ label, required, error, hint, ...props }) {
  return (
    <div style={f.field}>
      {label && (
        <label style={f.label}>
          {label} {required && <span style={f.required}>*</span>}
        </label>
      )}
      <textarea
        style={{
          ...f.input,
          resize: 'vertical',
          fontFamily: FONT,
          borderColor: error ? '#ef4444' : '#e2e8f0',
        }}
        {...props}
      />
      {hint  && !error && <span style={f.hint}>{hint}</span>}
      {error && <span style={f.errorText}>{error}</span>}
    </div>
  )
}

// ─── Number Input ─────────────────────────────────────────────────────────────
export function NumberInput({ label, required, error, hint, prefix, suffix, ...props }) {
  return (
    <div style={f.field}>
      {label && (
        <label style={f.label}>
          {label} {required && <span style={f.required}>*</span>}
        </label>
      )}
      <div style={f.inputWrap}>
        {prefix && <span style={f.affix}>{prefix}</span>}
        <input
          type="number"
          style={{
            ...f.input,
            paddingLeft:  prefix ? 36 : '12px',
            paddingRight: suffix ? 36 : '12px',
            borderColor: error ? '#ef4444' : '#e2e8f0',
          }}
          {...props}
        />
        {suffix && <span style={{ ...f.affix, right: 12, left: 'auto' }}>{suffix}</span>}
      </div>
      {hint  && !error && <span style={f.hint}>{hint}</span>}
      {error && <span style={f.errorText}>{error}</span>}
    </div>
  )
}

// ─── Date Input ───────────────────────────────────────────────────────────────
export function DateInput({ label, required, error, ...props }) {
  return (
    <div style={f.field}>
      {label && (
        <label style={f.label}>
          {label} {required && <span style={f.required}>*</span>}
        </label>
      )}
      <input
        type="date"
        style={{
          ...f.input,
          borderColor: error ? '#ef4444' : '#e2e8f0',
        }}
        {...props}
      />
      {error && <span style={f.errorText}>{error}</span>}
    </div>
  )
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────
export function Toggle({ label, checked, onChange, hint }) {
  return (
    <div style={f.toggleRow}>
      <div>
        <div style={f.toggleLabel}>{label}</div>
        {hint && <div style={f.hint}>{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          ...f.toggleTrack,
          background: checked ? '#1e3a5f' : '#e2e8f0',
        }}
      >
        <span style={{
          ...f.toggleThumb,
          transform: checked ? 'translateX(20px)' : 'translateX(2px)',
        }} />
      </button>
    </div>
  )
}

// ─── Form Section Header ──────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div style={f.sectionHeader}>
      <div>
        <div style={f.sectionTitle}>{title}</div>
        {subtitle && <div style={f.sectionSub}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

// ─── Form Grid ────────────────────────────────────────────────────────────────
export function FormGrid({ children, cols = 2 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 16,
    }}>
      {children}
    </div>
  )
}

// ─── Full width grid cell ─────────────────────────────────────────────────────
export function FullCol({ children }) {
  return <div style={{ gridColumn: '1 / -1' }}>{children}</div>
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const f = {
  field:       { display: 'flex', flexDirection: 'column', gap: 6 },
  label:       { fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT },
  required:    { color: '#ef4444', marginLeft: 2 },
  hint:        { fontSize: '0.75rem', color: '#94a3b8', fontFamily: FONT },
  errorText:   { fontSize: '0.75rem', color: '#ef4444', fontFamily: FONT },
  inputWrap:   { position: 'relative' },
  affix:       { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.82rem', color: '#94a3b8', pointerEvents: 'none' },
  input: {
    padding: '10px 12px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 8,
    fontSize: '0.88rem',
    outline: 'none',
    color: '#1e293b',
    background: 'white',
    fontFamily: FONT,
    width: '100%',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  toggleRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' },
  toggleLabel: { fontSize: '0.88rem', fontWeight: 600, color: '#1e293b', fontFamily: FONT },
  toggleTrack: { width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'transform 0.2s' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1.5px solid #f1f5f9' },
  sectionTitle:  { fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT },
  sectionSub:    { fontSize: '0.8rem', color: '#64748b', marginTop: 3, fontFamily: FONT },
}