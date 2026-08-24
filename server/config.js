// 配置加载器：项目根 config.json + 环境变量（PRD §7：key 只走环境变量）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let _cfg = null;

export function load() {
  if (_cfg) return _cfg;
  const defaults = {
    vaultRoot: "",
    notesRelDir: "微信读书笔记",
    attachmentsRelDir: "attachments",
    gateway: "https://i.weread.qq.com/api/agent/gateway",
    skillVersion: "1.0.5",
    requestDelayMs: 200,
  };
  const file = path.join(ROOT, "config.json");
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (e) {
      console.error("[config] config.json 解析失败，使用默认值:", e.message);
    }
  }
  _cfg = { ...defaults, ...user };
  if (!_cfg.vaultRoot) {
    throw new Error("config.json 缺少 vaultRoot（Obsidian 库根目录）");
  }
  return _cfg;
}

export function vaultRoot() {
  // 环境变量覆盖（测试沙盒用）；正常使用读 config.json。
  // 相对路径按项目根解析（多设备约定：库克隆在工具旁边，如 ../obsidian_cangku，
  // 绝对路径写法仍兼容——path.resolve 遇到带盘符的绝对路径会自动忽略基准）。
  return path.resolve(ROOT, process.env.WEREAD_VAULT_ROOT || load().vaultRoot);
}

export function notesDir() {
  return path.join(vaultRoot(), load().notesRelDir);
}

export function attachmentsDir() {
  return path.join(notesDir(), load().attachmentsRelDir);
}

/**
 * API key：优先环境变量 WEREAD_API_KEY，兜底从 ~/.bashrc / ~/.profile 解析
 * （非交互 shell 可能没 source 过 rc 文件，与 treeboat refresh.py 同一套兜底逻辑）
 */
export function getKey() {
  const env = process.env.WEREAD_API_KEY;
  if (env) return env;
  for (const f of [path.join(os.homedir(), ".bashrc"), path.join(os.homedir(), ".profile")]) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, "utf-8");
    const m = txt.match(/WEREAD_API_KEY\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return null;
}
