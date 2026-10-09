import 'server-only';

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const INVALID_KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let activeKeyIndex = 0;
const cooldownUntilByKey = new Map<string, number>();

export class GroqKeyPoolExhaustedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GroqKeyPoolExhaustedError';
  }
}

function isConfiguredKey(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return !!normalized && !normalized.includes('your-groq') && !normalized.includes('your_groq');
}

export function getGroqApiKeys(): string[] {
  const keys: string[] = [];
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (isConfiguredKey(trimmed) && !keys.includes(trimmed)) keys.push(trimmed);
  };

  // Preserve the original variable as the primary key.
  add(process.env.GROQ_API_KEY);

  for (const value of (process.env.GROQ_API_KEYS || '').split(/[,;\s]+/)) add(value);

  const numberedKeys = Object.entries(process.env)
    .filter(([name]) => /^GROQ_API_KEY_\d+$/.test(name))
    .sort(([left], [right]) => {
      const leftNumber = Number(left.match(/\d+$/)?.[0] || 0);
      const rightNumber = Number(right.match(/\d+$/)?.[0] || 0);
      return leftNumber - rightNumber;
    });
  for (const [, value] of numberedKeys) add(value);

  return keys;
}

export function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isGroqKeyUnavailableError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403 || status === 429) return true;

  const details = error instanceof Error ? error.message : String(error);
  return /rate.?limit|quota|insufficient.?quota|api.?key|authentication/i.test(details);
}

function getHeader(error: unknown, name: string): string | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as { headers?: unknown }).headers;
  if (headers instanceof Headers) return headers.get(name);
  if (headers && typeof headers === 'object') {
    const value = (headers as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function retryDelayMs(error: unknown): number {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return INVALID_KEY_COOLDOWN_MS;

  const retryAfter = getHeader(error, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(60 * 60 * 1000, Math.max(5_000, seconds * 1000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(60 * 60 * 1000, Math.max(5_000, retryAt - Date.now()));
    }
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

export async function withGroqKeyFailover<T>(
  operation: (apiKey: string, keyNumber: number) => Promise<T>
): Promise<T> {
  const keys = getGroqApiKeys();
  if (keys.length === 0) {
    throw new GroqKeyPoolExhaustedError('No Groq API key is configured.');
  }

  const now = Date.now();
  const orderedIndexes = keys.map((_, offset) => (activeKeyIndex + offset) % keys.length);
  const availableIndexes = orderedIndexes.filter(
    (index) => (cooldownUntilByKey.get(keys[index]) || 0) <= now
  );

  if (availableIndexes.length === 0) {
    throw new GroqKeyPoolExhaustedError('All configured Groq API keys are cooling down.');
  }

  let lastError: unknown;
  for (const index of availableIndexes) {
    const apiKey = keys[index];
    try {
      const result = await operation(apiKey, index + 1);
      activeKeyIndex = index;
      cooldownUntilByKey.delete(apiKey);
      return result;
    } catch (error) {
      if (!isGroqKeyUnavailableError(error)) throw error;

      lastError = error;
      cooldownUntilByKey.set(apiKey, Date.now() + retryDelayMs(error));
      activeKeyIndex = (index + 1) % keys.length;
      console.warn(
        `Groq API key #${index + 1} is unavailable (HTTP ${getErrorStatus(error) || 'unknown'}); trying the next key.`
      );
    }
  }

  throw new GroqKeyPoolExhaustedError(
    'All configured Groq API keys have reached a limit or are unavailable.',
    { cause: lastError }
  );
}

