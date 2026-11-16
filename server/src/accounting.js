// src/accounting.js
// Capital Accounts, Special Accounts, Investments and the sidebar record counts (/counts).
// Registered from index.js with:  accounting(app, { prisma, wrap, fail, auth, N, r2 })
// Role rules (admin and accountant only) for the three account pages are applied in index.js.
//
// No new tables are needed. Each capital account and investment IS an account in the chart of accounts:
//   Capital Accounts  -> accounts of type "equity" (codes 3001 to 3999; 3000 Owner Equity is the first one)
//   Investments       -> accounts of type "asset" with codes 1600 to 1699
//   Special Accounts  -> the accounts the software posts to by itself (Receivable, Payable, Suspense, Rounding ...).
//                        They can be renamed, but not added, re-coded or deleted.
// Balances always come from the journal.

export default function accounting(app, { prisma, wrap, fail, auth, N, r2 }) {
  // ---------- Small helpers ----------
  const text = v => String(v || '').trim()

  // Balance of each account from the journal. Debit accounts show debit - credit, the others credit - debit.
  async function balances(accounts) {
    const sums = await prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: accounts.map(a => a.id) } }, _sum: { debit: true, credit: true } })
    return new Map(accounts.map(a => {
      const s = sums.find(x => x.accountId === a.id)?._sum || {}
      const net = N(s.debit) - N(s.credit)
      return [a.id, r2(['asset', 'expense'].includes(a.type) ? net : -net)]
    }))
  }
  const out = (a, bal) => ({ id: a.id, name: a.name, code: a.code, balance: bal.get(a.id) ?? 0 })

  // Next free code inside a range, e.g. 3001 to 3999
  async function nextCode(min, max) {
    const rows = await prisma.account.findMany({ where: { code: { gte: String(min), lte: String(max) } }, select: { code: true } })
    const next = Math.max(min - 1, ...rows.map(r => +r.code).filter(Number.isFinite)) + 1
    if (next > max) fail(`No more account codes are available between ${min} and ${max}`)
    return String(next)
  }

  // =====================================================
  // Capital Accounts and Investments (real chart accounts)
  // =====================================================
  const KINDS = {
    'capital-accounts': { type: 'equity', min: 3001, max: 3999, pattern: /^3\d{3}$/, hint: 'Capital account codes must have 4 digits and start with 3 (for example 3010)',
      where: { type: 'equity' }, protectedCode: '3000', label: 'Capital account' },
    investments: { type: 'asset', min: 1600, max: 1699, pattern: /^16\d{2}$/, hint: 'Investment codes must be between 1600 and 1699',
      where: { type: 'asset', code: { gte: '1600', lte: '1699' } }, protectedCode: null, label: 'Investment' },
  }

  for (const [path, k] of Object.entries(KINDS)) {
    // Reads and checks the form. A code is optional: the next free one is used when it is empty.
    const readForm = async (b, existing) => {
      const name = text(b.name)
      if (!name) fail('Name is required')
      let code = text(b.code)
      if (!code) code = existing ? existing.code : await nextCode(k.min, k.max)
      if (!k.pattern.test(code)) fail(k.hint)
      const clash = await prisma.account.findUnique({ where: { code } })
      if (clash && (!existing || clash.id !== existing.id)) fail('This code is already used by another account')
      return { name, code }
    }

    app.get(`/api/${path}`, auth, wrap(async (req, res) => {
      const rows = await prisma.account.findMany({ where: k.where, orderBy: { code: 'asc' } })
      const bal = await balances(rows)
      res.json(rows.map(a => out(a, bal)))
    }))

    app.post(`/api/${path}`, auth, wrap(async (req, res) => {
      const data = await readForm(req.body, null)
      const a = await prisma.account.create({ data: { ...data, type: k.type } })
      res.json(out(a, new Map()))
    }))

    app.put(`/api/${path}/:id`, auth, wrap(async (req, res) => {
      const old = await prisma.account.findFirst({ where: { id: +req.params.id, ...k.where } })
      if (!old) fail(`${k.label} not found`, 404)
      const data = await readForm(req.body, old)
      if (old.code === k.protectedCode && data.code !== old.code) fail('The code of this account cannot be changed')
      const a = await prisma.account.update({ where: { id: old.id }, data })
      res.json(out(a, await balances([a])))
    }))

    app.delete(`/api/${path}/:id`, auth, wrap(async (req, res) => {
      const old = await prisma.account.findFirst({ where: { id: +req.params.id, ...k.where } })
      if (!old) fail(`${k.label} not found`, 404)
      if (old.code === k.protectedCode) fail('This account is used by the software and cannot be deleted')
      if (await prisma.journalLine.count({ where: { accountId: old.id } }) > 0) fail('This account has transactions and cannot be deleted')
      await prisma.account.delete({ where: { id: old.id } }) // other records that use it block this with the standard "used by other records" message
      res.json({ ok: true })
    }))
  }

  // =====================================================
  // Special Accounts (accounts the software posts to by itself)
  // =====================================================
  // Receivable, Inventory, Input Tax, Payable, Sales Tax Payable, Sales, Cost of Goods Sold, General Expenses, Suspense, Rounding
  const SPECIAL = ['1100', '1200', '1300', '1900', '2000', '2100', '4000', '5000', '6000', '6900']
  const specialRows = () => prisma.account.findMany({ where: { code: { in: SPECIAL } }, orderBy: { code: 'asc' } })

  app.get('/api/special-accounts', auth, wrap(async (req, res) => {
    const rows = await specialRows()
    const bal = await balances(rows)
    res.json(rows.map(a => out(a, bal)))
  }))
  app.post('/api/special-accounts', auth, wrap(async () => fail('Special accounts are created by the software and cannot be added')))
  // Only the name can change: the software finds these accounts by their code
  app.put('/api/special-accounts/:id', auth, wrap(async (req, res) => {
    const old = await prisma.account.findFirst({ where: { id: +req.params.id, code: { in: SPECIAL } } })
    if (!old) fail('Special account not found', 404)
    const name = text(req.body.name)
    if (!name) fail('Name is required')
    if (text(req.body.code) && text(req.body.code) !== old.code) fail('The code of a special account cannot be changed')
    const a = await prisma.account.update({ where: { id: old.id }, data: { name } })
    res.json(out(a, await balances([a])))
  }))
  app.delete('/api/special-accounts/:id', auth, wrap(async () => fail('Special accounts are used by the software and cannot be deleted')))

  // =====================================================
  // Sidebar counts: { '/receipts': 12, ... } (keys are the menu paths; only pages the person may open)
  // =====================================================
  app.get('/api/counts', auth, wrap(async (req, res) => {
    const role = req.user.role
    const can = (...roles) => roles.includes(role)
    const contact = type => () => prisma.contact.count({ where: { type } })
    const doc = kind => () => prisma.salesDoc.count({ where: { kind } })
    const payment = kind => () => prisma.payment.count({ where: { kind } })
    const invoice = kind => () => prisma.invoice.count({ where: { kind, status: 'active' } })
    const BOOKS = ['admin', 'accountant'], SALES = ['admin', 'accountant', 'sales'], LEADS = ['admin', 'sales']

    const table = [
      [BOOKS, '/bank-accounts', () => prisma.bankAccount.count()],
      [BOOKS, '/receipts', payment('receipt')],
      [BOOKS, '/payments', payment('payment')],
      [BOOKS, '/transfers', () => prisma.transfer.count()],
      [BOOKS, '/reconciliations', () => prisma.reconciliation.count()],
      [BOOKS, '/expense-claims', () => prisma.expenseClaim.count()],
      [SALES, '/customers', contact('customer')],
      [SALES, '/sales-quotes', doc('quote')],
      [SALES, '/sales-orders', doc('order')],
      [SALES, '/sales-invoices', invoice('sale')],
      [SALES, '/delivery-notes', doc('delivery')],
      [BOOKS, '/credit-notes', () => prisma.creditNote.count()],
      [BOOKS, '/suppliers', contact('supplier')],
      [BOOKS, '/purchase-quotes', doc('pquote')],
      [BOOKS, '/purchase-orders', doc('porder')],
      [BOOKS, '/purchase-invoices', invoice('purchase')],
      [BOOKS, '/goods-receipts', doc('greceipt')],
      [BOOKS, '/inventory', () => prisma.item.count()],
      [BOOKS, '/projects', () => prisma.project.count()],
      [BOOKS, '/employees', () => prisma.employee.count()],
      [BOOKS, '/payslips', () => prisma.payslip.count()],
      [BOOKS, '/fixed-assets', () => prisma.fixedAsset.count()],
      [BOOKS, '/depreciation', () => prisma.depreciation.count()],
      [BOOKS, '/capital-accounts', () => prisma.account.count({ where: KINDS['capital-accounts'].where })],
      [BOOKS, '/special-accounts', () => prisma.account.count({ where: { code: { in: SPECIAL } } })],
      [BOOKS, '/investments', () => prisma.account.count({ where: KINDS.investments.where })],
      [LEADS, '/leads', () => prisma.lead.count()],
    ].filter(([roles]) => can(...roles))

    const values = await Promise.all(table.map(([, , count]) => count()))
    res.json(Object.fromEntries(table.map(([, path], i) => [path, values[i]])))
  }))
}