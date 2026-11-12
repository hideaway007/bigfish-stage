#!/usr/bin/env node
/**
 * Build host entry (lib/index.js) and client bundle (lib/client.js) in the
 * dsh-client-modules wire format:
 *   window.__ModuleLoader__.load({ id, factory(require){ ... } })
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

const rootPkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const rootBundleDir = join(repoRoot, 'dsh-bundle');

await mkdir(join(here, 'lib'), { recursive: true });
await mkdir(rootBundleDir, { recursive: true });

const cssFiles = [
  'src/stage/stage.css',
  'src/stage/cutins.css',
  'src/stage/polish.css',
  'src/stage/backlog.css',
  'src/stage/diffViewer.css',
  'src/stage/shortcutHelp.css',
  'src/stage/onboarding.css',
  'src/stage/components/SessionListModal.css',
  'src/stage/components/settings/settings.css',
];

const rawCssParts = await Promise.all(
  cssFiles.map((rel) => readFile(join(repoRoot, rel), 'utf8'))
);

let combinedCss = rawCssParts.join('\n\n');
combinedCss = combinedCss
  .replace(
    /\*,\s*\*::before,\s*\*::after\s*\{/g,
    '.p5-dsh-host *, .p5-dsh-host *::before, .p5-dsh-host *::after {'
  )
  .replace(/html,\s*body,\s*#root\s*\{/g, '.p5-dsh-host {');

combinedCss += `
/* ── P5 Phantom Sidebar & Top Session Header Shell Overrides ── */
[class*="sidebarCol"] {
  background-color: #07080e !important;
  border-right: none !important;
}
html:is([data-bigfish-mac-app="1"], [data-platform="darwin"]):not([data-fullscreen]):not([data-bigfish-fullscreen="1"]) .p5-phantom-sidebar {
  padding-top: 38px !important;
}
html:is([data-bigfish-mac-app="1"], [data-platform="darwin"]):not([data-fullscreen]):not([data-bigfish-fullscreen="1"]) .p5-phantom-sidebar.is-collapsed {
  padding-top: 44px !important;
}

/* Remove broken double-offset on [data-shell-leading] and align precisely across Windowed vs Fullscreen! */
[data-shell-leading] {
  margin-left: 0 !important;
  z-index: 65 !important;
}

/* 1) macOS Windowed (traffic lights present at x:16..74px, y:14..28px) when sidebar is collapsed/drawer */
html:is([data-bigfish-mac-app="1"], [data-platform="darwin"]):not([data-fullscreen]):not([data-bigfish-fullscreen="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]) [data-shell-leading] {
  top: 10px !important;
  left: 82px !important;
}
/* Give left stage column clean top clearance below traffic lights + [▶ 档案] when no active-session header sits above */
html:is([data-bigfish-mac-app="1"], [data-platform="darwin"]):not([data-fullscreen]):not([data-bigfish-fullscreen="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]) [class*="_centerCol"]:not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) .p5-stage-viewport.is-dsh-embedded .p5-left-column {
  padding-top: 44px !important;
}
/* Preserve top window-drag strip on macOS windowed mode when blank header is hidden */
html:is([data-bigfish-mac-app="1"], [data-platform="darwin"]):not([data-fullscreen]):not([data-bigfish-fullscreen="1"]) [class*="_centerCol"]:not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) .p5-stage-viewport.is-dsh-embedded::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 34px;
  -webkit-app-region: drag;
  z-index: 15;
  pointer-events: auto;
}
.p5-stage-viewport.is-dsh-embedded .p5-workspace-header,
.p5-stage-viewport.is-dsh-embedded .p5-brand-strip,
.p5-stage-viewport.is-dsh-embedded button,
.p5-stage-viewport.is-dsh-embedded input,
.p5-stage-viewport.is-dsh-embedded textarea,
.p5-stage-viewport.is-dsh-embedded a {
  -webkit-app-region: no-drag;
}

/* 2) Fullscreen mode OR non-macOS Web (no traffic lights!) when sidebar is collapsed/drawer:
      Place [▶ 档案] flush inline on the exact same horizontal row as [P5 AGENT STAGE]! */
html:is([data-fullscreen], [data-bigfish-fullscreen="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]) [class*="_centerCol"]:has(.p5-dsh-host):not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) ~ [data-shell-leading],
html:is([data-fullscreen], [data-bigfish-fullscreen="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]):has(.p5-dsh-host):not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) [data-shell-leading],
html:not([data-platform="darwin"]):not([data-bigfish-mac-app="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]):has(.p5-dsh-host):not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) [data-shell-leading] {
  top: 20px !important;
  left: 22px !important;
}
html:is([data-fullscreen], [data-bigfish-fullscreen="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]) [class*="_centerCol"]:not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) .p5-stage-viewport.is-dsh-embedded .p5-brand-strip,
html:not([data-platform="darwin"]):not([data-bigfish-mac-app="1"]) :is([data-sidebar-collapsed], [data-sidebar-drawer]) [class*="_centerCol"]:not(:has(header[class*="_header"]:not([class*="_headerBlank"]))) .p5-stage-viewport.is-dsh-embedded .p5-brand-strip {
  padding-left: 84px !important;
}
.p5-phantom-sidebar .p5-sb-new-btn:hover {
  transform: rotate(-0.8deg) scale(1.018);
  transition: transform 0.12s ease;
}
.p5-phantom-sidebar .p5-sb-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(230, 0, 18, 0.55) transparent;
}
.p5-phantom-sidebar .p5-sb-scroll::-webkit-scrollbar {
  width: 5px;
}
.p5-phantom-sidebar .p5-sb-scroll::-webkit-scrollbar-thumb {
  background: rgba(230, 0, 18, 0.55);
  border-radius: 0;
}

/* Center column & Top Header irregular quadrilateral tabs */
[class*="sidebarCol"] {
  z-index: 2 !important;
}
[class*="_centerCol"] {
  background-color: #090910 !important;
}
/* Ensure full-screen P5 modals (Settings, Backlog, Archive, Permissions, Shortcuts) always stack above the left sidebar! */
[class*="_centerCol"]:has([role="dialog"]),
[class*="_mainPanel"]:has([role="dialog"]) {
  position: relative !important;
  z-index: 900 !important;
}
/* Always hide empty blank header on P5 stage (both sidebar open AND collapsed) so red/black stage fills 100% top-to-bottom! */
[class*="_centerCol"]:has(.p5-dsh-host) header[class*="_headerBlank"] {
  display: none !important;
}
header[class$="_header"]:not([class*="_headerBlank"]) {
  min-height: 40px !important;
  padding: 6px 18px 6px 20px !important;
}
header[class$="_header"] {
  background: linear-gradient(90deg, #090910 0%, #16070d 55%, #090910 100%) !important;
  border-bottom: 2px solid #e60012 !important;
  color: #f8fafc !important;
}
header[class$="_header"] [class$="_titleRow"] { gap: 10px !important; }
header[class$="_header"] [class$="_crumbCurrent"] {
  display: inline-block;
  background: #ffffff !important;
  color: #090910 !important;
  font-weight: 900 !important;
  letter-spacing: 0.04em;
  padding: 2px 14px !important;
  clip-path: polygon(5% 0%, 100% 10%, 95% 100%, 0% 90%);
  filter: drop-shadow(3px 3px 0 #e60012);
}
header[class$="_header"] [class$="_headerActions"] button,
header[class$="_header"] [class$="_headerActions"] > * {
  background: #090910 !important;
  color: #fde047 !important;
  border: 1.5px solid #fde047 !important;
  border-radius: 0 !important;
  font-weight: 900 !important;
  clip-path: polygon(6% 0%, 100% 8%, 94% 100%, 0% 92%);
  padding: 1px 10px !important;
}
header[class$="_header"] [class$="_headerActions"] svg { color: #fde047 !important; }
header[class$="_header"] [role="tab"] {
  background: #121522 !important;
  color: #cbd5e1 !important;
  border: 1.5px solid rgba(255, 255, 255, 0.45) !important;
  border-radius: 0 !important;
  clip-path: polygon(7% 8%, 100% 0%, 93% 92%, 0% 100%);
  font-weight: 900 !important;
  padding: 3px 14px !important;
  margin-right: 8px !important;
  transition: all 0.13s ease !important;
}
header[class$="_header"] [role="tab"]:hover {
  color: #ffffff !important;
  background: #2b0a13 !important;
  border-color: #ffffff !important;
}
header[class$="_header"] [role="tab"][aria-selected="true"] {
  background: #e60012 !important;
  color: #ffffff !important;
  border: 2px solid #ffffff !important;
  filter: drop-shadow(3px 3px 0 #000000);
}
header[class$="_header"] [role="tab"]::after {
  display: none !important;
}

/* ── DSH Embedded Host Overrides (STAGE tab + Blank New Session) ── */
[data-conversation-content]:has(.p5-dsh-host) {
  padding: 0 !important;
  overflow: hidden !important;
}
[data-conversation-content] [data-conversation-scroll]:has(.p5-dsh-host) {
  padding: 0 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
}
[data-conversation-content]:not(:has(.p5-dsh-blank-stage)):has(.p5-dsh-host) [data-conversation-scroll] > :not([data-composer-seat]),
[data-conversation-content]:not(:has(.p5-dsh-blank-stage)):has(.p5-dsh-host) [class*="viewArea"] {
  padding: 0 !important;
  margin: 0 !important;
  max-width: none !important;
  width: 100% !important;
  height: 100% !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
}
[data-conversation-content]:not(:has(.p5-dsh-blank-stage)):has(.p5-dsh-host) [data-composer-seat]:not(:has([class*="ApprovalPanel"])) {
  display: none !important;
}
[data-conversation-content]:has(.p5-dsh-blank-stage) > [data-conversation-scroll] > [data-composer-seat] {
  position: relative !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  padding: 0 !important;
  margin: 0 !important;
  flex: 1 1 auto !important;
  display: flex !important;
  flex-direction: column !important;
}
[data-conversation-content]:has(.p5-dsh-blank-stage) [data-composer-seat] div:has(.p5-dsh-blank-stage) {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  padding: 0 !important;
  margin: 0 !important;
  gap: 0 !important;
  flex: 1 1 auto !important;
  display: flex !important;
  flex-direction: column !important;
}
[data-conversation-content]:has(.p5-dsh-blank-stage) [class*="composerStack"] > :not(:has(.p5-dsh-blank-stage)):not(.p5-dsh-blank-stage),
[data-conversation-content]:has(.p5-dsh-blank-stage) [class*="HeroShell"],
[data-conversation-content]:has(.p5-dsh-blank-stage) [class*="heroWorkspaceRow"] {
  display: none !important;
}
.p5-dsh-blank-stage {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}
.p5-dsh-host {
  width: 100%;
  height: 100%;
  min-height: 500px;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.p5-dsh-host .p5-stage-viewport.is-dsh-embedded {
  width: 100% !important;
  height: 100% !important;
  flex: 1 1 auto;
  min-height: 500px;
}
.p5-dsh-host .eng-view {
  width: 100% !important;
  height: 100% !important;
}
`;

await build({
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(here, 'lib/index.js'),
});

await build({
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(rootBundleDir, 'index.js'),
});

async function buildWrappedClient(packageId, outPath) {
  const result = await build({
    entryPoints: [join(here, 'src/client/index.tsx')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'transform',
    loader: {
      '.css': 'empty',
    },
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: {
      __P5_STAGE_CSS__: JSON.stringify(combinedCss),
      __P5_PACKAGE_ID__: JSON.stringify(packageId),
    },
    write: false,
    minify: false,
    sourcemap: false,
  });

  const body = result.outputFiles[0].text;
  const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(packageId)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body.replace(/^/gm, '\t\t')}
\t\treturn module.exports;
\t}
});
`;
  await writeFile(outPath, wrapped);
  return wrapped.length;
}

const subBytes = await buildWrappedClient(pkg.name, join(here, 'lib/client.js'));
const rootBytes = await buildWrappedClient(rootPkg.name, join(rootBundleDir, 'client.js'));

console.log(`built ${pkg.name} → lib/index.js + lib/client.js (${subBytes} bytes)`);
console.log(`built ${rootPkg.name} → dsh-bundle/index.js + dsh-bundle/client.js (${rootBytes} bytes)`);
