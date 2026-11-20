// src/manager/import.js
// Step 1 of the Manager import: customers, suppliers, items, projects, employees, payslips, sales quotes, sales orders,
// delivery notes, purchase quotes, purchase orders and goods receipts.
// None of these touch the accounts or the stock, so it is safe to run.
//
//   const report = await importBasics(prisma, data, { dryRun: true })   // data = result of readManager()
//
// dryRun = true  -> works everything out, saves NOTHING, and returns the report.
// dryRun = false -> saves everything in ONE transaction (all or nothing).
// Running it twice is safe: contacts, items, projects and employees that already exist (same name) are reused,
// payslips that already exist are skipped, and quotes whose number already exists are skipped.

export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100
const clean = v => { const s = String(v ?? '').trim(); return s || null }
const addTo = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v)
const PLACEHOLDER = 'Unknown customer'
const PLACEHOLDER_SUPPLIER = 'Unknown supplier'

// Cost of the stock sold on each project, copied from the Expenses column of Manager's Projects page.
// Manager works this out itself (FIFO), so it cannot be read from the file. It is saved on the project and added to its expenses.
const STOCK_COST = {
  'Imran': 331241.24,
  'Khuram Shehzad': 580554.88,
  'NRMT Solarization of Tubewells': 528000,
  'NRMT tube wells solarization': 88000,
}

// Our software stores whole-number quantities, prices with 2 decimals, and a line discount as a PERCENT (Manager uses an AMOUNT).
// A line is saved as it is when that is exact: a whole quantity, a 2-decimal price and (if there is a discount) an exact 2-decimal percent.
// Otherwise it becomes 1 x the net amount, so the total stays exactly the same as in Manager. The original is written in the description.
export function fitLine(l) {
  const disc = l.discount || 0, gross = l.qty * l.price
  const cents = Math.abs(l.price * 100 - Math.round(l.price * 100)) < 1e-6      // our prices keep 2 decimals only
  if (Number.isInteger(l.qty) && l.qty >= 1 && cents) {
    if (!disc) return { qty: l.qty, price: l.price, discount: 0, description: l.description, changed: false }
    const pct = gross > 0 ? Math.round(disc / gross * 10000) / 100 : NaN
    if (pct > 0 && pct <= 100 && Math.abs(r2(gross * (1 - pct / 100)) - r2(gross - disc)) < 0.005)
      return { qty: l.qty, price: l.price, discount: pct, description: l.description, changed: false }
  }
  const net = r2(gross - disc)
  // a discount on a line with no price (e.g. "Discount if any") is simply a negative amount
  const note = gross === 0 ? '' : disc ? ` (qty ${l.qty} x ${l.price}, discount ${disc})` : ` (qty ${l.qty} x ${l.price})`
  return { qty: 1, price: net, discount: 0, description: (l.description || '') + note, changed: true }
}
// The amount of one saved line (the same formula as the app: qty x price x (1 - discount %))
export const lineAmount = l => r2(l.qty * l.price * (1 - (l.discount || 0) / 100))

// Quote number: QUO-0514 for Manager reference 514, so the numbers match what the client is used to
function quoteNumber(ref, taken, n) {
  const digits = /^\d+$/.test(ref) ? ref.padStart(4, '0') : null
  let num = 'QUO-' + (digits ?? (ref ? ref.replace(/\s+/g, '') : String(n).padStart(4, '0')))
  for (let i = 2; taken.has(num); i++) num = `QUO-${digits ?? ref}-${i}`
  taken.add(num)
  return num
}

// Number of the other documents: SO-0001, DN-0001, PQ-0001, PO-0001, GRN-0001 (the Manager reference when it is a number, else a running number)
function docNumber(prefix, ref, taken, n) {
  const digits = /^\d+$/.test(ref) ? ref.padStart(4, '0') : null
  const base = digits ?? (ref ? ref.replace(/\s+/g, '') : String(n).padStart(4, '0'))
  let num = prefix + base
  for (let i = 2; taken.has(num); i++) num = `${prefix}${base}-${i}`
  taken.add(num)
  return num
}

// Gives every customer, supplier, item, project and employee in the file its id in our database, in file order.
// Records that already exist (same type and name, not yet taken) are reused, the others are created by the callbacks.
// With create callbacks missing (step 2 alone) a record that does not exist is an error.
export async function assignAll(tx, data, cb = {}) {
  const pool = new Map(), ipool = new Map(), ppool = new Map(), epool = new Map()
  const add = (m, k, id) => (m.get(k) || m.set(k, []).get(k)).push(id)
  for (const c of await tx.contact.findMany({ select: { id: true, type: true, name: true }, orderBy: { id: 'asc' } })) add(pool, c.type + '|' + c.name.toLowerCase(), c.id)
  for (const i of await tx.item.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } })) add(ipool, i.name.toLowerCase(), i.id)
  for (const p of await tx.project.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } })) add(ppool, p.name.toLowerCase(), p.id)
  for (const e of await tx.employee.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } })) add(epool, e.name.toLowerCase(), e.id)
  const idByKey = new Map(), itemByKey = new Map(), projectByKey = new Map(), employeeByKey = new Map()
  const take = async (type, c) => {
    const k = type + '|' + (clean(c.name) || '(no name)').toLowerCase(), found = pool.get(k)?.shift()
    if (found) { cb.onReuse?.(type); return found }
    if (!cb.onContact) throw new Error(`${type} "${c.name}" is not in your software yet. Import everything together, or run step 1 first.`)
    return cb.onContact(type, c)
  }
  for (const c of data.customers) idByKey.set(c.key, await take('customer', c))
  for (const s of data.suppliers) idByKey.set(s.key, await take('supplier', s))
  for (const it of data.items) {
    const found = ipool.get((clean(it.name) || clean(it.code) || '(no name)').toLowerCase())?.shift()
    if (found) { cb.onItemReuse?.(); itemByKey.set(it.key, found) }
    else itemByKey.set(it.key, cb.onItem ? await cb.onItem(it) : null)
  }
  for (const p of data.projects || []) {
    const found = ppool.get((clean(p.name) || '(no name)').toLowerCase())?.shift()
    if (found) { cb.onProjectReuse?.(); projectByKey.set(p.key, found) }
    else {
      if (!cb.onProject) throw new Error(`Project "${p.name}" is not in your software yet. Import everything together, or run step 1 first.`)
      projectByKey.set(p.key, await cb.onProject(p))
    }
  }
  for (const e of data.employees || []) {
    const found = epool.get((clean(e.name) || '(no name)').toLowerCase())?.shift()
    if (found) { cb.onEmployeeReuse?.(); employeeByKey.set(e.key, found) }
    else {
      if (!cb.onEmployee) throw new Error(`Employee "${e.name}" is not in your software yet. Import everything together, or run step 1 first.`)
      employeeByKey.set(e.key, await cb.onEmployee(e))
    }
  }
  // The placeholder customer / supplier: only for documents that have no customer / supplier in Manager
  const noCustomer = [...(data.quotes || []), ...(data.invoices || []), ...(data.salesOrders || []), ...(data.deliveryNotes || [])].some(d => !idByKey.has(d.customerKey))
  const noSupplier = [...(data.purchaseQuotes || []), ...(data.purchaseOrders || []), ...(data.goodsReceipts || [])].some(d => !idByKey.has(d.supplierKey))
  let placeholderId = null, supplierPlaceholderId = null
  if (noCustomer) {
    placeholderId = pool.get('customer|' + PLACEHOLDER.toLowerCase())?.shift() ?? (cb.onPlaceholder ? await cb.onPlaceholder() : null)
    if (!placeholderId) throw new Error('The "Unknown customer" customer does not exist yet. Import everything together, or run step 1 first.')
  }
  if (noSupplier) {
    supplierPlaceholderId = pool.get('supplier|' + PLACEHOLDER_SUPPLIER.toLowerCase())?.shift() ?? (cb.onSupplierPlaceholder ? await cb.onSupplierPlaceholder() : null)
    if (!supplierPlaceholderId) throw new Error('The "Unknown supplier" supplier does not exist yet. Import everything together, or run step 1 first.')
  }
  return { idByKey, itemByKey, projectByKey, employeeByKey, placeholderId, supplierPlaceholderId }
}

export async function runBasics(tx, data, dryRun) {
  const rep = { dryRun, created: { customers: 0, suppliers: 0, items: 0, projects: 0, employees: 0, payslipItems: 0, payslips: 0, quotes: 0,
      salesOrders: 0, deliveryNotes: 0, purchaseQuotes: 0, purchaseOrders: 0, goodsReceipts: 0 },
    reused: { customers: 0, suppliers: 0, items: 0, projects: 0, employees: 0 },
    skippedQuotes: 0, skippedPayslips: 0, skippedDocuments: 0, placeholderDocuments: 0, placeholderQuotes: 0, splitQuantityLines: 0, totalMismatches: [], notes: [] }

  {
    // ---- Contacts, items, projects and employees: one for each Manager record (two customers with the same name stay two customers) ----
    const { idByKey, itemByKey, employeeByKey: empId, placeholderId, supplierPlaceholderId } = await assignAll(tx, data, {
      onContact: async (type, c) => { const row = await tx.contact.create({ data: type === 'customer'
        ? { type, name: clean(c.name) || '(no name)', code: clean(c.code), billingAddress: clean(c.billingAddress), deliveryAddress: clean(c.deliveryAddress) }
        : { type, name: clean(c.name) || '(no name)', code: clean(c.code), email: clean(c.email), billingAddress: clean(c.billingAddress) } }); rep.created[type + 's']++; return row.id },
      onReuse: type => rep.reused[type + 's']++,
      onItem: async it => { const row = await tx.item.create({ data: { name: clean(it.name) || clean(it.code) || '(no name)', description: clean(it.description) || '', unit: clean(it.unit) || 'pcs', cost: it.purchasePrice || 0, price: it.salesPrice || 0, salesDivision: clean(it.division) || '' } }); rep.created.items++; return row.id },
      onItemReuse: () => rep.reused.items++,
      onProject: async p => { const name = clean(p.name) || '(no name)'; const row = await tx.project.create({ data: { name, active: !p.inactive, stockCost: STOCK_COST[name] || 0 } }); rep.created.projects++; return row.id },
      onProjectReuse: () => rep.reused.projects++,
      onEmployee: async e => { const row = await tx.employee.create({ data: { name: clean(e.name) || '(no name)', code: clean(e.code), address: clean(e.address) } }); rep.created.employees++; return row.id },
      onEmployeeReuse: () => rep.reused.employees++,
      onPlaceholder: () => tx.contact.create({ data: { type: 'customer', name: PLACEHOLDER } }).then(r => r.id),
      onSupplierPlaceholder: () => tx.contact.create({ data: { type: 'supplier', name: PLACEHOLDER_SUPPLIER } }).then(r => r.id),
    })

    // ---- Payslip items (Monthly Salary, Advance ...) ----
    const ourItem = new Map((await tx.payslipItem.findMany()).map(i => [i.kind + '|' + i.name.toLowerCase(), i.id]))
    const slipItemId = new Map()                                  // Manager key -> our id
    for (const pi of data.payslipItems || []) {
      const name = clean(pi.name) || '(no name)', k = pi.kind + '|' + name.toLowerCase()
      let id = ourItem.get(k)
      if (!id) { id = (await tx.payslipItem.create({ data: { kind: pi.kind, name } })).id; ourItem.set(k, id); rep.created.payslipItems++ }
      slipItemId.set(pi.key, id)
    }

    // ---- Payslips (they do not post to the accounts in your software) ----
    const haveSlip = new Set((await tx.payslip.findMany({ select: { date: true, employeeId: true, reference: true } }))
      .map(p => `${p.date.toISOString().slice(0, 10)}|${p.employeeId}|${p.reference || ''}`))
    for (const p of data.payslips || []) {
      const employeeId = empId.get(p.employeeKey)
      if (!employeeId) { rep.notes.push(`Payslip ${p.date} ref ${p.reference || '-'} has no employee in the file and was skipped`); continue }
      if (haveSlip.has(`${p.date}|${employeeId}|${p.reference || ''}`)) { rep.skippedPayslips++; continue }   // imported on an earlier run
      const desc = l => String(l.description || '').trim().slice(0, 200)
      const lines = [
        ...p.earnings.map(l => ({ section: 'earning', itemId: slipItemId.get(l.itemKey) ?? null, description: desc(l), units: l.units, unitPrice: l.unitPrice, amount: l.amount })),
        ...p.deductions.map(l => ({ section: 'deduction', itemId: slipItemId.get(l.itemKey) ?? null, description: desc(l), units: null, unitPrice: null, amount: l.amount })),
      ]
      const gross = r2(p.earnings.reduce((s, l) => s + l.amount, 0)), totalDeductions = r2(p.deductions.reduce((s, l) => s + l.amount, 0))
      await tx.payslip.create({ data: { date: new Date(p.date), reference: clean(p.reference), customTitle: clean(p.title), employeeId,
        gross, totalDeductions, net: r2(gross - totalDeductions), lines: { create: lines } } })
      rep.created.payslips++
    }

    // ---- Orders, delivery notes, purchase quotes, purchase orders and goods receipts (no accounting effect) ----
    const KINDS = [
      { kind: 'order', prefix: 'SO-', list: 'salesOrders', party: 'customerKey', created: 'salesOrders' },
      { kind: 'delivery', prefix: 'DN-', list: 'deliveryNotes', party: 'customerKey', created: 'deliveryNotes' },
      { kind: 'pquote', prefix: 'PQ-', list: 'purchaseQuotes', party: 'supplierKey', created: 'purchaseQuotes' },
      { kind: 'porder', prefix: 'PO-', list: 'purchaseOrders', party: 'supplierKey', created: 'purchaseOrders' },
      { kind: 'greceipt', prefix: 'GRN-', list: 'goodsReceipts', party: 'supplierKey', created: 'goodsReceipts' },
    ]
    for (const K of KINDS) {
      const haveNo = new Set((await tx.salesDoc.findMany({ where: { kind: K.kind }, select: { number: true } })).map(d => d.number))
      const takenNo = new Set(haveNo)
      const sortedDocs = [...(data[K.list] || [])].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (+a.reference || 0) - (+b.reference || 0))
      let k = 0
      for (const d of sortedDocs) {
        k++
        const number = docNumber(K.prefix, d.reference || '', takenNo, k)
        if (haveNo.has(number)) { rep.skippedDocuments++; continue }
        const isCustomer = K.party === 'customerKey'
        const contactId = idByKey.get(d[K.party]) ?? (isCustomer ? placeholderId : supplierPlaceholderId)
        if (!idByKey.has(d[K.party])) { rep.placeholderDocuments++; rep.notes.push(`${number} has no ${isCustomer ? 'customer' : 'supplier'} in Manager: saved under "${isCustomer ? PLACEHOLDER : PLACEHOLDER_SUPPLIER}"`) }
        const lines = d.lines.map(l => {
          const f = fitLine(l); if (f.changed) rep.splitQuantityLines++
           return { itemId: l.itemKey ? itemByKey.get(l.itemKey) ?? null : null, description: f.description || '', qty: f.qty, price: f.price, discount: f.discount, stockQty: l.qty }
        })
        const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0))
        if (Math.abs(subtotal - d.subtotal) > 0.005) rep.totalMismatches.push(`${number}: ours ${subtotal}, Manager ${d.subtotal}`)
        if (!dryRun) await tx.salesDoc.create({ data: {
          kind: K.kind, number, date: new Date(d.date), reference: clean(d.reference), contactId, address: clean(d.address), description: clean(d.description),
          taxRate: 0, subtotal, tax: 0, rounding: 0, total: subtotal, rfq: !!d.rfq, status: d.accepted ? 'accepted' : 'open', lines: { create: lines } } })
        rep.created[K.created]++
      }
    }

    // ---- Quotes, oldest first so that QUO numbers keep counting upwards ----
    const have = new Set((await tx.salesDoc.findMany({ where: { kind: 'quote' }, select: { number: true } })).map(d => d.number))
    const taken = new Set(have)
    const sorted = [...data.quotes].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (+a.reference || 0) - (+b.reference || 0))
    let n = 0
    for (const q of sorted) {
      n++
      const number = quoteNumber(q.reference, taken, n)
      if (have.has(number)) { rep.skippedQuotes++; continue }
      const contactId = idByKey.get(q.customerKey) ?? placeholderId
      if (!idByKey.has(q.customerKey)) rep.placeholderQuotes++

      const lines = q.lines.map(l => {
        const f = fitLine(l); if (f.changed) rep.splitQuantityLines++
        return { itemId: l.itemKey ? itemByKey.get(l.itemKey) ?? null : null, description: f.description || '', qty: f.qty, price: f.price, discount: f.discount }
      })
      const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0))
      if (Math.abs(subtotal - q.subtotal) > 0.005) rep.totalMismatches.push(`${number}: ours ${subtotal}, Manager ${q.subtotal}`)
      // Keep Manager's tax and total exactly. Any tiny difference goes to "rounding".
      const taxRate = q.taxRate || (subtotal ? r2(q.tax / subtotal * 100) : 0)
      const rounding = r2(q.total - subtotal - q.tax)
      if (!dryRun) await tx.salesDoc.create({ data: {
        kind: 'quote', number, date: new Date(q.date), reference: clean(q.reference), contactId, address: clean(q.address), description: clean(q.description),
        taxRate, subtotal, tax: q.tax, rounding, total: q.total, validDays: q.validDays, expiryDate: q.expiryDate ? new Date(q.expiryDate) : null,
        status: q.accepted ? 'accepted' : 'open', lines: { create: lines } } })
      rep.created.quotes++
    }
  }
  return rep
}

// Runs step 1 alone in its own transaction (used by scripts/import-manager.js)
export async function importBasics(prisma, data, { dryRun = true } = {}) {
  let rep
  try { await prisma.$transaction(async tx => { rep = await runBasics(tx, data, dryRun); if (dryRun) throw Object.assign(new Error('dry run'), { dry: true }) }, { timeout: 300000, maxWait: 20000 }) } catch (e) { if (!e.dry) throw e }
  return rep
}