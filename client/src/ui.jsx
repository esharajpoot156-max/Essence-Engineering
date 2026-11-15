// src/ui.jsx
// Shared helpers and small components used by all the new pages.
// pages.jsx is left untouched, so these are copies of its helpers (plus a few new ones).
import { useEffect, useState, useCallback } from 'react'
import { api, getToken } from './api'

// ---------- Formatting ----------
// Formats a number as PKR with no decimals, e.g. "PKR 1,200"
export const money = n =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(n) || 0)

// Formats a date like 14-11-2026 (the format used in Manager.io)
export const fmtDate = d => {
  if (!d) return ''
  const x = new Date(d)
  return String(x.getDate()).padStart(2, '0') + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + x.getFullYear()
}

// Today's date as YYYY-MM-DD, the value format of <input type="date">
export const today = () => new Date().toISOString().slice(0, 10)

// ---------- Auth ----------
// Reads the signed-in user's role from the JWT
export const myRole = () => {
  try { return JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return '' }
}

// ---------- Data hooks ----------
// Loads data from the API. Returns [data, reload].
// data is null while loading and [] if the request fails (for example, the route does not exist yet).
export const useLoad = path => {
  const [d, setD] = useState(null)
  const load = useCallback(() => api(path).then(setD).catch(() => setD([])), [path])
  useEffect(() => { load() }, [load])
  return [d, load]
}

// Like useState, but the value is also saved in localStorage.
// Used for things like form defaults and visible columns, which are stored in the browser for now.
export const useStored = (key, initial) => {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial } catch { return initial }
  })
  const set = next => {
    setV(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage full or blocked: ignore */ }
  }
  return [v, set]
}

// ---------- Styles ----------
// Class string shared by inputs and selects
export const inp = 'border border-navy/20 rounded px-3 py-2 text-sm w-full bg-white'

// ---------- Components ----------
// Main button
export const Btn = ({ className = '', ...p }) => (
  <button {...p} className={'bg-navy text-white text-sm font-medium px-4 py-2 rounded hover:bg-navy/90 disabled:opacity-50 ' + className} />
)

// Secondary (outlined) button
export const BtnLight = ({ className = '', ...p }) => (
  <button {...p} className={'border border-navy/20 bg-white text-navy text-sm font-medium px-4 py-2 rounded hover:bg-mist/60 disabled:opacity-50 ' + className} />
)

// Page title with an optional hint line
export const Title = ({ children, hint, right }) => (
  <div className="mb-6 flex items-start gap-4">
    <div>
      <h1 className="text-2xl font-semibold text-navy">{children}</h1>
      {hint && <p className="text-sm text-ink/60 mt-1">{hint}</p>}
    </div>
    {/* Optional buttons on the right side of the title, e.g. a "New" button */}
    {right && <div className="ml-auto flex gap-2">{right}</div>}
  </div>
)

// Red error message
export const Err = ({ e }) => (e ? <p className="text-sm text-red-700 mt-2" role="alert">{e}</p> : null)

// A label above an input
export const Field = ({ label, children, className = '' }) => (
  <label className={'block text-sm ' + className}>
    <span className="block mb-1 text-ink/70">{label}</span>
    {children}
  </label>
)

// Small coloured status badge, e.g. <Badge tone="green">Paid in full</Badge>
const TONES = {
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  gold: 'bg-gold/15 text-gold',
  gray: 'bg-mist text-ink/70',
}
export const Badge = ({ tone = 'gray', children }) => (
  <span className={'text-xs px-2 py-0.5 rounded ' + TONES[tone]}>{children}</span>
)

// Data table. cols = [[label, renderFn(row), rightAligned?], ...]
// Same shape as the Table in pages.jsx so the pages look consistent.
export const Table = ({ cols, rows, empty }) => (
  <div className="overflow-x-auto bg-white rounded border border-navy/10">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-mist/60 text-left">
          {cols.map(c => <th key={c[0]} className={'px-3 py-2 font-medium ' + (c[2] ? 'text-right' : '')}>{c[0]}</th>)}
        </tr>
      </thead>
      <tbody>
        {(rows || []).map((r, i) => (
          <tr key={r.id ?? i} className="border-t border-navy/10">
            {cols.map(c => <td key={c[0]} className={'px-3 py-2 ' + (c[2] ? 'text-right' : '')}>{c[1](r)}</td>)}
          </tr>
        ))}
        {rows?.length === 0 && (
          <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-ink/60">{empty}</td></tr>
        )}
      </tbody>
    </table>
  </div>
)