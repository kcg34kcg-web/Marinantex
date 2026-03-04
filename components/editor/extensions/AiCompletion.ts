import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const AiCompletion = Extension.create({
  name: 'aiCompletion',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('aiCompletion'),
        state: {
          init() { return DecorationSet.empty },
          apply(tr, set) {
            // Burada AI'dan gelen öneriyi state'te tutabilirsin
            // Bu ileri seviye bir geliştirmedir, şimdilik placeholder bırakalım.
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})