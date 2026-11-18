// src/manager/import.js
// Step 1 of the Manager import: customers, suppliers, items and sales quotes.
// None of these touch the accounts or the stock, so it is safe to run.
//
//   const report = await importBasics(prisma, data, { dryRun: true })   // data = result of readManager()
//
// dryRun = true  -> works everything out, saves NOTHING, and returns the report.
// dryRun = false -> saves everything in ONE transaction (all or nothing).
// Running it twice is safe: contacts and items that already exist (same type + name) are reused,
// and quotes whose number already exists are skipped.

export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100
const clean = v => { const s = String(v ?? '').trim(); return s || null }
const PLACEHOLDER = 'Unknown customer'

// Our software only stores whole-number quantities and prices with 2 decimals. A line like 2.5 x 100 becomes 1 x 250,
// so the amount stays exactly the same as in Manager. The original is written in the description.
export function fitLine(l) {
  const cents = Math.abs(l.price * 100 - Math.round(l.price * 100)) < 1e-6      // our prices keep 2 decimals only
  if (Number.isInteger(l.qty) && l.qty >= 1 && cents) return { qty: l.qty, price: l.price, description: l.description, changed: false }
  const note = ` (qty ${l.qty} x ${l.price})`
  return { qty: 1, price: r2(l.qty * l.price), description: (l.description || '') + note, changed: true }
}

// Quote number: QUO-0514 for Manager reference 514, so the numbers match what the client is used to
function quoteNumber(ref, taken, n) {
  const digits = /^\d+$/.test(ref) ? ref.padStart(4, '0') : null
  let num = 'QUO-' + (digits ?? (ref ? ref.replace(/\s+/g, '') : String(n).padStart(4, '0')))
  for (let i = 2; taken.has(num); i++) num = `QUO-${digits ?? ref}-${i}`
  taken.add(num)
  return num
}


// Gives every customer, supplier and item in the file its id in our database, in file order.
// Records that already exist (same type and name, not yet taken) are reused, the others are created by the callbacks.
// With create callbacks missing (step 2 alone) a record that does not exist is an error.
export async function assignAll(tx, data, cb = {}) {
  const pool = new Map(), ipool = new Map()
  const add = (m, k, id) => (m.get(k) || m.set(k, []).get(k)).push(id)
  for (const c of await tx.contact.findMany({ select: { id: true, type: true, name: true }, orderBy: { id: 'asc' } })) add(pool, c.type + '|' + c.name.toLowerCase(), c.id)
  for (const i of await tx.item.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } })) add(ipool, i.name.toLowerCase(), i.id)
  const idByKey = new Map(), itemByKey = new Map()
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
  // The placeholder customer: only for documents that have no customer in Manager
  const needs = [...(data.quotes || []), ...(data.invoices || [])].some(d => !idByKey.has(d.customerKey))
  let placeholderId = null
  if (needs) {
    placeholderId = pool.get('customer|' + PLACEHOLDER.toLowerCase())?.shift() ?? (cb.onPlaceholder ? await cb.onPlaceholder() : null)
    if (!placeholderId) throw new Error('The "Unknown customer" customer does not exist yet. Import everything together, or run step 1 first.')
  }
  return { idByKey, itemByKey, placeholderId }
}

export async function runBasics(tx, data, dryRun) {
  const rep = { dryRun, created: { customers: 0, suppliers: 0, items: 0, quotes: 0 }, reused: { customers: 0, suppliers: 0, items: 0 },
    skippedQuotes: 0, placeholderQuotes: 0, splitQuantityLines: 0, totalMismatches: [], }

  {
    // ---- Contacts and items: one for each Manager record (two customers with the same name stay two customers) ----
    const { idByKey, itemByKey, placeholderId } = await assignAll(tx, data, {
      onContact: async (type, c) => { const row = await tx.contact.create({ data: type === 'customer'
        ? { type, name: clean(c.name) || '(no name)', code: clean(c.code), billingAddress: clean(c.billingAddress), deliveryAddress: clean(c.deliveryAddress) }
        : { type, name: clean(c.name) || '(no name)', code: clean(c.code), email: clean(c.email), billingAddress: clean(c.billingAddress) } }); rep.created[type + 's']++; return row.id },
      onReuse: type => rep.reused[type + 's']++,
      onItem: async it => { const row = await tx.item.create({ data: { name: clean(it.name) || clean(it.code) || '(no name)', unit: clean(it.unit) || 'pcs', salesDivision: clean(it.division) || '' } }); rep.created.items++; return row.id },
      onItemReuse: () => rep.reused.items++,
      onPlaceholder: () => tx.contact.create({ data: { type: 'customer', name: PLACEHOLDER } }).then(r => r.id),
    })

    // ---- Quotes, oldest first so that QUO numbers keep counting upwards ----
    const have = new Set((await tx.salesDoc.findMany({ where: { kind: 'quote' }, select: { number: true } })).map(d => d.number))
    const taken = new Set()   // numbers used inside this file (a repeated reference gets -2); numbers already saved are in `have`
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
        return { itemId: l.itemKey ? itemByKey.get(l.itemKey) ?? null : null, description: f.description || '', qty: f.qty, price: f.price, discount: 0 }
      })
      const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.price, 0))
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