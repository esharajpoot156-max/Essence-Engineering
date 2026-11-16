-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "dueDays" INTEGER;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "customExpenseAccountId" INTEGER,
ADD COLUMN     "customIncomeAccountId" INTEGER,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hideName" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lineDescription" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "salesDivision" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "valuationMethod" TEXT NOT NULL DEFAULT 'First in, first out',
ALTER COLUMN "sku" DROP NOT NULL;
