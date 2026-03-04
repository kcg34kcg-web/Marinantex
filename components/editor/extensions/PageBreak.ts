import { Node, mergeAttributes } from '@tiptap/core'

// 1. ÇÖZÜM: TypeScript'e yeni komutumuzu tanıtıyoruz (Module Augmentation)
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType,
    }
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  
  // Bu düğümün içine başka bir şey yazılamaz
  atom: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="page-break"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 
      'data-type': 'page-break', 
      class: 'page-break-indicator' 
    })]
  },

  addCommands() {
    return {
      setPageBreak: () => ({ chain }) => {
        return chain()
          .insertContent({ type: this.name })
          // Sayfa sonu ekledikten sonra yeni bir paragraf aç
          .insertContent({ type: 'paragraph' })
          .run()
      },
    }
  },
})