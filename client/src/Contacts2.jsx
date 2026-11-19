// src/Contacts2.jsx
// Customers and Suppliers (Manager.io style): list with document counts and payment status, plus a full form.
// Uses the same /contacts endpoint as the old pages in pages.jsx, so existing data still shows.
// Expected API (new parts to be built later):
//   GET    /contacts?type=customer|supplier
//          -> [{ id, name, code, phone, email, creditLimit, billingAddress, deliveryAddress, dueDays,
//                balance, overdue, counts: { receipts, payments, quotes, orders, invoices, deliveryNotes, goodsReceipts } }]
//   POST   /contacts       -> create (body includes type)
//   PUT    /contacts/:id   -> update
//   DELETE /contacts/:id   -> delete
import { useState } from 'react'
import { api } from './api'
import { useLoad, money, Btn, BtnLight, Badge, Title, Err, Field, Table, inp } from './ui'

// What differs between the two pages
const KINDS = {
  customer: {
    title: 'Customers', one: 'Customer', hint: 'People who buy from you and what they still owe.',
    // Count columns shown in the list: [label, key in counts]
    counts: [['Quotes', 'quotes'], ['Orders', 'orders'], ['Invoices', 'invoices'], ['Receipts', 'receipts']],
    balanceLabel: 'Accounts receivable',
  },
  supplier: {
    title: 'Suppliers', one: 'Supplier', hint: 'People you buy from and what you still owe.',
    counts: [['Payments', 'payments'], ['Quotes', 'quotes'], ['Orders', 'orders'], ['Invoices', 'invoices']],
    balanceLabel: 'Accounts payable',
  },
}

// Empty form values
const BLANK = { name: '', code: '', phone: '', email: '', creditLimit: '', billingAddress: '', deliveryAddress: '', dueDays: '' }

// Paid / Unpaid / Overdue badge worked out from the balance and the overdue amount
const statusOf = r => {
  if (Number(r.balance) < -0.005) return <Badge tone="gold">Overpaid</Badge>
  if (Number(r.overdue) > 0) return <Badge tone="red">Overdue</Badge>
  if (Number(r.balance) > 0) return <Badge tone="gold">Unpaid</Badge>
  return <Badge tone="green">Paid</Badge>
}

function ContactsPage({ type }) {
  const k = KINDS[type]
  const cust = type === 'customer'

  const [rows, reload] = useLoad('/contacts?type=' + type)
  const [view, setView] = useState('list') // 'list' | 'form'
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  // Optional fields: shown only when ticked (like Manager.io)
  const [showLimit, setShowLimit] = useState(false)
  const [showTerms, setShowTerms] = useState(false)

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF(BLANK); setEditing(null); setShowLimit(false); setShowTerms(false); setErr(''); setView('form') }

  const openEdit = r => {
    setF({
      name: r.name || '', code: r.code || '', phone: r.phone || '', email: r.email || '',
      creditLimit: r.creditLimit ?? '', billingAddress: r.billingAddress || '', deliveryAddress: r.deliveryAddress || '', dueDays: r.dueDays ?? '',
    })
    setShowLimit(r.creditLimit != null && r.creditLimit !== '')
    setShowTerms(r.dueDays != null && r.dueDays !== '')
    setEditing(r); setErr(''); setView('form')
  }

  // Saves the form. addAnother = true keeps a fresh form open (new records only).
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Name is required')
    // Hidden optional fields are sent as null so they are cleared on the server
    const body = {
      type, name: f.name.trim(), code: f.code.trim(), phone: f.phone.trim(), email: f.email.trim(),
      billingAddress: f.billingAddress, deliveryAddress: cust ? f.deliveryAddress : '',
      creditLimit: showLimit ? Number(f.creditLimit) || 0 : null,
      dueDays: cust && showTerms ? Number(f.dueDays) || 0 : null,
    }
    try {
      if (editing) await api('/contacts/' + editing.id, { method: 'PUT', body })
      else await api('/contacts', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(BLANK); setShowLimit(false); setShowTerms(false); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api('/contacts/' + r.id, { method: 'DELETE' }); setErr(''); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint={k.hint}>{editing ? `Edit ${k.one}` : `New ${k.one}`}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Code (optional)"><input className={inp} value={f.code} onChange={e => set({ code: e.target.value })} /></Field>
        <Field label="Phone"><input className={inp} value={f.phone} onChange={e => set({ phone: e.target.value })} /></Field>
        <Field label="Email (for sending documents)"><input className={inp} type="email" value={f.email} onChange={e => set({ email: e.target.value })} /></Field>
      </div>

      {/* Customers have two address boxes, suppliers have one */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={cust ? 'Billing address' : 'Address'}>
          <textarea className={inp} rows={3} value={f.billingAddress} onChange={e => set({ billingAddress: e.target.value })} />
        </Field>
        {cust && (
          <Field label="Delivery address">
            <textarea className={inp} rows={3} value={f.deliveryAddress} onChange={e => set({ deliveryAddress: e.target.value })} />
          </Field>
        )}
      </div>

      {/* Optional fields */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showLimit} onChange={e => setShowLimit(e.target.checked)} />Credit limit
      </label>
      {showLimit && <Field label="Credit limit"><input className={inp + ' max-w-xs'} type="number" min="0" value={f.creditLimit} onChange={e => set({ creditLimit: e.target.value })} /></Field>}

      {cust && (<>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showTerms} onChange={e => setShowTerms(e.target.checked)} />Autofill - Sales Invoice - Due date
        </label>
        {showTerms && (
          <Field label="Payment terms: due in (days)">
            <input className={inp + ' max-w-xs'} type="number" min="0" value={f.dueDays} onChange={e => set({ dueDays: e.target.value })} />
          </Field>
        )}
      </>)}

      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- List view ----------
  // Search matches name, code, phone and email
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => [r.name, r.code, r.phone, r.email].join(' ').toLowerCase().includes(q))

  return (<>
    <Title hint={k.hint} right={<Btn onClick={openNew}>New {k.one}</Btn>}>{k.title}</Title>
    <input className={inp + ' max-w-xs mb-4'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        ['Name', r => r.name],
        ['Phone', r => r.phone],
        // One column per document count (shows 0 when the server sends nothing)
        ...k.counts.map(([label, key]) => [label, r => r.counts?.[key] ?? 0, 1]),
        [k.balanceLabel, r => (
          <span className={r.creditLimit != null && Number(r.balance) > Number(r.creditLimit) ? 'text-red-700 font-semibold' : ''}>
            {money(r.balance)}
          </span>
        ), 1],
        ['Status', r => statusOf(r)],
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

// The two pages used by the router
export const Customers = () => <ContactsPage type="customer" />
export const Suppliers = () => <ContactsPage type="supplier" />