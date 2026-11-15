// src/InventoryItems.jsx
// Inventory Items (Manager.io style): list, view page, form and spreadsheet import.
// Replaces the old Inventory page that was in pages.jsx. No SKU and no minimum stock, as the client asked.
// Expected API (new parts to be built later):
//   GET    /items   -> [{ id, name, description, unitName, valuationMethod, qty (on hand), qtyToDeliver, qtyToReceive,
//                         cost (average cost), price (sales price), purchasePrice,
//                         customIncomeAccountId, customExpenseAccountId, lineDescription, salesDivision, hideName }]
//   POST   /items   -> create (already exists; extra fields are ignored until the backend is updated)
//   PUT    /items/:id, DELETE /items/:id -> to be built
// Also reads: /accounts (for the custom income and expense accounts)
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from './api'
import { useLoad, money, Btn, BtnLight, Title, Err, Field, Table, inp } from './ui'

// Valuation methods offered in the form (First in, first out is the default)
const METHODS = ['First in, first out', 'Average cost']

// Options of the "stock level" filter in Advanced Queries
const STOCK_FILTERS = [['all', 'Any stock level'], ['negative', 'Negative available'], ['zero', 'Zero available'], ['positive', 'Positive available']]

// Spreadsheet import: [field, label, required, header names for auto-match (lowercase)]
const IMPORT_FIELDS = [
  ['name', 'Item name', true, ['item name', 'name', 'item', 'product', 'product name']],
  ['unitName', 'Unit name', false, ['unit name', 'unit', 'uom']],
  ['description', 'Description', false, ['description', 'details']],
  ['purchasePrice', 'Purchase price', false, ['purchase price', 'cost price', 'cost', 'buying price', 'purchase']],
  ['salesPrice', 'Sales price', false, ['sales price', 'sale price', 'selling price', 'price', 'rate']],
]

// Turns values like "1,200" or "Rs 1200" into a number (0 if it cannot be read)
const toNum = v => Number(String(v).replace(/[^\d.-]/g, '')) || 0

// Empty form values
const BLANK = {
  name: '', description: '', unitName: '', valuationMethod: METHODS[0],
  customIncomeAccountId: '', customExpenseAccountId: '',
  lineDescription: '', purchasePrice: '', salesPrice: '', salesDivision: '', hideName: false,
}

// Qty available = Qty on hand + Qty to receive - Qty to deliver
// A negative value means more stock is promised to customers than the company holds.
const onHand = r => Number(r.qtyOnHand ?? r.qty) || 0
const available = r => onHand(r) + (Number(r.qtyToReceive) || 0) - (Number(r.qtyToDeliver) || 0)
const avgCost = r => Number(r.averageCost ?? r.cost) || 0
const unitOf = r => r.unitName ?? r.unit

export default function InventoryItems() {
  const [rows, reload] = useLoad('/items')
  const [accounts] = useLoad('/accounts')

  const [view, setView] = useState('list') // 'list' | 'form' | 'view' | 'import'
  const [f, setF] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [current, setCurrent] = useState(null) // item shown on the view page
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  // Advanced Queries panel: extra filters for the list
  const [advOpen, setAdvOpen] = useState(false)
  const [adv, setAdv] = useState({ unit: '', stock: 'all', desc: '' })

  // Optional parts of the form: shown only when ticked
  const [showAccounts, setShowAccounts] = useState(false)
  const [showAutofill, setShowAutofill] = useState(false)

  // Spreadsheet import
  const [imp, setImp] = useState(null)          // { fileName, headers, data } (data = the rows, without the header row)
  const [map, setMap] = useState({})            // field -> column index ('' = not mapped)
  const [skipExisting, setSkipExisting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)    // { ok, skipped, failed: [] }

  const set = patch => setF({ ...f, ...patch })

  const openNew = () => { setF(BLANK); setEditing(null); setShowAccounts(false); setShowAutofill(false); setErr(''); setView('form') }
  const openImport = () => { setImp(null); setMap({}); setResult(null); setProgress(0); setErr(''); setView('import') }

  const openEdit = r => {
    setF({
      name: r.name || '', description: r.description || '', unitName: unitOf(r) ?? '', valuationMethod: r.valuationMethod || METHODS[0],
      customIncomeAccountId: String(r.customIncomeAccountId ?? ''), customExpenseAccountId: String(r.customExpenseAccountId ?? ''),
      lineDescription: r.lineDescription || '', purchasePrice: r.purchasePrice ?? r.cost ?? '', salesPrice: r.salesPrice ?? r.price ?? '',
      salesDivision: r.salesDivision || '', hideName: !!r.hideName,
    })
    setShowAccounts(!!(r.customIncomeAccountId || r.customExpenseAccountId))
    setShowAutofill(!!(r.lineDescription || r.salesDivision || r.purchasePrice || r.salesPrice))
    setEditing(r); setErr(''); setView('form')
  }

  // Saves the form. addAnother = true keeps a fresh form open (new items only).
  const save = async addAnother => {
    if (!f.name.trim()) return setErr('Item name is required')
    const body = {
      // New field names
      name: f.name.trim(), description: f.description.trim(), unitName: f.unitName.trim(), valuationMethod: f.valuationMethod, hideName: f.hideName,
      customIncomeAccountId: showAccounts && f.customIncomeAccountId ? +f.customIncomeAccountId : null,
      customExpenseAccountId: showAccounts && f.customExpenseAccountId ? +f.customExpenseAccountId : null,
      lineDescription: showAutofill ? f.lineDescription : '', salesDivision: showAutofill ? f.salesDivision : '',
      purchasePrice: showAutofill ? Number(f.purchasePrice) || 0 : 0, salesPrice: showAutofill ? Number(f.salesPrice) || 0 : 0,
      // Old field names, so the current backend still accepts the item
      unit: f.unitName.trim() || 'pcs', cost: Number(f.purchasePrice) || 0, price: Number(f.salesPrice) || 0,
    }
    // TEMPORARY: the backend still requires a unique sku, so new items get a hidden auto-generated one.
    // Remove this line once sku is dropped from the backend schema.
    if (!editing) body.sku = 'ITEM-' + Date.now()
    try {
      if (editing) await api('/items/' + editing.id, { method: 'PUT', body })
      else await api('/items', { method: 'POST', body })
      reload()
      if (addAnother && !editing) { setF(BLANK); setShowAccounts(false); setShowAutofill(false); setErr('') } else setView('list')
    } catch (e) { setErr(e.message) }
  }

  const remove = async r => {
    if (!confirm(`Delete ${r.name}?`)) return
    try { await api('/items/' + r.id, { method: 'DELETE' }); setErr(''); setView('list'); reload() } catch (e) { setErr(e.message) }
  }

  // ---------- Import: read the chosen file ----------
  const pickFile = async file => {
    if (!file) return
    setErr(''); setResult(null); setImp(null)
    try {
      // CSV is read as text, Excel files as binary
      const wb = /\.csv$/i.test(file.name)
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(await file.arrayBuffer(), { type: 'array' })
      // First sheet only, with empty rows removed
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
        .filter(r => r.some(c => String(c).trim() !== ''))
      if (aoa.length < 2) return setErr('No data rows were found in the file after the header row.')
      const headers = aoa[0].map(h => String(h).trim())
      // Match columns automatically by their header names
      const auto = {}
      IMPORT_FIELDS.forEach(([key, , , names]) => {
        const idx = headers.findIndex(h => names.includes(h.toLowerCase()))
        auto[key] = idx >= 0 ? idx : ''
      })
      setImp({ fileName: file.name, headers, data: aoa.slice(1) })
      setMap(auto)
    } catch { setErr('Unable to read the file. Please select an .xlsx, .xls, or .csv file.') }
  }

  // Downloads a sample Excel file that shows the expected format
  const downloadSample = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      IMPORT_FIELDS.map(x => x[1]),
      ['Sample item', 'pcs', 'Optional details', 100, 150],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Items')
    XLSX.writeFile(wb, 'inventory-items-sample.xlsx')
  }

  // ---------- Import: turn the rows into items ----------
  // Names that already exist (lowercase), used to skip duplicates
  const existingNames = new Set((rows || []).map(r => String(r.name || '').trim().toLowerCase()))
  // Reads one cell of a row using the chosen column mapping
  const cell = (r, key) => (map[key] === '' || map[key] === undefined ? '' : r[map[key]] ?? '')
  const built = (imp?.data || []).map((r, i) => ({
    id: i, line: i + 2, // line = spreadsheet row number (the header is row 1)
    name: String(cell(r, 'name')).trim(),
    unitName: String(cell(r, 'unitName')).trim(),
    description: String(cell(r, 'description')).trim(),
    purchasePrice: toNum(cell(r, 'purchasePrice')),
    salesPrice: toNum(cell(r, 'salesPrice')),
  }))

  // Sends the items to the server one by one and collects the results
  const runImport = async () => {
    if (map.name === '' || map.name === undefined) return setErr('Please select the Item name column')
    setBusy(true); setErr(''); setResult(null); setProgress(0)
    const seen = new Set(existingNames)
    const failed = []
    let ok = 0, skipped = 0
    for (let i = 0; i < built.length; i++) {
      const x = built[i]
      setProgress(i + 1)
      if (!x.name) { skipped++; continue }
      const key = x.name.toLowerCase()
      if (skipExisting && seen.has(key)) { skipped++; continue }
      seen.add(key)
      // Same body that the New Inventory Item form sends
      const body = {
        name: x.name, description: x.description, unitName: x.unitName, valuationMethod: METHODS[0], hideName: false,
        customIncomeAccountId: null, customExpenseAccountId: null, lineDescription: '', salesDivision: '',
        purchasePrice: x.purchasePrice, salesPrice: x.salesPrice,
        unit: x.unitName || 'pcs', cost: x.purchasePrice, price: x.salesPrice,
        // TEMPORARY: unique sku, as in the form. Remove this line once sku is dropped from the backend.
        sku: 'ITEM-' + Date.now() + '-' + i,
      }
      try { await api('/items', { method: 'POST', body }); ok++ }
      catch (e) { failed.push(`Row ${x.line} (${x.name}): ${e.message}`) }
    }
    setBusy(false); setResult({ ok, skipped, failed }); reload()
  }

  // ---------- Import view ----------
  if (view === 'import') {
    const missingName = built.filter(x => !x.name).length
    const duplicates = skipExisting ? built.filter(x => x.name && existingNames.has(x.name.toLowerCase())).length : 0
    return (<>
      <Title hint="Add multiple items at once from an Excel or CSV file."
        right={<BtnLight onClick={() => { setView('list'); reload() }}>Back to items</BtnLight>}>Import Inventory Items</Title>

      <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-4xl">
        {/* Step 1: choose the file */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-navy">1. Select file</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pickFile(e.target.files?.[0])} disabled={busy} />
          <p className="text-xs text-ink/60">The first row must contain column headers. <button className="text-gold font-medium" onClick={downloadSample}>Download sample file</button></p>
        </div>

        {imp && (<>
          {/* Step 2: match the columns */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-navy">2. Match columns <span className="font-normal text-ink/60">({imp.fileName}, {imp.data.length} rows)</span></p>
            <div className="grid sm:grid-cols-2 gap-3">
              {IMPORT_FIELDS.map(([key, label, required]) => (
                <Field key={key} label={label + (required ? ' *' : '')}>
                  <select className={inp} value={map[key] ?? ''} disabled={busy}
                    onChange={e => setMap({ ...map, [key]: e.target.value === '' ? '' : Number(e.target.value) })}>
                    <option value="">{required ? 'Select column' : 'Do not import'}</option>
                    {imp.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          {/* Step 3: preview the first rows */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-navy">3. Preview <span className="font-normal text-ink/60">(first 5 rows)</span></p>
            <Table
              cols={[
                ['Row', r => r.line],
                ['Item name', r => r.name || <span className="text-red-700">Empty</span>],
                ['Unit name', r => r.unitName],
                ['Description', r => <span className="block max-w-xs truncate">{r.description}</span>],
                ['Purchase price', r => money(r.purchasePrice), 1],
                ['Sales price', r => money(r.salesPrice), 1],
              ]}
              rows={built.slice(0, 5)}
              empty="No rows found"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipExisting} onChange={e => setSkipExisting(e.target.checked)} disabled={busy} />
              Skip items that already exist with the same name
            </label>
            {(missingName > 0 || duplicates > 0) && (
              <p className="text-xs text-ink/60">
                {missingName > 0 && `${missingName} rows with an empty name will be skipped. `}
                {duplicates > 0 && `${duplicates} items already exist and will be skipped.`}
              </p>
            )}
          </div>

          {/* Step 4: run the import */}
          <div className="flex items-center gap-3">
            <Btn onClick={runImport} disabled={busy}>{busy ? `Importing ${progress} / ${built.length}…` : `Import ${built.length} rows`}</Btn>
          </div>
        </>)}

        <Err e={err} />

        {result && (
          <div className="text-sm space-y-1" role="status">
            <p className="text-green-700 font-medium">{result.ok} items imported successfully{result.skipped > 0 && `, ${result.skipped} skipped`}.</p>
            {result.failed.length > 0 && (
              <div>
                <p className="text-red-700 font-medium">{result.failed.length} rows failed to import:</p>
                <ul className="list-disc pl-5 text-red-700 text-xs space-y-0.5">
                  {result.failed.slice(0, 10).map(m => <li key={m}>{m}</li>)}
                  {result.failed.length > 10 && <li>… and {result.failed.length - 10} more rows</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </>)
  }

  // ---------- Form view ----------
  if (view === 'form') return (<>
    <Title hint="Items you buy, hold and sell.">{editing ? 'Edit Inventory Item' : 'New Inventory Item'}</Title>
    <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Item name"><input className={inp} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Unit name"><input className={inp} placeholder="e.g. pcs, KAFI POWER" value={f.unitName} onChange={e => set({ unitName: e.target.value })} /></Field>
      </div>
      {/* Long description (specifications, warranty and so on) shown in the list */}
      <Field label="Description"><textarea className={inp} rows={4} value={f.description} onChange={e => set({ description: e.target.value })} /></Field>
      <Field label="Valuation method" className="max-w-xs">
        <select className={inp} value={f.valuationMethod} onChange={e => set({ valuationMethod: e.target.value })}>
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
      </Field>

      {/* Optional: override the default income and expense accounts */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAccounts} onChange={e => setShowAccounts(e.target.checked)} />Custom income / expense account
      </label>
      {showAccounts && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Custom income account">
            <select className={inp} value={f.customIncomeAccountId} onChange={e => set({ customIncomeAccountId: e.target.value })}>
              <option value="">Default</option>
              {accounts?.filter(a => a.type === 'income').map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
          <Field label="Custom expense account">
            <select className={inp} value={f.customExpenseAccountId} onChange={e => set({ customExpenseAccountId: e.target.value })}>
              <option value="">Default</option>
              {accounts?.filter(a => a.type === 'expense').map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {/* Optional: values filled in automatically on document lines */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAutofill} onChange={e => setShowAutofill(e.target.checked)} />Autofill options (line description, prices, sales division)
      </label>
      {showAutofill && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Line description"><input className={inp} value={f.lineDescription} onChange={e => set({ lineDescription: e.target.value })} /></Field>
          <Field label="Sales division"><input className={inp} value={f.salesDivision} onChange={e => set({ salesDivision: e.target.value })} /></Field>
          <Field label="Purchases unit price"><input className={inp} type="number" min="0" value={f.purchasePrice} onChange={e => set({ purchasePrice: e.target.value })} /></Field>
          <Field label="Sales unit price"><input className={inp} type="number" min="0" value={f.salesPrice} onChange={e => set({ salesPrice: e.target.value })} /></Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.hideName} onChange={e => set({ hideName: e.target.checked })} />Hide item name on printed documents
      </label>

      <Err e={err} />
      <div className="flex gap-2">
        <Btn onClick={() => save(false)}>{editing ? 'Save changes' : 'Create'}</Btn>
        {!editing && <BtnLight onClick={() => save(true)}>Create & add another</BtnLight>}
        <BtnLight onClick={() => setView('list')}>Cancel</BtnLight>
      </div>
    </section>
  </>)

  // ---------- Filtering (search box + Advanced Queries) ----------
  const q = search.toLowerCase()
  const shown = rows && rows.filter(r => {
    if (![r.name, r.description, unitOf(r)].join(' ').toLowerCase().includes(q)) return false
    if (adv.unit && !String(unitOf(r) || '').toLowerCase().includes(adv.unit.toLowerCase())) return false
    if (adv.desc && !String(r.description || '').toLowerCase().includes(adv.desc.toLowerCase())) return false
    const a = available(r)
    if (adv.stock === 'negative' && !(a < 0)) return false
    if (adv.stock === 'zero' && a !== 0) return false
    if (adv.stock === 'positive' && !(a > 0)) return false
    return true
  })

  // ---------- View page (one item) ----------
  if (view === 'view' && current) {
    const i = (shown || []).findIndex(x => x.id === current.id)
    const go = d => { const n = shown?.[i + d]; if (n) setCurrent(n) } // previous / next item
    // Label + value pairs shown in two columns
    const facts = [
      ['Unit name', unitOf(current)], ['Valuation method', current.valuationMethod || METHODS[0]],
      ['Sales price', money(current.salesPrice ?? current.price)], ['Purchase price', money(current.purchasePrice ?? current.cost)],
      ['Qty to deliver', Number(current.qtyToDeliver) || 0], ['Qty to receive', Number(current.qtyToReceive) || 0],
      ['Qty on hand', onHand(current)], ['Qty available', available(current)],
      ['Average cost', money(avgCost(current))], ['Total cost', money(onHand(current) * avgCost(current))],
    ]
    return (<>
      <Title hint={unitOf(current)}
        right={<>
          <BtnLight disabled={i <= 0} onClick={() => go(-1)} aria-label="Previous">&lsaquo;</BtnLight>
          <BtnLight disabled={i < 0 || i >= shown.length - 1} onClick={() => go(1)} aria-label="Next">&rsaquo;</BtnLight>
          <BtnLight onClick={() => openEdit(current)}>Edit</BtnLight>
          <BtnLight onClick={() => remove(current)}>Delete</BtnLight>
          <BtnLight onClick={() => setView('list')}>Back</BtnLight>
        </>}>
        {current.name}
      </Title>
      <section className="bg-white border border-navy/10 rounded p-4 space-y-4 max-w-3xl text-sm">
        {current.description && <p className="whitespace-pre-line">{current.description}</p>}
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-navy/10 py-1">
              <dt className="text-ink/60">{k}</dt>
              <dd className={'font-medium ' + (k === 'Qty available' && v < 0 ? 'text-red-700' : '')}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Err e={err} />
    </>)
  }

  // ---------- List view ----------
  return (<>
    <Title hint="Qty available = Qty on hand + Qty to receive - Qty to deliver."
      right={<>
        <BtnLight onClick={openImport}>Import from spreadsheet</BtnLight>
        <Btn onClick={openNew}>New Inventory Item</Btn>
      </>}>Inventory Items</Title>

    <div className="flex flex-wrap items-center gap-3 mb-3">
      <input className={inp + ' max-w-xs'} placeholder="Search" aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} />
      <button className="text-sm text-gold font-medium" onClick={() => setAdvOpen(!advOpen)}>{advOpen ? 'Hide' : 'Show'} Advanced Queries</button>
    </div>

    {advOpen && (
      <section className="bg-white border border-navy/10 rounded p-4 mb-4 grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Unit name contains"><input className={inp} value={adv.unit} onChange={e => setAdv({ ...adv, unit: e.target.value })} /></Field>
        <Field label="Description contains"><input className={inp} value={adv.desc} onChange={e => setAdv({ ...adv, desc: e.target.value })} /></Field>
        <Field label="Qty available">
          <select className={inp} value={adv.stock} onChange={e => setAdv({ ...adv, stock: e.target.value })}>
            {STOCK_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <BtnLight onClick={() => setAdv({ unit: '', stock: 'all', desc: '' })}>Clear filters</BtnLight>
      </section>
    )}

    <Err e={err} />
    <div className="mt-2" />
    <Table
      cols={[
        // Edit and View sit on the left, like Manager.io
        ['', r => (
          <span className="inline-flex gap-3">
            <button className="text-gold font-medium" onClick={() => openEdit(r)}>Edit</button>
            <button className="text-gold font-medium" onClick={() => { setCurrent(r); setView('view') }}>View</button>
          </span>
        )],
        ['Item name', r => r.name],
        // Long text wraps inside a fixed width so the table stays readable
        ['Description', r => <span className="block min-w-64 max-w-md whitespace-normal text-xs text-ink/80">{r.description}</span>],
        ['Sales price', r => r.salesPrice ?? r.price ? money(r.salesPrice ?? r.price) : '', 1],
        ['Purchase price', r => r.purchasePrice ?? r.cost ? money(r.purchasePrice ?? r.cost) : '', 1],
        ['Unit name', r => unitOf(r)],
        ['Qty to deliver', r => Number(r.qtyToDeliver) || 0, 1],
        ['Qty to receive', r => Number(r.qtyToReceive) || 0, 1],
        ['Qty on hand', r => onHand(r), 1],
        // Negative available stock is shown in red
        ['Qty available', r => <span className={available(r) < 0 ? 'text-red-700 font-semibold' : ''}>{available(r)}</span>, 1],
        ['Average cost', r => money(avgCost(r)), 1],
        ['Total cost', r => money(onHand(r) * avgCost(r)), 1],
      ]}
      rows={shown}
      empty="No items yet. Click New Inventory Item to add one."
    />
  </>)
}