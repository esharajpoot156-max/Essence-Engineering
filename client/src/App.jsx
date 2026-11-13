import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { api, getToken, setToken } from './api'
import { Documents, Contacts, Inventory, Leads, Reports, SettingsPage, Journal, Bank, Team, Quotes, CreditNotes,BalanceSheet, Aging } from './pages'
import { Dashboard } from './Dashboard'

const BOOKS = ['admin', 'accountant']
const NAV = [['/', 'Dashboard'], ['/sales', 'Sales', 'sales'], ['/customers', 'Customers', 'sales'],['/quotes', 'Quotes', 'sales'], ['/credit-notes', 'Credit notes', 'sales', BOOKS], ['/purchases', 'Purchases', 'purchases'],
  ['/suppliers', 'Suppliers', 'purchases'], ['/inventory', 'Inventory', 'inventory'], ['/leads', 'Leads', 'leads'], ['/reports', 'Reports', 'reports', BOOKS],
  ['/balance-sheet', 'Balance sheet', 'reports', BOOKS], ['/aging-customers', 'Customer aging', 'reports', BOOKS], ['/aging-suppliers', 'Supplier aging', 'reports', BOOKS],
  ['/journal', 'Journal', 'reports', BOOKS], ['/bank', 'Bank', 'reports', BOOKS], ['/team', 'Team', null, ['admin']], ['/settings', 'Settings', null, ['admin']]]

function Login({ onDone }) {
  const [f, setF] = useState({ email: '', password: '' }), [err, setErr] = useState('')
  const go = async e => { e.preventDefault(); try { const r = await api('/auth/login', { method: 'POST', body: f }); setToken(r.token); onDone() } catch (x) { setErr(x.message) } }
  return (
    <div className="min-h-screen grid place-items-center bg-navy p-4">
      <form onSubmit={go} className="bg-white rounded-lg p-8 w-full max-w-sm space-y-4">
        <img src="/logo.png" alt="Essence Engineering" className="h-16" />
        <h1 className="text-xl font-semibold text-navy">Sign in to Essence Engineering</h1>
        <input className="border border-navy/20 rounded px-3 py-2 w-full" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <input className="border border-navy/20 rounded px-3 py-2 w-full" type="password" placeholder="Password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
        {err && <p className="text-sm text-red-700">{err}</p>}
        <button className="bg-gold text-white font-medium rounded px-4 py-2 w-full">Sign in</button>
      </form>
    </div>)
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken()), [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(() => window.innerWidth >= 768)
  const loc = useLocation()
  const refresh = () => api('/settings').then(setSettings)
  useEffect(() => { if (authed) refresh().catch(() => {}) }, [authed])
  useEffect(() => { if (window.innerWidth < 768) setOpen(false) }, [loc.pathname])
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  if (!settings) return <p className="p-8">Loading…</p>
  const on = m => !m || settings.modules.includes(m)
  const role = JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role

  // Pages this user is allowed to see (same rule as the sidebar)
  const allowed = NAV.filter(n => on(n[2]) && (!n[3] || n[3].includes(role)))
  // Guard: if the user types a URL they are not allowed to open, send them to Dashboard
  const guard = (to, element) => allowed.some(n => n[0] === to) ? element : <Navigate to="/" replace />
  const current = allowed.find(n => n[0] === loc.pathname)?.[1] || 'Dashboard'
  const signOut = () => { setToken(null); setAuthed(false) }

  return (
    <div className="min-h-screen md:flex">
      {open && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setOpen(false)} />}

      {open && (
        <aside className="fixed md:sticky top-0 z-40 h-screen w-60 shrink-0 bg-navy text-white flex flex-col">
          <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0">
            <img src="/logo.png" alt="" className="h-11 w-11 rounded bg-white p-1" />
            <div className="leading-tight"><p className="font-semibold">Essence</p><p className="text-sm text-white/70">Engineering</p></div>
          </div>
          <nav className="p-2 flex-1 overflow-y-auto">
            {allowed.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                'block px-4 py-2 rounded-sm border-l-4 whitespace-nowrap ' + (isActive ? 'border-gold bg-white/10 font-medium' : 'border-transparent text-white/80 hover:bg-white/5')}>{label}</NavLink>))}
          </nav>
          <button onClick={signOut} className="m-4 text-sm text-white/70 underline text-left">Sign out</button>
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-navy/10 px-4 md:px-6 flex items-center gap-3">
          <button onClick={() => setOpen(!open)} aria-label="Toggle menu" className="p-2 -ml-2 rounded hover:bg-mist/60 text-navy">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <h2 className="font-semibold text-navy">{current}</h2>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:block text-sm text-ink/60">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <span className="text-sm capitalize text-navy font-medium">{role}</span>
            <span className="h-8 w-8 rounded-full bg-gold text-white grid place-items-center text-sm font-semibold uppercase">{role[0]}</span>
          </div>
        </header>
        <main className="flex-1 min-w-0 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-8 md:py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={guard('/sales', <Documents kind="sale" />)} />
            <Route path="/purchases" element={guard('/purchases', <Documents kind="purchase" />)} />
            <Route path="/customers" element={guard('/customers', <Contacts type="customer" />)} />
            <Route path="/suppliers" element={guard('/suppliers', <Contacts type="supplier" />)} />
            <Route path="/inventory" element={guard('/inventory', <Inventory />)} />
            <Route path="/leads" element={guard('/leads', <Leads />)} />
            <Route path="/reports" element={guard('/reports', <Reports />)} />
            <Route path="/journal" element={guard('/journal', <Journal />)} />
            <Route path="/bank" element={guard('/bank', <Bank />)} />
            <Route path="/team" element={guard('/team', <Team />)} />
            <Route path="/settings" element={guard('/settings', <SettingsPage settings={settings} onSaved={refresh} />)} />
            <Route path="/balance-sheet" element={guard('/balance-sheet', <BalanceSheet />)} />
            <Route path="/aging-customers" element={guard('/aging-customers', <Aging kind="sale" />)} />
            <Route path="/aging-suppliers" element={guard('/aging-suppliers', <Aging kind="purchase" />)} />
            <Route path="/quotes" element={guard('/quotes', <Quotes />)} />
            <Route path="/credit-notes" element={guard('/credit-notes', <CreditNotes />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>)
}