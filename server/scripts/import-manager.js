// server/scripts/import-manager.js
// Imports customers, suppliers, items and quotes from a .manager file.
//   node --env-file=.env scripts/import-manager.js "C:\path\file.manager"            (dry run: saves nothing)
//   node --env-file=.env scripts/import-manager.js "C:\path\file.manager" --save      (really saves)
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { readManager } from '../src/manager/reader.js'
import { importBasics } from '../src/manager/import.js'

const file = process.argv[2], save = process.argv.includes('--save')
if (!file) { console.log('Usage: node --env-file=.env scripts/import-manager.js "file.manager" [--save]'); process.exit(1) }
const prisma = new PrismaClient()
const data = await readManager(fs.readFileSync(file))
const rep = await importBasics(prisma, data, { dryRun: !save })
console.log(save ? 'SAVED' : 'DRY RUN (nothing saved). Add --save to really import.')
console.dir(rep, { depth: 4 })
await prisma.$disconnect()