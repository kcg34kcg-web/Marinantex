import type { AssistantPreferencePayload } from '@/types/assistant';

export function buildDefaultPreference(override?: Partial<AssistantPreferencePayload>): AssistantPreferencePayload {
  return {
    assistantName: 'Babylexit Asistan',
    tone: 'professional',
    language: 'tr',
    responseLength: 'short',
    proactiveLevel: 2,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    keyboardShortcut: 'Mod+K',
    bubblePositionX: 24,
    bubblePositionY: 120,
    bubbleSize: 80,
    animationLevel: 2,
    memoryEnabled: true,
    requireConfirmationCritical: true,
    temporaryMode: false,
    ...override,
  };
}
