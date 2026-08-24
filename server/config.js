// 配置加载器：项目根 config.json + 环境变量（PRD §7：key 只走环境变量）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let _cfg = null;

function configFile() {
  // 环境变量覆盖（测试沙盒用）
  return process.env.WEREAD_CONFIG || path.join(ROOT, "config.json");
}

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
  let user = {};
  if (fs.existsSync(configFile())) {
    try {
      user = JSON.parse(fs.readFileSync(configFile(), "utf-8"));
    } catch (e) {
      console.error("[config] config.json 解析失败，使用默认值:", e.message);
    }
  }
  // 允许不完整配置（首次运行向导阶段 vaultRoot/apiKey 可以还没有）
  _cfg = { ...defaults, ...user };
  return _cfg;
}

/** 向导/设置页保存配置：合并写入 config.json 并重置缓存（立即生效，无需重启） */
export function saveConfig(patch) {
  const f = configFile();
  let cur = {};
  if (fs.existsSync(f)) {
    try {
      cur = JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch {
      // 损坏则从默认重建
    }
  }
  const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, f);
  _cfg = null;
  return next;
}

export function vaultRoot() {
  // 环境变量覆盖（测试沙盒用）；正常使用读 config.json。
  // 相对路径按项目根解析（多设备约定：库克隆在工具旁边，如 ../obsidian_cangku，
  // 绝对路径写法仍兼容——path.resolve 遇到带盘符的绝对路径会自动忽略基准）。
  const raw = process.env.WEREAD_VAULT_ROOT || load().vaultRoot;
  if (!raw) {
    throw new Error("尚未配置 Obsidian 库路径：请完成首次配置向导，或在 config.json 填写 vaultRoot");
  }
  return path.resolve(ROOT, raw);
}

export function notesDir() {
  return path.join(vaultRoot(), load().notesRelDir);
}

export function attachmentsDir() {
  return path.join(notesDir(), load().attachmentsRelDir);
}

/**
 * API key 优先级：环境变量 → 向导保存在 config.json 的 apiKey → ~/.bashrc / ~/.profile 兜底
 * （非交互 shell 可能没 source 过 rc 文件，与 treeboat refresh.py 同一套兜底逻辑）
 */
export function getKey() {
  const env = process.env.WEREAD_API_KEY;
  if (env) return env;
  const fromCfg = load().apiKey;
  if (fromCfg) return fromCfg;
  for (const f of [path.join(os.homedir(), ".bashrc"), path.join(os.homedir(), ".profile")]) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, "utf-8");
    const m = txt.match(/WEREAD_API_KEY\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return null;
}
