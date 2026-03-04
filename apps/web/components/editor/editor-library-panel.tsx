"use client";

import type {
  ClauseItem,
  DynamicFieldDefinition,
  TemplateItem,
} from "./types";

interface EditorLibraryPanelProps {
  templates: TemplateItem[];
  clauses: ClauseItem[];
  dynamicFields: DynamicFieldDefinition[];
  onApplyTemplate: (template: TemplateItem) => void;
  onInsertClause: (clause: ClauseItem) => void;
  onInsertDynamicField: (field: DynamicFieldDefinition) => void;
}

export function EditorLibraryPanel({
  templates,
  clauses,
  dynamicFields,
  onApplyTemplate,
  onInsertClause,
  onInsertDynamicField,
}: EditorLibraryPanelProps) {
  return (
    <aside className="sticky top-4 hidden h-fit w-[380px] shrink-0 flex-col gap-3 self-start xl:flex">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Template Library</h2>
        <p className="mt-1 text-xs text-slate-500">
          Belgeyi seçili şablon ile tamamen değiştirir.
        </p>
        <div className="mt-3 flex max-h-[220px] flex-col gap-2 overflow-auto">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="rounded-lg border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/50"
              onClick={() => onApplyTemplate(template)}
            >
              <p className="text-xs font-semibold text-slate-800">{template.name}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {template.documentType} · v{template.schemaVersion}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Clause / Snippet Library
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          İmlecin bulunduğu yere clause snippet ekler.
        </p>
        <div className="mt-3 flex max-h-[220px] flex-col gap-2 overflow-auto">
          {clauses.map((clause) => (
            <button
              key={clause.id}
              type="button"
              className="rounded-lg border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/50"
              onClick={() => onInsertClause(clause)}
            >
              <p className="text-xs font-semibold text-slate-800">{clause.title}</p>
              <p className="mt-1 text-[11px] text-slate-500">{clause.category}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Dynamic Fields</h2>
        <p className="mt-1 text-xs text-slate-500">
          Metin değil node olarak belgeye yerleştirilir.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {dynamicFields.map((field) => (
            <button
              key={field.fieldKey}
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50"
              onClick={() => onInsertDynamicField(field)}
            >
              {field.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
