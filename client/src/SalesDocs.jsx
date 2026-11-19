// src/SalesDocs.jsx
// Sales Quotes, Sales Orders, Delivery Notes and Sales Invoices (Manager.io style).
// One shared page component (DocPage) driven by a small config object per document type.
// Flow: Quote > Order > Delivery Note > Invoice. The view page has a button that opens the
// next document pre-filled from the current one.
// Expected API, where PATH is /sales-quotes, /sales-orders, /delivery-notes or /sales-invoices:
//   GET/POST/PUT/DELETE PATH
//   record: { id, number, date, reference, contactId, contact: {name}, address, description, taxRate,
//             subtotal, tax, rounding, total, fixedTotal, status, expiryDate, dueDate, balanceDue, paymentStatus,
//             lines: [{ itemId, accountId, projectId, description, qty, price, discount }] }
//   status = 'expired' for a quote that is not accepted and is past its expiryDate (set by the backend)
//   paymentStatus = 'paid' | 'unpaid' | 'overdue' for sales invoices (set by the backend)
// Also reads: /contacts?type=customer, /items, /accounts, /projects
// The list shows a totals strip (total, outstanding, overdue, expired) for the rows currently shown.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Badge, Title, Err, Field, Table, inp } from './ui'
import { useCustomize } from './customize'

// ---------- Small helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
// Amount of one line: qty x price, less the line discount %
const lineNet = l => (Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100)
// Adds days to a YYYY-MM-DD date (used for expiry and due dates)
const addDays = (date, n) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10) }
// Adds up a number taken from each row
const sum = (list, f) => list.reduce((s, r) => s + (Number(f(r)) || 0), 0)

// One small box in the totals strip above the list
const Stat = ({ label, value, tone }) => (
  <div className="bg-white border border-navy/10 rounded p-3">
    <p className="text-xs text-ink/60">{label}</p>
    <p className={'text-lg font-semibold ' + (tone === 'red' ? 'text-red-700' : 'text-navy')}>{value}</p>
  </div>
)

// ---------- One config per document type ----------
// priced = shows prices and totals; expiry = "Valid for ... days"; due = "Net days";
// account/project = extra line columns; status = status column on the list;
// next = the document that can be created from this one
const SALES = {
  quote: {
    form: 'salesQuote', path: '/sales-quotes', title: 'Sales Quotes', one: 'Sales Quote', party: 'customer', who: 'Customer',
    hint: 'A quote changes nothing in stock or the books until you create an invoice.',
    dateLabel: 'Issue date', addressLabel: 'Billing address', addressKey: 'billingAddress',
    priced: true, tax: true, expiry: true, status: true,
    next: { via: 'quote', path: '/sales-orders', label: 'Sales Order' },
  },
  order: {
    form: 'salesOrder', path: '/sales-orders', title: 'Sales Orders', one: 'Sales Order', party: 'customer', who: 'Customer',
    hint: 'Confirms what a customer has ordered.',
    dateLabel: 'Date', addressLabel: 'Billing address', addressKey: 'billingAddress',
    priced: true, tax: true, description: true,
    next: { via: 'order', path: '/delivery-notes', label: 'Delivery Note' },
  },
  delivery: {
    form: 'deliveryNote', path: '/delivery-notes', title: 'Delivery Notes', one: 'Delivery Note', party: 'customer', who: 'Customer (To)',
    hint: 'Proof that goods were delivered. Prices are not printed.',
    dateLabel: 'Delivery date', addressLabel: 'Delivery address', addressKey: 'deliveryAddress',
    priced: false, tax: false, description: true,
    next: { via: 'delivery', path: '/sales-invoices', label: 'Sales Invoice' },
  },
  invoice: {
    form: 'salesInvoice', path: '/sales-invoices', title: 'Sales Invoices', one: 'Sales Invoice', party: 'customer', who: 'Customer',
    hint: 'Saving an invoice records the sale in the books.',
    dateLabel: 'Issue date', addressLabel: 'Billing address', addressKey: 'billingAddress',
    priced: true, tax: true, due: true, account: true, project: true, status: true,
  },
}

// Status filter: each click on the Status button moves to the next step, then back to All
const STATUS_STEPS = {
  quote: [['all', 'All'], ['active', 'Active'], ['expired', 'Expired'], ['accepted', 'Accepted']],
  invoice: [['all', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid']],
}

// Column titles in the line editor
const HEAD = { num: '#', item: 'Item', account: 'Account', desc: 'Description', qty: 'Qty', price: 'Unit price', disc: 'Disc %', project: 'Project', total: 'Total', x: '' }

// ---------- Print / PDF ----------
function printDoc(r, cfg, conf) {
  const { business, print } = conf.settings
  const fs = conf.settings.forms[cfg.form], o = fs.options
  const title = o.customTitle && fs.title ? fs.title : cfg.one
  const w = window.open('', '_blank'); if (!w) return alert('Allow pop-ups to print')
  const lines = r.lines || []
  const heads = [o.lineNumber && '#', 'Description', 'Qty', cfg.priced && 'Unit price', cfg.priced && o.discount && 'Disc %', cfg.priced && 'Amount'].filter(Boolean)
  const body = lines.map((l, i) => `<tr>${o.lineNumber ? `<td>${i + 1}</td>` : ''}<td>${esc(l.description)}</td><td class="r">${l.qty}</td>${cfg.priced ? `<td class="r">${money(l.price)}</td>` : ''}${cfg.priced && o.discount ? `<td class="r">${Number(l.discount) || 0}</td>` : ''}${cfg.priced ? `<td class="r">${money(lineNet(l))}</td>` : ''}</tr>`).join('')
  const span = heads.length - 1
  const sub = r.subtotal ?? lines.reduce((s, l) => s + lineNet(l), 0)
  const totals = cfg.priced ? `<tr><td colspan="${span}" class="r">Subtotal</td><td class="r">${money(sub)}</td></tr>
${print.showTax ? `<tr><td colspan="${span}" class="r">Tax (${Number(r.taxRate) || 0}%)</td><td class="r">${money(r.tax)}</td></tr>` : ''}
${Number(r.rounding) ? `<tr><td colspan="${span}" class="r">Rounding</td><td class="r">${money(r.rounding)}</td></tr>` : ''}
<tr><td colspan="${span}" class="r"><b>Total</b></td><td class="r"><b>${money(r.total)}</b></td></tr>` : ''
  const dates = fmtDate(r.date) + (r.expiryDate ? ' · Valid until ' + fmtDate(r.expiryDate) : '') + (r.dueDate ? ' · Due ' + fmtDate(r.dueDate) : '')
  w.document.write(`<html><head><title>${esc(r.number)}</title><style>body{font-family:IBM Plex Sans,Arial,sans-serif;color:#14202E;padding:40px;max-width:800px;margin:auto}header{display:flex;align-items:center;gap:16px;border-bottom:4px solid #B07F24;padding-bottom:16px}h1{margin:0;color:#1F3A5A}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#1F3A5A;color:#fff;text-align:left}td,th{padding:8px;border-bottom:1px solid #ddd}.r{text-align:right}footer{margin-top:32px;font-size:13px;color:#555}</style></head><body>
<header>${print.showLogo ? `<img src="${location.origin}/logo.png" height="64">` : ''}<div><h1>${esc(business.name)}</h1><div>${esc(title)} ${esc(r.number)} · ${dates}</div></div></header>
<p><b>${esc(cfg.who)}:</b> ${esc(r.contact?.name)}${r.address ? `<br>${esc(r.address).replace(/\n/g, '<br>')}` : ''}${r.reference ? `<br><b>Reference:</b> ${esc(r.reference)}` : ''}</p>
${r.description ? `<p>${esc(r.description)}</p>` : ''}
<table><tr>${heads.map((h, i) => `<th class="${i >= (o.lineNumber ? 2 : 1) ? 'r' : ''}">${h}</th>`).join('')}</tr>${body}${totals}</table>
${o.footers && fs.footer ? `<footer>${esc(fs.footer)}</footer>` : ''}</body></html>`)
  w.document.close(); setTimeout(() => w.print(), 600)
}

// ---------- The shared page ----------
export function DocPage({ cfg }) {
  const conf = useCustomize()
  const fs = conf.settings.forms[cfg.form]
  const on = o => !!fs.options[o] // is an optional checkbox ticked in Settings?
  const navigate = useNavigate(), loc = useLocation()

  const [rows, reload] = useLoad(cfg.path)
  const [parties] = useLoad('/contacts?type=' + cfg.party)
  const [items] = useLoad('/items')
  const [accounts] = useLoad('/accounts')
  const [projects] = useLoad('/projects')

  const blankLine = () => ({ itemId: '', accountId: '', projectId: '', description: '', qty: 1, price: '', discount: '' })
  // Form defaults come from Settings
  const blank = () => ({
    date: today(), reference: '', contactId: '', address: '', description: '',
    validDays: fs.defaults.validDays ?? '', netDays: fs.defaults.dueDays ?? '', taxRate: fs.defaults.taxRate ?? '',
    fixedTotal: '', rfq: false, withholdingRate: '', lines: [blankLine()], fromKind: '', fromId: '',
  })
  // Turns a saved record into form values (used by Edit, Clone and "create next")
  const toForm = r => ({
    date: String(r.date).slice(0, 10), reference: r.reference || '', contactId: String(r.contactId ?? r.contact?.id ?? ''),
    address: r.address || '', description: r.description || '',
    validDays: r.validDays ?? fs.defaults.validDays ?? '', netDays: r.netDays ?? fs.defaults.dueDays ?? '',
    taxRate: r.taxRate ?? fs.defaults.taxRate ?? '', fixedTotal: r.fixedTotal ?? '',
    rfq: !!r.rfq, withholdingRate: r.withholdingRate ?? '',
    lines: (r.lines?.length ? r.lines : [{}]).map(l => ({
      itemId: String(l.itemId ?? ''), accountId: String(l.accountId ?? ''), projectId: String(l.projectId ?? ''),
      description: l.description || '', qty: l.qty ?? 1, price: l.price ?? '', discount: l.discount ?? '',
    })),
    fromKind: '', fromId: '',
  })

  const [view, setView] = useState('list') // 'list' | 'form' | 'view'
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [current, setCurrent] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')
  const [statusF, setStatusF] = useState('all') // status filter on the list

  // Arrived from the previous document in the flow: open the form pre-filled from it
  useEffect(() => {
    const src = loc.state?.from
    if (!src) return
    setF({ ...toForm(src), date: today(), reference: '', fromKind: loc.state.via, fromId: src.id })
    setEditing(null); setView('form')
    navigate(loc.pathname, { replace: true, state: null }) // clear it so a refresh does not repeat this
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = patch => setF({ ...f, ...patch })
  const setLine = (i, p) => set({ lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  // Choosing an item fills the description and price
  const pick = (i, id) => {
    const it = items?.find(x => x.id === +id)
    setLine(i, { itemId: id, description: it?.name || '', price: it ? Number(cfg.party === 'supplier' ? it.cost : it.price) : '' })
  }
  // Choosing a customer fills the address (and payment terms) when the contact has them saved
  const pickParty = id => {
    const c = parties?.find(x => x.id === +id)
    set({ contactId: id, address: c?.[cfg.addressKey] || f.address, netDays: c?.dueDays ?? f.netDays })
  }

  // Totals: subtotal, tax, optional rounding, optional fixed total
  const calc = x => {
    if (!cfg.priced) return { subtotal: 0, tax: 0, rounding: 0, total: 0 }
    const subtotal = x.lines.reduce((s, l) => s + lineNet(l), 0)
    const tax = cfg.tax ? Math.round(subtotal * (Number(x.taxRate) || 0)) / 100 : 0
    let total = subtotal + tax, rounding = 0
    if (on('rounding')) { rounding = Math.round(total) - total; total += rounding }
    if (on('fixedTotal') && Number(x.fixedTotal) > 0) total = Number(x.fixedTotal)
    return { subtotal, tax, rounding, total }
  }

  const openNew = () => { setF(blank()); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => { setF(toForm(r)); setEditing(r); setErr(''); setView('form') }
  const openClone = r => { setF({ ...toForm(r), date: today(), reference: '' }); setEditing(null); setErr(''); setView('form') }

  const save = async addAnother => {
    if (!f.contactId) return setErr(`Choose the ${cfg.who.toLowerCase()}`)
    const lines = f.lines.filter(l => l.itemId || l.description.trim()).map(l => ({
      itemId: l.itemId ? +l.itemId : null, accountId: l.accountId ? +l.accountId : null, projectId: l.projectId ? +l.projectId : null,
      description: l.description, qty: Number(l.qty), price: Number(l.price) || 0, discount: Number(l.discount) || 0,
    }))
    if (!lines.length) return setErr('Add at least one line')
    if (lines.some(l => !Number.isInteger(l.qty) || l.qty < 1)) return setErr('Quantity must be a whole number above zero')
    const t = calc(f)
    const body = {
      date: f.date, reference: f.reference, contactId: +f.contactId, address: f.address, description: f.description, lines,
      taxRate: cfg.tax ? Number(f.taxRate) || 0 : 0, subtotal: r2(t.subtotal), tax: r2(t.tax), rounding: r2(t.rounding), total: r2(t.total),
      fixedTotal: on('fixedTotal') && Number(f.fixedTotal) > 0 ? Number(f.fixedTotal) : null,
      rfq: on('requestForQuotation') ? !!f.rfq : false,
      withholdingRate: on('withholdingTax') ? Number(f.withholdingRate) || 0 : 0,
      ...(cfg.expiry ? { validDays: Number(f.validDays) || 0, expiryDate: addDays(f.date, f.validDays) } : {}),
      ...(cfg.due ? { netDays: Number(f.netDays) || 0, dueDate: addDays(f.date, f.netDays) } : {}),
      ...(f.fromId ? { fromKind: f.fromKind, fromId: f.fromId } : {}),
    }
    try {
      if (editing) await api(`${cfg.path}/${editing.id}`, { method: 'PUT', body })
      else await api(cfg.path, { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(blank()); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${cfg.one.toLowerCase()} ${r.number || ''}?`)) return
    try { await api(`${cfg.path}/${r.id}`, { method: 'DELETE' }); setErr(''); setView('list'); reload() } catch (e) { setErr(e.message) }
  }

  // Status badge for the list and view page
  // Invoices: paid / overdue / due today / unpaid (the backend sends paymentStatus).
  // Quotes: accepted (green), expired (red), otherwise the saved status (gold).
  const statusOf = r => {
    if (cfg.due && r.balanceDue != null) {
      if (r.paymentStatus === 'paid' || Number(r.balanceDue) <= 0) return <Badge tone="green">Paid in full</Badge>
      if (r.paymentStatus === 'overdue') return <Badge tone="red">Overdue</Badge>
      const due = String(r.dueDate || '').slice(0, 10)
      if (due === today()) return <Badge tone="gold">Due today</Badge>
      return <Badge>Unpaid</Badge>
    }
    if (!r.status) return null
    const tone = r.status === 'accepted' || r.status === 'Accepted' ? 'green' : r.status === 'expired' ? 'red' : 'gold'
    return <Badge tone={tone}>{r.status}</Badge>
  }

  // ---------- Form view ----------
  if (view === 'form') {
    const t = calc(f)
    // Which line columns to show, with their widths (some depend on the optional checkboxes)
    const cols = [
      on('lineNumber') && ['num', '2rem'], ['item', '1.4fr'], cfg.account && ['account', '1.2fr'], ['desc', '1.4fr'], ['qty', '4.5rem'],
      cfg.priced && ['price', '6.5rem'], cfg.priced && on('discount') && ['disc', '4.5rem'], cfg.project && ['project', '1.2fr'],
      cfg.priced && ['total', '6.5rem'], ['x', '2rem'],
    ].filter(Boolean)
    const grid = { display: 'grid', gap: '0.5rem', alignItems: 'center', gridTemplateColumns: cols.map(c => c[1]).join(' ') }
    // The description box shows when the Description option is on, or for lines without an item
    const showDesc = l => on('description') || !l.itemId
    const right = ['qty', 'price', 'disc', 'total']

    const cell = (key, l, i) => {
      switch (key) {
        case 'num': return <span className="text-sm text-ink/60">{i + 1}</span>
        case 'item': return (
          <select className={inp} aria-label="Item" value={l.itemId} onChange={e => pick(i, e.target.value)}>
            <option value="">Service / other</option>{items?.map(it => <option key={it.id} value={it.id}>{it.name} ({it.qty} in stock)</option>)}
          </select>)
        case 'account': return (
          <select className={inp} aria-label="Account" value={l.accountId} onChange={e => setLine(i, { accountId: e.target.value })}>
            <option value="">Default</option>{accounts?.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>)
        case 'desc': return showDesc(l)
          ? <input className={inp} aria-label="Description" placeholder="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
          : <span className="text-sm text-ink/70">{l.description}</span>
        case 'qty': return <input className={inp + ' text-right'} type="number" min="1" step="1" aria-label="Qty" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
        case 'price': return <input className={inp + ' text-right'} type="number" min="0" aria-label="Unit price" value={l.price} onChange={e => setLine(i, { price: e.target.value })} />
        case 'disc': return <input className={inp + ' text-right'} type="number" min="0" max="100" aria-label="Discount %" value={l.discount} onChange={e => setLine(i, { discount: e.target.value })} />
        case 'project': return (
          <select className={inp} aria-label="Project" value={l.projectId} onChange={e => setLine(i, { projectId: e.target.value })}>
            <option value="">No project</option>{projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>)
        case 'total': return <span className="block text-sm text-right">{money(lineNet(l))}</span>
        default: return <button className="text-sm text-red-700" aria-label="Remove line" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, j) => j !== i) : [blankLine()] })}>X</button>
      }
    }

    return (<>
      <Title hint={cfg.hint}>{editing ? `Edit ${cfg.one}` : `New ${cfg.one}`}</Title>
      {f.fromId && !editing && <p className="text-sm bg-gold/10 border border-gold/30 rounded px-3 py-2 mb-3 max-w-4xl">Created from an earlier document. Check the details, then save.</p>}
      <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-5xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={cfg.dateLabel}><input className={inp} type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
          <Field label="Reference (optional)"><input className={inp} value={f.reference} onChange={e => set({ reference: e.target.value })} /></Field>
          {cfg.expiry && (
            <Field label={`Valid for (days)${f.validDays ? ' - expires ' + fmtDate(addDays(f.date, f.validDays)) : ''}`}>
              <input className={inp} type="number" min="0" value={f.validDays} onChange={e => set({ validDays: e.target.value })} />
            </Field>)}
          {cfg.due && (
            <Field label={`Net days${f.netDays !== '' ? ' - due ' + fmtDate(addDays(f.date, f.netDays)) : ''}`}>
              <input className={inp} type="number" min="0" value={f.netDays} onChange={e => set({ netDays: e.target.value })} />
            </Field>)}
          <Field label={cfg.who}>
            <select className={inp} value={f.contactId} onChange={e => pickParty(e.target.value)}>
              <option value="">Choose {cfg.party}</option>{parties?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {cfg.addressLabel && <Field label={cfg.addressLabel}><textarea className={inp} rows={2} value={f.address} onChange={e => set({ address: e.target.value })} /></Field>}
        </div>
        {on('requestForQuotation') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.rfq} onChange={e => set({ rfq: e.target.checked })} />Request for quotation</label>}
        {cfg.description && <Field label="Description"><textarea className={inp} rows={2} value={f.description} onChange={e => set({ description: e.target.value })} /></Field>}

        {/* Line editor: scrolls sideways on small screens */}
        <div className="overflow-x-auto">
          <div className="space-y-2" style={{ minWidth: '760px' }}>
            <div style={grid} className="text-xs text-ink/60">
              {cols.map(c => <span key={c[0]} className={right.includes(c[0]) ? 'text-right' : ''}>{HEAD[c[0]]}</span>)}
            </div>
            {f.lines.map((l, i) => <div key={i} style={grid}>{cols.map(c => <div key={c[0]}>{cell(c[0], l, i)}</div>)}</div>)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button className="text-sm text-gold font-medium" onClick={() => set({ lines: [...f.lines, blankLine()] })}>Add line</button>
          {cfg.priced && (
            <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
              {cfg.tax && <label className="flex items-center gap-2">Tax %<input className={inp + ' w-20'} type="number" min="0" value={f.taxRate} onChange={e => set({ taxRate: e.target.value })} /></label>}
              {on('withholdingTax') && <label className="flex items-center gap-2">Withholding tax %<input className={inp + ' w-20'} type="number" min="0" value={f.withholdingRate} onChange={e => set({ withholdingRate: e.target.value })} /></label>}
              {on('fixedTotal') && <label className="flex items-center gap-2">Fixed total<input className={inp + ' w-32'} type="number" min="0" value={f.fixedTotal} onChange={e => set({ fixedTotal: e.target.value })} /></label>}
              {on('rounding') && <span className="text-ink/60">Rounding {money(t.rounding)}</span>}
              <span className="font-semibold">Total {money(t.total)} <span className="text-ink/60 font-normal">(tax {money(t.tax)})</span></span>
            </div>)}
        </div>

        <Err e={err} />
        <div className="flex gap-2">
          <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
          {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
          <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
        </div>
      </section>
    </>)
  }

  // ---------- List (filtered by the search box) ----------
  const q = search.toLowerCase()
  // Which status group a row belongs to (used by the Status filter)
  const statusKey = r => {
    if (cfg.due) return r.paymentStatus || (Number(r.balanceDue) <= 0 ? 'paid' : 'unpaid')
    const s = String(r.status || '').toLowerCase()
    return s === 'accepted' ? 'accepted' : s === 'expired' ? 'expired' : 'active'
  }
  const steps = cfg.status ? STATUS_STEPS[cfg.due ? 'invoice' : 'quote'] : []
  const stepNow = steps.find(x => x[0] === statusF) || steps[0]
  const nextStatus = () => setStatusF(steps[(steps.indexOf(stepNow) + 1) % steps.length][0])
  const shown = rows && rows
    .filter(r => statusF === 'all' || statusKey(r) === statusF)
    .filter(r => [r.number, r.reference, r.contact?.name, r.description].join(' ').toLowerCase().includes(q))

  // Totals of the rows currently shown (they follow the search box)
  const list = shown || []
  const totalAmt = sum(list, r => r.total)
  const dueAmt = cfg.due ? sum(list, r => r.balanceDue) : 0
  const overdueRows = cfg.due ? list.filter(r => r.paymentStatus === 'overdue') : []
  const expiredRows = cfg.expiry ? list.filter(r => r.status === 'expired') : []

  // ---------- View page (one record) ----------
  if (view === 'view' && current) {
    const i = (shown || []).findIndex(x => x.id === current.id)
    const go = d => { const n = shown?.[i + d]; if (n) setCurrent(n) } // previous / next record
    const lineCols = [
      on('lineNumber') && ['#', (l, n) => n + 1],
      ['Description', l => l.description],
      ['Qty', l => l.qty, 1],
      cfg.priced && ['Unit price', l => money(l.price), 1],
      cfg.priced && on('discount') && ['Disc %', l => Number(l.discount) || 0, 1],
      cfg.priced && ['Amount', l => money(lineNet(l)), 1],
    ].filter(Boolean)
    const lines = (current.lines || []).map((l, n) => ({ ...l, _n: n }))
    return (<>
      <Title hint={fmtDate(current.date)}
        right={<>
          <BtnLight disabled={i <= 0} onClick={() => go(-1)} aria-label="Previous">&lsaquo;</BtnLight>
          <BtnLight disabled={i < 0 || i >= shown.length - 1} onClick={() => go(1)} aria-label="Next">&rsaquo;</BtnLight>
          <BtnLight onClick={() => openEdit(current)}>Edit</BtnLight>
          <BtnLight onClick={() => openClone(current)}>Clone</BtnLight>
          <BtnLight onClick={() => printDoc(current, cfg, conf)}>Print / PDF</BtnLight>
          {cfg.next && <Btn onClick={() => navigate(cfg.next.path, { state: { from: current, via: cfg.next.via } })}>Create {cfg.next.label}</Btn>}
          <BtnLight onClick={() => remove(current)}>Delete</BtnLight>
          <BtnLight onClick={() => setView('list')}>Back</BtnLight>
        </>}>
        {cfg.one} {current.number}
      </Title>
      <section className="bg-white border border-navy/10 rounded p-4 space-y-3 max-w-4xl text-sm">
        <p><b>{cfg.who}:</b> {current.contact?.name} {statusOf(current)}</p>
        {current.address && <p className="whitespace-pre-line"><b>{cfg.addressLabel}:</b> {current.address}</p>}
        {current.reference && <p><b>Reference:</b> {current.reference}</p>}
        {current.expiryDate && <p><b>Valid until:</b> {fmtDate(current.expiryDate)}</p>}
        {current.dueDate && <p><b>Due date:</b> {fmtDate(current.dueDate)}</p>}
        {cfg.due && current.balanceDue != null && <p><b>Balance due:</b> {money(current.balanceDue)}</p>}
        {current.description && <p>{current.description}</p>}
        <Table cols={lineCols.map(c => [c[0], l => c[1](l, l._n), c[2]])} rows={lines} empty="No lines." />
        {cfg.priced && <p className="text-right">Subtotal {money(current.subtotal)} · Tax {money(current.tax)}{Number(current.rounding) ? ` · Rounding ${money(current.rounding)}` : ''} · <b>Total {money(current.total)}</b></p>}
      </section>
      <Err e={err} />
    </>)
  }

  // ---------- List view ----------
  const listCols = [
    ['Number', r => r.number],
    ['Date', r => fmtDate(r.date)],
    ['Ref', r => r.reference],
    [cfg.who, r => r.contact?.name],
    cfg.description && ['Description', r => r.description],
    cfg.priced && ['Amount', r => money(r.total), 1],
    cfg.due && ['Balance due', r => money(r.balanceDue), 1],
    cfg.status && ['Status', r => statusOf(r)],
    ['Actions', r => (
      <span className="inline-flex gap-3">
        <button className="text-gold font-medium" onClick={() => { setCurrent(r); setView('view') }}>View</button>
        <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
        <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
      </span>
    )],
  ].filter(Boolean)

  return (<>
    <Title hint={cfg.hint} right={<Btn onClick={openNew}>New {cfg.one}</Btn>}>{cfg.title}</Title>
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input className={inp + ' max-w-xs'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
      {cfg.status && (
        <button className="border border-navy/20 rounded px-3 py-2 text-sm bg-white hover:bg-mist/60" title="Click to change the status filter" onClick={nextStatus}>
          Status: <b className={statusF === 'all' ? '' : 'text-gold'}>{stepNow[1]}</b>
        </button>)}
    </div>
    <Err e={err} />
    {/* Totals strip: follows the search box */}
    {cfg.priced && rows && (
      <div className="grid gap-3 mb-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Total (${list.length})`} value={money(totalAmt)} />
        {cfg.due && <Stat label="Outstanding" value={money(dueAmt)} />}
        {cfg.due && <Stat label={`Overdue (${overdueRows.length})`} value={money(sum(overdueRows, r => r.balanceDue))} tone="red" />}
        {cfg.expiry && <Stat label={`Expired (${expiredRows.length})`} value={money(sum(expiredRows, r => r.total))} tone="red" />}
      </div>
    )}
    <div className="mt-2" />
    <Table cols={listCols} rows={shown} empty={`No ${cfg.title.toLowerCase()} yet. Click New ${cfg.one} to add one.`} />
  </>)
}

// The four pages used by the router
export const SalesQuotes = () => <DocPage cfg={SALES.quote} />
export const SalesOrders = () => <DocPage cfg={SALES.order} />
export const DeliveryNotes = () => <DocPage cfg={SALES.delivery} />
export const SalesInvoices = () => <DocPage cfg={SALES.invoice} />