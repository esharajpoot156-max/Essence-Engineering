// src/manager/ledger.js
// Step 2 of the Manager import: bank accounts, old sales invoices, receipts and payments, POSTED into the accounts.
// Run step 1 (import.js) first: customers, suppliers and items must already exist.
//
//   const report = await importLedger(prisma, data, { dryRun: true })
//
// What it posts (the same entries your software makes when you save these by hand):
//   Invoice : Dr Accounts Receivable 1100 / Cr Sales 4000 + Sales Tax 2100 (+ Rounding)
//   Receipt : Dr bank account / Cr Accounts Receivable 1100 (or Sales for item lines, Suspense if no account)
//   Payment : Dr Accounts Payable 2000 (or Suspense) / Cr bank account
//   Purchase invoice : Dr General Expenses 6000 / Cr Accounts Payable 2000 (no stock, same as the sales side)
// STOCK IS NOT TOUCHED and no cost of sales is posted: the old invoices are history. Set opening stock separately.
// Everything is saved in ONE transaction. Dry run saves nothing and returns the report, including a balance check against Manager.

import { SYSTEM } from './reader.js'
import { fitLine, lineAmount, r2, assignAll } from './import.js'

const clean = v => { const s = String(v ?? '').trim(); return s || null }
const UNDEPOSITED = 'Undeposited funds'
const side = (accountId, signedDebit) => ({ accountId, debit: signedDebit > 0 ? r2(signedDebit) : 0, credit: signedDebit < 0 ? r2(-signedDebit) : 0 }) // negative amounts swap sides

export async function runLedger(tx, data, dryRun) {
  const rep = { created: { banks: 0, invoices: 0, bills: 0, receipts: 0, payments: 0 }, skipped: { invoices: 0, bills: 0, receipts: 0, payments: 0 },
    undepositedReceipts: 0, undepositedPayments: 0, suspenseLines: 0, splitQuantityLines: 0, negativeAmounts: [], balanceMismatches: [], customersWithCredit: [], notes: [] }

  {
    // ---- Accounts we post to ----
    const acc = {}
    for (const code of ['1100', '2100', '4000', '2000']) {
      const a = await tx.account.findUnique({ where: { code } })
      if (!a) throw new Error(`Account ${code} is missing from your chart of accounts`)
      acc[code] = a.id
    }
    const upsert = async (code, name, type) => (await tx.account.upsert({ where: { code }, update: {}, create: { code, name, type } })).id
    const suspense = await upsert('1900', 'Suspense', 'asset'), rounding = await upsert('6900', 'Rounding', 'expense')

    // ---- Contacts and items created by step 1 (same order, so every Manager record finds its own) ----
    const { idByKey: idOf, itemByKey: itemId, placeholderId: unknownId } = await assignAll(tx, data)

    // ---- Bank and cash accounts (created if their name does not exist yet) ----
    const banks = await tx.bankAccount.findMany()
    const bankByName = new Map(banks.map(b => [b.name.toLowerCase(), b]))
    const codes = (await tx.account.findMany({ where: { code: { startsWith: '10' } }, select: { code: true } })).map(a => +a.code).filter(c => c >= 1000 && c < 1100)
    let nextCode = Math.max(1000, ...codes) + 1
    const ensureBank = async name => {
      let b = bankByName.get(name.toLowerCase())
      if (!b) {
        if (nextCode >= 1100) throw new Error('No more bank account codes are available')
        const a = await tx.account.create({ data: { code: String(nextCode++), name, type: 'asset' } })
        b = await tx.bankAccount.create({ data: { name, accountId: a.id } }); bankByName.set(name.toLowerCase(), b); rep.created.banks++
      }
      return b
    }
    const bankOf = new Map()
    for (const b of data.banks) bankOf.set(b.key, await ensureBank(b.name || '(bank)'))
    const undeposited = await ensureBank(UNDEPOSITED)

    const journal = (date, memo, ref, lines) => {
      const d = r2(lines.reduce((s, l) => s + l.debit, 0)), c = r2(lines.reduce((s, l) => s + l.credit, 0))
      if (Math.abs(d - c) > 0.005) throw new Error(`Entry ${ref} does not balance (${d} / ${c})`)
      return dryRun ? null : tx.journal.create({ data: { date: new Date(date), memo, ref, lines: { create: lines.filter(l => l.debit || l.credit) } } })
    }
    const ours = new Map()                       // what we will owe per Manager customer/supplier key, to check against Manager
    const bump = (k, n) => k && ours.set(k, r2((ours.get(k) || 0) + n))
    const invoiceIdByKey = new Map()
    // ---- Sales invoices ----
    const before = new Set((await tx.invoice.findMany({ where: { kind: 'sale' }, select: { number: true } })).map(i => i.number))   // invoices already in your software
    const haveInv = new Set(before)
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (+a.reference || 0) - (+b.reference || 0)
    let seq = 0
    for (const inv of [...data.invoices].sort(byDate)) {
      seq++
      const ref = inv.reference
      let number = 'INV-' + (/^\d+$/.test(ref) ? ref.padStart(4, '0') : (ref.replace(/\s+/g, '') || String(seq).padStart(4, '0')))
      if (before.has(number)) { rep.skipped.invoices++; continue }          // imported on an earlier run
      if (haveInv.has(number)) {                                            // the same reference twice inside the file: keep both, number the second one
        const base = number; for (let i = 2; haveInv.has(number); i++) number = `${base}-${i}`
        rep.notes.push(`Manager has two invoices with reference ${ref || '(empty)'}: the second one is saved as ${number}`)
      }
      haveInv.add(number)
      const contactId = idOf.get(inv.customerKey) ?? unknownId
      if (!contactId) throw new Error(`Invoice ${number} has no customer. Run step 1 first so "Unknown customer" exists.`)
      const lines = inv.lines.map(l => { const f = fitLine(l); if (f.changed) rep.splitQuantityLines++; return { itemId: itemId.get(l.itemKey) ?? null, description: f.description || '', qty: f.qty, price: f.price, discount: f.discount } })
      const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0))
      const rnd = r2(inv.total - subtotal - inv.tax)
      const taxRate = inv.taxRate || (subtotal ? r2(inv.tax / subtotal * 100) : 0)
            if (!dryRun) {
        const saved = await tx.invoice.create({ data: { number, kind: 'sale', date: new Date(inv.date), contactId, total: inv.total, tax: inv.tax, taxRate, status: 'active',
          reference: clean(ref), address: clean(inv.address), description: clean(inv.description), subtotal, rounding: rnd,
          netDays: 0, dueDate: new Date(inv.date),            // Manager: no due date = due on the invoice date
          lines: { create: lines } } })
        invoiceIdByKey.set(inv.key, saved.id)
      }
      await journal(inv.date, number, number, [side(acc['1100'], inv.total), side(acc['4000'], -subtotal), side(acc['2100'], -inv.tax), side(rounding, -rnd)])
      bump(inv.customerKey ?? 'unknown', inv.total); rep.created.invoices++
    }

    // ---- Purchase invoices (posted as expenses: Dr General Expenses 6000 / Cr Accounts Payable 2000, no stock) ----
    const expense = await upsert('6000', 'General Expenses', 'expense')
    const haveBill = new Set((await tx.invoice.findMany({ where: { kind: 'purchase' }, select: { number: true } })).map(i => i.number))
    const billsBefore = new Set(haveBill)
    let bseq = 0
    for (const b of [...data.purchases].sort(byDate)) {
      bseq++
      const ref = b.reference
      let number = 'BILL-' + (/^\d+$/.test(ref) ? ref.padStart(4, '0') : (ref.replace(/\s+/g, '') || String(bseq).padStart(4, '0')))
      if (billsBefore.has(number)) { rep.skipped.bills++; continue }
      if (haveBill.has(number)) { const base = number; for (let i = 2; haveBill.has(number); i++) number = `${base}-${i}`; rep.notes.push(`Manager has two purchase invoices with reference ${ref || '(empty)'}: the second one is saved as ${number}`) }
      haveBill.add(number)
      const contactId = idOf.get(b.supplierKey)
      if (!contactId) throw new Error(`Purchase invoice ${number} has no supplier in your software`)
      const lines = b.lines.map(l => { const f = fitLine(l); if (f.changed) rep.splitQuantityLines++; return { itemId: itemId.get(l.itemKey) ?? null, description: f.description || '', qty: f.qty, price: f.price, discount: f.discount } })
      const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0)), rnd = r2(b.total - subtotal)
      if (!dryRun) await tx.invoice.create({ data: { number, kind: 'purchase', date: new Date(b.date), contactId, total: b.total, tax: 0, taxRate: 0, status: 'active',
        reference: clean(ref), description: clean(b.description), subtotal, rounding: rnd, lines: { create: lines } } })
      await journal(b.date, number, number, [side(expense, subtotal), side(rounding, rnd), side(acc['2000'], -b.total)])
      bump(b.supplierKey, b.total); rep.created.bills++
    }

    // ---- Receipts and payments ----
    const existingPay = new Set((await tx.payment.findMany({ select: { date: true, contactId: true, reference: true, total: true } }))
      .map(p => `${p.date.toISOString().slice(0, 10)}|${p.contactId}|${p.reference || ''}|${+p.total}`))
    const counters = { receipt: 0, payment: 0 }
    const lastNo = async (kind, prefix) => { const l = await tx.payment.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { number: true } }); return l ? parseInt(l.number.slice(prefix.length), 10) || 0 : 0 }
    counters.receipt = await lastNo('receipt', 'REC-'); counters.payment = await lastNo('payment', 'PAY-')

    const postOne = async (kind, doc) => {
      const receipt = kind === 'receipt', link = receipt ? SYSTEM.receivable : SYSTEM.payable, linkId = acc[receipt ? '1100' : '2000']
      let contactId = idOf.get(doc.payerKey)
      if (!contactId && !doc.payerKey && unknownId) { contactId = unknownId; rep.notes.push(`${kind} ${doc.date} ref ${doc.reference || '-'} (Rs ${r2(doc.lines.reduce((s, l) => s + l.amount, 0))}) has no ${receipt ? 'payer' : 'payee'} in Manager: filed under "Unknown customer", amount in Suspense`) }
      if (!contactId) throw new Error(`${kind} ${doc.date} ${doc.reference}: the ${receipt ? 'payer' : 'payee'} is not in your software`)
      const bank = doc.bankKey ? bankOf.get(doc.bankKey) : undeposited
      if (!bank) throw new Error(`${kind} ${doc.date}: unknown bank account`)
      if (!doc.bankKey) rep[receipt ? 'undepositedReceipts' : 'undepositedPayments']++
      const lines = doc.lines.map(l => {
        
        let accountId = (l.accountKey === link && idOf.get(doc.payerKey)) ? linkId : (receipt && l.itemKey ? acc['4000'] : suspense)
        if (accountId === suspense) rep.suspenseLines++
               return { accountId, description: String(l.description || '').slice(0, 200), amount: l.amount, isLink: accountId === linkId, key: l.customerKey, invoiceKey: l.invoiceKey }
      })
      const total = r2(lines.reduce((s, l) => s + l.amount, 0)), applied = r2(lines.filter(l => l.isLink).reduce((s, l) => s + l.amount, 0))
      if (lines.some(l => l.amount < 0)) rep.negativeAmounts.push(`${kind} ${doc.date} ${doc.reference || ''}: ${total}`)
      const dupe = `${doc.date}|${contactId}|${clean(doc.reference) || ''}|${total}`
      if (existingPay.has(dupe)) { rep.skipped[kind + 's']++; return }
            const number = (receipt ? 'REC-' : 'PAY-') + String(++counters[kind]).padStart(4, '0')
      if (!dryRun) await tx.payment.create({ data: { kind, number, contactId, amount: applied, date: new Date(doc.date), reference: clean(doc.reference), description: clean(doc.description),
        bankId: bank.id, total, lines: { create: lines.map(l => ({ accountId: l.accountId, description: l.description, amount: l.amount,
          invoiceId: receipt && l.isLink ? (invoiceIdByKey.get(l.invoiceKey) ?? null) : null })) } } })
      const memo = `${number} ${doc.reference || ''}`.trim()
      await journal(doc.date, memo, number, [side(bank.accountId, receipt ? total : -total), ...lines.map(l => side(l.accountId, receipt ? -l.amount : l.amount))])
      for (const l of lines.filter(l => l.isLink)) bump(receipt ? (l.key || doc.payerKey) : doc.payerKey, -l.amount)   // both reduce what the contact owes
      rep.created[kind + 's']++
    }
        // One Manager receipt can pay several customers (each line names its customer).
    // We save one payment per customer, so every customer's balance is right.
    
    const invCust = new Map(data.invoices.map(i => [i.key, i.customerKey]))
    const post = async (kind, doc) => {
      if (kind !== 'receipt') return postOne(kind, doc)
      const parts = new Map()
      for (const l of doc.lines) {
        let owner = doc.payerKey
        if (l.accountKey === SYSTEM.receivable) {
          const c = invCust.get(l.invoiceKey) || l.customerKey
          if (c && idOf.has(c)) owner = c
        }
        if (!parts.has(owner)) parts.set(owner, [])
        parts.get(owner).push(l)
      }
      if (!parts.size) parts.set(doc.payerKey, [])
      if (parts.size > 1) rep.notes.push(`Receipt ${doc.date} ref ${doc.reference || '-'} pays ${parts.size} customers: saved as ${parts.size} payments`)
      for (const [owner, lines] of parts) await postOne(kind, { ...doc, payerKey: owner, lines })
  
    }

    for (const r of [...data.receipts].sort(byDate)) await post('receipt', r)
    for (const p of [...data.payments].sort(byDate)) await post('payment', p)

    // ---- Check: every customer's and supplier's balance must equal Manager's ----
    const names = new Map([...data.customers, ...data.suppliers].map(c => [c.key, c.name]))
    const custKeys = new Set([...data.customers, ...data.suppliers].map(c => c.key))
    for (const k of custKeys) {
      const a = ours.get(k) || 0, b = data.balances.get(k) || 0
      if (Math.abs(a - b) > 0.005) rep.balanceMismatches.push(`${names.get(k)}: ours ${a}, Manager ${b}`)
      if (b < -0.005) rep.customersWithCredit.push(`${names.get(k)}: ${b}`)   // credit balance (they overpaid / we overpaid)
    }
    rep.receivableTotal = r2(data.customers.reduce((s, c) => s + (ours.get(c.key) || 0), 0))
    rep.payableTotal = r2(data.suppliers.reduce((s, c) => s + (ours.get(c.key) || 0), 0))
  }
  return rep
}

// Runs step 2 alone in its own transaction (used by scripts/import-ledger.js; step 1 must already be saved)
export async function importLedger(prisma, data, { dryRun = true } = {}) {
  let rep
  try { await prisma.$transaction(async tx => { rep = await runLedger(tx, data, dryRun); if (dryRun) throw Object.assign(new Error('dry run'), { dry: true }) }, { timeout: 600000, maxWait: 30000 }) } catch (e) { if (!e.dry) throw e }
  rep.dryRun = dryRun
  return rep
}