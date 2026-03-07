import type { PropsWithChildren } from "react";

export function Panel({ children }: PropsWithChildren) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4">{children}</section>;
}
