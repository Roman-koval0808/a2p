-- CreateTable
CREATE TABLE "call_tracking_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_tracking_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable (add columns to existing tables)
ALTER TABLE "company_phone_numbers" ADD COLUMN "callTrackingCategoryId" TEXT;
ALTER TABLE "communication_logs" ADD COLUMN "callTrackingCategoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "call_tracking_categories_companyId_name_key" ON "call_tracking_categories"("companyId", "name");
CREATE INDEX "call_tracking_categories_companyId_idx" ON "call_tracking_categories"("companyId");
CREATE INDEX "company_phone_numbers_callTrackingCategoryId_idx" ON "company_phone_numbers"("callTrackingCategoryId");
CREATE INDEX "communication_logs_callTrackingCategoryId_idx" ON "communication_logs"("callTrackingCategoryId");
CREATE INDEX "communication_logs_companyId_type_created_idx" ON "communication_logs"("companyId", "type", "created");

-- AddForeignKey
ALTER TABLE "call_tracking_categories" ADD CONSTRAINT "call_tracking_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_phone_numbers" ADD CONSTRAINT "company_phone_numbers_callTrackingCategoryId_fkey" FOREIGN KEY ("callTrackingCategoryId") REFERENCES "call_tracking_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_callTrackingCategoryId_fkey" FOREIGN KEY ("callTrackingCategoryId") REFERENCES "call_tracking_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
