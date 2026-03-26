import { z } from "zod";

const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELED"]);
const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const listClientsSchema = z.object({
  tenantId: z.string().cuid(),
  query: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const listContactsSchema = z.object({
  tenantId: z.string().cuid(),
  query: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const createContactSchema = z.object({
  tenantId: z.string().cuid(),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email(),
  phone: z.string().min(3).max(40).optional(),
  title: z.string().min(1).max(120).optional(),
  company: z.string().min(1).max(160).optional(),
  notes: z.string().min(1).max(4_000).optional()
});

export const updateContactSchema = z.object({
  tenantId: z.string().cuid(),
  contactId: z.string().cuid(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  fullName: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  company: z.string().max(160).optional(),
  notes: z.string().max(4_000).optional()
});

export const deleteContactSchema = z.object({
  tenantId: z.string().cuid(),
  contactId: z.string().cuid()
});

const contactGroupNameSchema = z.string().min(2).max(120);
const contactGroupDescriptionSchema = z.string().max(1_000);
const contactGroupColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "Renk HEX formatında olmalı");

export const listContactGroupsSchema = z.object({
  tenantId: z.string().cuid(),
  query: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const createContactGroupSchema = z.object({
  tenantId: z.string().cuid(),
  name: contactGroupNameSchema,
  description: contactGroupDescriptionSchema.optional(),
  color: contactGroupColorSchema.optional(),
  contactIds: z.array(z.string().cuid()).max(500).default([])
});

export const updateContactGroupSchema = z.object({
  tenantId: z.string().cuid(),
  groupId: z.string().cuid(),
  name: contactGroupNameSchema.optional(),
  description: contactGroupDescriptionSchema.optional(),
  color: contactGroupColorSchema.optional(),
  contactIds: z.array(z.string().cuid()).max(500).optional()
});

export const deleteContactGroupSchema = z.object({
  tenantId: z.string().cuid(),
  groupId: z.string().cuid()
});

export const createClientSchema = z.object({
  tenantId: z.string().cuid(),
  name: z.string().min(2).max(160),
  code: z.string().min(1).max(50).optional(),
  taxNumber: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(3).max(40).optional(),
  address: z.string().min(3).max(400).optional(),
  status: z.enum(["active", "inactive", "prospect"]).default("active")
});

export const listMattersSchema = z.object({
  tenantId: z.string().cuid(),
  clientId: z.string().cuid().optional(),
  status: z.string().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const createMatterSchema = z.object({
  tenantId: z.string().cuid(),
  clientId: z.string().cuid(),
  title: z.string().min(2).max(180),
  referenceNo: z.string().min(1).max(80).optional(),
  practiceArea: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(4_000).optional(),
  status: z.string().min(1).max(50).default("open")
});

export const listTasksSchema = z.object({
  tenantId: z.string().cuid(),
  matterId: z.string().cuid().optional(),
  status: taskStatusEnum.optional(),
  assignedToId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const createTaskSchema = z.object({
  tenantId: z.string().cuid(),
  matterId: z.string().cuid().optional(),
  title: z.string().min(2).max(200),
  description: z.string().min(1).max(4_000).optional(),
  priority: taskPriorityEnum.default("MEDIUM"),
  dueAt: z.coerce.date().optional(),
  sourceMessageId: z.string().cuid().optional()
});

export const updateTaskStatusSchema = z.object({
  tenantId: z.string().cuid(),
  taskId: z.string().cuid(),
  status: taskStatusEnum
});

export type ListClientsInput = z.infer<typeof listClientsSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type ListContactGroupsInput = z.infer<typeof listContactGroupsSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type DeleteContactInput = z.infer<typeof deleteContactSchema>;
export type CreateContactGroupInput = z.infer<typeof createContactGroupSchema>;
export type UpdateContactGroupInput = z.infer<typeof updateContactGroupSchema>;
export type DeleteContactGroupInput = z.infer<typeof deleteContactGroupSchema>;
export type ListMattersInput = z.infer<typeof listMattersSchema>;
export type CreateMatterInput = z.infer<typeof createMatterSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
