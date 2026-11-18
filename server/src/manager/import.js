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

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100
const clean = v => { const s = String(v ?? '').trim(); return s || null }
const PLACEHOLDER = 'Unknown customer'

// Our software only stores whole-number quantities. A line like 2.5 x 100 becomes 1 x 250,
// so the amount stays exactly the same as in Manager. The original is written in the description.
function fitLine(l) {
  if (Number.isInteger(l.qty) && l.qty >= 1) return { qty: l.qty, price: l.price, description: l.description, changed: false }
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

export async function importBasics(prisma, data, { dryRun = true } = {}) {
  const rep = { dryRun, created: { customers: 0, suppliers: 0, items: 0, quotes: 0 }, reused: { customers: 0, suppliers: 0, items: 0 },
    skippedQuotes: 0, placeholderQuotes: 0, splitQuantityLines: 0, totalMismatches: [], mergedSameName: 0 }

  const run = async tx => {
    // ---- Contacts ----
    const existing = await tx.contact.findMany({ select: { id: true, type: true, name: true } })
    const contactIds = new Map(existing.map(c => [c.type + '|' + c.name.toLowerCase(), c.id]))
    const before = new Set(existing.map(c => c.id))   // contacts that were there before this import
    const idByKey = new Map()                       // Manager key -> our id
    const addContact = async (type, c, extra) => {
      const name = clean(c.name) || '(no name)'
      const k = type + '|' + name.toLowerCase()
      let id = contactIds.get(k)
      if (id) { if (before.has(id)) rep.reused[type + 's']++; else rep.mergedSameName++ }   // same name twice inside the file = one contact
      else {
        id = (await tx.contact.create({ data: { type, name, code: clean(c.code), ...extra } })).id
        contactIds.set(k, id); rep.created[type + 's']++
      }
      idByKey.set(c.key, id)
    }
    for (const c of data.customers) await addContact('customer', c, { billingAddress: clean(c.billingAddress), deliveryAddress: clean(c.deliveryAddress) })
    for (const s of data.suppliers) await addContact('supplier', s, { email: clean(s.email), billingAddress: clean(s.billingAddress) })

    // The placeholder customer for quotes that have no customer in Manager (created only if needed)
    const needsPlaceholder = data.quotes.some(q => !idByKey.has(q.customerKey))
    let placeholderId = null
    if (needsPlaceholder) {
      const k = 'customer|' + PLACEHOLDER.toLowerCase()
      placeholderId = contactIds.get(k) ?? (await tx.contact.create({ data: { type: 'customer', name: PLACEHOLDER } })).id
      contactIds.set(k, placeholderId)
    }

    // ---- Items (stock stays 0: opening stock is a separate decision) ----
    const items = await tx.item.findMany({ select: { id: true, name: true } })
    const itemIds = new Map(items.map(i => [i.name.toLowerCase(), i.id]))
    const itemByKey = new Map()
    for (const it of data.items) {
      const name = clean(it.name) || clean(it.code) || '(no name)'
      let id = itemIds.get(name.toLowerCase())
      if (id) rep.reused.items++
      else {
        id = (await tx.item.create({ data: { name, unit: clean(it.unit) || 'pcs', salesDivision: clean(it.division) || '' } })).id
        itemIds.set(name.toLowerCase(), id); rep.created.items++
      }
      itemByKey.set(it.key, id)
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
    if (dryRun) throw Object.assign(new Error('dry run'), { dry: true })   // roll everything back
  }

  try { await prisma.$transaction(run, { timeout: 120000, maxWait: 20000 }) } catch (e) { if (!e.dry) throw e }
  return rep
}