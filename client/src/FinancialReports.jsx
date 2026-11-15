// src/FinancialReports.jsx
// Profit and Loss and Cash Flow Statement (Manager.io style), with a date range selector.
// Expected API (to be built later; both can be calculated from the existing journal entries):
//   GET /reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
//       -> { income: [{ code, name, amount }], expenses: [{ code, name, amount }] }
//   GET /reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
//       -> { opening, inflows: [{ name, amount }], outflows: [{ name, amount }] }
//          (opening = total bank and cash balance on the day before "from")
// "from" and "to" are left out of the request when the range is "All time".
import { useState } from 'react'
import { useLoad, money, fmtDate, inp, Btn, BtnLight, Title, Table } from './ui'
import { useCustomize } from './customize'

// ---------- Date helpers ----------
const n = v => Number(v) || 0
const sum = rows => (rows || []).reduce((s, r) => s + n(r.amount), 0)
// Date -> YYYY-MM-DD using local time (toISOString would shift the day in some time zones)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Preset ranges: [key, label, function returning { from, to }]
const PRESETS = [
  ['month', 'This month', () => { const d = new Date(); return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) } }],
  ['last', 'Last month', () => { const d = new Date(); return { from: ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: ymd(new Date(d.getFullYear(), d.getMonth(), 0)) } }],
  ['year', 'This year', () => { const y = new Date().getFullYear(); return { from: `${y}-01-01`, to: `${y}-12-31` } }],
  ['all', 'All time', () => ({ from: '', to: '' })],
]

// Builds the API path with the date range
const withRange = (path, r) => {
  const q = [r.from && 'from=' + r.from, r.to && 'to=' + r.to].filter(Boolean).join('&')
  return q ? `${path}?${q}` : path
}

// ---------- Shared pieces ----------
// Date range selector: preset buttons plus two date boxes
function DateRange({ range, onChange }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
      <div className="flex gap-2">
        {PRESETS.map(([k, label, fn]) => (
          <BtnLight key={k} onClick={() => onChange(fn())}>{label}</BtnLight>
        ))}
      </div>
      <label className="text-sm">From
        <input type="date" className={inp + ' w-40 ml-2 inline-block'} value={range.from} onChange={e => onChange({ ...range, from: e.target.value })} />
      </label>
      <label className="text-sm">To
        <input type="date" className={inp + ' w-40 ml-2 inline-block'} value={range.to} onChange={e => onChange({ ...range, to: e.target.value })} />
      </label>
    </div>
  )
}

// Text under the title that shows the chosen period
const periodText = r => (!r.from && !r.to ? 'All dates' : `${r.from ? fmtDate(r.from) : 'Start'} to ${r.to ? fmtDate(r.to) : 'today'}`)

// A table of rows followed by a total line
function Section({ title, rows, totalLabel, withCode }) {
  const cols = [
    ...(withCode ? [['Code', r => r.code]] : []),
    ['Account', r => r.name],
    ['Amount', r => money(r.amount), 1],
  ]
  return (<>
    <h2 className="font-semibold mt-6 mb-2">{title}</h2>
    <Table cols={cols} rows={rows} empty="Nothing in this period." />
    <p className="text-right font-semibold mt-2">{totalLabel} {money(sum(rows))}</p>
  </>)
}

// Notice shown while the server route does not exist yet (useLoad gives [] when the request fails)
const NotReady = ({ path }) => (
  <p className="text-sm bg-gold/10 border border-gold/30 rounded px-3 py-2 max-w-xl">
    This report is not available yet. The server route <code>{path}</code> still has to be built.
  </p>
)

// Prints only the report (same technique as the payslip page)
const PrintStyle = () => (
  <style>{`@media print { body * { visibility: hidden } #report-doc, #report-doc * { visibility: visible } #report-doc { position: absolute; left: 0; top: 0; width: 100% } }`}</style>
)

// =====================================================
// Profit and Loss
// =====================================================
export function ProfitAndLoss() {
  const { settings } = useCustomize()
  const [range, setRange] = useState(PRESETS[2][2]()) // starts on "This year"
  const path = withRange('/reports/profit-and-loss', range)
  const [data] = useLoad(path)

  // A failed request gives an array, so a real report is an object with an income list
  const ready = data && data.income
  const income = sum(data?.income), expenses = sum(data?.expenses), profit = income - expenses

  return (<>
    <PrintStyle />
    <Title hint="Income less expenses for the chosen period."
      right={<BtnLight onClick={() => window.print()}>Print / PDF</BtnLight>}>Profit and Loss Statement</Title>
    <DateRange range={range} onChange={setRange} />

    {data && !ready && <NotReady path="/reports/profit-and-loss" />}
    {ready && (
      <div id="report-doc" className="max-w-3xl">
        <p className="font-semibold">{settings.business.name}</p>
        <p className="text-sm text-ink/60">Profit and Loss Statement · {periodText(range)}</p>
        <Section title="Income" rows={data.income} totalLabel="Total income" withCode />
        <Section title="Less expenses" rows={data.expenses} totalLabel="Total expenses" withCode />
        <p className={'text-right text-lg font-semibold mt-6 ' + (profit < 0 ? 'text-red-700' : 'text-navy')}>
          {profit < 0 ? 'Net loss' : 'Net profit'} {money(Math.abs(profit))}
        </p>
      </div>
    )}
  </>)
}

// =====================================================
// Cash Flow Statement
// =====================================================
export function CashFlow() {
  const { settings } = useCustomize()
  const [range, setRange] = useState(PRESETS[2][2]())
  const path = withRange('/reports/cash-flow', range)
  const [data] = useLoad(path)

  const ready = data && data.inflows
  const inflow = sum(data?.inflows), outflow = sum(data?.outflows)
  const opening = n(data?.opening), net = inflow - outflow

  return (<>
    <PrintStyle />
    <Title hint="Cash received and paid, from your bank and cash accounts."
      right={<BtnLight onClick={() => window.print()}>Print / PDF</BtnLight>}>Cash Flow Statement</Title>
    <DateRange range={range} onChange={setRange} />

    {data && !ready && <NotReady path="/reports/cash-flow" />}
    {ready && (
      <div id="report-doc" className="max-w-3xl">
        <p className="font-semibold">{settings.business.name}</p>
        <p className="text-sm text-ink/60">Cash Flow Statement · {periodText(range)}</p>

        <p className="mt-6 font-semibold">Opening cash balance <span className="float-right">{money(opening)}</span></p>
        <Section title="Cash received" rows={data.inflows} totalLabel="Total cash received" />
        <Section title="Cash paid" rows={data.outflows} totalLabel="Total cash paid" />

        <dl className="mt-6 border-t border-navy/20 pt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Net change in cash</dt><dd className={net < 0 ? 'text-red-700' : ''}>{money(net)}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Closing cash balance</dt><dd>{money(opening + net)}</dd></div>
        </dl>
      </div>
    )}
  </>)
}