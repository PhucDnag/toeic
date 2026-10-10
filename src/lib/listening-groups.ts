// Normalize only announced numbers, never numbers inside the passage itself.
export function normalizeListeningNumbers(text: string): string {
  text = text.replace(/\bQ\s*\.\s*(?=\d)/gi, 'Question ');
  const units = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const small = [...units, 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const number = `(?:one[ -]hundred|(?:${tens.join('|')})(?:[ -](?:${units.join('|')}))?|${small.join('|')})`;
  // Whisper sometimes drops the b or separates letters in the announced
  // "Number". Only repair this immediately before a valid announced number.
  text = text.replace(new RegExp(`\\b(?:n\\s+umer|numer|num\\s+ber|numb[ae]r|num\\.?)\\s*(?=(?:\\d{1,3}|${number})\\b)`, 'gi'), 'Number ');
  const convert = (value: string) => {
    if (/hundred/i.test(value)) return '100';
    if (small.includes(value.toLowerCase())) return String(small.indexOf(value.toLowerCase()) + 1);
    const [ten, unit] = value.toLowerCase().split(/[ -]/);
    return String((tens.indexOf(ten) + 2) * 10 + units.indexOf(unit) + 1);
  };
  return text.replace(new RegExp(`\\b(questions?|numbers?)\\s+(${number})\\b(?:\\s+(through|to|and)\\s+(${number})\\b)?`, 'gi'),
    (_, label: string, first: string, separator?: string, last?: string) =>
      `${label} ${convert(first)}${last ? ` ${separator} ${convert(last)}` : ''}`);
}

export function listeningMarkers(text: string) {
  const pattern = /\b(?:question|number|no\.?)\s*(\d{1,3})\b(?!\s*(?:through|to|and|[-–—])\s*\d+)\s*[.):\-]?|(?:^|[\n.!?]\s+)\s*(\d{2,3})\s*[.)]/gi;
  return [...text.matchAll(pattern)].map(match => ({
    number: Number(match[1] || match[2]),
    start: match.index!,
    end: match.index! + match[0].length,
  })).filter(marker => marker.number >= 32 && marker.number <= 100);
}

export const GROUP_HEADER = /\b(?:questions?|numbers?)\s+(\d+)\s*(?:through|to|and|[-–—])\s*(\d+)\b(?:\s+refer\s+to\s+the\s+following\s+[^.!?]+[.!?]|\s*[.:])?/i;

export function listeningGroupStart(number: number) {
  const base = number < 71 ? 32 : 71;
  return base + Math.floor((number - base) / 3) * 3;
}
