import type { StageEvent } from '../shared/stage-events';
import { DEFAULT_CHARACTER_ID, HUD_MODEL_DISPLAY_NAME } from '../stage/reactions';

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

export const INITIAL_BOOT_EVENTS: StageEventPayload[] = [
  {
    type: 'session_started',
    sessionId: 'ses_dafeiyu_v4_01',
    model: HUD_MODEL_DISPLAY_NAME[DEFAULT_CHARACTER_ID],
    cwd: '/workspace/phantom-login-app',
  },
  {
    type: 'character_line',
    characterId: DEFAULT_CHARACTER_ID,
    emotion: 'idle',
    text: '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？（按 Enter 发送右下角指令即可开演！）',
  },
];

const LOGIN_TSX_READ_OUTPUT = `// src/pages/Login.tsx
import React, { useState } from 'react';
import { useTheme } from '../theme/ThemeContext';

export const Login: React.FC = () => {
  const { themeColor } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <main className="login-stage">
      <form className="login-card" aria-label="Phantom Login">
        <h1>PHANTOM ACCESS</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@phantom.dev"
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

> phantom-login-app@0.1.0 test
> vitest run Login

 RUN  v2.1.4 /workspace/phantom-login-app

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

> phantom-login-app@0.1.0 test
> vitest run Login

 RUN  v2.1.4 /workspace/phantom-login-app

 ✓ src/pages/__tests__/Login.test.tsx (3 tests) 148ms
   ✓ renders email and password fields (35ms)
   ✓ applies themeColor background to submit button (54ms)
   ✓ exposes data-variant="theme-primary" attribute for theme regression suite (59ms)

Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  412ms (transform 48ms, setup 0ms, collect 112ms, tests 148ms)`;

/**
 * 第一阶段剧本：从用户发消息后到弹出 permission_request 之前
 */
export function buildPrePermissionSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
  return [
    {
      delayMs: 350,
      event: {
        type: 'character_line',
        characterId,
        emotion: 'thinking',
        text: '（左手举起 max 牌子，右手举起 low 牌子，歪着脑袋一脸懵……）唔……为什么 max 的思考强度有时候还不如 low 捏？不管啦，大肥鱼马上帮你改登录页按钮捏！',
      },
    },
    {
      delayMs: 900,
      event: {
        type: 'thinking',
      },
    },
    {
      delayMs: 750,
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
      delayMs: 1100,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_read_login_01',
        ok: true,
        summary: 'Read src/pages/Login.tsx (39 lines)',
        output: LOGIN_TSX_READ_OUTPUT,
      },
    },
    {
      delayMs: 700,
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
      delayMs: 1200,
      event: {
        type: 'character_line',
        characterId,
        emotion: 'working',
        text: '如何使用 V4 Pro？很简单！首先，握住 Harness 娘，然后用力挥舞吧！把灰扑扑的按钮统统刷成深海主题色捏！',
      },
    },
    {
      delayMs: 950,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_edit_login_01',
        ok: true,
        summary: 'Updated submit button to themeColor (+12 −3)',
        diff: LOGIN_EDIT_DIFF_1,
      },
    },
    {
      delayMs: 650,
      event: {
        type: 'worker_text',
        text: 'Replaced hardcoded `#64748B` button background with `themeColor || var(--color-theme-primary, #2563EB)` in `src/pages/Login.tsx`. Requesting permission to run unit tests.',
      },
    },
    {
      delayMs: 550,
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
 * 测试 1 个失败 -> worried -> edit 修复 -> bash 全部通过 -> happy -> turn_done ok
 */
export function buildAllowBranchSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
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
      delayMs: 350,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_bash_test_01',
        tool: 'bash',
        rawName: 'Bash',
        summary: 'Run npm test -- Login',
      },
    },
    {
      delayMs: 1300,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_bash_test_01',
        ok: false,
        summary: '1 failed, 2 passed (Login.test.tsx)',
        output: BASH_TEST_FAIL_OUTPUT,
      },
    },
    {
      delayMs: 400,
      event: {
        type: 'character_line',
        characterId,
        emotion: 'worried',
        text: '呜哇，报错了捏……1 个测试挂掉了，我先抱起纸箱收拾东西跑路了捏！……诶不对，只是少了个 data-variant 属性，再挥两下 Harness 娘肯定能跑通！',
      },
    },
    {
      delayMs: 900,
      event: {
        type: 'worker_text',
        text: 'Test `exposes data-variant="theme-primary"` failed because `Login.tsx` is missing `data-variant="theme-primary"`. Patching `src/pages/Login.tsx` and re-running tests.',
      },
    },
    {
      delayMs: 350,
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
      delayMs: 1050,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_edit_login_02',
        ok: true,
        summary: 'Added data-variant="theme-primary" (+2 −0)',
        diff: LOGIN_EDIT_DIFF_2,
      },
    },
    {
      delayMs: 500,
      event: {
        type: 'tool_start',
        toolUseId: 'tool_bash_test_02',
        tool: 'bash',
        rawName: 'Bash',
        summary: 'Re-run npm test -- Login',
      },
    },
    {
      delayMs: 1150,
      event: {
        type: 'tool_end',
        toolUseId: 'tool_bash_test_02',
        ok: true,
        summary: '3 passed (3 total) in 412ms',
        output: BASH_TEST_PASS_OUTPUT,
      },
    },
    {
      delayMs: 450,
      event: {
        type: 'worker_text',
        final: true,
        text: 'Updated `src/pages/Login.tsx` submit button to use theme primary color (`#2563EB`) with `data-variant="theme-primary"`. All 3 tests in `Login.test.tsx` passed.',
      },
    },
    {
      delayMs: 350,
      event: {
        type: 'character_line',
        characterId,
        emotion: 'happy',
        text: '搞定啦！3 个测试全部绿灯通过，不管怎么说，小鲸鱼是没有错的捏！走，我再给你叭叭叭介绍一整下午的蒸汽机车！',
      },
    },
    {
      delayMs: 600,
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
 * permission_resolved false -> character_line worried -> turn_done ok
 */
export function buildRejectBranchSteps(
  characterId: string = DEFAULT_CHARACTER_ID
): ScriptStep[] {
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
        characterId,
        emotion: 'worried',
        text: '唔……明白捏！既然店长拒绝了终端权限，那大肥鱼就乖乖放下 Harness 娘、不跑 `npm test -- Login` 啦。不过登录页按钮的主题色已经改好保存了捏！',
      },
    },
    {
      delayMs: 650,
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
