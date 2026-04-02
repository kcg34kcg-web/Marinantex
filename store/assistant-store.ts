import { create } from 'zustand';
import type { AssistantBubbleState } from '@/types/assistant';

export type AssistantPanelTab = 'chat' | 'memory' | 'activity' | 'settings';

interface AssistantStoreState {
  isOpen: boolean;
  bubbleState: AssistantBubbleState;
  unreadCount: number;
  activeConversationId: string | null;
  tab: AssistantPanelTab;
  bubbleX: number;
  bubbleY: number;
  bubbleSize: number;
  hasHydratedPosition: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setBubbleState: (state: AssistantBubbleState) => void;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  resetUnread: () => void;
  setActiveConversationId: (id: string | null) => void;
  setTab: (tab: AssistantPanelTab) => void;
  setBubblePosition: (x: number, y: number) => void;
  setBubbleSize: (size: number) => void;
  setHasHydratedPosition: (value: boolean) => void;
}

export const useAssistantStore = create<AssistantStoreState>((set) => ({
  isOpen: false,
  bubbleState: 'idle',
  unreadCount: 0,
  activeConversationId: null,
  tab: 'chat',
  bubbleX: 24,
  bubbleY: 160,
  bubbleSize: 80,
  hasHydratedPosition: false,
  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setBubbleState: (bubbleState) => set({ bubbleState }),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
  resetUnread: () => set({ unreadCount: 0 }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setTab: (tab) => set({ tab }),
  setBubblePosition: (bubbleX, bubbleY) => set({ bubbleX, bubbleY }),
  setBubbleSize: (bubbleSize) => set({ bubbleSize }),
  setHasHydratedPosition: (hasHydratedPosition) => set({ hasHydratedPosition }),
}));
