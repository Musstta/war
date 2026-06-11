// Shared design tokens — clean dark theme, easy to replace in Phase 8.
export const C = {
  bg:        '#111827',   // page background
  surface:   '#1f2937',   // card / panel background
  border:    '#374151',   // subtle border
  accent:    '#3b82f6',   // primary blue
  accentHov: '#2563eb',   // hover state
  danger:    '#ef4444',
  success:   '#22c55e',
  text:      '#f9fafb',
  muted:     '#9ca3af',
  dim:       '#4b5563',
} as const;

export const T: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    color: C.text,
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: '0.9rem',
  },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '1.25rem',
  },
  input: {
    background: '#0f172a',
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    color: C.text,
    padding: '0.5rem 0.75rem',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    outline: 'none',
    width: '100%',
  },
  btn: {
    background: C.accent,
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    padding: '0.5rem 1rem',
    fontFamily: 'inherit',
    fontSize: '0.875rem',
    cursor: 'pointer',
    fontWeight: 500,
  },
  btnSm: {
    background: C.accent,
    border: 'none',
    borderRadius: 5,
    color: '#fff',
    padding: '0.3rem 0.65rem',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    fontWeight: 500,
  },
  btnGhost: {
    background: 'transparent',
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    color: C.muted,
    padding: '0.5rem 1rem',
    fontFamily: 'inherit',
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  label: {
    color: C.muted,
    fontSize: '0.78rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    display: 'block',
    marginBottom: '0.35rem',
  },
  errorBox: {
    background: '#450a0a',
    border: `1px solid #7f1d1d`,
    borderRadius: 6,
    color: '#fca5a5',
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem',
  },
  infoBox: {
    background: '#0c1a2e',
    border: `1px solid #1e3a5f`,
    borderRadius: 6,
    color: '#93c5fd',
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem',
  },
};
