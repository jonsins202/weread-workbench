import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 相对 vaultRoot 解析约定（多设备兄弟目录结构）
process.env.WEREAD_VAULT_ROOT = "../obsidian_cangku";
const { vaultRoot } = await import("../server/config.js");

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("config：相对 vaultRoot 按项目根解析（兄弟目录约定）", () => {
  assert.equal(vaultRoot(), path.resolve(ROOT, "../obsidian_cangku"));
});

test("config：绝对路径不受基准影响", () => {
  process.env.WEREAD_VAULT_ROOT = "K:/obsidian_cangku";
  assert.equal(vaultRoot(), "K:\\obsidian_cangku");
});

// ---- 向导保存 / key 优先级（独立沙盒配置文件）----
const fs = await import("node:fs");
const os = await import("node:os");
const SANDBOX_CFG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cfg-")), "config.json");
process.env.WEREAD_CONFIG = SANDBOX_CFG;
delete process.env.WEREAD_VAULT_ROOT;

const { saveConfig, load, getKey } = await import("../server/config.js");

test("config：saveConfig 合并写入且立即生效", () => {
  saveConfig({ apiKey: "wrk-test", vaultRoot: "../someVault" });
  assert.equal(load().apiKey, "wrk-test");
  assert.equal(load().vaultRoot, "../someVault");
  saveConfig({ port: 5180 }); // 二次保存不丢先前字段
  assert.equal(load().apiKey, "wrk-test");
  assert.equal(load().port, 5180);
});

test("config：key 优先级 环境变量 > config.apiKey", () => {
  const saved = process.env.WEREAD_API_KEY;
  delete process.env.WEREAD_API_KEY;
  assert.equal(getKey(), "wrk-test");
  process.env.WEREAD_API_KEY = "wrk-env";
  assert.equal(getKey(), "wrk-env");
  delete process.env.WEREAD_API_KEY;
  assert.equal(getKey(), "wrk-test");
  if (saved !== undefined) process.env.WEREAD_API_KEY = saved;
});

test("config：未配置 vaultRoot 时给出向导指引而非崩溃", () => {
  saveConfig({ vaultRoot: "" });
  assert.throws(() => vaultRoot(), /尚未配置/);
});
