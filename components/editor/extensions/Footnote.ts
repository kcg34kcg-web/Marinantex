import { Node, mergeAttributes } from '@tiptap/core'

// 1. ÇÖZÜM: TypeScript'e yeni komutumuzu tanıtıyoruz (Kırmızı çizgi hatalarını yok eder)
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content: string) => ReturnType,
    }
  }
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      content: { default: '' },
      id: { default: () => Math.random().toString(36).substr(2, 9) }
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '' }), `[Dipnot]`]
  },

  addCommands() {
    return {
      insertFootnote: (content: string) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { content },
        })
      },
    }
  },
})