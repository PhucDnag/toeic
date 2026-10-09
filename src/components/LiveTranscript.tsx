'use client';

import { useEffect, useRef } from 'react';

interface LiveTranscriptProps {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  onFeedText?: (text: string) => void;
  onRunDemo?: () => void;
}

export default function LiveTranscript({
  transcript,
  interimTranscript,
  isListening,
  onFeedText,
  onRunDemo,
}: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript]);
  
  const displayText = transcript.trim();
  const hasContent = displayText || interimTranscript;

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputRef.current && inputRef.current.value.trim()) {
      onFeedText?.(inputRef.current.value.trim());
      inputRef.current.value = '';
    }
  };
  
  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-400">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
            Live Transcript
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {onRunDemo && (
            <button
              onClick={onRunDemo}
              className="px-2 py-0.5 rounded text-[10px] font-medium text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 transition-colors cursor-pointer"
              title="Chạy mô phỏng bài nghe TOEIC mẫu để kiểm tra"
            >
              ▶ Thử bài mẫu
            </button>
          )}
          {isListening && (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              <span className="text-[10px] text-emerald-400/80 uppercase tracking-wider">
                Listening
              </span>
            </div>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-smooth p-4"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
      >
        {hasContent ? (
          <p className="break-words text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {displayText}
            {interimTranscript && (
              <span className="text-zinc-500 italic">
                {' '}{interimTranscript}
              </span>
            )}
            {isListening && (
              <span className="inline-flex ml-1 animate-pulse text-violet-400">▍</span>
            )}
          </p>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 mb-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <p className="text-xs text-zinc-400 font-medium mb-1">
              {isListening 
                ? 'Đang lắng nghe microphone...'
                : 'Bấm Bắt đầu nghe để nhận diện'}
            </p>
            <p className="text-[11px] text-zinc-600 max-w-[200px]">
              Hãy bật loa gần máy tính hoặc bấm &ldquo;Thử bài mẫu&rdquo; ở trên.
            </p>
          </div>
        )}
      </div>

      {/* Manual Input Fallback */}
      {onFeedText && (
        <form
          onSubmit={handleInputSubmit}
          className="flex items-center gap-1.5 border-t border-white/[0.04] bg-white/[0.01] p-2"
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Dán hoặc gõ văn bản bài nghe..."
            className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-500/50 focus:outline-none"
          />
          <button
            type="submit"
            className="px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 text-xs rounded-md transition-colors font-medium cursor-pointer"
          >
            Gửi
          </button>
        </form>
      )}
    </div>
  );
}
