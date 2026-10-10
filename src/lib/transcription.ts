interface Word { word: string; start: number; end: number }
interface Segment { text: string; start: number; end: number; no_speech_prob: number; avg_logprob: number; compression_ratio: number }

/** Only timestamps can distinguish replayed audio from a genuinely repeated response. */
export function selectTranscript(transcription: { text?: string; words?: Word[]; segments?: Segment[] }, overlapSeconds: number) {
  const segments = transcription.segments?.filter(segment =>
    !(segment.no_speech_prob > 0.85 && segment.avg_logprob < -1.5) &&
    !(segment.compression_ratio > 2.4 && segment.avg_logprob < -1));
  if (transcription.words?.length && overlapSeconds > 0) {
    const words = transcription.words.filter(word => {
      if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= overlapSeconds) return false;
      const midpoint = (word.start + word.end) / 2;
      return !segments || segments.some(segment => midpoint >= segment.start && midpoint <= segment.end);
    });
    return { text: words.map(word => word.word.trim()).join(' ').trim(), overlapRemoved: true };
  }
  return {
    text: segments?.map(segment => segment.text.trim()).join(' ').trim() ?? transcription.text?.trim() ?? '',
    overlapRemoved: overlapSeconds === 0,
  };
}
