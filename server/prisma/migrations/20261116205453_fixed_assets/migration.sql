-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "residualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usefulLifeYears" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'straight',
    "notes" TEXT,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Depreciation" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "assetId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Depreciation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Depreciation_number_key" ON "Depreciation"("number");

-- AddForeignKey
ALTER TABLE "Depreciation" ADD CONSTRAINT "Depreciation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
