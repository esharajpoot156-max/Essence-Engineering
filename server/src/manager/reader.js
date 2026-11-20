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
  project: '5170f738-cfba-42e3-bb8e-a7d5c5ab66f2',
  kit: 'efc4f2cc-acf0-4815-a9a8-13bae00c6167',              
  employee: 'dadb7f95-a5dd-45c0-945d-6ad4ee28776e',
  payslip: '1d103fa7-6fc1-4951-811e-972968b842cc',
  earningItem: 'ab02f6ab-c91c-4fc2-b979-66a6682c200e',      // payslip items you earn (Monthly Salary, Insentive ...)
  deductionItem: '0444eb18-6fc5-4d1f-be8b-c114da01832c',    // payslip items that are deducted (Advance ...)
  salesOrder: '2dac5598-128d-4954-b2e4-21515047b3a7',
  deliveryNote: 'a0f6a539-f6a4-4a38-a69a-546a608a1f6d',     // to a customer
  goodsReceipt: '866217a4-f841-47de-a4e6-87152405c88d',     // from a supplier
  purchaseQuote: '38d606f7-6358-4ace-9d1d-f6c0b9ea9d68',
  purchaseOrder: 'a26bbea1-57aa-4fd9-b7c9-e26b83114385',
  expenseClaim: '02572e0c-0167-4dbd-a392-08d8f67f3fe4',
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
    // Inventory kits: a kit line is saved as its component item, with the quantity multiplied by the component quantity
  const kits = new Map(ofType(T.kit).map(r => { const c = parse(first(r.fs, 3) || Buffer.alloc(0)); return [r.key, { itemKey: guidOf(c, 1), qty: c.length && first(c, 3) ? numberOf(first(c, 3)) || 1 : 1 }] }).filter(([, v]) => v.itemKey))
  const asItem = (k, qty, price) => { const kit = kits.get(k); return kit ? { itemKey: kit.itemKey, qty: qty * kit.qty, price: price / kit.qty } : { itemKey: k, qty, price } }

  // Tax codes: GUID -> { name, rate }
  const taxes = new Map()
  for (const r of ofType(T.tax)) {
    const rate = r.fs.find(x => x.f === 4) ? numberOf(first(r.fs, 4)) : 0
    taxes.set(r.key, { name: text(r.fs, 1), rate })
  }

  // Customers and suppliers
  const customers = ofType(T.customer).map(r => ({ key: r.key, name: text(r.fs, 1), code: text(r.fs, 13), billingAddress: text(r.fs, 2), deliveryAddress: text(r.fs, 20) }))
  const suppliers = ofType(T.supplier).map(r => ({ key: r.key, name: text(r.fs, 1), code: text(r.fs, 10), email: text(r.fs, 2), billingAddress: text(r.fs, 7) }))

  // Inventory items (checked against a real file): 1 code, 4 description, 11 item name (pv module, Structure ...), 13 unit
  // Manager keeps a short "Item name" (field 11) and a longer "Description" (field 4: Longi Hi-MO6 570 ...).
  // Our name = Manager's "Item name"; the full description is kept in its own column.
  // The record whose key equals the type id is Manager's own settings record, not an item, so it is skipped.
  const items = ofType(T.item).filter(r => r.key !== T.item).map(r => {
    const code = text(r.fs, 1), cat = text(r.fs, 11).trim(), desc = text(r.fs, 4).trim()
    const firstLine = (desc.split('\n').map(s => s.trim()).find(Boolean) || '').slice(0, 80)
    const name = cat || firstLine || code || '(no name)'   // Manager's item name only; the description has its own column
    // 2 = purchase price, 3 = sales price. Manager shows them only when flags 31 and 32 are set (otherwise the item has no price).
    const priced = first(r.fs, 31) === 1 && first(r.fs, 32) === 1
    const purchasePrice = priced ? numberOf(first(r.fs, 2)) : 0, salesPrice = priced ? numberOf(first(r.fs, 3)) : 0
    return { key: r.key, code, name, description: desc, division: text(r.fs, 11), unit: text(r.fs, 13), purchasePrice, salesPrice, isService: /^service/i.test(cat) }
  })

  // Terms and conditions texts
  const terms = new Map(ofType(T.terms).map(r => [r.key, { title: text(r.fs, 1), text: text(r.fs, 2) }]))

  // Document lines. Each line: item (optional), description, quantity, price, tax code (optional)
    const readLines = (r, fLine, F, useDisc = false) => all(r.fs, fLine).map(v => {
    const l = parse(v), taxKey = guidOf(l, F.tax), it = asItem(guidOf(l, F.item), numberOf(first(l, F.qty)), numberOf(first(l, F.price)))
    return { itemKey: it.itemKey, projectKey: F.project ? guidOf(l, F.project) : null, description: text(l, F.desc), qty: it.qty, price: it.price, discount: useDisc ? numberOf(first(l, F.disc)) : 0, taxRate: taxKey ? (taxes.get(taxKey)?.rate ?? 0) : 0 }
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

  // Sales invoices: 1 date, 2 reference, 3 customer, 4 address, 12 description, 49 lines (24 = line discount amount, 26 = project), 51 quote it came from
  const invoices = ofType(T.invoice).map(r => {
    const lines = readLines(r, 49, { item: 1, desc: 17, qty: 18, price: 19, disc: 24, tax: 21, project: 26 }, first(r.fs, 31) === 1)
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

  // Purchase invoices: 1 date, 2 reference, 3 supplier, 9 description, 23 lines (1 item, 17 description, 18 quantity, 19 price, 26 project). Manager has no tax on these in this file.
  const purchases = ofType(T.purchase).map(r => {
    const lines = readLines(r, 23, { item: 1, desc: 17, qty: 18, price: 19, tax: 0, project: 26 })
    return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), supplierKey: guidOf(r.fs, 3), description: text(r.fs, 9), lines, ...totals(lines) }
  })
  // Bank and cash accounts: 1 name
  const banks = ofType(T.bank).map(r => ({ key: r.key, name: text(r.fs, 1) }))
  // Receipts: 1 date, 2 reference, 3 payer type (1 customer, 2 other), 4 customer, 5 other payer, 7 received in (bank, may be empty), 10 description, 11 lines
  // Payments: 1 date, 2 reference, 5 payee (supplier), 7 paid from (bank, may be empty), 10 description, 11 lines
  // Line: 2 account, 3 customer, 4 invoice it pays, 18 amount, 24 project
  const moneyLines = r => all(r.fs, 11).map(v => { const l = parse(v); return { itemKey: guidOf(l, 1), accountKey: guidOf(l, 2), customerKey: guidOf(l, 3), invoiceKey: guidOf(l, 4), projectKey: guidOf(l, 24), description: text(l, 15), amount: numberOf(first(l, 18)) } })
  const receipts = ofType(T.receipt).map(r => ({ key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), payerKey: guidOf(r.fs, 4) || guidOf(r.fs, 5), bankKey: guidOf(r.fs, 7), description: text(r.fs, 10), lines: moneyLines(r) }))
  const payments = ofType(T.payment).map(r => ({ key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), payerKey: guidOf(r.fs, 5), bankKey: guidOf(r.fs, 7), description: text(r.fs, 10), lines: moneyLines(r) }))
  // What Manager itself says each customer / supplier owes: invoices minus receipts on Accounts Receivable (customers); payments on Accounts Payable (suppliers)
  const balances = new Map()
  const bump = (k, n) => k && balances.set(k, r2((balances.get(k) || 0) + n))
  const invOwner = new Map(invoices.map(i => [i.key, i.customerKey]))   // a receipt line counts for the customer who owns the invoice it pays
  for (const i of invoices) bump(i.customerKey, i.total)
  for (const p of purchases) bump(p.supplierKey, p.total)   // suppliers: what we owe = purchase invoices minus payments
  for (const x of receipts) for (const l of x.lines) if (l.accountKey === SYSTEM.receivable) bump((l.invoiceKey && invOwner.get(l.invoiceKey)) || l.customerKey || x.payerKey, -l.amount)
  for (const x of payments) for (const l of x.lines) if (l.accountKey === SYSTEM.payable) bump(x.payerKey, -l.amount)

  // Projects: 1 name. (3 = 1 on a project that is marked inactive in Manager)
  const projects = ofType(T.project).map(r => ({ key: r.key, name: text(r.fs, 1), inactive: first(r.fs, 3) === 1 }))
  // Employees: 1 name, 2 address, 14 employee code
  const employees = ofType(T.employee).map(r => ({ key: r.key, name: text(r.fs, 1), address: text(r.fs, 2), code: text(r.fs, 14) }))
  // Payslip items: the names that payslip lines use (earnings and deductions)
  const payslipItems = [
    ...ofType(T.earningItem).map(r => ({ key: r.key, kind: 'earning', name: text(r.fs, 1) })),
    ...ofType(T.deductionItem).map(r => ({ key: r.key, kind: 'deduction', name: text(r.fs, 1) })),
  ]
  // Payslips: 1 date, 2 employee, 11 title, 12 reference, 3 earning lines, 4 deduction lines
  //   earning line:   3 unit price, 4 payslip item, 6 description, 7 units  (amount = units x unit price; no units = just the price)
  //   deduction line: 2 amount, 3 payslip item, 4 description
  // Checked against Manager: gross 45,000 = 35,000 x 1 + 5,000 x 2, deductions 10,000, net 35,000.
  const payslips = ofType(T.payslip).map(r => ({
    key: r.key, date: dateOf(r.fs, 1), employeeKey: guidOf(r.fs, 2), title: text(r.fs, 11), reference: text(r.fs, 12),
    earnings: all(r.fs, 3).map(v => {
      const l = parse(v), price = numberOf(first(l, 3)), u = first(l, 7), units = u ? numberOf(u) : null
      return { itemKey: guidOf(l, 4), description: text(l, 6), units, unitPrice: units === null ? null : price, amount: units === null ? price : r2(units * price) }
    }),
    deductions: all(r.fs, 4).map(v => { const l = parse(v); return { itemKey: guidOf(l, 3), description: text(l, 4), amount: numberOf(first(l, 2)) } }),
  }))

  // ---- Documents that have no accounting effect: sales orders, delivery notes, purchase quotes, purchase orders, goods receipts ----
  // A line: 1 item, 2 description, 3 quantity (missing = 1), 4 price (missing = 0), project (only on purchase orders: field 9)
    const docLines = (r, fLine, projectField) => all(r.fs, fLine).map(v => {
    const l = parse(v), q = first(l, 3), it = asItem(guidOf(l, 1), q ? numberOf(q) : 1, numberOf(first(l, 4)))
    return { itemKey: it.itemKey, projectKey: projectField ? guidOf(l, projectField) : null, description: text(l, 2), qty: it.qty, price: it.price, discount: 0, taxRate: 0 }
  })
  // Purchase orders: 1 date, 2 reference, 3 supplier, 11 description, 17 lines, 18 the purchase quote it was made from
  const fromQuote = new Set(ofType(T.purchaseOrder).map(r => guidOf(r.fs, 18)).filter(Boolean))
  const purchaseOrders = ofType(T.purchaseOrder).map(r => { const lines = docLines(r, 17, 9); return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), supplierKey: guidOf(r.fs, 3), description: text(r.fs, 11), lines, ...totals(lines) } })
  // Purchase quotes: 1 date, 2 reference, 3 supplier, 11 description, 17 lines, 18 = 1 for a request for quotation (no prices)
  const purchaseQuotes = ofType(T.purchaseQuote).map(r => { const lines = docLines(r, 17); return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), supplierKey: guidOf(r.fs, 3), description: text(r.fs, 11), rfq: first(r.fs, 18) === 1, accepted: fromQuote.has(r.key), lines, ...totals(lines) } })
  // Goods receipts: 1 reference, 3 date, 4 supplier (may be empty), 6 description, 15 lines
  const goodsReceipts = ofType(T.goodsReceipt).map(r => { const lines = docLines(r, 15); return { key: r.key, date: dateOf(r.fs, 3), reference: text(r.fs, 1), supplierKey: guidOf(r.fs, 4), description: text(r.fs, 6), lines, ...totals(lines) } })
  // Delivery notes: 1 reference, 3 date, 4 customer, 5 delivery address, 6 description, 15 lines
  const deliveryNotes = ofType(T.deliveryNote).map(r => { const lines = docLines(r, 15); return { key: r.key, date: dateOf(r.fs, 3), reference: text(r.fs, 1), customerKey: guidOf(r.fs, 4), address: text(r.fs, 5), description: text(r.fs, 6), lines, ...totals(lines) } })
  // Sales orders: 1 date, 3 customer (may be empty), 12 description, 18 lines
  const salesOrders = ofType(T.salesOrder).map(r => { const lines = docLines(r, 18); return { key: r.key, date: dateOf(r.fs, 1), reference: text(r.fs, 2), customerKey: guidOf(r.fs, 3), description: text(r.fs, 12), lines, ...totals(lines) } })
  // Expense claims: 1 date, 3 description, 5 reference, 9 employee who paid, 18 lines (17 description, 18 quantity, 19 price)
  const expenseClaims = ofType(T.expenseClaim).map(r => ({
    key: r.key, date: dateOf(r.fs, 1), description: text(r.fs, 3), reference: text(r.fs, 5), employeeKey: guidOf(r.fs, 9),
    lines: all(r.fs, 18).map(v => { const l = parse(v), q = first(l, 18); return { description: text(l, 17), qty: q ? numberOf(q) : 1, price: numberOf(first(l, 19)) } }),
  }))

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

  return { customers, suppliers, items, taxes: [...taxes.values()], quotes, invoices, banks, receipts, payments, purchases, balances, projects, employees, payslipItems, payslips,
    salesOrders, deliveryNotes, purchaseQuotes, purchaseOrders, goodsReceipts, expenseClaims, warnings }
}