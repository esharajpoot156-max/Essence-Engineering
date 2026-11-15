// src/Employees.jsx
// Employees (Manager.io style): staff list + "Amount to pay" button.
// Expected API (backend will be implemented later):
//   GET    /employees                      -> [{ id, name, code, jobTitle, phone, email, joiningDate, basicSalary, address, notes, balance }]
//                                             (balance = amount to pay = payslips - payments)
//   POST   /employees                      -> create
//   PUT    /employees/:id                  -> update
//   DELETE /employees/:id                  -> delete
//   GET    /employees/:id/amount-to-pay    -> { payslips, paid, balance }
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Empty form values
const BLANK = {
  name: '', code: '', jobTitle: '', phone: '', email: '',
  joiningDate: today(), basicSalary: '', address: '', notes: '',
}

export default function Employees() {
  const [rows, reload] = useLoad('/employees')
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')
  // "Amount to pay" panel: { emp, data, loading, error }
  const [pay, setPay] = useState(null)

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF({ ...BLANK, joiningDate: today() }); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => {
    setF({
      name: r.name || '', code: r.code || '', jobTitle: r.jobTitle || '',
      phone: r.phone || '', email: r.email || '',
      joiningDate: r.joiningDate ? String(r.joiningDate).slice(0, 10) : '',
      basicSalary: r.basicSalary ?? '', address: r.address || '', notes: r.notes || '',
    })
    setEditing(r); setErr(''); setView('form')
  }

  // Save the form. addAnother = true -> keep a new blank form open (only for new employees)
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Employee name is required')
    if (f.basicSalary !== '' && Number(f.basicSalary) < 0) return setErr('Salary cannot be negative')
    const body = {
      name: f.name.trim(),
      code: f.code.trim(),
      jobTitle: f.jobTitle.trim(),
      phone: f.phone.trim(),
      email: f.email.trim(),
      joiningDate: f.joiningDate || null,
      basicSalary: f.basicSalary === '' ? 0 : Number(f.basicSalary),
      address: f.address.trim(),
      notes: f.notes.trim(),
    }
    try {
      if (editing) await api('/employees/' + editing.id, { method: 'PUT', body })
      else await api('/employees', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF({ ...BLANK, joiningDate: today() }); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api('/employees/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // "Amount to pay" button: fetches the employee's payment details from the server
  const showAmount = async r => {
    setPay({ emp: r, data: null, loading: true, error: '' })
    try {
      const data = await api(`/employees/${r.id}/amount-to-pay`)
      setPay({ emp: r, data, loading: false, error: '' })
    } catch (e) {
      setPay({ emp: r, data: null, loading: false, error: e.message })
    }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint="Basic employee details. Payslips will be added in the next file.">{editing ? 'Edit Employee' : 'New Employee'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Employee name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Code (optional)"><input className={inp} value={f.code} onChange={e => set({ code: e.target.value })} /></Field>
        <Field label="Job title"><input className={inp} value={f.jobTitle} onChange={e => set({ jobTitle: e.target.value })} /></Field>
        <Field label="Joining date"><input type="date" className={inp} value={f.joiningDate} onChange={e => set({ joiningDate: e.target.value })} /></Field>
        <Field label="Phone"><input className={inp} value={f.phone} onChange={e => set({ phone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" className={inp} value={f.email} onChange={e => set({ email: e.target.value })} /></Field>
        <Field label="Basic salary (monthly)"><input type="number" min="0" className={inp} value={f.basicSalary} onChange={e => set({ basicSalary: e.target.value })} /></Field>
      </div>
      <Field label="Address"><textarea rows={2} className={inp} value={f.address} onChange={e => set({ address: e.target.value })} /></Field>
      <Field label="Notes"><textarea rows={2} className={inp} value={f.notes} onChange={e => set({ notes: e.target.value })} /></Field>
      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List view ----------
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.name, r.code, r.jobTitle, r.phone, r.email].join(' ').toLowerCase().includes(q))

  return (<>
    <Title hint="Staff list. Amount to pay = payslips minus payments."
      right={<Btn onClick={openNew}>New Employee</Btn>}>Employees</Title>

    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />

    {/* Amount to pay panel */}
    {pay && (
      <section className="bg-white border border-navy/10 rounded p-4 mb-4 max-w-xl">
        <div className="flex items-start gap-4">
          <h3 className="font-semibold text-navy">Amount to pay: {pay.emp.name}</h3>
          <button className="ml-auto text-sm text-ink/60" onClick={() => setPay(null)} aria-label="Close">Close</button>
        </div>
        {pay.loading && <p className="text-sm text-ink/60 mt-2">Loading…</p>}
        <Err e={pay.error} />
        {pay.data && (
          <dl className="mt-3 text-sm space-y-1">
            <div className="flex justify-between"><dt className="text-ink/70">Payslips total</dt><dd>{money(pay.data.payslips)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/70">Paid so far</dt><dd>{money(pay.data.paid)}</dd></div>
            <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold">
              <dt>Amount to pay</dt><dd>{money(pay.data.balance)}</dd>
            </div>
          </dl>
        )}
      </section>
    )}

    <Table
      cols={[
        ['Code', r => r.code],
        ['Name', r => r.name],
        ['Job title', r => r.jobTitle],
        ['Phone', r => r.phone],
        ['Joined', r => fmtDate(r.joiningDate)],
        ['Salary', r => money(r.basicSalary), 1],
        ['Amount to pay', r => (
          <span className="inline-flex items-center gap-2">
            <span className={Number(r.balance) > 0 ? 'font-semibold' : ''}>{money(r.balance)}</span>
            <BtnLight className="!px-2 !py-1 !text-xs" onClick={() => showAmount(r)}>Amount to pay</BtnLight>
          </span>
        ), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No employees yet. Click New Employee to add one."
    />
  </>)
}