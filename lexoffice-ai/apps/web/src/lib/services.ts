import { prisma } from "@lexoffice/db";
import {
  AIService,
  AttachmentSecurityService,
  AuditService,
  AuthService,
  ClientService,
  ContactService,
  ContactGroupService,
  DomainService,
  MailIntegrationService,
  MailboxProvisioningService,
  MailboxService,
  MatterService,
  MailSyncService,
  MailThreadService,
  RBACService,
  SecurityEventService,
  TaskService,
  TenantService
} from "@lexoffice/core";

const auditService = new AuditService(prisma);
const securityEventService = new SecurityEventService(prisma);
const authService = new AuthService(prisma, auditService, securityEventService);
const rbacService = new RBACService(prisma);
const tenantService = new TenantService(prisma, auditService);
const domainService = new DomainService(prisma, auditService);
const mailboxService = new MailboxService(prisma, auditService);
const mailboxProvisioningService = new MailboxProvisioningService(prisma, auditService);
const mailIntegrationService = new MailIntegrationService(prisma, auditService);
const mailThreadService = new MailThreadService(prisma, auditService);
const attachmentSecurityService = new AttachmentSecurityService(prisma, auditService);
const mailSyncService = new MailSyncService(prisma, auditService);
const aiService = new AIService(prisma, auditService);
const clientService = new ClientService(prisma, auditService);
const contactService = new ContactService(prisma, auditService);
const contactGroupService = new ContactGroupService(prisma, auditService);
const matterService = new MatterService(prisma, auditService);
const taskService = new TaskService(prisma, auditService);

export const services = {
  auditService,
  securityEventService,
  authService,
  rbacService,
  tenantService,
  domainService,
  mailboxService,
  mailboxProvisioningService,
  mailIntegrationService,
  mailThreadService,
  attachmentSecurityService,
  mailSyncService,
  aiService,
  clientService,
  contactService,
  contactGroupService,
  matterService,
  taskService
};
