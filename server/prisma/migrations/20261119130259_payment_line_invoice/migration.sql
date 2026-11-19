/*
  Warnings:

  - You are about to drop the column `invoiceId` on the `Payment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "invoiceId";

-- AlterTable
ALTER TABLE "PaymentLine" ADD COLUMN     "invoiceId" INTEGER;
