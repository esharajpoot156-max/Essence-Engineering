// src/banking.js
// Banking routes: bank accounts, receipts, payments, transfers and reconciliations.
// Registered from index.js with:  banking(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf })
// Role rules (admin and accountant only) are applied in index.js.

export default function banking(app, { prisma, wrap, fail, post, auth, N, r2, balanceOf }) {
  // ---------- Small helpers ----------
  // Checks and returns a date from the request
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  // Empty values become null
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  // Next document number, e.g. REC-0001 (based on the newest number with this prefix)
  async function nextNo(tx, model, prefix) {
    const last = await tx[model].findFirst({ where: { number: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { number: true } })
    const n = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0
    return prefix + String(n + 1).padStart(4, '0')
  }
  // The Suspense account is used when a line has no account. It is created the first time it is needed.
  const suspenseId = async tx => (await tx.account.upsert({ where: { code: '1900' }, update: {}, create: { code: '1900', name: 'Suspense', type: 'asset' } })).id
  // Id of a chart account by its code
  const accountByCode = async (tx, code) => (await tx.account.findUnique({ where: { code } }))?.id
  // Your original bank account (code 1000) becomes the first bank account the first time this is called
  async function ensureDefaultBank() {
    if (await prisma.bankAccount.count() > 0) return
    const acc = await prisma.account.findUnique({ where: { code: '1000' } })
    if (!acc) return
    try { await prisma.bankAccount.create({ data: { name: acc.name, accountId: acc.id } }) } catch (e) { if (e.code !== 'P2002') throw e }
  }
  // A bank transaction that was already ticked in a reconciliation cannot be changed
  async function assertNotReconciled(tx, ref) {
    const n = await tx.journalLine.count({ where: { reconciled: true, journal: { ref } } })
    if (n > 0) fail('This transaction is part of a bank reconciliation. Delete the reconciliation first.')
  }

  // =====================================================
  // Bank and cash accounts
  // =====================================================
  // Next free code for a bank account's own chart account (1001 to 1099)
  async function nextBankCode(tx) {
    const codes = (await tx.account.findMany({ where: { code: { startsWith: '10' } }, select: { code: true } }))
      .map(a => +a.code).filter(c => c >= 1000 && c < 1100)
    const next = Math.max(1000, ...codes) + 1
    if (next >= 1100) fail('No more bank account codes are available')
    return String(next)
  }
  // Reads and checks the form fields
  const bankData = b => {
    const name = String(b.name || '').trim()
    if (!name) fail('Name is required')
    return { name, code: orNull(String(b.code || '').trim()), iban: orNull(String(b.iban || '').trim()), pending: !!b.pending,
      creditLimit: orNull(b.creditLimit) === null ? null : Math.max(0, +b.creditLimit || 0) }
  }

  app.get('/api/bank-accounts', auth, wrap(async (req, res) => {
    await ensureDefaultBank()
    const banks = await prisma.bankAccount.findMany({ orderBy: { id: 'asc' } })
    const ids = banks.map(b => b.accountId)
    // balance = all entries, clearedBalance = only entries already ticked in a reconciliation
    const [all, cleared] = await Promise.all([
      prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: ids } }, _sum: { debit: true, credit: true } }),
      prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: ids }, reconciled: true }, _sum: { debit: true, credit: true } })])
    const net = (rows, id) => { const s = rows.find(x => x.accountId === id)?._sum || {}; return r2(N(s.debit) - N(s.credit)) }
    res.json(banks.map(b => ({ id: b.id, name: b.name, code: b.code, iban: b.iban, pending: b.pending,
      creditLimit: b.creditLimit === null ? null : N(b.creditLimit), balance: net(all, b.accountId), clearedBalance: net(cleared, b.accountId) })))
  }))

  app.post('/api/bank-accounts', auth, wrap(async (req, res) => {
    await ensureDefaultBank()
    const data = bankData(req.body)
    res.json(await prisma.$transaction(async tx => {
      // Every bank account gets its own account in the chart of accounts
      const acc = await tx.account.create({ data: { code: await nextBankCode(tx), name: data.name, type: 'asset' } })
      return tx.bankAccount.create({ data: { ...data, accountId: acc.id } })
    }))
  }))

  app.put('/api/bank-accounts/:id', auth, wrap(async (req, res) => {
    const b = await prisma.bankAccount.findUnique({ where: { id: +req.params.id } })
    if (!b) fail('Bank account not found', 404)
    const data = bankData(req.body)
    res.json(await prisma.$transaction(async tx => {
      await tx.account.update({ where: { id: b.accountId }, data: { name: data.name } }) // keep the chart account name in step
      return tx.bankAccount.update({ where: { id: b.id }, data })
    }))
  }))

  app.delete('/api/bank-accounts/:id', auth, wrap(async (req, res) => {
    const b = await prisma.bankAccount.findUnique({ where: { id: +req.params.id }, include: { account: true,
      _count: { select: { payments: true, transfersOut: true, transfersIn: true, reconciliations: true } } } })
    if (!b) fail('Bank account not found', 404)
    const lines = await prisma.journalLine.count({ where: { accountId: b.accountId } })
    if (lines > 0 || Object.values(b._count).some(n => n > 0)) fail('This account has transactions and cannot be deleted')
    await prisma.$transaction(async tx => {
      await tx.bankAccount.delete({ where: { id: b.id } })
      if (b.account.code !== '1000') await tx.account.delete({ where: { id: b.accountId } }) // the original account 1000 is always kept
    })
    res.json({ ok: true })
  }))

  // Transactions of one bank account that are not yet ticked in a reconciliation.
  // amount is positive for money in and negative for money out.
  app.get('/api/bank-accounts/:id/lines', auth, wrap(async (req, res) => {
    const b = await prisma.bankAccount.findUnique({ where: { id: +req.params.id } })
    if (!b) fail('Bank account not found', 404)
    const lines = await prisma.journalLine.findMany({ where: { accountId: b.accountId, reconciled: false }, include: { journal: true },
      orderBy: [{ journal: { date: 'asc' } }, { id: 'asc' }] })
    res.json(lines.map(l => ({ id: l.id, date: l.journal.date, memo: l.journal.memo, amount: r2(N(l.debit) - N(l.credit)) })))
  }))

  // =====================================================
  // Receipts (money in) and payments (money out)
  // =====================================================
  const INCLUDE = { contact: true, bank: true, lines: { include: { account: true }, orderBy: { id: 'asc' } } }

  // Shapes a payment for the pages
  const payOut = (p, def) => {
    const bank = p.bank || def // old rows have no bank: they used the original account 1000
    return {
      id: p.id, number: p.number || `${p.kind === 'receipt' ? 'REC' : 'PAY'}-L${p.id}`, legacy: !p.number,
      date: p.date, reference: p.reference || '', description: p.description || '',
      contactId: p.contactId, contact: { id: p.contact.id, name: p.contact.name, type: p.contact.type },
      bankId: bank?.id ?? null, bankAccount: bank ? { id: bank.id, name: bank.name } : null,
      total: p.total && N(p.total) ? N(p.total) : N(p.amount),
      lines: p.lines.map(l => ({ id: l.id, accountId: l.accountId, account: { id: l.account.id, name: l.account.name },
        description: l.description, amount: N(l.amount), projectId: l.projectId })),
    }
  }

  // Creates or updates a receipt / payment (existing = the record being edited)
  async function savePayment(tx, kind, body, existing) {
    const receipt = kind === 'receipt'
    const date = day(body.date)
    const contact = await tx.contact.findUnique({ where: { id: +body.contactId || 0 } })
    if (!contact) fail(`Choose the ${receipt ? 'payer' : 'payee'}`)
    const bank = await tx.bankAccount.findUnique({ where: { id: +body.bankId || 0 } })
    if (!bank) fail('Choose a bank or cash account')

    // Lines: a line without an account goes to Suspense
    const suspense = await suspenseId(tx)
    const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => ({
      accountId: orNull(l.accountId) === null ? suspense : +l.accountId,
      description: String(l.description || '').trim().slice(0, 200),
      amount: r2(l.amount), projectId: orNull(l.projectId) === null ? null : +l.projectId,
    })).filter(l => l.amount > 0)
    if (!lines.length) fail('Add at least one line with an amount above zero')
    const ids = [...new Set(lines.map(l => l.accountId))]
    if ((await tx.account.count({ where: { id: { in: ids } } })) !== ids.length) fail('One of the accounts no longer exists')
        const pids = [...new Set(lines.map(l => l.projectId).filter(Boolean))]
    if (pids.length && (await tx.project.count({ where: { id: { in: pids } } })) !== pids.length) fail('One of the projects no longer exists')
    if (lines.some(l => l.accountId === bank.accountId)) fail('A line cannot use the same bank or cash account')
    const total = r2(lines.reduce((s, l) => s + l.amount, 0))

    // The part posted to Accounts Receivable (receipts) or Accounts Payable (payments) reduces what the contact owes
    const linkId = await accountByCode(tx, receipt ? '1100' : '2000')
    const applied = r2(lines.filter(l => l.accountId === linkId).reduce((s, l) => s + l.amount, 0))
    if (applied > 0) {
      if (contact.type !== (receipt ? 'customer' : 'supplier')) fail(receipt ? 'Lines on Accounts Receivable need a customer as the payer' : 'Lines on Accounts Payable need a supplier as the payee')
      const due = r2(await balanceOf(tx, contact.id)) + (existing && existing.contactId === contact.id ? N(existing.amount) : 0)
      if (applied > due + 0.005) fail(`The amount on ${receipt ? 'Accounts Receivable' : 'Accounts Payable'} is more than the balance due (Rs ${due.toFixed(2)})`)
    }

    // Editing: remove the old journal entry first (a new one is posted below)
    const number = existing ? existing.number : await nextNo(tx, 'payment', receipt ? 'REC-' : 'PAY-')
    if (existing) await tx.journal.deleteMany({ where: { ref: number } })

    const data = { contactId: contact.id, amount: applied, date, reference: String(body.reference || '').trim() || null,
      description: String(body.description || '').trim() || null, bankId: bank.id, total }
    const lineRows = lines.map(l => ({ accountId: l.accountId, description: l.description, amount: l.amount, projectId: l.projectId }))
    const saved = existing
      ? await tx.payment.update({ where: { id: existing.id }, data: { ...data, lines: { deleteMany: {}, create: lineRows } } })
      : await tx.payment.create({ data: { ...data, kind, number, lines: { create: lineRows } } })

    // Journal entry: receipt = Dr bank, Cr lines. Payment = Dr lines, Cr bank.
    await post(tx, { date, memo: `${number} ${contact.name}`, ref: number, lines: receipt
      ? [{ accountId: bank.accountId, debit: total }, ...lines.map(l => ({ accountId: l.accountId, credit: l.amount }))]
      : [...lines.map(l => ({ accountId: l.accountId, debit: l.amount })), { accountId: bank.accountId, credit: total }] })
    return saved
  }

  // Registers the four routes for one kind (receipt or payment)
  function paymentRoutes(path, kind) {
    const label = kind === 'receipt' ? 'receipt' : 'payment'

    app.get(`/api/${path}`, auth, wrap(async (req, res) => {
      await ensureDefaultBank()
      const def = await prisma.bankAccount.findFirst({ where: { account: { code: '1000' } } })
      const rows = await prisma.payment.findMany({ where: { kind }, include: INCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 500 })
      res.json(rows.map(p => payOut(p, def)))
    }))

    app.post(`/api/${path}`, auth, wrap(async (req, res) => {
      const saved = await prisma.$transaction(tx => savePayment(tx, kind, req.body, null), { timeout: 20000, maxWait: 10000 })
      res.json(payOut(await prisma.payment.findUnique({ where: { id: saved.id }, include: INCLUDE }), null))
    }))

    app.put(`/api/${path}/:id`, auth, wrap(async (req, res) => {
      const saved = await prisma.$transaction(async tx => {
        const old = await tx.payment.findFirst({ where: { id: +req.params.id, kind } })
        if (!old) fail(`${label[0].toUpperCase() + label.slice(1)} not found`, 404)
        if (!old.number) fail(`This ${label} was recorded from the Customers or Suppliers page and cannot be edited here`)
        await assertNotReconciled(tx, old.number)
        return savePayment(tx, kind, req.body, old)
      }, { timeout: 20000, maxWait: 10000 })
      res.json(payOut(await prisma.payment.findUnique({ where: { id: saved.id }, include: INCLUDE }), null))
    }))

    app.delete(`/api/${path}/:id`, auth, wrap(async (req, res) => {
      await prisma.$transaction(async tx => {
        const old = await tx.payment.findFirst({ where: { id: +req.params.id, kind } })
        if (!old) fail(`${label[0].toUpperCase() + label.slice(1)} not found`, 404)
        if (!old.number) fail(`This ${label} was recorded from the Customers or Suppliers page and cannot be deleted here`)
        await assertNotReconciled(tx, old.number)
        await tx.journal.deleteMany({ where: { ref: old.number } })
        await tx.payment.delete({ where: { id: old.id } }) // its lines are deleted with it
      })
      res.json({ ok: true })
    }))
  }
  paymentRoutes('receipts', 'receipt')
  paymentRoutes('bank-payments', 'payment')

  // =====================================================
  // Inter account transfers
  // =====================================================
  const TINCLUDE = { from: true, to: true }
  const transferOut = t => ({ id: t.id, number: t.number, date: t.date, reference: t.reference || '', description: t.description || '', amount: N(t.amount),
    fromId: t.fromId, toId: t.toId, from: { id: t.from.id, name: t.from.name }, to: { id: t.to.id, name: t.to.name } })

  // Creates or updates a transfer (existing = the record being edited)
  async function saveTransfer(tx, body, existing) {
    const date = day(body.date), amount = r2(body.amount)
    if (!(amount > 0)) fail('Enter an amount above zero')
    const [from, to] = await Promise.all([tx.bankAccount.findUnique({ where: { id: +body.fromId || 0 } }), tx.bankAccount.findUnique({ where: { id: +body.toId || 0 } })])
    if (!from || !to) fail('Choose both accounts')
    if (from.id === to.id) fail('The two accounts must be different')
    const number = existing ? existing.number : await nextNo(tx, 'transfer', 'TRF-')
    if (existing) await tx.journal.deleteMany({ where: { ref: number } })
    const data = { date, amount, fromId: from.id, toId: to.id, reference: String(body.reference || '').trim() || null, description: String(body.description || '').trim() || null }
    const saved = existing ? await tx.transfer.update({ where: { id: existing.id }, data }) : await tx.transfer.create({ data: { ...data, number } })
    // Dr destination account, Cr source account
    await post(tx, { date, memo: `${number} ${from.name} to ${to.name}`, ref: number,
      lines: [{ accountId: to.accountId, debit: amount }, { accountId: from.accountId, credit: amount }] })
    return saved
  }

  app.get('/api/transfers', auth, wrap(async (req, res) =>
    res.json((await prisma.transfer.findMany({ include: TINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 500 })).map(transferOut))))

  app.post('/api/transfers', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(tx => saveTransfer(tx, req.body, null), { timeout: 20000, maxWait: 10000 })
    res.json(transferOut(await prisma.transfer.findUnique({ where: { id: saved.id }, include: TINCLUDE })))
  }))

  app.put('/api/transfers/:id', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(async tx => {
      const old = await tx.transfer.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Transfer not found', 404)
      await assertNotReconciled(tx, old.number)
      return saveTransfer(tx, req.body, old)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(transferOut(await prisma.transfer.findUnique({ where: { id: saved.id }, include: TINCLUDE })))
  }))

  app.delete('/api/transfers/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const old = await tx.transfer.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Transfer not found', 404)
      await assertNotReconciled(tx, old.number)
      await tx.journal.deleteMany({ where: { ref: old.number } })
      await tx.transfer.delete({ where: { id: old.id } })
    })
    res.json({ ok: true })
  }))

  // =====================================================
  // Bank reconciliations
  // =====================================================
  app.get('/api/reconciliations', auth, wrap(async (req, res) =>
    res.json((await prisma.reconciliation.findMany({ include: { bank: true }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 200 }))
      .map(r => ({ id: r.id, date: r.date, bankId: r.bankId, bankAccount: { id: r.bank.id, name: r.bank.name }, statementBalance: N(r.statementBalance) })))))

  // Body: { date, bankId, statementBalance, lineIds }
  // The statement balance must equal (lines already cleared before + the lines ticked now).
  app.post('/api/reconciliations', auth, wrap(async (req, res) => {
    const date = day(req.body.date)
    if (orNull(req.body.statementBalance) === null || isNaN(+req.body.statementBalance)) fail('Enter the statement balance')
    const statement = r2(req.body.statementBalance)
    const lineIds = [...new Set((req.body.lineIds || []).map(Number).filter(Number.isInteger))]
    if (!lineIds.length) fail('Tick at least one transaction')
    const rec = await prisma.$transaction(async tx => {
      const bank = await tx.bankAccount.findUnique({ where: { id: +req.body.bankId || 0 } })
      if (!bank) fail('Choose a bank account')
      // Only uncleared lines of this bank account can be ticked
      const lines = await tx.journalLine.findMany({ where: { id: { in: lineIds }, accountId: bank.accountId, reconciled: false } })
      if (lines.length !== lineIds.length) fail('Some of the ticked transactions are not available any more. Reload the page and try again.')
      const before = await tx.journalLine.aggregate({ where: { accountId: bank.accountId, reconciled: true }, _sum: { debit: true, credit: true } })
      const cleared = r2(N(before._sum.debit) - N(before._sum.credit) + lines.reduce((s, l) => s + N(l.debit) - N(l.credit), 0))
      const diff = r2(statement - cleared)
      if (Math.abs(diff) > 0.005) fail(`The statement balance does not match the ticked transactions (difference of Rs ${diff.toFixed(2)})`)
      const created = await tx.reconciliation.create({ data: { date, bankId: bank.id, statementBalance: statement } })
      await tx.journalLine.updateMany({ where: { id: { in: lineIds } }, data: { reconciled: true, reconciliationId: created.id } })
      return created
    }, { timeout: 20000, maxWait: 10000 })
    res.json({ id: rec.id })
  }))

  // Deleting a reconciliation makes its transactions uncleared again
  app.delete('/api/reconciliations/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const r = await tx.reconciliation.findUnique({ where: { id: +req.params.id } })
      if (!r) fail('Reconciliation not found', 404)
      await tx.journalLine.updateMany({ where: { reconciliationId: r.id }, data: { reconciled: false, reconciliationId: null } })
      await tx.reconciliation.delete({ where: { id: r.id } })
    })
    res.json({ ok: true })
  }))
}