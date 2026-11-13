import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const app = express()
app.set('trust proxy', 1) // Render sits behind a proxy; rate limit uses the real visitor IP
app.use(cors()); app.use(express.json())

// Small helpers
const N = v => Number(v || 0)
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100 // round money to 2 decimals
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e }

// Runs a route and turns errors into clean JSON responses
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code === 'P2002') e = Object.assign(new Error('This value already exists (duplicate email or code)'), { status: 409 })
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

// Roles: admin (all), accountant (books), sales (leads, sales), store (items, purchases)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/webhooks')) return next()
  auth(req, res, () => {
    const r = req.user.role, p = req.path, w = req.method !== 'GET', is = (...x) => x.includes(r)
    const deny = (p.startsWith('/users') && r !== 'admin')
      || (/^\/(reports|journal|bank|payments)/.test(p) && !is('admin', 'accountant'))
      || (w && p.startsWith('/items') && !is('admin', 'accountant', 'store'))
      || (w && p.startsWith('/leads') && !is('admin', 'accountant', 'sales'))
      || (w && p.startsWith('/invoices') && !is('admin', 'accountant', req.body?.kind === 'purchase' ? 'store' : 'sales'))
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

// Contacts (customers / suppliers) with running balance
// Cancelled documents are left out of the balance (status: 'active' only)
app.get('/api/contacts', auth, wrap(async (req, res) => {
  const rows = await prisma.contact.findMany({ where: { type: req.query.type }, include: { invoices: { where: { status: 'active' }, select: { total: true } }, payments: { select: { amount: true } }, creditNotes: { select: { total: true } } }, orderBy: { name: 'asc' } })
  res.json(rows.map(({ invoices, payments, creditNotes, ...c }) => ({ ...c, balance: invoices.reduce((s, i) => s + N(i.total), 0) - payments.reduce((s, p) => s + N(p.amount), 0) - creditNotes.reduce((s, n) => s + N(n.total), 0) })))
}))
app.post('/api/contacts', auth, wrap(async (req, res) => {
  if (!req.body.name) fail('Name is required')
  res.json(await prisma.contact.create({ data: { type: req.body.type, name: req.body.name, phone: req.body.phone, email: req.body.email } }))
}))

// Inventory items
app.get('/api/items', auth, wrap(async (req, res) => res.json(await prisma.item.findMany({ orderBy: { name: 'asc' } }))))
app.post('/api/items', auth, wrap(async (req, res) => {
  const { sku, name, unit, cost, price, minQty } = req.body
  if (!sku || !name) fail('SKU and name are required')
  res.json(await prisma.item.create({ data: { sku, name, unit: unit || 'pcs', cost: +cost || 0, price: +price || 0, minQty: +minQty || 0 } }))
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
app.get('/api/leads', auth, wrap(async (req, res) => res.json(await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } }))))
app.post('/api/leads', auth, wrap(async (req, res) => {
  if (!req.body.name) fail('Lead name is required')
  const { name, phone, email, source, campaign, notes } = req.body
  res.json(await prisma.lead.create({ data: { name, phone, email, source: source || 'Manual', campaign, notes } }))
}))
app.patch('/api/leads/:id', auth, wrap(async (req, res) => {
  if (!STAGES.includes(req.body.stage)) fail('Unknown stage')
  res.json(await prisma.lead.update({ where: { id: +req.params.id }, data: { stage: req.body.stage } }))
}))
app.post('/api/leads/:id/convert', auth, wrap(async (req, res) => {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: +req.params.id } })
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

// ---- Users, accounts, bank reconciliation
app.get('/api/accounts', auth, wrap(async (req, res) => res.json(await prisma.account.findMany({ orderBy: { code: 'asc' } }))))
app.get('/api/users', auth, wrap(async (req, res) =>
  res.json((await prisma.user.findMany({ orderBy: { id: 'asc' } })).map(({ password, ...u }) => u))))
app.post('/api/users', auth, wrap(async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || (password || '').length < 6) fail('Name, email and a password of 6+ characters are required')
  if (!['admin', 'accountant', 'sales', 'store'].includes(role)) fail('Unknown role')
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
app.post('/api/bank/reconcile', auth, wrap(async (req, res) => {
  await prisma.journalLine.updateMany({ where: { id: { in: (req.body.ids || []).map(Number) } }, data: { reconciled: !!req.body.value } }); res.json({ ok: true })
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
    cash: b.filter(a => a.code === '1000').reduce((s, a) => s + a.debit - a.credit, 0),
    lowStock: items.filter(i => i.qty <= i.minQty), leads: Object.fromEntries(leads.map(l => [l.stage, l._count])) })
}))

app.listen(process.env.PORT || 4000, () => console.log('API running on', process.env.PORT || 4000))