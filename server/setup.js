// setup.js — 首次运行向导 / 设置页（开源版：每个用户自己的 key + 自己的库路径）
// 检测项：API key 是否已配、库路径是否有效（.obsidian 为软标志）、claude CLI 是否可用（AI 功能分级降级）
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load, saveConfig, getKey, notesDir } from "./config.js";
import { testGateway } from "./weread.js";
import { ADAPTERS } from "./agent.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let _claudeOk = null; // 检测结果缓存（claude 装没装在会话间不会变）

export function detectAgentCli() {
  if (_claudeOk !== null) return Promise.resolve(_claudeOk);
  const cfg = load();
  const ad = ADAPTERS[cfg.agent?.cli || "claude"] || ADAPTERS.claude;
  const cmd = cfg.agent?.cliPath || ad.bin;
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 8000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  }).then((ok) => {
    _claudeOk = ok;
    return ok;
  });
}

/** 相对路径按项目根解析（与 config.vaultRoot 同一约定） */
function resolveVault(input) {
  return path.resolve(ROOT, String(input || "").trim());
}

/** 当前配置状态：向导是否需要出现（App 门控用） */
export async function getSetupStatus() {
  const cfg = load();
  const hasKey = !!getKey();
  let vaultRoot = "";
  let vaultOk = false;
  let looksLikeVault = false;
  let notesOk = false;
  if (cfg.vaultRoot || process.env.WEREAD_VAULT_ROOT) {
    try {
      vaultRoot = resolveVault(process.env.WEREAD_VAULT_ROOT || cfg.vaultRoot);
      vaultOk = fs.existsSync(vaultRoot);
      looksLikeVault = vaultOk && fs.existsSync(path.join(vaultRoot, ".obsidian"));
      notesOk = vaultOk && fs.existsSync(notesDir());
    } catch {
      // 未配置 vaultRoot
    }
  }
  return {
    configured: hasKey && notesOk,
    hasKey,
    vaultRoot: cfg.vaultRoot || "",
    vaultOk,
    looksLikeVault,
    claudeAvailable: await detectAgentCli(),
  };
}

/** 库路径检测：存在性 + .obsidian 软标志 */
export function testVault(input) {
  const abs = resolveVault(input);
  const ok = fs.existsSync(abs);
  return { ok, abs, looksLikeVault: ok && fs.existsSync(path.join(abs, ".obsidian")) };
}

/** key 测试连接：真实调一次官方网关 */
export async function testKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key.startsWith("wrk-")) throw new Error("key 应以 wrk- 开头，请检查是否复制完整");
  const books = await testGateway(key);
  return { ok: true, books };
}

/** 保存配置（向导/设置页）：空字段跳过不覆盖；保存后创建自管目录 */
export async function saveSetup({ apiKey, vaultRoot } = {}) {
  const patch = {};
  const key = String(apiKey || "").trim();
  const vr = String(vaultRoot || "").trim();
  if (key) patch.apiKey = key;
  if (vr) patch.vaultRoot = vr;
  if (!patch.apiKey && !patch.vaultRoot) throw new Error("没有可保存的内容");
  saveConfig(patch);
  if (patch.vaultRoot) {
    fs.mkdirSync(path.join(resolveVault(patch.vaultRoot), load().notesRelDir), { recursive: true });
  }
  return getSetupStatus();
}
