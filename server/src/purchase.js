// src/purchase.js
// Purchase documents: Purchase Quotes, Purchase Orders, Goods Receipts and Purchase Invoices.
// Registered from index.js with:  purchase(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf })
//
// Quotes, orders and goods receipts have NO stock or accounting effect. They are saved in the SalesDoc table
// (the table is shared with sales.js; "kind" keeps them apart: pquote, porder, greceipt).
// Purchase invoices (table Invoice, kind = 'purchase', numbers BILL-0001) add stock and post to the books:
//   Dr Inventory (1200)                  = lines that have an item
//   Dr line account or General Expenses (6000) = lines without an item
//   Dr Input Sales Tax (1300)            = tax
//   Dr or Cr Rounding (6900)             = rounding
//   Cr Accounts Payable (2000)           = total
// Totals are always calculated here, never taken from the page.
// Withholding tax rate is saved for printing only. It does not change the entries.
// Role rules (admin and accountant only) are applied in index.js.

export default function purchase(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf }) {
  // ---------- Small helpers ----------
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  const text = v => String(v || '').trim() || null
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + (Number(n) || 0)); return x }
  const isStaff = req => ['admin', 'accountant'].includes(req.user.role)
  const PAID_MSG = 'Payments are already recorded against this supplier, so this document cannot be changed'
  const netDaysOf = body => (orNull(body.netDays) === null ? null : Math.max(0, Math.floor(Number(body.netDays) || 0)))

  // Next document number, e.g. BILL-0001 (based on the newest number with this prefix)
async function nextNo(tx, model, prefix) {
  const rows = await tx[model].findMany({ where: { number: { startsWith: prefix } }, select: { number: true } })
  const n = Math.max(0, ...rows.map(r => parseInt(r.number.slice(prefix.length), 10) || 0))
  return prefix + String(n + 1).padStart(4, '0')
}
  const accId = async (tx, code) => (await tx.account.findUniqueOrThrow({ where: { code } })).id
  // Rounding differences post here. Created the first time it is needed.
  const roundingId = async tx => (await tx.account.upsert({ where: { code: '6900' }, update: {}, create: { code: '6900', name: 'Rounding', type: 'expense' } })).id

  // ---------- Reads and checks the form (shared by all four documents) ----------
  async function readDoc(tx, body) {
    const date = day(body.date)
    const contact = await tx.contact.findUnique({ where: { id: +body.contactId || 0 } })
    if (!contact || contact.type !== 'supplier') fail('Choose a valid supplier')

    const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => ({
      itemId: orNull(l.itemId) === null ? null : +l.itemId,
      accountId: orNull(l.accountId) === null ? null : +l.accountId,
      projectId: orNull(l.projectId) === null ? null : +l.projectId,
      description: String(l.description || '').trim().slice(0, 1000),
      qty: Number(l.qty), price: Number(l.price || 0), discount: Number(l.discount || 0),
    })).filter(l => l.itemId || l.description)
    if (!lines.length) fail('Add at least one line')
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty < 1) fail('Quantity must be a whole number above zero')
      if (!Number.isFinite(l.price) || l.price < 0) fail('Price cannot be negative')
      if (!Number.isFinite(l.discount) || l.discount < 0 || l.discount > 100) fail('Discount must be between 0 and 100')
      l.amount = r2(l.qty * l.price * (1 - l.discount / 100))
    }

    // Everything the lines point to must exist
    const check = async (ids, model, msg) => {
      const u = [...new Set(ids.filter(Boolean))]
      if (u.length && (await tx[model].count({ where: { id: { in: u } } })) !== u.length) fail(msg)
    }
    await check(lines.map(l => l.itemId), 'item', 'One of the items no longer exists')
    await check(lines.map(l => l.accountId), 'account', 'One of the accounts no longer exists')
    await check(lines.map(l => l.projectId), 'project', 'One of the projects no longer exists')

    // Totals: subtotal, tax, then a fixed total or rounding
    const taxRate = Math.min(100, Math.max(0, Number(body.taxRate) || 0))
    const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0))
    const tax = r2(subtotal * taxRate / 100)
    let total, rounding, fixedTotal = null
    if (Number(body.fixedTotal) > 0) {
      fixedTotal = r2(body.fixedTotal); total = fixedTotal; rounding = r2(total - subtotal - tax)
    } else {
      rounding = r2(body.rounding || 0)
      if (Math.abs(rounding) > 0.5) fail('Rounding cannot be more than 0.50')
      total = r2(subtotal + tax + rounding)
    }
    return {
      date, contact, lines, taxRate, subtotal, tax, rounding, total, fixedTotal,
      reference: text(body.reference), address: text(body.address), description: text(body.description),
      withholdingRate: Math.min(100, Math.max(0, Number(body.withholdingRate) || 0)),
    }
  }
  const lineRows = (lines, withAccount) => lines.map(l => ({
    itemId: l.itemId, description: l.description, qty: l.qty, price: l.price, discount: l.discount,
    ...(withAccount ? { accountId: l.accountId, projectId: l.projectId } : {}),
  }))
  const lineOut = l => ({ id: l.id, itemId: l.itemId, accountId: l.accountId ?? null, projectId: l.projectId ?? null,
    description: l.description, qty: l.qty, price: N(l.price), discount: N(l.discount) })

  // =====================================================
  // Quotes, Orders and Goods Receipts (no accounting effect)
  // =====================================================
  const DOCS = [
    { path: 'purchase-quotes', kind: 'pquote', prefix: 'PQ-', label: 'Purchase quote' },
    { path: 'purchase-orders', kind: 'porder', prefix: 'PO-', label: 'Purchase order' },
    { path: 'goods-receipts', kind: 'greceipt', prefix: 'GRN-', label: 'Goods receipt' },
  ]
  const FROM_KINDS = ['quote', 'order', 'receipt'] // the document a new one can be created from
  const DINCLUDE = { contact: true, lines: { orderBy: { id: 'asc' } } }
  const docOut = d => ({
    id: d.id, number: d.number, date: d.date, reference: d.reference || '', contactId: d.contactId,
    contact: { id: d.contact.id, name: d.contact.name }, address: d.address || '', description: d.description || '',
    taxRate: N(d.taxRate), subtotal: N(d.subtotal), tax: N(d.tax), rounding: N(d.rounding), total: N(d.total),
    fixedTotal: d.fixedTotal === null ? null : N(d.fixedTotal), withholdingRate: N(d.withholdingRate),
    rfq: d.rfq, validDays: d.validDays, expiryDate: d.expiryDate, status: d.status, lines: d.lines.map(lineOut),
  })

  for (const c of DOCS) {
    app.get(`/api/${c.path}`, auth, wrap(async (req, res) => {
      const rows = await prisma.salesDoc.findMany({ where: { kind: c.kind }, include: DINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })
      res.json(rows.map(docOut))
    }))

    // Creates or updates one document (existing = the one being edited)
    const save = async (tx, body, existing) => {
      const d = await readDoc(tx, body)
      const data = {
        date: d.date, reference: d.reference, contactId: d.contact.id, address: d.address, description: d.description,
        taxRate: d.taxRate, subtotal: d.subtotal, tax: d.tax, rounding: d.rounding, total: d.total, fixedTotal: d.fixedTotal,
        withholdingRate: d.withholdingRate, rfq: c.kind === 'pquote' ? !!body.rfq : false,
      }
      if (existing) return tx.salesDoc.update({ where: { id: existing.id }, data: { ...data, lines: { deleteMany: {}, create: lineRows(d.lines, false) } } })

      // Created from the previous document in the flow? Remember it (a quote becomes "accepted" once an order is made from it)
      const fromKind = FROM_KINDS.includes(body.fromKind) ? body.fromKind : null
      const fromId = fromKind ? +body.fromId || null : null
      const saved = await tx.salesDoc.create({ data: { ...data, kind: c.kind, number: await nextNo(tx, 'salesDoc', c.prefix),
        sourceKind: fromId ? fromKind : null, sourceId: fromId, lines: { create: lineRows(d.lines, false) } } })
      if (fromId && fromKind === 'quote' && c.kind === 'porder') await tx.salesDoc.updateMany({ where: { id: fromId, kind: 'pquote' }, data: { status: 'accepted' } })
      return saved
    }

    app.post(`/api/${c.path}`, auth, wrap(async (req, res) => {
      const saved = await prisma.$transaction(tx => save(tx, req.body, null), { timeout: 20000, maxWait: 10000 })
      res.json(docOut(await prisma.salesDoc.findUnique({ where: { id: saved.id }, include: DINCLUDE })))
    }))

    app.put(`/api/${c.path}/:id`, auth, wrap(async (req, res) => {
      const saved = await prisma.$transaction(async tx => {
        const old = await tx.salesDoc.findFirst({ where: { id: +req.params.id, kind: c.kind } })
        if (!old) fail(`${c.label} not found`, 404)
        return save(tx, req.body, old)
      }, { timeout: 20000, maxWait: 10000 })
      res.json(docOut(await prisma.salesDoc.findUnique({ where: { id: saved.id }, include: DINCLUDE })))
    }))

    app.delete(`/api/${c.path}/:id`, auth, wrap(async (req, res) => {
      const old = await prisma.salesDoc.findFirst({ where: { id: +req.params.id, kind: c.kind } })
      if (!old) fail(`${c.label} not found`, 404)
      await prisma.salesDoc.delete({ where: { id: old.id } }) // its lines are deleted with it
      res.json({ ok: true })
    }))
  }

  // =====================================================
  // Purchase invoices (stock + journal entry in one transaction)
  // =====================================================
  const IINCLUDE = { contact: true, lines: { orderBy: { id: 'asc' } } }

  // Amount still due on each invoice. Payments are applied to the oldest invoices first.
  async function dueMap(contactIds) {
    const ids = [...new Set(contactIds)]
    const [invs, pays] = await Promise.all([
      prisma.invoice.findMany({ where: { kind: 'purchase', status: 'active', contactId: { in: ids } }, select: { id: true, contactId: true, total: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      prisma.payment.groupBy({ by: ['contactId'], where: { contactId: { in: ids } }, _sum: { amount: true } })])
    const avail = {}
    for (const id of ids) avail[id] = N(pays.find(p => p.contactId === id)?._sum.amount)
    const due = {}
    for (const i of invs) {
      const used = Math.min(Math.max(avail[i.contactId], 0), N(i.total))
      avail[i.contactId] -= used
      due[i.id] = r2(N(i.total) - used)
    }
    return due
  }
  const invOut = (i, due) => ({
    id: i.id, number: i.number, date: i.date, reference: i.reference || '', contactId: i.contactId,
    contact: { id: i.contact.id, name: i.contact.name }, address: i.address || '', description: i.description || '',
    taxRate: N(i.taxRate),
    subtotal: N(i.subtotal) || r2(N(i.total) - N(i.tax) - N(i.rounding)), // old bills have no subtotal: work it out
    tax: N(i.tax), rounding: N(i.rounding), total: N(i.total), fixedTotal: i.fixedTotal === null ? null : N(i.fixedTotal),
    withholdingRate: N(i.withholdingRate), netDays: i.netDays, dueDate: i.dueDate, status: i.status,
    balanceDue: due[i.id] ?? N(i.total), lines: i.lines.map(lineOut),
  })
  const oneInvoice = async id => {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: IINCLUDE })
    return invOut(inv, await dueMap([inv.contactId]))
  }

  // Puts the bought items into stock and posts the journal entry for a saved invoice
  async function applyInvoice(tx, inv, d) {
    for (const l of d.lines.filter(l => l.itemId)) {
      const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } })
      const unitCost = r2(l.amount / l.qty) // price after the line discount
      // Average cost items get a weighted average cost. Others use the latest purchase price.
      const cost = item.valuationMethod === 'Average cost' && item.qty > 0
        ? r2((item.qty * N(item.cost) + l.qty * unitCost) / (item.qty + l.qty)) : unitCost
      await tx.item.update({ where: { id: item.id }, data: { qty: { increment: l.qty }, cost } })
      await tx.stockMove.create({ data: { itemId: item.id, qty: l.qty, ref: inv.number, date: d.date } })
    }

    // Lines with an item go to Inventory. Other lines use their own account, else General Expenses.
    const inventory = await accId(tx, '1200'), expense = await accId(tx, '6000')
    const debits = new Map()
    for (const l of d.lines) {
      const a = l.itemId ? inventory : (l.accountId ?? expense)
      debits.set(a, r2((debits.get(a) || 0) + l.amount))
    }
    const entry = [...[...debits].map(([accountId, debit]) => ({ accountId, debit })),
      { accountId: await accId(tx, '1300'), debit: d.tax },
      { accountId: await accId(tx, '2000'), credit: d.total }]
    if (d.rounding > 0) entry.push({ accountId: await roundingId(tx), debit: d.rounding })
    if (d.rounding < 0) entry.push({ accountId: await roundingId(tx), credit: -d.rounding })
    await post(tx, { date: d.date, memo: inv.number, ref: inv.number, lines: entry })
  }

  // Takes the items out of stock again and removes the journal entry (used by edit and delete)
  async function reverseInvoice(tx, inv) {
    for (const l of inv.lines.filter(l => l.itemId)) {
      const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } })
      if (item.qty - l.qty < 0) fail(`Cannot change this bill: part of ${item.name} was already sold or used (${item.qty} in stock)`)
      await tx.item.update({ where: { id: item.id }, data: { qty: { decrement: l.qty } } })
    }
    await tx.stockMove.deleteMany({ where: { ref: inv.number } })
    await tx.journal.deleteMany({ where: { ref: inv.number } })
  }

  // Loads an invoice that can be edited or deleted
  async function editable(tx, req) {
    if (!isStaff(req)) fail('Only admins and accountants can change or delete purchase invoices', 403)
    const inv = await tx.invoice.findFirst({ where: { id: +req.params.id, kind: 'purchase' }, include: { lines: true } })
    if (!inv) fail('Purchase invoice not found', 404)
    if (inv.status !== 'active') fail('This invoice is cancelled and cannot be changed')
    return inv
  }

  app.get('/api/purchase-invoices', auth, wrap(async (req, res) => {
    const rows = await prisma.invoice.findMany({ where: { kind: 'purchase', status: 'active' }, include: IINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })
    const due = await dueMap(rows.map(r => r.contactId))
    res.json(rows.map(r => invOut(r, due)))
  }))

  app.post('/api/purchase-invoices', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(async tx => {
      const d = await readDoc(tx, req.body)
      const fromKind = FROM_KINDS.includes(req.body.fromKind) ? req.body.fromKind : null
      const fromId = fromKind ? +req.body.fromId || null : null
      const netDays = netDaysOf(req.body)
      const inv = await tx.invoice.create({ data: {
        number: await nextNo(tx, 'invoice', 'BILL-'), kind: 'purchase', date: d.date, contactId: d.contact.id,
        total: d.total, tax: d.tax, taxRate: d.taxRate, subtotal: d.subtotal, rounding: d.rounding, fixedTotal: d.fixedTotal,
        reference: d.reference, address: d.address, description: d.description, withholdingRate: d.withholdingRate,
        netDays, dueDate: netDays === null ? null : addDays(d.date, netDays),
        sourceKind: fromId ? fromKind : null, sourceId: fromId,
        lines: { create: lineRows(d.lines, true) } } })
      await applyInvoice(tx, inv, d)
      return inv
    }, { timeout: 20000, maxWait: 10000 })
    res.json(await oneInvoice(saved.id))
  }))

  // Edit keeps the same number: the old stock and entry are reversed, then the new ones are applied
  app.put('/api/purchase-invoices/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    await prisma.$transaction(async tx => {
      const old = await editable(tx, req)
      await reverseInvoice(tx, old)
      const d = await readDoc(tx, req.body)
      const netDays = netDaysOf(req.body)
      const inv = await tx.invoice.update({ where: { id }, data: {
        date: d.date, contactId: d.contact.id, total: d.total, tax: d.tax, taxRate: d.taxRate, subtotal: d.subtotal, rounding: d.rounding,
        fixedTotal: d.fixedTotal, reference: d.reference, address: d.address, description: d.description, withholdingRate: d.withholdingRate,
        netDays, dueDate: netDays === null ? null : addDays(d.date, netDays),
        lines: { deleteMany: {}, create: lineRows(d.lines, true) } } })
      await applyInvoice(tx, inv, d)
      // Neither supplier may end up with a negative balance because of payments already made
      for (const cid of new Set([old.contactId, d.contact.id])) if ((await balanceOf(tx, cid)) < -0.005) fail(PAID_MSG)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(await oneInvoice(id))
  }))

  app.delete('/api/purchase-invoices/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const old = await editable(tx, req)
      await reverseInvoice(tx, old)
      await tx.invoice.delete({ where: { id: old.id } }) // its lines are deleted with it
      if ((await balanceOf(tx, old.contactId)) < -0.005) fail(PAID_MSG)
    }, { timeout: 20000, maxWait: 10000 })
    res.json({ ok: true })
  }))
}