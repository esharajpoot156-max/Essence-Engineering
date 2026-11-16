// src/expenses.js
// Expense Claims: kharcha jo staff ne apni jeb se kiya.
// Registered from index.js with:  expenses(app, { prisma, wrap, fail, post, auth, N, r2 })
// Role rules (admin and accountant only) are applied in index.js.
// Accounting: Dr expense accounts (lines), Cr "Employee Claims Payable" (2200).

export default function expenses(app, { prisma, wrap, fail, post, auth, N, r2 }) {
  // ---------- Small helpers ----------
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  // Checks and returns a date from the request
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  // Next number: EXP-0001 (based on the newest number)
  async function nextNo(tx) {
    const last = await tx.expenseClaim.findFirst({ where: { number: { startsWith: 'EXP-' } }, orderBy: { id: 'desc' }, select: { number: true } })
    const n = last ? parseInt(last.number.slice(4), 10) || 0 : 0
    return 'EXP-' + String(n + 1).padStart(4, '0')
  }
  // Liability account where claims wait until the employee is paid. Created on first use.
  const payableId = async tx => (await tx.account.upsert({ where: { code: '2200' }, update: {},
    create: { code: '2200', name: 'Employee Claims Payable', type: 'liability' } })).id
  // Lines with no account go to Suspense (1900), same as receipts and payments
  const suspenseId = async tx => (await tx.account.upsert({ where: { code: '1900' }, update: {},
    create: { code: '1900', name: 'Suspense', type: 'asset' } })).id

  const INCLUDE = { paidBy: true, payee: true, lines: { include: { account: true }, orderBy: { id: 'asc' } } }

  // Shapes a claim for the page
  const out = c => ({
    id: c.id, number: c.number, date: c.date, reference: c.reference || '',
    paidById: c.paidById, paidBy: { id: c.paidBy.id, name: c.paidBy.name },
    payeeId: c.payeeId, payee: c.payee ? { id: c.payee.id, name: c.payee.name } : null,
    total: N(c.total),
    lines: c.lines.map(l => ({ id: l.id, accountId: l.accountId, account: { id: l.account.id, name: l.account.name },
      description: l.description, qty: N(l.qty), price: N(l.price) })),
  })

  // Creates or updates a claim (existing = the claim being edited)
  async function saveClaim(tx, body, existing) {
    const date = day(body.date)
    const employee = await tx.employee.findUnique({ where: { id: +body.paidById || 0 } })
    if (!employee) fail('Choose who paid')

    // Payee is optional, but if chosen it must be a supplier
    let payeeId = null
    if (orNull(body.payeeId) !== null) {
      const payee = await tx.contact.findUnique({ where: { id: +body.payeeId || 0 } })
      if (!payee || payee.type !== 'supplier') fail('Choose a valid supplier as payee')
      payeeId = payee.id
    }

    // Lines: qty x price. Empty lines are dropped. No account = Suspense.
    const suspense = await suspenseId(tx)
    const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => {
      const qty = Number(l.qty || 0), price = Number(l.price || 0)
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty < 0 || price < 0) fail('Quantity and price cannot be negative')
      return { accountId: orNull(l.accountId) === null ? suspense : +l.accountId,
        description: String(l.description || '').trim().slice(0, 200), qty: r2(qty), price: r2(price), amount: r2(qty * price) }
    }).filter(l => l.amount > 0)
    if (!lines.length) fail('Add at least one line with an amount')

    const ids = [...new Set(lines.map(l => l.accountId))]
    if ((await tx.account.count({ where: { id: { in: ids } } })) !== ids.length) fail('One of the accounts no longer exists')

    // Total is always calculated here, never taken from the page
    const total = r2(lines.reduce((s, l) => s + l.amount, 0))

    const number = existing ? existing.number : await nextNo(tx)
    if (existing) await tx.journal.deleteMany({ where: { ref: number } }) // new entry is posted below

    const data = { date, reference: String(body.reference || '').trim() || null, paidById: employee.id, payeeId, total }
    const lineRows = lines.map(l => ({ accountId: l.accountId, description: l.description, qty: l.qty, price: l.price }))
    const saved = existing
      ? await tx.expenseClaim.update({ where: { id: existing.id }, data: { ...data, lines: { deleteMany: {}, create: lineRows } } })
      : await tx.expenseClaim.create({ data: { ...data, number, lines: { create: lineRows } } })

    // Dr each expense account, Cr Employee Claims Payable
    await post(tx, { date, memo: `${number} ${employee.name}`, ref: number,
      lines: [...lines.map(l => ({ accountId: l.accountId, debit: l.amount })), { accountId: await payableId(tx), credit: total }] })
    return saved
  }

  app.get('/api/expense-claims', auth, wrap(async (req, res) => {
    const rows = await prisma.expenseClaim.findMany({ include: INCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 500 })
    res.json(rows.map(out))
  }))

  app.post('/api/expense-claims', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(tx => saveClaim(tx, req.body, null), { timeout: 20000, maxWait: 10000 })
    res.json(out(await prisma.expenseClaim.findUnique({ where: { id: saved.id }, include: INCLUDE })))
  }))

  app.put('/api/expense-claims/:id', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(async tx => {
      const old = await tx.expenseClaim.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Expense claim not found', 404)
      return saveClaim(tx, req.body, old)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(out(await prisma.expenseClaim.findUnique({ where: { id: saved.id }, include: INCLUDE })))
  }))

  app.delete('/api/expense-claims/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const old = await tx.expenseClaim.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Expense claim not found', 404)
      await tx.journal.deleteMany({ where: { ref: old.number } })
      await tx.expenseClaim.delete({ where: { id: old.id } }) // its lines are deleted with it
    })
    res.json({ ok: true })
  }))
}