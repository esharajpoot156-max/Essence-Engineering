import { useEffect, useState, useCallback } from 'react'
import { api } from './api'

export const money = n => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const useLoad = path => {
  const [d, setD] = useState(null)
  const load = useCallback(() => api(path).then(setD).catch(() => setD([])), [path])
  useEffect(() => { load() }, [load])
  return [d, load]
}
const inp = 'border border-navy/20 rounded px-3 py-2 text-sm w-full bg-white'
const Btn = ({ className = '', ...p }) => <button {...p} className={'bg-navy text-white text-sm font-medium px-4 py-2 rounded hover:bg-navy/90 disabled:opacity-50 ' + className} />
const Title = ({ children, hint }) => <div className="mb-6"><h1 className="text-2xl font-semibold text-navy">{children}</h1>{hint && <p className="text-sm text-ink/60 mt-1">{hint}</p>}</div>
const Err = ({ e }) => e ? <p className="text-sm text-red-700 mt-2" role="alert">{e}</p> : null
const Table = ({ cols, rows, empty }) => (
  <div className="overflow-x-auto bg-white rounded border border-navy/10">
    <table className="w-full text-sm">
      <thead><tr className="bg-mist/60 text-left">{cols.map(c => <th key={c[0]} className={'px-3 py-2 font-medium ' + (c[2] ? 'text-right' : '')}>{c[0]}</th>)}</tr></thead>
      <tbody>{(rows || []).map((r, i) => <tr key={r.id ?? i} className="border-t border-navy/10">{cols.map(c => <td key={c[0]} className={'px-3 py-2 ' + (c[2] ? 'text-right' : '')}>{c[1](r)}</td>)}</tr>)}
        {rows?.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-ink/60">{empty}</td></tr>}</tbody>
    </table>
  </div>)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const waLink = d => {
  const ph = (d.contact.phone || '').replace(/\D/g, '').replace(/^0/, '92')
  return `https://wa.me/${ph}?text=${encodeURIComponent(`Assalam o Alaikum ${d.contact.name}, ${d.kind === 'sale' ? 'invoice' : 'bill'} ${d.number} from Essence Engineering is ${money(d.total)}. Thank you.`)}`
}
function printDoc(d) {
  const w = window.open('', '_blank'); if (!w) return alert('Allow pop-ups to print')
  const sub = d.lines.reduce((s, l) => s + l.qty * Number(l.price), 0)
  w.document.write(`<html><head><title>${esc(d.number)}</title><style>body{font-family:IBM Plex Sans,Arial,sans-serif;color:#14202E;padding:40px;max-width:800px;margin:auto}header{display:flex;align-items:center;gap:16px;border-bottom:4px solid #B07F24;padding-bottom:16px}h1{margin:0;color:#1F3A5A}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#1F3A5A;color:#fff;text-align:left}td,th{padding:8px;border-bottom:1px solid #ddd}.r{text-align:right}.t td{border:0}</style></head><body>
<header><img src="${location.origin}/logo.png" height="64"><div><h1>Essence Engineering Pvt Ltd</h1><div>${d.kind === 'sale' ? 'Sales Invoice' : 'Purchase Bill'} ${esc(d.number)} · ${new Date(d.date).toLocaleDateString()}</div></div></header>
<p><b>${d.kind === 'sale' ? 'Bill to' : 'Supplier'}:</b> ${esc(d.contact.name)}<br>${esc(d.contact.phone)}</p>
<table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
${d.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${money(l.price)}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join('')}
<tr class="t"><td colspan="3" class="r">Subtotal</td><td class="r">${money(sub)}</td></tr>
<tr class="t"><td colspan="3" class="r">Tax (${Number(d.taxRate)}%)</td><td class="r">${money(d.tax)}</td></tr>
<tr class="t"><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${money(d.total)}</b></td></tr></table></body></html>`)
  w.document.close(); setTimeout(() => w.print(), 600)
}

export function Dashboard() {
  const [d] = useLoad('/dashboard')
  if (!d?.leads) return <p>Loading…</p>
  const stats = [['Cash in bank', d.cash], ['Customers owe us', d.receivable], ['We owe suppliers', d.payable], ['Total sales', d.sales], ['Total purchases', d.purchases]]
  return (<>
    <Title hint="Where the business stands today.">Dashboard</Title>
    <dl className="grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-navy/15 border border-navy/15 rounded overflow-hidden">
      {stats.map(([k, v]) => <div key={k} className="bg-white p-4"><dt className="text-sm text-ink/60">{k}</dt><dd className="text-xl font-semibold text-navy mt-1">{money(v)}</dd></div>)}
    </dl>
    <div className="grid md:grid-cols-2 gap-8 mt-8">
      <section><h2 className="font-semibold mb-2">Lead pipeline</h2>
        <Table cols={[['Stage', r => r[0]], ['Leads', r => r[1], 1]]} rows={Object.entries(d.leads).map(([k, v]) => ({ id: k, 0: k, 1: v }))} empty="No leads yet. Add one in Leads." /></section>
      <section><h2 className="font-semibold mb-2">Items running low</h2>
        <Table cols={[['Item', r => r.name], ['In stock', r => r.qty, 1], ['Minimum', r => r.minQty, 1]]} rows={d.lowStock} empty="All items are above their minimum." /></section>
    </div>
  </>)
}

export function Documents({ kind }) {
  const sale = kind === 'sale'
  const [docs, reload] = useLoad('/invoices?kind=' + kind), [contacts] = useLoad('/contacts?type=' + (sale ? 'customer' : 'supplier')), [items] = useLoad('/items')
  const blank = { itemId: '', description: '', qty: 1, price: 0 }
  const [contactId, setContactId] = useState(''), [lines, setLines] = useState([blank]), [err, setErr] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), tax = Math.round(subtotal * taxRate) / 100, total = subtotal + tax
  const setLine = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const pick = (i, id) => { const it = items.find(x => x.id === +id); setLine(i, { itemId: id, description: it?.name || '', price: it ? Number(sale ? it.price : it.cost) : 0 }) }
  const save = async () => {
    try { await api('/invoices', { method: 'POST', body: { kind, contactId, lines, taxRate } }); setLines([blank]); setErr(''); reload() } catch (e) { setErr(e.message) }
  }
  return (<>
    <Title hint={sale ? 'Saving an invoice reduces stock and records the sale in the books.' : 'Saving a bill adds stock and records what you owe.'}>{sale ? 'Sales invoices' : 'Purchase bills'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 mb-8 space-y-3">
      <select className={inp} value={contactId} onChange={e => setContactId(e.target.value)}>
        <option value="">{sale ? 'Choose customer' : 'Choose supplier'}</option>{contacts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select className={inp + ' col-span-12 sm:col-span-4'} value={l.itemId} onChange={e => pick(i, e.target.value)}>
            <option value="">Service / other</option>{items?.map(it => <option key={it.id} value={it.id}>{it.name} ({it.qty} in stock)</option>)}</select>
          <input className={inp + ' col-span-12 sm:col-span-4'} placeholder="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
          <input className={inp + ' col-span-5 sm:col-span-1'} type="number" min="1" aria-label="Quantity" value={l.qty} onChange={e => setLine(i, { qty: +e.target.value })} />
          <input className={inp + ' col-span-5 sm:col-span-2'} type="number" min="0" aria-label="Price" value={l.price} onChange={e => setLine(i, { price: +e.target.value })} />
          <button className="col-span-2 sm:col-span-1 text-sm text-red-700" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank])}>Remove</button>
        </div>))}
      <div className="flex items-center gap-4"><button className="text-sm text-gold font-medium" onClick={() => setLines([...lines, blank])}>Add line</button>
        <label className="ml-auto text-sm flex items-center gap-2">Tax %<input className={inp + ' w-20'} type="number" min="0" value={taxRate} onChange={e => setTaxRate(+e.target.value)} /></label>
        <span className="font-semibold">Total {money(total)} <span className="text-ink/60 font-normal text-sm">(tax {money(tax)})</span></span><Btn onClick={save}>{sale ? 'Save invoice' : 'Save bill'}</Btn></div>
      <Err e={err} />
    </section>
    <Table cols={[['Number', r => r.number], ['Date', r => new Date(r.date).toLocaleDateString()], [sale ? 'Customer' : 'Supplier', r => r.contact.name], ['Tax', r => money(r.tax), 1], ['Total', r => money(r.total), 1],
      ['Share', r => <span className="inline-flex gap-3"><button className="text-gold font-medium" onClick={() => printDoc(r)}>Print / PDF</button><a className="text-gold font-medium" target="_blank" rel="noreferrer" href={waLink(r)}>WhatsApp</a></span>]]}
      rows={docs} empty={sale ? 'No invoices yet. Create your first one above.' : 'No bills yet. Record your first purchase above.'} />
  </>)
}

export function Contacts({ type }) {
  const cust = type === 'customer'
  const [rows, reload] = useLoad('/contacts?type=' + type), [f, setF] = useState({ name: '', phone: '', email: '' }), [amt, setAmt] = useState({}), [err, setErr] = useState('')
  const run = async fn => { try { await fn(); setErr(''); reload() } catch (e) { setErr(e.message) } }
  return (<>
    <Title hint={cust ? 'People who buy from you and what they still owe.' : 'People you buy from and what you still owe.'}>{cust ? 'Customers' : 'Suppliers'}</Title>
    <div className="grid sm:grid-cols-4 gap-2 mb-2">
      {['name', 'phone', 'email'].map(k => <input key={k} className={inp} placeholder={k[0].toUpperCase() + k.slice(1)} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />)}
      <Btn onClick={() => run(async () => { await api('/contacts', { method: 'POST', body: { ...f, type } }); setF({ name: '', phone: '', email: '' }) })}>{cust ? 'Add customer' : 'Add supplier'}</Btn></div>
    <Err e={err} /><div className="mt-4" />
    <Table cols={[['Name', r => r.name], ['Phone', r => r.phone], ['Balance', r => money(r.balance), 1],
      [cust ? 'Record receipt' : 'Record payment', r => <span className="inline-flex gap-2"><input className={inp + ' w-28'} type="number" aria-label="Amount" value={amt[r.id] || ''} onChange={e => setAmt({ ...amt, [r.id]: e.target.value })} />
        <Btn onClick={() => run(async () => { await api('/payments', { method: 'POST', body: { kind: cust ? 'receipt' : 'payment', contactId: r.id, amount: amt[r.id] } }); setAmt({ ...amt, [r.id]: '' }) })}>Save</Btn></span>]]}
      rows={rows} empty={cust ? 'No customers yet. Add one above, or convert a lead.' : 'No suppliers yet. Add one above.'} />
  </>)
}

export function Inventory() {
  const [rows, reload] = useLoad('/items'), blank = { sku: '', name: '', unit: 'pcs', cost: '', price: '', minQty: '' }, [f, setF] = useState(blank), [err, setErr] = useState('')
  const labels = { sku: 'SKU', name: 'Item name', unit: 'Unit', cost: 'Cost', price: 'Sale price', minQty: 'Minimum stock' }
  return (<>
    <Title hint="Stock goes up when you save a purchase bill and down when you save a sales invoice.">Inventory</Title>
    <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-2">
      {Object.keys(blank).map(k => <input key={k} className={inp} placeholder={labels[k]} aria-label={labels[k]} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />)}
      <Btn onClick={async () => { try { await api('/items', { method: 'POST', body: f }); setF(blank); setErr(''); reload() } catch (e) { setErr(e.message) } }}>Add item</Btn></div>
    <Err e={err} /><div className="mt-4" />
    <Table cols={[['SKU', r => r.sku], ['Item', r => r.name], ['In stock', r => <span className={r.qty <= r.minQty ? 'text-red-700 font-semibold' : ''}>{r.qty} {r.unit}</span>, 1],
      ['Cost', r => money(r.cost), 1], ['Price', r => money(r.price), 1], ['Stock value', r => money(r.qty * r.cost), 1]]} rows={rows} empty="No items yet. Add your first item above." />
  </>)
}

const STAGES = ['New', 'Contacted', 'Qualified', 'Quotation', 'Won', 'Lost']
export function Leads() {
  const [rows, reload] = useLoad('/leads'), [f, setF] = useState({ name: '', phone: '', source: 'Manual' }), [err, setErr] = useState('')
  const run = async fn => { try { await fn(); setErr(''); reload() } catch (e) { setErr(e.message) } }
  return (<>
    <Title hint="Meta leads arrive here automatically once the webhook is connected.">Leads</Title>
    <div className="grid sm:grid-cols-4 gap-2 mb-2">
      <input className={inp} placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      <input className={inp} placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
      <select className={inp} value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>{['Manual', 'Meta Ads', 'WhatsApp', 'Website', 'Referral'].map(s => <option key={s}>{s}</option>)}</select>
      <Btn onClick={() => run(async () => { await api('/leads', { method: 'POST', body: f }); setF({ name: '', phone: '', source: 'Manual' }) })}>Add lead</Btn></div>
    <Err e={err} />
    <div className="flex gap-3 overflow-x-auto mt-6 pb-4">
      {STAGES.map(s => { const col = (rows || []).filter(l => l.stage === s); return (
        <section key={s} className="min-w-56 w-56 shrink-0">
          <h2 className="font-semibold text-sm border-b-2 border-gold pb-1 mb-2">{s} <span className="text-ink/50 font-normal">{col.length}</span></h2>
          <div className="space-y-2">{col.map(l => (
            <article key={l.id} className="bg-white border border-navy/10 rounded p-3 text-sm">
              <p className="font-medium">{l.name}</p><p className="text-ink/60">{l.phone || 'No phone'} · {l.source}</p>
              <select className={inp + ' mt-2'} aria-label="Move to stage" value={l.stage} onChange={e => run(() => api('/leads/' + l.id, { method: 'PATCH', body: { stage: e.target.value } }))}>{STAGES.map(x => <option key={x}>{x}</option>)}</select>
              {l.stage !== 'Won' && <button className="text-gold font-medium mt-2" onClick={() => run(() => api(`/leads/${l.id}/convert`, { method: 'POST' }))}>Make customer</button>}
            </article>))}
            {col.length === 0 && <p className="text-sm text-ink/50">Empty</p>}</div>
        </section>) })}
    </div>
  </>)
}

export function Reports() {
  const [tb] = useLoad('/reports/trial-balance'), [pl] = useLoad('/reports/pnl'), [jr] = useLoad('/journal')
  return (<>
    <Title hint="Built automatically from every invoice, bill and payment.">Reports</Title>
    {pl?.income !== undefined && <dl className="grid grid-cols-3 gap-px bg-navy/15 border border-navy/15 rounded overflow-hidden mb-8">
      {[['Income', pl.income], ['Expenses', pl.expense], ['Profit', pl.profit]].map(([k, v]) => <div key={k} className="bg-white p-4"><dt className="text-sm text-ink/60">{k}</dt><dd className="text-xl font-semibold text-navy">{money(v)}</dd></div>)}</dl>}
    <h2 className="font-semibold mb-2">Trial balance</h2>
    <Table cols={[['Code', r => r.code], ['Account', r => r.name], ['Debit', r => money(r.debit), 1], ['Credit', r => money(r.credit), 1]]} rows={tb} empty="No accounts." />
    <h2 className="font-semibold mt-8 mb-2">Recent journal entries</h2>
    <Table cols={[['Date', r => new Date(r.date).toLocaleDateString()], ['Memo', r => r.memo], ['Lines', r => r.lines.map(l => `${l.account.name} ${Number(l.debit) ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}`).join(' · ')]]} rows={jr} empty="No entries yet. Save an invoice to see one." />
  </>)
}

const MODS = [['sales', 'Sales & customers'], ['purchases', 'Purchases & suppliers'], ['inventory', 'Inventory'], ['leads', 'Leads'], ['reports', 'Reports']]
export function SettingsPage({ settings, onSaved }) {
  const [mods, setMods] = useState(settings.modules), [msg, setMsg] = useState('')
  const toggle = m => setMods(mods.includes(m) ? mods.filter(x => x !== m) : [...mods, m])
  return (<>
    <Title hint="Turn on only the modules your team uses. Hidden modules keep their data.">Settings</Title>
    <fieldset className="bg-white border border-navy/10 rounded p-4 space-y-2 max-w-md">
      <legend className="font-semibold px-1">Modules</legend>
      {MODS.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={mods.includes(k)} onChange={() => toggle(k)} />{l}</label>)}
      <Btn onClick={async () => { await api('/settings', { method: 'PUT', body: { modules: mods } }); setMsg('Saved'); onSaved() }}>Save modules</Btn> <span className="text-sm text-ink/60">{msg}</span>
    </fieldset>
    <section className="bg-white border border-navy/10 rounded p-4 mt-6 max-w-2xl text-sm space-y-2">
      <h2 className="font-semibold">Connect Meta Lead Ads</h2>
      <p>Webhook URL (use your public https domain when live):</p>
      <code className="block bg-mist/60 rounded px-3 py-2 break-all">{location.origin}/api/webhooks/meta</code>
      <p>In Meta for Developers, add the Webhooks product, subscribe your Page to <b>leadgen</b>, and paste this URL with the verify token from <b>server/.env</b> (META_VERIFY_TOKEN). Put your Page access token in META_PAGE_TOKEN. New leads then appear in Leads with source "Meta Ads".</p>
    </section>
  </>)
}

export function Journal() {
  const [accts] = useLoad('/accounts'), [jr, reload] = useLoad('/journal'), blank = { accountId: '', debit: '', credit: '' }
  const [memo, setMemo] = useState(''), [lines, setLines] = useState([blank, blank]), [err, setErr] = useState('')
  const dr = lines.reduce((s, l) => s + (+l.debit || 0), 0), cr = lines.reduce((s, l) => s + (+l.credit || 0), 0)
  const set = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const save = async () => {
    try {
      await api('/journal', { method: 'POST', body: { memo, lines: lines.filter(l => l.accountId).map(l => ({ accountId: +l.accountId, debit: +l.debit || 0, credit: +l.credit || 0 })) } })
      setMemo(''); setLines([blank, blank]); setErr(''); reload()
    } catch (e) { setErr(e.message) }
  }
  return (<>
    <Title hint="For entries that are not an invoice, bill or payment, like opening balances or bank charges.">Journal entries</Title>
    <section className="bg-white border border-navy/10 rounded p-4 mb-8 space-y-2">
      <input className={inp} placeholder="What is this entry for?" value={memo} onChange={e => setMemo(e.target.value)} />
      {lines.map((l, i) => <div key={i} className="grid grid-cols-12 gap-2">
        <select className={inp + ' col-span-12 sm:col-span-6'} value={l.accountId} onChange={e => set(i, { accountId: e.target.value })}>
          <option value="">Choose account</option>{accts?.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
        <input className={inp + ' col-span-6 sm:col-span-3'} type="number" min="0" placeholder="Debit" value={l.debit} onChange={e => set(i, { debit: e.target.value })} />
        <input className={inp + ' col-span-6 sm:col-span-3'} type="number" min="0" placeholder="Credit" value={l.credit} onChange={e => set(i, { credit: e.target.value })} /></div>)}
      <div className="flex items-center gap-4"><button className="text-sm text-gold font-medium" onClick={() => setLines([...lines, blank])}>Add line</button>
        <span className={'ml-auto text-sm ' + (dr === cr ? 'text-ink/60' : 'text-red-700')}>Debit {money(dr)} · Credit {money(cr)}</span>
        <Btn disabled={!memo || !dr || dr !== cr} onClick={save}>Save entry</Btn></div>
      <Err e={err} />
    </section>
    <Table cols={[['Date', r => new Date(r.date).toLocaleDateString()], ['Memo', r => r.memo], ['Lines', r => r.lines.map(l => `${l.account.name} ${Number(l.debit) ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}`).join(' · ')]]}
      rows={jr} empty="No entries yet." />
  </>)
}

export function Bank() {
  const [rows, reload] = useLoad('/bank/lines'), [stmt, setStmt] = useState('')
  const net = r => Number(r.debit) - Number(r.credit), list = rows || []
  const book = list.reduce((s, r) => s + net(r), 0), cleared = list.filter(r => r.reconciled).reduce((s, r) => s + net(r), 0)
  const diff = stmt === '' ? null : Number(stmt) - cleared
  return (<>
    <Title hint="Tick each line that appears on your bank statement, then enter the statement's closing balance.">Bank reconciliation</Title>
    <dl className="grid grid-cols-3 gap-px bg-navy/15 border border-navy/15 rounded overflow-hidden mb-6">
      <div className="bg-white p-4"><dt className="text-sm text-ink/60">Balance in books</dt><dd className="text-xl font-semibold text-navy">{money(book)}</dd></div>
      <div className="bg-white p-4"><dt className="text-sm text-ink/60">Ticked as cleared</dt><dd className="text-xl font-semibold text-navy">{money(cleared)}</dd></div>
      <div className="bg-white p-4"><dt className="text-sm text-ink/60">Statement closing balance</dt><dd><input className={inp + ' mt-1'} type="number" value={stmt} onChange={e => setStmt(e.target.value)} /></dd></div>
    </dl>
    {diff !== null && <p className={'mb-4 font-medium ' + (diff === 0 ? 'text-green-700' : 'text-red-700')}>{diff === 0 ? 'Reconciled. Your books match the bank.' : `Difference of ${money(diff)}. Check for missing or unticked lines.`}</p>}
    <Table cols={[['Cleared', r => <input type="checkbox" aria-label="Cleared" checked={r.reconciled} onChange={async () => { await api('/bank/reconcile', { method: 'POST', body: { ids: [r.id], value: !r.reconciled } }); reload() }} />],
      ['Date', r => new Date(r.journal.date).toLocaleDateString()], ['Memo', r => r.journal.memo], ['Money in', r => Number(r.debit) ? money(r.debit) : '', 1], ['Money out', r => Number(r.credit) ? money(r.credit) : '', 1]]}
      rows={rows} empty="No bank movements yet. Record a customer receipt to see one." />
  </>)
}

const ROLES = [['admin', 'Admin: everything'], ['accountant', 'Accountant: books, bank, reports, sales, purchases'], ['sales', 'Sales: leads, customers, invoices'], ['store', 'Store: inventory and purchase bills']]
export function Team() {
  const blank = { name: '', email: '', password: '', role: 'sales' }
  const [rows, reload] = useLoad('/users'), [f, setF] = useState(blank), [err, setErr] = useState('')
  const run = async fn => { try { await fn(); setErr(''); reload() } catch (e) { setErr(e.message) } }
  return (<>
    <Title hint="Each role only sees and changes what it needs.">Team</Title>
    <div className="grid sm:grid-cols-5 gap-2 mb-2">
      <input className={inp} placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      <input className={inp} placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <input className={inp} type="password" placeholder="Password (6+ characters)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <select className={inp} value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <Btn onClick={() => run(async () => { await api('/users', { method: 'POST', body: f }); setF(blank) })}>Add team member</Btn></div>
    <Err e={err} /><div className="mt-4" />
    <Table cols={[['Name', r => r.name], ['Email', r => r.email], ['Role', r => r.role], ['', r => <button className="text-red-700" onClick={() => run(() => api('/users/' + r.id, { method: 'DELETE' }))}>Remove</button>]]} rows={rows} empty="No team members." />
  </>)
}
