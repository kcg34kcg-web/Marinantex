'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  RagMemoryFactV1,
  RagMemoryPreferenceV1,
  RagMemoryResponseV1,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type MemoryDeleteKind = 'fact' | 'preference' | 'edge';

const EMPTY_MEMORY: RagMemoryResponseV1 = {
  feature_enabled: false,
  memory_writeback_enabled: false,
  facts: [],
  preferences: [],
  edges: [],
};

async function asJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    return payload;
  } catch {
    return {};
  }
}

export function AssistantMemoryPanel() {
  const [memory, setMemory] = useState<RagMemoryResponseV1>(EMPTY_MEMORY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFact, setNewFact] = useState('');
  const [newPrefKey, setNewPrefKey] = useState('');
  const [newPrefValue, setNewPrefValue] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/rag/memory', { method: 'GET' });
      const payload = (await asJson(response)) as Partial<RagMemoryResponseV1> & { error?: string };

      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Memory verileri alinamadi.');
        setMemory(EMPTY_MEMORY);
        return;
      }

      setMemory({
        feature_enabled: Boolean(payload.feature_enabled),
        memory_writeback_enabled: Boolean(payload.memory_writeback_enabled),
        facts: Array.isArray(payload.facts) ? (payload.facts as RagMemoryFactV1[]) : [],
        preferences: Array.isArray(payload.preferences)
          ? (payload.preferences as RagMemoryPreferenceV1[])
          : [],
        edges: Array.isArray(payload.edges) ? payload.edges : [],
      });
    } catch {
      setError('Memory servisine ulasilamadi.');
      setMemory(EMPTY_MEMORY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleWriteback(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rag/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_writeback_enabled: next }),
      });
      const payload = await asJson(response);
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Memory ayari guncellenemedi.');
        return;
      }
      setMemory((prev) => ({ ...prev, memory_writeback_enabled: next }));
    } catch {
      setError('Memory ayari guncellenemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function addFact() {
    const factText = newFact.trim();
    if (!factText) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rag/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'fact',
          fact_text: factText,
          source_type: 'user_input',
        }),
      });
      const payload = await asJson(response);
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Memory fact eklenemedi.');
        return;
      }
      setNewFact('');
      await refresh();
    } catch {
      setError('Memory fact eklenemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function addPreference() {
    const prefKey = newPrefKey.trim();
    const prefValue = newPrefValue.trim();
    if (!prefKey || !prefValue) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rag/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'preference',
          pref_key: prefKey,
          pref_value: prefValue,
        }),
      });
      const payload = await asJson(response);
      if (!response.ok) {
        setError(
          typeof payload.error === 'string'
            ? payload.error
            : 'Memory preference kaydedilemedi.',
        );
        return;
      }
      setNewPrefKey('');
      setNewPrefValue('');
      await refresh();
    } catch {
      setError('Memory preference kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(kind: MemoryDeleteKind, id: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/rag/memory?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      const payload = await asJson(response);
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Memory kaydi silinemedi.');
        return;
      }
      await refresh();
    } catch {
      setError('Memory kaydi silinemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function editFact(item: RagMemoryFactV1) {
    const nextText = window.prompt('Fact metnini duzenleyin:', item.fact_text);
    if (!nextText || nextText.trim() === item.fact_text) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rag/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'fact',
          id: item.id,
          fact_text: nextText.trim(),
        }),
      });
      const payload = await asJson(response);
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Fact guncellenemedi.');
        return;
      }
      await refresh();
    } catch {
      setError('Fact guncellenemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function editPreference(item: RagMemoryPreferenceV1) {
    const nextValue = window.prompt(`"${item.pref_key}" degeri:`, item.pref_value);
    if (!nextValue || nextValue.trim() === item.pref_value) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rag/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'preference',
          id: item.id,
          pref_value: nextValue.trim(),
        }),
      });
      const payload = await asJson(response);
      if (!response.ok) {
        setError(
          typeof payload.error === 'string'
            ? payload.error
            : 'Preference guncellenemedi.',
        );
        return;
      }
      await refresh();
    } catch {
      setError('Preference guncellenemedi.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Asistanin Ogrendikleri</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Yukleniyor...
        </CardContent>
      </Card>
    );
  }

  if (!memory.feature_enabled) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Asistanin Ogrendikleri</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-slate-500">
          Memory dashboard bu tenant icin kapali.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Asistanin Ogrendikleri</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
          <p className="text-xs text-slate-700">Memory writeback</p>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={memory.memory_writeback_enabled}
              disabled={saving}
              onChange={(event) => void toggleWriteback(event.target.checked)}
            />
            {memory.memory_writeback_enabled ? 'Acik' : 'Kapali'}
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            value={newFact}
            onChange={(event) => setNewFact(event.target.value)}
            disabled={saving}
            placeholder="Yeni fact ekle"
            className="text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void addFact()}>
            Fact Ekle
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
          <Input
            value={newPrefKey}
            onChange={(event) => setNewPrefKey(event.target.value)}
            disabled={saving}
            placeholder="pref_key"
            className="text-xs"
          />
          <Input
            value={newPrefValue}
            onChange={(event) => setNewPrefValue(event.target.value)}
            disabled={saving}
            placeholder="pref_value"
            className="text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void addPreference()}>
            Pref Ekle
          </Button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Facts ({memory.facts.length})</p>
          {memory.facts.length === 0 && <p className="text-xs text-slate-500">Kayitli fact yok.</p>}
          {memory.facts.map((fact) => (
            <div key={fact.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <p className="line-clamp-2 text-xs text-slate-800">{fact.fact_text}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  guven %{Math.round(Number(fact.confidence) * 100)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void editFact(fact)}>
                  Duzenle
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void deleteItem('fact', fact.id)}
                >
                  Sil
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Preferences ({memory.preferences.length})</p>
          {memory.preferences.length === 0 && <p className="text-xs text-slate-500">Kayitli preference yok.</p>}
          {memory.preferences.map((pref) => (
            <div key={pref.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700">{pref.pref_key}</p>
                <p className="line-clamp-2 text-xs text-slate-600">{pref.pref_value}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void editPreference(pref)}
                >
                  Duzenle
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void deleteItem('preference', pref.id)}
                >
                  Sil
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-500">Memory edge sayisi: {memory.edges.length}</p>
      </CardContent>
    </Card>
  );
}
