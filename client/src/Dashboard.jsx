import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, Tooltip, AreaChart, Area, YAxis } from 'recharts'
import { api, getToken } from './api'

const NAVY = '#1F3A5A', GOLD = '#B07F24', GREEN = '#2F855A', RED = '#C53030', PURPLE = '#6D5BD0'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = n => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(n) || 0)
const arr = x => (Array.isArray(x) ? x : [])

const ICONS = {
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  in: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  out: 'M12 20V8m0 0l-4 4m4-4l4 4M5 4h14',
  sales: 'M4 19V9m6 10V5m6 14v-7m4 7H2',
  buy: 'M6 6h15l-2 9H8L6 6zm0 0L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zm14 0l-3 7a3 3 0 006 0l-3-7zM8 21h8',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
}

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
@keyframes wave{0%,60%,100%{transform:rotate(0)}10%,30%{transform:rotate(14deg)}20%,40%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
@keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(47,133,90,.5)}70%{box-shadow:0 0 0 8px rgba(47,133,90,0)}100%{box-shadow:0 0 0 0 rgba(47,133,90,0)}}
@keyframes sheen{from{transform:translateX(-120%)}to{transform:translateX(320%)}}
.anim-up{animation:fadeUp .6s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:var(--d,0ms)}
.wave{display:inline-block;transform-origin:70% 70%;animation:wave 2.2s ease-in-out 1s 2}
.live-dot{animation:pulseRing 2s infinite}
.sheen::after{content:'';position:absolute;top:0;bottom:0;left:0;width:30%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.6),transparent);transform:translateX(-120%)}
.sheen:hover::after{animation:sheen .9s ease}
.icon-tile{transition:transform .3s cubic-bezier(.2,.7,.2,1)}
.group:hover .icon-tile{transform:scale(1.12) rotate(-6deg)}
@media (prefers-reduced-motion:reduce){.anim-up,.wave,.live-dot{animation:none}.sheen:hover::after{animation:none}}
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

// TOP CARDS (unchanged)
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

// ---------- SUMMARY CARDS (Manager.io style) ----------
// Ek card: title, bada heading, aur uske neeche block
const Section = ({ icon, title, subtitle, children, delay = 0 }) => (
  <section style={{ '--d': delay + 'ms' }} className="group anim-up flex flex-col bg-white rounded-xl border border-navy/10 overflow-hidden hover:shadow-md transition-shadow">
    <div className="flex items-center gap-3 px-4 py-3 border-b border-navy/10 bg-navy/[0.02]">
      <span className="icon-tile h-9 w-9 shrink-0 rounded-lg grid place-items-center bg-navy/10 text-navy"><Icon name={icon} /></span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-navy leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ink/50 truncate">{subtitle}</p>}
      </div>
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </section>
)

// Ek block: bold heading + total, neeche chhoti lines (Assets, Liabilities, Income ...)
// rows = [[label, value], ...]
const Block = ({ title, total, rows = [], strong }) => (
  <div className={'rounded-lg border border-navy/10 overflow-hidden ' + (strong ? 'bg-navy/[0.04]' : 'bg-white')}>
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <h3 className="font-semibold text-navy">{title}</h3>
      <span className={'text-lg font-semibold tabular-nums ' + (total < 0 ? 'text-red-700' : 'text-navy')}><AnimMoney value={total} /></span>
    </div>
    {rows.length > 0 && (
      <table className="w-full text-sm"><tbody>
        {rows.map(([label, v]) => (
          <tr key={label} className="border-t border-navy/5">
            <td className="px-4 py-2 text-ink/70">{label}</td>
            <td className={'px-4 py-2 text-right tabular-nums ' + (v < 0 ? 'text-red-700' : 'text-ink')}>{money(v)}</td>
          </tr>
        ))}
      </tbody></table>
    )}
  </div>
)

export function Dashboard() {
  const [d, setD] = useState(null), [sales, setSales] = useState([]), [buys, setBuys] = useState([]), [err, setErr] = useState('')
  const [bank, setBank] = useState([]), [journal, setJournal] = useState([])

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

  if (err) return <p className="text-red-700" role="alert">{err}</p>
  if (!d) return <p>Loading…</p>

  // Balance Sheet
  const cash = Number(d.cash) || 0, rec = Number(d.receivable) || 0, pay = Number(d.payable) || 0
  const assets = cash + rec
  const liabilities = pay
  const equity = assets - liabilities
  // Profit and Loss
  const income = Number(d.sales) || 0, expenses = Number(d.purchases) || 0
  const profit = income - expenses

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

    {/* Summary: Balance Sheet + Profit and Loss */}
    <div className="grid lg:grid-cols-2 gap-6 mt-6">
      <Section delay={500} icon="scale" title="Balance Sheet" subtitle={'As at ' + today}>
        <Block title="Assets" total={assets} rows={[['Cash & bank', cash], ['Accounts receivable', rec]]} />
        <Block title="Liabilities" total={liabilities} rows={[['Accounts payable', pay]]} />
        <Block title="Equity" total={equity} rows={[['Assets minus liabilities', equity]]} strong />
      </Section>

      <Section delay={600} icon="trend" title="Profit and Loss Statement" subtitle="Based on your recorded sales and purchases">
        <Block title="Income" total={income} rows={[['Sales', income]]} />
        <Block title="Less Expenses" total={expenses} rows={[['Purchases', expenses]]} />
        <Block title="Net profit (loss)" total={profit} strong />
      </Section>
    </div>
  </>)
}