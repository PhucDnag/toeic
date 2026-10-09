'use client';

interface StartScreenProps {
  onStart: () => void;
  onStartTabAudio?: () => void;
  onDemo?: () => void;
  isSpeechAvailable: boolean;
  lastError: string | null;
}

export default function StartScreen({
  onStart,
  onStartTabAudio,
  onDemo,
  lastError,
}: StartScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:p-8">
      <div className="mx-auto w-full max-w-md text-center">
        {/* Icon */}
        <div className="relative mx-auto mb-6 h-20 w-20 sm:mb-8 sm:h-24 sm:w-24">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 blur-xl" />
          <div className="relative w-full h-full rounded-3xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-white/[0.08] flex items-center justify-center backdrop-blur-sm">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
        </div>
        
        {/* Title */}
        <h2 className="mb-2 text-xl font-semibold text-white sm:text-2xl">
          TOEIC AI Listening Assistant
        </h2>
        <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed text-zinc-400 sm:mb-8">
          Trợ lý nghe TOEIC Part 2, 3 và 4. Tự động nhận diện từng phần qua Groq Whisper AI và giải đề theo thời gian thực.
        </p>
        
        {/* Error */}
        {lastError && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400">{lastError}</p>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
          {/* Microphone Button */}
          <button
            onClick={onStart}
            className="
              group relative inline-flex items-center justify-center gap-2.5 px-6 py-3.5 
              rounded-xl font-medium text-white text-sm
              bg-gradient-to-r from-violet-600 to-blue-600
              hover:from-violet-500 hover:to-blue-500
              transition-all duration-300
              shadow-[0_0_25px_rgba(139,92,246,0.2)]
              active:scale-[0.98] cursor-pointer
            "
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            <span>Bật Micro (Thu qua loa ngoài)</span>
          </button>

          {/* Share Tab Audio Button */}
          {onStartTabAudio && (
            <button
              onClick={onStartTabAudio}
              className="
                inline-flex items-center justify-center gap-2 px-6 py-3
                rounded-xl font-medium text-zinc-200 text-xs
                bg-white/[0.04] hover:bg-white/[0.08]
                border border-white/[0.08] hover:border-white/[0.15]
                transition-all duration-200 cursor-pointer
              "
              title="Chọn tab YouTube hoặc trình duyệt và tích chọn 'Share audio'"
            >
              <span>🖥️</span>
              <span>Chia sẻ âm thanh Tab / YouTube</span>
            </button>
          )}

          {/* Demo Button */}
          {onDemo && (
            <button
              onClick={onDemo}
              className="
                inline-flex items-center justify-center gap-1.5 px-4 py-2
                rounded-lg text-xs font-medium text-violet-400 hover:text-violet-300
                hover:bg-violet-500/10 transition-colors cursor-pointer
              "
            >
              <span>▶</span>
              <span>Chạy thử bài mẫu TOEIC ngay</span>
            </button>
          )}
        </div>
        
        <p className="mt-6 text-xs text-zinc-600">
          Hỗ trợ AI Whisper tốc độ cao &amp; Groq AI giải đề tự động
        </p>
      </div>
    </div>
  );
}
