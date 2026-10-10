import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { selectTranscript } from '@/lib/transcription';
import {
  getGroqApiKeys,
  GroqKeyPoolExhaustedError,
  withGroqKeyFailover,
} from '@/lib/server/groq-key-pool';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const overlapSeconds = Number(formData.get('overlap_seconds') || 0);
    if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > 1) {
      return NextResponse.json({ error: 'Invalid audio overlap' }, { status: 400 });
    }

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
    }

    const hasGroqKeys = getGroqApiKeys().length > 0;

    if (!hasGroqKeys) {
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
        temperature: 0.0,
        response_format: 'verbose_json',
        timestamp_granularities: overlapSeconds > 0 ? ['word', 'segment'] : ['segment'],
      }, { signal: request.signal });
    };

    const transcription = await withGroqKeyFailover((apiKey) =>
          transcribe(
            new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 12000, maxRetries: 0 }),
            'whisper-large-v3'
          ), 'whisper-large-v3');

    return NextResponse.json(selectTranscript(transcription, overlapSeconds));
  } catch (error) {
    console.error('Whisper transcription error:', error);
    if (error instanceof GroqKeyPoolExhaustedError && error.retryAfterMs > 0 && error.retryAfterMs <= 60 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Dịch vụ nhận dạng đang giới hạn tốc độ. Đang giữ âm thanh để thử lại.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) } }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
