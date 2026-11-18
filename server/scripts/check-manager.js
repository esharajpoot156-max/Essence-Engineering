// server/scripts/check-manager.js
// Reads a .manager file and prints what is inside (nothing is saved anywhere).
// Run from the server folder:   node scripts/check-manager.js "C:\path\to\file.manager"
import fs from 'fs'
import { readManager } from '../src/manager/reader.js'

const file = process.argv[2]
if (!file) { console.log('Usage: node scripts/check-manager.js "path\\to\\file.manager"'); process.exit(1) }

const d = await readManager(fs.readFileSync(file))
console.log('Customers:', d.customers.length)
console.log('Suppliers:', d.suppliers.length)
console.log('Items:    ', d.items.length)
console.log('Quotes:   ', d.quotes.length, '(accepted:', d.quotes.filter(q => q.accepted).length + ')')
console.log('Invoices: ', d.invoices.length)
console.log('Warnings: ', d.warnings.length ? d.warnings : 'none')

// Show the 3 newest quotes so they can be compared with Manager
for (const q of [...d.quotes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3))
  console.log(`Quote ${q.reference} | ${q.date} | ${q.description} | total ${q.total}`)