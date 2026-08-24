// package.mjs — 打包免构建发布 zip（GitHub Releases 用）
// 内容 = git 追踪的全部源码 + 已构建的 web/dist；不含 node_modules/.cache/config.json/.git
// 用户解压后仍需一次 `npm install`（装 express 等后端依赖），前端无需构建。
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const OUT = path.join(ROOT, `weread-workbench-v${pkg.version}.zip`);

if (!fs.existsSync(path.join(ROOT, "web", "dist", "index.html"))) {
  console.error("web/dist 不存在：请先 npm run build 再打包");
  process.exit(1);
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wrwb-pkg-"));
const dir = path.join(stage, "weread-workbench");
fs.mkdirSync(dir, { recursive: true });

// -z：NUL 分隔且不做引号转义，中文文件名（启动读书工作台.bat 等）安全
const files = execSync("git ls-files -z", { cwd: ROOT })
  .toString("utf-8")
  .split("\0")
  .filter(Boolean);
for (const f of files) {
  const dest = path.join(dir, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), dest);
}
fs.cpSync(path.join(ROOT, "web", "dist"), path.join(dir, "web", "dist"), { recursive: true });
fs.cpSync(path.join(ROOT, "web", "package.json"), path.join(dir, "web", "package.json"));

console.log(`打包 ${files.length + 1} 项（含 web/dist）...`);
try {
  execSync(
    `powershell.exe -NoProfile -Command "Compress-Archive -Path '${dir.replace(/\\/g, "\\")}' -DestinationPath '${OUT.replace(/\\/g, "\\")}' -Force"`,
    { stdio: "inherit" },
  );
} catch {
  execSync(`cd "${stage}" && zip -qr "${OUT}" weread-workbench`, { stdio: "inherit" });
}
fs.rmSync(stage, { recursive: true, force: true });
console.log(`完成: ${OUT}`);
