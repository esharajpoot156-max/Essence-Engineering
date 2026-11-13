import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area } from 'recharts'
import { api, getToken } from './api'

const NAVY = '#1F3A5A', GOLD = '#B07F24', GREEN = '#2F855A', RED = '#C53030', PURPLE = '#6D5BD0'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = n => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(n) || 0)
const compact = n => new Intl.NumberFormat('en-PK', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0)
const arr = x => (Array.isArray(x) ? x : [])

const ICONS = {
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  in: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  out: 'M12 20V8m0 0l-4 4m4-4l4 4M5 4h14',
  sales: 'M4 19V9m6 10V5m6 14v-7m4 7H2',
  buy: 'M6 6h15l-2 9H8L6 6zm0 0L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  wallet: 'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  funnel: 'M3 4h18l-7 8v6l-4 2v-8z',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
}
const STAGE = { New: '#3B82F6', Contacted: '#0EA5E9', Qualified: '#F59E0B', Quotation: '#8B5CF6', Won: '#10B981', Lost: '#EF4444' }

// Last n months, oldest first
const buildMonths = n => [...Array(n)].map((_, i) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - (n - 1 - i), 1)
  return { key: d.getFullYear() + '-' + d.getMonth(), name: MONTHS[d.getMonth()] }
})
const keyOf = date => { const d = new Date(date); return d.getFullYear() + '-' + d.getMonth() }
const perMonth = (months, rows, val) => months.map(m => rows.filter(r => keyOf(r.date) === m.key).reduce((s, r) => s + val(r), 0))
// Running balance that ends exactly at today's real number
const anchored = (moves, now) => { const out = [...moves]; let bal = Number(now) || 0; for (let i = moves.length - 1; i >= 0; i--) { out[i] = bal; bal -= moves[i] } return out }

// ANIMATION HELPERS 
const CSS = `
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes growX{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes wave{0%,60%,100%{transform:rotate(0)}10%,30%{transform:rotate(14deg)}20%,40%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
@keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(47,133,90,.5)}70%{box-shadow:0 0 0 8px rgba(47,133,90,0)}100%{box-shadow:0 0 0 0 rgba(47,133,90,0)}}
@keyframes sheen{from{transform:translateX(-120%)}to{transform:translateX(320%)}}
.anim-up{animation:fadeUp .6s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:var(--d,0ms)}
.anim-row{animation:fadeIn .5s ease backwards;animation-delay:var(--d,0ms)}
.grow-x{transform-origin:left;animation:growX .9s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:var(--d,0ms)}
.wave{display:inline-block;transform-origin:70% 70%;animation:wave 2.2s ease-in-out 1s 2}
.live-dot{animation:pulseRing 2s infinite}
.sheen::after{content:'';position:absolute;top:0;bottom:0;left:0;width:30%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.6),transparent);transform:translateX(-120%)}
.sheen:hover::after{animation:sheen .9s ease}
.icon-tile{transition:transform .3s cubic-bezier(.2,.7,.2,1)}
.group:hover .icon-tile{transform:scale(1.12) rotate(-6deg)}
@media (prefers-reduced-motion:reduce){.anim-up,.anim-row,.grow-x,.wave,.live-dot{animation:none}.sheen:hover::after{animation:none}}
`

const useCountUp = (target, duration = 1000) => {
  const to = Number(target) || 0
  const [val, setVal] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setVal(to); from.current = to; return }
    let raf, start
    const a = from.current
    const tick = t => {
      if (start === undefined) start = t
      const p = Math.min(1, (t - start) / duration)
      setVal(a + (to - a) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, duration])
  return val
}
const AnimMoney = ({ value }) => <>{money(useCountUp(value))}</>

const Icon = ({ name, className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
)

// TOP CARDS 
const Stat = ({ id, label, value, icon, color, tint, data, goodUp = true, delay = 0 }) => {
  const a = data[data.length - 2]?.v, b = data[data.length - 1]?.v
  const hasPrev = Math.abs(Number(a) || 0) >= 1
  const rawPct = hasPrev ? Math.round(((b - a) / Math.abs(a)) * 100) : null
  const pct = rawPct === null ? null : Math.max(-999, Math.min(999, rawPct))
  const capped = rawPct !== null && Math.abs(rawPct) > 999
  const good = pct !== null && (pct >= 0) === goodUp
  const hasChart = new Set(data.map(x => Math.round(Number(x.v) || 0))).size >= 3

  return (
    <div style={{ '--d': delay + 'ms' }} className="group sheen anim-up relative overflow-hidden rounded-2xl bg-white border border-navy/10 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition p-4 flex flex-col">
      <div className="flex items-center gap-2">
        <span className="icon-tile h-9 w-9 shrink-0 rounded-xl grid place-items-center" style={{ background: tint, color }}>
          <Icon name={icon} />
        </span>
        <span className="text-sm text-ink/60 leading-tight">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-navy mt-4 truncate tabular-nums" title={money(value)}><AnimMoney value={value} /></p>
      <p className={'text-xs mt-1 ' + (pct === null ? 'text-ink/40' : good ? 'text-emerald-600' : 'text-red-600')}>
        {pct === null ? 'No change data' : `${pct >= 0 ? '↑' : '↓'} ${capped ? '>' : ''}${Math.abs(pct)}% vs last month`}
      </p>

      {hasChart ? (
        <div className="pt-3 -mb-4 -mr-4 ml-auto w-1/2 h-14">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 2 }}>
              <defs><linearGradient id={'g-' + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip formatter={v => money(v)} labelFormatter={(_, p) => p?.[0]?.payload?.name || ''} />
              <Area type="monotone" dataKey="v" baseValue="dataMin" stroke={color} strokeWidth={2.5} fill={`url(#g-${id})`} dot={false} animationDuration={1200} animationBegin={delay + 200} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-ink/35">Not enough history yet</p>
      )}
    </div>
  )
}

// ---------- MANAGER.IO STYLE HELPERS ----------
const Section = ({ icon, title, subtitle, right, children, className = '', delay = 0 }) => (
  <section style={{ '--d': delay + 'ms' }} className={'group anim-up flex flex-col bg-white rounded-xl border border-navy/10 overflow-hidden hover:shadow-md transition-shadow ' + className}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-navy/10 bg-navy/[0.02]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="icon-tile h-9 w-9 shrink-0 rounded-lg grid place-items-center bg-navy/10 text-navy"><Icon name={icon} /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-ink/50 truncate">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
)
const Th = ({ children, right }) => (
  <th className={'px-4 py-2 text-[11px] uppercase tracking-wide font-medium text-ink/50 ' + (right ? 'text-right' : 'text-left')}>{children}</th>
)
const Empty = ({ children }) => <p className="px-4 py-8 text-center text-sm text-ink/50">{children}</p>

const Pills = ({ options, value, onChange }) => (
  <div className="flex gap-1 bg-navy/5 rounded-lg p-1">
    {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={'px-3 py-1 rounded-md text-xs font-medium transition ' + (value === v ? 'bg-white text-navy shadow-sm' : 'text-ink/60 hover:text-navy')}>{l}</button>)}
  </div>
)
const DualTip = ({ active, payload, label }) => active && payload?.length ? (
  <div className="bg-navy text-white rounded px-3 py-2 text-xs shadow-lg space-y-0.5">
    <p className="opacity-70">{label}</p>
    {payload.map(p => <p key={p.dataKey} className="flex justify-between gap-4"><span>{p.name}</span><span className="font-semibold">{money(p.value)}</span></p>)}
  </div>
) : null

export function Dashboard() {
  const [d, setD] = useState(null), [sales, setSales] = useState([]), [buys, setBuys] = useState([]), [err, setErr] = useState('')
  const [bank, setBank] = useState([]), [journal, setJournal] = useState([])
  const [range, setRange] = useState(12)

  useEffect(() => {
    api('/dashboard').then(setD).catch(e => setErr(e.message))
    api('/invoices?kind=sale').then(setSales).catch(() => setSales([]))
    api('/invoices?kind=purchase').then(setBuys).catch(() => setBuys([]))
    api('/bank/lines').then(setBank).catch(() => setBank([])) // admin/accountant only
    api('/journal').then(setJournal).catch(() => setJournal([]))
  }, [])

  const s = arr(sales), b = arr(buys)
  const role = (() => { try { return JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return 'there' } })()
  const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Real data per top card
  const lines = useMemo(() => {
    const m = buildMonths(6), make = v => m.map((x, i) => ({ name: x.name, v: v[i] }))
    const bankRows = arr(bank).map(r => ({ date: r.journal?.date, net: (Number(r.debit) || 0) - (Number(r.credit) || 0) }))
    const jl = arr(journal).flatMap(j => arr(j.lines).map(l => ({ date: j.date, name: l.account?.name || '', dr: Number(l.debit) || 0, cr: Number(l.credit) || 0 })))
    return {
      cash: make(anchored(perMonth(m, bankRows, r => r.net), d?.cash)),
      rec: make(anchored(perMonth(m, jl.filter(l => /receivable/i.test(l.name)), r => r.dr - r.cr), d?.receivable)),
      pay: make(anchored(perMonth(m, jl.filter(l => /payable/i.test(l.name)), r => r.cr - r.dr), d?.payable)),
      sales: make(perMonth(m, s, r => Number(r.total) || 0)),
      buys: make(perMonth(m, b, r => Number(r.total) || 0)),
    }
  }, [sales, buys, bank, journal, d])

  // Sales vs purchases per month
  const months = useMemo(() => {
    const m = buildMonths(range), sv = perMonth(m, s, r => Number(r.total) || 0), bv = perMonth(m, b, r => Number(r.total) || 0)
    return m.map((x, i) => ({ ...x, sales: sv[i], purchases: bv[i] }))
  }, [sales, buys, range])
  const recent = useMemo(() => [...s.map(x => ({ ...x, kind: 'Sale' })), ...b.map(x => ({ ...x, kind: 'Purchase' }))]
    .sort((x, y) => new Date(y.date) - new Date(x.date)).slice(0, 8), [sales, buys])

  if (err) return <p className="text-red-700" role="alert">{err}</p>
  if (!d?.leads) return <p>Loading…</p>

  const leads = Object.entries(d.leads).map(([name, v]) => ({ name, value: Number(v) || 0 }))
  const leadTotal = leads.reduce((t, x) => t + x.value, 0), low = d.lowStock || []

  const cur = months[months.length - 1], prev = months[months.length - 2] || { name: '—', sales: 0, purchases: 0 }
  const net = (Number(d.cash) || 0) + (Number(d.receivable) || 0) - (Number(d.payable) || 0)
  const amtCls = v => 'text-right tabular-nums ' + (v < 0 ? 'text-red-700' : 'text-ink')
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (<>
    <style>{CSS}</style>

    <div className="anim-up mb-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-3xl font-semibold text-navy">{greet}, <span className="capitalize">{role}</span> <span className="wave">👋</span></h1>
        <p className="text-sm text-ink/60 mt-1">Here's what's happening in your business today.</p>
      </div>
      <span className="inline-flex items-center gap-2 text-sm text-ink/50">
        <span className="live-dot h-2 w-2 rounded-full bg-emerald-500" />Live · {today}
      </span>
    </div>

    {/* Business snapshot */}
    <div className="anim-up flex items-center gap-2 mb-3" style={{ '--d': '60ms' }}>
      <span className="text-navy"><Icon name="grid" className="h-4 w-4" /></span>
      <h2 className="text-sm font-semibold text-navy">Business Snapshot</h2>
      <span className="text-xs text-ink/50">· Key numbers at a glance</span>
    </div>
    <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4 items-start">
      <Stat delay={100} id="cash" label="Cash in bank" value={d.cash} icon="cash" color={NAVY} tint="#E3EAF3" data={lines.cash} />
      <Stat delay={180} id="rec" label="Customers owe us" value={d.receivable} icon="in" color={GREEN} tint="#DDF0E5" data={lines.rec} />
      <Stat delay={260} id="pay" label="We owe suppliers" value={d.payable} icon="out" color={RED} tint="#FBE3E3" data={lines.pay} goodUp={false} />
      <Stat delay={340} id="sales" label="Total sales" value={d.sales} icon="sales" color={PURPLE} tint="#ECE9FA" data={lines.sales} />
      <Stat delay={420} id="buys" label="Total purchases" value={d.purchases} icon="buy" color={GOLD} tint="#F6EBD3" data={lines.buys} goodUp={false} />
    </div>

    {/* Row 1: chart + summaries */}
    <div className="grid lg:grid-cols-3 gap-6 mt-6">
      <Section delay={500} icon="trend" title="Revenue vs Spending" subtitle="Monthly sales compared with purchases" className="lg:col-span-2"
        right={<Pills value={range} onChange={setRange} options={[[12, '12 Months'], [6, '6 Months']]} />}>
        <div className="relative flex-1 min-h-[18rem]">
          <div className="absolute inset-0 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={44} fontSize={12} />
                <Tooltip content={<DualTip />} cursor={{ fill: 'rgba(31,58,90,0.04)' }} />
                <Legend verticalAlign="top" align="right" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
                <Bar name="Sales" dataKey="sales" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={22} animationBegin={700} animationDuration={1200} />
                <Bar name="Purchases" dataKey="purchases" fill={GOLD} radius={[3, 3, 0, 0]} maxBarSize={22} animationBegin={850} animationDuration={1200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      <div className="space-y-6">
        <Section delay={600} icon="wallet" title="Cash & Balances" subtitle="What you have, are owed and owe">
          <table className="w-full text-sm"><tbody>
            <tr className="border-b border-navy/10"><td className="px-4 py-2.5 text-ink/70">Cash in bank</td><td className={'px-4 ' + amtCls(Number(d.cash) || 0)}><AnimMoney value={d.cash} /></td></tr>
            <tr className="border-b border-navy/10"><td className="px-4 py-2.5 text-ink/70">Receivables</td><td className={'px-4 ' + amtCls(Number(d.receivable) || 0)}><AnimMoney value={d.receivable} /></td></tr>
            <tr className="border-b border-navy/10"><td className="px-4 py-2.5 text-ink/70">Payables</td><td className={'px-4 ' + amtCls(-(Number(d.payable) || 0))}><AnimMoney value={-(Number(d.payable) || 0)} /></td></tr>
            <tr className="bg-navy/[0.03] font-semibold"><td className="px-4 py-2.5 text-navy">Net position</td><td className={'px-4 ' + amtCls(net)}><AnimMoney value={net} /></td></tr>
          </tbody></table>
        </Section>

        <Section delay={700} icon="calendar" title="Monthly Performance" subtitle={`${cur.name} compared with ${prev.name}`}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-navy/10"><Th>&nbsp;</Th><Th right>{cur.name}</Th><Th right>{prev.name}</Th></tr></thead>
            <tbody>
              <tr className="border-b border-navy/10"><td className="px-4 py-2.5 text-ink/70">Sales</td><td className="px-4 text-right tabular-nums"><AnimMoney value={cur.sales} /></td><td className="px-4 text-right tabular-nums text-ink/60">{money(prev.sales)}</td></tr>
              <tr className="border-b border-navy/10"><td className="px-4 py-2.5 text-ink/70">Purchases</td><td className="px-4 text-right tabular-nums"><AnimMoney value={cur.purchases} /></td><td className="px-4 text-right tabular-nums text-ink/60">{money(prev.purchases)}</td></tr>
              <tr className="bg-navy/[0.03] font-semibold"><td className="px-4 py-2.5 text-navy">Difference</td><td className={'px-4 ' + amtCls(cur.sales - cur.purchases)}><AnimMoney value={cur.sales - cur.purchases} /></td><td className={'px-4 ' + amtCls(prev.sales - prev.purchases)}>{money(prev.sales - prev.purchases)}</td></tr>
            </tbody>
          </table>
        </Section>
      </div>
    </div>

    {/* Row 2: transactions + leads */}
    <div className="grid lg:grid-cols-3 gap-6 mt-6">
      <Section delay={800} icon="list" title="Latest Activity" subtitle="Most recent invoices and bills" className="lg:col-span-2">
        {recent.length === 0 ? <Empty>No invoices yet.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-navy/10"><Th>Date</Th><Th>Ref</Th><Th>Contact</Th><Th>Type</Th><Th right>Amount</Th></tr></thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={r.kind + r.id} style={{ '--d': 900 + i * 70 + 'ms' }} className="anim-row border-b border-navy/5 last:border-0 hover:bg-navy/[0.03] transition-colors">
                  <td className="px-4 py-2.5 text-ink/60 whitespace-nowrap">{new Date(r.date).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 font-medium text-navy">{r.number}</td>
                  <td className="px-4">{r.contact?.name}</td>
                  <td className="px-4"><span className={'text-xs font-medium ' + (r.kind === 'Sale' ? 'text-navy' : 'text-gold')}>{r.kind}</span></td>
                  <td className="px-4 text-right tabular-nums font-medium">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section delay={900} icon="funnel" title="Sales Pipeline" subtitle="Where your leads stand" right={<Link to="/leads" className="text-xs font-medium text-gold hover:underline">Open leads →</Link>}>
        {leadTotal === 0 ? <Empty>No leads yet. Add one in Leads.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-navy/10"><Th>Stage</Th><Th right>Leads</Th><Th right>Share</Th></tr></thead>
            <tbody>
              {leads.map((l, i) => {
                const p = Math.round((l.value / leadTotal) * 100)
                return (
                  <tr key={l.name} className="border-b border-navy/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: STAGE[l.name] }} /><span className="text-ink/70">{l.name}</span></div>
                      <div className="h-1 rounded-full bg-navy/5 mt-1.5 overflow-hidden"><div className="grow-x h-full rounded-full" style={{ width: p + '%', background: STAGE[l.name], '--d': 1000 + i * 100 + 'ms' }} /></div>
                    </td>
                    <td className="px-4 text-right font-semibold text-navy tabular-nums">{l.value}</td>
                    <td className="px-4 text-right text-xs text-ink/50 tabular-nums">{p}%</td>
                  </tr>
                )
              })}
              <tr className="bg-navy/[0.03] font-semibold"><td className="px-4 py-2.5 text-navy">Total</td><td className="px-4 text-right text-navy tabular-nums">{leadTotal}</td><td /></tr>
            </tbody>
          </table>
        )}
      </Section>
    </div>

    {/* Row 3: low stock */}
    <div className="mt-6">
      <Section delay={1000} icon="alert" title="Stock Alerts" subtitle="Items below their minimum quantity" right={<span className="text-xs text-ink/50">{low.length} item(s)</span>}>
        {low.length === 0 ? <Empty>All items are above minimum.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-navy/10"><Th>Item</Th><Th right>Qty</Th><Th right>Min qty</Th><Th right>Shortfall</Th><Th>Level</Th></tr></thead>
            <tbody>
              {low.map((it, i) => {
                const q = Number(it.qty) || 0, m = Number(it.minQty) || 0
                return (
                  <tr key={it.id ?? i} style={{ '--d': 1100 + i * 70 + 'ms' }} className="anim-row border-b border-navy/5 last:border-0 hover:bg-navy/[0.03] transition-colors">
                    <td className="px-4 py-2.5 font-medium text-navy">{it.name}</td>
                    <td className="px-4 text-right tabular-nums text-red-700">{q}</td>
                    <td className="px-4 text-right tabular-nums text-ink/60">{m}</td>
                    <td className="px-4 text-right tabular-nums">{Math.max(0, m - q)}</td>
                    <td className="px-4 w-40"><div className="h-1.5 rounded-full bg-red-50 overflow-hidden"><div className="grow-x h-full bg-red-500 rounded-full" style={{ width: (m > 0 ? Math.min(100, (q / m) * 100) : 0) + '%', '--d': 1200 + i * 70 + 'ms' }} /></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  </>)
}