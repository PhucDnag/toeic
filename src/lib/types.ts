// ===== Application State Machine =====

export type AppState =
  | 'IDLE'
  | 'LISTENING'
  | 'QUESTION_DETECTED'
  | 'WAITING_FOR_CHOICES'
  | 'QUESTION_COMPLETE'
  | 'SOLVING'
  | 'ANSWER_READY'
  | 'ERROR';

export type MicrophoneState =
  | 'NOT_CONNECTED'
  | 'REQUESTING'
  | 'CONNECTED'
  | 'ERROR';

// ===== TOEIC Data Structures =====

export interface TOEICChoices {
  A?: string;
  B?: string;
  C?: string;
  D?: string;
}

export interface TOEICQuestion {
  questionNumber: number;
  questionText: string;
  choices: TOEICChoices;
  passage?: string;
  part?: TOEICListeningPart;
}

export type TOEICListeningPart = 2 | 3 | 4;

export interface AIAnswer {
  questionNumber: number;
  answer: 'A' | 'B' | 'C' | 'D' | null;
  answerText?: string;
  confidence: number;
  questionType: string;
  reason: string;
  translation: string;
  vocabulary: VocabularyItem[];
}

export interface VocabularyItem {
  word: string;
  meaning: string;
}

export interface SessionHistoryItem {
  questionNumber: number;
  answer?: 'A' | 'B' | 'C' | 'D' | null;
  answerText?: string;
  timestamp: number;
  confidence?: number;
}

// ===== Passage Tracking =====

export interface PassageBuffer {
  id: string;
  text: string;
  questionRange?: { start: number; end: number };
  part?: TOEICListeningPart;
  timestamp: number;
}

// ===== Transcript =====

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

// ===== Detection Result =====

export interface DetectionResult {
  type: 'passage_header' | 'question' | 'choice' | 'none';
  questionNumber?: number;
  questionRange?: { start: number; end: number };
  questionText?: string;
  choiceLetter?: 'A' | 'B' | 'C' | 'D';
  choiceText?: string;
  passageType?: string;
  raw: string;
}

// ===== App Store =====

export interface AppStore {
  // State
  appState: AppState;
  microphoneState: MicrophoneState;
  
  // Audio
  audioLevel: number;
  
  // Transcript
  transcript: string;
  interimTranscript: string;
  
  // Current question
  currentQuestion: TOEICQuestion | null;
  currentAnswer: AIAnswer | null;
  currentPassage: PassageBuffer | null;
  
  // History
  history: SessionHistoryItem[];
  
  // Errors
  lastError: string | null;
  
  // Processed questions tracking
  processedQuestions: Set<number>;
}
