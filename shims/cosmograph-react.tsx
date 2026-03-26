import * as React from 'react';

export interface CosmographRef {
  captureScreenshot?: (fileName?: string) => void;
}

interface CosmographProps {
  points?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  pointLabelBy?: string;
  onGraphRebuilt?: () => void;
  [key: string]: unknown;
}

export const Cosmograph = React.forwardRef<CosmographRef, CosmographProps>(function Cosmograph(
  { points = [], links = [], pointLabelBy = 'label', onGraphRebuilt },
  ref,
) {
  React.useImperativeHandle(
    ref,
    () => ({
      captureScreenshot: () => {},
    }),
    [],
  );

  React.useEffect(() => {
    onGraphRebuilt?.();
  }, [links, onGraphRebuilt, points]);

  const previewPoints = points.slice(0, 8);

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-auto bg-slate-50 p-4 text-sm text-slate-700">
      <div className="rounded-md border border-dashed border-slate-300 bg-white p-3">
        <p className="font-semibold text-slate-900">Graph preview shim aktif</p>
        <p className="mt-1 text-xs text-slate-500">
          Bu build ortamında tam Cosmograph renderer yerine özet görünüm gösteriliyor.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nodes</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{points.length}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Links</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{links.length}</p>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Preview</p>
        {previewPoints.length === 0 ? (
          <p className="text-xs text-slate-500">No nodes loaded.</p>
        ) : (
          <ul className="space-y-2">
            {previewPoints.map((point, index) => {
              const label = point[pointLabelBy] ?? point.label ?? point.id ?? `node-${index + 1}`;
              return (
                <li key={String(point.id ?? index)} className="rounded-md bg-slate-50 px-3 py-2">
                  {String(label)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});
