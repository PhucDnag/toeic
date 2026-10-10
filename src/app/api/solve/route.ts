import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { inferTOEICPart } from '@/lib/toeic-detector';
import {
  getGroqApiKeys,
  getErrorStatus,
  isGroqKeyUnavailableError,
  withGroqKeyFailover,
} from '@/lib/server/groq-key-pool';

const CHOICE_PROMPT = 'Solve the TOEIC question-response task. Choose the best provided response by meaning, avoiding repeated-word traps. Return only JSON: {"answer":"A"} (A, B, C, or D when provided). No explanation or additional fields.';
const PASSAGE_PROMPT = 'Answer the TOEIC question using only its passage. Return only JSON: {"answer_text":"short answer"}. If evidence is missing, answer_text must be "Insufficient information". No explanation or additional fields.';
const GROQ_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
// Scope unavailable models to the credential that actually received the error.
const unavailableModels = new Map<string, Map<string, { until: number; status: number }>>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Bound provider failover to the client's request budget. A stalled model
    // must not leave SDK retries running after the listening queue moves on.
    const solveSignal = AbortSignal.any([request.signal, AbortSignal.timeout(22000)]);

    const { part, passage, question_number, question, choices } = body;
    const normalizedPassage = typeof passage === 'string' ? passage.trim() : '';
    const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
    const detectedPart = part || inferTOEICPart(Number(question_number));
    const isSuggestion = detectedPart === 3 || detectedPart === 4;

    if (!normalizedQuestion && !normalizedPassage) {
      return NextResponse.json(
        { error: 'Missing question and transcript' },
        { status: 400 }
      );
    }

    const safeChoices = choices || {};
    const validAnswers = detectedPart === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
    if (!isSuggestion && (!normalizedQuestion || validAnswers.some(letter =>
      typeof safeChoices[letter] !== 'string' || !safeChoices[letter].trim() ||
      /^\(not (?:provided|detected)\)$/i.test(safeChoices[letter].trim())
    ))) {
      return NextResponse.json({ error: 'Chưa nghe đủ câu hỏi và các đáp án.' }, { status: 422 });
    }

    // Provider priority: Groq key pool > Gemini > OpenAI.
    const hasGroqKeys = getGroqApiKeys().length > 0;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const hasGeminiKey = !!geminiKey && geminiKey !== 'your-gemini-api-key-here';
    const hasOpenAIKey = !!openaiKey && openaiKey !== 'your-openai-api-key-here';

    if (!hasGroqKeys && !hasGeminiKey && !hasOpenAIKey) {
      return NextResponse.json(
        {
          error:
            'Chưa cấu hình API Key. Hãy thêm GROQ_API_KEY/GROQ_API_KEYS, GEMINI_API_KEY hoặc OPENAI_API_KEY trong .env.local',
        },
        { status: 500 }
      );
    }

    // Build the user prompt
    let userPrompt = '';

    if (isSuggestion && normalizedPassage) {
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
      userPrompt += '\nNo answer choices are available. Return answer_text with the short answer content supported by the passage. If evidence is missing, return "Insufficient information".\n';
    }

    const generateWithModels = async (
      client: OpenAI,
      models: string[],
      provider: string,
      apiKey?: string
    ): Promise<string> => {
      let providerError: unknown;
      const unavailable = apiKey ? unavailableModels.get(apiKey) || new Map<string, { until: number; status: number }>() : null;
      if (apiKey && unavailable) unavailableModels.set(apiKey, unavailable);
      for (const model of models) {
        solveSignal.throwIfAborted();
        const blocked = unavailable?.get(model);
        if (blocked && blocked.until > Date.now()) {
          providerError = Object.assign(new Error(`${provider} model temporarily unavailable`), { status: blocked.status });
          continue;
        }
        try {
          const isGroqReasoning = provider === 'Groq' && model.startsWith('openai/gpt-oss-');
          const completion = await client.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: isSuggestion ? PASSAGE_PROMPT : CHOICE_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            // GPT-OSS spends some of this budget on reasoning. Capping it at 32
            // can exhaust the budget before it emits the actual answer JSON.
            max_tokens: isGroqReasoning ? 1024 : isSuggestion ? 96 : 32,
            ...(provider === 'Groq' ? {
              reasoning_effort: isGroqReasoning ? 'low' as const : 'none' as const,
              include_reasoning: false,
            } : {}),
            response_format: { type: 'json_object' },
          }, { signal: solveSignal });
          const result = completion.choices[0]?.message?.content;
          if (!result || completion.choices[0]?.finish_reason === 'length') throw new Error('Incomplete model response');
          const parsed = JSON.parse(result);
          if (isSuggestion ? typeof parsed.answer_text !== 'string' || !parsed.answer_text.trim() || /^(null|undefined|none|n\/a)$/i.test(parsed.answer_text.trim())
            : typeof parsed.answer !== 'string' || !validAnswers.includes(parsed.answer.trim().toUpperCase())) {
            throw new Error('Invalid model answer');
          }
          return result;
        } catch (error) {
          solveSignal.throwIfAborted();
          const status = getErrorStatus(error);
          // Model limits can differ on the same key. Try another model before
          // cooling down this key; transcription has its own independent scope.
          if (apiKey && status !== 429 && status !== 403 && isGroqKeyUnavailableError(error)) throw error;
          if (status === 403 || status === 404 || status === 429) {
            unavailable?.set(model, { until: Date.now() + (status === 429 ? 60000 : 600000), status });
          }
          console.warn(`${provider} model ${model} failed (HTTP ${status || 'unknown'}); trying the next candidate.`);
          providerError = error;
        }
      }
      throw providerError instanceof Error
        ? providerError
        : new Error(`${provider} returned no model response.`);
    };

    let content: string | null = null;
    let lastError: unknown = null;

    if (hasGroqKeys) {
      try {
        content = await withGroqKeyFailover((apiKey) =>
          generateWithModels(
            new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 8000, maxRetries: 0 }),
            GROQ_MODELS,
            'Groq',
            apiKey
          ),
          'solve'
        );
      } catch (error) {
        lastError = error;
        console.warn('Groq solver pool is unavailable; trying the next provider.');
      }
    }

    if (!content && hasGeminiKey) {
      try {
        content = await generateWithModels(
          new OpenAI({
            apiKey: geminiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
            timeout: 8000,
            maxRetries: 0,
          }),
          ['gemini-2.0-flash', 'gemini-1.5-flash'],
          'Gemini'
        );
      } catch (error) {
        lastError = error;
      }
    }

    if (!content && hasOpenAIKey) {
      try {
        content = await generateWithModels(
          new OpenAI({ apiKey: openaiKey, timeout: 8000, maxRetries: 0 }),
          ['gpt-4o-mini', 'gpt-4o'],
          'OpenAI'
        );
      } catch (error) {
        lastError = error;
      }
    }

    if (!content) {
      console.error(`All solver candidates failed (HTTP ${getErrorStatus(lastError) || 'unknown'}).`);
      return NextResponse.json(
        { error: 'Không gọi được model giải đáp án. Kiểm tra hạn mức Groq hoặc thử lại.' },
        { status: 502 }
      );
    }

    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      const response = {
        question_number: question_number || 0,
        answer: isSuggestion ? null : typeof parsed.answer === 'string' ? parsed.answer.trim().toUpperCase() : null,
        answer_text: isSuggestion && typeof parsed.answer_text === 'string' ? parsed.answer_text.trim() : '',
      };

      // Ensure answer is valid
      if (isSuggestion && !response.answer_text) {
        return NextResponse.json({ error: 'AI did not provide a suggested answer' }, { status: 502 });
      }
      if (!isSuggestion) {
        if (!response.answer || !validAnswers.includes(response.answer)) {
          return NextResponse.json({ error: 'AI returned an invalid answer' }, { status: 502 });
        }
        response.answer_text = safeChoices[response.answer].trim();
      }

      return NextResponse.json(response);
    } catch {
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
