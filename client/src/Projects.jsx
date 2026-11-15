// src/Projects.jsx
// Projects (Manager.io style): group income and expenses by job.
// Expected API (to be built later):
//   GET    /projects        -> [{ id, name, code, income, expenses }]  (income/expenses = totals of documents tagged to the project)
//   POST   /projects        -> create
//   PUT    /projects/:id    -> update
//   DELETE /projects/:id    -> delete
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Empty form values
const BLANK = { name: '', code: '' }

export default function Projects() {
  const [rows, reload] = useLoad('/projects')
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF(BLANK); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => { setF({ name: r.name || '', code: r.code || '' }); setEditing(r); setErr(''); setView('form') }

  // Saves the form. addAnother = true keeps a fresh form open (new projects only).
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Project name is required')
    const body = { name: f.name.trim(), code: f.code.trim() }
    try {
      if (editing) await api('/projects/' + editing.id, { method: 'PUT', body })
      else await api('/projects', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(BLANK); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api('/projects/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint="A project groups the income and expenses of one job.">{editing ? 'Edit Project' : 'New Project'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-xl">
      <Field label="Project name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
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
  // Profit = income - expenses
  const profit = r => (Number(r.income) || 0) - (Number(r.expenses) || 0)

  return (<>
    <Title hint="Projects link sales and purchase documents so you can see the profit of each job."
      right={<Btn onClick={openNew}>New Project</Btn>}>Projects</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Code', r => r.code],
        ['Name', r => r.name],
        ['Income', r => money(r.income), 1],
        ['Expenses', r => money(r.expenses), 1],
        // A loss is shown in red
        ['Profit', r => <span className={profit(r) < 0 ? 'text-red-700 font-semibold' : ''}>{money(profit(r))}</span>, 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No projects yet. Click New Project to add one."
    />
  </>)
}