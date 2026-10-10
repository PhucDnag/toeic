'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, MicrophoneState, TOEICQuestion, AIAnswer, SessionHistoryItem } from '@/lib/types';
import { TOEICStateMachine } from '@/lib/state-machine';
import { AudioCaptureService } from '@/lib/audio-capture';
import { solveQuestion } from '@/lib/ai-client';
import { trimTranscript } from '@/lib/transcript-window';

export interface UseTOEICReturn {
  // State
  appState: AppState;
  microphoneState: MicrophoneState;
  audioLevel: number;
  
  // Transcript
  transcript: string;
  interimTranscript: string;
  
  // Current question
  currentQuestion: TOEICQuestion | null;
  currentAnswer: AIAnswer | null;
  
  // History
  history: SessionHistoryItem[];
  
  // Errors
  lastError: string | null;
  
  // Actions
  startListening: () => Promise<void>;
  startTabAudioListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  reset: () => void;
  clearError: () => void;
  forceSolve: () => void;
  feedTranscript: (text: string) => void;
}

export function useTOEIC(): UseTOEICReturn {
  // State
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>('NOT_CONNECTED');
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<TOEICQuestion | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState<AIAnswer | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  
  // Services
  const stateMachineRef = useRef<TOEICStateMachine | null>(null);
  const audioCaptureRef = useRef<AudioCaptureService | null>(null);
  const actionVersionRef = useRef(0);
  
  // Initialize services
  useEffect(() => {
    const sm = new TOEICStateMachine();
    const capture = new AudioCaptureService();

    stateMachineRef.current = sm;
    audioCaptureRef.current = capture;

    let lastResult: { question: TOEICQuestion; answer: AIAnswer } | null = null;
    sm.setTranscriptCleanupCallback(remainingText => {
      setTranscript(remainingText);
      setInterimTranscript('');
    });

    // Set up state machine callbacks
    sm.onStateChange((newState, context) => {
      if (newState === 'IDLE') lastResult = null;
      if (newState === 'ANSWER_READY' && context.currentQuestion && context.currentAnswer) {
        lastResult = { question: context.currentQuestion, answer: context.currentAnswer };
      }
      const displayedResult = newState === 'LISTENING' && !context.currentQuestion ? lastResult : null;
      setAppState(newState);
      setCurrentQuestion(displayedResult?.question ?? context.currentQuestion);
      setCurrentAnswer(displayedResult?.answer ?? context.currentAnswer);
      setHistory([...context.history]);
      setLastError(context.lastError);
    });

    // Set up AI solver
    sm.setSolveCallback(solveQuestion);

    // Set up Universal Audio Capture (Groq Whisper AI + Waveform Level)
    capture.setCallbacks(
      (text) => {
        setTranscript(prev => trimTranscript(prev + ' ' + text));
        setInterimTranscript('');
        sm.processTranscript(text);
      },
      (level) => {
        setAudioLevel(level);
      },
      (error) => {
        setLastError(error);
      }
    );

    // Load history from localStorage
    try {
      const saved = localStorage.getItem('toeic_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.history)) {
          setHistory(parsed.history);
        }
      }
    } catch { /* ignore */ }

    return () => {
      void capture.stop(false);
      sm.stop();
    };
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('toeic_session', JSON.stringify({ history }));
    } catch { /* ignore */ }
  }, [history]);

  // Actions
  const startListening = useCallback(async () => {
    actionVersionRef.current++;
    const capture = audioCaptureRef.current;
    const sm = stateMachineRef.current;

    if (!sm || !capture) return;

    setLastError(null);

    // Start AudioCapture with mic (Groq Whisper STT + Waveform Level)
    const micOk = await capture.startMicrophone();
    if (!micOk) {
      setMicrophoneState('ERROR');
      return;
    }

    // Use a single mic consumer with explicit audio constraints. Web Speech
    // opens another input with browser-controlled processing, which can suppress
    // speaker playback on devices that share their microphone processing.

    setMicrophoneState('CONNECTED');
    sm.start();
  }, []);

  const startTabAudioListening = useCallback(async () => {
    actionVersionRef.current++;
    const capture = audioCaptureRef.current;
    const sm = stateMachineRef.current;

    if (!capture || !sm) return;

    setLastError(null);
    const success = await capture.startDisplayMedia();
    if (success) {
      setInterimTranscript('');
      setMicrophoneState('CONNECTED');
      sm.start();
    }
  }, []);

  const stopListening = useCallback(async () => {
    const actionVersion = ++actionVersionRef.current;
    const capture = audioCaptureRef.current;

    setInterimTranscript('');
    setAudioLevel(0);
    setMicrophoneState('NOT_CONNECTED');

    await capture?.stop();
    if (actionVersion === actionVersionRef.current) {
      stateMachineRef.current?.stop();
    }
  }, []);

  const reset = useCallback(() => {
    actionVersionRef.current++;
    void audioCaptureRef.current?.stop(false);
    stateMachineRef.current?.reset();
    setTranscript('');
    setInterimTranscript('');
    setAudioLevel(0);
    setHistory([]);
    setLastError(null);
    setMicrophoneState('NOT_CONNECTED');
    try {
      localStorage.removeItem('toeic_session');
    } catch { /* ignore */ }
  }, []);

  const clearError = useCallback(() => {
    setLastError(null);
    stateMachineRef.current?.clearError();
  }, []);

  const forceSolve = useCallback(() => {
    stateMachineRef.current?.forceSolve();
  }, []);

  const feedTranscript = useCallback((text: string) => {
    const sm = stateMachineRef.current;
    if (!sm) return;
    setTranscript(prev => trimTranscript(prev + ' ' + text));
    sm.processTranscript(text);
  }, []);

  return {
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
  };
}
