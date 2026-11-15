// src/FixedAssets.jsx
// Fixed Assets + Depreciation Entries (Manager.io style).
// Expected API (backend will be developed later):
//   GET    /fixed-assets          -> [{ id, code, name, description, purchaseDate, cost, residualValue,
//                                      usefulLifeYears, method, notes, accumulated }]
//                                    (accumulated = total depreciation recorded so far)
//   POST   /fixed-assets          -> create
//   PUT    /fixed-assets/:id      -> update
//   DELETE /fixed-assets/:id      -> delete
//   GET    /depreciation          -> [{ id, date, reference, description, assetId, assetName, amount }]
//   POST   /depreciation          -> create
//   PUT    /depreciation/:id      -> update
//   DELETE /depreciation/:id      -> delete

import { useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Turns any value into a number (0 if it cannot be read)
const n = v => Number(v) || 0

// Depreciation methods
const METHODS = [
  ['straight', 'Straight line'],
  ['none', 'No depreciation'],
]

// Asset book value = cost - accumulated depreciation
const bookValue = a => n(a.cost) - n(a.accumulated)

// Straight-line monthly depreciation (cannot exceed the remaining depreciable amount)
const monthlyAmount = a => {
  if (!a || a.method === 'none') return 0
  const months = n(a.usefulLifeYears) * 12
  if (months <= 0) return 0
  const depreciable = n(a.cost) - n(a.residualValue)
  const remaining = Math.max(depreciable - n(a.accumulated), 0)
  return Math.round(Math.min(depreciable / months, remaining))
}

// =====================================================================
// Fixed Assets
// =====================================================================
const BLANK_ASSET = () => ({
  code: '', name: '', description: '', purchaseDate: today(),
  cost: '', residualValue: '', usefulLifeYears: '', method: 'straight', notes: '',
})

export function FixedAssets() {
  const [rows, reload] = useLoad('/fixed-assets')
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(BLANK_ASSET())
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF(BLANK_ASSET()); setEditing(null); setErr(''); setView('form') }

  const openEdit = r => {
    setF({
      code: r.code || '', name: r.name || '', description: r.description || '',
      purchaseDate: r.purchaseDate ? String(r.purchaseDate).slice(0, 10) : '',
      cost: r.cost ?? '', residualValue: r.residualValue ?? '',
      usefulLifeYears: r.usefulLifeYears ?? '', method: r.method || 'straight', notes: r.notes || '',
    })
    setEditing(r); setErr(''); setView('form')
  }

  // addAnother = true keeps a new blank form open (only for new assets)
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Asset name is required')
    if (n(f.cost) < 0) return setErr('Cost cannot be negative')
    if (n(f.residualValue) > n(f.cost)) return setErr('Residual value cannot exceed the asset cost')
    if (f.method === 'straight' && n(f.usefulLifeYears) <= 0) return setErr('Please enter the useful life in years for the straight-line method')

    const body = {
      code: f.code.trim(), name: f.name.trim(), description: f.description.trim(),
      purchaseDate: f.purchaseDate || null,
      cost: n(f.cost), residualValue: n(f.residualValue),
      usefulLifeYears: n(f.usefulLifeYears), method: f.method, notes: f.notes.trim(),
    }

    try {
      if (editing) await api('/fixed-assets/' + editing.id, { method: 'PUT', body })
      else await api('/fixed-assets', { method: 'POST', body })

      reload()

      if (addAnother && !editing) {
        setF(BLANK_ASSET())
        setErr('')
      } else {
        setView('list')
      }
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return

    try {
      await api('/fixed-assets/' + r.id, { method: 'DELETE' })
      setErr('')
      reload()
    } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint="Configure asset cost and depreciation settings.">
      {editing ? 'Edit Fixed Asset' : 'New Fixed Asset'}
    </Title>

    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Code (optional)">
          <input className={inp} value={f.code} onChange={e => set({ code: e.target.value })} />
        </Field>

        <Field label="Name">
          <input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} />
        </Field>

        <Field label="Purchase date">
          <input type="date" className={inp} value={f.purchaseDate} onChange={e => set({ purchaseDate: e.target.value })} />
        </Field>

        <Field label="Cost">
          <input type="number" min="0" className={inp} value={f.cost} onChange={e => set({ cost: e.target.value })} />
        </Field>

        <Field label="Depreciation method">
          <select className={inp} value={f.method} onChange={e => set({ method: e.target.value })}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>

        {f.method === 'straight' && (<>
          <Field label="Useful life (years)">
            <input type="number" min="0" step="0.5" className={inp} value={f.usefulLifeYears} onChange={e => set({ usefulLifeYears: e.target.value })} />
          </Field>

          <Field label="Residual value (optional)">
            <input type="number" min="0" className={inp} value={f.residualValue} onChange={e => set({ residualValue: e.target.value })} />
          </Field>
        </>)}
      </div>

      <Field label="Description">
        <textarea rows={2} className={inp} value={f.description} onChange={e => set({ description: e.target.value })} />
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={inp} value={f.notes} onChange={e => set({ notes: e.target.value })} />
      </Field>

      {/* Preview: monthly depreciation */}
      {f.method === 'straight' && monthlyAmount({ ...f, accumulated: 0 }) > 0 && (
        <p className="text-sm text-ink/70">
          Monthly depreciation:{' '}
          <span className="font-semibold">{money(monthlyAmount({ ...f, accumulated: 0 }))}</span>
        </p>
      )}

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
  const shown = rows && rows.filter(r => [r.code, r.name, r.description].join(' ').toLowerCase().includes(q))

  return (<>
    <Title
      hint="Book value = cost minus accumulated depreciation."
      right={<Btn onClick={openNew}>New Fixed Asset</Btn>}
    >
      Fixed Assets
    </Title>

    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />

    <Err e={err} />
    <div className="mt-2" />

    <Table
      cols={[
        ['Code', r => r.code],
        ['Name', r => r.name],
        ['Purchase date', r => fmtDate(r.purchaseDate)],
        ['Cost', r => money(r.cost), 1],
        ['Accumulated depreciation', r => money(r.accumulated), 1],
        ['Book value', r => <span className="font-semibold">{money(bookValue(r))}</span>, 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No fixed assets yet. Click New Fixed Asset to add one."
    />
  </>)
}

// =====================================================================
// Depreciation Entries
// =====================================================================
const BLANK_ENTRY = () => ({
  date: today(), reference: '', description: '', assetId: '', amount: ''
})

export function DepreciationEntries() {
  const [rows, reload] = useLoad('/depreciation')
  const [assets] = useLoad('/fixed-assets')
  const [view, setView] = useState('list')
  const [f, setF] = useState(BLANK_ENTRY())
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const set = patch => setF({ ...f, ...patch })
  const assetOf = id => (assets || []).find(a => String(a.id) === String(id))

  const openNew = () => { setF(BLANK_ENTRY()); setEditing(null); setErr(''); setView('form') }

  const openEdit = r => {
    setF({
      date: r.date ? String(r.date).slice(0, 10) : today(),
      reference: r.reference || '', description: r.description || '',
      assetId: r.assetId ?? '', amount: r.amount ?? '',
    })
    setEditing(r); setErr(''); setView('form')
  }

  // When an asset is selected, automatically fill in the suggested monthly straight-line amount if the amount field is empty
  const pickAsset = id => {
    const a = assetOf(id)
    const suggested = a ? monthlyAmount(a) : 0
    setF({
      ...f,
      assetId: id,
      amount: f.amount === '' && suggested ? String(suggested) : f.amount
    })
  }

  const save = async addAnother => {
    if (!f.date) return setErr('Date is required')
    if (!f.assetId) return setErr('Please select a fixed asset')
    if (n(f.amount) <= 0) return setErr('Amount must be greater than zero')

    // The entry cannot reduce the asset below zero.
    // When editing, the entry's own old amount is added back (only if it is for the same asset).
    const a = assetOf(f.assetId)
    const own = editing && String(editing.assetId) === String(f.assetId) ? n(editing.amount) : 0
    if (a && n(f.amount) > bookValue(a) + own) {
      return setErr(`Amount cannot be more than the asset's book value (${money(bookValue(a) + own)})`)
    }

    const body = {
      date: f.date, reference: f.reference.trim(), description: f.description.trim(),
      assetId: Number(f.assetId), amount: n(f.amount),
    }

    try {
      if (editing) await api('/depreciation/' + editing.id, { method: 'PUT', body })
      else await api('/depreciation', { method: 'POST', body })

      reload()

      if (addAnother && !editing) {
        setF(BLANK_ENTRY())
        setErr('')
      } else {
        setView('list')
      }
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete depreciation entry ${r.reference || '#' + r.id}?`)) return

    try {
      await api('/depreciation/' + r.id, { method: 'DELETE' })
      setErr('')
      reload()
    } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') {
    const a = assetOf(f.assetId)

    return (<>
      <Title hint="Record a decrease in the asset's book value.">
        {editing ? 'Edit Depreciation Entry' : 'New Depreciation Entry'}
      </Title>

      <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-2xl">
        <div className="flex flex-wrap gap-4">
          <Field label="Date">
            <input type="date" className={inp} value={f.date} onChange={e => set({ date: e.target.value })} />
          </Field>

          <Field label="Reference">
            <input className={inp} placeholder="Optional" value={f.reference} onChange={e => set({ reference: e.target.value })} />
          </Field>
        </div>

        <Field label="Description">
          <input className={inp} placeholder="Optional" value={f.description} onChange={e => set({ description: e.target.value })} />
        </Field>

        <Field label="Fixed asset">
          <select className={inp} value={f.assetId} onChange={e => pickAsset(e.target.value)}>
            <option value="">Select fixed asset</option>
            {(assets || []).map(x => <option key={x.id} value={x.id}>{x.code ? x.code + ' - ' : ''}{x.name}</option>)}
          </select>
        </Field>

        {a && (
          <p className="text-sm text-ink/70">
            Cost {money(a.cost)} | Accumulated {money(a.accumulated)} | Book value{' '}
            <span className="font-semibold">{money(bookValue(a))}</span>
          </p>
        )}

        <Field label="Amount" className="max-w-xs">
          <input type="number" min="0" className={inp + ' text-right'} value={f.amount} onChange={e => set({ amount: e.target.value })} />
        </Field>

        <Err e={err} />

        <div className="flex gap-2">
          <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
          {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
          <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
        </div>
      </section>
    </>)
  }

  // ---------- List view ----------
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.reference, r.description, r.assetName].join(' ').toLowerCase().includes(q))

  return (<>
    <Title
      hint="Each entry reduces the asset's book value."
      right={<Btn onClick={openNew}>New Depreciation Entry</Btn>}
    >
      Depreciation Entries
    </Title>

    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />

    <Err e={err} />
    <div className="mt-2" />

    <Table
      cols={[
        ['Date', r => fmtDate(r.date)],
        ['Reference', r => r.reference],
        ['Fixed asset', r => r.assetName || assetOf(r.assetId)?.name],
        ['Description', r => r.description],
        ['Amount', r => money(r.amount), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No depreciation entries yet. Click New Depreciation Entry to add one."
    />
  </>)
}