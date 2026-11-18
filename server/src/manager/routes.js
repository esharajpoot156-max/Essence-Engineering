// src/manager/routes.js
// Web API for the "Import from Manager" page. Admin only.
//
//   POST /api/import/manager/upload      body = the raw bytes of the .manager file. Reads it, saves NOTHING, returns a summary + an id.
//   POST /api/import/manager/:id/run     body = { save: false }                  -> TEST run (everything is worked out, then rolled back)
//                                        body = { save: true, confirm: 'IMPORT' } -> REAL import (needs a successful test run first)
//   GET  /api/import/manager/:id         status of the run (poll this every 2 seconds)
//
// The real import runs steps 1 and 2 (import.js + ledger.js) in ONE database transaction: all or nothing.
// It runs in the background, so a long import never hits a browser or Render time-out.
// The uploaded file is kept in the server's memory for 1 hour only (nothing is written to disk).
import express from 'express'
import crypto from 'crypto'

const TTL = 60 * 60 * 1000                        // forget an uploaded file after 1 hour
const jobs = new Map()                            // id -> job
let busy = false                                  // only one run at a time

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const sum = (rows, f) => r2(rows.reduce((s, x) => s + (Number(f(x)) || 0), 0))
// Prisma errors are long; keep the useful last lines
const short = e => String(e?.message || e).split('\n').map(s => s.trim()).filter(Boolean).slice(-3).join(' ').slice(0, 400)

// What is inside the file, in numbers the client can compare with Manager's own reports
function summarize(data) {
  const custKeys = new Set(data.customers.map(c => c.key)), suppKeys = new Set(data.suppliers.map(c => c.key))
  const owe = keys => r2([...data.balances].filter(([k]) => keys.has(k)).reduce((s, [, v]) => s + v, 0))
  return {
    counts: {
      customers: data.customers.length, suppliers: data.suppliers.length, items: data.items.length,
      quotes: data.quotes.length, quotesAccepted: data.quotes.filter(q => q.accepted).length,
      salesInvoices: data.invoices.length, purchaseInvoices: data.purchases.length,
      receipts: data.receipts.length, payments: data.payments.length, banks: data.banks.length,
    },
    totals: {
      salesInvoicesBeforeTax: sum(data.invoices, i => i.subtotal), salesTax: sum(data.invoices, i => i.tax), salesInvoices: sum(data.invoices, i => i.total),
      receipts: sum(data.receipts, x => x.lines.reduce((s, l) => s + l.amount, 0)),
      purchaseInvoices: sum(data.purchases, p => p.total),
      payments: sum(data.payments, x => x.lines.reduce((s, l) => s + l.amount, 0)),
      customersOwe: owe(custKeys), suppliersOwe: owe(suppKeys),
    },
    banks: data.banks.map(b => b.name),
    receiptsWithoutBank: data.receipts.filter(x => !x.bankKey).length,
    paymentsWithoutBank: data.payments.filter(x => !x.bankKey).length,
    warnings: data.warnings,
  }
}

export default function managerImport(app, { prisma, wrap, fail, auth }, deps = {}) {
  const adminOnly = req => { if (req.user.role !== 'admin') fail('Only an admin can import data', 403) }
  // Loaded when first needed, so a missing file never stops the server from starting
  const engine = async () => {
    try {
      return {
        readManager: deps.readManager || (await import('./reader.js')).readManager,
        runBasics: deps.runBasics || (await import('./import.js')).runBasics,
        runLedger: deps.runLedger || (await import('./ledger.js')).runLedger,
      }
    } catch (e) { console.error(e); fail('The import files are not installed on the server (src/manager/reader.js, import.js, ledger.js, and sql.js in package.json)', 500) }
  }
  const getJob = req => {
    const j = jobs.get(req.params.id)
    if (!j) fail('This upload has expired. Please choose the file again.', 404)
    return j
  }
  // Remove old uploads
  setInterval(() => { for (const [id, j] of jobs) if (Date.now() - j.createdAt > TTL && j.status !== 'running') jobs.delete(id) }, 10 * 60 * 1000).unref()

  // 1. Upload + read. Nothing is saved.
  app.post('/api/import/manager/upload', auth, express.raw({ type: () => true, limit: '80mb' }), wrap(async (req, res) => {
    adminOnly(req)
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail('No file received')
    const { readManager } = await engine()
    let data
    try { data = await readManager(req.body) } catch (e) { fail(e.message || 'This is not a Manager file') }
    const [contacts, salesInvoices, purchaseInvoices, payments, quotes] = await Promise.all([
      prisma.contact.count(), prisma.invoice.count({ where: { kind: 'sale' } }), prisma.invoice.count({ where: { kind: 'purchase' } }),
      prisma.payment.count(), prisma.salesDoc.count({ where: { kind: 'quote' } })])
    const id = crypto.randomUUID()
    jobs.set(id, { id, createdAt: Date.now(), data, status: 'ready', dryOk: false, saved: false })
    res.json({ id, summary: summarize(data), existing: { contacts, salesInvoices, purchaseInvoices, payments, quotes } })
  }))

  // 2. Start a test run or the real import (in the background)
  app.post('/api/import/manager/:id/run', auth, wrap(async (req, res) => {
    adminOnly(req)
    const job = getJob(req), save = !!req.body?.save
    if (busy || job.status === 'running') fail('An import is already running. Wait until it finishes.', 409)
    if (save) {
      if (job.saved) fail('This file was already imported. Upload it again if you really want to run it again.', 409)
      if (!job.dryOk) fail('Run the test first. The real import is only allowed after a successful test.', 409)
      if (req.body?.confirm !== 'IMPORT') fail('Type IMPORT to confirm', 400)
    }
    const { runBasics, runLedger } = await engine()
    busy = true
    Object.assign(job, { status: 'running', mode: save ? 'import' : 'test', startedAt: Date.now(), endedAt: null, result: null, error: null })
    ;(async () => {
      let basics, ledger, failed = null
      try {
        await prisma.$transaction(async tx => {
          basics = await runBasics(tx, job.data, !save)
          ledger = await runLedger(tx, job.data, !save)
          if (!save) throw Object.assign(new Error('test run'), { dry: true })   // test run: roll everything back
        }, { timeout: 15 * 60 * 1000, maxWait: 30000 })
      } catch (e) {
        if (!e.dry) { console.error(e); failed = short(e) }
      }
      if (failed) Object.assign(job, { status: 'error', error: failed, result: null })
      else Object.assign(job, { status: 'done', error: null, result: { basics, ledger }, dryOk: job.dryOk || !save, saved: save })
      job.endedAt = Date.now(); busy = false
    })()
    res.json({ ok: true })
  }))

  // 3. Progress / result
  app.get('/api/import/manager/:id', auth, wrap(async (req, res) => {
    adminOnly(req)
    const j = getJob(req)
    res.json({ status: j.status, mode: j.mode, saved: j.saved, dryOk: j.dryOk, error: j.error, result: j.result, seconds: Math.round(((j.endedAt || Date.now()) - (j.startedAt || Date.now())) / 1000) })
  }))
}