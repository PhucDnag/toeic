// ===== AI Solver Client =====
// Calls the server-side API route to solve TOEIC questions

import { TOEICQuestion, AIAnswer } from './types';
import { ListeningResult } from './raw-listening';

export async function solveListeningTranscript(transcript: string, context: string, signal: AbortSignal): Promise<ListeningResult> {
  const response = await fetch('/api/solve', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'raw', transcript, context }),
  });
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    throw Object.assign(new Error('Groq rate limit'), {
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000,
    });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function solveQuestion(question: TOEICQuestion): Promise<AIAnswer> {
  const response = await fetch('/api/solve', {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part: question.part,
      passage: question.passage || '',
      question_number: question.questionNumber,
      question: question.questionText,
      choices: question.choices,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  const data = await response.json();
  
  return {
    questionNumber: data.question_number,
    answer: data.answer as AIAnswer['answer'],
    answerText: data.answer_text,
    confidence: data.confidence,
    questionType: data.question_type,
    reason: data.reason,
    translation: data.translation,
    vocabulary: data.vocabulary || [],
  };
}
