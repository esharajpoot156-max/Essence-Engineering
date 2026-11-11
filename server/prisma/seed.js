import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
const p = new PrismaClient()
const accounts = [
  ['1000','Bank & Cash','asset'],['1100','Accounts Receivable','asset'],['1200','Inventory','asset'],['1300','Input Sales Tax','asset'],['2100','Sales Tax Payable','liability'],
  ['2000','Accounts Payable','liability'],['3000','Owner Equity','equity'],
  ['4000','Sales','income'],['5000','Cost of Goods Sold','expense'],['6000','General Expenses','expense']]
await p.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: 'Essence Engineering Pvt Ltd', modules: ['sales','purchases','inventory','leads','reports'] } })
await p.user.upsert({ where: { email: 'admin@essence.com' }, update: {}, create: { name: 'Admin', email: 'admin@essence.com', password: await bcrypt.hash('admin123', 10) } })
for (const [code, name, type] of accounts) await p.account.upsert({ where: { code }, update: {}, create: { code, name, type } })
console.log('Seeded.'); await p.$disconnect()
