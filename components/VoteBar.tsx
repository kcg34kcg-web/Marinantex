'use client';
import { useOptimistic } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

export function VoteBar({ initialUp, initialDown, currentVote }: any) {
  const [optimisticState, setOptimistic] = useOptimistic(
    { up: initialUp, down: initialDown, vote: currentVote },
    (state, action: number) => ({
      ...state,
      up: action === 1 ? state.up + 1 : (state.vote === 1 ? state.up - 1 : state.up),
      down: action === -1 ? state.down + 1 : (state.vote === -1 ? state.down - 1 : state.down),
      vote: action
    })
  );

  return (
    <div className="flex flex-col items-center gap-2 bg-slate-800/40 p-2 rounded-xl border border-slate-700">
      <button onClick={() => setOptimistic(1)} className={optimisticState.vote === 1 ? 'text-amber-500' : 'text-slate-500 hover:text-slate-300'}>
        <ChevronUp size={28} strokeWidth={3} />
      </button>
      <span className="text-sm font-bold text-slate-200">{optimisticState.up - optimisticState.down}</span>
      <button onClick={() => setOptimistic(-1)} className={optimisticState.vote === -1 ? 'text-red-500' : 'text-slate-500 hover:text-slate-300'}>
        <ChevronDown size={28} strokeWidth={3} />
      </button>
    </div>
  );
}