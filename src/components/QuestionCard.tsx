'use client';

import { AppState, TOEICQuestion, AIAnswer } from '@/lib/types';

interface QuestionCardProps {
  appState: AppState;
  question: TOEICQuestion | null;
  answer: AIAnswer | null;
  onForceSolve?: () => void;
}

export default function QuestionCard({ appState, question, answer, onForceSolve }: QuestionCardProps) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">Câu trả lời</span>
        {onForceSolve && (
          <button onClick={onForceSolve} className="rounded-md bg-violet-500/15 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/25">
            {appState === 'ERROR' ? 'Thử lại' : 'Phân tích đoạn vừa nghe'}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {answer && question ? (
          <>
            <p className="mb-3 text-xs text-zinc-500">Câu {question.questionNumber}</p>
            <p className="mb-5 break-words text-sm leading-relaxed text-zinc-300">{question.questionText}</p>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
              <p className="mb-2 text-xs font-medium text-emerald-400">Trả lời</p>
              <p className="break-words text-xl font-semibold leading-relaxed text-emerald-200">{answer.answerText}</p>
              {answer.translation && <p className="mt-4 text-sm leading-relaxed text-zinc-400">{answer.translation}</p>}
            </div>
            <p className="mt-4 text-xs text-zinc-500">Vẫn tiếp tục nghe. Các câu đã trả lời được lưu trong lịch sử.</p>
          </>
        ) : (
          <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
            <div className="mb-4 h-3 w-3 animate-pulse rounded-full bg-violet-400" />
            <p className="text-sm text-zinc-300">{appState === 'SOLVING' ? 'Đang phân tích đoạn nghe…' : appState === 'ERROR' ? 'Chưa phân tích được đoạn nghe' : 'Đang nghe…'}</p>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">Phát bài nghe như bình thường. Câu trả lời sẽ xuất hiện khi nghe đủ nội dung, không cần nhãn A/B/C hay số câu.</p>
          </div>
        )}
      </div>
    </div>
  );
}
