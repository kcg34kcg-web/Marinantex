-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'DOCX');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_REQUESTED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_STARTED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_COMPLETED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_FAILED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_DOWNLOAD_URL_ISSUED';

-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT_DOWNLOADED';

-- AlterEnum
ALTER TYPE "AuditObjectType"
ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORT';

-- CreateTable
CREATE TABLE "DocumentExport" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "format" "ExportFormat" NOT NULL,
  "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
  "queueJobId" TEXT,
  "storageKey" TEXT,
  "checksum" TEXT,
  "fileSizeBytes" INTEGER,
  "failureReason" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentExport_tenantId_documentId_createdAt_idx"
ON "DocumentExport"("tenantId", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentExport_tenantId_status_createdAt_idx"
ON "DocumentExport"("tenantId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentExport"
ADD CONSTRAINT "DocumentExport_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExport"
ADD CONSTRAINT "DocumentExport_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExport"
ADD CONSTRAINT "DocumentExport_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
