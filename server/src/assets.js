// src/assets.js
// Fixed Assets and Depreciation Entries.
// Registered from index.js with:  assets(app, { prisma, wrap, fail, post, auth, N, r2 })
// Role rules (admin and accountant only) are applied in index.js.
//
// A fixed asset record does NOT post to the books. Record the purchase itself on a purchase invoice
// or a payment, using the account 1500 Fixed Assets on the line.
// Each depreciation entry posts one balanced journal entry:
//   Dr 6200 Depreciation Expense
//   Cr 1510 Accumulated Depreciation   (shown as a negative amount under assets)
// These three accounts are created the first time they are needed.

export default function assets(app, { prisma, wrap, fail, post, auth, N, r2 }) {
  // ---------- Small helpers ----------
  const orNull = v => (v === undefined || v === null || v === '' ? null : v)
  const text = v => String(v || '').trim() || null
  const day = v => { const d = new Date(v); if (!v || isNaN(d)) fail('Enter a valid date'); return d }
  const METHODS = ['straight', 'none']
  // Next document number, e.g. DEP-0001 (based on the newest number)
  async function nextNo(tx, prefix) {
    const last = await tx.depreciation.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { number: true } })
    const n = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0
    return prefix + String(n + 1).padStart(4, '0')
  }
  // Chart accounts used here. Works with prisma or a transaction client.
  const acct = async (db, code, name, type) => (await db.account.upsert({ where: { code }, update: {}, create: { code, name, type } })).id
  const ensureAccounts = db => Promise.all([
    acct(db, '1500', 'Fixed Assets', 'asset'),
    acct(db, '1510', 'Accumulated Depreciation', 'asset'),
    acct(db, '6200', 'Depreciation Expense', 'expense')])

  // =====================================================
  // Fixed assets
  // =====================================================
  // Reads and checks the form fields
  const assetData = b => {
    const name = String(b.name || '').trim()
    if (!name) fail('Asset name is required')
    const cost = Number(b.cost || 0), residual = Number(b.residualValue || 0), life = Number(b.usefulLifeYears || 0)
    if (![cost, residual, life].every(Number.isFinite)) fail('Cost, residual value and useful life must be numbers')
    if (cost < 0) fail('Cost cannot be negative')
    if (residual < 0 || residual > cost) fail('Residual value cannot exceed the asset cost')
    if (life < 0 || life > 100) fail('Useful life must be between 0 and 100 years')
    const method = METHODS.includes(b.method) ? b.method : 'straight'
    if (method === 'straight' && !(life > 0)) fail('Enter the useful life in years for the straight-line method')
    return { code: text(b.code), name, description: text(b.description), purchaseDate: orNull(b.purchaseDate) === null ? null : day(b.purchaseDate),
      cost: r2(cost), residualValue: r2(residual), usefulLifeYears: r2(life), method, notes: text(b.notes) }
  }
  const assetOut = (a, accumulated) => ({ id: a.id, code: a.code, name: a.name, description: a.description, purchaseDate: a.purchaseDate,
    cost: N(a.cost), residualValue: N(a.residualValue), usefulLifeYears: N(a.usefulLifeYears), method: a.method, notes: a.notes,
    accumulated: r2(accumulated || 0) })
  // Total depreciation recorded for one asset (excludeId = a depreciation entry that is being edited)
  async function accumulatedOf(db, assetId, excludeId = 0) {
    const s = await db.depreciation.aggregate({ where: { assetId, id: { not: excludeId } }, _sum: { amount: true } })
    return N(s._sum.amount)
  }

  app.get('/api/fixed-assets', auth, wrap(async (req, res) => {
    await ensureAccounts(prisma)
    const [rows, sums] = await Promise.all([
      prisma.fixedAsset.findMany({ orderBy: { name: 'asc' } }),
      prisma.depreciation.groupBy({ by: ['assetId'], _sum: { amount: true } })])
    res.json(rows.map(a => assetOut(a, N(sums.find(s => s.assetId === a.id)?._sum.amount))))
  }))

  app.post('/api/fixed-assets', auth, wrap(async (req, res) => {
    res.json(assetOut(await prisma.fixedAsset.create({ data: assetData(req.body) }), 0))
  }))

  app.put('/api/fixed-assets/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.fixedAsset.findUnique({ where: { id } }))) fail('Fixed asset not found', 404)
    const data = assetData(req.body)
    // Depreciation already recorded must still fit inside the new cost minus residual value
    const accumulated = await accumulatedOf(prisma, id)
    if (accumulated > data.cost - data.residualValue + 0.005) fail(`Depreciation already recorded (Rs ${accumulated.toFixed(2)}) is more than the new cost minus residual value`)
    res.json(assetOut(await prisma.fixedAsset.update({ where: { id }, data }), accumulated))
  }))

  app.delete('/api/fixed-assets/:id', auth, wrap(async (req, res) => {
    const id = +req.params.id
    if (!(await prisma.fixedAsset.findUnique({ where: { id } }))) fail('Fixed asset not found', 404)
    if (await prisma.depreciation.count({ where: { assetId: id } }) > 0) fail('This asset has depreciation entries. Delete them first.')
    await prisma.fixedAsset.delete({ where: { id } })
    res.json({ ok: true })
  }))

  // =====================================================
  // Depreciation entries
  // =====================================================
  const DINCLUDE = { asset: true }
  const depOut = d => ({ id: d.id, number: d.number, date: d.date, reference: d.reference || '', description: d.description || '',
    assetId: d.assetId, assetName: d.asset.name, amount: N(d.amount) })

  // Creates or updates a depreciation entry (existing = the entry being edited)
  async function saveDep(tx, body, existing) {
    const date = day(body.date)
    const asset = await tx.fixedAsset.findUnique({ where: { id: +body.assetId || 0 } })
    if (!asset) fail('Please select a fixed asset')
    if (asset.method === 'none') fail('This asset is set to "No depreciation"')
    const amount = r2(body.amount)
    if (!(amount > 0)) fail('Enter an amount above zero')
    if (asset.purchaseDate && date < asset.purchaseDate) fail('The depreciation date cannot be before the purchase date')

    // Total depreciation can never go above cost minus residual value
    const others = await accumulatedOf(tx, asset.id, existing ? existing.id : 0)
    const left = r2(N(asset.cost) - N(asset.residualValue) - others)
    if (amount > left + 0.005) fail(`The amount is more than the depreciation left for this asset (Rs ${Math.max(left, 0).toFixed(2)})`)

    const number = existing ? existing.number : await nextNo(tx, 'DEP-')
    if (existing) await tx.journal.deleteMany({ where: { ref: number } }) // new entry is posted below
    const data = { date, reference: text(body.reference), description: text(body.description), assetId: asset.id, amount }
    const saved = existing ? await tx.depreciation.update({ where: { id: existing.id }, data }) : await tx.depreciation.create({ data: { ...data, number } })

    const [, accumulated, expense] = await ensureAccounts(tx)
    await post(tx, { date, memo: `${number} ${asset.name}`, ref: number,
      lines: [{ accountId: expense, debit: amount }, { accountId: accumulated, credit: amount }] })
    return saved
  }

  app.get('/api/depreciation', auth, wrap(async (req, res) =>
    res.json((await prisma.depreciation.findMany({ include: DINCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1000 })).map(depOut))))

  app.post('/api/depreciation', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(tx => saveDep(tx, req.body, null), { timeout: 20000, maxWait: 10000 })
    res.json(depOut(await prisma.depreciation.findUnique({ where: { id: saved.id }, include: DINCLUDE })))
  }))

  app.put('/api/depreciation/:id', auth, wrap(async (req, res) => {
    const saved = await prisma.$transaction(async tx => {
      const old = await tx.depreciation.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Depreciation entry not found', 404)
      return saveDep(tx, req.body, old)
    }, { timeout: 20000, maxWait: 10000 })
    res.json(depOut(await prisma.depreciation.findUnique({ where: { id: saved.id }, include: DINCLUDE })))
  }))

  app.delete('/api/depreciation/:id', auth, wrap(async (req, res) => {
    await prisma.$transaction(async tx => {
      const old = await tx.depreciation.findUnique({ where: { id: +req.params.id } })
      if (!old) fail('Depreciation entry not found', 404)
      await tx.journal.deleteMany({ where: { ref: old.number } })
      await tx.depreciation.delete({ where: { id: old.id } })
    })
    res.json({ ok: true })
  }))
}