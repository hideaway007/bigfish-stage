import type { ModelEndpoint } from '../../../src/shared/settings';
import type { ConnectionResult, ModelList } from '../adapters/types';

export async function endpointRequest(endpoint: ModelEndpoint, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ?? AbortSignal.timeout(12_000), redirect: 'error',
  });
  // Do not include response bodies/URLs: providers may echo credentials.
  if (!response.ok) throw new Error(`模型接口 HTTP ${response.status}`);
  return response.json();
}
export async function listEndpointModels(endpoint: ModelEndpoint): Promise<ModelList> {
  try {
    const response = await endpointRequest(endpoint, 'models');
    if (!Array.isArray(response.data)) throw new Error('模型列表格式无效');
    return { models: response.data.map((m: any) => m.id).filter((id: unknown): id is string => typeof id === 'string') };
  } catch { return { models: [], error: '无法读取模型列表，请检查接口地址与凭据' }; }
}
export async function testEndpoint(endpoint: ModelEndpoint): Promise<ConnectionResult> {
  const start = Date.now();
  try {
    const response = await endpointRequest(endpoint, 'chat/completions', { model: endpoint.model, stream: false, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] });
    if (!Array.isArray(response.choices) || !response.choices.length) throw new Error('响应格式无效');
    return { ok: true, message: '模型接口连接正常', latencyMs: Date.now() - start };
  } catch { return { ok: false, message: '模型接口连接失败或超时，请检查地址、模型与凭据', latencyMs: Date.now() - start }; }
}
