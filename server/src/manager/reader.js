// src/manager/reader.js
// Reads a Manager.io ".manager" file (a SQLite database whose records are stored in Protocol Buffers)
// and returns plain JavaScript data: customers, suppliers, items, tax codes, quotes and invoices.
// Nothing is written to your database here. This file only READS the uploaded file.
//
//   const data = await readManager(buffer)     // buffer = the bytes of the .manager file
import initSqlJs from 'sql.js'

// ---------- Record types (the same GUIDs are used in every Manager file) ----------
const T = {
  customer: 'ec37c11e-2b67-49c6-8a58-6eccb7dd75ee',
  supplier: '6d2dc48d-2053-4e45-8330-285ebd431242',
  item: '0dbdbf8a-d80c-48e6-b453-bb7862445b7c',
  tax: '7f368d97-8b7f-4b39-b156-dc66afd9496a',
  quote: 'ba89de75-cb87-4bde-b20f-314f01b31037',
  invoice: 'ad12b60b-23bf-4421-94df-8be79cef533e',
  terms: 'd95df676-e2cb-4be6-a9b3-86dcd79ac3bc',
  bank: '1408c33b-6284-4f50-9e31-48cbea21f3cf',
  receipt: '7662b887-c8d8-486e-98fd-f9dbcd41c6dc',
  payment: '79f99d26-e43a-4ecb-a9c9-0774601a9b2e',
  purchase: '58b9eb90-f6b8-4abc-8ea1-12fd77b8336e',
}
// Built-in accounts that Manager does not store in the file (the same in every file)
export const SYSTEM = { receivable: 'd1489e95-bb28-4f5d-b42e-67d3291b3893', payable: 'dac7ba37-0ccd-45e5-906e-548e6c50df37' }

// ---------- Protocol Buffers: minimal reader (no schema needed) ----------
// Returns a list of { f: field number, w: wire type, v: value }. Varints become numbers, everything else a Buffer.
function parse(buf) {
  const out = []
  let i = 0
  const varint = () => { let r = 0, mul = 1, b; do { b = buf[i++]; r += (b & 0x7f) * mul; mul *= 128 } while (b & 0x80); return r }
  while (i < buf.length) {
    const k = varint(), f = Math.floor(k / 8), w = k % 8
    if (w === 0) out.push({ f, w, v: varint() })
    else if (w === 1) { out.push({ f, w, v: buf.subarray(i, i + 8) }); i += 8 }
    else if (w === 2) { const l = varint(); out.push({ f, w, v: buf.subarray(i, i + l) }); i += l }
    else if (w === 5) { out.push({ f, w, v: buf.subarray(i, i + 4) }); i += 4 }
    else throw new Error('Unreadable record')
  }
  return out
}
const first = (fs, f) => fs.find(x => x.f === f)?.v          // first value of a field
const all = (fs, f) => fs.filter(x => x.f === f).map(x => x.v) // every value of a repeated field
const text = (fs, f) => { const v = first(fs, f); return v && v.length ? v.toString('utf8') : '' }

// A GUID inside a record is stored as two 8-byte numbers: { 1: fixed64, 2: fixed64 }  (18 bytes in total)
const isGuid = b => Buffer.isBuffer(b) && b.length === 18 && b[0] === 0x09 && b[9] === 0x11
function toGuid(b) {
  const r = Buffer.concat([b.subarray(1, 9), b.subarray(10, 18)])        // 16 bytes in .NET order
  const hex = (s, e, rev) => { const p = [...r.subarray(s, e)].map(x => x.toString(16).padStart(2, '0')); return (rev ? p.reverse() : p).join('') }
  return `${hex(0, 4, 1)}-${hex(4, 6, 1)}-${hex(6, 8, 1)}-${hex(8, 10)}-${hex(10, 16)}`
}
const guidOf = (fs, f) => { const v = first(fs, f); return isGuid(v) ? toGuid(v) : null }

// Dates are stored as zigzag-encoded half days since 1970-01-01. Returns 'YYYY-MM-DD'.
function dateOf(fs, f) {
  const m = first(fs, f); if (!m) return null
  const z = first(parse(m), 1); if (z === undefined) return null
  const days = z % 2 ? -(z + 1) / 2 : z / 2
  return new Date(days * 86400000).toISOString().slice(0, 10)
}

// Numbers are { 1: digits, 3: scale }. The scale field is zigzag: 2 means 1 decimal, 4 means 2 decimals,
// 6 means 3 decimals, and 1 means a NEGATIVE whole number (used for discount lines).
function numberOf(buf) {
  if (!buf) return 0
  const fs = parse(buf), m = first(fs, 1) || 0, f = first(fs, 3)
  if (f === undefined) return m
  const s = f % 2 ? -(f + 1) / 2 : f / 2
  return s > 0 ? m / 10 ** s : -(m / 10 ** (-s - 1))
}
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100

// ---------- Reader ----------
export async function readManager(buffer) {
  const SQL = await initSqlJs()
  let db
  try { db = new SQL.Database(new Uint8Array(buffer)) } catch { throw new Error('This is not a Manager file') }
  let rows
  try { rows = db.exec('SELECT Key, ContentType, Content FROM Objects')[0]?.values || [] } catch { throw new Error('This is not a Manager file') }
  db.close()

  // Every record by its key, and by type
  const byKey = new Map(), byType = {}
  for (const [key, type, content] of rows) {
    const rec = { key, type, fs: parse(Buffer.from(content || [])) }
    byKey.set(key, rec); (byType[type] ||= []).push(rec)
  }
  const ofType = t => byType[t] || []
  const warnings = []

  // Tax codes: GUID -> { name, rate }
  const taxes = new Map()
  for (const r of ofType(T.tax)) {
    const rate = r.fs.find(x => x.f === 4) ? numberOf(first(r.fs, 4)) : 0
    taxes.set(r.key, { name: text(r.fs, 1), rate })
  }

  // Customers and suppliers
  const customers = ofType(T.customer).map(r => ({ key: r.key, name: text(r.fs, 1), code: text(r.fs, 13), billingAddress: text(r.fs, 2), deliveryAddress: text(r.fs, 20) }))
  const suppliers = ofType(T.supplier).map(r => ({ key: r.key, name: text(r.fs, 1), code: text(r.fs, 10), email: text(r.fs, 2), billingAddress: text(r.fs, 7) }))

  // Inventory items: 1 code, 4 name, 11 category, 13 unit
  const items = ofType(T.item).map(r => ({ key: r.key, code: text(r.fs, 1), name: text(r.fs, 4) || text(r.fs, 1), division: text(r.fs, 11), unit: text(r.fs, 13) }))

  // Terms and conditions texts
  const terms = new Map(ofType(T.terms).map(r => [r.key, { title: text(r.fs, 1), text: text(r.fs, 2) }]))

  // Document lines. Each line: item (optional), description, quantity, price, tax code (optional)
  const readLines = (r, fLine, F, useDisc = false) => all(r.fs, fLine).map(v => {
    const l = parse(v), taxKey = guidOf(l, F.tax)
    return { itemKey: guidOf(l, F.item), description: text(l, F.desc), qty: numberOf(first(l, F.qty)), price: numberOf(first(l, F.price)), discount: useDisc ? numberOf(first(l, F.disc)) : 0, taxRate: taxKey ? (taxes.get(taxKey)?.rate ?? 0) : 0 }
  })
  // Totals: subtotal, tax (per line) and the single tax rate when every taxed line uses the same rate
  const totals = (lines, wholeRupee = false) => {
    const net = l => l.qty * l.price - (l.discount || 0)   // Manager's line discount is an AMOUNT in rupees (only counted when the document's discount switch is on); tax is charged on the amount after discount
    const subtotal = r2(lines.reduce((s, l) => s + net(l), 0))
    const tax = r2(lines.reduce((s, l) => s + net(l) * l.taxRate / 100, 0))
    const rates = [...new Set(lines.filter(l => l.taxRate).map(l => l.taxRate))]
    const mixed = rates.length > 1 || (rates.length === 1 && lines.some(l => !l.taxRate && net(l) !== 0))
    return { subtotal, tax, total: wholeRupee ? Math.round(subtotal + tax) : r2(subtotal + tax), taxRate: rates.length === 1 ? rates[0] : 0, mixedTax: mixed }
  }

  // Sales invoices: 1 date, 2 reference, 3 customer, 4 address, 12 description, 49 lines (24 = line discount amount), 51 quote it came from
  const invoices = ofType(T.invoice).map(r => {
    const lines = readLines(r, 49, { item: 1, desc: 17, qty: 18, price: 19, disc: 24, tax: 21 }, first(r.fs, 31) === 1)
    return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), customerKey: guidOf(r.fs, 3), address: text(r.fs, 4), description: text(r.fs, 12), quoteKey: guidOf(r.fs, 51), lines, ...totals(lines, first(r.fs, 29) === 1) }
  })
  // A quote is "accepted" when an invoice was made from it
  const invoiced = new Set(invoices.map(i => i.quoteKey).filter(Boolean))

  // Sales quotes: 1 date, 2 reference, 3 customer, 4 address, 9 description, 24 lines (6 = line discount amount), 26 valid days, 34 terms
  const quotes = ofType(T.quote).map(r => {
    const lines = readLines(r, 24, { item: 1, desc: 2, qty: 3, price: 4, disc: 6, tax: 7 }, first(r.fs, 17) === 1)
    const date = dateOf(r.fs, 1), validDays = first(r.fs, 26)
    const expiry = validDays !== undefined && date ? new Date(Date.parse(date) + validDays * 86400000).toISOString().slice(0, 10) : null
    return { key: r.key, date, reference: text(r.fs, 2), customerKey: guidOf(r.fs, 3), address: text(r.fs, 4), description: text(r.fs, 9), validDays: validDays ?? null, expiryDate: expiry, accepted: invoiced.has(r.key), terms: terms.get(guidOf(r.fs, 34))?.text || '', lines, ...totals(lines) }
  })

  // Purchase invoices: 1 date, 2 reference, 3 supplier, 9 description, 23 lines (1 item, 17 description, 18 quantity, 19 price). Manager has no tax on these in this file.
  const purchases = ofType(T.purchase).map(r => {
    const lines = readLines(r, 23, { item: 1, desc: 17, qty: 18, price: 19, tax: 0 })
    return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), supplierKey: guidOf(r.fs, 3), description: text(r.fs, 9), lines, ...totals(lines) }
  })
  // Bank and cash accounts: 1 name
  const banks = ofType(T.bank).map(r => ({ key: r.key, name: text(r.fs, 1) }))
  // Receipts: 1 date, 2 reference, 3 payer type (1 customer, 2 other), 4 customer, 5 other payer, 7 received in (bank, may be empty), 10 description, 11 lines
  // Payments: 1 date, 2 reference, 5 payee (supplier), 7 paid from (bank, may be empty), 10 description, 11 lines
  // Line: 2 account, 3 customer, 4 invoice it pays, 18 amount
  const moneyLines = r => all(r.fs, 11).map(v => { const l = parse(v); return { itemKey: guidOf(l, 1), accountKey: guidOf(l, 2), customerKey: guidOf(l, 3), invoiceKey: guidOf(l, 4), description: text(l, 15), amount: numberOf(first(l, 18)) } })
  const receipts = ofType(T.receipt).map(r => ({ key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), payerKey: guidOf(r.fs, 4) || guidOf(r.fs, 5), bankKey: guidOf(r.fs, 7), description: text(r.fs, 10), lines: moneyLines(r) }))
  const payments = ofType(T.payment).map(r => ({ key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), payerKey: guidOf(r.fs, 5), bankKey: guidOf(r.fs, 7), description: text(r.fs, 10), lines: moneyLines(r) }))
  // What Manager itself says each customer / supplier owes: invoices minus receipts on Accounts Receivable (customers); payments on Accounts Payable (suppliers)
  const balances = new Map()
  const bump = (k, n) => k && balances.set(k, r2((balances.get(k) || 0) + n))
  for (const i of invoices) bump(i.customerKey, i.total)
  for (const p of purchases) bump(p.supplierKey, p.total)   // suppliers: what we owe = purchase invoices minus payments
  for (const x of receipts) for (const l of x.lines) if (l.accountKey === SYSTEM.receivable) bump(l.customerKey || x.payerKey, -l.amount)
  for (const x of payments) for (const l of x.lines) if (l.accountKey === SYSTEM.payable) bump(x.payerKey, -l.amount)

  // ---- Checks that tell the user what may need attention ----
  const known = new Set([...customers, ...suppliers, ...items].map(x => x.key))
  const missingCust = [...quotes, ...invoices].filter(d => !d.customerKey || !byKey.has(d.customerKey)).length
  if (missingCust) warnings.push(`${missingCust} quotes or invoices point to a customer that is not in the file`)
  const decimalQty = [...quotes, ...invoices].filter(d => d.lines.some(l => !Number.isInteger(l.qty))).length
  if (decimalQty) warnings.push(`${decimalQty} documents have a quantity with decimals (your software needs whole numbers)`)
  const mixed = [...quotes, ...invoices].filter(d => d.mixedTax).length
  if (mixed) warnings.push(`${mixed} documents have lines with different tax rates (your software has one tax rate per document)`)
  const badItem = [...quotes, ...invoices].flatMap(d => d.lines).filter(l => l.itemKey && !known.has(l.itemKey)).length
  if (badItem) warnings.push(`${badItem} lines point to an item that is not in the file`)

  return { customers, suppliers, items, taxes: [...taxes.values()], quotes, invoices, banks, receipts, payments, purchases, balances, warnings }
}