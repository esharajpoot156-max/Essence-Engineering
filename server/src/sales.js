// src/sales.js
// Sales documents: Sales Quotes, Sales Orders, Delivery Notes and Sales Invoices.
// Registered from index.js with:  sales(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf })
//
// Quotes, orders and delivery notes (table SalesDoc) have NO stock or accounting effect.
// Sales invoices (table Invoice, kind = 'sale') reduce stock and post to the books:
//   Dr Accounts Receivable (1100)            = total
//   Cr Sales / line account                  = each line amount
//   Cr Sales Tax Payable (2100)              = tax
//   Cr or Dr Rounding (6900)                 = rounding
//   Dr Cost of Goods Sold (5000), Cr Inventory (1200) = cost of the items sold
// Totals are always calculated here, never taken from the page.
// Withholding tax rate is saved for printing only. It does not change the entries.

export default function sales(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf }) {
  // ---------- Small helpers ----------
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  const text = v => String(v || '').trim() || null
  // Checks and returns a date from the request
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + (Number(n) || 0)); return x }
  const isStaff = req => ['admin', 'accountant'].includes(req.user.role)
  const PAID_MSG = 'Payments are already recorded against this customer, so this document cannot be changed'

  // Next document number, e.g. INV-0001 (based on the newest number with this prefix)
  async function nextNo(tx, model, prefix) {
    const last = await tx[model].findFirst({ where: { number: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { number: true } })
    const n = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0
    return prefix + String(n + 1).padStart(4, '0')
  }
  const accId = async (tx, code) => (await tx.account.findUniqueOrThrow({ where: { code } })).id
  // Rounding differences post here. Created the first time it is needed.
  const roundingId = async tx => (await tx.account.upsert({ where: { code: '6900' }, update: {}, create: { code: '6900', name: 'Rounding', type: 'expense' } })).id

  // ---------- Reads and checks the form (shared by all four documents) ----------
  async function readDoc(tx, body) {
    const date = day(body.date)
    const contact = await tx.contact.findUnique({ where: { id: +body.contactId || 0 } })
    if (!contact || contact.type !== 'customer') fail('Choose a valid customer')

    const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => ({
      itemId: orNull(l.itemId) === null ? null : +l.itemId,
      accountId: orNull(l.accountId) === null ? null : +l.accountId,
      projectId: orNull(l.projectId) === null ? null : +l.projectId,
      description: String(l.description || '').trim().slice(0, 200),
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
  // Quotes, Orders and Delivery Notes (no accounting effect)
  // =====================================================
  const DOCS = [
    { path: 'sales-quotes', kind: 'quote', prefix: 'QUO-', label: 'Sales quote' },
    { path: 'sales-orders', kind: 'order', prefix: 'SO-', label: 'Sales order' },
    { path: 'delivery-notes', kind: 'delivery', prefix: 'DN-', label: 'Delivery note' },
  ]
  const DINCLUDE = { contact: true, lines: { orderBy: { id: 'asc' } } }
  const docOut = d => ({
    id: d.id, number: d.number, date: d.date, reference: d.reference || '', contactId: d.contactId,
    contact: { id: d.contact.id, name: d.contact.name }, address: d.address || '', description: d.description || '',
    taxRate: N(d.taxRate), subtotal: N(d.subtotal), tax: N(d.tax), rounding: N(d.rounding), total: N(d.total),
    fixedTotal: d.fixedTotal === null ? null : N(d.fixedTotal), withholdingRate: N(d.withholdingRate),
    validDays: d.validDays, expiryDate: d.expiryDate, status: d.status, lines: d.lines.map(lineOut),
  })

  for (const c of DOCS) {
    app.get(`/api/${c.path}`, auth, wrap(async (req, res) => {
      const rows = await prisma.salesDoc.findMany({ where: { kind: c.kind }, include: DINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })
      res.json(rows.map(docOut))
    }))

    // Creates or updates one document (existing = the one being edited)
    const save = async (tx, body, existing) => {
      const d = await readDoc(tx, body)
      const validDays = c.kind === 'quote' && orNull(body.validDays) !== null ? Math.max(0, Math.floor(Number(body.validDays) || 0)) : null
      const data = {
        date: d.date, reference: d.reference, contactId: d.contact.id, address: d.address, description: d.description,
        taxRate: d.taxRate, subtotal: d.subtotal, tax: d.tax, rounding: d.rounding, total: d.total, fixedTotal: d.fixedTotal,
        withholdingRate: d.withholdingRate, validDays, expiryDate: validDays === null ? null : addDays(d.date, validDays),
      }
      if (existing) return tx.salesDoc.update({ where: { id: existing.id }, data: { ...data, lines: { deleteMany: {}, create: lineRows(d.lines, false) } } })

      // Created from the previous document in the flow? Remember it (a quote becomes "accepted" once an order is made from it)
      const fromKind = ['quote', 'order', 'delivery'].includes(body.fromKind) ? body.fromKind : null
      const fromId = fromKind ? +body.fromId || null : null
      const saved = await tx.salesDoc.create({ data: { ...data, kind: c.kind, number: await nextNo(tx, 'salesDoc', c.prefix),
        sourceKind: fromId ? fromKind : null, sourceId: fromId, lines: { create: lineRows(d.lines, false) } } })
      if (fromId && fromKind === 'quote' && c.kind === 'order') await tx.salesDoc.updateMany({ where: { id: fromId, kind: 'quote' }, data: { status: 'accepted' } })
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
  // Sales invoices (stock + journal entry in one transaction)
  // =====================================================
  const IINCLUDE = { contact: true, lines: { orderBy: { id: 'asc' } } }

  // Amount still due on each invoice. Payments and credit notes are applied to the oldest invoices first.
  async function dueMap(contactIds) {
    const ids = [...new Set(contactIds)]
    const [invs, pays, notes] = await Promise.all([
      prisma.invoice.findMany({ where: { kind: 'sale', status: 'active', contactId: { in: ids } }, select: { id: true, contactId: true, total: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      prisma.payment.groupBy({ by: ['contactId'], where: { contactId: { in: ids } }, _sum: { amount: true } }),
      prisma.creditNote.groupBy({ by: ['contactId'], where: { contactId: { in: ids } }, _sum: { total: true } })])
    const avail = {}
    for (const id of ids) avail[id] = N(pays.find(p => p.contactId === id)?._sum.amount) + N(notes.find(n => n.contactId === id)?._sum.total)
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
    // Invoices saved before this version have no subtotal: work it out
    subtotal: N(i.subtotal) || r2(N(i.total) - N(i.tax) - N(i.rounding)),
    tax: N(i.tax), rounding: N(i.rounding), total: N(i.total), fixedTotal: i.fixedTotal === null ? null : N(i.fixedTotal),
    withholdingRate: N(i.withholdingRate), netDays: i.netDays, dueDate: i.dueDate, status: i.status,
    balanceDue: due[i.id] ?? N(i.total), lines: i.lines.map(lineOut),
  })
  const oneInvoice = async id => {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: IINCLUDE })
    return invOut(inv, await dueMap([inv.contactId]))
  }

  // Takes the stock out and posts the journal entry for a saved invoice
  async function applyInvoice(tx, inv, d) {
    let cogs = 0
    for (const l of d.lines.filter(l => l.itemId)) {
      const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } })
      if (item.qty - l.qty < 0) fail(`Not enough stock for ${item.name} (${item.qty} left)`)
      await tx.item.update({ where: { id: item.id }, data: { qty: { decrement: l.qty } } })
      await tx.stockMove.create({ data: { itemId: item.id, qty: -l.qty, ref: inv.number, date: d.date } })
      cogs += l.qty * N(item.cost)
    }
    cogs = r2(cogs)

    // Each line credits its own account: the line account, else the item's custom income account, else Sales (4000)
    const items = await tx.item.findMany({ where: { id: { in: d.lines.map(l => l.itemId).filter(Boolean) } } })
    const sales = await accId(tx, '4000')
    const revenue = new Map()
    for (const l of d.lines) {
      const a = l.accountId ?? items.find(i => i.id === l.itemId)?.customIncomeAccountId ?? sales
      revenue.set(a, r2((revenue.get(a) || 0) + l.amount))
    }
    const entry = [{ accountId: await accId(tx, '1100'), debit: d.total },
      ...[...revenue].map(([accountId, credit]) => ({ accountId, credit })),
      { accountId: await accId(tx, '2100'), credit: d.tax }]
    if (d.rounding > 0) entry.push({ accountId: await roundingId(tx), credit: d.rounding })
    if (d.rounding < 0) entry.push({ accountId: await roundingId(tx), debit: -d.rounding })
    if (cogs > 0) entry.push({ accountId: await accId(tx, '5000'), debit: cogs }, { accountId: await accId(tx, '1200'), credit: cogs })
    await post(tx, { date: d.date, memo: inv.number, ref: inv.number, lines: entry })
  }

  // Puts the stock back and removes the journal entry (used by edit and delete)
  async function reverseInvoice(tx, inv) {
    for (const l of inv.lines.filter(l => l.itemId)) await tx.item.update({ where: { id: l.itemId }, data: { qty: { increment: l.qty } } })
    await tx.stockMove.deleteMany({ where: { ref: inv.number } })
    await tx.journal.deleteMany({ where: { ref: inv.number } })
  }

  // Loads an invoice that can be edited or deleted
  async function editable(tx, req) {
    if (!isStaff(req)) fail('Only admins and accountants can change or delete invoices', 403)
    const inv = await tx.invoice.findFirst({ where: { id: +req.params.id, kind: 'sale' }, include: { lines: true, _count: { select: { creditNotes: true } } } })
    if (!inv) fail('Invoice not found', 404)
    if (inv.status !== 'active') fail('This invoice is cancelled and cannot be changed')
    if (inv._count.creditNotes > 0) fail('This invoice has credit notes and cannot be changed or deleted')
    return inv
  }

  app.get('/api/sales-invoices', auth, wrap(async (req, res) => {
    const rows = await prisma.invoice.findMany({ where: { kind: 'sale', status: 'active' }, include: IINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })
    const due = await dueMap(rows.map(r => r.contactId))
    res.json(rows.map(r => invOut(r, due)))
  }))

  app.post('/api/sales-invoices', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(async tx => {
      const d = await readDoc(tx, req.body)
      const fromKind = ['quote', 'order', 'delivery'].includes(req.body.fromKind) ? req.body.fromKind : null
      const fromId = fromKind ? +req.body.fromId || null : null
      const inv = await tx.invoice.create({ data: {
        number: await nextNo(tx, 'invoice', 'INV-'), kind: 'sale', date: d.date, contactId: d.contact.id,
        total: d.total, tax: d.tax, taxRate: d.taxRate, subtotal: d.subtotal, rounding: d.rounding, fixedTotal: d.fixedTotal,
        reference: d.reference, address: d.address, description: d.description, withholdingRate: d.withholdingRate,
        netDays: orNull(req.body.netDays) === null ? null : Math.max(0, Math.floor(Number(req.body.netDays) || 0)),
        dueDate: orNull(req.body.netDays) === null ? null : addDays(d.date, req.body.netDays),
        sourceKind: fromId ? fromKind : null, sourceId: fromId,
        lines: { create: lineRows(d.lines, true) } } })
      await applyInvoice(tx, inv, d)
      return inv
    }, { timeout: 20000, maxWait: 10000 })
    res.json(await oneInvoice(saved.id))
  }))

  // Edit keeps the same invoice number: the old stock and entry are reversed, then the new ones are applied
  app.put('/api/sales-invoices/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    await prisma.$transaction(async tx => {
      const old = await editable(tx, req)
      await reverseInvoice(tx, old)
      const d = await readDoc(tx, req.body)
      const inv = await tx.invoice.update({ where: { id }, data: {
        date: d.date, contactId: d.contact.id, total: d.total, tax: d.tax, taxRate: d.taxRate, subtotal: d.subtotal, rounding: d.rounding,
        fixedTotal: d.fixedTotal, reference: d.reference, address: d.address, description: d.description, withholdingRate: d.withholdingRate,
        netDays: orNull(req.body.netDays) === null ? null : Math.max(0, Math.floor(Number(req.body.netDays) || 0)),
        dueDate: orNull(req.body.netDays) === null ? null : addDays(d.date, req.body.netDays),
        lines: { deleteMany: {}, create: lineRows(d.lines, true) } } })
      await applyInvoice(tx, inv, d)
      // Neither customer may end up with a negative balance because of payments already made
      for (const cid of new Set([old.contactId, d.contact.id])) if ((await balanceOf(tx, cid)) < -0.005) fail(PAID_MSG)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(await oneInvoice(id))
  }))

  app.delete('/api/sales-invoices/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const old = await editable(tx, req)
      await reverseInvoice(tx, old)
      await tx.invoice.delete({ where: { id: old.id } }) // its lines are deleted with it
      if ((await balanceOf(tx, old.contactId)) < -0.005) fail(PAID_MSG)
    }, { timeout: 20000, maxWait: 10000 })
    res.json({ ok: true })
  }))
}