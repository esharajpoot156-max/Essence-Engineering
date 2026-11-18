import crypto from 'crypto'

const secret = process.env.META_APP_SECRET
if (!secret) { console.log('META_APP_SECRET .env me nahi hai'); process.exit(1) }

// har dafa naya leadgen_id, taake duplicate na bane
const body = JSON.stringify({
  object: 'page',
  entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: String(Date.now()), form_id: '1', ad_id: '2' } }] }],
})

const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

const r = await fetch('http://localhost:4000/api/webhooks/meta', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
  body,
})
console.log('Status:', r.status)