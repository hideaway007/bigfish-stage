import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hostname, userInfo } from 'node:os';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localIdentity = new RegExp(`\\b(?:${[hostname(), userInfo().username].map(escape).join('|')})\\b`, 'gi');
export function scrub(value: unknown): any {
  if (typeof value === 'string') return value.replace(localIdentity, '[REDACTED_LOCAL_ID]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const cleaned = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(?:authorization|access_token|refresh_token|id_token|api_key|accountId|account_id|email|installationId|serverName)$/i.test(k) ? '[REDACTED]' : scrub(v)]));
    if (cleaned.type === 'tool_end' && typeof cleaned.output === 'string') cleaned.output = cleaned.output.slice(0, 4000);
    return cleaned;
  }
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const samples = new URL('../samples/', import.meta.url);
  for (const name of readdirSync(samples).filter(n => n.endsWith('.jsonl'))) {
    const file = new URL(name, samples);
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => scrub(JSON.parse(line)));
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
}
