// src/employees.js
// Employees: staff list and the "Amount to pay" panel.
// Registered from index.js with:  employees(app, { prisma, wrap, fail, auth, N, r2 })
// Role rules (admin and accountant only) are applied in index.js.

export default function employees(app, { prisma, wrap, fail, auth, N, r2 }) {
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)

  // Reads and checks the form fields
  const data = b => {
    const name = String(b.name || '').trim()
    if (!name) fail('Employee name is required')
    let joiningDate = null
    if (orNull(b.joiningDate) !== null) {
      joiningDate = new Date(b.joiningDate)
      if (isNaN(joiningDate)) fail('Enter a valid joining date')
    }
    const salary = orNull(b.basicSalary) === null ? 0 : +b.basicSalary
    if (isNaN(salary) || salary < 0) fail('Salary cannot be negative')
    const text = v => String(v || '').trim() || null
    return { name, code: text(b.code), jobTitle: text(b.jobTitle), phone: text(b.phone), email: text(b.email),
      joiningDate, basicSalary: r2(salary), address: text(b.address), notes: text(b.notes) }
  }

  // Amount to pay = payslips + expense claims - payments.
  // Payments to employees are not built yet, so paid is 0 for now.
  async function amountToPay(employeeId) {
    const [slips, claimsAgg] = await Promise.all([
      prisma.payslip.aggregate({ where: { employeeId }, _sum: { net: true } }),
      prisma.expenseClaim.aggregate({ where: { paidById: employeeId }, _sum: { total: true } })])
    const payslips = N(slips._sum.net), claims = N(claimsAgg._sum.total), paid = 0
    return { payslips: r2(payslips), claims: r2(claims), paid: r2(paid), balance: r2(payslips + claims - paid) }
  }

  const out = async e => ({ id: e.id, name: e.name, code: e.code, jobTitle: e.jobTitle, phone: e.phone, email: e.email,
    joiningDate: e.joiningDate, basicSalary: N(e.basicSalary), address: e.address, notes: e.notes,
    balance: (await amountToPay(e.id)).balance })

  app.get('/api/employees', auth, wrap(async (req, res) => {
    const rows = await prisma.employee.findMany({ orderBy: { name: 'asc' } })
    res.json(await Promise.all(rows.map(out)))
  }))

  app.post('/api/employees', auth, wrap(async (req, res) => {
    res.json(await out(await prisma.employee.create({ data: data(req.body) })))
  }))

  app.put('/api/employees/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.employee.findUnique({ where: { id } }))) fail('Employee not found', 404)
    res.json(await out(await prisma.employee.update({ where: { id }, data: data(req.body) })))
  }))

  app.delete('/api/employees/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.employee.findUnique({ where: { id } }))) fail('Employee not found', 404)
      const { payslips, claims, paid } = await amountToPay(id)
    if (payslips > 0 || claims > 0 || paid > 0) fail('This employee has payslips, expense claims or payments and cannot be deleted')
    await prisma.employee.delete({ where: { id } })
    res.json({ ok: true })
  }))

  app.get('/api/employees/:id/amount-to-pay', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.employee.findUnique({ where: { id } }))) fail('Employee not found', 404)
    res.json(await amountToPay(id))
  }))
}