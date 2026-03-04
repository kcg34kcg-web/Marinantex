-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'COMMENTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PETITION', 'CONTRACT', 'NOTICE', 'DEFENSE', 'INTERNAL_MEMO');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'REVIEW', 'FINAL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('VIEW', 'COMMENT');

-- CreateEnum
CREATE TYPE "ClauseCategory" AS ENUM ('GENERAL', 'LIABILITY', 'PAYMENT', 'TERMINATION', 'CONFIDENTIALITY', 'DISPUTE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'DOCUMENT_CREATED',
  'DOCUMENT_UPDATED',
  'DOCUMENT_STATUS_CHANGED',
  'DOCUMENT_VERSION_CREATED',
  'DOCUMENT_FINALIZED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'CLAUSE_CREATED',
  'CLAUSE_UPDATED',
  'SHARE_LINK_CREATED',
  'SHARE_LINK_REVOKED',
  'SHARE_LINK_VIEWED',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_TOKEN_REFRESHED'
);

-- CreateEnum
CREATE TYPE "AuditObjectType" AS ENUM (
  'DOCUMENT',
  'DOCUMENT_VERSION',
  'TEMPLATE',
  'CLAUSE',
  'SHARE_LINK',
  'AUTH',
  'SYSTEM'
);

-- CreateTable
CREATE TABLE "Tenant" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "role" "UserRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "canonicalJson" JSONB NOT NULL,
  "latestVersion" INTEGER NOT NULL DEFAULT 1,
  "finalVersionId" UUID,
  "finalContentHash" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "canonicalJson" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "isFinalSnapshot" BOOLEAN NOT NULL DEFAULT false,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "actorUserId" UUID,
  "action" "AuditAction" NOT NULL,
  "objectType" "AuditObjectType" NOT NULL,
  "objectId" TEXT,
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgentHash" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dataClassification" TEXT NOT NULL DEFAULT 'general',

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "permission" "SharePermission" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxViews" INTEGER,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "documentType" "DocumentType" NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "canonicalJson" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clause" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "category" "ClauseCategory" NOT NULL DEFAULT 'GENERAL',
  "bodyJson" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Clause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE INDEX "Document_tenantId_status_idx" ON "Document"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Document_tenantId_type_idx" ON "Document"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantId_documentId_idx" ON "DocumentVersion"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantId_isFinalSnapshot_idx" ON "DocumentVersion"("tenantId", "isFinalSnapshot");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_occurredAt_idx" ON "AuditLog"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_objectType_objectId_idx" ON "AuditLog"("tenantId", "objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_tenantId_documentId_idx" ON "ShareLink"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "ShareLink_tenantId_expiresAt_idx" ON "ShareLink"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Template_tenantId_name_key" ON "Template"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Template_tenantId_documentType_isActive_idx" ON "Template"("tenantId", "documentType", "isActive");

-- CreateIndex
CREATE INDEX "Clause_tenantId_category_isActive_idx" ON "Clause"("tenantId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Clause_tenantId_title_key" ON "Clause"("tenantId", "title");

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document"
ADD CONSTRAINT "Document_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document"
ADD CONSTRAINT "Document_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template"
ADD CONSTRAINT "Template_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template"
ADD CONSTRAINT "Template_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause"
ADD CONSTRAINT "Clause_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause"
ADD CONSTRAINT "Clause_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
