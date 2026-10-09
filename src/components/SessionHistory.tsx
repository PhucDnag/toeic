'use client';

import { SessionHistoryItem } from '@/lib/types';

interface SessionHistoryProps {
  history: SessionHistoryItem[];
}

export default function SessionHistory({ history }: SessionHistoryProps) {
  const reversedHistory = [...history].reverse();
  
  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
            Session History
          </span>
        </div>
        {history.length > 0 && (
          <span className="text-[10px] text-zinc-600">
            {history.length} question{history.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-zinc-600">
              Answered questions will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {reversedHistory.map((item, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-zinc-500 tabular-nums w-8">
                    Q{item.questionNumber}
                  </span>
                  {item.answer || item.answerText ? (
                    <span className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">
                      {item.answer || '✓'}
                    </span>
                  ) : (
                    <span className="w-6 h-6 rounded-md bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-xs text-zinc-600">
                      —
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.confidence !== undefined && item.confidence > 0 && (
                    <span className="text-[10px] text-zinc-600 tabular-nums">
                      {Math.round(item.confidence * 100)}%
                    </span>
                  )}
                  {item.answer || item.answerText ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500/50">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-zinc-600">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                </div>
                {item.answerText && (
                  <p className="w-full break-words text-xs leading-relaxed text-emerald-300/80">{item.answerText}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
