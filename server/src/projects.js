// src/projects.js
// Projects: group income and expenses by job (the same columns as the Manager Projects page).
// Registered from index.js with:  projects(app, { prisma, wrap, fail, auth, N, r2 })
// Role rules are applied in index.js (everyone can read, only admin and accountant can change).
//
// income   = sales invoice lines tagged with the project
//          + receipt lines on income accounts  - payment lines on income accounts
// expenses = purchase invoice lines tagged with the project that have no inventory item
//          + payment lines on expense accounts - receipt lines on expense accounts
// profit   = income - expenses
//
// stockCost = the cost of the stock that was sold on the project (Manager adds it to the project expenses).
// Your software does not calculate stock cost for the imported invoices, so it is stored on the project
// (copy it from the Expenses column of the Manager Projects page) and added to the expenses here.

export default function projects(app, { prisma, wrap, fail, auth, N, r2 }) {
  const data = b => {
    const name = String(b.name || '').trim()
    if (!name) fail('Project name is required')
    const out = { name, code: String(b.code || '').trim() || null, active: b.active === undefined ? true : !!b.active }
    // Only changed when the request sends it, so saving a project from an old form never wipes the value
    if (b.stockCost !== undefined && b.stockCost !== null && b.stockCost !== '') {
      const cost = Number(b.stockCost)
      if (!Number.isFinite(cost) || cost < 0) fail('Stock cost must be a number and cannot be negative')
      out.stockCost = r2(cost)
    }
    return out
  }

  // Amount of one invoice line: qty x price x (1 - discount %)
  const lineAmount = l => N(l.qty) * N(l.price) * (1 - N(l.discount) / 100)

  // Income and expenses of every project that has tagged lines
  async function totalsByProject() {
    const [invoiceLines, paymentLines] = await Promise.all([
      prisma.invoiceLine.findMany({
        where: { projectId: { not: null }, invoice: { status: 'active' } },
        select: { projectId: true, itemId: true, qty: true, price: true, discount: true, invoice: { select: { kind: true } } } }),
      prisma.paymentLine.findMany({
        where: { projectId: { not: null } },
        select: { projectId: true, amount: true, payment: { select: { kind: true } }, account: { select: { type: true } } } }),
    ])
    const totals = new Map()
    const of = id => totals.get(id) || totals.set(id, { income: 0, expenses: 0 }).get(id)

    // Sales invoices are income. On purchase invoices only lines WITHOUT an inventory item are expenses:
    // an inventory item that is bought goes into stock and becomes an expense only when it is sold (like in Manager).
    for (const l of invoiceLines) {
      const t = of(l.projectId), amt = lineAmount(l)
      if (l.invoice.kind === 'sale') t.income += amt
      else if (l.invoice.kind === 'purchase' && !l.itemId) t.expenses += amt
    }
    // Receipt and payment lines count by the type of their account
    for (const l of paymentLines) {
      const t = of(l.projectId), receipt = l.payment.kind === 'receipt', amt = N(l.amount)
      if (l.account.type === 'income') t.income += receipt ? amt : -amt
      else if (l.account.type === 'expense') t.expenses += receipt ? -amt : amt
    }
    return totals
  }

  const out = (p, totals) => {
    const t = totals?.get(p.id) || { income: 0, expenses: 0 }
    const stockCost = N(p.stockCost), expenses = t.expenses + stockCost
    return { id: p.id, name: p.name, code: p.code, active: p.active, stockCost: r2(stockCost), income: r2(t.income), expenses: r2(expenses), profit: r2(t.income - expenses) }
  }

  // Active projects first (A to Z), inactive ones at the end (shown in grey by the page)
  app.get('/api/projects', auth, wrap(async (req, res) => {
    const [rows, totals] = await Promise.all([prisma.project.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }), totalsByProject()])
    res.json(rows.map(p => out(p, totals)))
  }))

  app.post('/api/projects', auth, wrap(async (req, res) => {
    res.json(out(await prisma.project.create({ data: data(req.body) })))
  }))

  app.put('/api/projects/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.project.findUnique({ where: { id } }))) fail('Project not found', 404)
    const [row, totals] = await Promise.all([prisma.project.update({ where: { id }, data: data(req.body) }), totalsByProject()])
    res.json(out(row, totals))
  }))

  app.delete('/api/projects/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.project.findUnique({ where: { id } }))) fail('Project not found', 404)
    // A project that is already used is kept, so those records never lose their project
    const used = (await prisma.paymentLine.count({ where: { projectId: id } })) + (await prisma.invoiceLine.count({ where: { projectId: id } }))
    if (used > 0) fail('This project is used by invoices, receipts or payments and cannot be deleted')
    await prisma.project.delete({ where: { id } })
    res.json({ ok: true })
  }))
}