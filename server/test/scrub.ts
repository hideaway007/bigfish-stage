export function scrubFixture(value: unknown): any {
  if (typeof value === 'string') return value
    .replace(/\/Users\/[^/\s"'\\]+/g, '/Users/LOCAL_USER')
    .replace(/\/home\/[^/\s"'\\]+/g, '/home/LOCAL_USER')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]');
  if (Array.isArray(value)) return value.map(scrubFixture);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /^(?:apiKey|api_key|authorization|access_token|refresh_token|id_token|email)$/i.test(key) ? '[REDACTED]' : scrubFixture(v)]));
  return value;
}
