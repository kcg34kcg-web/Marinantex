-- AlterEnum
ALTER TYPE "AuditAction"
ADD VALUE IF NOT EXISTS 'SHARE_LINK_COMMENTED';

-- CreateTable
CREATE TABLE "ShareLinkComment" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "shareLinkId" UUID NOT NULL,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShareLinkComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareLinkComment_tenantId_shareLinkId_createdAt_idx"
ON "ShareLinkComment"("tenantId", "shareLinkId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShareLinkComment"
ADD CONSTRAINT "ShareLinkComment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkComment"
ADD CONSTRAINT "ShareLinkComment_shareLinkId_fkey"
FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
