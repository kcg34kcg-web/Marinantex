'use client';

import Link from 'next/link';
import type { Route } from 'next';
import {
  Briefcase,
  LayoutDashboard,
  Users,
  Scale,
  PanelLeftClose,
  PanelLeftOpen,
  Calculator,
  Building2,
  UserPlus,
  UserCircle2,
  BrainCircuit,
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { href: '/office', label: 'Ofisim', icon: Building2 },
  { href: '/dashboard/cases', label: 'Dosyalar', icon: Briefcase },
  { href: '/dashboard/clients', label: 'Müvekkiller', icon: Users },
  { href: '/dashboard/profile', label: 'Profil', icon: UserCircle2 },
  { href: '/dashboard/invites', label: 'Davetler', icon: UserPlus },
  { href: '/tools/calculator/interest', label: 'Faiz Aracı', icon: Calculator },
  { href: '/tools/calculator/smm', label: 'SMM Aracı', icon: Calculator },
  { href: '/tools/calculator/execution', label: 'İcra Masrafı', icon: Calculator },
  { href: '/tools/hukuk-ai', label: 'Hukuk AI', icon: BrainCircuit },
] as const;

export function DashboardSidebar() {
  const { isSidebarOpen, toggleSidebar } = useUiStore();

  return (
    <aside className={cn('border-r border-border bg-white p-3 transition-all', isSidebarOpen ? 'w-64' : 'w-20')}>
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-blue-600">
          <Scale className="h-5 w-5" />
          {isSidebarOpen ? <span className="text-sm font-bold">Babylexit</span> : null}
        </div>
        <Button variant="outline" size="sm" onClick={toggleSidebar}>
          {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="space-y-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href as Route}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <Icon className="h-4 w-4" />
              {isSidebarOpen ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
