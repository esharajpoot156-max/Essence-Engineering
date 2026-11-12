import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, AreaChart, Area } from 'recharts'
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

const makeSpark = (data, id) => {
  const vals = data.map(x => x.v)
  const distinct = new Set(vals.map(v => Math.round(v))).size
  if (distinct >= 4) return { pts: data, real: true }
  const up = (vals[vals.length - 1] - vals[0]) >= 0
  const phase = id.length * 1.3 // har card ki wave thodi alag
  const N = 16
  const pts = [...Array(N)].map((_, i) => {
    const t = i / (N - 1)
    const trend = (up ? t : 1 - t) * 0.55
    const wave = 0.2 * Math.sin(t * Math.PI * 2.5 + phase)
    return { name: '', v: 50 + (trend - 0.275 + wave) * 100 }
  })
  return { pts, real: false }
}

// For each card, show a number, a % change vs last month, and a small sparkline
const Stat = ({ id, label, value, icon, color, tint, data, goodUp = true }) => {
  const a = data[data.length - 2]?.v, b = data[data.length - 1]?.v
  const pct = a ? Math.round(((b - a) / Math.abs(a)) * 100) : null
  const good = pct !== null && (pct >= 0) === goodUp
  const spark = useMemo(() => makeSpark(data, id), [data, id])
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-navy/10 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition p-4 min-h-[175px] flex flex-col">
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 shrink-0 rounded-xl grid place-items-center" style={{ background: tint, color }}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
        </span>
        <span className="text-sm text-ink/60 leading-tight">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-navy mt-4 truncate" title={money(value)}>{money(value)}</p>
      <p className={'text-xs mt-1 ' + (pct === null ? 'text-ink/40' : good ? 'text-emerald-600' : 'text-red-600')}>
        {pct === null ? 'No change data' : `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs last month`}
      </p>

      {/* Sparkline */}
      <div className="mt-auto pt-3 -mb-4 -mr-4 ml-auto w-1/2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark.pts} margin={{ top: 6, right: 0, left: 0, bottom: 2 }}>
            <defs><linearGradient id={'g-' + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            {spark.real && <Tooltip formatter={v => money(v)} labelFormatter={() => ''} />}
            <Area type="monotone" dataKey="v" baseValue="dataMin" stroke={color} strokeWidth={2.5} fill={`url(#g-${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const Card = ({ title, right, children, className = '' }) => (
  <section className={'bg-white rounded-2xl border border-navy/10 shadow-sm p-5 ' + className}>
    <div className="flex items-center justify-between gap-2 mb-3"><h2 className="font-semibold text-navy">{title}</h2>{right}</div>
    {children}
  </section>
)
const Pills = ({ options, value, onChange }) => (
  <div className="flex gap-1 bg-navy/5 rounded-lg p-1">
    {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={'px-3 py-1 rounded-md text-xs font-medium ' + (value === v ? 'bg-white text-navy shadow-sm' : 'text-ink/60 hover:text-navy')}>{l}</button>)}
  </div>
)
const MoneyTip = ({ active, payload, label }) => active && payload?.length ? (
  <div className="bg-navy text-white rounded px-3 py-1.5 text-xs shadow-lg"><p className="opacity-70">{label}</p><p className="font-semibold">{money(payload[0].value)}</p></div>
) : null

export function Dashboard() {
  const [d, setD] = useState(null), [sales, setSales] = useState([]), [buys, setBuys] = useState([]), [err, setErr] = useState('')
  const [bank, setBank] = useState([]), [journal, setJournal] = useState([])
  const [range, setRange] = useState(12), [series, setSeries] = useState('sales'), [hot, setHot] = useState(null)
  const [stage, setStage] = useState(null) // selected lead stage

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

  // One curved line per card
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

  // Sales report data (unchanged)
  const months = useMemo(() => {
    const m = buildMonths(range), sv = perMonth(m, s, r => Number(r.total) || 0), bv = perMonth(m, b, r => Number(r.total) || 0)
    return m.map((x, i) => ({ ...x, sales: sv[i], purchases: bv[i] }))
  }, [sales, buys, range])
  const recent = useMemo(() => [...s.map(x => ({ ...x, kind: 'Sale' })), ...b.map(x => ({ ...x, kind: 'Purchase' }))]
    .sort((x, y) => new Date(y.date) - new Date(x.date)).slice(0, 6), [sales, buys])

  if (err) return <p className="text-red-700" role="alert">{err}</p>
  if (!d?.leads) return <p>Loading…</p>

  const barColor = series === 'sales' ? NAVY : GOLD, activeIdx = hot ?? months.length - 1
  const avg = months.reduce((t, m) => t + m[series], 0) / months.length
  const leads = Object.entries(d.leads).map(([name, v]) => ({ name, value: Number(v) || 0 }))
  const leadTotal = leads.reduce((t, x) => t + x.value, 0), low = d.lowStock || []
  const sel = leads.find(l => l.name === stage)

  return (<>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-3xl font-semibold text-navy">{greet}, <span className="capitalize">{role}</span> 👋</h1>
        <p className="text-sm text-ink/60 mt-1">Here's what's happening in your business today.</p>
      </div>
      <span className="text-sm text-ink/50">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </div>

    <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
      <Stat id="cash" label="Cash in bank" value={d.cash} icon="cash" color={NAVY} tint="#E3EAF3" data={lines.cash} />
      <Stat id="rec" label="Customers owe us" value={d.receivable} icon="in" color={GREEN} tint="#DDF0E5" data={lines.rec} />
      <Stat id="pay" label="We owe suppliers" value={d.payable} icon="out" color={RED} tint="#FBE3E3" data={lines.pay} goodUp={false} />
      <Stat id="sales" label="Total sales" value={d.sales} icon="sales" color={PURPLE} tint="#ECE9FA" data={lines.sales} />
      <Stat id="buys" label="Total purchases" value={d.purchases} icon="buy" color={GOLD} tint="#F6EBD3" data={lines.buys} goodUp={false} />
    </div>

    <div className="grid lg:grid-cols-3 gap-6 mt-6">
      <Card title={series === 'sales' ? 'Sales report' : 'Purchases report'} className="lg:col-span-2"
        right={<div className="flex gap-2 flex-wrap">
          <Pills value={series} onChange={setSeries} options={[['sales', 'Sales'], ['purchases', 'Purchases']]} />
          <Pills value={range} onChange={v => { setRange(v); setHot(null) }} options={[[12, '12 Months'], [6, '6 Months']]} />
        </div>}>
        <p className="text-xs text-ink/50">Avg. per month</p>
        <p className="text-2xl font-semibold text-navy">{money(avg)}</p>
        <div className="h-64 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} onMouseLeave={() => setHot(null)}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={44} fontSize={12} />
              <Tooltip content={<MoneyTip />} cursor={false} />
              <Bar dataKey={series} radius={[6, 6, 0, 0]} maxBarSize={34} onMouseEnter={(_, i) => setHot(i)}>
                {months.map((m, i) => <Cell key={m.key} fill={i === activeIdx ? barColor : barColor + '33'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Lead pipeline" right={<Link to="/leads" className="text-xs font-medium text-gold hover:underline">Open leads →</Link>}>
        {leadTotal === 0 ? <p className="text-sm text-ink/60 py-16 text-center">No leads yet. Add one in Leads.</p> : (<>
          <div className="text-center mb-4">
            <p className="text-4xl font-semibold" style={{ color: sel ? STAGE[sel.name] : NAVY }}>{sel ? sel.value : leadTotal}</p>
            <p className="text-xs text-ink/50">{sel ? `${sel.name} · ${Math.round((sel.value / leadTotal) * 100)}% of all leads` : 'Total leads. Click a stage'}</p>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-navy/5 gap-0.5">
            {leads.filter(l => l.value > 0).map(l => (
              <button key={l.name} title={l.name} onClick={() => setStage(stage === l.name ? null : l.name)}
                className="h-full transition-all hover:opacity-80" style={{ width: (l.value / leadTotal) * 100 + '%', background: STAGE[l.name], opacity: !stage || stage === l.name ? 1 : 0.25 }} />
            ))}
          </div>
          <ul className="mt-4 space-y-1">
            {leads.map(l => (
              <li key={l.name}>
                <button onClick={() => setStage(stage === l.name ? null : l.name)}
                  className={'w-full flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 transition ' + (stage === l.name ? 'bg-navy/5' : 'hover:bg-navy/5')} style={{ opacity: !stage || stage === l.name ? 1 : 0.5 }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE[l.name] }} />
                  <span className="text-ink/70">{l.name}</span>
                  <span className="ml-auto font-semibold text-navy">{l.value}</span>
                  <span className="w-9 text-right text-xs text-ink/40">{Math.round((l.value / leadTotal) * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </>)}
      </Card>
    </div>

    <div className="grid lg:grid-cols-3 gap-6 mt-6">
      <Card title="Recent invoices & bills" className="lg:col-span-2">
        <table className="w-full text-sm"><tbody>
          {recent.map(r => (
            <tr key={r.kind + r.id} className="border-t border-navy/10 hover:bg-navy/5">
              <td className="py-2.5 pl-1 font-medium text-navy">{r.number}</td>
              <td>{r.contact?.name}</td>
              <td className="text-ink/60">{new Date(r.date).toLocaleDateString()}</td>
              <td><span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (r.kind === 'Sale' ? 'bg-navy/10 text-navy' : 'bg-gold/15 text-gold')}>{r.kind}</span></td>
              <td className="text-right pr-1 font-medium">{money(r.total)}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td className="py-8 text-center text-ink/60">No invoices yet.</td></tr>}
        </tbody></table>
      </Card>

      <Card title="Items running low" right={<span className="text-xs text-ink/50">{low.length} item(s)</span>}>
        {low.length === 0 ? <p className="text-sm text-ink/60 py-4 text-center">All items are above minimum.</p> : (
          <ul className="space-y-3">
            {low.map((it, i) => {
              const q = Number(it.qty) || 0, m = Number(it.minQty) || 0
              return (
                <li key={it.id ?? i}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{it.name}</span><span className="text-red-700">{q} / {m}</span></div>
                  <div className="h-2 rounded-full bg-red-50 mt-1 overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: (m > 0 ? Math.min(100, (q / m) * 100) : 0) + '%' }} /></div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  </>)
}