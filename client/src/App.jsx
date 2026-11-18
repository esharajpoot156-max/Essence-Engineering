import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { api, getToken, setToken } from './api'
import { CustomizeProvider } from './customize'

// Old pages that still use the current backend (pages.jsx)
import { Documents, Leads, Reports, Journal, Bank, Team, Quotes, CreditNotes, BalanceSheet, Aging } from './pages'
import { Dashboard } from './Dashboard'

// New Manager.io-style pages
import SettingsCustomize from './SettingsCustomize'
import BankAccounts from './BankAccounts'
import { Receipts, Payments } from './Money'
import { Transfers, Reconciliations } from './Transfers'
import ExpenseClaims from './ExpenseClaims'
import { Customers, Suppliers } from './Contacts2'
import { SalesQuotes, SalesOrders, DeliveryNotes, SalesInvoices } from './SalesDocs'
import { PurchaseQuotes, PurchaseOrders, GoodsReceipts, PurchaseInvoices } from './PurchaseDocs'
import InventoryItems from './InventoryItems'
import Projects from './Projects'
import Employees from './Employees'
import Payslips from './Payslips'
import { FixedAssets, DepreciationEntries } from './FixedAssets'
import { CapitalAccounts, SpecialAccounts, Investments } from './SimpleAccounts'
import { ProfitAndLoss, CashFlow } from './FinancialReports'

// Roles: admin (everything), accountant (accounts modules, no leads), sales (leads, customers, sales documents)
const BOOKS = ['admin', 'accountant']            // banking, payroll, assets, accounting, reports
const SALES = ['admin', 'accountant', 'sales']   // customers and sales documents
const BUYING = ['admin', 'accountant']           // purchase documents, suppliers, inventory
const LEADS = ['admin', 'sales']                 // Leads are hidden from the accountant

// Sidebar, grouped like Manager.io.
// Each group = [title, items]. Each item = [path, label, module, roles]
//   module = the settings module that must be switched on (null = always shown)
//   roles  = roles allowed to open it (missing = every role)
const GROUPS = [
  [null, [['/', 'Dashboard']]],
    ['Banking', [
    ['/bank-accounts', 'Bank and Cash Accounts', 'banking', BOOKS],
    ['/receipts', 'Receipts', 'banking', BOOKS],
    ['/payments', 'Payments', 'banking', BOOKS],
    ['/transfers', 'Inter Account Transfers', 'banking', BOOKS],
    ['/reconciliations', 'Bank Reconciliations', 'banking', BOOKS],
    ['/expense-claims', 'Expense Claims', 'banking', BOOKS]]],
  ['Sales', [
    ['/customers', 'Customers', 'sales', SALES],
    ['/sales-quotes', 'Sales Quotes', 'sales', SALES],
    ['/sales-orders', 'Sales Orders', 'sales', SALES],
    ['/sales-invoices', 'Sales Invoices', 'sales', SALES],
    ['/delivery-notes', 'Delivery Notes', 'sales', SALES],
    ['/credit-notes', 'Credit Notes', 'sales', BOOKS]]],
  ['Purchases', [
    ['/suppliers', 'Suppliers', 'purchases', BUYING],
    ['/purchase-quotes', 'Purchase Quotes', 'purchases', BUYING],
    ['/purchase-orders', 'Purchase Orders', 'purchases', BUYING],
    ['/purchase-invoices', 'Purchase Invoices', 'purchases', BUYING],
    ['/goods-receipts', 'Goods Receipts', 'purchases', BUYING]]],
    ['Inventory and Projects', [
    ['/inventory', 'Inventory Items', 'inventory', BUYING],
    ['/projects', 'Projects', 'projects', BOOKS]]],
  ['Payroll', [
    ['/employees', 'Employees', 'payroll', BOOKS],
    ['/payslips', 'Payslips', 'payroll', BOOKS]]],
  ['Assets', [
    ['/fixed-assets', 'Fixed Assets', 'assets', BOOKS],
    ['/depreciation', 'Depreciation Entries', 'assets', BOOKS]]],
  ['Accounting', [
    ['/capital-accounts', 'Capital Accounts', 'accounting', BOOKS],
    ['/special-accounts', 'Special Accounts', 'accounting', BOOKS],
    ['/investments', 'Investments', 'accounting', BOOKS]]],
  ['Leads', [['/leads', 'Leads', 'leads', LEADS]]],
  ['Reports', [
    ['/reports', 'Reports', 'reports', BOOKS],
    ['/balance-sheet', 'Balance Sheet', 'reports', BOOKS],
    ['/profit-and-loss', 'Profit and Loss', 'reports', BOOKS],
    ['/cash-flow', 'Cash Flow Statement', 'reports', BOOKS],
    ['/aging-customers', 'Customer Aging', 'reports', BOOKS],
    ['/aging-suppliers', 'Supplier Aging', 'reports', BOOKS],
    ['/journal', 'Journal', 'reports', BOOKS]]],

  ['Admin', [
    ['/team', 'Team', null, ['admin']],
    ['/settings', 'Settings', null, ['admin']]]],
]

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
  // Record counts shown next to each sidebar item, e.g. { '/receipts': 266 }
  const [counts, setCounts] = useState({})
  const loc = useLocation()
  const refresh = () => api('/settings').then(setSettings)
  useEffect(() => { if (authed) refresh().catch(() => {}) }, [authed])
  useEffect(() => { if (window.innerWidth < 768) setOpen(false) }, [loc.pathname])
  // Reload the counts whenever the user opens another page (ignored if /counts does not exist yet)
  useEffect(() => { if (authed) api('/counts').then(setCounts).catch(() => {}) }, [authed, loc.pathname])
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  if (!settings) return <p className="p-8">Loading…</p>
    // Pages switched off in Settings > Modules are saved as "hide:/path" (everything else is shown)
  const hiddenTabs = settings.modules.filter(m => m.startsWith('hide:')).map(m => m.slice(5))
  const role = JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role

  // Items this user may see, group by group (empty groups are dropped)
  const visible = GROUPS
        .map(([title, items]) => [title, items.filter(n => !hiddenTabs.includes(n[0]) && (!n[3] || n[3].includes(role)))])
    .filter(([, items]) => items.length)
  // Flat list of every allowed page (used by the guard and the page title)
  const allowed = visible.flatMap(([, items]) => items)
  // Guard: if the user types a URL they are not allowed to open, send them to Dashboard
  const guard = (to, element) => allowed.some(n => n[0] === to) ? element : <Navigate to="/" replace />
  const current = allowed.find(n => n[0] === loc.pathname)?.[1] || 'Dashboard'
  const signOut = () => { setToken(null); setAuthed(false) }

  return (
    // CustomizeProvider gives every page access to the form options and business details from Settings
    <CustomizeProvider>
      <div className="min-h-screen md:flex">
        {open && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setOpen(false)} />}

        {open && (
          <aside className="fixed md:sticky top-0 z-40 h-screen w-64 shrink-0 bg-navy text-white flex flex-col">
            <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0">
              <img src="/logo.png" alt="" className="h-11 w-11 rounded bg-white p-1" />
              <div className="leading-tight"><p className="font-semibold">Essence</p><p className="text-sm text-white/70">Engineering</p></div>
            </div>
            <nav className="p-2 flex-1 overflow-y-auto">
              {visible.map(([title, items]) => (
                <div key={title || 'top'} className="mb-2">
                  {title && <p className="px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-white/40">{title}</p>}
                  {items.map(([to, label]) => (
                    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) =>
                      'flex items-center justify-between gap-2 px-4 py-2 text-sm rounded-sm border-l-4 ' + (isActive ? 'border-gold bg-white/10 font-medium' : 'border-transparent text-white/80 hover:bg-white/5')}>
                      <span className="truncate" title={label}>{label}</span>
                      {/* Record count badge (only when the server sends one) */}
                      {counts[to] != null && <span className="shrink-0 text-xs bg-white/15 rounded px-1.5 py-0.5">{counts[to]}</span>}
                    </NavLink>))}
                </div>))}
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

              {/* Banking */}
              <Route path="/bank-accounts" element={guard('/bank-accounts', <BankAccounts />)} />
              <Route path="/receipts" element={guard('/receipts', <Receipts />)} />
              <Route path="/payments" element={guard('/payments', <Payments />)} />
              <Route path="/transfers" element={guard('/transfers', <Transfers />)} />
              <Route path="/reconciliations" element={guard('/reconciliations', <Reconciliations />)} />
              <Route path="/expense-claims" element={guard('/expense-claims', <ExpenseClaims />)} />

              {/* Sales */}
              <Route path="/customers" element={guard('/customers', <Customers />)} />
              <Route path="/sales-quotes" element={guard('/sales-quotes', <SalesQuotes />)} />
              <Route path="/sales-orders" element={guard('/sales-orders', <SalesOrders />)} />
              <Route path="/sales-invoices" element={guard('/sales-invoices', <SalesInvoices />)} />
              <Route path="/delivery-notes" element={guard('/delivery-notes', <DeliveryNotes />)} />
              <Route path="/credit-notes" element={guard('/credit-notes', <CreditNotes />)} />

              {/* Purchases */}
              <Route path="/suppliers" element={guard('/suppliers', <Suppliers />)} />
              <Route path="/purchase-quotes" element={guard('/purchase-quotes', <PurchaseQuotes />)} />
              <Route path="/purchase-orders" element={guard('/purchase-orders', <PurchaseOrders />)} />
              <Route path="/purchase-invoices" element={guard('/purchase-invoices', <PurchaseInvoices />)} />
              <Route path="/goods-receipts" element={guard('/goods-receipts', <GoodsReceipts />)} />

              {/* Inventory and projects */}
              <Route path="/inventory" element={guard('/inventory', <InventoryItems />)} />
              <Route path="/projects" element={guard('/projects', <Projects />)} />

              {/* Payroll */}
              <Route path="/employees" element={guard('/employees', <Employees />)} />
              <Route path="/payslips" element={guard('/payslips', <Payslips />)} />

              {/* Assets */}
              <Route path="/fixed-assets" element={guard('/fixed-assets', <FixedAssets />)} />
              <Route path="/depreciation" element={guard('/depreciation', <DepreciationEntries />)} />

              {/* Accounting */}
              <Route path="/capital-accounts" element={guard('/capital-accounts', <CapitalAccounts />)} />
              <Route path="/special-accounts" element={guard('/special-accounts', <SpecialAccounts />)} />
              <Route path="/investments" element={guard('/investments', <Investments />)} />

              {/* Leads */}
              <Route path="/leads" element={guard('/leads', <Leads />)} />

              {/* Reports */}
              <Route path="/reports" element={guard('/reports', <Reports />)} />
              <Route path="/balance-sheet" element={guard('/balance-sheet', <BalanceSheet />)} />
              <Route path="/profit-and-loss" element={guard('/profit-and-loss', <ProfitAndLoss />)} />
              <Route path="/cash-flow" element={guard('/cash-flow', <CashFlow />)} />
              <Route path="/aging-customers" element={guard('/aging-customers', <Aging kind="sale" />)} />
              <Route path="/aging-suppliers" element={guard('/aging-suppliers', <Aging kind="purchase" />)} />
              <Route path="/journal" element={guard('/journal', <Journal />)} />

              {/* Old pages (use the current backend) */}
              <Route path="/sales" element={guard('/sales', <Documents kind="sale" />)} />
              <Route path="/purchases" element={guard('/purchases', <Documents kind="purchase" />)} />
              <Route path="/quotes" element={guard('/quotes', <Quotes />)} />

              {/* Admin */}
              <Route path="/team" element={guard('/team', <Team />)} />
              <Route path="/settings" element={guard('/settings', <SettingsCustomize settings={settings} onSaved={refresh} groups={GROUPS} />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </CustomizeProvider>)
}