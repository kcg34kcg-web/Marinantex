import { redirect } from "next/navigation";

export default function LegacyEditorCopyPage() {
  redirect("/editor/new");
}
