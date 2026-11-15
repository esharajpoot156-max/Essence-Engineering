// src/customize.jsx
// Settings and customization store (like Manager.io's "Form Defaults" and optional form checkboxes).
// Every form page reads its options from here with useCustomize().
// Data is saved in the browser (localStorage) for now; it can move to the backend later.
import { createContext, useContext } from 'react'
import { useStored } from './ui'

// ---------- Optional checkboxes a form can have ----------
// key = name stored in settings, label = text shown on the Settings page
export const OPTIONS = {
  lineNumber: 'Column - Line number',
  description: 'Column - Description',
  qty: 'Column - Qty',
  discount: 'Column - Discount',
  fixedTotal: 'Fixed total',
  customTitle: 'Custom title',
  footers: 'Footers',
  rounding: 'Rounding',
  withholdingTax: 'Withholding tax',
  requestForQuotation: 'Request for quotation',
}

// ---------- Every form in the system ----------
// key     = unique id used by the pages
// label   = name shown on the Settings page
// options = which optional checkboxes this form supports
// extras  = extra default values this form supports (see DEFAULT_LABELS below)
export const FORMS = [
  { key: 'salesQuote',      label: 'Sales Quote',      options: ['lineNumber', 'description', 'qty', 'discount', 'rounding', 'customTitle', 'footers'], extras: ['validDays', 'taxRate'] },
  { key: 'salesOrder',      label: 'Sales Order',      options: ['lineNumber', 'description', 'qty', 'discount', 'customTitle', 'footers'],             extras: ['taxRate'] },
  { key: 'salesInvoice',    label: 'Sales Invoice',    options: ['lineNumber', 'description', 'qty', 'discount', 'fixedTotal', 'customTitle', 'footers'], extras: ['dueDays', 'taxRate'] },
  { key: 'deliveryNote',    label: 'Delivery Note',    options: ['lineNumber', 'description', 'customTitle', 'footers'],                                 extras: [] },
  { key: 'receipt',         label: 'Receipt',          options: ['description', 'customTitle', 'footers'],                                               extras: ['account'] },
  { key: 'payment',         label: 'Payment',          options: ['description', 'customTitle', 'footers'],                                               extras: ['account'] },
  { key: 'purchaseQuote',   label: 'Purchase Quote',   options: ['lineNumber', 'description', 'qty', 'requestForQuotation', 'customTitle', 'footers'],   extras: ['taxRate'] },
  { key: 'purchaseOrder',   label: 'Purchase Order',   options: ['lineNumber', 'description', 'qty', 'discount', 'withholdingTax', 'customTitle', 'footers'], extras: ['taxRate'] },
  { key: 'purchaseInvoice', label: 'Purchase Invoice', options: ['lineNumber', 'description', 'qty', 'discount', 'customTitle', 'footers'],               extras: ['dueDays', 'taxRate'] },
  { key: 'goodsReceipt',    label: 'Goods Receipt',    options: ['lineNumber', 'description', 'customTitle', 'footers'],                                 extras: [] },
  { key: 'payslip',         label: 'Payslip',          options: ['customTitle', 'footers'],                                                              extras: [] },
  { key: 'expenseClaim',    label: 'Expense Claim',    options: ['description', 'customTitle', 'footers'],                                               extras: [] },
]

// Labels and input types for the extra default values
export const DEFAULT_LABELS = {
  validDays: { label: 'Quote valid for (days)', type: 'number' },
  dueDays: { label: 'Payment terms: due in (days)', type: 'number' },
  taxRate: { label: 'Default tax %', type: 'number' },
  account: { label: 'Default account', type: 'text' },
}

// ---------- Starting values ----------
const BUSINESS = { name: 'Essence Engineering Pvt Ltd', address: '', phone: '', email: '', ntn: '',image: ''}

// Builds the starting settings for one form: every option off, no defaults, empty text
const blankForm = f => ({
  options: Object.fromEntries(f.options.map(o => [o, false])),
  defaults: Object.fromEntries(f.extras.map(x => [x, ''])),
  title: '',   // used when the "Custom title" option is on
  footer: '',  // used when the "Footers" option is on
})

const START = {
  business: BUSINESS,
  forms: Object.fromEntries(FORMS.map(f => [f.key, blankForm(f)])),
  // Printed on documents: show the logo and the "Tax" row
  print: { showLogo: true, showTax: true },
}

// ---------- Context ----------
const Ctx = createContext(null)

// Wrap the app with <CustomizeProvider> once (done later in App.jsx / main.jsx)
export function CustomizeProvider({ children }) {
  const [s, setS] = useStored('customize.v1', START)

  // Merge with START so forms added later still get their starting values
  const settings = {
    ...START, ...s,
    business: { ...START.business, ...s.business },
    print: { ...START.print, ...s.print },
    forms: Object.fromEntries(FORMS.map(f => {
      const base = blankForm(f), saved = s.forms?.[f.key] || {}
      return [f.key, { ...base, ...saved, options: { ...base.options, ...saved.options }, defaults: { ...base.defaults, ...saved.defaults } }]
    })),
  }

  // Change the business details, e.g. setBusiness({ phone: '0300...' })
  const setBusiness = patch => setS({ ...settings, business: { ...settings.business, ...patch } })

  // Change print options, e.g. setPrint({ showLogo: false })
  const setPrint = patch => setS({ ...settings, print: { ...settings.print, ...patch } })

  // Change one form, e.g. setForm('salesInvoice', { title: 'Tax Invoice' })
  const setForm = (key, patch) => setS({ ...settings, forms: { ...settings.forms, [key]: { ...settings.forms[key], ...patch } } })

  // Turn one optional checkbox on or off for a form
  const setOption = (key, option, value) =>
    setForm(key, { options: { ...settings.forms[key].options, [option]: value } })

  // Change one default value for a form
  const setDefault = (key, name, value) =>
    setForm(key, { defaults: { ...settings.forms[key].defaults, [name]: value } })

  // Back to the starting values
  const reset = () => setS(START)

  return (
    <Ctx.Provider value={{ settings, setBusiness, setPrint, setForm, setOption, setDefault, reset }}>
      {children}
    </Ctx.Provider>
  )
}

// Use inside any page: const { settings, setOption } = useCustomize()
export const useCustomize = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCustomize must be used inside <CustomizeProvider>')
  return c
}

// Shortcut for form pages: const { options, defaults, title, footer } = useFormSettings('salesInvoice')
export const useFormSettings = key => useCustomize().settings.forms[key]