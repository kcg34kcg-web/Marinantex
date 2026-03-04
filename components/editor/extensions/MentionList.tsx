import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

export default forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command({ id: item.id, label: item.label, text: item.text })
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }
      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }
      if (event.key === 'Enter') {
        enterHandler()
        return true
      }
      return false
    },
  }))

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[300px] z-50">
      <div className="text-xs text-slate-400 p-2 border-b border-slate-700 bg-slate-900">
        Kanun Maddesi Seçin
      </div>
      {props.items.length ? (
        props.items.map((item: any, index: number) => (
          <button
            className={`flex flex-col text-left w-full p-3 text-sm transition-colors ${
              index === selectedIndex ? 'bg-amber-600 text-white' : 'text-slate-200 hover:bg-slate-700'
            }`}
            key={index}
            onClick={() => selectItem(index)}
          >
            <span className="font-bold">{item.label}</span>
            <span className={`text-xs truncate max-w-[280px] ${index === selectedIndex ? 'text-amber-100' : 'text-slate-400'}`}>
              {item.text}
            </span>
          </button>
        ))
      ) : (
        <div className="p-3 text-sm text-slate-500">Sonuç bulunamadı.</div>
      )}
    </div>
  )
})