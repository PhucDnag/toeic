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
  detectQuestionNumber,
  detectQuestionText,
  detectPassageHeader,
  detectTOEICPart,
  extractChoices,
  getRequiredChoiceLetters,
  hasRequiredChoices,
  inferTOEICPart,
  countChoices,
} from './toeic-detector';
import { GROUP_HEADER, listeningGroupStart, listeningMarkers, normalizeListeningNumbers } from './listening-groups';

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
    this.clearAutoSolve();
    this.context.currentPassage = null;
    this.context.currentQuestion = null;
    this.context.currentAnswer = null;
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
    this.context.transcriptBuffer += ' ' + finalText;

    // Trim buffer to last ~2500 chars to keep context fresh
    if (this.context.transcriptBuffer.length > 2500) {
      this.context.transcriptBuffer = this.context.transcriptBuffer.slice(-2000);
    }

    // Never drop audio that arrives while the preceding question is being
    // solved or displayed. Replay it as soon as the machine resumes listening.
    if (
      this.context.appState === 'QUESTION_COMPLETE' ||
      this.context.appState === 'SOLVING' ||
      this.context.appState === 'ANSWER_READY'
    ) {
      this.deferredTranscriptBuffer += ' ' + finalText;
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

    if (this.currentPart === 3 || this.currentPart === 4 ||
        listeningMarkers(buffer).length > 0 ||
        (detectPassageHeader(buffer)?.start || 0) >= 32) {
      this.runListeningGroupDetection(buffer);
      return;
    }

    // 1. Detect passage headers
    const passageHeader = detectPassageHeader(buffer);
    if (passageHeader) {
      this.context.currentPassage = {
        id: `passage-${passageHeader.start}-${passageHeader.end}`,
        text: '',
        questionRange: { start: passageHeader.start, end: passageHeader.end },
        part: inferTOEICPart(passageHeader.start) || this.currentPart,
        timestamp: Date.now(),
      };
      this.emit();
    }

    // 2. Detect question
    const questionNum = detectQuestionNumber(buffer);
    const questionText = detectQuestionText(
      buffer,
      questionNum || this.context.currentQuestion?.questionNumber
    );

    if (questionNum && !this.context.processedQuestions.has(questionNum)) {
      // If a previous question is pending, complete it before moving to the new one
      if (
        this.context.currentQuestion &&
        this.context.currentQuestion.questionNumber !== questionNum &&
        (this.context.appState === 'QUESTION_DETECTED' || this.context.appState === 'WAITING_FOR_CHOICES')
      ) {
        this.handleQuestionComplete();
        return;
      }

      // New question detected
      if (this.lastDetectedQuestionNum !== questionNum) {
        this.lastDetectedQuestionNum = questionNum;
        this.lastChoiceCount = 0;

        // Use the recent transcript buffer as passage context
        const part = inferTOEICPart(questionNum) || this.currentPart || this.context.currentPassage?.part;
        const passageContext = part === 2 ? '' : this.context.transcriptBuffer.trim();

        this.context.currentQuestion = {
          questionNumber: questionNum,
          questionText: questionText || '',
          choices: {},
          passage: passageContext,
          part,
        };
        this.context.currentAnswer = null;
        this.setState('QUESTION_DETECTED');

        // A number can arrive before the spoken question. Do not call the API
        // until actual question text is available.
        if (questionText) this.scheduleAutoSolve(6000);
      }
    }

    // Update question text if we have a current question
    if (
      this.context.currentQuestion &&
      questionText &&
      questionText.length > (this.context.currentQuestion.questionText?.length || 0)
    ) {
      this.context.currentQuestion.questionText = questionText;
      this.scheduleAutoSolve(6000);
      this.emit();
    }

    // 3. Detect choices
    if (this.context.currentQuestion) {
      const choices = extractChoices(buffer, this.context.currentQuestion.questionNumber);
      const newCount = countChoices(choices);

      if (newCount > this.lastChoiceCount) {
        this.lastChoiceCount = newCount;

        // Merge detected choices
        if (choices.A) this.context.currentQuestion.choices.A = choices.A;
        if (choices.B) this.context.currentQuestion.choices.B = choices.B;
        if (choices.C) this.context.currentQuestion.choices.C = choices.C;
        if (choices.D) this.context.currentQuestion.choices.D = choices.D;

        if (!hasRequiredChoices(
          this.context.currentQuestion.choices,
          this.context.currentQuestion.part
        )) {
          this.setState('WAITING_FOR_CHOICES');
          // Extend timer while choices are still arriving
          this.scheduleAutoSolve(4500);
        }
        this.emit();
      }

      // Part 2 has three responses; Parts 3 and 4 have four choices.
      if (hasRequiredChoices(
        this.context.currentQuestion.choices,
        this.context.currentQuestion.part
      )) {
        this.clearAutoSolve();
        this.handleQuestionComplete();
      }
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
    } else if (prefix) {
      this.context.currentPassage.text = [this.context.currentPassage.text, prefix].filter(Boolean).join(' ');
    }
    this.currentPart = inferTOEICPart(marker.number);
    // Consume the passage prefix once; retain incomplete question text across chunks.
    buffer = buffer.slice(marker.start);
    this.questionDetectionBuffer = buffer;
    markers = listeningMarkers(buffer);
    const first = markers[0];
    const nextHeader = buffer.match(GROUP_HEADER);
    const boundary = Math.min(markers[1]?.start ?? buffer.length, nextHeader?.index ?? buffer.length);
    const text = buffer.slice(first.end, boundary).trim();
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

    // Ensure question has passage context
    if (question.part !== 3 && question.part !== 4 && !question.passage && this.context.transcriptBuffer) {
      question.passage = this.context.transcriptBuffer.trim();
    }

    // Mark as processed to prevent re-solving
    this.context.processedQuestions.add(question.questionNumber);

    this.setState('QUESTION_COMPLETE');

    // Clear detection buffer for next question
    this.questionDetectionBuffer = '';

    // Small delay before solving to ensure stability
    await new Promise((r) => setTimeout(r, 200));
    if (sessionVersion !== this.sessionVersion) return;

    this.setState('SOLVING');
    
    // Call AI solver
    if (this.solveCallback) {
      try {
        const answer = await this.solveCallback(question);
        if (sessionVersion !== this.sessionVersion) return;
        this.context.currentAnswer = answer;
        
        // Add to history
        this.context.history.push({
          questionNumber: question.questionNumber,
          answer: answer.answer,
          answerText: answer.answerText || (answer.answer ? question.choices[answer.answer] : undefined),
          timestamp: Date.now(),
          confidence: answer.confidence,
        });
        
        this.setState('ANSWER_READY');
        
        // Briefly show the answer, then replay everything heard while solving.
        setTimeout(() => {
          if (sessionVersion === this.sessionVersion && this.context.appState === 'ANSWER_READY') {
            this.resumeListening();
          }
        }, 2500);
        
      } catch (error) {
        if (sessionVersion !== this.sessionVersion) return;
        console.error('AI solver error:', error);
        this.context.lastError = 'Unable to analyze this question. Continuing listening...';
        
        // Add to history as unanswered
        this.context.history.push({
          questionNumber: question.questionNumber,
          timestamp: Date.now(),
        });
        
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
      const q = this.context.currentQuestion;
      for (const letter of q.part === 3 || q.part === 4 ? [] : getRequiredChoiceLetters(q.part)) {
        if (!q.choices[letter]) q.choices[letter] = '(not detected)';
      }
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
