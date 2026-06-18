-- AlterTable
ALTER TABLE "company_phone_numbers" ADD COLUMN "callFlowId" TEXT;

-- CreateIndex
CREATE INDEX "company_phone_numbers_callFlowId_idx" ON "company_phone_numbers"("callFlowId");

-- AddForeignKey
ALTER TABLE "company_phone_numbers" ADD CONSTRAINT "company_phone_numbers_callFlowId_fkey" FOREIGN KEY ("callFlowId") REFERENCES "call_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
