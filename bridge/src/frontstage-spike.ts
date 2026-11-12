import { readFileSync } from 'node:fs';
const events = readFileSync(new URL('../samples/app-full.stage.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => ['tool_end', 'permission_resolved', 'turn_done'].includes(e.type)).slice(-3);
const started = Date.now(); let firstTextMs: number | undefined, text = '', buffer = '';
const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: process.env.BRIDGE_MODEL ?? 'gpt-6-luna', stream: true, messages: [
    { role: 'system', content: '你是大肥鱼，一条嘴馋但靠谱的鱼。根据真实进度用中文说一句简短播报，不编造事实。' },
    { role: 'user', content: JSON.stringify(events) }] }) });
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
const reader = response.body.getReader(), decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read(); if (done) break;
  buffer += decoder.decode(value, { stream: true }); let boundary: number;
  while ((boundary = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, boundary).trim(); buffer = buffer.slice(boundary + 1);
    if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
    const delta = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content;
    if (delta) { firstTextMs ??= Date.now() - started; text += delta; } } }
console.log(JSON.stringify({ at: Date.now(), model: process.env.BRIDGE_MODEL ?? 'gpt-6-luna', firstTextMs, totalMs: Date.now() - started, text }));
