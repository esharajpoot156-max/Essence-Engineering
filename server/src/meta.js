// Meta (Facebook / Instagram) Lead Ads -> Leads pipeline
// Endpoint: GET/POST  /api/webhooks/meta   (public, protected by Meta's signature instead of login)
import crypto from 'crypto'

export default function meta(app, { prisma }) {
  const GRAPH = process.env.META_GRAPH_VERSION || 'v21.0'

  // 1) Meta calls this once when you press "Verify and save"
  app.get('/api/webhooks/meta', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN
    return ok ? res.status(200).send(req.query['hub.challenge']) : res.sendStatus(403)
  })

  // Checks that the request really comes from Meta (needs req.rawBody, see index.js)
  const validSignature = req => {
    const secret = process.env.META_APP_SECRET, sig = req.get('x-hub-signature-256')
    if (!secret || !sig || !req.rawBody) return false
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')
    const a = Buffer.from(sig), b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  // Asks Meta for the form answers of one lead -> { full_name, email, phone_number, ... }
  async function fetchFields(leadgenId) {
    const token = process.env.META_PAGE_TOKEN
    if (!token) throw new Error('META_PAGE_TOKEN is not set')
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(token)}`)
    const data = await r.json()
    if (!r.ok) throw new Error(JSON.stringify(data.error || data))
    const f = {}
    for (const x of data.field_data || []) f[x.name] = x.values?.[0] ?? ''
    return f
  }

  async function saveLead(value) {
    const id = String(value.leadgen_id)
    let f = {}, note = ''
    try { f = await fetchFields(id) }
    catch (e) { console.error('Meta lead details failed:', e.message); note = 'Could not fetch the form answers from Meta (check META_PAGE_TOKEN). Lead id: ' + id }

    const name = f.full_name || [f.first_name, f.last_name].filter(Boolean).join(' ') || f.name || `Meta lead ${id.slice(-5)}`
    // every other form question (city, budget, message ...) is kept in the notes
    const known = ['full_name', 'first_name', 'last_name', 'name', 'email', 'phone_number', 'phone']
    const extra = Object.entries(f).filter(([k, v]) => !known.includes(k) && v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    const notes = [...extra, note].filter(Boolean).join('\n') || null

    await prisma.lead.upsert({
      where: { metaId: id }, update: {}, // Meta may send the same lead twice, so no duplicate
      create: { metaId: id, name, phone: f.phone_number || f.phone || null, email: f.email || null,
        source: 'Meta Ads', campaign: String(value.ad_id || value.form_id || '') || null, notes },
    })
  }

  // 2) Meta calls this every time somebody fills your lead form
  app.post('/api/webhooks/meta', (req, res) => {
    if (!validSignature(req)) return res.sendStatus(401)
    res.sendStatus(200) // answer Meta fast, work afterwards
    ;(async () => {
      for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) {
        if (ch.field !== 'leadgen' || !ch.value?.leadgen_id) continue
        try { await saveLead(ch.value) } catch (e) { console.error('Meta lead save failed:', e.message) }
      }
    })()
  })
}