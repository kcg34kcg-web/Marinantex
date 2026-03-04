import { ClientDetailWorkspace } from '@/components/dashboard/client-detail-workspace';

interface ClientDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params;
  return <ClientDetailWorkspace clientId={id} />;
}
