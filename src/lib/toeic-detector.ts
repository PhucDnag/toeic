// ===== TOEIC Question and Choice Detector =====
// Rule-based detection of TOEIC question patterns from live transcript

import { DetectionResult, TOEICChoices, TOEICListeningPart } from './types';

// ===== Question Pattern Detection =====

const QUESTION_PATTERNS = [
  // Deliberately exclude plural range headers such as "Questions 71 through
  // 73". Those introduce a passage; they are not question 71 itself.
  /(?:question|number|no\.?|#)\s*(\d{1,3})\b(?!\s*(?:through|to|and|-)\s*\d+)/i,
  // Standalone numbers at start of line or sentence: "71." or "71)"
  /(?:^|\n|\.\s+)\s*#?\s*(\d{1,3})\s*[\.\)]/,
];

/** Standard TOEIC Listening question-number ranges. */
export function inferTOEICPart(questionNumber: number): TOEICListeningPart | undefined {
  if (questionNumber >= 7 && questionNumber <= 31) return 2;
  if (questionNumber >= 32 && questionNumber <= 70) return 3;
  if (questionNumber >= 71 && questionNumber <= 100) return 4;
  return undefined;
}

/** Detect an explicitly announced Part, including common TOEIC directions. */
export function detectTOEICPart(text: string): TOEICListeningPart | undefined {
  const explicit = text.match(/\bpart\s*(2|3|4|two|three|four)\b/i)?.[1]?.toLowerCase();
  if (explicit === '2' || explicit === 'two') return 2;
  if (explicit === '3' || explicit === 'three') return 3;
  if (explicit === '4' || explicit === 'four') return 4;

  if (/hear\s+(?:a\s+)?(?:question|statement).*three\s+responses/i.test(text)) return 2;
  if (/conversations?\s+between\s+(?:two|2)\s+or\s+more\s+people/i.test(text)) return 3;
  if (/talks?\s+given\s+by\s+a\s+single\s+speaker/i.test(text)) return 4;
  return undefined;
}

export function getRequiredChoiceLetters(
  part?: TOEICListeningPart
): Array<keyof TOEICChoices> {
  return part === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
}

const PASSAGE_HEADER_PATTERNS = [
  /(?:questions?|numbers?)\s+(\d+)\s*(?:through|to|and|-)\s*(\d+)\s*refer\s+to\s+the\s+following\s+(.+)/i,
  /refer\s+to\s+the\s+following\s+(.+)/i,
];

const QUESTION_KEYWORDS = [
  /what\s+is\s+the\s+purpose/i,
  /what\s+does\s+the\s+(?:speaker|man|woman)/i,
  /what\s+will\s+(?:the\s+)?(?:speaker|man|woman|listeners?)/i,
  /what\s+is\s+(?:suggested|mentioned|indicated|implied|stated)/i,
  /what\s+(?:is|are|was|were|does|do|did|will|would|can|could|should|has|have)/i,
  /where\s+(?:is|are|was|were|does|do|did|will|would|can|most\s+likely)/i,
  /when\s+(?:is|are|was|were|does|do|did|will|would|should)/i,
  /who\s+(?:is|are|was|were|does|do|did|will|would|most\s+likely)/i,
  /why\s+(?:is|are|was|were|does|do|did|will|would|has|have)/i,
  /how\s+(?:many|much|often|long|far|soon|old)/i,
  /how\s+(?:is|are|was|were|does|do|did|will|would|can|could)/i,
  /which\s+(?:of|is|are|was|were|does|do|did|will|would)/i,
  /according\s+to\s+the\s+(?:speaker|announcement|message|talk|report|advertisement)/i,
];

// Spoken word numbers map (common in TOEIC like "number seventy one")
const SPOKEN_NUMBERS: Record<string, number> = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
  'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
};

function parseSpokenNumber(text: string): number | null {
  const match = text.match(/(?:question|number)\s+([a-z\- ]+)/i);
  if (!match) return null;
  const words = match[1].toLowerCase().replace('-', ' ').trim().split(/\s+/);
  let total = 0;
  for (const w of words) {
    if (SPOKEN_NUMBERS[w] !== undefined) {
      total += SPOKEN_NUMBERS[w];
    } else {
      return null;
    }
  }
  return total >= 1 && total <= 200 ? total : null;
}

/**
 * Detect question numbers from transcript text.
 */
export function detectQuestionNumber(text: string): number | null {
  for (const pattern of QUESTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 200) {
        return num;
      }
    }
  }
  return parseSpokenNumber(text);
}

function getQuestionSegment(text: string, questionNumber?: number | null): string | null {
  if (!questionNumber) return null;

  const numericMarker = new RegExp(
    `(?:question|number|no\\.?)\\s*${questionNumber}\\b\\s*[\\.\\):\\-]?`,
    'gi'
  );
  let segmentStart = -1;
  let numericMatch: RegExpExecArray | null;
  while ((numericMatch = numericMarker.exec(text)) !== null) {
    segmentStart = numericMatch.index + numericMatch[0].length;
  }

  // Also support "Number seventy one" when Whisper spells the number out.
  const spokenMarker = /\b(?:question|number)\s+[a-z-]+(?:\s+[a-z-]+){0,2}\s*[\.\):\-]?/gi;
  let spokenMatch: RegExpExecArray | null;
  while ((spokenMatch = spokenMarker.exec(text)) !== null) {
    if (parseSpokenNumber(spokenMatch[0]) === questionNumber) {
      segmentStart = Math.max(segmentStart, spokenMatch.index + spokenMatch[0].length);
    }
  }

  if (segmentStart < 0) return null;
  return text.slice(segmentStart).trim();
}

/**
 * Detect passage headers like "Questions 71 through 73 refer to the following announcement"
 */
export function detectPassageHeader(text: string): {
  start: number;
  end: number;
  passageType: string;
} | null {
  for (const pattern of PASSAGE_HEADER_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // Find question range
      const rangeMatch = text.match(
        /(?:questions?|numbers?)\s+(\d+)\s*(?:through|to|and|-)\s*(\d+)/i
      );
      if (rangeMatch) {
        return {
          start: parseInt(rangeMatch[1], 10),
          end: parseInt(rangeMatch[2], 10),
          passageType: match[match.length - 1]?.trim() || 'talk',
        };
      }
    }
  }
  return null;
}

/**
 * Detect if text contains a TOEIC question pattern.
 */
export function detectQuestionText(text: string, questionNumber?: number | null): string | null {
  const numberedSegment = getQuestionSegment(text, questionNumber);
  if (numberedSegment !== null) {
    const choiceStart = numberedSegment.search(
      /(?:^|\s)(?:Choice\s+|Option\s+)?[A-D]\s*[\.\),:\-]/i
    );
    const questionText = (choiceStart >= 0
      ? numberedSegment.slice(0, choiceStart)
      : numberedSegment
    ).trim().replace(/^[\s.():-]+|[\s]+$/g, '');

    // Part 2 prompts can be statements, so do not require a question keyword.
    return questionText.length >= 3 ? questionText : null;
  }

  for (const pattern of QUESTION_KEYWORDS) {
    const match = text.match(pattern);
    if (match) {
      // Extract the question starting from the keyword
      const idx = text.search(pattern);
      if (idx !== -1) {
        // Get text from the question keyword to the end or until a choice marker
        let questionEnd = text.length;
        const choiceStart = text.search(/(?:^|\s)(?:Choice\s+|Option\s+)?[A-D]\s*[\.\):\-]/i);
        if (choiceStart > idx) {
          questionEnd = choiceStart;
        }
        const questionText = text.substring(idx, questionEnd).trim();
        // Must end with ? or be at least 8 chars
        if (questionText.length >= 8) {
          return questionText;
        }
      }
    }
  }
  return null;
}

/**
 * Extract answer choices from text using robust lookahead.
 */
export function extractChoices(text: string, questionNumber?: number | null): TOEICChoices {
  const choices: TOEICChoices = {};
  const numberedSegment = getQuestionSegment(text, questionNumber);
  const choiceSource = numberedSegment ?? text;
  
  // Strategy 1: Look for A. ... B. ... C. ... D. ... or Choice A: ...
  const pattern = /(?:^|\s)(?:Choice\s+|Option\s+)?([A-D])\s*[\.\):\-]\s*([\s\S]+?)(?=(?:\s+(?:Choice\s+|Option\s+)?[A-D]\s*[\.\):-])|$)/gi;
  let match;
  
  while ((match = pattern.exec(choiceSource)) !== null) {
    const letter = match[1].toUpperCase() as keyof TOEICChoices;
    const choiceText = match[2].trim();
    if (choiceText.length >= 2) {
      choices[letter] = choiceText;
    }
  }
  
  // Strategy 2: If no choices found yet, check for looser lowercase patterns
  if (countChoices(choices) === 0) {
    const loosePattern = /\b([a-d])\s*[\.\)]\s*([a-z0-9 ,'\-]+?)(?=\s*[a-d]\s*[\.\)]|$)/gi;
    while ((match = loosePattern.exec(choiceSource)) !== null) {
      const letter = match[1].toUpperCase() as keyof TOEICChoices;
      const choiceText = match[2].trim();
      if (choiceText.length >= 2) {
        choices[letter] = choiceText;
      }
    }
  }
  
  return choices;
}

/**
 * Check if all four choices are present.
 */
export function hasAllChoices(choices: TOEICChoices): boolean {
  return !!(choices.A && choices.B && choices.C && choices.D);
}

export function hasRequiredChoices(
  choices: TOEICChoices,
  part?: TOEICListeningPart
): boolean {
  return getRequiredChoiceLetters(part).every((letter) => !!choices[letter]);
}

/**
 * Count how many choices are present.
 */
export function countChoices(choices: TOEICChoices): number {
  let count = 0;
  if (choices.A) count++;
  if (choices.B) count++;
  if (choices.C) count++;
  if (choices.D) count++;
  return count;
}

/**
 * Get the next expected choice letter.
 */
export function getNextExpectedChoice(
  choices: TOEICChoices,
  part?: TOEICListeningPart
): 'A' | 'B' | 'C' | 'D' | null {
  return getRequiredChoiceLetters(part).find((letter) => !choices[letter]) || null;
}

/**
 * Comprehensive detection: analyze a text buffer and return what was detected.
 */
export function analyzeTranscript(text: string): DetectionResult {
  // 1. Check for passage header
  const passageHeader = detectPassageHeader(text);
  if (passageHeader) {
    return {
      type: 'passage_header',
      questionRange: { start: passageHeader.start, end: passageHeader.end },
      passageType: passageHeader.passageType,
      raw: text,
    };
  }
  
  // 2. Check for question
  const questionNumber = detectQuestionNumber(text);
  const questionText = detectQuestionText(text);
  
  if (questionNumber || questionText) {
    return {
      type: 'question',
      questionNumber: questionNumber || undefined,
      questionText: questionText || undefined,
      raw: text,
    };
  }
  
  // 3. Check for choices
  const choices = extractChoices(text);
  const choiceCount = countChoices(choices);
  if (choiceCount > 0) {
    // Return the latest detected choice
    const letters: Array<keyof TOEICChoices> = ['D', 'C', 'B', 'A'];
    for (const letter of letters) {
      if (choices[letter]) {
        return {
          type: 'choice',
          choiceLetter: letter,
          choiceText: choices[letter],
          raw: text,
        };
      }
    }
  }
  
  return { type: 'none', raw: text };
}
