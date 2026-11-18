// server/scripts/import-ledger.js   (run AFTER scripts/import-manager.js --save)
//   node --env-file=.env scripts/import-ledger.js "C:\path\file.manager"           (dry run: saves nothing)
//   node --env-file=.env scripts/import-ledger.js "C:\path\file.manager" --save
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { readManager } from '../src/manager/reader.js'
import { importLedger } from '../src/manager/ledger.js'

const file = process.argv[2], save = process.argv.includes('--save')
if (!file) { console.log('Usage: node --env-file=.env scripts/import-ledger.js "file.manager" [--save]'); process.exit(1) }
const prisma = new PrismaClient()
const data = await readManager(fs.readFileSync(file))
const rep = await importLedger(prisma, data, { dryRun: !save })
console.log(save ? 'SAVED' : 'DRY RUN (nothing saved). Add --save to really import.')
console.dir(rep, { depth: 4, maxArrayLength: 100 })
await prisma.$disconnect()