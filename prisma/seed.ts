import { PrismaClient, AssistantTone, AssistantLanguage, TaskPriority } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@babylexit.local' },
    update: { name: 'Demo Kullanıcı' },
    create: {
      email: 'demo@babylexit.local',
      name: 'Demo Kullanıcı',
    },
  });

  await prisma.assistantPreference.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      assistantName: 'Babylexit Asistan',
      tone: AssistantTone.PROFESSIONAL,
      language: AssistantLanguage.TR,
      responseLength: 'short',
      proactiveLevel: 2,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      keyboardShortcut: 'Mod+K',
      bubblePositionX: 24,
      bubblePositionY: 120,
      bubbleSize: 56,
      animationLevel: 2,
      memoryEnabled: true,
      requireConfirmationCritical: true,
      temporaryMode: false,
    },
  });

  const quickActions = [
    {
      key: 'today_summary',
      label: 'Bugünü özetle',
      description: 'Takvim, görev ve öncelikleri özetler.',
      prompt: 'Bugünkü takvimimi ve görevlerimi özetle.',
      icon: 'CalendarDays',
      requiresConfirmation: false,
      sortOrder: 1,
    },
    {
      key: 'mail_summary',
      label: 'Mailleri özetle',
      description: 'Öncelikli mail konularını listeler.',
      prompt: 'Bugünkü mailleri önem sırasına göre özetle.',
      icon: 'Mail',
      requiresConfirmation: false,
      sortOrder: 2,
    },
    {
      key: 'show_meetings',
      label: 'Toplantılarımı göster',
      description: 'Yaklaşan toplantıları getirir.',
      prompt: 'Yaklaşan toplantılarımı göster.',
      icon: 'CalendarClock',
      requiresConfirmation: false,
      sortOrder: 3,
    },
    {
      key: 'extract_tasks',
      label: 'Yapılacakları çıkar',
      description: 'Toplantı notlarından görev çıkarır.',
      prompt: 'Toplantı notlarından yapılacakları çıkar.',
      icon: 'ListChecks',
      requiresConfirmation: true,
      sortOrder: 4,
    },
    {
      key: 'find_file',
      label: 'Dosya bul',
      description: 'Dosya aramasını başlatır.',
      prompt: 'Dosyalarda arama yap.',
      icon: 'Search',
      requiresConfirmation: false,
      sortOrder: 5,
    },
    {
      key: 'new_task',
      label: 'Yeni görev oluştur',
      description: 'Yeni görev oluşturur.',
      prompt: 'Yeni görev oluştur.',
      icon: 'Plus',
      requiresConfirmation: true,
      sortOrder: 6,
    },
    {
      key: 'overdue_tasks',
      label: 'Geciken işleri listele',
      description: 'Vadesi geçen görevleri getirir.',
      prompt: 'Geciken görevleri listele.',
      icon: 'AlertTriangle',
      requiresConfirmation: false,
      sortOrder: 7,
    },
  ];

  for (const item of quickActions) {
    await prisma.quickAction.upsert({
      where: { key: item.key },
      update: item,
      create: item,
    });
  }

  const taskCount = await prisma.task.count({ where: { userId: demoUser.id } });
  if (taskCount === 0) {
    await prisma.task.createMany({
      data: [
        {
          userId: demoUser.id,
          title: 'Dava dosyası A için duruşma notu hazırla',
          description: 'Müvekkil görüşmesi sonrası son kontrol',
          dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
          priority: TaskPriority.HIGH,
        },
        {
          userId: demoUser.id,
          title: 'Tahsilat raporu kontrolü',
          description: 'Haftalık finans raporuna ekle',
          dueAt: new Date(Date.now() - 1000 * 60 * 60 * 8),
          priority: TaskPriority.URGENT,
        },
      ],
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
