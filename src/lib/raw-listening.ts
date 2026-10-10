import { AIAnswer, AppState, SessionHistoryItem, TOEICQuestion } from './types';

export interface ListeningResult {
  consumed_text: string;
  answers: Array<{
    part?: 2 | 3 | 4;
    responses?: string[];
    question_number: number | null;
    question: string;
    answer_text: string;
    confidence: number;
    reason: string;
    translation: string;
  }>;
}

type Solver = (transcript: string, context: string, signal: AbortSignal) => Promise<ListeningResult>;

/** The model segments raw speech. No numbered-question or A/B/C parser gates it. */
export class RawListeningSession {
  private active = false;
  private version = 0;
  private revision = 0;
  private retryUntil = 0;
  private settled: Array<() => void> = [];
  private buffer = '';
  private context = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private solver: Solver | null = null;
  private listener: ((state: AppState, context: {
    currentQuestion: TOEICQuestion | null; currentAnswer: AIAnswer | null;
    history: SessionHistoryItem[]; lastError: string | null;
  }) => void) | null = null;
  private question: TOEICQuestion | null = null;
  private answer: AIAnswer | null = null;
  private history: SessionHistoryItem[] = [];
  private answered = new Map<string, number>();
  private error: string | null = null;

  onStateChange(listener: NonNullable<RawListeningSession['listener']>) { this.listener = listener; }
  setSolveCallback(solver: Solver) { this.solver = solver; }
  private emit(state: AppState) {
    this.listener?.(state, { currentQuestion: this.question, currentAnswer: this.answer, history: this.history, lastError: this.error });
  }
  start() {
    this.stop();
    this.active = true;
    this.buffer = '';
    this.context = '';
    this.answered.clear();
    this.question = null;
    this.answer = null;
    this.error = null;
    this.emit('LISTENING');
  }
  stop() {
    this.active = false;
    this.version++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retryUntil = 0;
    this.request?.abort();
    this.request = null;
    this.settled.splice(0).forEach(resolve => resolve());
    this.emit('IDLE');
  }
  reset() {
    this.stop();
    this.buffer = this.context = '';
    this.history = [];
    this.answered.clear();
    this.question = null;
    this.answer = null;
    this.error = null;
    this.emit('IDLE');
  }
  clearError() { this.error = null; this.emit(this.active ? (this.answer ? 'ANSWER_READY' : 'LISTENING') : 'IDLE'); }
  processTranscript(text: string) {
    if (!this.active || !text.trim()) return;
    this.buffer = [this.buffer, text.trim()].filter(Boolean).join(' ');
    this.revision++;
    // One request at a time; speech arriving during it is retained verbatim.
    if (!this.request && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.analyze(); }, 250);
  }
  forceSolve() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.analyze();
  }
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.request) await new Promise<void>(resolve => this.settled.push(resolve));
    if (!this.request) await this.analyze();
  }
  private async analyze() {
    if (!this.active || this.request || !this.buffer || !this.solver) return;
    if (Date.now() < this.retryUntil) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.analyze(); }, this.retryUntil - Date.now());
      return;
    }
    const snapshot = this.buffer.slice(0, 24000);
    const bufferedLength = this.buffer.length;
    const version = this.version;
    const revision = this.revision;
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.emit(this.answer ? 'ANSWER_READY' : 'SOLVING');
    let consumed = 0;
    try {
      const result = await this.solver(snapshot, this.context, controller.signal);
      if (version !== this.version) return;
      if ((result.answers.length > 0 && !result.consumed_text) ||
        (result.consumed_text && !snapshot.startsWith(result.consumed_text))) {
        throw new Error('AI returned an invalid transcript boundary');
      }
      this.error = null;
      if (result.consumed_text) {
        consumed = result.consumed_text.length;
        this.buffer = this.buffer.slice(result.consumed_text.length).trimStart();
        this.context = `${this.context} ${result.consumed_text}`.trim().slice(-12000);
      }
      for (const item of result.answers) {
        // A replay or model correction updates the same answer, not another
        // history row. Different questions may legitimately share an answer.
        const identity = item.question_number !== null ? `number:${item.question_number}` :
          `text:${item.question.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()}`;
        const existingIndex = this.answered.get(identity);
        const number = existingIndex !== undefined ? this.history[existingIndex].questionNumber :
          item.question_number ?? (this.history.at(-1)?.questionNumber ?? 0) + 1;
        const historyItem = { questionNumber: number, answerText: item.answer_text, confidence: item.confidence, timestamp: Date.now() };
        if (existingIndex !== undefined) {
          const previous = this.history[existingIndex];
          if (previous.answerText === item.answer_text || (previous.confidence ?? 0) > item.confidence) continue;
          this.history[existingIndex] = historyItem;
          if (existingIndex !== this.history.length - 1) continue;
        } else {
          this.answered.set(identity, this.history.length);
          this.history.push(historyItem);
        }
        this.question = { questionNumber: number, questionText: item.question, choices: {} };
        this.answer = { questionNumber: number, answer: null, answerText: item.answer_text,
          confidence: item.confidence, reason: item.reason, translation: item.translation,
          questionType: '', vocabulary: [] };
      }
      this.emit(this.answer ? 'ANSWER_READY' : 'LISTENING');
    } catch (error) {
      if (version !== this.version) return;
      const retryAfterMs = error && typeof error === 'object' && 'retryAfterMs' in error ? Number(error.retryAfterMs) : 0;
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        this.retryUntil = Date.now() + retryAfterMs;
        this.timer = setTimeout(() => { this.timer = null; void this.analyze(); }, retryAfterMs);
        this.error = 'Các key Groq đang bận. Đoạn nghe được giữ và sẽ tự thử lại khi hết thời gian chờ.';
      } else {
        this.error = 'Chưa phân tích được đoạn nghe. Nội dung vẫn được giữ; bấm Thử lại hoặc tiếp tục nghe.';
      }
      this.emit(this.answer ? 'ANSWER_READY' : 'ERROR');
    } finally {
      clearTimeout(timeout);
      if (version === this.version) {
        this.request = null;
        // Do not poll an unchanged incomplete sentence. New speech triggers a
        // fresh pass immediately, without an answer-display timeout.
        this.settled.splice(0).forEach(resolve => resolve());
        if (this.buffer && (revision !== this.revision || (consumed > 0 && bufferedLength > snapshot.length))) this.forceSolve();
      }
    }
  }
}
