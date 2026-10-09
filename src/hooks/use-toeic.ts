'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, MicrophoneState, TOEICQuestion, AIAnswer, SessionHistoryItem } from '@/lib/types';
import { TOEICStateMachine } from '@/lib/state-machine';
import { SpeechService } from '@/lib/speech';
import { AudioCaptureService } from '@/lib/audio-capture';
import { solveQuestion } from '@/lib/ai-client';

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
  runDemoSimulation: () => void;
  
  // Speech available
  isSpeechAvailable: boolean;
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
  const isSpeechAvailable = true;
  
  // Services
  const stateMachineRef = useRef<TOEICStateMachine | null>(null);
  const speechServiceRef = useRef<SpeechService | null>(null);
  const audioCaptureRef = useRef<AudioCaptureService | null>(null);
  const actionVersionRef = useRef(0);
  
  // Initialize services
  useEffect(() => {
    const sm = new TOEICStateMachine();
    const speech = new SpeechService();
    const capture = new AudioCaptureService();

    stateMachineRef.current = sm;
    speechServiceRef.current = speech;
    audioCaptureRef.current = capture;

    // Set up state machine callbacks
    sm.onStateChange((newState, context) => {
      setAppState(newState);
      setCurrentQuestion(context.currentQuestion);
      setCurrentAnswer(context.currentAnswer);
      setHistory([...context.history]);
      setLastError(context.lastError);
    });

    // Set up AI solver
    sm.setSolveCallback(solveQuestion);

    // Set up Universal Audio Capture (Groq Whisper AI + Waveform Level)
    capture.setCallbacks(
      (text) => {
        setTranscript((prev) => {
          const updated = prev ? prev + ' ' + text : text;
          return updated.length > 3000 ? updated.slice(-2500) : updated;
        });
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

    // Web Speech API for fast live interim display
    speech.setCallbacks(
      (text, isFinal) => {
        if (isFinal) {
          // Whisper is the single source of finalized text. Committing the Web
          // Speech result too would duplicate each microphone sentence and make
          // the state machine process the same question twice.
          setInterimTranscript(text);
        } else {
          setInterimTranscript(text);
        }
      },
      (error) => {
        console.warn('WebSpeech note:', error);
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
      speech.stop();
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
    const speech = speechServiceRef.current;
    const sm = stateMachineRef.current;

    if (!sm || !capture) return;

    setLastError(null);

    // Start AudioCapture with mic (Groq Whisper STT + Waveform Level)
    const micOk = await capture.startMicrophone();
    if (!micOk) {
      setMicrophoneState('ERROR');
      return;
    }

    // Also start Web Speech API for live interim display if available
    if (speech && speech.isAvailable()) {
      speech.start();
    }

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
      speechServiceRef.current?.stop();
      setInterimTranscript('');
      setMicrophoneState('CONNECTED');
      sm.start();
    }
  }, []);

  const stopListening = useCallback(async () => {
    const actionVersion = ++actionVersionRef.current;
    const capture = audioCaptureRef.current;

    speechServiceRef.current?.stop();
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
    speechServiceRef.current?.stop();
    stateMachineRef.current?.reset();
    setTranscript('');
    setInterimTranscript('');
    setAudioLevel(0);
    setHistory([]);
    setLastError(null);
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
    setTranscript((prev) => (prev ? prev + ' ' + text : text));
    sm.processTranscript(text);
  }, []);

  const runDemoSimulation = useCallback(() => {
    const sm = stateMachineRef.current;
    if (!sm) return;
    
    // Start listening state
    setAppState('LISTENING');
    sm.start();

    const demoSteps = [
      { text: "Questions 71 through 73 refer to the following announcement.", delay: 300 },
      { text: "Good afternoon, all employees. Please be advised that the main office building will undergo annual maintenance this Saturday.", delay: 1800 },
      { text: "The power and internet will be shut off from 8:00 AM to 5:00 PM.", delay: 3600 },
      { text: "Therefore, all staff members who plan to work over the weekend should work remotely from home.", delay: 5500 },
      { text: "Number 71. What is the purpose of the announcement?", delay: 7500 },
      { text: "Number 72. When will the maintenance take place?", delay: 10500 },
      { text: "Number 73. What are employees advised to do?", delay: 13500 },
    ];

    demoSteps.forEach(({ text, delay }) => {
      setTimeout(() => {
        setTranscript((prev) => (prev ? prev + ' ' + text : text));
        sm.processTranscript(text);
      }, delay);
    });
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
    runDemoSimulation,
    isSpeechAvailable,
  };
}
