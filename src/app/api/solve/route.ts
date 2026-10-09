import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { inferTOEICPart } from '@/lib/toeic-detector';
import {
  getGroqApiKeys,
  isGroqKeyUnavailableError,
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

    const generateWithModels = async (
      client: OpenAI,
      models: string[],
      provider: string,
      stopWhenKeyUnavailable = false
    ): Promise<string> => {
      let providerError: unknown;
      for (const model of models) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 500,
            response_format: { type: 'json_object' },
          });
          const result = completion.choices[0]?.message?.content;
          if (result) return result;
        } catch (error) {
          if (stopWhenKeyUnavailable && isGroqKeyUnavailableError(error)) throw error;
          console.warn(`${provider} model ${model} failed, trying the next model.`, error);
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
            new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
            ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
            'Groq',
            true
          )
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
          new OpenAI({ apiKey: openaiKey }),
          ['gpt-4o-mini', 'gpt-4o'],
          'OpenAI'
        );
      } catch (error) {
        lastError = error;
      }
    }

    if (!content) {
      console.error('All candidate models failed. Last error:', lastError);
      return NextResponse.json(
        { error: 'No response from AI model' },
        { status: 500 }
      );
    }

    try {
      const parsed = JSON.parse(content);

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
