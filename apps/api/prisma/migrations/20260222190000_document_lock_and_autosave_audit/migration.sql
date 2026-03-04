-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_AUTOSAVED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_LOCK_ACQUIRED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_LOCK_REFRESHED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_LOCK_RELEASED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_CRASH_RECOVERED';

-- CreateTable
CREATE TABLE "DocumentLock" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLock_documentId_key" ON "DocumentLock"("documentId");

-- CreateIndex
CREATE INDEX "DocumentLock_tenantId_expiresAt_idx" ON "DocumentLock"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "DocumentLock"
ADD CONSTRAINT "DocumentLock_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLock"
ADD CONSTRAINT "DocumentLock_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLock"
ADD CONSTRAINT "DocumentLock_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
