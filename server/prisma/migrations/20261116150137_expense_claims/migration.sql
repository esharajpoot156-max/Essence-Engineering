-- CreateTable
CREATE TABLE "ExpenseClaim" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "paidById" INTEGER NOT NULL,
    "payeeId" INTEGER,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseClaimLine" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,2) NOT NULL DEFAULT 1,
    "price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ExpenseClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseClaim_number_key" ON "ExpenseClaim"("number");

-- AddForeignKey
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseClaimLine" ADD CONSTRAINT "ExpenseClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseClaimLine" ADD CONSTRAINT "ExpenseClaimLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
