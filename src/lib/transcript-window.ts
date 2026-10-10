export const QUESTIONS_PER_CLEANUP = 3;
const MAX_DISPLAY_CHARS = 2400;

// This window is for display/archive text only, never pending recognition or
// the passage needed to answer the current Part 3/4 group.
export function trimTranscript(text: string): string {
  const value = text.trim();
  if (value.length <= MAX_DISPLAY_CHARS) return value;
  const tail = value.slice(-MAX_DISPLAY_CHARS);
  const firstSpace = tail.search(/\s/);
  return firstSpace < 0 ? tail : tail.slice(firstSpace + 1);
}
