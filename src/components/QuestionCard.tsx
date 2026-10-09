'use client';

import { AppState, TOEICQuestion, AIAnswer } from '@/lib/types';
import { countChoices, getNextExpectedChoice } from '@/lib/toeic-detector';

interface QuestionCardProps {
  appState: AppState;
  question: TOEICQuestion | null;
  answer: AIAnswer | null;
  onForceSolve?: () => void;
}

export default function QuestionCard({ appState, question, answer, onForceSolve }: QuestionCardProps) {
  const isSuggestion = question?.part === 3 || question?.part === 4;
  const choiceLabels = question?.part === 2
    ? (['A', 'B', 'C'] as const)
    : (['A', 'B', 'C', 'D'] as const);
  const isAnswerReady = appState === 'ANSWER_READY' && answer;
  const isSolving = appState === 'SOLVING';
  
  // Status text based on state
  const getStatusContent = () => {
    switch (appState) {
      case 'IDLE':
        return (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-16 h-16 mb-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-white/[0.06] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500 mb-1">No question detected yet</p>
            <p className="text-xs text-zinc-600">Start listening and play your TOEIC audio</p>
          </div>
        );
      case 'LISTENING':
        return (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="relative w-16 h-16 mb-4">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 animate-pulse" />
              <div className="relative w-full h-full flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400/60">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
            </div>
            <p className="text-sm text-zinc-400 mb-1">Listening for questions...</p>
            <p className="text-xs text-zinc-600">Play TOEIC audio near the microphone</p>
          </div>
        );
      default:
        return null;
    }
  };
  
  // If no question and in a non-question state
  if (!question && (appState === 'IDLE' || appState === 'LISTENING')) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
              TOEIC Question
            </span>
          </div>
        </div>
        {getStatusContent()}
      </div>
    );
  }
  
  const choiceCount = question ? countChoices(question.choices) : 0;
  const nextChoice = question ? getNextExpectedChoice(question.choices, question.part) : null;
  
  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
          <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
            TOEIC Question
          </span>
        </div>
        
        {/* State indicator & Force Solve button */}
        <div className="flex items-center gap-2">
          {appState === 'QUESTION_DETECTED' && (
            <span className="text-[10px] text-blue-400/80 uppercase tracking-wider">Question detected</span>
          )}
          {appState === 'WAITING_FOR_CHOICES' && (
            <span className="text-[10px] text-blue-400/80 uppercase tracking-wider animate-pulse">
              Waiting for choice {nextChoice}...
            </span>
          )}
          {appState === 'QUESTION_COMPLETE' && (
            <span className="text-[10px] text-violet-400/80 uppercase tracking-wider">Complete</span>
          )}
          {isSolving && (
            <span className="text-[10px] text-amber-400/80 uppercase tracking-wider animate-pulse">Analyzing...</span>
          )}
          {isAnswerReady && (
            <span className="text-[10px] text-emerald-400/80 uppercase tracking-wider">Answer ready</span>
          )}
          
          {(appState === 'QUESTION_DETECTED' || appState === 'WAITING_FOR_CHOICES') && onForceSolve && (
            <button
              onClick={onForceSolve}
              className="px-2.5 py-1 rounded-md bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-[11px] font-medium shadow-sm transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
              title="Giải câu này ngay lập tức với AI"
            >
              <span>⚡</span>
              <span>Giải ngay</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Question Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {question && (
          <>
            {/* Question number */}
            <div className="mb-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-zinc-300">
                Question {question.questionNumber}
                {question.part && <span className="ml-1.5 text-zinc-500">· Part {question.part}</span>}
              </span>
            </div>
            
            {/* Question text */}
            <p className="mb-5 break-words text-sm font-medium leading-relaxed text-zinc-200 sm:mb-6 sm:text-[15px]">
              {question.questionText || 'Detecting question...'}
            </p>
            
            {/* Choices */}
            {isSuggestion && (
              <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm leading-relaxed">
                <p className="mb-2 text-blue-300">Gợi ý dựa trên đoạn nghe · Không cần nghe A/B/C/D</p>
                <p className="whitespace-pre-wrap break-words text-zinc-400">{question.passage || 'Chưa nghe được đoạn hội thoại/bài nói của nhóm câu này.'}</p>
              </div>
            )}
            {!isSuggestion && (
            <div className="space-y-2.5">
              {choiceLabels.map((letter) => {
                const text = question.choices[letter];
                const isCorrect = isAnswerReady && answer?.answer === letter;
                const hasText = !!text;
                
                return (
                  <div
                    key={letter}
                    className={`
                      flex items-start gap-3 rounded-xl border px-3 py-3 transition-all duration-500 sm:px-4
                      ${isCorrect
                        ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                        : hasText
                          ? 'bg-white/[0.02] border-white/[0.06]'
                          : 'bg-white/[0.01] border-white/[0.03] border-dashed'
                      }
                    `}
                  >
                    <span
                      className={`
                        flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold
                        ${isCorrect
                          ? 'bg-emerald-500 text-white'
                          : hasText
                            ? 'bg-white/[0.06] text-zinc-300'
                            : 'bg-white/[0.02] text-zinc-600'
                        }
                      `}
                    >
                      {letter}
                    </span>
                    <span
                      className={`
                        text-sm leading-relaxed pt-0.5
                        ${isCorrect
                          ? 'text-emerald-300 font-medium'
                          : hasText
                            ? 'text-zinc-300'
                            : 'text-zinc-600 italic'
                        }
                      `}
                    >
                      {text || `Waiting for choice ${letter}...`}
                    </span>
                  </div>
                );
              })}
            </div>
            )}
            
            {/* Progress & Quick action */}
            {!isSuggestion && (appState === 'WAITING_FOR_CHOICES' || appState === 'QUESTION_DETECTED') && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex gap-1">
                    {choiceLabels.map((letter) => (
                      <div
                        key={letter}
                        className={`w-6 h-1 rounded-full transition-all ${
                          question.choices[letter] ? 'bg-blue-500/60' : 'bg-white/[0.06]'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-500">{choiceCount}/{choiceLabels.length} đáp án đã nghe</span>
                </div>
                {onForceSolve && (
                  <button
                    onClick={onForceSolve}
                    className="px-2.5 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <span>⚡ Giải câu này</span>
                  </button>
                )}
              </div>
            )}
            
            {/* Solving spinner */}
            {isSolving && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                <span className="text-xs text-zinc-400">AI is analyzing the question...</span>
              </div>
            )}
            
            {/* Answer highlight */}
            {isAnswerReady && answer && (
              <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-emerald-500/[0.08] to-emerald-500/[0.03] border border-emerald-500/20">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">
                      {isSuggestion ? 'Gợi ý trả lời' : 'Correct Answer'}
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-emerald-400">
                    {isSuggestion ? '' : answer.answer}
                  </span>
                  {answer.confidence && (
                    <span className="text-[10px] text-zinc-500 ml-auto">
                      {Math.round(answer.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-emerald-300/70">
                  {isSuggestion ? answer.answerText : answer.answer ? question.choices[answer.answer] : ''}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
