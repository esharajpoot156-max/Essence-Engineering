// src/ExpenseClaims.jsx
// Expense Claims (Manager.io style): staff claim expenses they paid personally.
// Expected API (to be built later):
//   GET/POST/PUT/DELETE /expense-claims
//        record: { id, number, date, reference, paidById, payeeId, paidBy: {name}, payee: {name}, total,
//                  lines: [{ accountId, account: {name}, description, qty, price }] }
// Also reads: /employees (who paid), /contacts?type=supplier (who is repaid), /accounts
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'
import { useCustomize, useFormSettings } from './customize'

// Escapes text before putting it in the print window
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Total of one line (qty x unit price)
const lineTotal = l => (Number(l.qty) || 0) * (Number(l.price) || 0)

// Opens a print window for one claim (save as PDF from there)
function printClaim(r, cfg) {
  const { business, print } = cfg.settings
  const fs = cfg.settings.forms.expenseClaim
  const title = fs.options.customTitle && fs.title ? fs.title : 'Expense Claim'
  const w = window.open('', '_blank'); if (!w) return alert('Allow pop-ups to print')
  w.document.write(`<html><head><title>${esc(r.number)}</title><style>body{font-family:IBM Plex Sans,Arial,sans-serif;color:#14202E;padding:40px;max-width:800px;margin:auto}header{display:flex;align-items:center;gap:16px;border-bottom:4px solid #B07F24;padding-bottom:16px}h1{margin:0;color:#1F3A5A}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#1F3A5A;color:#fff;text-align:left}td,th{padding:8px;border-bottom:1px solid #ddd}.r{text-align:right}footer{margin-top:32px;font-size:13px;color:#555}</style></head><body>
<header>${print.showLogo ? `<img src="${location.origin}/logo.png" height="64">` : ''}<div><h1>${esc(business.name)}</h1><div>${esc(title)} ${esc(r.number)} · ${fmtDate(r.date)}</div></div></header>
<p><b>Paid by:</b> ${esc(r.paidBy?.name)}<br><b>Payee:</b> ${esc(r.payee?.name)}${r.reference ? `<br><b>Reference:</b> ${esc(r.reference)}` : ''}</p>
<table><tr><th>Account</th>${fs.options.description ? '<th>Description</th>' : ''}<th class="r">Qty</th><th class="r">Unit price</th><th class="r">Total</th></tr>
${(r.lines || []).map(l => `<tr><td>${esc(l.account?.name)}</td>${fs.options.description ? `<td>${esc(l.description)}</td>` : ''}<td class="r">${l.qty}</td><td class="r">${money(l.price)}</td><td class="r">${money(lineTotal(l))}</td></tr>`).join('')}
<tr><td colspan="${fs.options.description ? 4 : 3}" class="r"><b>Total</b></td><td class="r"><b>${money(r.total)}</b></td></tr></table>
${fs.options.footers && fs.footer ? `<footer>${esc(fs.footer)}</footer>` : ''}</body></html>`)
  w.document.close(); setTimeout(() => w.print(), 600)
}

export default function ExpenseClaims() {
  const cfg = useCustomize()
  const fs = useFormSettings('expenseClaim') // optional fields set in Settings

  const [rows, reload] = useLoad('/expense-claims')
  const [employees] = useLoad('/employees')
  const [suppliers] = useLoad('/contacts?type=supplier')
  const [accounts] = useLoad('/accounts')

  const blankLine = () => ({ accountId: '', description: '', qty: 1, price: '' })
  const blank = () => ({ date: today(), reference: '', paidById: '', payeeId: '', lines: [blankLine()] })

  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })
  const setLine = (i, p) => set({ lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const total = f.lines.reduce((s, l) => s + lineTotal(l), 0)

  const openNew = () => { setF(blank()); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => {
    setF({
      date: String(r.date).slice(0, 10), reference: r.reference || '',
      paidById: String(r.paidById ?? r.paidBy?.id ?? ''), payeeId: String(r.payeeId ?? r.payee?.id ?? ''),
      lines: (r.lines?.length ? r.lines : [{}]).map(l => ({
        accountId: String(l.accountId ?? l.account?.id ?? ''), description: l.description || '', qty: l.qty ?? 1, price: l.price ?? '',
      })),
    })
    setEditing(r); setErr(''); setView('form')
  }

  const save = async addAnother => {
    if (!f.paidById) return setErr('Choose who paid')
    const lines = f.lines.filter(l => lineTotal(l) > 0).map(l => ({
      accountId: l.accountId ? +l.accountId : null, description: l.description, qty: Number(l.qty), price: Number(l.price),
    }))
    if (!lines.length) return setErr('Add at least one line with an amount')
    const body = { date: f.date, reference: f.reference, paidById: +f.paidById, payeeId: f.payeeId ? +f.payeeId : null, lines, total }
    try {
      if (editing) await api('/expense-claims/' + editing.id, { method: 'PUT', body })
      else await api('/expense-claims', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(blank()); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete expense claim ${r.number || ''}?`)) return
    try { await api('/expense-claims/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form ----------
  if (view === 'form') return (<>
    <Title hint="Expenses a staff member paid personally.">{editing ? 'Edit Expense Claim' : 'New Expense Claim'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-4xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><input className={inp} type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Reference (optional)"><input className={inp} value={f.reference} onChange={e => set({ reference: e.target.value })} /></Field>
        <Field label="Paid by">
          <select className={inp} value={f.paidById} onChange={e => set({ paidById: e.target.value })}>
            <option value="">Choose employee</option>{employees?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Payee">
          <select className={inp} value={f.payeeId} onChange={e => set({ payeeId: e.target.value })}>
            <option value="">Choose payee</option>{suppliers?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      </div>

      {/* Lines: account, optional description, qty, unit price, total */}
      <div className="space-y-2">
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <select className={inp + (fs.options.description ? ' col-span-12 sm:col-span-3' : ' col-span-12 sm:col-span-5')} aria-label="Account" value={l.accountId} onChange={e => setLine(i, { accountId: e.target.value })}>
              <option value="">Choose account</option>{accounts?.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            {fs.options.description && (
              <input className={inp + ' col-span-12 sm:col-span-3'} placeholder="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
            )}
            <input className={inp + ' col-span-4 sm:col-span-1'} type="number" min="1" aria-label="Qty" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
            <input className={inp + ' col-span-4 sm:col-span-2'} type="number" min="0" placeholder="Unit price" aria-label="Unit price" value={l.price} onChange={e => setLine(i, { price: e.target.value })} />
            <span className="col-span-3 sm:col-span-2 text-sm text-right">{money(lineTotal(l))}</span>
            <button className="col-span-1 text-sm text-red-700" aria-label="Remove line" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, j) => j !== i) : [blankLine()] })}>X</button>
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

  // ---------- List ----------
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.number, r.reference, r.paidBy?.name, r.payee?.name].join(' ').toLowerCase().includes(q))
  return (<>
    <Title hint="Expenses staff paid personally and need repaid." right={<Btn onClick={openNew}>New Expense Claim</Btn>}>Expense Claims</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Date', r => fmtDate(r.date)],
        ['Ref', r => r.reference || r.number],
        ['Paid by', r => r.paidBy?.name],
        ['Payee', r => r.payee?.name],
        ['Amount', r => money(r.total), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => printClaim(r, cfg)}>Print / PDF</button>
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No expense claims yet. Click New Expense Claim to add one."
    />
  </>)
}