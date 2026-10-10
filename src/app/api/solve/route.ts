import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { inferTOEICPart } from '@/lib/toeic-detector';
import { RAW_LISTENING_PROMPT, validateListeningResult } from '@/lib/raw-listening-response';
import {
  getGroqApiKeys,
  GroqKeyPoolExhaustedError,
  withGroqKeyFailover,
} from '@/lib/server/groq-key-pool';

const SYSTEM_PROMPT = `You are an expert TOEIC teacher and test solver. You will analyze TOEIC listening questions and select the best answer.

Rules:
- For Part 2, choose exactly ONE response from A, B, or C
- For Parts 3 and 4, the audio contains a passage and three spoken questions, WITHOUT answer choices. Return answer: null and answer_text: a concise suggested answer in English based on the passage. NEVER invent a letter or missing choices.
- Part 2 is question-response; Part 3 is conversation; Part 4 is a short talk
- Use the passage/transcript as primary evidence
- If evidence is missing, or the question requires an unseen graphic, say that the information is insufficient in answer_text and the explanation, with low confidence. Do not invent facts.
- Identify common TOEIC traps (e.g., distractors that repeat words but change meaning)
- Keep explanations SHORT and clear (2-3 sentences max)
- Use simple English (approximately IELTS 5.0 vocabulary)
- Provide Vietnamese translation of the explanation
- Provide 2-5 useful vocabulary items with Vietnamese meaning
- Respond ONLY in the exact JSON format specified

Respond in this exact JSON format:
{
  "question_number": <number>,
  "answer": "<A|B|C for Part 2; null for Part 3/4>",
  "answer_text": "<suggested answer for Part 3/4; selected response for Part 2>",
  "confidence": <0.0-1.0>,
  "question_type": "<purpose|detail|inference|suggestion|action|location|time|person>",
  "reason": "<short English explanation>",
  "translation": "<Vietnamese translation of the explanation>",
  "vocabulary": [
    {"word": "<English word>", "meaning": "<Vietnamese meaning>"}
  ]
}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawMode = body.mode === 'raw';
    const rawTranscript = typeof body.transcript === 'string' ? body.transcript : '';
    if (rawMode && (!rawTranscript.trim() || rawTranscript.length > 30000)) {
      return NextResponse.json({ error: 'Invalid transcript length' }, { status: 400 });
    }

    const { part, passage, question_number, question, choices } = body;
    const normalizedPassage = typeof passage === 'string' ? passage.trim() : '';
    const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
    const detectedPart = part || inferTOEICPart(Number(question_number));
    const isSuggestion = detectedPart === 3 || detectedPart === 4;

    if (!rawMode && !normalizedQuestion && !normalizedPassage) {
      return NextResponse.json(
        { error: 'Missing question and transcript' },
        { status: 400 }
      );
    }

    const safeChoices = choices || {};

    const hasGroqKeys = getGroqApiKeys().length > 0;

    if (!hasGroqKeys) {
      return NextResponse.json(
        {
          error:
            'Chưa cấu hình GROQ_API_KEY/GROQ_API_KEYS trong .env.local',
        },
        { status: 500 }
      );
    }

    // Build the user prompt
    let userPrompt = '';

    if (normalizedPassage) {
      userPrompt += `PASSAGE/TRANSCRIPT:\n${normalizedPassage}\n\n`;
    }

    if (detectedPart) {
      userPrompt += `TOEIC Part: ${detectedPart}\n`;
    }

    userPrompt += `Question ${question_number || ''}:\n${normalizedQuestion || '(Infer the current spoken question from the transcript.)'}\n\n`;
    if (!isSuggestion) {
    userPrompt += `A. ${safeChoices.A || '(not provided)'}\n`;
    userPrompt += `B. ${safeChoices.B || '(not provided)'}\n`;
    userPrompt += `C. ${safeChoices.C || '(not provided)'}\n`;
    if (detectedPart !== 2) {
      userPrompt += `D. ${safeChoices.D || '(not provided)'}\n`;
    }
    } else {
      userPrompt += '\nNo answer choices are available. Suggest the answer CONTENT to this question using only the passage. Set answer to null. If the passage is missing or insufficient, explicitly say so.\n';
    }
    userPrompt += `\nAnalyze the question against the passage and select the best answer. Respond in JSON only.`;
    if (rawMode) {
      userPrompt = JSON.stringify({
        'PREVIOUS CONTEXT (already processed; do not answer again)': typeof body.context === 'string' ? body.context.slice(-12000) : '',
        'NEW TRANSCRIPT': rawTranscript,
      });
    }

    let content: string | null = null;
    let lastError: unknown;
    const cooldowns: number[] = [];
    // Exhaust available keys for a model before trying another Groq model.
    for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile']) {
      try {
        content = await withGroqKeyFailover(async apiKey => {
          if (request.signal.aborted) throw new Error('Request cancelled');
          const client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 12000, maxRetries: 0 });
          const completion = await client.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: rawMode ? RAW_LISTENING_PROMPT : SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: rawMode ? 4000 : 500,
            response_format: { type: 'json_object' },
          }, { signal: request.signal });
          const result = completion.choices[0]?.message?.content;
          if (result) return result;
          throw new Error('Groq returned no response.');
        }, model);
        break;
      } catch (error) {
        if (request.signal.aborted) throw error;
        lastError = error;
        if (error instanceof GroqKeyPoolExhaustedError && error.retryAfterMs > 0 && error.retryAfterMs <= 3600000) cooldowns.push(error.retryAfterMs);
      }
    }

    if (!content) {
      if (cooldowns.length) return NextResponse.json(
        { error: 'Các key Groq đang giới hạn tốc độ. Đoạn nghe được giữ để tự động thử lại.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(Math.min(...cooldowns) / 1000)) } }
      );
      console.error('All candidate models failed. Last error:', lastError);
      return NextResponse.json(
        { error: 'No response from AI model' },
        { status: 500 }
      );
    }

    try {
      const parsed = JSON.parse(content);
      if (rawMode) return NextResponse.json(validateListeningResult(parsed, rawTranscript));

      // Validate required fields
      const response = {
        question_number: parsed.question_number || question_number || 0,
        answer: isSuggestion ? null : parsed.answer || 'A',
        answer_text: typeof parsed.answer_text === 'string' ? parsed.answer_text.trim() : '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        question_type: parsed.question_type || 'unknown',
        reason: parsed.reason || 'No explanation available.',
        translation: parsed.translation || 'Không có giải thích.',
        vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
      };

      // Ensure answer is valid
      const validAnswers = detectedPart === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
      if (isSuggestion && !response.answer_text) {
        return NextResponse.json({ error: 'AI did not provide a suggested answer' }, { status: 502 });
      }
      if (!isSuggestion && !validAnswers.includes(response.answer)) {
        response.answer = 'A';
        response.confidence = 0.1;
      }

      return NextResponse.json(response);
    } catch (error) {
      console.warn('Invalid solver response:', error instanceof Error ? error.message : 'invalid JSON');
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Solve API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
