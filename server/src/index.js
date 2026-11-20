import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { PrismaClient } from '@prisma/client'
import banking from './banking.js'
import projects from './projects.js'
import employees from './employees.js'
import payroll from './payroll.js'
import expenses from './expenses.js'
import sales from './sales.js' 
import purchase from './purchase.js'
import assets from './assets.js'
import accounting from './accounting.js'
import reports from './reports.js' 
import managerImport from './manager/routes.js'

const prisma = new PrismaClient()
const app = express()
app.set('trust proxy', 1) // Render sits behind a proxy; rate limit uses the real visitor IP
app.use(cors()); app.use(express.json({ limit: '2mb' })) // allows the payslip logo

// Small helpers
const N = v => Number(v || 0)
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100 // round money to 2 decimals
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e }

// Runs a route and turns errors into clean JSON responses
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code === 'P2002') e = Object.assign(new Error('This value already exists (duplicate email or code)'), { status: 409 })
  // record not found (update/delete of an id that does not exist)
  if (e.code === 'P2025') e = Object.assign(new Error('Record not found'), { status: 404 })
  // record is still referenced by other records
  if (e.code === 'P2003') e = Object.assign(new Error('This record is used by other records and cannot be deleted'), { status: 409 })
  if (!e.status) console.error(e)
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong on the server' })
})

const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Please sign in again' }) }
}
const accId = async (tx, code) => (await tx.account.findUniqueOrThrow({ where: { code } })).id

// Posts a balanced journal entry. Throws if debits != credits.
async function post(tx, { date, memo, ref, lines }) {
  const rows = lines.filter(l => l.debit || l.credit)
  const d = rows.reduce((s, l) => s + (l.debit || 0), 0), c = rows.reduce((s, l) => s + (l.credit || 0), 0)
  if (Math.abs(d - c) > 0.005) fail('Debit and credit must be equal')
  const data = await Promise.all(rows.map(async l => ({ accountId: l.accountId || await accId(tx, l.code), debit: l.debit || 0, credit: l.credit || 0 })))
  return tx.journal.create({ data: { date: new Date(date || Date.now()), memo, ref, lines: { create: data } } })
}

// ---- Helpers for contacts and items ----
const CONTACT_TYPES = ['customer', 'supplier']
// Who may use which kind of contact: customers = admin, accountant, sales. Suppliers = admin, accountant.
const canContact = (role, type) => type === 'customer' ? ['admin', 'accountant', 'sales'].includes(role) : ['admin', 'accountant'].includes(role)
// Empty values ('' / undefined) become null
const orNull = v => (v === undefined || v === null || v === '' ? null : v)
// Turns the request body into the fields saved on a contact
const contactData = b => ({
  name: String(b.name || '').trim(),
  phone: orNull(b.phone), email: orNull(b.email),
  code: orNull(b.code), billingAddress: orNull(b.billingAddress), deliveryAddress: orNull(b.deliveryAddress),
  creditLimit: orNull(b.creditLimit) === null ? null : Math.max(0, +b.creditLimit || 0),
  dueDays: orNull(b.dueDays) === null ? null : Math.max(0, Math.round(+b.dueDays || 0)),
})

const VALUATION = ['First in, first out', 'Average cost']
// Turns the request body into the fields saved on an item.
// The new names (unitName, purchasePrice, salesPrice) win; the old names (unit, cost, price) still work.
const itemData = b => ({
  name: String(b.name || '').trim(),
  unit: String(b.unitName ?? b.unit ?? '').trim() || 'pcs',
  cost: Math.max(0, +(b.purchasePrice ?? b.cost) || 0),
  price: Math.max(0, +(b.salesPrice ?? b.price) || 0),
  description: String(b.description || '').trim(),
  valuationMethod: VALUATION.includes(b.valuationMethod) ? b.valuationMethod : VALUATION[0],
  customIncomeAccountId: orNull(b.customIncomeAccountId) === null ? null : +b.customIncomeAccountId,
  customExpenseAccountId: orNull(b.customExpenseAccountId) === null ? null : +b.customExpenseAccountId,
  lineDescription: String(b.lineDescription || '').trim(),
  salesDivision: String(b.salesDivision || '').trim(),
  hideName: !!b.hideName,
})
// The custom accounts must exist and be an income / expense account
async function checkItemAccounts(d) {
  for (const [id, type, label] of [[d.customIncomeAccountId, 'income', 'income'], [d.customExpenseAccountId, 'expense', 'expense']]) {
    if (id === null) continue
    const a = await prisma.account.findUnique({ where: { id } })
    if (!a || a.type !== type) fail(`Choose a valid ${label} account`)
  }
}
// Adds the field names the new Inventory page expects (the old names stay too)
const itemOut = i => ({ ...i, unitName: i.unit, purchasePrice: i.cost, salesPrice: i.price, qtyOnHand: i.qty, averageCost: i.cost,
  qtyToDeliver: 0, qtyToReceive: 0 }) // become real numbers once sales and purchase orders exist

// Stock figures like Manager's Inventory Items page.
// Invoices and bills made by hand already change item.qty, so only documents that never moved stock are counted here.
//   to deliver = sales invoice qty - delivery note qty        to receive = purchase invoice qty - goods receipt qty
//   on hand = item.qty + goods receipt qty - delivery note qty
//   available = on hand - to deliver - sales order qty
//   total cost = value of the units left in stock (newest purchases first), average cost = total cost / units left
// Imported lines keep Manager's real quantity in stockQty (qty may have been collapsed to 1), so stockQty is used when it is set.
async function withStock(items) {
  const ids = items.map(i => i.id)
  const [invLines, docLines, moves] = await Promise.all([
    prisma.invoiceLine.findMany({ where: { itemId: { in: ids }, invoice: { status: 'active' } },
      select: { id: true, itemId: true, qty: true, stockQty: true, price: true, discount: true, invoice: { select: { number: true, kind: true, date: true } } } }),
    prisma.salesDocLine.findMany({ where: { itemId: { in: ids }, doc: { kind: { in: ['delivery', 'order', 'greceipt'] } } },
      select: { itemId: true, qty: true, stockQty: true, doc: { select: { kind: true } } } }),
    prisma.stockMove.findMany({ select: { ref: true }, distinct: ['ref'] })])
  const moved = new Set(moves.map(m => m.ref))
  const s = new Map(ids.map(id => [id, { sold: 0, bought: 0, layers: [], delivered: 0, ordered: 0, received: 0 }]))
  for (const l of invLines) {
    const t = s.get(l.itemId), qty = N(l.stockQty ?? l.qty), pending = !moved.has(l.invoice.number)
    if (l.invoice.kind === 'sale') { if (pending) t.sold += qty }
    else if (l.invoice.kind === 'purchase') {
      // the amount of the line stays qty x price (the real amount); only the stock quantity uses stockQty
      t.layers.push({ date: new Date(l.invoice.date).getTime(), id: l.id, qty, cost: N(l.qty) * N(l.price) * (1 - N(l.discount) / 100) })
      if (pending) t.bought += qty
    }
  }
  for (const l of docLines) {
    const t = s.get(l.itemId), qty = N(l.stockQty ?? l.qty)
    if (l.doc.kind === 'delivery') t.delivered += qty; else if (l.doc.kind === 'order') t.ordered += qty; else t.received += qty
  }
  return items.map(i => {
    const t = s.get(i.id)
    const toDeliver = t.sold - t.delivered, toReceive = t.bought - t.received
    const onHand = i.qty + t.received - t.delivered
    const net = onHand + toReceive - toDeliver
    let total = 0, left = net
    for (const p of t.layers.sort((a, b) => b.date - a.date || b.id - a.id)) {
      if (left <= 0) break
      const take = Math.min(p.qty, left); total += p.cost * take / p.qty; left -= take
    }
    return { ...itemOut(i), qtyToDeliver: toDeliver, qtyToReceive: toReceive, qtyOnHand: onHand,
      qtyAvailable: onHand - Math.max(toDeliver, 0) - t.ordered,
      averageCost: net > 0 && total ? r2(total / net) : 0, totalCost: net > 0 ? r2(total) : 0 }
  })
}

// Roles: admin (everything), accountant (accounts modules, no leads), sales (leads, customers, sales documents)
// Sales quotes, orders, delivery notes and sales invoices are open to all three roles.
// Only admin and accountant may edit or delete a sales invoice (checked inside sales.js).
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/webhooks')) return next()
  auth(req, res, () => {
    const r = req.user.role, p = req.path, w = req.method !== 'GET', is = (...x) => x.includes(r)
    const deny = (p.startsWith('/users') && r !== 'admin')
      || (/^\/(reports|journal|bank|payments|receipts|transfers|reconciliations|employees|payslip|expense|purchase|goods-receipts|fixed-assets|depreciation|capital-accounts|special-accounts|investments)/.test(p) && !is('admin', 'accountant'))
      || (w && p.startsWith('/projects') && !is('admin', 'accountant'))
      || (w && p.startsWith('/items') && !is('admin', 'accountant'))
      || (p.startsWith('/leads') && !is('admin', 'sales'))
      || (w && p.startsWith('/invoices') && !is('admin', 'accountant', ...(req.body?.kind === 'purchase' ? [] : ['sales'])))
      || (w && p.startsWith('/quotes') && !is('admin', 'accountant', 'sales'))
      || (p.startsWith('/credit-notes') && !is('admin', 'accountant'))
    if (deny) return res.status(403).json({ error: 'Your role cannot do this' })
    next()
  })
})

// Auth & settings
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: { error: 'Too many failed logins. Try again in 15 minutes.' } })
app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { email: (req.body.email || '').toLowerCase() } })
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password))) fail('Email or password is wrong', 401)
  res.json({ token: jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '7d' }), name: u.name })
}))
app.get('/api/settings', auth, wrap(async (req, res) => res.json(await prisma.setting.findUniqueOrThrow({ where: { id: 1 } }))))
app.put('/api/settings', auth, wrap(async (req, res) => {
  if (req.user.role !== 'admin') fail('Only admins can change settings', 403)
  res.json(await prisma.setting.update({ where: { id: 1 }, data: { modules: req.body.modules } }))
}))

// ---- Contacts (customers / suppliers) with running balance
// Cancelled documents are left out of the balance (status: 'active' only)
// Also returns the new fields, document counts and "overdue" for the Customers / Suppliers pages
// status: 'overdue' (an invoice is past its due date), 'owes' (balance but not overdue) or 'clear'
app.get('/api/contacts', auth, wrap(async (req, res) => {
  const type = req.query.type
  if (!CONTACT_TYPES.includes(type)) fail('type must be customer or supplier')
  if (!canContact(req.user.role, type)) fail('Your role cannot do this', 403)
  const rows = await prisma.contact.findMany({ where: { type }, include: {
    invoices: { where: { status: 'active' }, select: { total: true, dueDate: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] },
    payments: { select: { amount: true, kind: true } },
    creditNotes: { select: { total: true } },
    _count: { select: { quotes: true } } }, orderBy: { name: 'asc' } })
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  res.json(rows.map(({ invoices, payments, creditNotes, _count, ...c }) => {
    const paid = payments.reduce((s, p) => s + N(p.amount), 0) + creditNotes.reduce((s, n) => s + N(n.total), 0)
    const balance = r2(invoices.reduce((s, i) => s + N(i.total), 0) - paid)
    // Payments and credit notes are applied to the oldest invoices first; what is left past its due date is overdue
    let credit = paid, overdue = 0
    for (const i of invoices) {
      const used = Math.min(credit, N(i.total)); credit -= used
      const left = r2(N(i.total) - used)
      if (left > 0.005 && i.dueDate && new Date(i.dueDate) < today) overdue += left
    }
    overdue = r2(overdue)
    return { ...c, balance, overdue,
      status: overdue > 0.005 ? 'overdue' : balance > 0.005 ? 'owes' : 'clear',
      counts: { quotes: _count.quotes, orders: 0, invoices: invoices.length,
        receipts: payments.filter(p => p.kind === 'receipt').length, payments: payments.filter(p => p.kind === 'payment').length } }
  }))
}))
// Saves the new fields too
app.post('/api/contacts', auth, wrap(async (req, res) => {
  if (!CONTACT_TYPES.includes(req.body.type)) fail('type must be customer or supplier')
  if (!canContact(req.user.role, req.body.type)) fail('Your role cannot do this', 403)
  const data = contactData(req.body)
  if (!data.name) fail('Name is required')
  res.json(await prisma.contact.create({ data: { type: req.body.type, ...data } }))
}))
// Edit a contact (the type cannot change)
app.put('/api/contacts/:id', auth, wrap(async (req, res) => {
  const c = await prisma.contact.findUnique({ where: { id: +req.params.id } })
  if (!c) fail('Contact not found', 404)
  if (!canContact(req.user.role, c.type)) fail('Your role cannot do this', 403)
  const data = contactData(req.body)
  if (!data.name) fail('Name is required')
  res.json(await prisma.contact.update({ where: { id: c.id }, data }))
}))
// Delete a contact, only when no document, payment or claim uses it (CHANGED: sales documents and expense claims are checked too)
app.delete('/api/contacts/:id', auth, wrap(async (req, res) => {
  const c = await prisma.contact.findUnique({ where: { id: +req.params.id },
    include: { _count: { select: { invoices: true, payments: true, quotes: true, creditNotes: true, salesDocs: true, expenseClaims: true } } } })
  if (!c) fail('Contact not found', 404)
  if (!canContact(req.user.role, c.type)) fail('Your role cannot do this', 403)
  if (Object.values(c._count).some(n => n > 0)) fail('This contact has documents or payments and cannot be deleted')
  await prisma.contact.delete({ where: { id: c.id } })
  res.json({ ok: true })
}))

// ---- Inventory items
// The list also returns the field names the new Inventory page expects, plus Manager-style stock figures
app.get('/api/items', auth, wrap(async (req, res) => res.json(await withStock(await prisma.item.findMany({ orderBy: { name: 'asc' } })))))
// Only the name is required now (no SKU), and the new fields are saved
app.post('/api/items', auth, wrap(async (req, res) => {
  const data = itemData(req.body)
  if (!data.name) fail('Item name is required')
  await checkItemAccounts(data)
  const sku = orNull(req.body.sku) === null ? null : String(req.body.sku).trim() // optional, kept for old data
  res.json((await withStock([await prisma.item.create({ data: { ...data, sku, minQty: Math.max(0, +req.body.minQty || 0) } })]))[0])
}))
// Edit an item. Stock quantity is not edited here: it only changes through invoices, bills and credit notes.
app.put('/api/items/:id', auth, wrap(async (req, res) => {
  const old = await prisma.item.findUnique({ where: { id: +req.params.id } })
  if (!old) fail('Item not found', 404)
  const data = itemData(req.body)
  if (!data.name) fail('Item name is required')
  await checkItemAccounts(data)
  res.json((await withStock([await prisma.item.update({ where: { id: old.id }, data })]))[0])
}))
// Delete an item, only when it has never been used (CHANGED: sales quote / order / delivery note lines are checked too)
app.delete('/api/items/:id', auth, wrap(async (req, res) => {
  const id = +req.params.id
  const item = await prisma.item.findUnique({ where: { id } })
  if (!item) fail('Item not found', 404)
  const used = await Promise.all([
    prisma.stockMove.count({ where: { itemId: id } }), prisma.invoiceLine.count({ where: { itemId: id } }),
    prisma.quoteLine.count({ where: { itemId: id } }), prisma.creditNoteLine.count({ where: { itemId: id } }),
    prisma.salesDocLine.count({ where: { itemId: id } })])
  if (used.some(n => n > 0) || item.qty !== 0) fail('This item is used in documents or has stock, so it cannot be deleted')
  await prisma.item.delete({ where: { id } })
  res.json({ ok: true })
}))

//  Sales invoices & purchase bills: document + stock + journal in ONE transaction
app.get('/api/invoices', auth, wrap(async (req, res) =>
  res.json(await prisma.invoice.findMany({ where: { kind: req.query.kind }, include: { contact: true, lines: true }, orderBy: { id: 'desc' }, take: 100 }))))

// Money still owed by (or to) a contact: active documents - payments - credit notes
async function balanceOf(tx, contactId) {
  const c = await tx.contact.findUnique({ where: { id: contactId }, include: {
    invoices: { where: { status: 'active' }, select: { total: true } },
    payments: { select: { amount: true } },
    creditNotes: { select: { total: true } } } })
  return c.invoices.reduce((s, i) => s + N(i.total), 0) - c.payments.reduce((s, p) => s + N(p.amount), 0) - c.creditNotes.reduce((s, n) => s + N(n.total), 0)
}

// Saves a sale invoice or purchase bill: document + stock + journal entry
async function createDoc(tx, body) {
  const { kind, contactId, date } = body
  const lines = (body.lines || []).filter(l => +l.qty > 0).map(l => ({ ...l, qty: +l.qty, price: +l.price }))
  if (!['sale', 'purchase'].includes(kind) || !lines.length || !contactId) fail('Choose a contact and add at least one line')
  // The counter includes cancelled documents, so numbers are never reused
  const number = (kind === 'sale' ? 'INV-' : 'BILL-') + String((await tx.invoice.count({ where: { kind } })) + 1).padStart(4, '0')
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), taxRate = Math.max(0, +body.taxRate || 0)
  const tax = Math.round(subtotal * taxRate) / 100, total = subtotal + tax
  const doc = await tx.invoice.create({ data: { number, kind, date: new Date(date || Date.now()), contactId: +contactId, total, tax, taxRate,
    lines: { create: lines.map(l => ({ itemId: l.itemId ? +l.itemId : null, description: l.description || '', qty: l.qty, price: l.price })) } } })
  let cogs = 0, stockAmt = 0
  for (const l of lines.filter(l => l.itemId)) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: +l.itemId } })
    const delta = kind === 'sale' ? -l.qty : l.qty
    if (item.qty + delta < 0) fail(`Not enough stock for ${item.name} (${item.qty} left)`)
    await tx.item.update({ where: { id: item.id }, data: { qty: { increment: delta }, ...(kind === 'purchase' ? { cost: l.price } : {}) } })
    await tx.stockMove.create({ data: { itemId: item.id, qty: delta, ref: number } })
    if (kind === 'sale') cogs += l.qty * N(item.cost); else stockAmt += l.qty * l.price
  }
  const entry = kind === 'sale'
    ? [{ code: '1100', debit: total }, { code: '4000', credit: subtotal }, { code: '2100', credit: tax }, { code: '5000', debit: cogs }, { code: '1200', credit: cogs }]
    : [{ code: '1200', debit: stockAmt }, { code: '6000', debit: subtotal - stockAmt }, { code: '1300', debit: tax }, { code: '2000', credit: total }]
  await post(tx, { date, memo: number, ref: number, lines: entry })
  return doc
}

// Cancels a document: reverses stock, posts a reversing journal entry, marks it cancelled.
// Nothing is deleted, so the audit trail stays. Returns the original document.
async function cancelDoc(tx, id) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { lines: true } })
  if (!inv) fail('Document not found', 404)
  if (inv.status === 'cancelled') fail('This document is already cancelled')

  // Reverse stock (sale: put items back, purchase: take items out)
  for (const l of inv.lines.filter(l => l.itemId)) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } })
    const delta = inv.kind === 'sale' ? Number(l.qty) : -Number(l.qty)
    if (item.qty + delta < 0) fail(`Cannot cancel: stock for ${item.name} would go negative (${item.qty} in stock)`)
    await tx.item.update({ where: { id: item.id }, data: { qty: { increment: delta } } })
    await tx.stockMove.create({ data: { itemId: item.id, qty: delta, ref: inv.number + '-CANCEL' } })
  }

  // Post the original journal entry again with debit and credit swapped
  const orig = await tx.journal.findFirst({ where: { ref: inv.number }, include: { lines: true } })
  if (!orig) fail('Original journal entry not found')
  await post(tx, { date: new Date(), memo: 'Cancel ' + inv.number, ref: inv.number + '-CANCEL',
    lines: orig.lines.map(l => ({ accountId: l.accountId, debit: N(l.credit), credit: N(l.debit) })) })

  // Mark it cancelled (kept for the audit trail)
  await tx.invoice.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date() } })
  return inv
}

const PAID_MSG = 'Payments are already recorded against this contact, so this document cannot be changed'

// Save a new invoice or bill
app.post('/api/invoices', auth, wrap(async (req, res) => {
  res.json(await prisma.$transaction(tx => createDoc(tx, req.body)))
}))

// Cancel an invoice or bill
app.post('/api/invoices/:id/cancel', auth, wrap(async (req, res) => {
  if (!['admin', 'accountant'].includes(req.user.role)) fail('Only admins and accountants can cancel documents', 403)
  await prisma.$transaction(async tx => {
    const inv = await cancelDoc(tx, +req.params.id)
    // If the contact has already paid more than what is left, undo everything
    if (await balanceOf(tx, inv.contactId) < -0.005) fail(PAID_MSG)
  }, { timeout: 20000, maxWait: 10000 })
  res.json({ ok: true })
}))

// Edit = cancel the original + save the corrected document, in ONE transaction.
// The corrected document gets a new number; the original stays as "Cancelled".
app.put('/api/invoices/:id', auth, wrap(async (req, res) => {
  if (!['admin', 'accountant'].includes(req.user.role)) fail('Only admins and accountants can edit documents', 403)
  const doc = await prisma.$transaction(async tx => {
    const old = await cancelDoc(tx, +req.params.id)
    const doc = await createDoc(tx, { ...req.body, kind: old.kind }) // kind cannot change
    // Neither contact may end up with a negative balance because of payments already made
    for (const cid of new Set([old.contactId, doc.contactId])) if (await balanceOf(tx, cid) < -0.005) fail(PAID_MSG)
    return doc
  }, { timeout: 20000, maxWait: 10000 }) // edit runs many queries; the default 5s can be too short
  res.json(doc)
}))

// ---- Payments: receipt (customer pays us) / payment (we pay supplier)
app.post('/api/payments', auth, wrap(async (req, res) => {
  const { kind, contactId, date } = req.body, amount = r2(req.body.amount)
  if (!['receipt', 'payment'].includes(kind) || !(amount > 0)) fail('Enter an amount above zero')
  await prisma.$transaction(async tx => {
    // Balance due only counts active (not cancelled) documents
    const c = await tx.contact.findUnique({ where: { id: +contactId } })
    if (!c) fail('Contact not found', 404)
    const due = r2(await balanceOf(tx, +contactId))
    if (amount > due + 0.005) fail(`Amount is more than the balance due (Rs ${due.toFixed(2)})`)
    await tx.payment.create({ data: { kind, contactId: +contactId, amount, date: new Date(date || Date.now()) } })
    await post(tx, { date, memo: kind === 'receipt' ? 'Customer receipt' : 'Supplier payment',
      lines: kind === 'receipt' ? [{ code: '1000', debit: amount }, { code: '1100', credit: amount }] : [{ code: '2000', debit: amount }, { code: '1000', credit: amount }] })
  })
  res.json({ ok: true })
}))
// ---- Quotes: no stock or accounting effect until converted to a sales invoice
app.get('/api/quotes', auth, wrap(async (req, res) =>
  res.json(await prisma.quote.findMany({ include: { contact: true, lines: true }, orderBy: { id: 'desc' }, take: 100 }))))
app.post('/api/quotes', auth, wrap(async (req, res) => {
  const { contactId, date } = req.body
  const lines = (req.body.lines || []).filter(l => +l.qty > 0).map(l => ({ ...l, qty: +l.qty, price: +l.price }))
  if (!lines.length || !contactId) fail('Choose a customer and add at least one line')
  if (lines.some(l => !Number.isInteger(l.qty) || !Number.isFinite(l.price) || l.price < 0)) fail('Quantity must be a whole number and price must be zero or more')
  const quote = await prisma.$transaction(async tx => {
    const customer = await tx.contact.findUnique({ where: { id: +contactId } })
    if (!customer || customer.type !== 'customer') fail('Choose a valid customer')
    const number = 'QUO-' + String((await tx.quote.count()) + 1).padStart(4, '0')
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), taxRate = Math.max(0, +req.body.taxRate || 0)
    const tax = Math.round(subtotal * taxRate) / 100
    return tx.quote.create({ data: { number, date: new Date(date || Date.now()), contactId: +contactId, total: subtotal + tax, tax, taxRate,
      lines: { create: lines.map(l => ({ itemId: l.itemId ? +l.itemId : null, description: l.description || '', qty: l.qty, price: l.price })) } } })
  })
  res.json(quote)
}))
// Convert = create a real sales invoice from the quote (stock + journal) and mark the quote converted
app.post('/api/quotes/:id/convert', auth, wrap(async (req, res) => {
  const inv = await prisma.$transaction(async tx => {
    const q = await tx.quote.findUnique({ where: { id: +req.params.id }, include: { lines: true } })
    if (!q) fail('Quote not found', 404)
    if (q.status !== 'open') fail('This quote is already ' + q.status)
    const doc = await createDoc(tx, { kind: 'sale', contactId: q.contactId, taxRate: Number(q.taxRate),
      lines: q.lines.map(l => ({ itemId: l.itemId, description: l.description, qty: l.qty, price: Number(l.price) })) })
    await tx.quote.update({ where: { id: q.id }, data: { status: 'converted', invoiceId: doc.id } })
    return doc
  }, { timeout: 20000, maxWait: 10000 })
  res.json(inv)
}))
app.post('/api/quotes/:id/reject', auth, wrap(async (req, res) => {
  const q = await prisma.quote.findUnique({ where: { id: +req.params.id } })
  if (!q) fail('Quote not found', 404)
  if (q.status !== 'open') fail('This quote is already ' + q.status)
  await prisma.quote.update({ where: { id: q.id }, data: { status: 'rejected' } })
  res.json({ ok: true })
}))

// ---- Credit notes: reverse part or all of a sales invoice.
// Posts Dr Sales, Dr Sales Tax Payable, Cr Receivable (plus Dr Inventory, Cr COGS if goods come back).
app.get('/api/credit-notes', auth, wrap(async (req, res) =>
  res.json(await prisma.creditNote.findMany({ include: { contact: true, invoice: true, lines: true }, orderBy: { id: 'desc' }, take: 100 }))))
app.post('/api/credit-notes', auth, wrap(async (req, res) => {
  const lines = (req.body.lines || []).map(l => ({ ...l, qty: Number(l.qty), price: Number(l.price) })).filter(l => l.qty > 0)
  if (!lines.length) fail('Add at least one line with a quantity above zero')
  if (lines.some(l => !Number.isInteger(l.qty) || !Number.isFinite(l.price) || l.price < 0)) fail('Quantity must be a whole number and price must be zero or more')
  const restock = !!req.body.restock
  const note = await prisma.$transaction(async tx => {
    const inv = await tx.invoice.findUnique({ where: { id: +req.body.invoiceId }, include: { lines: true, creditNotes: { include: { lines: true } } } })
    if (!inv || inv.kind !== 'sale') fail('Choose a sales invoice')
    if (inv.status !== 'active') fail('This invoice is cancelled')
    // Never credit more of an item than was invoiced (minus earlier credit notes)
    for (const l of lines.filter(l => l.itemId)) {
      const invoiced = inv.lines.filter(x => x.itemId === +l.itemId).reduce((s, x) => s + Number(x.qty), 0)
      const credited = inv.creditNotes.flatMap(n => n.lines).filter(x => x.itemId === +l.itemId).reduce((s, x) => s + Number(x.qty), 0)
      if (l.qty > invoiced - credited) fail(`Cannot credit more than was invoiced (${invoiced - credited} left for this item)`)
    }
    const taxRate = N(inv.taxRate)
    const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.price, 0)), tax = r2(subtotal * taxRate / 100), total = r2(subtotal + tax)
    const left = r2(N(inv.total) - inv.creditNotes.reduce((s, n) => s + N(n.total), 0))
    if (total > left + 0.005) fail(`Credit note is more than the invoice balance (Rs ${left.toFixed(2)} left to credit)`)
    const number = 'CN-' + String((await tx.creditNote.count()) + 1).padStart(4, '0')
    const doc = await tx.creditNote.create({ data: { number, date: new Date(req.body.date || Date.now()), contactId: inv.contactId, invoiceId: inv.id,
      total, tax, taxRate, restock, reason: String(req.body.reason || '').slice(0, 200),
      lines: { create: lines.map(l => ({ itemId: l.itemId ? +l.itemId : null, description: l.description || '', qty: l.qty, price: l.price })) } } })
    // Goods came back: add stock and reverse the cost of goods sold (uses the item's current cost)
    let cogs = 0
    if (restock) for (const l of lines.filter(l => l.itemId)) {
      const item = await tx.item.findUniqueOrThrow({ where: { id: +l.itemId } })
      await tx.item.update({ where: { id: item.id }, data: { qty: { increment: l.qty } } })
      await tx.stockMove.create({ data: { itemId: item.id, qty: l.qty, ref: number } })
      cogs += l.qty * N(item.cost)
    }
    cogs = r2(cogs)
    await post(tx, { date: req.body.date, memo: number, ref: number, lines: [
      { code: '4000', debit: subtotal }, { code: '2100', debit: tax }, { code: '1100', credit: total },
      { code: '1200', debit: cogs }, { code: '5000', credit: cogs }] })
    return doc
  }, { timeout: 20000, maxWait: 10000 })
  res.json(note)
}))

// ---- Journal & reports
app.get('/api/journal', auth, wrap(async (req, res) =>
  res.json(await prisma.journal.findMany({ include: { lines: { include: { account: true } } }, orderBy: { id: 'desc' }, take: 50 }))))
app.post('/api/journal', auth, wrap(async (req, res) => { await prisma.$transaction(tx => post(tx, req.body)); res.json({ ok: true }) }))
// Account balances. If asOf (YYYY-MM-DD) is given, only entries up to the end of that day count.
async function balances(asOf) {
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail('Date must look like 2026-11-14')
  const where = asOf ? { journal: { date: { lte: new Date(asOf + 'T23:59:59.999Z') } } } : {}
  const [accounts, sums] = await Promise.all([
    prisma.account.findMany({ orderBy: { code: 'asc' } }),
    prisma.journalLine.groupBy({ by: ['accountId'], where, _sum: { debit: true, credit: true } })])
  return accounts.map(a => { const s = sums.find(x => x.accountId === a.id)?._sum || {}; return { ...a, debit: N(s.debit), credit: N(s.credit) } })
}
app.get('/api/reports/trial-balance', auth, wrap(async (req, res) => res.json(await balances(req.query.asOf))))
app.get('/api/reports/pnl', auth, wrap(async (req, res) => {
  const b = await balances(req.query.asOf)
  const income = b.filter(a => a.type === 'income').reduce((s, a) => s + a.credit - a.debit, 0)
  const expense = b.filter(a => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0)
  res.json({ income, expense, profit: income - expense })
}))

// Balance sheet: Assets = Liabilities + Equity + current profit
app.get('/api/reports/balance-sheet', auth, wrap(async (req, res) => {
  const b = await balances(req.query.asOf)
  // Groups accounts by the first digit of the code; "sign" decides which side is positive
  const group = (digit, sign) => b.filter(a => a.code.startsWith(digit))
    .map(a => ({ code: a.code, name: a.name, amount: r2(sign * (a.debit - a.credit)) }))
    .filter(a => a.amount !== 0)
  const assets = group('1', 1), liabilities = group('2', -1), equity = group('3', -1)
  const income = b.filter(a => a.type === 'income').reduce((s, a) => s + a.credit - a.debit, 0)
  const expense = b.filter(a => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0)
  const profit = r2(income - expense)
  const sum = rows => r2(rows.reduce((s, a) => s + a.amount, 0))
  const totalAssets = sum(assets), totalLE = r2(sum(liabilities) + sum(equity) + profit)
  res.json({ assets, liabilities, equity, profit, totalAssets, totalLiabilitiesEquity: totalLE, balanced: Math.abs(totalAssets - totalLE) < 0.005 })
}))

// Aging: what each customer (kind=sale) or supplier (kind=purchase) still owes, by invoice age.
// Payments and credit notes are applied to the oldest invoices first.
app.get('/api/reports/aging', auth, wrap(async (req, res) => {
  const sale = req.query.kind !== 'purchase'
  const contacts = await prisma.contact.findMany({
    where: { type: sale ? 'customer' : 'supplier' },
    include: {
      invoices: { where: { status: 'active' }, orderBy: [{ date: 'asc' }, { id: 'asc' }] },
      payments: { select: { amount: true } },
      creditNotes: { select: { total: true } } },
    orderBy: { name: 'asc' } })
  const now = Date.now(), rows = []
  for (const c of contacts) {
    // Money already received/paid or credited, used up against the oldest invoices
    let credit = c.payments.reduce((s, p) => s + N(p.amount), 0) + c.creditNotes.reduce((s, n) => s + N(n.total), 0)
    const row = { id: c.id, name: c.name, current: 0, d30: 0, d60: 0, d90: 0, total: 0 }
    for (const i of c.invoices) {
      const used = Math.min(credit, N(i.total)); credit -= used
      const left = r2(N(i.total) - used)
      if (left <= 0.005) continue
      const days = Math.floor((now - new Date(i.date).getTime()) / 86400000)
      const bucket = days <= 30 ? 'current' : days <= 60 ? 'd30' : days <= 90 ? 'd60' : 'd90'
      row[bucket] = r2(row[bucket] + left); row.total = r2(row.total + left)
    }
    if (row.total > 0) rows.push(row)
  }
  res.json(rows)
}))

// ---- Leads pipeline
const STAGES = ['New', 'Contacted', 'Qualified', 'Quotation', 'Won', 'Lost']
const LEAD_INCLUDE = { assignedTo: { select: { id: true, name: true } } } // shows who a lead is assigned to

// Admin sees every lead. A sales user sees only the leads assigned to them.
const leadScope = req => (req.user.role === 'admin' ? {} : { assignedToId: req.user.id })

// Loads one lead that this person is allowed to work on (404 for someone else's lead)
const ownLead = async req => {
  const lead = await prisma.lead.findFirst({ where: { id: +req.params.id, ...leadScope(req) } })
  if (!lead) fail('Lead not found', 404)
  return lead
}

// Checks the user a lead is assigned to. Empty means "not assigned". Only admin and sales users can have leads.
const assigneeId = async v => {
  if (v === undefined || v === null || v === '') return null
  const u = await prisma.user.findUnique({ where: { id: +v } })
  if (!u || !['admin', 'sales'].includes(u.role)) fail('Choose a valid user to assign the lead to')
  return u.id
}

app.get('/api/leads', auth, wrap(async (req, res) =>
  res.json(await prisma.lead.findMany({ where: leadScope(req), include: LEAD_INCLUDE, orderBy: { createdAt: 'desc' } }))))

// Users a lead can be assigned to (admin only; used by the "Assign to" dropdown)
app.get('/api/leads/assignees', auth, wrap(async (req, res) => {
  if (req.user.role !== 'admin') fail('Only admins can assign leads', 403)
  res.json(await prisma.user.findMany({ where: { role: { in: ['admin', 'sales'] } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }))
}))

app.post('/api/leads', auth, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) fail('Lead name is required')
  const { phone, email, source, campaign, notes } = req.body
  // A sales user's own new lead is assigned to them (otherwise they could not see it). Admin may pick a user or leave it empty.
  const assignedToId = req.user.role === 'admin' ? await assigneeId(req.body.assignedToId) : req.user.id
  res.json(await prisma.lead.create({ data: { name, phone, email, source: source || 'Manual', campaign, notes, assignedToId }, include: LEAD_INCLUDE }))
}))

// Admin assigns (or un-assigns) a lead.  Body: { userId: 3 }  or  { userId: null }
app.patch('/api/leads/:id/assign', auth, wrap(async (req, res) => {
  if (req.user.role !== 'admin') fail('Only admins can assign leads', 403)
  const assignedToId = await assigneeId(req.body.userId)
  res.json(await prisma.lead.update({ where: { id: +req.params.id }, data: { assignedToId }, include: LEAD_INCLUDE }))
}))

// Move a lead to another stage (a sales user can only move their own leads)
app.patch('/api/leads/:id', auth, wrap(async (req, res) => {
  if (!STAGES.includes(req.body.stage)) fail('Unknown stage')
  const lead = await ownLead(req)
  res.json(await prisma.lead.update({ where: { id: lead.id }, data: { stage: req.body.stage }, include: LEAD_INCLUDE }))
}))

// Turn a lead into a customer (a sales user can only convert their own leads)
app.post('/api/leads/:id/convert', auth, wrap(async (req, res) => {
  const lead = await ownLead(req)
  const [contact] = await prisma.$transaction([
    prisma.contact.create({ data: { type: 'customer', name: lead.name, phone: lead.phone, email: lead.email } }),
    prisma.lead.update({ where: { id: lead.id }, data: { stage: 'Won' } })])
  res.json(contact)
}))

// ---- Meta Lead Ads webhook
app.get('/api/webhooks/meta', (req, res) =>
  req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN ? res.send(req.query['hub.challenge']) : res.sendStatus(403))
app.post('/api/webhooks/meta', wrap(async (req, res) => {
  res.sendStatus(200)
  for (const entry of req.body.entry || []) for (const ch of entry.changes || []) {
    if (ch.field !== 'leadgen') continue
    const id = String(ch.value.leadgen_id), f = {}
    if (process.env.META_PAGE_TOKEN) {
      const r = await fetch(`https://graph.facebook.com/v21.0/${id}?access_token=${process.env.META_PAGE_TOKEN}`).then(r => r.json())
      for (const x of r.field_data || []) f[x.name] = x.values?.[0]
    }
    await prisma.lead.upsert({ where: { metaId: id }, update: {}, create: {
      metaId: id, name: f.full_name || f.name || `Meta lead ${id.slice(-5)}`, phone: f.phone_number || f.phone, email: f.email,
      source: 'Meta Ads', campaign: String(ch.value.ad_id || ch.value.form_id || '') } })
  }
}))

// ---- Users and accounts
app.get('/api/accounts', auth, wrap(async (req, res) => res.json(await prisma.account.findMany({ orderBy: { code: 'asc' } }))))
app.get('/api/users', auth, wrap(async (req, res) =>
  res.json((await prisma.user.findMany({ orderBy: { id: 'asc' } })).map(({ password, ...u }) => u))))
app.post('/api/users', auth, wrap(async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || (password || '').length < 6) fail('Name, email and a password of 6+ characters are required')
  if (!['admin', 'accountant', 'sales'].includes(role)) fail('Unknown role')
  const u = await prisma.user.create({ data: { name, email: email.toLowerCase(), password: await bcrypt.hash(password, 10), role } })
  res.json({ id: u.id })
}))
app.delete('/api/users/:id', auth, wrap(async (req, res) => {
  if (+req.params.id === req.user.id) fail("You can't delete your own account")
  await prisma.user.delete({ where: { id: +req.params.id } }); res.json({ ok: true })
}))
app.get('/api/bank/lines', auth, wrap(async (req, res) => {
  const a = await prisma.account.findUniqueOrThrow({ where: { code: '1000' } })
  res.json(await prisma.journalLine.findMany({ where: { accountId: a.id }, include: { journal: true }, orderBy: { id: 'desc' }, take: 200 }))
}))

// ---- Dashboard (sales and purchases totals count active documents only)
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const [b, inv, pay, items, leads] = await Promise.all([balances(), prisma.invoice.groupBy({ by: ['kind'], where: { status: 'active' }, _sum: { total: true } }),
    prisma.payment.groupBy({ by: ['kind'], _sum: { amount: true } }), prisma.item.findMany(), prisma.lead.groupBy({ by: ['stage'], _count: true })])
  const g = (rows, k, f) => N(rows.find(r => r.kind === k)?._sum[f])
  const cn = await prisma.creditNote.aggregate({ _sum: { total: true } }) // credit notes reduce sales and receivable
  res.json({
    sales: g(inv, 'sale', 'total') - N(cn._sum.total), purchases: g(inv, 'purchase', 'total'),
    receivable: g(inv, 'sale', 'total') - g(pay, 'receipt', 'amount') - N(cn._sum.total), payable: g(inv, 'purchase', 'total') - g(pay, 'payment', 'amount'),
    cash: b.filter(a => a.code >= '1000' && a.code < '1100').reduce((s, a) => s + a.debit - a.credit, 0),
    lowStock: items.filter(i => i.qty <= i.minQty), leads: Object.fromEntries(leads.map(l => [l.stage, l._count])) })
}))

// ---- Modules (each file adds its own routes)
banking(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf })
projects(app, { prisma, wrap, fail, auth, N, r2 })
employees(app, { prisma, wrap, fail, auth, N, r2 })
payroll(app, { prisma, wrap, fail, post, auth, N, r2 }) // CHANGED: post added, in case payslips post to the books
expenses(app, { prisma, wrap, fail, post, auth, N, r2 })
sales(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf }) // NEW
purchase(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf })
managerImport(app, { prisma, wrap, fail, auth }) // Import from Manager (admin only)
assets(app, { prisma, wrap, fail, post, auth, N, r2 })
accounting(app, { prisma, wrap, fail, auth, N, r2 })
reports(app,{ prisma, wrap, fail, auth, N, r2 })
app.listen(process.env.PORT || 4000, () => console.log('API running on', process.env.PORT || 4000))