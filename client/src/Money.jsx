// src/Money.jsx
// Receipts (money in) and Payments (money out), Manager.io style.
// One shared page component; the two exports below only choose the labels and API path.
// Expected API (to be built later), where PATH is /receipts or /bank-payments:
//   GET    PATH        -> [{ id, number, date, reference, contact, bankAccount, description, total, lines: [...] }]
//   POST   PATH        -> create
//   PUT    PATH/:id    -> update
//   DELETE PATH/:id    -> delete
// Also reads: /bank-accounts, /contacts?type=customer, /contacts?type=supplier, /accounts, /projects
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'
import { useCustomize, useFormSettings } from './customize'

// Escapes text before putting it in the print window
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// What differs between the two screens
const KINDS = {
  receipt: {
    form: 'receipt', path: '/receipts', title: 'Receipts', one: 'Receipt',
    who: 'Paid by', bank: 'Received in', hint: 'Money coming in.',
  },
  payment: {
    form: 'payment', path: '/bank-payments', title: 'Payments', one: 'Payment',
    who: 'Payee', bank: 'Paid from', hint: 'Money going out.',
  },
}

// Opens a print window for one record (the user saves it as PDF from there)
function printRecord(r, k, cfg) {
  const { business, print } = cfg.settings
  const fs = cfg.settings.forms[k.form]
  const title = fs.options.customTitle && fs.title ? fs.title : k.one
  const w = window.open('', '_blank'); if (!w) return alert('Allow pop-ups to print')
  w.document.write(`<html><head><title>${esc(r.number || title)}</title><style>body{font-family:IBM Plex Sans,Arial,sans-serif;color:#14202E;padding:40px;max-width:800px;margin:auto}header{display:flex;align-items:center;gap:16px;border-bottom:4px solid #B07F24;padding-bottom:16px}h1{margin:0;color:#1F3A5A}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#1F3A5A;color:#fff;text-align:left}td,th{padding:8px;border-bottom:1px solid #ddd}.r{text-align:right}footer{margin-top:32px;font-size:13px;color:#555}</style></head><body>
<header>${print.showLogo ? `<img src="${location.origin}/logo.png" height="64">` : ''}<div><h1>${esc(business.name)}</h1><div>${esc(title)} ${esc(r.number || '')} · ${fmtDate(r.date)}</div></div></header>
<p><b>${k.who}:</b> ${esc(r.contact?.name || r.contact)}<br><b>${k.bank}:</b> ${esc(r.bankAccount?.name || r.bankAccount)}${r.reference ? `<br><b>Reference:</b> ${esc(r.reference)}` : ''}</p>
${r.description ? `<p>${esc(r.description)}</p>` : ''}
<table><tr><th>Account</th><th>Description</th><th class="r">Amount</th></tr>
${(r.lines || []).map(l => `<tr><td>${esc(l.account?.name || l.account)}</td><td>${esc(l.description)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}
<tr><td colspan="2" class="r"><b>Total</b></td><td class="r"><b>${money(r.total)}</b></td></tr></table>
${fs.options.footers && fs.footer ? `<footer>${esc(fs.footer)}</footer>` : ''}</body></html>`)
  w.document.close(); setTimeout(() => w.print(), 600)
}

function MoneyPage({ kind }) {
  const k = KINDS[kind]
  const cfg = useCustomize()
  const fs = useFormSettings(k.form) // optional fields and defaults set in Settings

  const [rows, reload] = useLoad(k.path)
  const [banks] = useLoad('/bank-accounts')
  const [customers] = useLoad('/contacts?type=customer')
  const [suppliers] = useLoad('/contacts?type=supplier')
  const [accounts] = useLoad('/accounts')
  const [projects] = useLoad('/projects')

  // Both customers and suppliers can appear as the contact
  const contacts = [...(customers || []), ...(suppliers || [])]

  // The default account comes from Settings (code or name). If nothing matches, the first account is used.
  // Manager.io uses "Suspense" as the default; we use the first account until one is chosen.
  const defaultAccountId = () => {
    const want = String(fs.defaults.account || '').trim().toLowerCase()
    const hit = want && accounts?.find(a => String(a.code).toLowerCase() === want || a.name.toLowerCase() === want)
    return hit ? String(hit.id) : ''
  }
  const blankLine = () => ({ accountId: defaultAccountId(), description: '', amount: '', projectId: '' })
  const blank = () => ({ date: today(), reference: '', contactId: '', bankId: '', description: '', lines: [blankLine()] })

  const [view, setView] = useState('list') // 'list' | 'form' | 'view'
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [current, setCurrent] = useState(null) // record shown on the view page
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })
  const setLine = (i, p) => set({ lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const total = f.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const openNew = () => { setF(blank()); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => {
    setF({
      date: String(r.date).slice(0, 10), reference: r.reference || '', contactId: String(r.contactId ?? r.contact?.id ?? ''),
      bankId: String(r.bankId ?? r.bankAccount?.id ?? ''), description: r.description || '',
      lines: (r.lines?.length ? r.lines : [{}]).map(l => ({
        accountId: String(l.accountId ?? l.account?.id ?? ''), description: l.description || '', amount: l.amount ?? '', projectId: String(l.projectId ?? l.project?.id ?? ''),
      })),
    })
    setEditing(r); setErr(''); setView('form')
  }

  // Saves the form. addAnother = true keeps a fresh form open (new records only).
  const save = async addAnother => {
    if (!f.contactId) return setErr(`Choose the ${k.who.toLowerCase()}`)
    if (!f.bankId) return setErr('Choose a bank or cash account')
    const lines = f.lines.filter(l => Number(l.amount) > 0).map(l => ({
      accountId: l.accountId ? +l.accountId : null, description: l.description, amount: Number(l.amount), projectId: l.projectId ? +l.projectId : null,
    }))
    if (!lines.length) return setErr('Add at least one line with an amount')
    const body = { date: f.date, reference: f.reference, contactId: +f.contactId, bankId: +f.bankId, description: f.description, lines, total }
    try {
      if (editing) await api(`${k.path}/${editing.id}`, { method: 'PUT', body })
      else await api(k.path, { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(blank()); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${k.one.toLowerCase()} ${r.number || ''}?`)) return
    try { await api(`${k.path}/${r.id}`, { method: 'DELETE' }); setErr(''); setView('list'); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint={k.hint}>{editing ? `Edit ${k.one}` : `New ${k.one}`}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-4xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><input className={inp} type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Reference (optional)"><input className={inp} value={f.reference} onChange={e => set({ reference: e.target.value })} /></Field>
        <Field label={k.who}>
          <select className={inp} value={f.contactId} onChange={e => set({ contactId: e.target.value })}>
            <option value="">Choose contact</option>{contacts.map(c => <option key={c.type + c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={k.bank}>
          <select className={inp} value={f.bankId} onChange={e => set({ bankId: e.target.value })}>
            <option value="">Choose account</option>{banks?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea className={inp} rows={2} value={f.description} onChange={e => set({ description: e.target.value })} /></Field>

      {/* Lines: account, optional description column, amount, project */}
      <div className="space-y-2">
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className={inp + ' col-span-12 sm:col-span-3'} aria-label="Account" value={l.accountId} onChange={e => setLine(i, { accountId: e.target.value })}>
              <option value="">Suspense</option>{accounts?.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            {fs.options.description && (
              <input className={inp + ' col-span-12 sm:col-span-3'} placeholder="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
            )}
            <input className={inp + (fs.options.description ? ' col-span-6 sm:col-span-2' : ' col-span-6 sm:col-span-4')} type="number" min="0" placeholder="Amount" aria-label="Amount" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} />
            <select className={inp + ' col-span-6 sm:col-span-3'} aria-label="Project" value={l.projectId} onChange={e => setLine(i, { projectId: e.target.value })}>
              <option value="">No project</option>{projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="col-span-12 sm:col-span-1 text-sm text-red-700" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, j) => j !== i) : [blankLine()] })}>Remove</button>
          </div>
        ))}
        <div className="flex items-center">
          <button className="text-sm text-gold font-medium" onClick={() => set({ lines: [...f.lines, blankLine()] })}>Add line</button>
          <span className="ml-auto font-semibold">Total {money(total)}</span>
        </div>
      </div>

      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- View page (one record) ----------
  if (view === 'view' && current) return (<>
    <Title hint={fmtDate(current.date)}
      right={<>
        <BtnLight onClick={() => openEdit(current)}>Edit</BtnLight>
        <BtnLight onClick={() => printRecord(current, k, cfg)}>Print / PDF</BtnLight>
        <BtnLight onClick={() => remove(current)}>Delete</BtnLight>
        <BtnLight onClick={() => setView('list')}>Back</BtnLight>
      </>}>
      {k.one} {current.number}
    </Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-3 max-w-3xl text-sm">
      <p><b>{k.who}:</b> {current.contact?.name}</p>
      <p><b>{k.bank}:</b> {current.bankAccount?.name}</p>
      {current.reference && <p><b>Reference:</b> {current.reference}</p>}
      {current.description && <p>{current.description}</p>}
      <Table cols={[['Account', l => l.account?.name || 'Suspense'], ['Description', l => l.description], ['Amount', l => money(l.amount), 1]]} rows={current.lines || []} empty="No lines." />
      <p className="text-right font-semibold">Total {money(current.total)}</p>
    </section>
    <Err e={err} />
  </>)

  // ---------- List view ----------
  // Search matches number, reference, contact name and description
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.number, r.reference, r.contact?.name, r.description].join(' ').toLowerCase().includes(q))

  return (<>
    <Title hint={k.hint} right={<Btn onClick={openNew}>New {k.one}</Btn>}>{k.title}</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Date', r => fmtDate(r.date)],
        ['Ref', r => r.reference || r.number],
        [k.bank, r => r.bankAccount?.name],
        ['Description', r => r.description],
        [k.who, r => r.contact?.name],
        ['Amount', r => money(r.total), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => { setCurrent(r); setView('view') }}>View</button>
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty={`No ${k.title.toLowerCase()} yet. Click New ${k.one} to add one.`}
    />
  </>)
}

// The two pages used by the router
export const Receipts = () => <MoneyPage kind="receipt" />
export const Payments = () => <MoneyPage kind="payment" />