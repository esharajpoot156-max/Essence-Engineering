// src/reports.js
// Profit and Loss and Cash Flow Statement. Both are calculated from the journal entries.
// Registered from index.js with:  reports(app, { prisma, wrap, fail, auth, N, r2 })
// Role rule (admin and accountant only) is already applied in index.js because the path starts with /reports.
//
//   GET /api/reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
//       -> { income: [{ code, name, amount }], expenses: [{ code, name, amount }] }
//   GET /api/reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
//       -> { opening, inflows: [{ name, amount }], outflows: [{ name, amount }], closing }
// "from" and "to" are both optional. Leave them out for "All time".

export default function reports(app, { prisma, wrap, fail, auth, N, r2 }) {
  const DATE = /^\d{4}-\d{2}-\d{2}$/

  // Reads and checks ?from= and ?to=. Same day handling as the trial balance (whole days, UTC).
  const readRange = q => {
    for (const k of ['from', 'to']) if (q[k] && !DATE.test(q[k])) fail('Dates must look like 2026-11-14')
    if (q.from && q.to && q.from > q.to) fail('"From" cannot be after "To"')
    return {
      from: q.from ? new Date(q.from + 'T00:00:00.000Z') : null,
      to: q.to ? new Date(q.to + 'T23:59:59.999Z') : null,
    }
  }
  // Prisma date filter for a range ({} when the range is open on both sides)
  const dateFilter = ({ from, to }) => ({ ...(from && { gte: from }), ...(to && { lte: to }) })
  // Journal filter used on journal lines (left out completely for "All time")
  const hasRange = r => !!(r.from || r.to)
  const journalWhere = range => (hasRange(range) ? { journal: { date: dateFilter(range) } } : {})

  // =====================================================
  // Profit and Loss: income less expenses in the period
  // =====================================================
  app.get('/api/reports/profit-and-loss', auth, wrap(async (req, res) => {
    const range = readRange(req.query)
    const accounts = await prisma.account.findMany({ where: { type: { in: ['income', 'expense'] } }, orderBy: { code: 'asc' } })
    const sums = await prisma.journalLine.groupBy({
      by: ['accountId'], _sum: { debit: true, credit: true },
      where: { accountId: { in: accounts.map(a => a.id) }, ...journalWhere(range) },
    })

    // Income accounts are positive on the credit side, expense accounts on the debit side
    const rows = type => accounts.filter(a => a.type === type).map(a => {
      const s = sums.find(x => x.accountId === a.id)?._sum || {}
      const amount = type === 'income' ? N(s.credit) - N(s.debit) : N(s.debit) - N(s.credit)
      return { code: a.code, name: a.name, amount: r2(amount) }
    }).filter(r => r.amount !== 0) // accounts with nothing in the period are left out

    res.json({ income: rows('income'), expenses: rows('expense') })
  }))

  // =====================================================
  // Cash Flow Statement: cash received and paid through the bank and cash accounts
  // =====================================================
  // Bank and cash accounts are the chart accounts 1000 to 1099 (same rule as the dashboard).
  // For every journal entry that touches a cash account, each OTHER line shows where the cash came from
  // or went to. Example: Receipt  Dr Bank 3,200 / Cr Accounts Receivable 3,200  -> cash received from Accounts Receivable.
  // Transfers between two cash accounts have no other line, so they cancel out and do not show.
  app.get('/api/reports/cash-flow', auth, wrap(async (req, res) => {
    const range = readRange(req.query)
    const cash = await prisma.account.findMany({ where: { code: { gte: '1000', lte: '1099' } }, select: { id: true } })
    const cashIds = new Set(cash.map(a => a.id))

    // Opening balance = all cash movements before "from" (0 when the range starts at the beginning)
    let opening = 0
    if (range.from) {
      const o = await prisma.journalLine.aggregate({
        _sum: { debit: true, credit: true },
        where: { accountId: { in: [...cashIds] }, journal: { date: { lt: range.from } } },
      })
      opening = N(o._sum.debit) - N(o._sum.credit)
    }

    // Every entry in the period that touches a cash account
    const journals = await prisma.journal.findMany({
      where: { ...(hasRange(range) && { date: dateFilter(range) }), lines: { some: { accountId: { in: [...cashIds] } } } },
      include: { lines: { include: { account: true } } },
    })

    // Cash effect per other account: credit - debit (positive = cash came in, negative = cash went out)
    const byAccount = new Map()
    for (const j of journals) for (const l of j.lines) {
      if (cashIds.has(l.accountId)) continue
      const cur = byAccount.get(l.accountId) || { code: l.account.code, name: l.account.name, effect: 0 }
      cur.effect += N(l.credit) - N(l.debit)
      byAccount.set(l.accountId, cur)
    }
    const all = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code))
    const inflows = all.filter(a => r2(a.effect) > 0).map(a => ({ code: a.code, name: a.name, amount: r2(a.effect) }))
    const outflows = all.filter(a => r2(a.effect) < 0).map(a => ({ code: a.code, name: a.name, amount: r2(-a.effect) }))

    const net = inflows.reduce((s, r) => s + r.amount, 0) - outflows.reduce((s, r) => s + r.amount, 0)
    res.json({ opening: r2(opening), inflows, outflows, closing: r2(opening + net) })
  }))
}