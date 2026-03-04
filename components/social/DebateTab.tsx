'use client';

import DebateList from '@/components/social/debate/DebateList';

interface DebateTabProps {
  debateData?: unknown;
}

export default function DebateTab(_props: DebateTabProps) {
  return <DebateList />;
}

