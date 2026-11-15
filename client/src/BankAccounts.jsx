// src/BankAccounts.jsx
// Bank and Cash Accounts (Manager.io style): list page + create/edit form.
// Expected API (to be built later):
//   GET    /bank-accounts        -> [{ id, name, code, iban, pending, creditLimit, balance }]
//   POST   /bank-accounts        -> create
//   PUT    /bank-accounts/:id    -> update
//   DELETE /bank-accounts/:id    -> delete
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Empty form values
const BLANK = { name: '', code: '', iban: '', pending: false, creditLimit: '' }

export default function BankAccounts() {
  const [rows, reload] = useLoad('/bank-accounts')
  // view: 'list' shows the table, 'form' shows the create/edit form
  const [view, setView] = useState('list')
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null) // the account being edited (null = new)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  // Optional fields: shown only when ticked (like Manager.io)
  const [showIban, setShowIban] = useState(false)
  const [showLimit, setShowLimit] = useState(false)

  const set = patch => setF({ ...f, ...patch })

  // Opens an empty form
  const openNew = () => {
    setF(BLANK); setEditing(null); setShowIban(false); setShowLimit(false); setErr(''); setView('form')
  }

  // Opens the form filled with an existing account
  const openEdit = r => {
    setF({ name: r.name || '', code: r.code || '', iban: r.iban || '', pending: !!r.pending, creditLimit: r.creditLimit ?? '' })
    setEditing(r); setShowIban(!!r.iban); setShowLimit(r.creditLimit != null && r.creditLimit !== '')
    setErr(''); setView('form')
  }

  // Saves the form. addAnother = true keeps the form open with empty fields.
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Name is required')
    // Hidden optional fields are not sent
    const body = {
      name: f.name.trim(), code: f.code.trim(), pending: f.pending,
      iban: showIban ? f.iban.trim() : '',
      creditLimit: showLimit ? Number(f.creditLimit) || 0 : null,
    }
    try {
      if (editing) await api('/bank-accounts/' + editing.id, { method: 'PUT', body })
      else await api('/bank-accounts', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(BLANK); setShowIban(false); setShowLimit(false); setErr('') }
      else setView('list')
    } catch (e) { setErr(e.message) }
  }

  // Deletes an account after confirming
  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api('/bank-accounts/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint="Add a bank account or a cash box.">{editing ? 'Edit Bank or Cash Account' : 'New Bank or Cash Account'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-xl">
      <Field label="Name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
      <Field label="Code (optional)"><input className={inp} value={f.code} onChange={e => set({ code: e.target.value })} /></Field>

      {/* Optional fields */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showIban} onChange={e => setShowIban(e.target.checked)} />International Bank Account Number (IBAN)
      </label>
      {showIban && <Field label="IBAN"><input className={inp} value={f.iban} onChange={e => set({ iban: e.target.value })} /></Field>}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.pending} onChange={e => set({ pending: e.target.checked })} />Can have pending transactions
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showLimit} onChange={e => setShowLimit(e.target.checked)} />Credit limit
      </label>
      {showLimit && <Field label="Credit limit"><input className={inp} type="number" min="0" value={f.creditLimit} onChange={e => set({ creditLimit: e.target.value })} /></Field>}

      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List view ----------
  // Search matches name or code
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => (r.name + ' ' + (r.code || '')).toLowerCase().includes(q))

  return (<>
    <Title hint="Your bank accounts and cash boxes." right={<Btn onClick={openNew}>New Bank or Cash Account</Btn>}>Bank and Cash Accounts</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Name', r => r.name],
        ['Code', r => r.code],
        ['IBAN', r => r.iban],
        ['Balance', r => money(r.balance), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No bank or cash accounts yet. Click New Bank or Cash Account to add one."
    />
  </>)
}