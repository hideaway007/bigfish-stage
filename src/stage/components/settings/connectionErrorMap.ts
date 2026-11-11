/**
 * 纯函数模块：将连接测试（test_connection → connection_test）与模型列表（list_models → models）
 * 的底层错误消息映射为通俗中文解释与可执行的下一步建议。
 */

export type ConnectionFailureCategory =
  | 'conn_refused'
  | 'auth_failed'
  | 'model_not_found'
  | 'timeout'
  | 'invalid_url'
  | 'codex_not_found'
  | 'codex_auth_or_config'
  | 'rate_limit'
  | 'server_error'
  | 'generic_endpoint'
  | 'unknown';

export interface FriendlyConnectionDiagnosis {
  category: ConnectionFailureCategory;
  /** 简短中文标题 */
  title: string;
  /** 通俗中文原因解释 */
  explanation: string;
  /** 具体可执行的下一步操作建议 */
  nextStep: string;
  /** 原始错误消息（供可折叠「详细信息」展示） */
  rawMessage: string;
}

/**
 * 将 `connection_test` 返回的原始错误文本映射为结构化中文诊断信息。
 */
export function mapConnectionFailure(
  rawMessage: string,
  target: 'worker' | 'voice' = 'worker'
): FriendlyConnectionDiagnosis {
  const raw = (rawMessage || '').trim() || '未知连接错误';

  // 1. Codex CLI executable missing / ENOENT
  if (
    /找不到可用的\s*codex|无法启动\s*Codex|未检测到命令|codex.*not\s*found|ENOENT.*codex|spawn\s+codex\s+ENOENT|command\s+not\s+found.*codex/i.test(
      raw
    )
  ) {
    return {
      category: 'codex_not_found',
      title: '未找到本机 Codex 可执行程序',
      explanation:
        '系统在环境变量 PATH 中找不到 codex 命令，后台无法拉起执行 Agent 进程。',
      nextStep:
        '请先在终端安装 OpenAI Codex CLI 并确认运行 `codex --version` 正常输出，或将「模型连接方式」切换为「自定义接口」。',
      rawMessage: raw,
    };
  }

  // 2. Codex built-in login / RPC / config failure
  if (
    /无法读取\s*Agent\s*自带配置|检查\s*Codex\s*登录与配置|Codex\s*RPC\s*失败|Codex\s*协议数据无效/i.test(
      raw
    )
  ) {
    return {
      category: 'codex_auth_or_config',
      title: 'Codex 自带登录状态或本机配置不可用',
      explanation:
        '当前选择了「使用 Agent 自带登录」，但本机 Codex CLI 尚未完成登录或配置文件异常。',
      nextStep:
        '请在终端运行 `codex` 完成账号登录，或将上方「模型连接方式」切换为「自定义接口」以直连本地网关。',
      rawMessage: raw,
    };
  }

  // 3. Invalid URL format
  if (
    /invalid\s+url|ERR_INVALID_URL|Failed\s+to\s+parse\s+URL|URL\s*格式|协议头|不是合法的\s*URL/i.test(
      raw
    )
  ) {
    return {
      category: 'invalid_url',
      title: '接口地址 (Base URL) 格式不正确',
      explanation:
        '当前填写的 Base URL 不是合法的 HTTP/HTTPS 地址，请求无法发出。',
      nextStep:
        '请将接口地址改为包含协议头与 `/v1` 的完整地址（如 `http://127.0.0.1:3425/v1`），点击「保存地址」后再测。',
      rawMessage: raw,
    };
  }

  // 4. 401 / 403 Authentication or permission failure
  if (
    /\b(401|403)\b|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|authentication|鉴权失败|密钥无效|权限不足|凭据无效/i.test(
      raw
    )
  ) {
    return {
      category: 'auth_failed',
      title: '接口鉴权未通过 (HTTP 401 / 403)',
      explanation:
        '模型网关拒绝了本次访问，通常是 API Key 未填写、填写错误、已过期或无权调用该模型。',
      nextStep:
        '请在上方「API Key」栏填入有效密钥并点击「更新 Key」；若连接的是本地免 Key 网关，请点击「清除 Key」后重试。',
      rawMessage: raw,
    };
  }

  // 5. 404 Model not found or wrong endpoint path
  if (
    /\b404\b|model[_ -]?not[_ -]?found|does\s+not\s+exist|not\s+found|模型不存在|未找到模型|路径不存在/i.test(
      raw
    )
  ) {
    return {
      category: 'model_not_found',
      title: '未找到指定模型或接口路径 (HTTP 404)',
      explanation:
        '已连通目标服务器，但网关提示该模型 ID 不存在，或 Base URL 缺少 `/v1` 路径后缀。',
      nextStep:
        '请确认 Base URL 以 `/v1` 结尾，再点击「↻ 刷新可选模型」从列表中点选网关实际支持的模型并点击「应用模型」。',
      rawMessage: raw,
    };
  }

  // 6. Connection refused / DNS / fetch failed
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|fetch\s+failed|network\s*error|拒绝连接|无法建立连接|网关未启动/i.test(
      raw
    )
  ) {
    return {
      category: 'conn_refused',
      title: '无法连接到模型接口（连接被拒绝或网关未启动）',
      explanation:
        '向接口地址发起请求时被拒绝或网络不可达，通常是本地模型网关（如 127.0.0.1:3425）尚未启动或端口填写有误。',
      nextStep:
        '请确认本地模型网关进程已启动并监听对应端口，核对 Base URL 后点击「保存地址」再次测试。',
      rawMessage: raw,
    };
  }

  // 7. Specific timeout (excluding generic "连接失败或超时" combined message handled below)
  if (
    (/timeout|timed?\s*out|ETIMEDOUT|AbortError|TimeoutError|请求超时|连接超时|响应超时/i.test(
      raw
    ) &&
      !/连接失败或超时/.test(raw)) ||
    /Codex\s+\S+\s+超时/i.test(raw)
  ) {
    return {
      category: 'timeout',
      title: '模型接口响应超时',
      explanation:
        '连接已发出但在限定时间内未收到模型返回，可能是上游推理网关负载过高、网络代理阻塞或模型冷启动过慢。',
      nextStep:
        '请检查网络或代理链路是否顺畅，或先切换为响应更快的轻量模型（如 `gemini-3.8-flash`）后重试。',
      rawMessage: raw,
    };
  }

  // 8. 429 Rate limit
  if (/\b429\b|rate[_ -]?limit|too\s+many\s+requests|限流|配额已满/i.test(raw)) {
    return {
      category: 'rate_limit',
      title: '触发接口调用频率或额度限制 (HTTP 429)',
      explanation:
        '短时间内请求过多或当前账号配额已达上限，网关暂时拒绝处理请求。',
      nextStep:
        '请稍候片刻再点击测试，或在「台词模型」设置中调低每分钟生成句数上限。',
      rawMessage: raw,
    };
  }

  // 9. 5xx Server error
  if (
    /\b(500|502|503|504)\b|bad\s+gateway|service\s+unavailable|internal\s+server\s+error|上游异常|网关错误/i.test(
      raw
    )
  ) {
    return {
      category: 'server_error',
      title: '上游模型服务内部异常 (HTTP 5xx)',
      explanation:
        '已连通本地或远端网关，但上游推理服务返回内部错误或暂时不可用。',
      nextStep:
        '请查看模型网关日志排查上游状态，或临时切换为其他可用模型（如 `gpt-6.1-sol`）后再试。',
      rawMessage: raw,
    };
  }

  // 10. Generic endpoint error from server/src/voice/endpoint.ts
  if (/模型接口连接失败或超时|请检查地址、模型与凭据/i.test(raw)) {
    return {
      category: 'generic_endpoint',
      title: '模型接口未能连通（请核对网关地址、模型名与密钥）',
      explanation:
        '测试请求未拿到有效回复。常见原因包括：本地网关（如 127.0.0.1:3425）未启动、Base URL 漏写 `/v1`、所选模型不在网关列表中，或 API Key 不匹配。',
      nextStep:
        '① 确认网关已启动且 Base URL 含 `/v1` 并点「保存地址」；② 点「↻ 刷新可选模型」选一个可用模型并点「应用模型」；③ 如需鉴权请更新 Key 后重测。',
      rawMessage: raw,
    };
  }

  // 11. Fallback
  return {
    category: 'unknown',
    title:
      target === 'voice'
        ? '台词模型连接测试未通过'
        : '执行 Agent 连接测试未通过',
    explanation:
      '测试请求未能成功完成，可能是接口地址、模型名称或本机运行环境配置不匹配。',
    nextStep:
      '请检查上方 Base URL、模型 ID 与 API Key 是否已点击保存/应用，展开下方「详细信息」核对原因后重试。',
    rawMessage: raw,
  };
}

export interface ModelProviderGroup {
  /** 分组前缀键，如 "codex/"、"anthropic/"、"direct" */
  prefixKey: string;
  /** 分组展示标题 */
  label: string;
  /** 该分组下的模型 ID 列表 */
  models: string[];
}

/**
 * 按提供商前缀（如 `codex/`、`anthropic/`）对模型列表分组。
 */
export function groupModelsByProvider(models: string[]): ModelProviderGroup[] {
  const groupMap = new Map<string, string[]>();

  for (const rawModel of models) {
    const m = rawModel.trim();
    if (!m) continue;
    const slashIdx = m.indexOf('/');
    const prefixKey = slashIdx > 0 ? m.slice(0, slashIdx + 1) : 'direct';
    const existing = groupMap.get(prefixKey);
    if (existing) {
      existing.push(m);
    } else {
      groupMap.set(prefixKey, [m]);
    }
  }

  // Put prefixed groups first in order of appearance, then 'direct'
  const result: ModelProviderGroup[] = [];
  for (const [prefixKey, list] of groupMap.entries()) {
    if (prefixKey === 'direct') continue;
    result.push({
      prefixKey,
      label: prefixKey,
      models: list,
    });
  }

  const directList = groupMap.get('direct');
  if (directList && directList.length > 0) {
    result.push({
      prefixKey: 'direct',
      label: '直连 / 无前缀',
      models: directList,
    });
  }

  return result;
}

/**
 * 根据用户输入的关键字（支持空格分隔的多词匹配）过滤模型列表。
 */
export function filterModelsByQuery(models: string[], query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return models;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const lower = m.toLowerCase();
    return tokens.every((tok) => lower.includes(tok));
  });
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

/**
 * 将模型名称按搜索词切分为高亮片段与普通片段，用于在 UI 中渲染 `<mark>`。
 */
export function splitHighlightSegments(
  text: string,
  query: string
): HighlightSegment[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text, matched: false }];

  const tokens = Array.from(
    new Set(
      trimmed
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => b.length - a.length);

  if (tokens.length === 0) return [{ text, matched: false }];

  const escaped = tokens.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  const lowerTokens = tokens.map((t) => t.toLowerCase());

  return parts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      matched: lowerTokens.includes(part.toLowerCase()),
    }));
}
