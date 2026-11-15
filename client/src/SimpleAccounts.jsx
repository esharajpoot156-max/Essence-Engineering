// src/SimpleAccounts.jsx
// Capital Accounts, Special Accounts and Investments (Manager.io style).
// All three only have a Name and a Code, so they share one page component.
// Expected API (to be built later), where PATH is /capital-accounts, /special-accounts or /investments:
//   GET    PATH        -> [{ id, name, code, balance }]   (balance is optional)
//   POST   PATH        -> create
//   PUT    PATH/:id    -> update
//   DELETE PATH/:id    -> delete
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// What differs between the three pages
const KINDS = {
  capital: {
    path: '/capital-accounts', title: 'Capital Accounts', one: 'Capital Account',
    hint: 'Owner equity accounts, such as the owner\'s capital and drawings.',
  },
  special: {
    path: '/special-accounts', title: 'Special Accounts', one: 'Special Account',
    hint: 'System-linked accounts used by the software for automatic entries.',
  },
  investment: {
    path: '/investments', title: 'Investments', one: 'Investment',
    hint: 'Tracks investment holdings.',
  },
}

// Empty form values
const BLANK = { name: '', code: '' }

function AccountsPage({ kind }) {
  const k = KINDS[kind]
  const [rows, reload] = useLoad(k.path)
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF(BLANK); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => { setF({ name: r.name || '', code: r.code || '' }); setEditing(r); setErr(''); setView('form') }

  // Saves the form. addAnother = true keeps a fresh form open (new records only).
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Name is required')
    const body = { name: f.name.trim(), code: f.code.trim() }
    try {
      if (editing) await api(`${k.path}/${editing.id}`, { method: 'PUT', body })
      else await api(k.path, { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(BLANK); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api(`${k.path}/${r.id}`, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint={k.hint}>{editing ? `Edit ${k.one}` : `New ${k.one}`}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-xl">
      <Field label="Name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
      <Field label="Code (optional)"><input className={inp} value={f.code} onChange={e => set({ code: e.target.value })} /></Field>
      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List view ----------
  // Search matches name and code
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.name, r.code].join(' ').toLowerCase().includes(q))

  return (<>
    <Title hint={k.hint} right={<Btn onClick={openNew}>New {k.one}</Btn>}>{k.title}</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Code', r => r.code],
        ['Name', r => r.name],
        // Balance is shown only when the server sends it
        ['Balance', r => (r.balance != null ? money(r.balance) : ''), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
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

// The three pages used by the router
export const CapitalAccounts = () => <AccountsPage kind="capital" />
export const SpecialAccounts = () => <AccountsPage kind="special" />
export const Investments = () => <AccountsPage kind="investment" />