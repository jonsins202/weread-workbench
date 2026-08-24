import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 独立沙盒目录，避免污染真实 .cache
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "chats-test-"));
process.env.WEREAD_CHATS_DIR = SANDBOX;

const { loadChat, appendChat, clearChat } = await import("../server/chats.js");
const { buildPrompt } = await import("../server/agent.js");

test("chats：无记录返回空 messages", () => {
  const r = loadChat("book1", "不存在条目");
  assert.equal(r.messages.length, 0);
  assert.equal(r.updatedAt, null);
});

test("chats：追加→读取→再追加的往返", () => {
  appendChat("book1", "条目A", "第一问", "第一答");
  let r = loadChat("book1", "条目A");
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].role, "user");
  assert.equal(r.messages[0].content, "第一问");
  assert.equal(r.messages[1].role, "ai");
  assert.equal(r.messages[1].content, "第一答");
  appendChat("book1", "条目A", "第二问", "第二答");
  r = loadChat("book1", "条目A");
  assert.equal(r.messages.length, 4);
  assert.equal(r.messages[3].content, "第二答");
});

test("chats：不同条目/不同书互不干扰", () => {
  appendChat("book1", "条目B", "q", "a");
  assert.equal(loadChat("book1", "条目A").messages.length, 4);
  assert.equal(loadChat("book1", "条目B").messages.length, 2);
  assert.equal(loadChat("book2", "条目A").messages.length, 0);
});

test("chats：清空后为空，且不影响其它条目", () => {
  clearChat("book1", "条目A");
  assert.equal(loadChat("book1", "条目A").messages.length, 0);
  assert.equal(loadChat("book1", "条目B").messages.length, 2);
  clearChat("book1", "条目A"); // 重复清空不报错
});

test("chats：损坏的缓存文件按无记录处理", () => {
  const files = fs.readdirSync(SANDBOX);
  assert.ok(files.length > 0);
  fs.writeFileSync(path.join(SANDBOX, files[0]), "{broken json");
  // 条目B 的文件已损坏 → 读取返回空而不抛错
  assert.equal(loadChat("book1", "条目B").messages.length, 0);
});

test("buildPrompt：完整携带传入的历史（截断由调用方负责）", () => {
  const ctx = { bookTitle: "书", chapterTitle: "章", prev: "", current: "正文", next: "" };
  const history = [];
  for (let i = 1; i <= 25; i++) {
    history.push({ role: "user", content: `问${i}` });
    history.push({ role: "ai", content: `答${i}` });
  }
  const p = buildPrompt(ctx, "新问题", history);
  assert.ok(p.includes("问：问1"));
  assert.ok(p.includes("答：答25"));
  assert.ok(p.includes("【本次问题】新问题"));
});
