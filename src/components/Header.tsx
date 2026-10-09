'use client';

import { AppState, MicrophoneState } from '@/lib/types';

interface HeaderProps {
  microphoneState: MicrophoneState;
  appState: AppState;
  onSettingsClick?: () => void;
}

const micStateLabels: Record<MicrophoneState, string> = {
  NOT_CONNECTED: 'Microphone not connected',
  REQUESTING: 'Requesting permission...',
  CONNECTED: 'Microphone connected',
  ERROR: 'Microphone error',
};

const micStateColors: Record<MicrophoneState, string> = {
  NOT_CONNECTED: 'bg-zinc-500',
  REQUESTING: 'bg-amber-500 animate-pulse',
  CONNECTED: 'bg-emerald-500',
  ERROR: 'bg-red-500',
};

const appStateLabels: Record<AppState, string> = {
  IDLE: 'Ready',
  LISTENING: 'Listening',
  QUESTION_DETECTED: 'Question detected',
  WAITING_FOR_CHOICES: 'Listening to choices',
  QUESTION_COMPLETE: 'Question complete',
  SOLVING: 'Analyzing...',
  ANSWER_READY: 'Answer ready',
  ERROR: 'Error',
};

const appStateColors: Record<AppState, string> = {
  IDLE: 'text-zinc-400',
  LISTENING: 'text-emerald-400',
  QUESTION_DETECTED: 'text-blue-400',
  WAITING_FOR_CHOICES: 'text-blue-400',
  QUESTION_COMPLETE: 'text-violet-400',
  SOLVING: 'text-amber-400',
  ANSWER_READY: 'text-emerald-400',
  ERROR: 'text-red-400',
};

export default function Header({ microphoneState, appState }: HeaderProps) {
  return (
    <header className="relative z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-white/[0.06] bg-zinc-950/80 px-4 py-3 backdrop-blur-xl sm:px-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-x-6 md:py-4">
      {/* Left — Branding */}
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-9 h-9">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20" />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="relative z-10">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-violet-400" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-blue-400" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-violet-300" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xs font-semibold tracking-wide text-white/90 sm:text-sm">
              TOEIC AI LISTENING
            </h1>
            <p className="hidden text-[11px] uppercase tracking-wider text-zinc-500 sm:block">
              Real-time listening assistant
            </p>
          </div>
        </div>
      </div>

      {/* Center — Status */}
      <div className="col-span-2 row-start-2 justify-self-start md:col-span-1 md:col-start-2 md:row-start-1 md:justify-self-center">
        <div className={`flex items-center gap-2 text-xs font-medium tracking-wide ${appStateColors[appState]}`}>
          <span className="relative flex h-2 w-2">
            {appState === 'LISTENING' || appState === 'SOLVING' ? (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
            ) : null}
            <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
          </span>
          <span className="uppercase">{appStateLabels[appState]}</span>
        </div>
      </div>

      {/* Right — Mic Status */}
      <div className="col-start-2 row-start-1 justify-self-end md:col-start-3">
        <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5 sm:px-3">
          <span className={`w-1.5 h-1.5 rounded-full ${micStateColors[microphoneState]}`} />
          <span className="hidden text-xs text-zinc-400 sm:inline">
            {micStateLabels[microphoneState]}
          </span>
        </div>
      </div>
    </header>
  );
}
