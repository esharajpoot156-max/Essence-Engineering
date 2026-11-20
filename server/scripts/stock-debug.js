import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const N = v => Number(v || 0)
const qtyOf = l => N(l.stockQty ?? l.qty)
for (const q of process.argv.slice(2)) {
  const items = await prisma.item.findMany({ where: { name: { contains: q, mode: 'insensitive' } } })
  for (const i of items) {
    const inv = await prisma.invoiceLine.findMany({ where: { itemId: i.id, invoice: { status: 'active' } }, include: { invoice: true } })
    const docs = await prisma.salesDocLine.findMany({ where: { itemId: i.id }, include: { doc: true } })
    const sum = rows => rows.reduce((s, l) => s + qtyOf(l), 0)
    console.log('\n===', i.name, '| item.qty =', i.qty)
    console.log('sales invoices  :', sum(inv.filter(l => l.invoice.kind === 'sale')))
    console.log('purchase invoices:', sum(inv.filter(l => l.invoice.kind === 'purchase')))
    for (const k of ['delivery', 'order', 'greceipt', 'porder', 'pquote'])
      console.log(k.padEnd(16), ':', sum(docs.filter(l => l.doc.kind === k)))
    console.log('lines with empty stockQty:', inv.filter(l => l.stockQty == null).length + docs.filter(l => l.stockQty == null).length)
    for (const l of inv.filter(l => l.invoice.kind === 'purchase'))
      console.log('  buy', l.invoice.number, l.invoice.date.toISOString().slice(0, 10), 'stockQty', l.stockQty, 'qty', l.qty, 'price', +l.price)
  }
}
await prisma.$disconnect()