'use client';

import { AIAnswer } from '@/lib/types';

interface AIExplanationProps {
  answer: AIAnswer | null;
  isReady: boolean;
}

export default function AIExplanation({ answer, isReady }: AIExplanationProps) {
  if (!isReady || !answer) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400/60">
            <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l1 1v3h2v-3l1-1c1-1 2-2 2-4a4 4 0 0 0-4-4Z" />
            <path d="M10 17v1a2 2 0 0 0 4 0v-1" />
          </svg>
          <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
            AI Explanation
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-12 h-12 mb-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
              <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l1 1v3h2v-3l1-1c1-1 2-2 2-4a4 4 0 0 0-4-4Z" />
              <path d="M10 17v1a2 2 0 0 0 4 0v-1" />
            </svg>
          </div>
          <p className="text-xs text-zinc-600">
            Explanation will appear after the AI answers a question
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
          <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l1 1v3h2v-3l1-1c1-1 2-2 2-4a4 4 0 0 0-4-4Z" />
          <path d="M10 17v1a2 2 0 0 0 4 0v-1" />
        </svg>
        <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
          AI Explanation
        </span>
        {answer.questionType && (
          <span className="ml-auto px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] text-zinc-500 uppercase">
            {answer.questionType}
          </span>
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 space-y-5 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
        {/* English Explanation */}
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Why?</span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-300">
            {answer.reason}
          </p>
        </div>
        
        {/* Vietnamese Translation */}
        {answer.translation && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                🇻🇳 Vietnamese
              </span>
            </div>
            <p className="text-sm leading-relaxed text-zinc-400 italic">
              {answer.translation}
            </p>
          </div>
        )}
        
        {/* Vocabulary */}
        {answer.vocabulary && answer.vocabulary.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                📚 Vocabulary
              </span>
            </div>
            <div className="space-y-1.5">
              {answer.vocabulary.map((item, i) => (
                <div
                  key={i}
                  className="flex flex-col items-start justify-between gap-1 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 sm:flex-row sm:gap-3"
                >
                  <span className="text-sm text-zinc-300 font-medium">{item.word}</span>
                  <span className="break-words text-left text-xs text-zinc-500 sm:text-right">— {item.meaning}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
