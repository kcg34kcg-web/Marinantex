import { calendarExtractTasksTool, calendarTool } from '@/lib/tools/calendar-tool';
import { fileSearchTool } from '@/lib/tools/files-tool';
import { mailSummaryTool } from '@/lib/tools/mail-tool';
import { officeSummaryTool } from '@/lib/tools/office-summary-tool';
import { appNavigateTool } from '@/lib/tools/navigation-tool';
import { sendClientMessageTool } from '@/lib/tools/client-message-tool';
import { createTaskTool, listOverdueTasksTool, listTodayTasksTool, undoBulkTasksTool } from '@/lib/tools/tasks-tool';
import type { AssistantTool, ToolContext } from '@/lib/tools/types';

const registry = new Map<string, AssistantTool>([
  [appNavigateTool.name, appNavigateTool],
  [officeSummaryTool.name, officeSummaryTool],
  [mailSummaryTool.name, mailSummaryTool],
  [calendarTool.name, calendarTool],
  [calendarExtractTasksTool.name, calendarExtractTasksTool],
  [createTaskTool.name, createTaskTool],
  [listOverdueTasksTool.name, listOverdueTasksTool],
  [listTodayTasksTool.name, listTodayTasksTool],
  [undoBulkTasksTool.name, undoBulkTasksTool],
  [fileSearchTool.name, fileSearchTool],
  [sendClientMessageTool.name, sendClientMessageTool],
]);

export function getAllTools() {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    requiresConfirmation: tool.requiresConfirmation,
  }));
}

export function getTool(name: string) {
  return registry.get(name);
}

export function hasToolPermission(context: ToolContext, toolName: string) {
  // İleride rol bazlı kısıtlar burada genişletilebilir.
  if (!context.user.id) {
    return false;
  }

  const restricted = new Set(['mail.send', 'files.delete']);
  if (restricted.has(toolName)) {
    return false;
  }

  return true;
}

export function mapQuickActionToTool(key: string): { toolName: string; params: Record<string, unknown> } | null {
  if (key === 'today_summary') {
    return { toolName: 'office.summary', params: {} };
  }
  if (key === 'mail_summary') {
    return { toolName: 'mail.summary', params: {} };
  }
  if (key === 'show_meetings') {
    return { toolName: 'calendar.show', params: {} };
  }
  if (key === 'extract_tasks') {
    return { toolName: 'calendar.extract_tasks', params: {} };
  }
  if (key === 'find_file') {
    return { toolName: 'files.search', params: {} };
  }
  if (key === 'new_task') {
    return { toolName: 'tasks.create', params: {} };
  }
  if (key === 'overdue_tasks') {
    return { toolName: 'tasks.overdue', params: {} };
  }
  if (key === 'send_client_message') {
    return { toolName: 'clients.message.send', params: {} };
  }
  return null;
}
