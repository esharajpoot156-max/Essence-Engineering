import { useEffect, useState } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { api, getToken, setToken } from './api'
import { Dashboard, Documents, Contacts, Inventory, Leads, Reports, SettingsPage, Journal, Bank, Team } from './pages'

const BOOKS = ['admin', 'accountant']
const NAV = [['/', 'Dashboard'], ['/sales', 'Sales', 'sales'], ['/customers', 'Customers', 'sales'], ['/purchases', 'Purchases', 'purchases'],
  ['/suppliers', 'Suppliers', 'purchases'], ['/inventory', 'Inventory', 'inventory'], ['/leads', 'Leads', 'leads'], ['/reports', 'Reports', 'reports', BOOKS],
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
  const refresh = () => api('/settings').then(setSettings)
  useEffect(() => { if (authed) refresh().catch(() => {}) }, [authed])
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  if (!settings) return <p className="p-8">Loading…</p>
  const on = m => !m || settings.modules.includes(m)
  const role = JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-navy text-white md:w-60 md:min-h-screen shrink-0">
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <img src="/logo.png" alt="" className="h-11 w-11 rounded bg-white p-1" />
          <div className="leading-tight"><p className="font-semibold">Essence</p><p className="text-sm text-white/70">Engineering</p></div>
        </div>
        <nav className="p-2 flex md:block overflow-x-auto">
          {NAV.filter(n => on(n[2]) && (!n[3] || n[3].includes(role))).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
              'block px-4 py-2 rounded-sm border-l-4 whitespace-nowrap ' + (isActive ? 'border-gold bg-white/10 font-medium' : 'border-transparent text-white/80 hover:bg-white/5')}>{label}</NavLink>))}
        </nav>
        <button onClick={() => { setToken(null); setAuthed(false) }} className="m-4 text-sm text-white/70 underline">Sign out</button>
      </aside>
      <main className="flex-1 p-4 md:p-8 max-w-6xl">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sales" element={<Documents kind="sale" />} />
          <Route path="/purchases" element={<Documents kind="purchase" />} />
          <Route path="/customers" element={<Contacts type="customer" />} />
          <Route path="/suppliers" element={<Contacts type="supplier" />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<SettingsPage settings={settings} onSaved={refresh} />} />
        </Routes>
      </main>
    </div>)
}
