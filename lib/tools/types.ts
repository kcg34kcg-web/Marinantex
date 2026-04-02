import type { SessionUser } from '@/lib/auth/session';

export interface ToolContext {
  user: SessionUser;
  now: Date;
}

export interface ToolExecutionInput {
  params: Record<string, unknown>;
  context: ToolContext;
}

export interface ToolPreviewResult {
  summary: string;
  preview: Record<string, unknown>;
  requiresConfirmation: boolean;
}

export interface ToolRunResult {
  summary: string;
  output: Record<string, unknown>;
}

export interface AssistantTool {
  name: string;
  label: string;
  description: string;
  requiresConfirmation: boolean;
  preview(input: ToolExecutionInput): Promise<ToolPreviewResult>;
  run(input: ToolExecutionInput): Promise<ToolRunResult>;
}
