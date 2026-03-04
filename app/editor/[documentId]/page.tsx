import { EditorShell } from "@/apps/web/components/editor/editor-shell";

interface RootEditorDocumentPageProps {
  params: Promise<{
    documentId: string;
  }>;
}

export default async function RootEditorDocumentPage({
  params,
}: RootEditorDocumentPageProps) {
  const { documentId } = await params;
  return <EditorShell documentId={documentId} />;
}
