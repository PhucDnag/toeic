'use client';

import { useTOEIC } from '@/hooks/use-toeic';
import Header from '@/components/Header';
import AudioWaveform from '@/components/AudioWaveform';
import LiveTranscript from '@/components/LiveTranscript';
import QuestionCard from '@/components/QuestionCard';
import AIExplanation from '@/components/AIExplanation';
import SessionHistory from '@/components/SessionHistory';
import StartScreen from '@/components/StartScreen';

export default function Home() {
  const {
    appState,
    microphoneState,
    audioLevel,
    transcript,
    interimTranscript,
    currentQuestion,
    currentAnswer,
    history,
    lastError,
    startListening,
    startTabAudioListening,
    stopListening,
    reset,
    clearError,
    forceSolve,
    feedTranscript,
    runDemoSimulation,
    isSpeechAvailable,
  } = useTOEIC();

  const isActive = appState !== 'IDLE';
  const isListening =
    appState === 'LISTENING' ||
    appState === 'QUESTION_DETECTED' ||
    appState === 'WAITING_FOR_CHOICES';

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-zinc-950 text-white xl:h-dvh xl:overflow-hidden">
      {/* Background ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute left-1/4 top-0 h-[min(600px,80vw)] w-[min(600px,80vw)] rounded-full bg-violet-500/[0.03] blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 h-[min(500px,70vw)] w-[min(500px,70vw)] rounded-full bg-blue-500/[0.03] blur-[100px]" />
      </div>

      {/* Header */}
      <Header
        microphoneState={microphoneState}
        appState={appState}
      />

      {/* Main Content */}
      <main className="relative flex min-h-0 flex-1 flex-col xl:overflow-hidden">
        {/* Error Banner */}
        {lastError && appState !== 'IDLE' && (
          <div className="relative z-10 flex items-start justify-between gap-3 border-b border-red-500/20 bg-red-500/10 px-4 py-2.5 sm:items-center sm:px-6">
            <p className="min-w-0 text-sm text-red-400">{lastError}</p>
            <button
              onClick={clearError}
              className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* IDLE State — Start Screen */}
        {!isActive && (
          <StartScreen
            onStart={startListening}
            onStartTabAudio={startTabAudioListening}
            onDemo={runDemoSimulation}
            isSpeechAvailable={isSpeechAvailable}
            lastError={lastError}
          />
        )}

        {/* Active State — Dashboard */}
        {isActive && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Waveform Bar */}
            <div className="border-b border-white/[0.04] px-3 py-2 sm:px-6 sm:py-3">
              <AudioWaveform audioLevel={audioLevel} isActive={isListening} />
            </div>

            {/* Three-panel layout */}
            <div className="grid flex-1 grid-cols-1 md:grid-cols-2 xl:min-h-0 xl:grid-cols-[minmax(260px,320px)_minmax(420px,1fr)_minmax(280px,340px)] xl:overflow-hidden">
              {/* Left — Transcript + History */}
              <section className="flex min-h-[34rem] min-w-0 flex-col border-b border-white/[0.04] md:min-h-[38rem] md:border-r xl:min-h-0 xl:border-b-0">
                {/* Transcript */}
                <div className="min-h-80 flex-1 overflow-hidden">
                  <LiveTranscript
                    transcript={transcript}
                    interimTranscript={interimTranscript}
                    isListening={isListening}
                    onFeedText={feedTranscript}
                    onRunDemo={runDemoSimulation}
                  />
                </div>
                {/* History — Bottom of left panel */}
                <div className="h-52 shrink-0 overflow-hidden border-t border-white/[0.04]">
                  <SessionHistory history={history} />
                </div>
              </section>

              {/* Center — Question */}
              <section className="min-h-[38rem] min-w-0 overflow-hidden border-b border-white/[0.04] xl:min-h-0 xl:border-b-0 xl:border-r">
                <QuestionCard
                  appState={appState}
                  question={currentQuestion}
                  answer={currentAnswer}
                  onForceSolve={forceSolve}
                />
              </section>

              {/* Right — Explanation */}
              <section className="min-h-96 min-w-0 overflow-hidden border-b border-white/[0.04] md:col-span-2 xl:col-span-1 xl:min-h-0 xl:border-b-0">
                <AIExplanation
                  answer={currentAnswer}
                  isReady={appState === 'ANSWER_READY'}
                />
              </section>
            </div>

            {/* Bottom Controls */}
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.04] bg-zinc-950/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6 xl:relative xl:shrink-0">
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <span className="text-xs text-zinc-500">
                  {history.length} question{history.length !== 1 ? 's' : ''} answered
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={reset}
                  className="flex-1 rounded-lg border border-transparent px-3 py-2 text-xs text-zinc-500 transition-all hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-zinc-300 sm:flex-none sm:py-1.5"
                >
                  Reset Session
                </button>
                <button
                  onClick={stopListening}
                  className="flex-1 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 sm:flex-none sm:py-1.5"
                >
                  Stop Listening
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
