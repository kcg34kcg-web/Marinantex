import { redirect } from 'next/navigation';

interface AssistantLoginPageProps {
  searchParams: Promise<{ next?: string; switch?: string }>;
}

export default async function AssistantLoginPage({ searchParams }: AssistantLoginPageProps) {
  const params = await searchParams;
  const next = params.next;
  const switchFlag = params.switch === '1' ? '1' : undefined;

  redirect(`/login?as=assistant${switchFlag ? `&switch=${switchFlag}` : ''}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
}
