"use client";

import type { Editor } from "@tiptap/react";
import { useRef } from "react";

interface EditorToolbarProps {
  editor: Editor | null;
  readOnly?: boolean;
  wordCount?: number;
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Palatino", value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { label: "Book Antiqua", value: "'Book Antiqua', Palatino, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Lucida Sans", value: "'Lucida Sans Unicode', 'Lucida Grande', sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Roboto", value: "Roboto, Arial, sans-serif" },
  { label: "Inter", value: "Inter, 'Segoe UI', sans-serif" },
];

const FONT_SIZES = [
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "16px",
  "18px",
  "20px",
  "24px",
  "28px",
  "32px",
  "40px",
];

function ToolbarButton({
  label,
  onClick,
  isActive = false,
  disabled = false,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
        isActive
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function EditorToolbar({
  editor,
  readOnly = false,
  wordCount = 0,
}: EditorToolbarProps) {
  const disabled = !editor || readOnly;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const insertImageFromFile = (file: File | null) => {
    if (!editor || !file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        return;
      }
      editor.chain().focus().setImage({ src: result }).run();
    };
    reader.readAsDataURL(file);
  };

  const increaseFontSize = () => {
    if (!editor) {
      return;
    }
    const activeSize = editor.getAttributes("textStyle").fontSize as string | undefined;
    const current = activeSize ? Number.parseInt(activeSize, 10) : 16;
    const next = Math.min(current + 1, 72);
    editor.chain().focus().setMark("textStyle", { fontSize: `${next}px` }).run();
  };

  const decreaseFontSize = () => {
    if (!editor) {
      return;
    }
    const activeSize = editor.getAttributes("textStyle").fontSize as string | undefined;
    const current = activeSize ? Number.parseInt(activeSize, 10) : 16;
    const next = Math.max(current - 1, 8);
    editor.chain().focus().setMark("textStyle", { fontSize: `${next}px` }).run();
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          disabled={disabled}
          onChange={(event) => {
            if (!editor) {
              return;
            }
            const value = event.target.value;
            if (value === "default") {
              editor.chain().focus().unsetFontFamily().run();
              return;
            }
            editor.chain().focus().setFontFamily(value).run();
          }}
          defaultValue="default"
        >
          <option value="default">Font Ailesi</option>
          {FONT_FAMILIES.map((font) => (
            <option key={font.label} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>

        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          disabled={disabled}
          onChange={(event) => {
            if (!editor) {
              return;
            }
            editor
              .chain()
              .focus()
              .setMark("textStyle", { fontSize: event.target.value })
              .run();
          }}
          defaultValue="16px"
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <ToolbarButton label="A+" disabled={disabled} onClick={increaseFontSize} />
        <ToolbarButton label="A-" disabled={disabled} onClick={decreaseFontSize} />

        <label className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
          Yazi Rengi
          <input
            type="color"
            disabled={disabled}
            onChange={(event) => {
              editor?.chain().focus().setColor(event.target.value).run();
            }}
          />
        </label>

        <label className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
          Arka Plan
          <input
            type="color"
            disabled={disabled}
            onChange={(event) => {
              editor
                ?.chain()
                .focus()
                .setHighlight({ color: event.target.value })
                .run();
            }}
          />
        </label>

        <ToolbarButton
          label="Arka Plan Sil"
          disabled={disabled}
          onClick={() => editor?.chain().focus().unsetHighlight().run()}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="B"
          isActive={Boolean(editor?.isActive("bold"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          isActive={Boolean(editor?.isActive("italic"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="U"
          isActive={Boolean(editor?.isActive("underline"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          label="S"
          isActive={Boolean(editor?.isActive("strike"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          label="Sub"
          isActive={Boolean(editor?.isActive("subscript"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleSubscript().run()}
        />
        <ToolbarButton
          label="Sup"
          isActive={Boolean(editor?.isActive("superscript"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleSuperscript().run()}
        />

        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          disabled={disabled}
          defaultValue="paragraph"
          onChange={(event) => {
            const value = event.target.value;
            if (!editor) {
              return;
            }
            if (value === "paragraph") {
              editor.chain().focus().setParagraph().run();
              return;
            }
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number.parseInt(value, 10) as 1 | 2 | 3 | 4 | 5 | 6 })
              .run();
          }}
        >
          <option value="paragraph">Paragraf</option>
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option value="4">H4</option>
          <option value="5">H5</option>
          <option value="6">H6</option>
        </select>

        <ToolbarButton
          label="Liste"
          isActive={Boolean(editor?.isActive("bulletList"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numara"
          isActive={Boolean(editor?.isActive("orderedList"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Gorev"
          isActive={Boolean(editor?.isActive("taskList"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        />
        <ToolbarButton
          label="Alinti"
          isActive={Boolean(editor?.isActive("blockquote"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Kod"
          isActive={Boolean(editor?.isActive("codeBlock"))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="Sola"
          isActive={Boolean(editor?.isActive({ textAlign: "left" }))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        />
        <ToolbarButton
          label="Ortala"
          isActive={Boolean(editor?.isActive({ textAlign: "center" }))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
        />
        <ToolbarButton
          label="Saga"
          isActive={Boolean(editor?.isActive({ textAlign: "right" }))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
        />
        <ToolbarButton
          label="Yasla"
          isActive={Boolean(editor?.isActive({ textAlign: "justify" }))}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
        />

        <ToolbarButton
          label="Link"
          disabled={disabled}
          onClick={() => {
            if (!editor) {
              return;
            }
            const href = window.prompt("Link URL girin:", "https://");
            if (!href) {
              return;
            }
            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }}
        />
        <ToolbarButton
          label="Link Sil"
          disabled={disabled}
          onClick={() => editor?.chain().focus().unsetLink().run()}
        />
        <ToolbarButton
          label="Ayirici"
          disabled={disabled}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        />
        <ToolbarButton
          label="Temizle"
          disabled={disabled}
          onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
        />

        <ToolbarButton
          label="Geri"
          disabled={disabled || !editor?.can().chain().focus().undo().run()}
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Ileri"
          disabled={disabled || !editor?.can().chain().focus().redo().run()}
          onClick={() => editor?.chain().focus().redo().run()}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="Tablo Ekle"
          disabled={disabled}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        />
        <ToolbarButton
          label="Satir +"
          disabled={disabled}
          onClick={() => editor?.chain().focus().addRowAfter().run()}
        />
        <ToolbarButton
          label="Satir -"
          disabled={disabled}
          onClick={() => editor?.chain().focus().deleteRow().run()}
        />
        <ToolbarButton
          label="Sutun +"
          disabled={disabled}
          onClick={() => editor?.chain().focus().addColumnAfter().run()}
        />
        <ToolbarButton
          label="Sutun -"
          disabled={disabled}
          onClick={() => editor?.chain().focus().deleteColumn().run()}
        />
        <ToolbarButton
          label="Hucre Birlestir"
          disabled={disabled}
          onClick={() => editor?.chain().focus().mergeCells().run()}
        />
        <ToolbarButton
          label="Hucre Ayir"
          disabled={disabled}
          onClick={() => editor?.chain().focus().splitCell().run()}
        />
        <ToolbarButton
          label="Tablo Sil"
          disabled={disabled}
          onClick={() => editor?.chain().focus().deleteTable().run()}
        />

        <ToolbarButton
          label="Gorsel URL"
          disabled={disabled}
          onClick={() => {
            if (!editor) {
              return;
            }
            const src = window.prompt("Gorsel URL", "https://");
            if (!src) {
              return;
            }
            editor.chain().focus().setImage({ src }).run();
          }}
        />
        <ToolbarButton
          label="Gorsel Yukle"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            insertImageFromFile(file);
            event.currentTarget.value = "";
          }}
        />

        <span className="ml-auto rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700">
          Sozcuk: {wordCount}
        </span>
      </div>
    </div>
  );
}
