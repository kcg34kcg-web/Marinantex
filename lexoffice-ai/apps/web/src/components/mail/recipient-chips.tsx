export function RecipientChips({ emails }: { emails: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {emails.map((email) => (
        <span key={email} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {email}
        </span>
      ))}
    </div>
  );
}
