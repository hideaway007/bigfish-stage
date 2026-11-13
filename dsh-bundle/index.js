// packages/dsh-client-ui-p5stage/src/index.ts
import { existsSync } from "node:fs";

// packages/dsh-client-ui-p5stage/src/stage-api.ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath as realpath2, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute2, join } from "node:path";

// server/src/git-ops.ts
import { execFile } from "node:child_process";
import { realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
var runFile = promisify(execFile);
async function resolveSafeTarget(cwd, relPath) {
  const cleanRel = relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleanRel || cleanRel === ".git" || cleanRel.startsWith(".git/") || cleanRel.split("/").includes("..")) {
    throw new Error("\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5B89\u5168\u6216\u4E0D\u5141\u8BB8\u64CD\u4F5C .git \u76EE\u5F55");
  }
  const root = await realpath(cwd);
  const candidate = resolve(root, cleanRel);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("\u6587\u4EF6\u8DEF\u5F84\u8D8A\u51FA\u5F53\u524D\u5DE5\u4F5C\u533A\u8FB9\u754C");
  }
  return { root, safeRel: rel.replace(/\\/g, "/"), fullPath: candidate };
}
async function getGitStatus(cwd) {
  try {
    const root = await realpath(cwd);
    const inside = await runFile("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { timeout: 5e3 }).catch(() => null);
    if (!inside || inside.stdout.trim() !== "true") {
      return { isRepo: false, files: [], diff: "", error: "\u5F53\u524D\u6587\u4EF6\u5939\u4E0D\u662F Git \u4ED3\u5E93" };
    }
    const branchRes = await runFile("git", ["-C", root, "branch", "--show-current"], { timeout: 4e3 }).catch(() => ({ stdout: "" }));
    const branch = branchRes.stdout.trim() || "HEAD";
    const statusRes = await runFile("git", ["-C", root, "status", "--porcelain", "-uall"], { timeout: 6e3 });
    const numstatMap = /* @__PURE__ */ new Map();
    const numstatRes = await runFile("git", ["-C", root, "diff", "--numstat", "HEAD"], { timeout: 6e3 }).catch(() => runFile("git", ["-C", root, "diff", "--numstat"], { timeout: 6e3 })).catch(() => ({ stdout: "" }));
    for (const line of numstatRes.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [addStr, delStr, ...rest] = line.split("	");
      const filePath = rest.join("	").trim();
      if (!filePath) continue;
      numstatMap.set(filePath, {
        added: Number.isFinite(Number(addStr)) ? Number(addStr) : 0,
        removed: Number.isFinite(Number(delStr)) ? Number(delStr) : 0
      });
    }
    const files = [];
    for (const rawLine of statusRes.stdout.split(/\r?\n/)) {
      if (rawLine.length < 4) continue;
      const xy = rawLine.slice(0, 2);
      let filePath = rawLine.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop().trim();
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      let status = "M";
      if (xy === "??") status = "?";
      else if (xy.includes("A")) status = "A";
      else if (xy.includes("D")) status = "D";
      else if (xy.includes("R")) status = "R";
      const stats = numstatMap.get(filePath) ?? { added: 0, removed: 0 };
      files.push({
        path: filePath,
        status,
        added: stats.added,
        removed: stats.removed
      });
    }
    const diffRes = await runFile("git", ["-C", root, "diff", "HEAD"], { timeout: 8e3, maxBuffer: 4 * 1024 * 1024 }).catch(() => runFile("git", ["-C", root, "diff"], { timeout: 8e3, maxBuffer: 4 * 1024 * 1024 })).catch(() => ({ stdout: "" }));
    return {
      isRepo: true,
      branch,
      files,
      diff: diffRes.stdout.slice(0, 6e4)
    };
  } catch (error) {
    return {
      isRepo: false,
      files: [],
      diff: "",
      error: error.message
    };
  }
}
async function revertGitFile(cwd, relPath) {
  try {
    const { root, safeRel, fullPath } = await resolveSafeTarget(cwd, relPath);
    const tracked = await runFile("git", ["-C", root, "ls-files", "--error-unmatch", "--", safeRel], { timeout: 4e3 }).then(() => true).catch(() => false);
    if (tracked) {
      await runFile("git", ["-C", root, "checkout", "HEAD", "--", safeRel], { timeout: 6e3 }).catch(() => runFile("git", ["-C", root, "checkout", "--", safeRel], { timeout: 6e3 }));
      return { ok: true, message: `\u5DF2\u64A4\u56DE\u6587\u4EF6\u6539\u52A8\uFF1A${safeRel}` };
    }
    const st = await stat(fullPath).catch(() => null);
    if (st && st.isFile()) {
      const realFile = await realpath(fullPath);
      const checkRel = relative(root, realFile);
      if (checkRel.startsWith("..") || isAbsolute(checkRel)) {
        throw new Error("\u62D2\u7EDD\u5220\u9664\u5DE5\u4F5C\u533A\u5916\u90E8\u8F6F\u94FE\u76EE\u6807");
      }
      await rm(realFile, { force: true });
      return { ok: true, message: `\u5DF2\u6E05\u7406\u672A\u8DDF\u8E2A\u65B0\u5EFA\u6587\u4EF6\uFF1A${safeRel}` };
    }
    return { ok: false, message: `\u672A\u627E\u5230\u9700\u8981\u64A4\u56DE\u7684\u6587\u4EF6\uFF1A${safeRel}` };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}
async function commitGitAll(cwd, message) {
  const cleanMsg = message.trim();
  if (!cleanMsg || cleanMsg.length > 500) {
    return { ok: false, message: "\u8BF7\u586B\u5199 1~500 \u5B57\u7684\u63D0\u4EA4\u8BF4\u660E" };
  }
  try {
    const root = await realpath(cwd);
    await runFile("git", ["-C", root, "add", "-A"], { timeout: 8e3 });
    const status = await runFile("git", ["-C", root, "status", "--porcelain"], { timeout: 5e3 });
    if (!status.stdout.trim()) {
      return { ok: false, message: "\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u63D0\u4EA4\u7684\u6539\u52A8" };
    }
    const commitRes = await runFile("git", ["-C", root, "commit", "-m", cleanMsg], { timeout: 1e4 });
    const firstLine = commitRes.stdout.trim().split(/\r?\n/)[0] || cleanMsg;
    return { ok: true, message: `\u63D0\u4EA4\u6210\u529F\uFF1A${firstLine}` };
  } catch (error) {
    return { ok: false, message: `Git \u63D0\u4EA4\u5931\u8D25\uFF1A${error.message}` };
  }
}

// packages/dsh-client-ui-p5stage/src/stage-api.ts
var characterIds = /* @__PURE__ */ new Set(["deepseek-v4-pro", "gemini-4-argon", "claude-opus-5-5", "codex-dragon"]);
function createStageApi(directory = join(homedir(), ".config/bigfish-stage/dsh-rooms")) {
  const queues = /* @__PURE__ */ new Map();
  return async (request) => {
    const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
    try {
      if (request.method !== "POST") return json({ error: "\u4EC5\u652F\u6301 POST" }, 405);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "\u9700\u8981 JSON \u8BF7\u6C42" }, 415);
      const text = await request.text();
      if (text.length > 32768) return json({ error: "\u8BF7\u6C42\u8FC7\u5927" }, 413);
      const input = JSON.parse(text);
      if (!input || typeof input.cwd !== "string" || !isAbsolute2(input.cwd)) throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u672C\u5730\u9879\u76EE\u76EE\u5F55");
      const cwd = await realpath2(input.cwd);
      const file = join(directory, `${createHash("sha256").update(cwd).digest("hex")}.json`);
      const load = async () => {
        try {
          return JSON.parse(await readFile(file, "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") return {};
          throw error;
        }
      };
      if (input.op === "rooms_get") {
        await queues.get(file);
        return json(await load());
      }
      if (input.op === "rooms_patch") {
        if (!characterIds.has(input.characterId)) throw new Error("\u89D2\u8272\u4E0D\u5B58\u5728");
        const patch = {};
        for (const key of ["model", "sessionId"]) {
          if (input[key] !== void 0) {
            if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 256) throw new Error("\u89D2\u8272\u914D\u7F6E\u65E0\u6548");
            patch[key] = input[key].trim();
          }
        }
        const save = async () => {
          const rooms = await load();
          rooms[input.characterId] = { ...rooms[input.characterId], ...patch };
          await mkdir(directory, { recursive: true, mode: 448 });
          const temp = `${file}.${randomUUID()}.tmp`;
          await writeFile(temp, JSON.stringify(rooms), { mode: 384 });
          await rename(temp, file);
          return rooms;
        };
        const next = (queues.get(file) ?? Promise.resolve()).then(save, save);
        queues.set(file, next.catch(() => {
        }));
        return json(await next);
      }
      if (input.op === "git_status") return json(await getGitStatus(cwd));
      if (input.op === "git_revert") {
        if (typeof input.path !== "string" || input.path.length > 1e3) throw new Error("\u6587\u4EF6\u8DEF\u5F84\u65E0\u6548");
        return json(await revertGitFile(cwd, input.path));
      }
      if (input.op === "git_commit") {
        if (typeof input.message !== "string") throw new Error("\u63D0\u4EA4\u8BF4\u660E\u65E0\u6548");
        return json(await commitGitAll(cwd, input.message));
      }
      return json({ error: "\u4E0D\u652F\u6301\u7684\u64CD\u4F5C" }, 400);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25" }, 400);
    }
  };
}

// packages/dsh-client-ui-p5stage/src/index.ts
import { readFile as readFile2, stat as stat2 } from "node:fs/promises";
import { extname, join as join2, resolve as resolve2, sep } from "node:path";
import { fileURLToPath } from "node:url";
var MIME_TYPES = {
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".moc3": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".md": "text/markdown; charset=utf-8"
};
var pkgDir = resolve2(fileURLToPath(new URL("..", import.meta.url)));
var repoPublicDir = [resolve2(pkgDir, "public"), resolve2(pkgDir, "../../public")].find(
  (dir) => existsSync(join2(dir, "characters"))
) ?? resolve2(pkgDir, "public");
function createStaticPrefixResource(mountPrefix, rootDir) {
  const normalizedRoot = resolve2(rootDir);
  return async (request) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const rel = pathname.startsWith(mountPrefix) ? pathname.slice(mountPrefix.length).replace(/^\/+/, "") : "";
    if (!rel) {
      return new Response("Not Found", { status: 404 });
    }
    const targetPath = resolve2(join2(normalizedRoot, rel));
    if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const info = await stat2(targetPath);
      if (!info.isFile()) {
        return new Response("Not Found", { status: 404 });
      }
      const ext = extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-length": String(info.size),
            "cache-control": "no-cache"
          }
        });
      }
      const bytes = await readFile2(targetPath);
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(bytes.byteLength),
          "cache-control": "no-cache"
        }
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  };
}
function dualRoute(path, resource) {
  return {
    kind: "prefix",
    path,
    resource,
    async handler(req, res) {
      try {
        const response = await resource(new Request(new URL(req.url ?? "/", "http://localhost"), { method: req.method ?? "GET" }));
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(400);
        res.end();
      }
    }
  };
}
var name = "ui-p5stage-host";
var inject = ["webServer", "connection"];
var HEAD_FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=JetBrains+Mono:wght@500;700;800&family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet" />'
].join("");
function apply(ctx) {
  if (!ctx.webServer) return;
  if (ctx.connection?.fetch?.register) {
    ctx.connection.fetch.register({ path: "/api/bigfish-stage", methods: ["POST"], requestBody: "buffered", fetch: createStageApi() });
  }
  const charactersDir = join2(repoPublicDir, "characters");
  const sfxDir = join2(repoPublicDir, "sfx");
  ctx.effect(
    () => ctx.webServer.register(dualRoute("/characters", createStaticPrefixResource("/characters", charactersDir)))
  );
  ctx.effect(
    () => ctx.webServer.register(dualRoute("/sfx", createStaticPrefixResource("/sfx", sfxDir)))
  );
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: HEAD_FONT_LINKS
    });
  });
}
export {
  apply,
  dualRoute,
  inject,
  name
};
