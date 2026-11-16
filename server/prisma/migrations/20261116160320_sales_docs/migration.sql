-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "address" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "fixedTotal" DECIMAL(14,2),
ADD COLUMN     "netDays" INTEGER,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "rounding" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sourceId" INTEGER,
ADD COLUMN     "sourceKind" TEXT,
ADD COLUMN     "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withholdingRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "accountId" INTEGER,
ADD COLUMN     "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "projectId" INTEGER;

-- CreateTable
CREATE TABLE "SalesDoc" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "contactId" INTEGER NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rounding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fixedTotal" DECIMAL(14,2),
    "withholdingRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "validDays" INTEGER,
    "expiryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "sourceKind" TEXT,
    "sourceId" INTEGER,

    CONSTRAINT "SalesDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocLine" (
    "id" SERIAL NOT NULL,
    "docId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "SalesDocLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesDoc_number_key" ON "SalesDoc"("number");

-- CreateIndex
CREATE INDEX "SalesDoc_kind_idx" ON "SalesDoc"("kind");

-- AddForeignKey
ALTER TABLE "SalesDoc" ADD CONSTRAINT "SalesDoc_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocLine" ADD CONSTRAINT "SalesDocLine_docId_fkey" FOREIGN KEY ("docId") REFERENCES "SalesDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
