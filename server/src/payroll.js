// src/payroll.js
// Payslips: payslip records and the three item lists (earnings, deductions, contributions).
// Registered from index.js with:  payroll(app, { prisma, wrap, fail, auth, N, r2 })
// Role rules (admin and accountant only) are applied in index.js.
// Payslips do not post to the accounts. They only feed the employee's "Amount to pay".

export default function payroll(app, { prisma, wrap, fail, auth, N, r2 }) {
  // ---------- Small helpers ----------
  // Empty values become null
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  // Trimmed text, or null when empty
  const text = v => String(v || '').trim() || null
  // Checks and returns a date from the request
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  // Money value from the form: must be a number and not negative
  const money = v => { const x = Number(v || 0); if (!Number.isFinite(x) || x < 0) fail('Amounts must be numbers and cannot be negative'); return r2(x) }

  // The three payslip sections: request/response key -> value saved in PayslipLine.section
  const SECTIONS = { earnings: 'earning', deductions: 'deduction', contributions: 'contribution' }

  // ---------- Item lists (the three dropdowns) ----------
  // There is no page to manage these yet, so a starter list is created the first time they are opened.
  const DEFAULT_ITEMS = {
    earning: ['Basic salary', 'Overtime', 'Bonus', 'Allowance'],
    deduction: ['Income tax', 'Advance', 'Loan repayment'],
    contribution: ['EOBI (employer)', 'Provident fund (employer)'],
  }
  async function ensureItems() {
    if (await prisma.payslipItem.count() > 0) return
    const data = Object.entries(DEFAULT_ITEMS).flatMap(([kind, names]) => names.map(name => ({ kind, name })))
    await prisma.payslipItem.createMany({ data, skipDuplicates: true })
  }
  // GET /api/payslip-earnings, /api/payslip-deductions, /api/payslip-contributions -> [{ id, name }]
  for (const [key, kind] of Object.entries(SECTIONS)) {
    app.get(`/api/payslip-${key}`, auth, wrap(async (req, res) => {
      await ensureItems()
      res.json(await prisma.payslipItem.findMany({ where: { kind }, select: { id: true, name: true }, orderBy: { id: 'asc' } }))
    }))
  }

  // ---------- Payslips ----------
  const INCLUDE = { employee: true, lines: { orderBy: { id: 'asc' } } }

  // Shapes a payslip for the page
  const out = p => {
    const part = section => p.lines.filter(l => l.section === section).map(l => ({
      itemId: l.itemId, description: l.description,
      ...(section === 'earning' ? { units: l.units === null ? null : N(l.units), unitPrice: l.unitPrice === null ? null : N(l.unitPrice) } : {}),
      amount: N(l.amount),
    }))
    return {
      id: p.id, date: p.date, reference: p.reference || '', description: p.description || '',
      employeeId: p.employeeId, employeeName: p.employee.name,
      earnings: part('earning'), deductions: part('deduction'), contributions: part('contribution'),
      showTotals: p.showTotals, customTitle: p.customTitle || '', footer: p.footer || '', image: p.image || '',
      gross: N(p.gross), totalDeductions: N(p.totalDeductions), net: N(p.net),
    }
  }

  // Reads one section of the request into line rows. Empty lines are dropped.
  const readLines = (list, section) => (Array.isArray(list) ? list : []).map(l => ({
    section,
    itemId: orNull(l.itemId) === null ? null : +l.itemId,
    description: String(l.description || '').trim().slice(0, 200),
    // Units and unit price are only used by earnings
    units: section === 'earning' && orNull(l.units) !== null ? money(l.units) : null,
    unitPrice: section === 'earning' && orNull(l.unitPrice) !== null ? money(l.unitPrice) : null,
    amount: money(l.amount),
  })).filter(l => l.itemId || l.description || l.amount)

  // Creates or updates a payslip (existingId = the payslip being edited)
  async function savePayslip(tx, body, existingId) {
    const date = day(body.date)
    const employee = await tx.employee.findUnique({ where: { id: +body.employeeId || 0 } })
    if (!employee) fail('Choose an employee')

    const rows = Object.entries(SECTIONS).flatMap(([key, section]) => readLines(body[key], section))
    if (!rows.length) fail('Add at least one line with an amount')

    // Every chosen item must exist and belong to the same section
    const ids = [...new Set(rows.map(l => l.itemId).filter(Boolean))]
    const items = await tx.payslipItem.findMany({ where: { id: { in: ids } } })
    for (const l of rows) {
      if (l.itemId && items.find(i => i.id === l.itemId)?.kind !== l.section) fail('One of the selected items no longer exists')
    }

    // Totals are always calculated here, never taken from the page
    const sum = section => r2(rows.filter(l => l.section === section).reduce((s, l) => s + l.amount, 0))
    const gross = sum('earning'), totalDeductions = sum('deduction')
    if (totalDeductions > gross + 0.005) fail('Deductions cannot exceed earnings')
    const net = r2(gross - totalDeductions)

    // Optional logo is sent as a data URL (the page limits it to 1 MB)
    const image = text(body.image)
    if (image && (!image.startsWith('data:image/') || image.length > 2_000_000)) fail('The image is not valid or is too large')

    const data = { date, reference: text(body.reference), description: text(body.description), employeeId: employee.id,
      showTotals: !!body.showTotals, customTitle: text(body.customTitle), footer: text(body.footer), image, gross, totalDeductions, net }
    // Editing replaces all old lines with the new ones
    return existingId
      ? tx.payslip.update({ where: { id: existingId }, data: { ...data, lines: { deleteMany: {}, create: rows } } })
      : tx.payslip.create({ data: { ...data, lines: { create: rows } } })
  }

  app.get('/api/payslips', auth, wrap(async (req, res) => {
    const rows = await prisma.payslip.findMany({ include: INCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })
    res.json(rows.map(out))
  }))

  app.post('/api/payslips', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(tx => savePayslip(tx, req.body, null), { timeout: 20000, maxWait: 10000 })
    res.json(out(await prisma.payslip.findUnique({ where: { id: saved.id }, include: INCLUDE })))
  }))

  app.put('/api/payslips/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    const saved = await prisma.$transaction(async tx => {
      if (!(await tx.payslip.findUnique({ where: { id } }))) fail('Payslip not found', 404)
      return savePayslip(tx, req.body, id)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(out(await prisma.payslip.findUnique({ where: { id: saved.id }, include: INCLUDE })))
  }))

  app.delete('/api/payslips/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.payslip.findUnique({ where: { id } }))) fail('Payslip not found', 404)
    await prisma.payslip.delete({ where: { id } }) // its lines are deleted with it
    res.json({ ok: true })
  }))
}