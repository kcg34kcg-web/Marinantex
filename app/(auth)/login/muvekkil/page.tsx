import { redirect } from 'next/navigation';

interface ClientLoginPageProps {
  searchParams: Promise<{ next?: string; switch?: string }>;
}

export default async function ClientLoginPage({ searchParams }: ClientLoginPageProps) {
  const params = await searchParams;
  const next = params.next;
  const switchFlag = params.switch === '1' ? '1' : undefined;

  redirect(`/login?as=client${switchFlag ? `&switch=${switchFlag}` : ''}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
}
