// chats.js — AI 对话的服务端持久化（同一条目的提问跨刷新/重开面板续接）
// 存储形态：.cache/chats/chat-{hash}.json，hash = sha1("{bookId或文件主名}::{itemKey}") 前16位。
// 服务端是对话历史的唯一持有者：/api/agent/chat 每次自行加载历史→拼 prompt→成功后追加本轮。
// 追加只在拿到回答后发生（失败的问题不留幽灵轮次）；写入用 tmp+rename 原子落盘。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function chatsDir() {
  // 环境变量覆盖（测试沙盒用）
  return process.env.WEREAD_CHATS_DIR || path.join(ROOT, ".cache", "chats");
}

function chatFile(scope, itemKey) {
  const hash = crypto.createHash("sha1").update(`${scope}::${itemKey}`).digest("hex").slice(0, 16);
  return path.join(chatsDir(), `chat-${hash}.json`);
}

/** 读取某条目的对话：{ messages: [{role:"user"|"ai", content, at}], updatedAt }；无记录返回空 messages */
export function loadChat(scope, itemKey) {
  const f = chatFile(scope, itemKey);
  if (!fs.existsSync(f)) return { messages: [], updatedAt: null };
  try {
    const v = JSON.parse(fs.readFileSync(f, "utf-8"));
    if (Array.isArray(v?.messages)) {
      return { messages: v.messages.filter((m) => m && m.role && m.content), updatedAt: v.updatedAt || null };
    }
  } catch {
    // 损坏视为无记录
  }
  return { messages: [], updatedAt: null };
}

/** 一轮成功问答后追加两条消息（user + ai）并落盘 */
export function appendChat(scope, itemKey, userText, aiText) {
  const f = chatFile(scope, itemKey);
  const cur = loadChat(scope, itemKey);
  const at = new Date().toISOString();
  cur.messages.push({ role: "user", content: String(userText), at });
  cur.messages.push({ role: "ai", content: String(aiText), at });
  const out = { key: `${scope}::${itemKey}`, messages: cur.messages, updatedAt: at };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1));
  fs.renameSync(tmp, f);
  return out;
}

/** 清空该条目的对话（面板「清空重开」） */
export function clearChat(scope, itemKey) {
  const f = chatFile(scope, itemKey);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
