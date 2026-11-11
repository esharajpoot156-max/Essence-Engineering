import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const app = express()
app.use(cors()); app.use(express.json())

const N = v => Number(v || 0)
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100
const fail = (m, s = 400) => { const e = new Error(m); e.status = s; throw e }
const wrap = fn => (req, res) => fn(req, res).catch(e => { if(e.code === 'P2002') e = Object.assign(new Error('This value is already exists (duplicate email or code)'),{status: 404})
  if(!e.status)console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong on the server' })
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

// ---- Roles: admin (all), accountant (books), sales (leads, sales), store (items, purchases)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/webhooks')) return next()
  auth(req, res, () => {
    const r = req.user.role, p = req.path, w = req.method !== 'GET', is = (...x) => x.includes(r)
    const deny = (p.startsWith('/users') && r !== 'admin')
      || (/^\/(reports|journal|bank|payments)/.test(p) && !is('admin', 'accountant'))
      || (w && p.startsWith('/items') && !is('admin', 'accountant', 'store'))
      || (w && p.startsWith('/leads') && !is('admin', 'accountant', 'sales'))
      || (w && p.startsWith('/invoices') && !is('admin', 'accountant', req.body?.kind === 'purchase' ? 'store' : 'sales'))
    if (deny) return res.status(403).json({ error: 'Your role cannot do this' })
    next()
  })
})

// ---- Auth & settings
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: { error: 'Too many failed logins. Try again in 15 minutes.' } })
app.post('/api/auth/login',loginLimiter, wrap(async (req, res) => {
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
app.get('/api/contacts', auth, wrap(async (req, res) => {
  const rows = await prisma.contact.findMany({ where: { type: req.query.type }, include: { invoices: { select: { total: true } }, payments: { select: { amount: true } } }, orderBy: { name: 'asc' } })
  res.json(rows.map(({ invoices, payments, ...c }) => ({ ...c, balance: invoices.reduce((s, i) => s + N(i.total), 0) - payments.reduce((s, p) => s + N(p.amount), 0) })))
}))
app.post('/api/contacts', auth, wrap(async (req, res) => {
  if (!req.body.name) fail('Name is required')
  res.json(await prisma.contact.create({ data: { type: req.body.type, name: req.body.name, phone: req.body.phone, email: req.body.email } }))
}))

// ---- Inventory items
app.get('/api/items', auth, wrap(async (req, res) => res.json(await prisma.item.findMany({ orderBy: { name: 'asc' } }))))
app.post('/api/items', auth, wrap(async (req, res) => {
  const { sku, name, unit, cost, price, minQty } = req.body
  if (!sku || !name) fail('SKU and name are required')
  res.json(await prisma.item.create({ data: { sku, name, unit: unit || 'pcs', cost: +cost || 0, price: +price || 0, minQty: +minQty || 0 } }))
}))

// ---- Sales invoices & purchase bills: document + stock + journal in ONE transaction
app.get('/api/invoices', auth, wrap(async (req, res) =>
  res.json(await prisma.invoice.findMany({ where: { kind: req.query.kind }, include: { contact: true, lines: true }, orderBy: { id: 'desc' }, take: 100 }))))
app.post('/api/invoices', auth, wrap(async (req, res) => {
  const { kind, contactId, date } = req.body
  const lines = (req.body.lines || []).filter(l => +l.qty > 0).map(l => ({ ...l, qty: +l.qty, price: +l.price }))
  if (!['sale', 'purchase'].includes(kind) || !lines.length || !contactId) fail('Choose a contact and add at least one line')
  const inv = await prisma.$transaction(async tx => {
    const number = (kind === 'sale' ? 'INV-' : 'BILL-') + String((await tx.invoice.count({ where: { kind } })) + 1).padStart(4, '0')
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0), taxRate = Math.max(0, +req.body.taxRate || 0)
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
  })
  res.json(inv)
}))

// ---- Payments: receipt (customer pays us) / payment (we pay supplier)
app.post('/api/payments', auth, wrap(async (req, res) => {
  const { kind, contactId, date } = req.body, amount = r2(req.body.amount)
  if (!['receipt', 'payment'].includes(kind) || !(amount > 0)) fail('Enter an amount above zero')
  await prisma.$transaction(async tx => {
    const c = await tx.contact.findUnique({ where: { id: +contactId }, include: { invoices: { select: { total: true } }, payments: { select: { amount: true } } } })
    if (!c) fail('Contact not found', 404)
    const due = r2(c.invoices.reduce((s, i) => s + N(i.total), 0) - c.payments.reduce((s, p) => s + N(p.amount), 0))
    if (amount > due + 0.005) fail(`Amount is more than the balance due (Rs ${due.toFixed(2)})`)
    await tx.payment.create({ data: { kind, contactId: +contactId, amount, date: new Date(date || Date.now()) } })
    await post(tx, { date, memo: kind === 'receipt' ? 'Customer receipt' : 'Supplier payment',
      lines: kind === 'receipt' ? [{ code: '1000', debit: amount }, { code: '1100', credit: amount }] : [{ code: '2000', debit: amount }, { code: '1000', credit: amount }] })
  })
  res.json({ ok: true })
}))

// ---- Journal & reports
app.get('/api/journal', auth, wrap(async (req, res) =>
  res.json(await prisma.journal.findMany({ include: { lines: { include: { account: true } } }, orderBy: { id: 'desc' }, take: 50 }))))
app.post('/api/journal', auth, wrap(async (req, res) => { await prisma.$transaction(tx => post(tx, req.body)); res.json({ ok: true }) }))
async function balances() {
  const [accounts, sums] = await Promise.all([prisma.account.findMany({ orderBy: { code: 'asc' } }), prisma.journalLine.groupBy({ by: ['accountId'], _sum: { debit: true, credit: true } })])
  return accounts.map(a => { const s = sums.find(x => x.accountId === a.id)?._sum || {}; return { ...a, debit: N(s.debit), credit: N(s.credit) } })
}
app.get('/api/reports/trial-balance', auth, wrap(async (req, res) => res.json(await balances())))
app.get('/api/reports/pnl', auth, wrap(async (req, res) => {
  const b = await balances()
  const income = b.filter(a => a.type === 'income').reduce((s, a) => s + a.credit - a.debit, 0)
  const expense = b.filter(a => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0)
  res.json({ income, expense, profit: income - expense })
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

// ---- Dashboard
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const [b, inv, pay, items, leads] = await Promise.all([balances(), prisma.invoice.groupBy({ by: ['kind'], _sum: { total: true } }),
    prisma.payment.groupBy({ by: ['kind'], _sum: { amount: true } }), prisma.item.findMany(), prisma.lead.groupBy({ by: ['stage'], _count: true })])
  const g = (rows, k, f) => N(rows.find(r => r.kind === k)?._sum[f])
  res.json({
    sales: g(inv, 'sale', 'total'), purchases: g(inv, 'purchase', 'total'),
    receivable: g(inv, 'sale', 'total') - g(pay, 'receipt', 'amount'), payable: g(inv, 'purchase', 'total') - g(pay, 'payment', 'amount'),
    cash: b.filter(a => a.code === '1000').reduce((s, a) => s + a.debit - a.credit, 0),
    lowStock: items.filter(i => i.qty <= i.minQty), leads: Object.fromEntries(leads.map(l => [l.stage, l._count])) })
}))

app.listen(process.env.PORT || 4000, () => console.log('API running on', process.env.PORT || 4000))
