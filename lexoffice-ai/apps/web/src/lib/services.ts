import { prisma } from "@lexoffice/db";
import {
  AIService,
  AuditService,
  AuthService,
  DomainService,
  MailIntegrationService,
  MailboxService,
  MailSyncService,
  MailThreadService,
  RBACService,
  SecurityEventService,
  TenantService
} from "@lexoffice/core";

const auditService = new AuditService(prisma);
const securityEventService = new SecurityEventService(prisma);
const authService = new AuthService(prisma, auditService, securityEventService);
const rbacService = new RBACService(prisma);
const tenantService = new TenantService(prisma, auditService);
const domainService = new DomainService(prisma, auditService);
const mailboxService = new MailboxService(prisma, auditService);
const mailIntegrationService = new MailIntegrationService(prisma, auditService);
const mailThreadService = new MailThreadService(prisma, auditService);
const mailSyncService = new MailSyncService(prisma, auditService);
const aiService = new AIService(prisma, auditService);

export const services = {
  auditService,
  securityEventService,
  authService,
  rbacService,
  tenantService,
  domainService,
  mailboxService,
  mailIntegrationService,
  mailThreadService,
  mailSyncService,
  aiService
};
