export type UserRole = 'lawyer' | 'assistant' | 'client';

export type CaseStatus = 'open' | 'in_progress' | 'closed' | 'archived';

export interface Profile {
  id: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Case {
  id: string;
  title: string;
  status: CaseStatus;
  lawyerId: string;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  caseId: string;
  content: string;
  embedding: number[] | null;
  filePath: string;
  createdAt: string;
}

export interface CaseUpdate {
  id: string;
  caseId: string;
  message: string;
  date: string;
  isPublicToClient: boolean;
  createdBy: string;
  createdAt: string;
}

export interface AiChat {
  id: string;
  userId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export * from './finance';
