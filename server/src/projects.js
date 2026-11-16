// src/projects.js
// Projects: group income and expenses by job.
// Registered from index.js with:  projects(app, { prisma, wrap, fail, auth, N, r2 })
// Role rules are applied in index.js (everyone can read, only admin and accountant can change).
//
// income   = receipt lines on income accounts   - payment lines on income accounts
// expenses = payment lines on expense accounts  - receipt lines on expense accounts
// (Sales and purchase documents will be added here when they carry a projectId.)

export default function projects(app, { prisma, wrap, fail, auth, N, r2 }) {
  const data = b => {
    const name = String(b.name || '').trim()
    if (!name) fail('Project name is required')
    return { name, code: String(b.code || '').trim() || null }
  }

  // Totals of income and expenses for every project that has tagged lines
  async function totalsByProject() {
    const lines = await prisma.paymentLine.findMany({
      where: { projectId: { not: null } },
      select: { projectId: true, amount: true, payment: { select: { kind: true } }, account: { select: { type: true } } } })
    const totals = new Map()
    for (const l of lines) {
      const t = totals.get(l.projectId) || { income: 0, expenses: 0 }
      const receipt = l.payment.kind === 'receipt', amt = N(l.amount)
      if (l.account.type === 'income') t.income += receipt ? amt : -amt
      else if (l.account.type === 'expense') t.expenses += receipt ? -amt : amt
      totals.set(l.projectId, t)
    }
    return totals
  }
  const out = (p, totals) => {
    const t = totals?.get(p.id) || { income: 0, expenses: 0 }
    return { id: p.id, name: p.name, code: p.code, income: r2(t.income), expenses: r2(t.expenses) }
  }

  app.get('/api/projects', auth, wrap(async (req, res) => {
    const [rows, totals] = await Promise.all([prisma.project.findMany({ orderBy: { name: 'asc' } }), totalsByProject()])
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
    // A project that is already used on receipts or payments is kept, so those records never lose their project
    if (await prisma.paymentLine.count({ where: { projectId: id } }) > 0) fail('This project is used by receipts or payments and cannot be deleted')
    await prisma.project.delete({ where: { id } })
    res.json({ ok: true })
  }))
}