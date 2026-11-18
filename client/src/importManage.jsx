// src/ImportManager.jsx
// "Import from Manager": upload a .manager file, TEST the import (saves nothing), then import for real.
// Admin only. Talks to server/src/manager/routes.js
//   POST /import/manager/upload      (raw file bytes)  -> { id, summary, existing }
//   POST /import/manager/:id/run     { save, confirm }
//   GET  /import/manager/:id         -> { status, mode, error, result, seconds, saved, dryOk }
import { useEffect, useRef, useState } from 'react'
import { api, getToken, setToken } from './api'
import { Btn, BtnLight, Title, Err, Badge, Table } from './ui'

const API = (import.meta.env.VITE_API_URL || '') + '/api'
// Shows 1234567.5 as 1,234,567.50 (the import needs exact rupees, so no rounding here)
const rs = n => new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005

// A small box with a title
const Card = ({ title, children }) => (
  <section className="bg-white rounded border border-navy/10 p-4 mb-4">
    <h2 className="font-semibold text-navy mb-3">{title}</h2>
    {children}
  </section>
)
// A list of messages (shows the first 8 and the count of the rest)
const Notes = ({ rows, tone = 'text-red-700' }) => !rows?.length ? null : (
  <ul className={'text-sm list-disc pl-5 space-y-1 ' + tone}>
    {rows.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}
    {rows.length > 8 && <li>…and {rows.length - 8} more</li>}
  </ul>
)

export default function ImportManager() {
  const [file, setFile] = useState(null)
  const [up, setUp] = useState(null)            // { id, summary, existing } after the file is read
  const [job, setJob] = useState(null)          // latest status from the server
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [word, setWord] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearInterval(timer.current), [])

  // Step 1: send the file to the server (nothing is saved)
  const upload = async () => {
    if (!file) return
    setErr(''); setBusy(true); setUp(null); setJob(null); setWord(''); setReviewed(false)
    try {
      const r = await fetch(API + '/import/manager/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + getToken() }, body: file })
      const data = await r.json().catch(() => ({}))
      if (r.status === 401) { setToken(null); location.href = '/' }
      if (!r.ok) throw new Error(data.error || 'The file could not be read')
      setUp(data)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  // Steps 2 and 3: start a run and watch it until it ends
  const run = async save => {
    setErr(''); setJob({ status: 'running', mode: save ? 'import' : 'test', seconds: 0 })
    try {
      await api(`/import/manager/${up.id}/run`, { method: 'POST', body: { save, confirm: save ? word : undefined } })
    } catch (e) { setErr(e.message); setJob(null); return }
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try {
        const j = await api(`/import/manager/${up.id}`)
        setJob(j)
        if (j.status !== 'running') clearInterval(timer.current)
      } catch (e) { clearInterval(timer.current); setErr(e.message) }
    }, 2000)
  }

  const s = up?.summary, ex = up?.existing
  const running = job?.status === 'running'
  const rep = job?.status === 'done' ? job.result : null
  const L = rep?.ledger, B = rep?.basics
  const mismatches = L?.balanceMismatches?.length || 0
  const testPassed = job?.status === 'done' && job.mode === 'test'
  const imported = job?.status === 'done' && job.mode === 'import'
  const dbHasData = ex && (ex.salesInvoices > 0 || ex.purchaseInvoices > 0 || ex.payments > 0)
  const canImport = (job?.dryOk || testPassed) && !imported && !running && word === 'IMPORT' && (!mismatches || reviewed)

  return (
    <div className="max-w-5xl">
      <Title hint="Move your customers, suppliers, items, quotes, invoices, receipts and payments from a Manager.io file into this software.">Import from Manager</Title>

      {/* 1. Choose the file */}
      <Card title="1. Choose your Manager file">
        <p className="text-sm text-ink/70 mb-3">In Manager, open <b>Backup</b> and download the <b>.manager</b> file. Choose it here. Nothing is saved at this step.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".manager" disabled={busy || running} onChange={e => { setFile(e.target.files[0] || null); setUp(null); setJob(null); setErr('') }} className="text-sm" />
          <Btn onClick={upload} disabled={!file || busy || running}>{busy ? 'Reading…' : 'Read file'}</Btn>
        </div>
        <Err e={!up && err} />
      </Card>

      {up && (<>
        {/* What is inside the file */}
        <Card title="What is inside the file">
          <Table rows={[
            { id: 1, a: 'Customers', n: s.counts.customers }, { id: 2, a: 'Suppliers', n: s.counts.suppliers }, { id: 3, a: 'Inventory items', n: s.counts.items },
            { id: 4, a: 'Sales quotes', n: `${s.counts.quotes} (${s.counts.quotesAccepted} accepted)` }, { id: 5, a: 'Sales invoices', n: s.counts.salesInvoices },
            { id: 6, a: 'Purchase invoices', n: s.counts.purchaseInvoices }, { id: 7, a: 'Receipts', n: s.counts.receipts }, { id: 8, a: 'Payments', n: s.counts.payments },
            { id: 9, a: 'Bank and cash accounts', n: `${s.counts.banks} (${s.banks.join(', ') || '-'})` },
          ]} cols={[['Record', r => r.a], ['In the file', r => r.n, true]]} />
          <p className="text-sm text-ink/70 mt-3 mb-2">Compare these totals with Manager (Summary page, Customers and Suppliers lists). They must match to the rupee:</p>
          <Table rows={[
            { id: 1, a: 'Sales invoices, before tax', n: s.totals.salesInvoicesBeforeTax }, { id: 2, a: 'Sales tax', n: s.totals.salesTax },
            { id: 3, a: 'Sales invoices, total', n: s.totals.salesInvoices }, { id: 4, a: 'Receipts, total', n: s.totals.receipts },
            { id: 5, a: 'Customers owe (invoices minus receipts)', n: s.totals.customersOwe }, { id: 6, a: 'Purchase invoices, total', n: s.totals.purchaseInvoices },
            { id: 7, a: 'Payments, total', n: s.totals.payments }, { id: 8, a: 'You owe suppliers', n: s.totals.suppliersOwe },
          ]} cols={[['Amount', r => r.a], ['Rs', r => rs(r.n), true]]} />
          {(s.receiptsWithoutBank > 0 || s.paymentsWithoutBank > 0) && (
            <p className="text-sm text-ink/70 mt-3">{s.receiptsWithoutBank} receipts and {s.paymentsWithoutBank} payments do not name a bank account. They are saved in an account called <b>Undeposited funds</b>; move them to the right bank later with an Inter Account Transfer.</p>)}
          {s.warnings?.length > 0 && <div className="mt-3"><p className="text-sm font-medium text-ink mb-1">Things to know:</p><Notes rows={s.warnings} tone="text-amber-700" /></div>}
          {dbHasData && (
            <p className="text-sm text-amber-700 mt-3">This software already has {ex.salesInvoices} sales invoices, {ex.purchaseInvoices} purchase invoices and {ex.payments} receipts/payments. Documents with the same number (INV-…, BILL-…) are skipped, never duplicated. If this is the live database, make a Neon backup first (a branch).</p>)}
        </Card>

        {/* 2. Test */}
        <Card title="2. Test the import (saves nothing)">
          <p className="text-sm text-ink/70 mb-3">The server works out everything and compares each customer’s and supplier’s balance with Manager, then cancels it. Nothing changes in your data.</p>
          <BtnLight onClick={() => run(false)} disabled={running || imported}>Run test</BtnLight>
          {running && <p className="text-sm mt-3">{job.mode === 'import' ? 'Importing' : 'Testing'}… {job.seconds || 0}s. Please keep this page open.</p>}
          {job?.status === 'error' && <Err e={'Failed, nothing was saved: ' + job.error} />}
          <Err e={up && err} />

          {rep && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                {mismatches === 0 ? <Badge tone="green">Balances match Manager</Badge> : <Badge tone="red">{mismatches} balances differ from Manager</Badge>}
                <span className="text-sm text-ink/60">{imported ? 'Saved' : 'Test only, nothing saved'} · {job.seconds}s</span>
              </div>
              <Table rows={[
                { id: 1, a: 'Customers / suppliers / items', n: `${B.created.customers} / ${B.created.suppliers} / ${B.created.items}` },
                { id: 2, a: 'Sales quotes', n: B.created.quotes + (B.skippedQuotes ? ` (${B.skippedQuotes} already there)` : '') },
                { id: 3, a: 'Sales invoices', n: L.created.invoices + (L.skipped.invoices ? ` (${L.skipped.invoices} already there)` : '') },
                { id: 4, a: 'Purchase invoices', n: L.created.bills + (L.skipped.bills ? ` (${L.skipped.bills} already there)` : '') },
                { id: 5, a: 'Receipts', n: L.created.receipts + (L.skipped.receipts ? ` (${L.skipped.receipts} already there)` : '') },
                { id: 6, a: 'Payments', n: L.created.payments + (L.skipped.payments ? ` (${L.skipped.payments} already there)` : '') },
                { id: 7, a: 'New bank accounts', n: L.created.banks },
                { id: 8, a: 'Customers owe (this software)', n: <span className={same(L.receivableTotal, s.totals.customersOwe) ? 'text-green-700' : 'text-red-700'}>Rs {rs(L.receivableTotal)} (Manager: Rs {rs(s.totals.customersOwe)})</span> },
                { id: 9, a: 'You owe suppliers (this software)', n: <span className={same(L.payableTotal, s.totals.suppliersOwe) ? 'text-green-700' : 'text-red-700'}>Rs {rs(L.payableTotal)} (Manager: Rs {rs(s.totals.suppliersOwe)})</span> },
              ]} cols={[['Result', r => r.a], ['', r => r.n, true]]} />
              {B.placeholderQuotes > 0 && <p className="text-sm text-ink/70">{B.placeholderQuotes} quotes have no customer in Manager. They are filed under “Unknown customer”.</p>}
              {(B.splitQuantityLines + L.splitQuantityLines) > 0 && <p className="text-sm text-ink/70">{B.splitQuantityLines + L.splitQuantityLines} lines had decimal quantities. They are saved as 1 × the full amount, with the original quantity written in the description, so every total stays exact.</p>}
              {L.suspenseLines > 0 && <p className="text-sm text-ink/70">{L.suspenseLines} receipt/payment lines had no matching account and are saved in <b>Suspense (1900)</b>. Re-classify them later.</p>}
              {mismatches > 0 && <div><p className="text-sm font-medium text-red-700 mb-1">Balances that differ from Manager:</p><Notes rows={L.balanceMismatches} /></div>}
              {B.totalMismatches?.length > 0 && <div><p className="text-sm font-medium text-red-700 mb-1">Quote totals that differ:</p><Notes rows={B.totalMismatches} /></div>}
              {L.negativeAmounts?.length > 0 && <div><p className="text-sm font-medium text-amber-700 mb-1">Negative amounts:</p><Notes rows={L.negativeAmounts} tone="text-amber-700" /></div>}
              {L.customersWithCredit?.length > 0 && <div><p className="text-sm font-medium text-amber-700 mb-1">Customers with a credit balance (they paid more than invoiced):</p><Notes rows={L.customersWithCredit} tone="text-amber-700" /></div>}
              {L.notes?.length > 0 && <Notes rows={L.notes} tone="text-ink/70" />}
            </div>)}
        </Card>

        {/* 3. Import for real */}
        <Card title="3. Import for real">
          {imported ? (
            <p className="text-sm text-green-700">Done. Everything was saved in one step. Open Customers, Sales Invoices and Bank and Cash Accounts to check it. Stock was not changed: set your opening stock separately.</p>
          ) : (<>
            <p className="text-sm text-ink/70 mb-3">All or nothing: if anything fails, nothing is saved. Stock is not changed, and no cost of sales is posted for the old invoices. This unlocks after a successful test.</p>
            {mismatches > 0 && testPassed && (
              <label className="flex items-start gap-2 text-sm text-red-700 mb-3"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I have read the balances that differ from Manager and I want to import anyway.</label>)}
            <div className="flex flex-wrap items-center gap-3">
              <input value={word} onChange={e => setWord(e.target.value.trim())} placeholder="Type IMPORT" disabled={!(job?.dryOk || testPassed) || running} className="border border-navy/20 rounded px-3 py-2 text-sm w-40 bg-white" />
              <Btn onClick={() => run(true)} disabled={!canImport}>Import now</Btn>
            </div>
          </>)}
        </Card>
      </>)}
    </div>)
}