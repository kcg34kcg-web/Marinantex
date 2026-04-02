export type AssistantBubbleState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'needs_confirmation'
  | 'success'
  | 'error';

export type AssistantToneUi = 'professional' | 'warm' | 'short' | 'detailed';
export type AssistantLanguageUi = 'tr' | 'en';

export interface AssistantPreferencePayload {
  assistantName: string;
  tone: AssistantToneUi;
  language: AssistantLanguageUi;
  responseLength: 'short' | 'detailed';
  proactiveLevel: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  keyboardShortcut: string;
  bubblePositionX: number;
  bubblePositionY: number;
  bubbleSize: number;
  animationLevel: number;
  memoryEnabled: boolean;
  requireConfirmationCritical: boolean;
  temporaryMode: boolean;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  isTemporary: boolean;
  updatedAt: string;
}

export interface AssistantMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface AssistantMemoryItem {
  id: string;
  kind: 'NOTE' | 'PREFERENCE' | 'FACT';
  content: string;
  tags: string[];
  updatedAt: string;
}

export interface AssistantActionPlan {
  intent: string;
  reply: string;
  actions: Array<{
    toolName: string;
    params: Record<string, unknown>;
    reason?: string;
  }>;
  needsConfirmation: boolean;
  suggestions: string[];
  memoryWrites: Array<{
    kind: 'NOTE' | 'PREFERENCE' | 'FACT';
    content: string;
    tags?: string[];
  }>;
}

export interface AssistantToolPreview {
  executionId: string;
  toolName: string;
  summary: string;
  preview: Record<string, unknown>;
  requiresConfirmation: boolean;
}

export interface AssistantToolExecutionResult {
  executionId: string;
  toolName: string;
  status: 'PREVIEW' | 'EXECUTED' | 'FAILED' | 'CANCELED';
  summary: string;
  output?: Record<string, unknown>;
}

export interface AssistantAuditLogItem {
  id: string;
  category: string;
  action: string;
  summary: string;
  createdAt: string;
}

export interface AssistantQuickActionItem {
  key: string;
  label: string;
  description: string;
  prompt: string;
  icon: string;
  requiresConfirmation: boolean;
}

export interface AssistantPendingAction {
  executionId: string;
  toolName: string;
  summary: string;
  preview: Record<string, unknown>;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
}

export interface AssistantClientDirective {
  type: 'NAVIGATE';
  route: string;
  reason?: string;
}

export interface AssistantLiveTimelineItem {
  id: string;
  step: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
  createdAt: string;
}

export interface AssistantUndoOption {
  toolName: string;
  params: Record<string, unknown>;
  label: string;
  expiresInSec: number;
}

export interface AssistantProactiveSignal {
  id: string;
  level: 'info' | 'critical';
  message: string;
  suggestion?: string;
  route?: string;
}

export interface AssistantStyleProfile {
  preferredTone: AssistantToneUi;
  preferredLength: 'short' | 'detailed';
  commandCounters: Record<string, number>;
}
