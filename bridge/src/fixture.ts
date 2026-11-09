import { existsSync, writeFileSync } from 'node:fs';
import { runtime } from './runtime';
const { cwd } = runtime();
const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'bridge-fixture', private: true, type: 'module', scripts: { test: 'node --test add.test.js' } }) + '\n',
  'add.js': 'export function add(a, b) {\n  return a - b;\n}\n',
  'add.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './add.js';\ntest('adds positive integers', () => assert.equal(add(2, 3), 5));\n",
  'long-command.cjs': "const { writeFileSync } = require('node:fs');\nsetTimeout(() => { writeFileSync(process.argv[2], String(process.pid)); console.log('LONG_COMMAND_FINISHED'); }, 20000);\n",
};
for (const [name, text] of Object.entries(files)) {
  const file = `${cwd}/${name}`;
  if (existsSync(file) && !process.argv.includes('--reset')) continue;
  writeFileSync(file, text);
}
console.error(`测试项目已准备：${cwd}；--reset 可恢复故意写错的 add.js`);
