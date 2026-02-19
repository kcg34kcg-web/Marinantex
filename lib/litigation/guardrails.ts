import { parseISO, isBefore } from 'date-fns';
import type { TemporalFactNode } from '@/lib/litigation/types';

export interface LogicAlert {
  severity: 'critical' | 'warning';
  code: string;
  message: string;
  nodeId: string;
}

export function validateImpossibleStates(nodes: TemporalFactNode[]): LogicAlert[] {
  const alerts: LogicAlert[] = [];

  for (const node of nodes) {
    if (!node.factualOccurrenceDate || !node.epistemicDiscoveryDate) {
      continue;
    }

    const factualDate = parseISO(node.factualOccurrenceDate);
    const discoveryDate = parseISO(node.epistemicDiscoveryDate);

    if (isBefore(discoveryDate, factualDate)) {
      alerts.push({
        severity: 'warning',
        code: 'EPISTEMIC_BEFORE_FACTUAL',
        message: 'Epistemik keşif tarihi, olgunun gerçekleşme tarihinden önce görünüyor.',
        nodeId: node.id,
      });
    }

    if (node.label.toLocaleLowerCase('tr-TR').includes('şirket kuruluş') && isBefore(discoveryDate, factualDate)) {
      alerts.push({
        severity: 'critical',
        code: 'CORPORATE_EXISTENCE_CONFLICT',
        message: 'Tüzel kişilik, kuruluş tarihinden önce var olamaz. Kritik mantık ihlali.',
        nodeId: node.id,
      });
    }
  }

  return alerts;
}
