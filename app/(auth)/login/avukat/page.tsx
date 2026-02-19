import { redirect } from 'next/navigation';

interface LawyerLoginPageProps {
  searchParams: Promise<{ next?: string; switch?: string }>;
}

export default async function LawyerLoginPage({ searchParams }: LawyerLoginPageProps) {
  const params = await searchParams;
  const next = params.next;
  const switchFlag = params.switch === '1' ? '1' : undefined;

  redirect(`/login?as=lawyer${switchFlag ? `&switch=${switchFlag}` : ''}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
}
