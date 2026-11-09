import type { StageEvent } from '../shared/stage-events';
import {
  DEFAULT_CHARACTER_ID,
  getCachedCharacterPack,
  pickReactionForEvent,
} from '../stage/characterLoader';

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

  const modelLabel = pack.recommendedModels?.[0] ?? 'gpt-6.1-sol';

  return [
    {
      type: 'session_started',
      sessionId: 'ses_dafeiyu_v4_01',
      model: modelLabel,
      cwd: '/workspace/bigfish-login-app',
    },
    {
      type: 'character_line',
      lineId: `line_boot_${characterId}`,
      source: 'preset',
      characterId,
      emotion: bootReaction?.emotion ?? 'idle',
      text:
        bootReaction?.text ??
        '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
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
          '（左手举起 max 牌子，右手举起 low 牌子，歪着脑袋一脸懵……）收到指令捏！',
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
          '如何使用 V4 Pro？很简单！首先，握住 Harness 娘，然后用力挥舞吧！',
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
          '店长店长！前面要跑终端命令了捏，快帮大肥鱼拍板：到底是【允许】还是【拒绝】捏？',
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
      delayMs: 320,
      event: {
        type: 'character_line',
        lineId: 'demo_line_fail',
        source: 'preset',
        characterId,
        emotion: failReaction?.emotion ?? 'worried',
        text:
          failReaction?.text ??
          '呜哇，报错了捏……1 个测试挂掉了，我先抱起纸箱收拾东西跑路了捏！',
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
          '搞定啦！3 个测试全部绿灯通过，不管怎么说，小鲸鱼是没有错的捏！',
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
          characterId === 'deepseek-v4-pro'
            ? '唔……明白捏！既然店长拒绝了终端权限，那大肥鱼就乖乖放下 Harness 娘、不跑 `npm test -- Login` 啦。不过登录页按钮的主题色已经改好保存了捏！'
            : rejectReaction?.text ??
              '明白，已按店长要求跳过终端测试，代码修改已妥善保存。',
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
