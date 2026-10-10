// ===== TOEIC State Machine =====
// Manages the application state transitions and question detection pipeline

import {
  AppState,
  TOEICQuestion,
  AIAnswer,
  SessionHistoryItem,
  PassageBuffer,
} from './types';
import {
  questionMarkers,
  detectQuestionText,
  detectPassageHeader,
  detectTOEICPart,
  extractChoices,
  getRequiredChoiceLetters,
  hasRequiredChoices,
  inferTOEICPart,
} from './toeic-detector';
import { GROUP_HEADER, listeningGroupStart, listeningMarkers, normalizeListeningNumbers } from './listening-groups';
import { QUESTIONS_PER_CLEANUP, trimTranscript } from './transcript-window';

export type StateChangeCallback = (
  newState: AppState,
  context: StateMachineContext
) => void;

export interface StateMachineContext {
  appState: AppState;
  currentQuestion: TOEICQuestion | null;
  currentAnswer: AIAnswer | null;
  currentPassage: PassageBuffer | null;
  history: SessionHistoryItem[];
  processedQuestions: Set<number>;
  transcriptBuffer: string;
  lastError: string | null;
}

export class TOEICStateMachine {
  private context: StateMachineContext;
  private listeners: StateChangeCallback[] = [];
  private solveCallback: ((question: TOEICQuestion) => Promise<AIAnswer>) | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private questionDetectionBuffer = '';
  private deferredTranscriptBuffer = '';
  private currentPart: 2 | 3 | 4 | undefined;
  private sessionVersion = 0;
  private completedSinceCleanup = 0;
  private transcriptCleanupCallback: ((remainingText: string) => void) | null = null;
  
  // Debounce tracking
  private lastDetectedQuestionNum: number | null = null;
  private lastChoiceCount = 0;
  
  constructor() {
    this.context = {
      appState: 'IDLE',
      currentQuestion: null,
      currentAnswer: null,
      currentPassage: null,
      history: [],
      processedQuestions: new Set(),
      transcriptBuffer: '',
      lastError: null,
    };
  }
  
  // ===== Event Subscription =====
  
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }
  
  setSolveCallback(callback: (question: TOEICQuestion) => Promise<AIAnswer>) {
    this.solveCallback = callback;
  }

  setTranscriptCleanupCallback(callback: (remainingText: string) => void) {
    this.transcriptCleanupCallback = callback;
  }

  private compactCompletedTranscript() {
    if (++this.completedSinceCleanup < QUESTIONS_PER_CLEANUP) return;
    this.completedSinceCleanup = 0;
    // Only discard completed text. Pending audio/text, duplicate-number guards,
    // answer history and the active group's passage must survive maintenance.
    const remaining = [this.questionDetectionBuffer, this.deferredTranscriptBuffer].filter(Boolean).join(' ').trim();
    this.context.transcriptBuffer = trimTranscript(remaining);
    this.transcriptCleanupCallback?.(this.context.transcriptBuffer);
  }
  
  private emit() {
    for (const listener of this.listeners) {
      listener(this.context.appState, { ...this.context });
    }
  }
  
  // ===== State Transitions =====
  
  private setState(newState: AppState) {
    if (this.context.appState !== newState) {
      this.context.appState = newState;
      this.emit();
    }
  }
  
  // ===== Public API =====
  
  getContext(): StateMachineContext {
    return { ...this.context };
  }
  
  start() {
    this.sessionVersion++;
    this.completedSinceCleanup = 0;
    this.clearAutoSolve();
    this.context.currentPassage = null;
    this.context.currentQuestion = null;
    this.context.currentAnswer = null;
    this.context.processedQuestions.clear();
    this.lastDetectedQuestionNum = null;
    this.lastChoiceCount = 0;
    this.setState('LISTENING');
    this.context.transcriptBuffer = '';
    this.questionDetectionBuffer = '';
    this.deferredTranscriptBuffer = '';
    this.currentPart = undefined;
    this.emit();
  }
  
  private autoSolveTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleAutoSolve(delayMs = 6000) {
    if (this.autoSolveTimer) {
      clearTimeout(this.autoSolveTimer);
    }
    this.autoSolveTimer = setTimeout(() => {
      this.autoSolveTimer = null;
      if (
        this.context.currentQuestion &&
        (this.context.appState === 'QUESTION_DETECTED' ||
          this.context.appState === 'WAITING_FOR_CHOICES')
      ) {
        this.handleQuestionComplete();
      }
    }, delayMs);
  }

  private clearAutoSolve() {
    if (this.autoSolveTimer) {
      clearTimeout(this.autoSolveTimer);
      this.autoSolveTimer = null;
    }
  }

  stop() {
    this.sessionVersion++;
    this.setState('IDLE');
    this.clearAutoSolve();
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.emit();
  }

  setError(error: string) {
    this.context.lastError = error;
    this.setState('ERROR');
  }

  clearError() {
    this.context.lastError = null;
    if (this.context.appState === 'ERROR') {
      this.setState('LISTENING');
    }
  }

  /**
   * Process a new finalized transcript segment.
   * This is the main entry point called by the speech recognition system.
   */
  processTranscript(finalText: string) {
    if (this.context.appState === 'IDLE') return;

    // Add to buffer
    this.context.transcriptBuffer = trimTranscript(this.context.transcriptBuffer + ' ' + finalText);

    // Never drop audio that arrives while the preceding question is being
    // solved or displayed. Replay it as soon as the machine resumes listening.
    if (
      this.context.appState === 'QUESTION_COMPLETE' ||
      this.context.appState === 'SOLVING' ||
      this.context.appState === 'ANSWER_READY' ||
      (this.context.appState === 'ERROR' && !!this.context.currentQuestion)
    ) {
      this.deferredTranscriptBuffer += ' ' + finalText;
      if (this.context.appState === 'ANSWER_READY') this.resumeListening();
      return;
    }

    this.questionDetectionBuffer += ' ' + finalText;

    // Run detection pipeline
    this.runDetection();
  }

  private runDetection() {
    const buffer = normalizeListeningNumbers(this.questionDetectionBuffer.trim());
    if (!buffer) return;

    this.currentPart = detectTOEICPart(buffer) || this.currentPart;

    const firstMarker = questionMarkers(buffer).find(m => !this.context.processedQuestions.has(m.number));
    if ((!firstMarker || firstMarker.number >= 32) && (this.currentPart === 3 || this.currentPart === 4 ||
        listeningMarkers(buffer).length > 0 ||
        (detectPassageHeader(buffer)?.start || Number(buffer.match(GROUP_HEADER)?.[1]) || 0) >= 32)) {
      this.runListeningGroupDetection(buffer);
      return;
    }

    this.runPartTwoDetection(buffer);
  }

  private runPartTwoDetection(buffer: string) {
    const markers = questionMarkers(buffer);
    const firstIndex = markers.findIndex(m => !this.context.processedQuestions.has(m.number));
    if (firstIndex < 0) {
      // Retain enough text for a number split across chunks, without retaining
      // minutes of unnumbered noise after the previous Part 2 question.
      this.questionDetectionBuffer = buffer.slice(-512);
      return;
    }
    const first = markers[firstIndex];
    if (first.number > 31) return;
    const next = markers.slice(firstIndex + 1).find(m => m.number !== first.number);
    const header = buffer.match(GROUP_HEADER);
    const boundary = Math.min(next?.start ?? buffer.length, header?.index ?? buffer.length);
    const segment = buffer.slice(first.start, boundary);
    const text = detectQuestionText(segment, first.number) || '';
    const choices = extractChoices(segment, first.number);
    const previous = this.context.currentQuestion;
    const questionChanged = previous?.questionNumber !== first.number || previous.questionText !== text ||
      getRequiredChoiceLetters(2).some(letter => previous.choices[letter] !== choices[letter]);
    this.currentPart = 2;
    this.context.currentQuestion = {
      questionNumber: first.number, questionText: text, choices, passage: '', part: 2,
    };
    this.context.currentAnswer = null;
    this.context.lastError = null;
    this.questionDetectionBuffer = buffer.slice(first.start);
    this.setState(hasRequiredChoices(choices, 2) ? 'QUESTION_DETECTED' : 'WAITING_FOR_CHOICES');
    this.emit();

    if (boundary < buffer.length) {
      // Preserve every subsequent question before completion clears the buffer.
      this.deferredTranscriptBuffer = buffer.slice(boundary) + ' ' + this.deferredTranscriptBuffer;
      if (text) {
        void this.handleQuestionComplete();
      } else {
        // A number-only / corrupt question must never block the next real one.
        this.context.history.push({ questionNumber: first.number, timestamp: Date.now() });
        this.context.processedQuestions.add(first.number);
        this.clearAutoSolve();
        this.questionDetectionBuffer = '';
        this.compactCompletedTranscript();
        this.resumeListening();
      }
      return;
    }
    if (!text) return;
    if (hasRequiredChoices(choices, 2) && /[.!?]["'’”]?$/.test(choices.C!.trim())) {
      void this.handleQuestionComplete();
    } else if (questionChanged || !this.autoSolveTimer) {
      // Repeated labels/noise are not progress. Do not let them continually
      // restart the deadline while waiting for a response the mic missed.
      this.scheduleAutoSolve(hasRequiredChoices(choices, 2) ? 1200 : 6000);
    }
  }

  private runListeningGroupDetection(source: string) {
    let buffer = source;
    let markers = listeningMarkers(buffer);
    const header = buffer.match(GROUP_HEADER);
    if (header && (!markers.length || header.index! < markers[0].start)) {
      const start = Number(header[1]);
      const end = Number(header[2]);
      if (start >= 32 && end <= 100 && end === start + 2) {
        this.currentPart = inferTOEICPart(start);
        this.context.currentPassage = {
          id: `passage-${start}-${end}`, text: '',
          questionRange: { start, end }, part: this.currentPart, timestamp: Date.now(),
        };
        buffer = buffer.slice(header.index! + header[0].length).trim();
        this.questionDetectionBuffer = buffer;
        markers = listeningMarkers(buffer);
        this.emit();
      }
    }
    if (!markers.length) return; // Keep the entire talk until its first question.

    const marker = markers[0];
    if (this.context.processedQuestions.has(marker.number)) {
      const next = markers[1];
      if (next) {
        this.questionDetectionBuffer = buffer.slice(next.start);
        this.runDetection();
      }
      return;
    }
    const start = listeningGroupStart(marker.number);
    const prefix = buffer.slice(0, marker.start).trim();
    if (this.context.currentPassage?.questionRange?.start !== start) {
      this.context.currentPassage = {
        id: `passage-${start}-${start + 2}`, text: prefix,
        questionRange: { start, end: start + 2 },
        part: inferTOEICPart(marker.number), timestamp: Date.now(),
      };
    } else if (prefix && ![start, start + 1, start + 2].some(n => this.context.processedQuestions.has(n))) {
      this.context.currentPassage.text = [this.context.currentPassage.text, prefix].filter(Boolean).join(' ');
    }
    this.currentPart = inferTOEICPart(marker.number);
    // Consume the passage prefix once; retain incomplete question text across chunks.
    buffer = buffer.slice(marker.start);
    this.questionDetectionBuffer = buffer;
    markers = listeningMarkers(buffer);
    const first = markers[0];
    const nextHeader = buffer.match(GROUP_HEADER);
    const next = markers.find(m => m.number !== first.number);
    const boundary = Math.min(next?.start ?? buffer.length, nextHeader?.index ?? buffer.length);
    const repeated = markers.filter(m => m.number === first.number && m.start < boundary);
    const last = repeated.at(-1)!;
    // A repeated number from the overlap is not a new question. Prefer the
    // latest nonempty rendering, retaining the first if the repeat is bare.
    const latest = buffer.slice(last.end, boundary).trim();
    const text = latest || buffer.slice(first.end, last.start).trim();
    // A quoted utterance may itself end in '?'; wait for closing quotation and
    // the outer question. Otherwise a numbered boundary or a pause completes it.
    const punctuationEnd = text.endsWith('?');
    this.context.currentQuestion = {
      questionNumber: marker.number, questionText: text, choices: {},
      passage: this.context.currentPassage.text, part: this.currentPart,
    };
    this.context.currentAnswer = null;
    this.setState('QUESTION_DETECTED');
    this.emit();
    if (!text) return;
    if (boundary < buffer.length || punctuationEnd) {
      this.deferredTranscriptBuffer = buffer.slice(boundary) + ' ' + this.deferredTranscriptBuffer;
      void this.handleQuestionComplete();
    } else {
      this.scheduleAutoSolve(2500);
    }
  }

  private async handleQuestionComplete() {
    this.clearAutoSolve();
    if (!this.context.currentQuestion) return;
    if (this.context.appState === 'SOLVING' || this.context.appState === 'ANSWER_READY') return;

    const question = this.context.currentQuestion;
    const sessionVersion = this.sessionVersion;

    // Passage range headers may contain a number but no question. Guard here as
    // well as in the detector so /api/solve never receives an empty question.
    if (!question.questionText.trim()) {
      this.context.lastError = 'Đã nghe thấy số câu nhưng chưa nghe đủ nội dung câu hỏi.';
      this.setState('WAITING_FOR_CHOICES');
      return;
    }

    if (question.part === 2 && !hasRequiredChoices(question.choices, 2)) {
      if (this.deferredTranscriptBuffer.trim()) {
        // The next question has started: record this one as unheard instead of
        // spending an AI request to guess from an incomplete set of responses.
        this.context.processedQuestions.add(question.questionNumber);
        this.context.history.push({ questionNumber: question.questionNumber, timestamp: Date.now() });
        this.questionDetectionBuffer = '';
        this.compactCompletedTranscript();
        this.resumeListening();
      } else {
        // Keep listening: C may arrive in the next transcription window.
        this.context.lastError = 'Chưa nghe đủ A/B/C. Đang chờ phần còn lại của câu.';
        this.setState('WAITING_FOR_CHOICES');
        this.emit();
      }
      return;
    }

    // Mark as processed to prevent re-solving
    this.context.processedQuestions.add(question.questionNumber);

    this.setState('QUESTION_COMPLETE');

    // Clear detection buffer for next question
    this.questionDetectionBuffer = '';

    this.setState('SOLVING');
    
    // Call AI solver
    if (this.solveCallback) {
      let solveTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const answer = await Promise.race([
          this.solveCallback(question),
          new Promise<AIAnswer>((_, reject) => {
            solveTimeout = setTimeout(() => reject(new Error('AI solve timeout')), 30000);
          }),
        ]);
        clearTimeout(solveTimeout);
        if (sessionVersion !== this.sessionVersion) return;
        this.context.currentAnswer = answer;
        
        // Add to history
        this.context.history.push({
          questionNumber: question.questionNumber,
          answer: answer.answer,
          answerText: answer.answerText || (answer.answer ? question.choices[answer.answer] : undefined),
          timestamp: Date.now(),
        });
        this.compactCompletedTranscript();
        
        this.setState('ANSWER_READY');

        // Start the next queued question immediately. Answer display must not
        // add 2.5 seconds to every question while incoming audio backs up.
        if (this.deferredTranscriptBuffer.trim()) {
          this.resumeListening();
          return;
        }
        
        // Briefly show the answer, then replay everything heard while solving.
        setTimeout(() => {
          if (sessionVersion === this.sessionVersion && this.context.appState === 'ANSWER_READY') {
            this.resumeListening();
          }
        }, 2500);
        
      } catch (error) {
        clearTimeout(solveTimeout);
        if (sessionVersion !== this.sessionVersion) return;
        console.error('AI solver error:', error);
        this.context.lastError = 'Unable to analyze this question. Continuing listening...';
        
        // Add to history as unanswered
        this.context.history.push({
          questionNumber: question.questionNumber,
          timestamp: Date.now(),
        });
        this.compactCompletedTranscript();
        
        this.setState('ERROR');
        
        // Auto-recover
        setTimeout(() => {
          if (sessionVersion !== this.sessionVersion) return;
          this.context.lastError = null;
          this.resumeListening();
        }, 3000);
      }
    }
  }
  
  /**
   * Manually trigger solving for the current question (e.g., if user clicks a button).
   */
  forceSolve() {
    if (this.context.currentQuestion) {
      this.handleQuestionComplete();
    }
  }

  private resumeListening() {
    this.lastDetectedQuestionNum = null;
    this.lastChoiceCount = 0;
    this.context.currentQuestion = null;
    this.context.currentAnswer = null;
    this.setState('LISTENING');

    const deferred = this.deferredTranscriptBuffer.trim();
    this.deferredTranscriptBuffer = '';
    if (deferred) {
      this.questionDetectionBuffer = deferred;
      this.runDetection();
    }
  }
  
  /**
   * Reset the session
   */
  reset() {
    this.sessionVersion++;
    this.completedSinceCleanup = 0;
    this.context = {
      appState: 'IDLE',
      currentQuestion: null,
      currentAnswer: null,
      currentPassage: null,
      history: [],
      processedQuestions: new Set(),
      transcriptBuffer: '',
      lastError: null,
    };
    this.lastDetectedQuestionNum = null;
    this.lastChoiceCount = 0;
    this.questionDetectionBuffer = '';
    this.deferredTranscriptBuffer = '';
    this.currentPart = undefined;
    this.clearAutoSolve();
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.emit();
  }
}

// Singleton instance
let stateMachineInstance: TOEICStateMachine | null = null;

export function getStateMachine(): TOEICStateMachine {
  if (!stateMachineInstance) {
    stateMachineInstance = new TOEICStateMachine();
  }
  return stateMachineInstance;
}
