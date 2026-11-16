// src/Transfers.jsx
// Inter Account Transfers and Bank Reconciliations (Manager.io style).
// API (built in server/src/banking.js):
//   GET/POST/PUT/DELETE /transfers
//        record: { id, number, date, reference, description, amount, fromId, toId, from: {name}, to: {name} }
//   GET/POST/DELETE     /reconciliations
//        record: { id, date, statementBalance, bankId, bankAccount: {name} }
//   GET /bank-accounts/:id/lines
//        -> uncleared lines: [{ id, date, memo, amount }]  (amount is + for money in, - for money out)
//   GET /bank-accounts -> [{ id, name, balance, clearedBalance, ... }]
import { useEffect, useState } from 'react'
import { api } from './api'
import { useLoad, money, fmtDate, today, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// =====================================================
// Inter Account Transfers: move money between two of the company's own accounts
// =====================================================
export function Transfers() {
  const [rows, reload] = useLoad('/transfers')
  const [banks, reloadBanks] = useLoad('/bank-accounts')

  const blank = () => ({ date: today(), reference: '', description: '', fromId: '', amount: '', toId: '' })
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false) // stops a double click from saving twice

  const set = patch => setF({ ...f, ...patch })

  // Bank list is reloaded so a bank account added on the other page shows up here
  const openNew = () => { reloadBanks(); setF(blank()); setEditing(null); setErr(''); setView('form') }
  const openEdit = r => {
    reloadBanks()
    setF({
      date: String(r.date).slice(0, 10), reference: r.reference || '', description: r.description || '',
      fromId: String(r.fromId ?? r.from?.id ?? ''), amount: r.amount ?? '', toId: String(r.toId ?? r.to?.id ?? ''),
    })
    setEditing(r); setErr(''); setView('form')
  }

  const save = async addAnother => {
    if (saving) return
    if (!f.fromId || !f.toId) return setErr('Choose both accounts')
    if (f.fromId === f.toId) return setErr('The two accounts must be different')
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount above zero')
    const body = { date: f.date, reference: f.reference, description: f.description, fromId: +f.fromId, toId: +f.toId, amount: Number(f.amount) }
    setSaving(true)
    try {
      if (editing) await api('/transfers/' + editing.id, { method: 'PUT', body })
      else await api('/transfers', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(blank()); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const remove = async r => {
    if (!confirm(`Delete transfer ${r.number || ''}?`)) return
    try { await api('/transfers/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form ----------
  if (view === 'form') return (<>
    <Title hint="Moves money between two of your own accounts.">{editing ? 'Edit Inter Account Transfer' : 'New Inter Account Transfer'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><input className={inp} type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Reference (optional)"><input className={inp} value={f.reference} onChange={e => set({ reference: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea className={inp} rows={2} value={f.description} onChange={e => set({ description: e.target.value })} /></Field>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Paid from">
          <select className={inp} value={f.fromId} onChange={e => set({ fromId: e.target.value })}>
            <option value="">Choose account</option>{banks?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Amount"><input className={inp} type="number" min="0" step="0.01" value={f.amount} onChange={e => set({ amount: e.target.value })} /></Field>
        <Field label="Received in">
          <select className={inp} value={f.toId} onChange={e => set({ toId: e.target.value })}>
            <option value="">Choose account</option>{banks?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List ----------
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.number, r.reference, r.description, r.from?.name, r.to?.name].join(' ').toLowerCase().includes(q))
  return (<>
    <Title hint="Money moved between your own accounts." right={<Btn onClick={openNew}>New Inter Account Transfer</Btn>}>Inter Account Transfers</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Date', r => fmtDate(r.date)],
        ['Ref', r => r.reference || r.number],
        ['Description', r => r.description],
        ['Paid from', r => r.from?.name],
        ['Received in', r => r.to?.name],
        ['Amount', r => money(r.amount), 1],
        ['Actions', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>
          </span>
        )],
      ]}
      rows={shown}
      empty="No transfers yet. Click New Inter Account Transfer to add one."
    />
  </>)
}

// =====================================================
// Bank Reconciliations: match the books to the bank statement
// =====================================================
export function Reconciliations() {
  const [rows, reload] = useLoad('/reconciliations')
  const [banks, reloadBanks] = useLoad('/bank-accounts')

  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState({ date: today(), bankId: '', statementBalance: '' })
  const [lines, setLines] = useState([])   // uncleared lines of the chosen account
  const [ticked, setTicked] = useState([]) // ids of lines ticked as cleared
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const set = patch => setF({ ...f, ...patch })

  // Loads the uncleared lines whenever the bank account changes
  useEffect(() => {
    setTicked([])
    if (!f.bankId) return setLines([])
    api(`/bank-accounts/${f.bankId}/lines`).then(setLines).catch(e => { setLines([]); setErr(e.message) })
  }, [f.bankId])

  const toggle = id => setTicked(ticked.includes(id) ? ticked.filter(x => x !== id) : [...ticked, id])

  // Lines cleared in earlier reconciliations + the ones ticked now
  const before = Number(banks?.find(b => String(b.id) === String(f.bankId))?.clearedBalance || 0)
  const cleared = before + lines.filter(l => ticked.includes(l.id)).reduce((s, l) => s + Number(l.amount), 0)
  const diff = f.statementBalance === '' ? null : Math.round((Number(f.statementBalance) - cleared) * 100) / 100

  // Bank list is reloaded so the cleared balance is up to date
  const openNew = () => { reloadBanks(); setF({ date: today(), bankId: '', statementBalance: '' }); setLines([]); setTicked([]); setErr(''); setView('form') }

  const save = async () => {
    if (saving) return
    if (!f.bankId) return setErr('Choose a bank account')
    if (f.statementBalance === '') return setErr('Enter the statement balance')
    if (!ticked.length) return setErr('Tick at least one transaction')
    setSaving(true)
    try {
      await api('/reconciliations', { method: 'POST', body: { date: f.date, bankId: +f.bankId, statementBalance: Number(f.statementBalance), lineIds: ticked } })
      reload(); reloadBanks(); setView('list'); setErr('')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const remove = async r => {
    if (!confirm('Delete this reconciliation? Its lines become uncleared again.')) return
    try { await api('/reconciliations/' + r.id, { method: 'DELETE' }); setErr(''); reload(); reloadBanks() } catch (e) { setErr(e.message) }
  }

  // ---------- Form ----------
  if (view === 'form') return (<>
    <Title hint="Tick each line that appears on your bank statement, then enter the statement's closing balance.">New Bank Reconciliation</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-4xl">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Date (statement date)"><input className={inp} type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Bank account">
          <select className={inp} value={f.bankId} onChange={e => set({ bankId: e.target.value })}>
            <option value="">Choose account</option>{banks?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Statement balance"><input className={inp} type="number" step="0.01" value={f.statementBalance} onChange={e => set({ statementBalance: e.target.value })} /></Field>
      </div>

      {f.bankId && (<>
        <Table
          cols={[
            ['Cleared', l => <input type="checkbox" aria-label="Cleared" checked={ticked.includes(l.id)} onChange={() => toggle(l.id)} />],
            ['Date', l => fmtDate(l.date)],
            ['Memo', l => l.memo],
            ['Money in', l => Number(l.amount) > 0 ? money(l.amount) : '', 1],
            ['Money out', l => Number(l.amount) < 0 ? money(-l.amount) : '', 1],
          ]}
          rows={lines} empty="No uncleared transactions for this account."
        />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>Cleared before: <b>{money(before)}</b></span>
          <span>Ticked as cleared: <b>{money(cleared - before)}</b></span>
          {diff !== null && (
            <span className={'font-medium ' + (Math.abs(diff) < 0.005 ? 'text-green-700' : 'text-red-700')}>
              {Math.abs(diff) < 0.005 ? 'Reconciled. Your books match the bank.' : `Difference of ${money(diff)}. Check for missing or unticked lines.`}
            </span>
          )}
        </div>
      </>)}

      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={save}>{saving ? 'Saving...' : 'Create'}</Btn>
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List ----------
  return (<>
    <Title hint="Matches your books to the bank statement." right={<Btn onClick={openNew}>New Bank Reconciliation</Btn>}>Bank Reconciliations</Title>
    <Err e={err} />
    <Table
      cols={[
        ['Date', r => fmtDate(r.date)],
        ['Bank account', r => r.bankAccount?.name],
        ['Statement balance', r => money(r.statementBalance), 1],
        ['Actions', r => <button className="text-red-700 font-medium" onClick={() => remove(r)}>Delete</button>],
      ]}
      rows={rows}
      empty="No reconciliations yet. Click New Bank Reconciliation to start one."
    />
  </>)
}