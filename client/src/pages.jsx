import { useEffect, useState, useCallback } from 'react'
import { api, getToken } from './api'

export const money = n => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
// Reads the signed-in user's role from the JWT (same way App.jsx does)
const myRole = () => { try { return JSON.parse(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return '' } }
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
<header><img src="${location.origin}/logo.png" height="64"><div><h1>Essence Engineering Pvt Ltd</h1><div>${d.title || (d.kind === 'sale' ? 'Sales Invoice' : 'Purchase Bill')} ${esc(d.number)} · ${new Date(d.date).toLocaleDateString()}</div></div></header>
<p><b>${d.kind === 'sale' ? 'Bill to' : 'Supplier'}:</b> ${esc(d.contact.name)}<br>${esc(d.contact.phone)}</p>
<table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
${d.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${money(l.price)}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join('')}
<tr class="t"><td colspan="3" class="r">Subtotal</td><td class="r">${money(sub)}</td></tr>
<tr class="t"><td colspan="3" class="r">Tax (${Number(d.taxRate)}%)</td><td class="r">${money(d.tax)}</td></tr>
<tr class="t"><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${money(d.total)}</b></td></tr></table></body></html>`)
  w.document.close(); setTimeout(() => w.print(), 600)
}


export function Documents({ kind }) {
  const sale = kind === 'sale'
  const [docs, reload] = useLoad('/invoices?kind=' + kind), [contacts] = useLoad('/contacts?type=' + (sale ? 'customer' : 'supplier')), [items] = useLoad('/items')
  const blank = { itemId: '', description: '', qty: 1, price: 0 }
  const [contactId, setContactId] = useState(''), [lines, setLines] = useState([blank]), [err, setErr] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  // The document being edited (null = creating a new one)
  const [editing, setEditing] = useState(null)
  // Only admin and accountant see the Edit and Cancel buttons (the backend enforces this too)
  const canCancel = ['admin', 'accountant'].includes(myRole())
  const cancelDoc = async r => {
    if (!confirm(`Cancel ${r.number}? This reverses the stock and the accounting entries and cannot be undone.`)) return
    try { await api(`/invoices/${r.id}/cancel`, { method: 'POST' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), tax = Math.round(subtotal * taxRate) / 100, total = subtotal + tax
  const setLine = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const pick = (i, id) => { const it = items.find(x => x.id === +id); setLine(i, { itemId: id, description: it?.name || '', price: it ? Number(sale ? it.price : it.cost) : 0 }) }
  // Resets the form back to "new document" mode
  const clearForm = () => { setLines([blank]); setContactId(''); setTaxRate(0); setEditing(null); setErr('') }
  // Loads an existing document into the form
  const startEdit = r => {
    setEditing(r); setContactId(String(r.contactId)); setTaxRate(Number(r.taxRate))
    setLines(r.lines.map(l => ({ itemId: l.itemId ? String(l.itemId) : '', description: l.description || '', qty: Number(l.qty), price: Number(l.price) })))
    setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  // Editing saves with PUT (cancels the original, creates a corrected one); otherwise POST
  const save = async () => {
    try {
      if (editing) await api('/invoices/' + editing.id, { method: 'PUT', body: { contactId, lines, taxRate, date: editing.date } })
      else await api('/invoices', { method: 'POST', body: { kind, contactId, lines, taxRate } })
      clearForm(); reload()
    } catch (e) { setErr(e.message) }
  }
  return (<>
    <Title hint={sale ? 'Saving an invoice reduces stock and records the sale in the books.' : 'Saving a bill adds stock and records what you owe.'}>{sale ? 'Sales invoices' : 'Purchase bills'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 mb-8 space-y-3">
      {editing && <p className="text-sm bg-gold/10 border border-gold/30 rounded px-3 py-2">Editing {editing.number}. Saving cancels it and creates a new {sale ? 'invoice' : 'bill'} with the corrected details.</p>}
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
        <span className="font-semibold">Total {money(total)} <span className="text-ink/60 font-normal text-sm">(tax {money(tax)})</span></span>
        <Btn onClick={save}>{editing ? 'Save changes' : sale ? 'Save invoice' : 'Save bill'}</Btn>
        {editing && <button className="text-sm text-ink/60 underline" onClick={clearForm}>Stop editing</button>}</div>
      <Err e={err} />
    </section>
    <Table cols={[
      // Number column also shows a red "Cancelled" badge for cancelled documents
      ['Number', r => <>{r.number}{r.status === 'cancelled' && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Cancelled</span>}</>],
      ['Date', r => new Date(r.date).toLocaleDateString()], [sale ? 'Customer' : 'Supplier', r => r.contact.name], ['Tax', r => money(r.tax), 1], ['Total', r => money(r.total), 1],
      ['Share', r => <span className="inline-flex gap-3"><button className="text-gold font-medium" onClick={() => printDoc(r)}>Print / PDF</button><a className="text-gold font-medium" target="_blank" rel="noreferrer" href={waLink(r)}>WhatsApp</a></span>],
      // Edit and Cancel buttons: hidden for other roles and for documents that are already cancelled
      ['Action', r => canCancel && r.status !== 'cancelled' ? <span className="inline-flex gap-3"><button className="text-gold font-medium" onClick={() => startEdit(r)}>Edit</button><button className="text-red-700 font-medium" onClick={() => cancelDoc(r)}>Cancel</button></span> : null]]}
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
// ---- Quotes: no stock or accounting effect until converted to a sales invoice
export function Quotes() {
  const [rows, reload] = useLoad('/quotes'), [contacts] = useLoad('/contacts?type=customer'), [items] = useLoad('/items')
  const blank = { itemId: '', description: '', qty: 1, price: 0 }
  const [contactId, setContactId] = useState(''), [lines, setLines] = useState([blank]), [taxRate, setTaxRate] = useState(0), [err, setErr] = useState('')
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), tax = Math.round(subtotal * taxRate) / 100, total = subtotal + tax
  const setLine = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const pick = (i, id) => { const it = items.find(x => x.id === +id); setLine(i, { itemId: id, description: it?.name || '', price: it ? Number(it.price) : 0 }) }
  const run = async fn => { try { await fn(); setErr(''); reload() } catch (e) { setErr(e.message) } }
  const save = () => run(async () => { await api('/quotes', { method: 'POST', body: { contactId, lines, taxRate } }); setLines([blank]); setContactId(''); setTaxRate(0) })
  // Converting creates a real invoice, so it asks first (stock is checked by the backend)
  const convert = r => { if (confirm(`Convert ${r.number} into a sales invoice? This reduces stock and records the sale.`)) run(async () => { const inv = await api(`/quotes/${r.id}/convert`, { method: 'POST' }); alert(`Created ${inv.number}. Find it under Sales.`) }) }
  const badge = { open: 'bg-gold/15 text-gold', converted: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }
  return (<>
    <Title hint="A quote changes nothing in stock or the books until you convert it into an invoice.">Quotes</Title>
    <section className="bg-white border border-navy/10 rounded p-4 mb-8 space-y-3">
      <select className={inp} value={contactId} onChange={e => setContactId(e.target.value)}>
        <option value="">Choose customer</option>{contacts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
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
        <span className="font-semibold">Total {money(total)} <span className="text-ink/60 font-normal text-sm">(tax {money(tax)})</span></span><Btn onClick={save}>Save quote</Btn></div>
      <Err e={err} />
    </section>
    <Table cols={[['Number', r => r.number], ['Date', r => new Date(r.date).toLocaleDateString()], ['Customer', r => r.contact.name], ['Total', r => money(r.total), 1],
      ['Status', r => <span className={'text-xs px-2 py-0.5 rounded ' + badge[r.status]}>{r.status}</span>],
      ['Action', r => <span className="inline-flex gap-3"><button className="text-gold font-medium" onClick={() => printDoc({ ...r, title: 'Quotation' })}>Print / PDF</button>
        {r.status === 'open' && <><button className="text-gold font-medium" onClick={() => convert(r)}>Convert to invoice</button>
          <button className="text-red-700 font-medium" onClick={() => run(() => api(`/quotes/${r.id}/reject`, { method: 'POST' }))}>Reject</button></>}</span>]]}
      rows={rows} empty="No quotes yet. Create your first one above." />
  </>)
}

// ---- Credit notes: reverse part or all of a sales invoice
export function CreditNotes() {
  const [notes, reload] = useLoad('/credit-notes'), [invoices] = useLoad('/invoices?kind=sale')
  const [invoiceId, setInvoiceId] = useState(''), [lines, setLines] = useState([]), [restock, setRestock] = useState(true), [reason, setReason] = useState(''), [err, setErr] = useState('')
  const inv = invoices?.find(i => i.id === +invoiceId)
  // Choosing an invoice copies its lines; lower a quantity (or set it to 0) to credit only part of it
  const choose = id => {
    setInvoiceId(id); setErr('')
    const i = invoices.find(x => x.id === +id)
    setLines(i ? i.lines.map(l => ({ itemId: l.itemId ? String(l.itemId) : '', description: l.description || '', qty: Number(l.qty), price: Number(l.price), max: Number(l.qty) })) : [])
  }
  const setLine = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const taxRate = Number(inv?.taxRate || 0)
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), tax = Math.round(subtotal * taxRate) / 100, total = subtotal + tax
  const save = async () => {
    try {
      await api('/credit-notes', { method: 'POST', body: { invoiceId, lines, restock, reason } })
      setInvoiceId(''); setLines([]); setReason(''); setErr(''); reload()
    } catch (e) { setErr(e.message) }
  }
  return (<>
    <Title hint="Reverse part or all of a sales invoice. It lowers what the customer owes and your sales.">Credit notes</Title>
    <section className="bg-white border border-navy/10 rounded p-4 mb-8 space-y-3">
      <select className={inp} value={invoiceId} onChange={e => choose(e.target.value)}>
        <option value="">Choose the sales invoice to credit</option>
        {invoices?.filter(i => i.status !== 'cancelled').map(i => <option key={i.id} value={i.id}>{i.number} · {i.contact.name} · {money(i.total)}</option>)}</select>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <span className="col-span-12 sm:col-span-6 text-sm">{l.description || 'Service / other'}</span>
          <input className={inp + ' col-span-6 sm:col-span-2'} type="number" min="0" max={l.max} aria-label="Quantity to credit" value={l.qty} onChange={e => setLine(i, { qty: +e.target.value })} />
          <input className={inp + ' col-span-6 sm:col-span-2'} type="number" min="0" aria-label="Price" value={l.price} onChange={e => setLine(i, { price: +e.target.value })} />
          <span className="col-span-12 sm:col-span-2 text-sm text-ink/60 text-right">of {l.max} sold</span>
        </div>))}
      {lines.length > 0 && <>
        <input className={inp} placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
        <div className="flex items-center gap-4">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />Goods returned to stock</label>
          <span className="ml-auto font-semibold">Credit {money(total)} <span className="text-ink/60 font-normal text-sm">(tax {money(tax)})</span></span><Btn onClick={save}>Save credit note</Btn></div></>}
      <Err e={err} />
    </section>
    <Table cols={[['Number', r => r.number], ['Date', r => new Date(r.date).toLocaleDateString()], ['Customer', r => r.contact.name], ['Invoice', r => r.invoice.number], ['Total', r => money(r.total), 1],
      ['Share', r => <button className="text-gold font-medium" onClick={() => printDoc({ ...r, title: 'Credit Note' })}>Print / PDF</button>]]}
      rows={notes} empty="No credit notes yet." />
  </>)
}
// ---- Balance Sheet: Assets = Liabilities + Equity (+ current profit)
// One section of the balance sheet (a small table of accounts)
const BsSection = ({ title, rows }) => (<>
  <h2 className="font-semibold mt-6 mb-2">{title}</h2>
  <Table cols={[['Account', r => (r.code ? r.code + ' ' : '') + r.name], ['Amount', r => money(r.amount), 1]]} rows={rows} empty="Nothing here yet." />
</>)

export function BalanceSheet() {
  // Empty date = today; otherwise only entries up to that day are counted
  const [asOf, setAsOf] = useState('')
  const [bs] = useLoad('/reports/balance-sheet' + (asOf ? '?asOf=' + asOf : ''))
  // useLoad gives null while loading and [] on error, so check for a real report
  const ready = bs && bs.assets
  return (<>
    <Title hint="What the business owns, what it owes, and what is left for the owners.">Balance sheet</Title>
    <label className="text-sm flex items-center gap-2 mb-4">As of
      <input className={inp + ' w-44'} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
      {asOf && <button className="text-ink/60 underline" onClick={() => setAsOf('')}>Today</button>}
    </label>
    {ready && <>
      <dl className="grid grid-cols-2 gap-px bg-navy/15 border border-navy/15 rounded overflow-hidden mb-2">
        {[['Total assets', bs.totalAssets], ['Liabilities + equity', bs.totalLiabilitiesEquity]].map(([k, v]) =>
          <div key={k} className="bg-white p-4"><dt className="text-sm text-ink/60">{k}</dt><dd className="text-xl font-semibold text-navy">{money(v)}</dd></div>)}
      </dl>
      <p className={'text-sm font-medium ' + (bs.balanced ? 'text-green-700' : 'text-red-700')}>
        {bs.balanced ? 'Balanced.' : 'Not balanced. Check the journal entries.'}</p>
      <BsSection title="Assets" rows={bs.assets} />
      <BsSection title="Liabilities" rows={bs.liabilities} />
      {/* Current profit is shown as its own line inside equity */}
      <BsSection title="Equity" rows={[...bs.equity, { name: 'Current profit', amount: bs.profit }]} />
    </>}
  </>)
}

// ---- Aging: who still owes us (kind="sale") or whom we still owe (kind="purchase"), by invoice age
export function Aging({ kind }) {
  const sale = kind === 'sale'
  const [rows] = useLoad('/reports/aging?kind=' + kind)
  const sum = k => (rows || []).reduce((s, r) => s + r[k], 0)
  // Shows a dash-free blank for empty buckets so the table is easy to scan
  const cell = k => r => r[k] ? money(r[k]) : ''
  return (<>
    <Title hint="Payments and credit notes are applied to the oldest invoices first. Age counts from the invoice date.">{sale ? 'Customer aging' : 'Supplier aging'}</Title>
    <dl className="grid grid-cols-2 gap-px bg-navy/15 border border-navy/15 rounded overflow-hidden mb-6">
      <div className="bg-white p-4"><dt className="text-sm text-ink/60">{sale ? 'Total receivable' : 'Total payable'}</dt><dd className="text-xl font-semibold text-navy">{money(sum('total'))}</dd></div>
      <div className="bg-white p-4"><dt className="text-sm text-ink/60">Over 90 days</dt><dd className="text-xl font-semibold text-red-700">{money(sum('d90'))}</dd></div>
    </dl>
    <Table cols={[[sale ? 'Customer' : 'Supplier', r => r.name], ['0-30 days', cell('current'), 1], ['31-60 days', cell('d30'), 1],
      ['61-90 days', cell('d60'), 1], ['Over 90 days', cell('d90'), 1], ['Total', r => <b>{money(r.total)}</b>, 1]]}
      rows={rows} empty={sale ? 'No customer owes you anything.' : 'You do not owe any supplier anything.'} />
  </>)
}