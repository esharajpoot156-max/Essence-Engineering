// src/Payslips.jsx
// Payslips (Manager.io style): form + payslip view page after saving (Print / PDF / Clone).
// Expected API (backend will be developed later):
//   GET    /payslips              -> [{ id, date, reference, description, employeeId, employeeName,
//                                       earnings:[{itemId,description,units,unitPrice,amount}],
//                                       deductions:[{itemId,description,amount}],
//                                       contributions:[{itemId,description,amount}],
//                                       showTotals, customTitle, footer, image, gross, totalDeductions, net }]
//   POST   /payslips              -> create (opens the view page if a new record is returned)
//   PUT    /payslips/:id          -> update
//   DELETE /payslips/:id          -> delete
//   GET    /employees             -> employee dropdown + address
//   GET    /payslip-earnings      -> [{ id, name }]   (Earnings dropdown)
//   GET    /payslip-deductions    -> [{ id, name }]   (Deductions dropdown)
//   GET    /payslip-contributions -> [{ id, name }]   (Contributions dropdown)

import { useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Company name displayed on the payslip (change it here if needed)
const COMPANY = 'Essence Engineering'

// ---------- Helpers ----------
const n = v => Number(v) || 0
const sum = lines => (lines || []).reduce((s, l) => s + n(l.amount), 0)

const EARN = () => ({ itemId: '', description: '', units: '', unitPrice: '', amount: '' })
const PLAIN = () => ({ itemId: '', description: '', amount: '' })

const blank = () => ({
  date: today(), reference: '', description: '', employeeId: '',
  earnings: [EARN()], deductions: [PLAIN()], contributions: [PLAIN()],
  showTotals: false, customTitle: '', useTitle: false, footer: '', useFooter: false,
  image: '',
})

// Convert server record into form values
const fromRecord = r => ({
  date: r.date ? String(r.date).slice(0, 10) : today(),
  reference: r.reference || '',
  description: r.description || '',
  employeeId: r.employeeId ?? '',
  earnings: (r.earnings?.length ? r.earnings : [EARN()]).map(l => ({
    itemId: l.itemId ?? '', description: l.description || '', units: l.units ?? '', unitPrice: l.unitPrice ?? '', amount: l.amount ?? '',
  })),
  deductions: (r.deductions?.length ? r.deductions : [PLAIN()]).map(l => ({ itemId: l.itemId ?? '', description: l.description || '', amount: l.amount ?? '' })),
  contributions: (r.contributions?.length ? r.contributions : [PLAIN()]).map(l => ({ itemId: l.itemId ?? '', description: l.description || '', amount: l.amount ?? '' })),
  showTotals: !!r.showTotals,
  customTitle: r.customTitle || '', useTitle: !!r.customTitle,
  footer: r.footer || '', useFooter: !!r.footer,
  image: r.image || '',
})

// ---------- Lines editor (Earnings / Deductions / Contributions) ----------
// withUnits = true only for Earnings (Units x Unit price = Amount)
function Lines({ title, items, lines, onChange, withUnits }) {
  const blankLine = withUnits ? EARN : PLAIN
  const setLine = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const removeLine = i => onChange(lines.filter((_, j) => j !== i))

  // When an item is selected, automatically fill its name if the description is empty
  const pickItem = (i, id) => {
    const it = (items || []).find(x => String(x.id) === String(id))
    setLine(i, { itemId: id, description: lines[i].description || (it ? it.name : '') })
  }

  // Automatically calculate amount = units x unit price when either value changes
  const setUnits = (i, patch) => {
    const l = { ...lines[i], ...patch }
    const amt = n(l.units) && n(l.unitPrice) ? String(n(l.units) * n(l.unitPrice)) : l.amount
    setLine(i, { ...patch, amount: amt })
  }

  return (
    <div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-end">
            <div className="w-36">
              {i === 0 && <span className="block mb-1 text-sm font-medium text-navy">{title}</span>}
              <select className={inp} aria-label={title + ' type'} value={l.itemId} onChange={e => pickItem(i, e.target.value)}>
                <option value="" />
                {(items || []).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[10rem]">
              {i === 0 && <span className="block mb-1 text-sm text-ink/70">Description</span>}
              <input className={inp} placeholder="Optional" aria-label={title + ' description'} value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
            </div>
            {withUnits && (<>
              <div className="w-24">
                {i === 0 && <span className="block mb-1 text-sm text-ink/70">Units</span>}
                <input type="number" min="0" className={inp + ' text-right'} aria-label="Units" value={l.units} onChange={e => setUnits(i, { units: e.target.value })} />
              </div>
              <div className="w-28">
                {i === 0 && <span className="block mb-1 text-sm text-ink/70">Unit price</span>}
                <input type="number" min="0" className={inp + ' text-right'} placeholder="0" aria-label="Unit price" value={l.unitPrice} onChange={e => setUnits(i, { unitPrice: e.target.value })} />
              </div>
            </>)}
            <div className="w-32">
              {i === 0 && <span className="block mb-1 text-sm text-ink/70">Amount</span>}
              <input type="number" min="0" className={inp + ' text-right'} placeholder="0" aria-label={title + ' amount'} value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} />
            </div>
            <button type="button" className="text-red-700 text-sm px-2 py-2" onClick={() => removeLine(i)} aria-label="Remove line">Remove</button>
          </div>
        ))}
      </div>
      <BtnLight type="button" className="mt-2 !px-3 !py-1 !text-xs" onClick={() => onChange([...lines, blankLine()])}>▸ Add line</BtnLight>
    </div>
  )
}

// ---------- Payslip document (view + print) ----------
function PayslipDoc({ r, emp, names }) {
  const earnings = r.earnings || [], deductions = r.deductions || [], contributions = r.contributions || []
  const gross = r.gross != null ? n(r.gross) : sum(earnings)
  const ded = r.totalDeductions != null ? n(r.totalDeductions) : sum(deductions)
  const net = r.net != null ? n(r.net) : gross - ded

  // Line label: item name + description
  const label = l => [names[l.itemId], l.description].filter(Boolean).join(' - ')
  const cell = 'border border-black px-3 py-2'

  const Section = ({ title, lines, showUnits }) => lines.length > 0 && (
    <tr>
      <td className={cell + ' align-top'}>
        <p className="mb-1">{title}</p>
        {lines.map((l, i) => (
          <p key={i} className="pl-4 text-ink/80">
            {label(l)}{showUnits && n(l.units) ? ` (${l.units} x ${money(l.unitPrice)})` : ''}
          </p>
        ))}
      </td>
      <td className={cell + ' text-right align-top'}>
        <p className="mb-1">&nbsp;</p>
        {lines.map((l, i) => <p key={i}>{n(l.amount).toFixed(2)}</p>)}
      </td>
    </tr>
  )

  return (
    <div id="payslip-doc" className="bg-white rounded shadow-sm p-8 max-w-2xl text-sm text-black">
      <h2 className="text-2xl font-bold mb-4">{r.customTitle || 'Payslip'}</h2>
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <p className="font-semibold">{emp?.name || r.employeeName}</p>
          {emp?.address && <p className="whitespace-pre-line">{emp.address}</p>}
          {r.description && <p className="mt-2">{r.description}</p>}
        </div>
        <div className="text-right pr-4 border-r border-black">
          <p className="font-semibold">Date</p>
          <p>{fmtDate(r.date)}</p>
          {r.reference && <><p className="font-semibold mt-2">Reference</p><p>{r.reference}</p></>}
        </div>
        <div className="font-semibold max-w-[10rem]">
          <p>{COMPANY}</p>
          {r.image && <img src={r.image} alt="" className="mt-2 max-h-20" />}
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr><th className={cell + ' text-left'}>Description</th><th className={cell + ' text-right w-40'}>Total</th></tr>
        </thead>
        <tbody>
          <Section title="Earnings" lines={earnings} showUnits />
          <tr><td className="px-3 py-2 text-right">Gross pay</td><td className={cell + ' text-right'}>{gross.toFixed(2)}</td></tr>
          <Section title="Deductions" lines={deductions} />
          <tr><td className="px-3 py-2 text-right font-bold">Net pay</td><td className={cell + ' text-right font-bold'}>{net.toFixed(2)}</td></tr>
          <Section title="Contributions (employer)" lines={contributions} />
        </tbody>
      </table>

      {r.footer && <p className="mt-6 text-xs whitespace-pre-line">{r.footer}</p>}
    </div>
  )
}

// ---------- Main page ----------
export default function Payslips() {
  const [rows, reload] = useLoad('/payslips')
  const [emps] = useLoad('/employees')
  const [earnItems] = useLoad('/payslip-earnings')
  const [dedItems] = useLoad('/payslip-deductions')
  const [contribItems] = useLoad('/payslip-contributions')

  const [view, setView] = useState('list') // 'list' | 'form' | 'view'
  const [f, setF] = useState(blank())
  const [editing, setEditing] = useState(null) // Currently edited record
  const [current, setCurrent] = useState(null) // Record displayed on the view page
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })

  // Map item IDs to names for the view page
  const names = {}
  ;[earnItems, dedItems, contribItems].forEach(list => (list || []).forEach(it => { names[it.id] = it.name }))
  const empOf = r => (emps || []).find(e => String(e.id) === String(r.employeeId))

  const openNew = () => { setF(blank()); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => { setF(fromRecord(r)); setEditing(r); setErr(''); setView('form') }
  const openView = r => { setCurrent(r); setErr(''); setView('view') }

  // Clone the selected record and set its date to today
  const clone = r => { setF({ ...fromRecord(r), date: today() }); setEditing(null); setErr(''); setView('form') }

  // Convert image file to a data URL (maximum size: 1 MB)
  const pickImage = file => {
    if (!file) return set({ image: '' })
    if (file.size > 1024 * 1024) return setErr('Image must be smaller than 1 MB')
    const rd = new FileReader()
    rd.onload = () => { setErr(''); set({ image: rd.result }) }
    rd.readAsDataURL(file)
  }

  const clean = lines => lines
    .filter(l => l.itemId || l.description.trim() || n(l.amount))
    .map(l => ({
      itemId: l.itemId || null,
      description: l.description.trim(),
      ...(l.units !== undefined ? { units: n(l.units), unitPrice: n(l.unitPrice) } : {}),
      amount: n(l.amount),
    }))

  // addAnother = true keeps a new blank form open after saving (only for new payslips)
  const save = async addAnother => {
    if (!f.date) return setErr('Date is required')
    if (!f.employeeId) return setErr('Please select an employee')

    const earnings = clean(f.earnings), deductions = clean(f.deductions), contributions = clean(f.contributions)

    if (sum(earnings) - sum(deductions) < 0) return setErr('Deductions cannot exceed earnings')

    const body = {
      date: f.date, reference: f.reference.trim(), description: f.description.trim(),
      employeeId: f.employeeId, earnings, deductions, contributions,
      showTotals: f.showTotals,
      customTitle: f.useTitle ? f.customTitle.trim() : '',
      footer: f.useFooter ? f.footer.trim() : '',
      image: f.image || '',
    }

    try {
      const saved = editing
        ? await api('/payslips/' + editing.id, { method: 'PUT', body })
        : await api('/payslips', { method: 'POST', body })

      reload()

      if (addAnother && !editing) { setF(blank()); setErr(''); return }

      // Open the payslip view page after saving if the server returns the saved record
      if (saved && saved.id) openView(saved)
      else if (editing) openView({ ...editing, ...body })
      else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete payslip ${r.reference || '#' + r.id}?`)) return
    try {
      await api('/payslips/' + r.id, { method: 'DELETE' })
      setErr('')
      setView('list')
      reload()
    } catch (e) { setErr(e.message) }
  }

  // Copy payslip details as plain text to the clipboard
  const copyText = r => {
    const lines = [
      `${r.customTitle || 'Payslip'} - ${r.employeeName || empOf(r)?.name || ''}`,
      `Date: ${fmtDate(r.date)}`,
      ...(r.earnings || []).map(l => `Earnings: ${[names[l.itemId], l.description].filter(Boolean).join(' - ')} ${n(l.amount).toFixed(2)}`),
      ...(r.deductions || []).map(l => `Deduction: ${[names[l.itemId], l.description].filter(Boolean).join(' - ')} ${n(l.amount).toFixed(2)}`),
      `Gross pay: ${sum(r.earnings).toFixed(2)}`,
      `Net pay: ${(sum(r.earnings) - sum(r.deductions)).toFixed(2)}`,
    ]

    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
  }

  // ================= View page =================
  if (view === 'view' && current) return (<>
    {/* Display only the payslip when printing */}
    <style>{`@media print { body * { visibility: hidden } #payslip-doc, #payslip-doc * { visibility: visible } #payslip-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none } }`}</style>

    <Title hint={<button className="text-gold" onClick={() => setView('list')}>← Payslips</button>}>Payslip</Title>

    <div className="flex flex-wrap gap-2 mb-4">
      <BtnLight onClick={() => openEdit(current)}>Edit</BtnLight>
      <BtnLight onClick={() => clone(current)}>Clone</BtnLight>
      <BtnLight onClick={() => window.print()}>Print</BtnLight>
      {/* Select "Save as PDF" in the print dialog */}
      <BtnLight onClick={() => window.print()}>PDF</BtnLight>
      <BtnLight onClick={() => copyText(current)}>Copy to clipboard</BtnLight>
      <BtnLight className="!text-red-700" onClick={() => remove(current)}>Delete</BtnLight>
    </div>

    <Err e={err} />
    <div className="bg-mist/40 p-4 rounded">
      <PayslipDoc r={current} emp={empOf(current)} names={names} />
    </div>
  </>)

  // ================= Form view =================
  if (view === 'form') {
    const gross = sum(f.earnings), ded = sum(f.deductions), net = gross - ded

    return (<>
      <Title hint="Net pay = earnings minus deductions. Contributions are paid by the employer.">
        {editing ? 'Edit Payslip' : 'New Payslip'}
      </Title>

      <section className="bg-white border border-navy/10 rounded p-4 space-y-5 max-w-4xl">
        <div className="flex flex-wrap gap-4">
          <Field label="Date"><input type="date" className={inp} value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
          <Field label="Reference"><input className={inp} placeholder="Optional" value={f.reference} onChange={e => set({ reference: e.target.value })} /></Field>
        </div>

        <Field label="Description" className="max-w-2xl">
          <input className={inp} placeholder="Optional" value={f.description} onChange={e => set({ description: e.target.value })} />
        </Field>

        <Field label="Employee" className="max-w-xs">
          <select className={inp} value={f.employeeId} onChange={e => set({ employeeId: e.target.value })}>
            <option value="">Select employee</option>
            {(emps || []).map(e => <option key={e.id} value={e.id}>{e.code ? e.code + ' - ' : ''}{e.name}</option>)}
          </select>
        </Field>

        <Lines title="Earnings" items={earnItems} lines={f.earnings} onChange={earnings => set({ earnings })} withUnits />
        <Lines title="Deductions" items={dedItems} lines={f.deductions} onChange={deductions => set({ deductions })} />
        <Lines title="Contributions" items={contribItems} lines={f.contributions} onChange={contributions => set({ contributions })} />

        {/* Optional features */}
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.showTotals} onChange={e => set({ showTotals: e.target.checked })} />
            Show totals for the period
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.useTitle} onChange={e => set({ useTitle: e.target.checked })} />
            Custom title
          </label>

          {f.useTitle && <input className={inp + ' max-w-sm'} placeholder="Payslip" aria-label="Custom title" value={f.customTitle} onChange={e => set({ customTitle: e.target.value })} />}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.useFooter} onChange={e => set({ useFooter: e.target.checked })} />
            Footer
          </label>

          {f.useFooter && <textarea rows={2} className={inp + ' max-w-xl'} aria-label="Footer" value={f.footer} onChange={e => set({ footer: e.target.value })} />}
        </div>

        {/* Image */}
        <fieldset className="border border-navy/15 rounded p-3">
          <legend className="px-2 text-sm text-ink/70">Image</legend>
          <input type="file" accept="image/*" onChange={e => pickImage(e.target.files?.[0])} />

          {f.image && (
            <div className="mt-2 flex items-center gap-3">
              <img src={f.image} alt="" className="max-h-16" />
              <button type="button" className="text-red-700 text-sm" onClick={() => set({ image: '' })}>Remove image</button>
            </div>
          )}
        </fieldset>

        {/* Totals */}
        <dl className="text-sm space-y-1 max-w-xs ml-auto">
          <div className="flex justify-between"><dt className="text-ink/70">Gross pay</dt><dd>{money(gross)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink/70">Total deductions</dt><dd>{money(ded)}</dd></div>
          <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold">
            <dt>Net pay</dt><dd className={net < 0 ? 'text-red-700' : ''}>{money(net)}</dd>
          </div>
        </dl>

        <Err e={err} />

        <div className="flex gap-2">
          <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
          {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
          <BtnLight onClick={() => setView(editing ? 'view' : 'list')}>Cancel</BtnLight>
        </div>
      </section>
    </>)
  }

  // ================= List view =================
  const grossOf = r => (r.gross != null ? n(r.gross) : sum(r.earnings))
  const netOf = r => (r.net != null ? n(r.net) : grossOf(r) - (r.totalDeductions != null ? n(r.totalDeductions) : sum(r.deductions)))

  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.reference, r.description, r.employeeName, r.employee?.name].join(' ').toLowerCase().includes(q))

  return (<>
    <Title
      hint="Salary slips for each employee. Payslips contribute to the employee's Amount to pay balance."
      right={<Btn onClick={openNew}>New Payslip</Btn>}
    >
      Payslips
    </Title>

    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />

    <Err e={err} />
    <div className="mt-2" />

    <Table
      cols={[
        ['Date', r => <button className="text-gold font-medium" onClick={() => openView(r)}>{fmtDate(r.date)}</button>],
        ['Reference', r => r.reference],
        ['Employee', r => r.employeeName || r.employee?.name],
        ['Description', r => r.description],
        ['Gross pay', r => money(grossOf(r)), 1],
        ['Net pay', r => <span className="font-semibold">{money(netOf(r))}</span>, 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openView(r)}>View</button>
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No payslips yet. Click New Payslip to add one."
    />
  </>)
}