import type { StageEvent } from '../shared/stage-events';
import { defaultCharacterLine, resolveUiCopy } from '../stage/uiCopy';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  pickReactionForEvent,
} from '../stage/characterLoader';
import type { GitChangedFile } from '../shared/wire';

export type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type StageEventPayload = DistributiveOmit<StageEvent, 'at'>;

export interface ScriptStep {
  delayMs: number;
  event: StageEventPayload;
}

export const DEFAULT_FIRST_USER_PROMPT =
  '帮我把登录页的按钮颜色改成主题色，然后跑一下测试';

export function buildInitialBootEvents(
  characterId: string = DEFAULT_CHARACTER_ID
): StageEventPayload[] {
  const pack = getCachedCharacterPack(characterId);
  const bootReaction = pickReactionForEvent(pack, {
    type: 'session_started',
    sessionId: 'ses_dafeiyu_v4_01',
    at: 0,
  });

  const modelLabel = pack.recommendedModels?.[0] ?? 'deepseek-chat';

  return [
    {
      type: 'session_started',
      sessionId: 'ses_dafeiyu_v4_01',
      model: modelLabel,
      cwd: '/workspace/bigfish-login-app',
      characterId,
    },
    {
      type: 'character_line',
      lineId: `line_boot_${characterId}`,
      source: 'preset',
      characterId,
      emotion: bootReaction?.emotion ?? 'idle',
      text:
        bootReaction?.text ??
        defaultCharacterLine(pack),
    },
  ];
}

export const INITIAL_BOOT_EVENTS: StageEventPayload[] =
  buildInitialBootEvents(DEFAULT_CHARACTER_ID);

const LOGIN_TSX_READ_OUTPUT = `// src/pages/Login.tsx
import React, { useState } from 'react';
import { useTheme } from '../theme/ThemeContext';

export const Login: React.FC = () => {
  const { themeColor } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <main className="login-stage">
      <form className="login-card" aria-label="Big Fish Login">
        <h1>BIG FISH LOGIN</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="fish@bigfish.dev"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <button
          type="submit"
          className="login-submit-btn"
          style={{
            backgroundColor: '#64748B',
            borderColor: '#334155',
            color: '#F8FAFC',
          }}
        >
          SIGN IN // 登录潜入
        </button>
      </form>
    </main>
  );
};`;

const LOGIN_EDIT_DIFF_1 = `--- a/src/pages/Login.tsx
+++ b/src/pages/Login.tsx
@@ -22,11 +22,20 @@ export const Login: React.FC = () => {
         <button
           type="submit"
-          className="login-submit-btn"
+          className="login-submit-btn login-submit-btn--theme"
           style={{
-            backgroundColor: '#64748B',
-            borderColor: '#334155',
+            backgroundColor: themeColor || 'var(--color-theme-primary, #2563EB)',
+            borderColor: '#0A0A0C',
+            borderWidth: '3px',
+            borderStyle: 'solid',
+            borderRadius: '0px',
             color: '#FFFFFF',
+            boxShadow: '4px 4px 0px #0A0A0C',
+            fontWeight: 900,
+            letterSpacing: '0.08em',
+            textTransform: 'uppercase',
+            cursor: 'pointer',
+            transition: 'transform 120ms ease, box-shadow 120ms ease',
           }}
         >
           SIGN IN // 登录潜入
         </button>`;

const BASH_TEST_FAIL_OUTPUT = `$ npm test -- Login

> bigfish-login-app@0.1.0 test
> vitest run Login

 RUN  v2.1.4 /workspace/bigfish-login-app

 ❯ src/pages/__tests__/Login.test.tsx (3 tests | 1 failed) 184ms
   ✓ renders email and password fields (42ms)
   ✓ applies themeColor background to submit button (61ms)
   × exposes data-variant="theme-primary" attribute for theme regression suite (81ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pages/__tests__/Login.test.tsx > exposes data-variant="theme-primary" attribute for theme regression suite
AssertionError: expected <button class="login-submit-btn login-submit-btn--theme" ...> to have attribute 'data-variant' with value 'theme-primary', but got null

  29 |   const submitBtn = screen.getByRole('button', { name: /SIGN IN/i });
  30 |   expect(submitBtn).toHaveStyle({ backgroundColor: '#2563EB' });
> 31 |   expect(submitBtn).toHaveAttribute('data-variant', 'theme-primary');
     |                     ^

Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
  Duration  640ms`;

const LOGIN_EDIT_DIFF_2 = `--- a/src/pages/Login.tsx
+++ b/src/pages/Login.tsx
@@ -22,6 +22,8 @@ export const Login: React.FC = () => {
         <button
           type="submit"
           className="login-submit-btn login-submit-btn--theme"
+          data-variant="theme-primary"
+          data-theme-color={themeColor || '#2563EB'}
           style={{
             backgroundColor: themeColor || 'var(--color-theme-primary, #2563EB)',
             borderColor: '#0A0A0C',`;

const BASH_TEST_PASS_OUTPUT = `$ npm test -- Login

> bigfish-login-app@0.1.0 test
> vitest run Login

 RUN  v2.1.4 /workspace/bigfish-login-app

 ✓ src/pages/__tests__/Login.test.tsx (3 tests) 148ms
   ✓ renders email and password fields (35ms)
   ✓ applies themeColor background to submit button (54ms)
   ✓ exposes data-variant="theme-primary" attribute for theme regression suite (59ms)

Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  412ms (transform 48ms, setup 0ms, collect 112ms, tests 148ms)`;

/**
 * 第一阶段剧本：从用户发消息后到弹出 permission_request 之前（从角色包读取预置反应）
 */
export function buildPrePermissionSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
  const pack = getCachedCharacterPack(characterId);
  const startReaction = pickReactionForEvent(pack, {
    type: 'user_message',
    id: 'msg_1',
    text: '',
    at: 0,
  });
  const editReaction = pickReactionForEvent(pack, {
    type: 'tool_start',
    toolUseId: 'tool_edit_login_01',
    tool: 'edit',
    rawName: 'Edit',
    summary: 'Edit src/pages/Login.tsx',
    file: 'src/pages/Login.tsx',
    at: 0,
  });
  const permReaction = pickReactionForEvent(pack, {
    type: 'permission_request',
    requestId: 'perm_bash_login_test_01',
    tool: 'bash',
    rawName: 'Bash',
    summary: '执行登录页单元测试',
    detail: 'npm test -- Login',
    at: 0,
  });
  const firstNaviId =
    characterId === 'gemini-4-argon' ? 'claude-opus-5-5' : 'gemini-4-argon';
  const firstNaviText =
    firstNaviId === 'gemini-4-argon'
      ? '场外支援：这道主题色阴影焊缝很漂亮！别忘了跑一遍回归测试验验火候～'
      : '场外批注：按钮主题色令牌已就位，建议执行单元测试核验属性契约。';

  return [
    {
      delayMs: 320,
      event: {
        type: 'character_line',
        lineId: 'demo_line_start',
        source: 'preset',
        characterId,
        emotion: startReaction?.emotion ?? 'thinking',
        text:
          startReaction?.text ??
          '收到任务，先检查相关文件。',
      },
    },
    {
      delayMs: 650,
      event: {
        type: 'thinking',
      },
    },
    {
      delayMs: 700,
      event: {
        type: 'worker_text',
        text: 'Inspecting `src/pages/Login.tsx` to locate the submit button color styles and theme tokens.',
      },
    },
    {
      delayMs: 300,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_read_login_01',
        tool: 'read',
        rawName: 'Read',
        summary: 'Read src/pages/Login.tsx',
        file: 'src/pages/Login.tsx',
      },
    },
    {
      delayMs: 950,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_read_login_01',
        ok: true,
        summary: 'Read src/pages/Login.tsx (39 lines)',
        output: LOGIN_TSX_READ_OUTPUT,
      },
    },
    {
      delayMs: 600,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_edit_login_01',
        tool: 'edit',
        rawName: 'Edit',
        summary: 'Edit src/pages/Login.tsx',
        file: 'src/pages/Login.tsx',
      },
    },
    {
      delayMs: 450,
      event: {
        type: 'character_line',
        lineId: 'demo_line_edit',
        source: 'preset',
        characterId,
        emotion: editReaction?.emotion ?? 'working',
        text:
          editReaction?.text ??
          '正在修改相关代码。',
      },
    },
    {
      delayMs: 850,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_edit_login_01',
        ok: true,
        summary: 'Updated submit button to themeColor (+12 −3)',
        diff: LOGIN_EDIT_DIFF_1,
      },
    },
    {
      delayMs: 260,
      event: {
        type: 'context_usage',
        usedTokens: 46000,
        maxTokens: 1000000,
      },
    },
    {
      delayMs: 320,
      event: {
        type: 'sub_navigator_line',
        characterId: firstNaviId,
        emotion: 'happy',
        lineId: 'demo_navi_after_edit',
        text: firstNaviText,
      },
    },
    {
      delayMs: 550,
      event: {
        type: 'worker_text',
        text: 'Replaced hardcoded `#64748B` button background with `themeColor || var(--color-theme-primary, #2563EB)` in `src/pages/Login.tsx`. Requesting permission to run unit tests.',
      },
    },
    {
      delayMs: 300,
      event: {
        type: 'character_line',
        lineId: 'demo_line_perm',
        source: 'preset',
        characterId,
        emotion: permReaction?.emotion ?? 'shocked',
        text:
          permReaction?.text ??
          `即将运行终端命令，请${resolveUiCopy(pack).userTitle}确认允许或拒绝。`,
      },
    },
    {
      delayMs: 250,
      event: {
        type: 'permission_request',
        requestId: 'perm_bash_login_test_01',
        tool: 'bash',
        rawName: 'Bash',
        summary: '执行登录页单元测试',
        detail: 'npm test -- Login',
      },
    },
  ];
}

/**
 * 分支一：用户选择「允许」执行测试
 */
export function buildAllowBranchSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
  const pack = getCachedCharacterPack(characterId);
  const failReaction = pickReactionForEvent(pack, {
    type: 'tool_end',
    toolUseId: 'tool_bash_test_01',
    ok: false,
    summary: '1 failed, 2 passed (Login.test.tsx)',
    at: 0,
  });
  const doneReaction = pickReactionForEvent(pack, {
    type: 'turn_done',
    ok: true,
    summary: '登录页按钮已改为主题色，3 项单元测试全部通过',
    at: 0,
  });
  const secondNaviId =
    characterId === 'codex-dragon' ? 'claude-opus-5-5' : 'codex-dragon';
  const secondNaviText =
    secondNaviId === 'codex-dragon'
      ? '>_ 便签提醒：断言缺了 data-variant="theme-primary"。补两行就能过。'
      : '页边批注：测试在检查 data-variant="theme-primary" 属性，补上即可收工。';

  return [
    {
      delayMs: 120,
      event: {
        type: 'permission_resolved',
        requestId: 'perm_bash_login_test_01',
        allowed: true,
      },
    },
    {
      delayMs: 320,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_bash_test_01',
        tool: 'bash',
        rawName: 'Bash',
        summary: 'Run npm test -- Login',
      },
    },
    {
      delayMs: 1100,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_bash_test_01',
        ok: false,
        summary: '1 failed, 2 passed (Login.test.tsx)',
        output: BASH_TEST_FAIL_OUTPUT,
      },
    },
    {
      delayMs: 280,
      event: {
        type: 'sub_navigator_line',
        characterId: secondNaviId,
        emotion: 'thinking',
        lineId: 'demo_navi_test_hint',
        text: secondNaviText,
      },
    },
    {
      delayMs: 320,
      event: {
        type: 'character_line',
        lineId: 'demo_line_fail',
        source: 'preset',
        characterId,
        emotion: failReaction?.emotion ?? 'worried',
        text:
          failReaction?.text ??
          '有 1 项测试未通过，继续检查并修复。',
      },
    },
    {
      delayMs: 800,
      event: {
        type: 'worker_text',
        text: 'Test `exposes data-variant="theme-primary"` failed because `Login.tsx` is missing `data-variant="theme-primary"`. Patching `src/pages/Login.tsx` and re-running tests.',
      },
    },
    {
      delayMs: 320,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_edit_login_02',
        tool: 'edit',
        rawName: 'Edit',
        summary: 'Edit src/pages/Login.tsx (fix data-variant)',
        file: 'src/pages/Login.tsx',
      },
    },
    {
      delayMs: 900,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_edit_login_02',
        ok: true,
        summary: 'Added data-variant="theme-primary" (+2 −0)',
        diff: LOGIN_EDIT_DIFF_2,
      },
    },
    {
      delayMs: 450,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_bash_test_02',
        tool: 'bash',
        rawName: 'Bash',
        summary: 'Re-run npm test -- Login',
      },
    },
    {
      delayMs: 950,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_bash_test_02',
        ok: true,
        summary: '3 passed (3 total) in 412ms',
        output: BASH_TEST_PASS_OUTPUT,
      },
    },
    {
      delayMs: 180,
      event: {
        type: 'context_usage',
        usedTokens: 82000,
        maxTokens: 1000000,
      },
    },
    {
      delayMs: 400,
      event: {
        type: 'worker_text',
        final: true,
        text: 'Updated `src/pages/Login.tsx` submit button to use theme primary color (`#2563EB`) with `data-variant="theme-primary"`. All 3 tests in `Login.test.tsx` passed.',
      },
    },
    {
      delayMs: 300,
      event: {
        type: 'character_line',
        lineId: 'demo_line_done',
        source: 'preset',
        characterId,
        emotion: doneReaction?.emotion ?? 'happy',
        text:
          doneReaction?.text ??
          '修改完成，3 项测试全部通过。',
      },
    },
    {
      delayMs: 500,
      event: {
        type: 'turn_done',
        ok: true,
        summary: '登录页按钮已改为主题色，3 项单元测试全部通过',
        durationMs: 8800,
        costUsd: 0.018,
      },
    },
  ];
}

export interface DemoGitEntry {
  file: GitChangedFile;
  diff: string;
}

export const DEMO_INITIAL_GIT_ENTRIES: DemoGitEntry[] = [
  {
    file: {
      path: 'src/pages/Login.tsx',
      status: 'M',
      added: 14,
      removed: 3,
    },
    diff: `--- a/src/pages/Login.tsx
+++ b/src/pages/Login.tsx
@@ -22,11 +22,22 @@ export const Login: React.FC = () => {
         <button
           type="submit"
-          className="login-submit-btn"
+          className="login-submit-btn login-submit-btn--theme"
+          data-variant="theme-primary"
+          data-theme-color={themeColor || '#2563EB'}
           style={{
-            backgroundColor: '#64748B',
-            borderColor: '#334155',
+            backgroundColor: themeColor || 'var(--color-theme-primary, #2563EB)',
+            borderColor: '#0A0A0C',
+            borderWidth: '3px',
+            borderStyle: 'solid',
+            borderRadius: '0px',
             color: '#FFFFFF',
+            boxShadow: '4px 4px 0px #0A0A0C',
+            fontWeight: 900,
+            letterSpacing: '0.08em',
+            textTransform: 'uppercase',
+            cursor: 'pointer',
+            transition: 'transform 120ms ease, box-shadow 120ms ease',
           }}
         >
           SIGN IN // 登录潜入
         </button>`,
  },
  {
    file: {
      path: 'src/theme/ThemeContext.tsx',
      status: 'M',
      added: 5,
      removed: 1,
    },
    diff: `--- a/src/theme/ThemeContext.tsx
+++ b/src/theme/ThemeContext.tsx
@@ -8,7 +8,11 @@ export interface ThemeState {
   themeColor: string;
 }

-export const DEFAULT_THEME_COLOR = '#64748B';
+export const DEFAULT_THEME_COLOR = '#2563EB';
+export const P5_ACCENT_SHADOW = '4px 4px 0px #0A0A0C';
+export function resolvePrimaryToken(custom?: string): string {
+  return custom || DEFAULT_THEME_COLOR;
+}`,
  },
  {
    file: {
      path: 'src/pages/__tests__/Login.theme.test.tsx',
      status: 'A',
      added: 18,
      removed: 0,
    },
    diff: `--- /dev/null
+++ b/src/pages/__tests__/Login.theme.test.tsx
@@ -0,0 +1,18 @@
+import { render, screen } from '@testing-library/react';
+import { describe, expect, it } from 'vitest';
+import { Login } from '../Login';
+
+describe('Login P5 theme button', () => {
+  it('applies primary theme token and data-variant contract', () => {
+    render(<Login />);
+    const btn = screen.getByRole('button', { name: /SIGN IN/i });
+    expect(btn).toHaveAttribute('data-variant', 'theme-primary');
+    expect(btn).toHaveClass('login-submit-btn--theme');
+  });
+});`,
  },
];

/**
 * 分支二：用户选择「拒绝」执行测试
 */
export function buildRejectBranchSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
  const pack = getCachedCharacterPack(characterId);
  const rejectReaction = pickReactionForEvent(pack, {
    type: 'interrupted',
    reason: 'user rejected bash test',
    at: 0,
  });

  return [
    {
      delayMs: 120,
      event: {
        type: 'permission_resolved',
        requestId: 'perm_bash_login_test_01',
        allowed: false,
      },
    },
    {
      delayMs: 400,
      event: {
        type: 'worker_text',
        final: true,
        text: 'Skipped `npm test -- Login` as requested by user. The theme color update in `src/pages/Login.tsx` has been saved.',
      },
    },
    {
      delayMs: 350,
      event: {
        type: 'character_line',
        lineId: 'demo_line_reject',
        source: 'preset',
        characterId,
        emotion: 'worried',
        text:
          rejectReaction?.text ??
          '明白，已按要求跳过终端测试，代码修改已妥善保存。',
      },
    },
    {
      delayMs: 600,
      event: {
        type: 'turn_done',
        ok: true,
        summary: '登录页按钮已改为主题色（按用户要求跳过测试）',
        durationMs: 5200,
        costUsd: 0.009,
      },
    },
  ];
}
