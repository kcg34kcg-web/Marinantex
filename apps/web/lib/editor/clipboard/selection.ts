import type { Editor, JSONContent } from "@tiptap/react";
import type { SelectionSnapshot } from "../udf/types";

function asNodeArray(value: unknown): JSONContent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as JSONContent[];
}

export function extractSelectionSnapshot(editor: Editor): SelectionSnapshot {
  const { from, to, empty } = editor.state.selection;

  if (empty) {
    const full = editor.getJSON();
    return {
      tiptapNodes: asNodeArray(full.content),
      selectionText: editor.getText(),
    };
  }

  const slice = editor.state.doc.slice(from, to);
  return {
    tiptapNodes: asNodeArray(slice.content.toJSON()),
    selectionText: editor.state.doc.textBetween(from, to, "\n", "\0"),
  };
}
