export function AuditTable({
  rows
}: {
  rows: Array<{
    id: string;
    action: string;
    resourceType: string;
    createdAt: string;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Resource</th>
            <th className="px-3 py-2">Tarih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{row.action}</td>
              <td className="px-3 py-2">{row.resourceType}</td>
              <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
