// src/PurchaseDocs.jsx
// Purchase Quotes, Purchase Orders, Goods Receipts and Purchase Invoices.
// These reuse DocPage from SalesDocs.jsx; only the config differs.
// Expected API (to be built later): /purchase-quotes, /purchase-orders, /goods-receipts, /purchase-invoices
// (same record shape as the sales documents, with a supplier instead of a customer)
import { DocPage } from './SalesDocs'

const PURCHASE = {
  quote: {
    form: 'purchaseQuote', path: '/purchase-quotes', title: 'Purchase Quotes', one: 'Purchase Quote', party: 'supplier', who: 'Supplier',
    hint: 'Prices quoted by a supplier. Tick "Request for quotation" in Settings to ask suppliers for a price.',
    dateLabel: 'Date', priced: true, tax: true, description: true, status: true,
    next: { via: 'quote', path: '/purchase-orders', label: 'Purchase Order' },
  },
  order: {
    form: 'purchaseOrder', path: '/purchase-orders', title: 'Purchase Orders', one: 'Purchase Order', party: 'supplier', who: 'Supplier',
    hint: 'Confirms what you have ordered from a supplier.',
    dateLabel: 'Date', priced: true, tax: true, description: true,
    next: { via: 'order', path: '/goods-receipts', label: 'Goods Receipt' },
  },
  receipt: {
    form: 'goodsReceipt', path: '/goods-receipts', title: 'Goods Receipts', one: 'Goods Receipt', party: 'supplier', who: 'Supplier (From)',
    hint: 'Records goods received from a supplier. Prices are not shown.',
    dateLabel: 'Date', priced: false, tax: false, description: true,
    next: { via: 'receipt', path: '/purchase-invoices', label: 'Purchase Invoice' },
  },
  invoice: {
    form: 'purchaseInvoice', path: '/purchase-invoices', title: 'Purchase Invoices', one: 'Purchase Invoice', party: 'supplier', who: 'Supplier',
    hint: 'Saving an invoice records what you owe the supplier.',
    dateLabel: 'Issue date', priced: true, tax: true, description: true, due: true, account: true, project: true, status: true,
  },
}

// The four pages used by the router
export const PurchaseQuotes = () => <DocPage cfg={PURCHASE.quote} />
export const PurchaseOrders = () => <DocPage cfg={PURCHASE.order} />
export const GoodsReceipts = () => <DocPage cfg={PURCHASE.receipt} />
export const PurchaseInvoices = () => <DocPage cfg={PURCHASE.invoice} />