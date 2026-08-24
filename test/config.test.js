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
