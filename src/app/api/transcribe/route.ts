import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import {
  getGroqApiKeys,
  GroqKeyPoolExhaustedError,
  withGroqKeyFailover,
} from '@/lib/server/groq-key-pool';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const contextValue = formData.get('context');
    const context = typeof contextValue === 'string' ? contextValue.slice(-500) : '';

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const hasOpenAIKey = !!openaiKey && openaiKey !== 'your-openai-api-key-here';
    const hasGroqKeys = getGroqApiKeys().length > 0;

    if (!hasGroqKeys && !hasOpenAIKey) {
      return NextResponse.json(
        { error: 'Chưa cấu hình GROQ_API_KEY/GROQ_API_KEYS để sử dụng Whisper AI.' },
        { status: 500 }
      );
    }

    // Convert Buffer to valid file with openai.toFile
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const transcribe = async (client: OpenAI, model: string) => {
      const uploadFile = await toFile(audioBuffer, 'audio.wav', { type: 'audio/wav' });
      return client.audio.transcriptions.create({
        file: uploadFile,
        model,
        language: 'en',
        prompt: [
          'TOEIC Listening Parts 2, 3, and 4. Transcribe exactly what is spoken. Preserve question numbers, contractions, speaker turns, and answer labels A, B, C, D. Part 2 has only A, B, C. Do not invent commentary.',
          context ? `Possible preceding context: ${context}` : '',
        ].filter(Boolean).join(' '),
        temperature: 0.0,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });
    };

    let transcription;
    if (hasGroqKeys) {
      try {
        transcription = await withGroqKeyFailover((apiKey) =>
          transcribe(
            new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
            'whisper-large-v3'
          )
        );
      } catch (error) {
        if (!(error instanceof GroqKeyPoolExhaustedError) || !hasOpenAIKey) throw error;
        console.warn('All Groq transcription keys are unavailable; using OpenAI fallback.');
        transcription = await transcribe(new OpenAI({ apiKey: openaiKey }), 'whisper-1');
      }
    } else {
      transcription = await transcribe(new OpenAI({ apiKey: openaiKey }), 'whisper-1');
    }

    const reliableSegments = transcription.segments?.filter((segment) => {
      const likelySilence = segment.no_speech_prob > 0.6 && segment.avg_logprob < -1;
      const likelyRepetition = segment.compression_ratio > 2.4;
      return !likelySilence && !likelyRepetition;
    });
    const reliableText = reliableSegments?.map((segment) => segment.text.trim()).join(' ').trim();

    // An empty filtered result must stay empty, otherwise rejected silence or
    // repetition is accidentally restored by the fallback.
    return NextResponse.json({ text: reliableText ?? transcription.text ?? '' });
  } catch (error) {
    console.error('Whisper transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
