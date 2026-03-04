"use client";

import { Node, mergeAttributes } from "@tiptap/core";

export interface DynamicFieldAttributes {
  fieldKey: string;
  label: string;
  value: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dynamicField: {
      insertDynamicField: (attributes: DynamicFieldAttributes) => ReturnType;
    };
  }
}

export const DynamicFieldExtension = Node.create({
  name: "dynamicField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      fieldKey: {
        default: "",
      },
      label: {
        default: "Field",
      },
      value: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-dynamic-field]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as DynamicFieldAttributes;
    const displayValue = attrs.value ? `: ${attrs.value}` : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-dynamic-field": "true",
        "data-field-key": attrs.fieldKey,
        "data-field-value": attrs.value,
        class: "dynamic-field-node",
        contenteditable: "false",
      }),
      `{{${attrs.label}${displayValue}}}`,
    ];
  },

  addCommands() {
    return {
      insertDynamicField:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },
});
