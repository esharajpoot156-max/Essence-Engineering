// src/SettingsCustomize.jsx
// Settings page, like Manager.io: tiles ka grid, har tile ek alag page kholta hai.
// Pages: Business Details, Modules, Forms, Printing, Integrations.
// Props: settings = the object from GET /api/settings, onSaved = reloads it after saving modules.
import { useState } from 'react'
import { api } from './api'
import { Btn, BtnLight, Title, Err, Field, inp } from './ui'
import { useCustomize, FORMS, OPTIONS, DEFAULT_LABELS } from './customize'

// Modules that can be switched on or off (same list as the old settings page)
const MODS = [
  ['sales', 'Sales & customers'],
  ['purchases', 'Purchases & suppliers'],
  ['inventory', 'Inventory'],
  ['leads', 'Leads'],
  ['reports', 'Reports'],
]

// Tiles in working [page, label, icon]
const READY = [
  ['business', 'Business Details', 'ℹ️'],
  ['modules', 'Modules', '🧩'],
  ['forms', 'Form Options', '📝'],
  ['printing', 'Printing', '🖨️'],
  ['integrations', 'Integrations', '🔌'],
]

// Tiles that will be built later (no icon, lighter)
const LATER = [
  'Chart of Accounts', 'Date & Number Format', 'Access Tokens', 'Control Accounts', 'Currencies',
  'Custom Buttons', 'Custom Fields', 'Custom Themes', 'Divisions', 'Email Settings',
  'Footers', 'Forecasts', 'Inventory Locations', 'Investment Market Prices', 'Lock Date',
  'Non-inventory Items', 'Obsolete Features',
]

// A white card used by every page
const Card = ({ children, className = '' }) => (
  <section className={'bg-white border border-navy/10 rounded p-4 space-y-3 ' + className}>{children}</section>
)

// Breadcrumb: Settings > Page
const Crumb = ({ page, onBack }) => (
  <p className="mb-4 text-sm text-ink/60">
    <button className="text-gold font-medium" onClick={onBack}>Settings</button>
    <span className="mx-1">›</span>{page}
  </p>
)

// ---------- Page: Business Details ----------
function BusinessPage() {
  const { settings, setBusiness } = useCustomize()
  const saved = settings.business
  // Draft
  const [f, setF] = useState({ ...saved })
  const [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const set = patch => { setF({ ...f, ...patch }); setMsg('') }

  // Image file -> data URL (max 1 MB)
  const pickImage = file => {
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Please select an image file only.')
    if (file.size > 1024 * 1024) return setErr('Image size must be less than 1 MB')
    const rd = new FileReader()
    rd.onload = () => { setErr(''); set({ image: rd.result }) }
    rd.readAsDataURL(file)
  }

  // Update: draft save 
  const update = () => {
    try {
      setBusiness({ ...f, name: (f.name || '').trim() })
      setErr(''); setMsg('Business details updated')
    } catch { setErr('Could not save. The image file too large.') }
  }
  // Reset: discard draft and go back to saved
  const reset = () => { setF({ ...saved }); setErr(''); setMsg('') }

  return (
    <section className="bg-white border border-navy/10 rounded max-w-4xl">
      <h2 className="px-4 py-3 border-b border-navy/10 text-lg font-semibold text-navy bg-mist/40">Business Details</h2>
      <div className="p-4 space-y-5">
        <Field label="Name" className="max-w-md">
          <input className={inp} value={f.name || ''} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="Address" className="max-w-md">
          <textarea rows={5} className={inp} placeholder={'Address 1\nAddress 2\nAddress 3\nAddress 4'}
            value={f.address || ''} onChange={e => set({ address: e.target.value })} />
        </Field>
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl">
          <Field label="Phone"><input className={inp} value={f.phone || ''} onChange={e => set({ phone: e.target.value })} /></Field>
          <Field label="Email"><input className={inp} value={f.email || ''} onChange={e => set({ email: e.target.value })} /></Field>
          <Field label="NTN / tax number"><input className={inp} value={f.ntn || ''} onChange={e => set({ ntn: e.target.value })} /></Field>
        </div>
        <fieldset className="border border-navy/15 rounded p-3">
          <legend className="px-2 text-sm text-ink/70">Image</legend>
          <input type="file" accept="image/*" onChange={e => pickImage(e.target.files?.[0])} />
          {f.image && (
            <div className="mt-3 flex items-center gap-3">
              <img src={f.image} alt="Business logo" className="max-h-20" />
              <button type="button" className="text-red-700 text-sm" onClick={() => set({ image: '' })}>Remove image</button>
            </div>
          )}
        </fieldset>
        <Err e={err} />
        {msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
      </div>
      <div className="px-4 py-3 border-t border-navy/10 bg-mist/40 flex gap-2">
        <button className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-green-700" onClick={update}>Update</button>
        <button className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-red-700" onClick={reset}>Reset</button>
      </div>
    </section>
  )
}

// ---------- Page: Modules on/off ----------
function ModulesPage({ settings, onSaved }) {
  const [mods, setMods] = useState(settings.modules)
  const [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const toggle = m => setMods(mods.includes(m) ? mods.filter(x => x !== m) : [...mods, m])
  // Saves to the backend (same call the old settings page used)
  const save = async () => {
    try { await api('/settings', { method: 'PUT', body: { modules: mods } }); setMsg('Saved'); setErr(''); onSaved() }
    catch (e) { setErr(e.message); setMsg('') }
  }
  return (
    <Card className="max-w-md">
      <p className="text-sm text-ink/60">Turn on only the modules your team uses. Hidden modules keep their data.</p>
      {MODS.map(([k, l]) => (
        <label key={k} className="flex items-center gap-2">
          <input type="checkbox" checked={mods.includes(k)} onChange={() => toggle(k)} />{l}
        </label>
      ))}
      <div className="flex items-center gap-3"><Btn onClick={save}>Save modules</Btn><span className="text-sm text-ink/60">{msg}</span></div>
      <Err e={err} />
    </Card>
  )
}

// ---------- Page: Forms (optional checkboxes + defaults) ----------
function FormsPage() {
  const { settings, setOption, setDefault, setForm } = useCustomize()
  const [key, setKey] = useState(FORMS[0].key)
  const form = FORMS.find(f => f.key === key)
  const s = settings.forms[key]
  return (
    <div className="grid md:grid-cols-[14rem_1fr] gap-4">
      {/* Left: list of forms */}
      <nav className="bg-white border border-navy/10 rounded p-2 self-start">
        {FORMS.map(f => (
          <button key={f.key} onClick={() => setKey(f.key)}
            className={'block w-full text-left px-3 py-2 rounded text-sm ' + (f.key === key ? 'bg-navy text-white' : 'hover:bg-mist/60')}>
            {f.label}
          </button>
        ))}
      </nav>

      {/* Right: settings for the chosen form */}
      <div className="space-y-4 max-w-xl">
        <Card>
          <h2 className="font-semibold">{form.label} - optional fields</h2>
          <p className="text-sm text-ink/60">Tick one only when that column or field is actually needed on the document.</p>
          {form.options.map(o => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!s.options[o]} onChange={e => setOption(key, o, e.target.checked)} />{OPTIONS[o]}
            </label>
          ))}
          {/* Text boxes appear only when the matching option is on */}
          {s.options.customTitle && (
            <Field label="Custom title (printed instead of the default)">
              <input className={inp} value={s.title} onChange={e => setForm(key, { title: e.target.value })} />
            </Field>
          )}
          {s.options.footers && (
            <Field label="Footer text">
              <textarea className={inp} rows={3} value={s.footer} onChange={e => setForm(key, { footer: e.target.value })} />
            </Field>
          )}
        </Card>

        {form.extras.length > 0 && (
          <Card>
            <h2 className="font-semibold">{form.label} - form defaults</h2>
            <p className="text-sm text-ink/60">These values are filled in automatically on every new {form.label.toLowerCase()}.</p>
            {form.extras.map(x => (
              <Field key={x} label={DEFAULT_LABELS[x].label}>
                <input className={inp} type={DEFAULT_LABELS[x].type} min="0" value={s.defaults[x] ?? ''} onChange={e => setDefault(key, x, e.target.value)} />
              </Field>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------- Page: Printing ----------
function PrintingPage() {
  const { settings, setPrint } = useCustomize()
  const p = settings.print
  return (
    <Card className="max-w-md">
      <p className="text-sm text-ink/60">Applies to Print / PDF on every document.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.showLogo} onChange={e => setPrint({ showLogo: e.target.checked })} />Show logo</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.showTax} onChange={e => setPrint({ showTax: e.target.checked })} />Show tax row</label>
    </Card>
  )
}

// ---------- Page: Integrations ----------
function IntegrationsPage() {
  return (
    <Card className="max-w-2xl text-sm">
      <h2 className="font-semibold">Connect Meta Lead Ads</h2>
      <p>Webhook URL (use your public https domain when live):</p>
      <code className="block bg-mist/60 rounded px-3 py-2 break-all">{location.origin}/api/webhooks/meta</code>
      <p>In Meta for Developers, add the Webhooks product, subscribe your Page to <b>leadgen</b>, and paste this URL with the verify token from <b>server/.env</b> (META_VERIFY_TOKEN). Put your Page access token in META_PAGE_TOKEN. New leads then appear in Leads with source "Meta Ads".</p>
    </Card>
  )
}

// ---------- The page ----------
export default function SettingsCustomize({ settings, onSaved }) {
  const [page, setPage] = useState('home') // 'home' | 'business' | 'modules' | 'forms' | 'printing' | 'integrations'
  const { reset } = useCustomize()
  const back = () => setPage('home')

  // ----- Sub pages -----
  if (page !== 'home') {
    const label = READY.find(r => r[0] === page)[1]
    return (<>
      <Crumb page={label} onBack={back} />
      {page === 'business' && <BusinessPage />}
      {page === 'modules' && <ModulesPage settings={settings} onSaved={onSaved} />}
      {page === 'forms' && <FormsPage />}
      {page === 'printing' && <PrintingPage />}
      {page === 'integrations' && <IntegrationsPage />}
    </>)
  }

  // ----- Home: tiles -----
  return (<>
    <Title hint="Choose what your team sees and how your documents look."
      right={<BtnLight onClick={() => confirm('Reset all form options, defaults and business details to the starting values?') && reset()}>Reset customization</BtnLight>}>
      Settings
    </Title>

    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 border-b border-navy/10">
      {READY.map(([k, label, icon]) => (
        <button key={k} onClick={() => setPage(k)}
          className="flex items-center gap-4 bg-white border border-navy/10 rounded p-4 text-left hover:bg-mist/40">
          <span className="text-2xl" aria-hidden="true">{icon}</span>
          <span className="text-gold font-medium">{label}</span>
        </button>
      ))}
    </div>

    
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-6">
      {LATER.map(label => (
        <div key={label} title="This will be available after the backend is implemented" aria-disabled="true"
          className="flex items-center gap-4 p-4 opacity-40 select-none">
          <span className="h-8 w-8 rounded bg-navy/20" aria-hidden="true" />
          <span className="text-navy">{label}</span>
        </div>
      ))}
    </div>
  </>)
}