import { requireInternalOfficeUser } from '@/lib/office/team-access';

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const supabase = access.supabase;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const [pendingTasksResult, dueTodayTasksResult, documentsTodayResult, membershipsResult] = await Promise.all([
    supabase.from('office_tasks').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    supabase
      .from('office_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress'])
      .gte('due_at', startOfDay)
      .lt('due_at', endOfDay),
    supabase.from('documents').select('id', { count: 'exact', head: true }).gte('created_at', startOfDay),
    supabase.from('office_thread_members').select('thread_id, last_read_at').eq('user_id', access.userId),
  ]);

  if (pendingTasksResult.error || dueTodayTasksResult.error || documentsTodayResult.error || membershipsResult.error) {
    return Response.json({ error: 'Office özet verileri alınamadı.' }, { status: 500 });
  }

  const memberships = membershipsResult.data ?? [];
  const unreadCounts = await Promise.all(
    memberships.map(async (membership) => {
      let query = supabase
        .from('office_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', membership.thread_id)
        .neq('sender_id', access.userId);

      if (membership.last_read_at) {
        query = query.gt('created_at', membership.last_read_at);
      }

      const { count, error } = await query;
      return error ? 0 : count ?? 0;
    })
  );

  const unreadMessages = unreadCounts.reduce((acc, item) => acc + item, 0);
  const unreadThreads = unreadCounts.filter((item) => item > 0).length;

  return Response.json({
    summary: {
      pendingTasks: pendingTasksResult.count ?? 0,
      dueTodayTasks: dueTodayTasksResult.count ?? 0,
      unreadMessages,
      unreadThreads,
      documentsToday: documentsTodayResult.count ?? 0,
    },
  });
}
