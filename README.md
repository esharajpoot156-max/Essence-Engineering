# Essence Engineering ERP
Accounts + Inventory + Leads (Meta) — React + Tailwind, Node/Express, PostgreSQL (Prisma).

## Run
1. `docker compose up -d`   (or use any PostgreSQL and edit server/.env)
2. Server:  `cd server && cp .env.example .env && npm i && npx prisma migrate dev --name init && npm run seed && npm run dev`
3. Client:  `cd client && npm i && npm run dev`  -> http://localhost:5173
4. Login: admin@essence.com / admin123 (change it in seed.js before going live)

## How it works
Every Sales Invoice, Purchase Bill and Payment is saved in ONE database transaction that also posts balanced journal entries and updates stock. If anything fails, everything rolls back.

## Meta Lead Ads
Webhook: `GET/POST https://YOUR-DOMAIN/api/webhooks/meta`. Set META_VERIFY_TOKEN and META_PAGE_TOKEN in server/.env, subscribe your Page to `leadgen`.

## Added in v2
Tax % on invoices/bills (posts to Sales Tax Payable / Input Sales Tax), Print/PDF (browser Print > Save as PDF), WhatsApp share link, manual Journal screen, Bank reconciliation, Team + roles (admin, accountant, sales, store), Meta setup panel in Settings.
If you already ran the first version: `cd server && npx prisma migrate dev --name v2 && npm run seed`.
Not included: multi-company (single company only).
