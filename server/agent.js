// agent.js — AI Adapter 层（PRD F5）
// 默认 claude CLI（claude -p，prompt 走 stdin 避免命令行长度限制），预留 codex。
import { spawn } from "node:child_process";
import { load } from "./config.js";
import { ORPHAN_KEY } from "./writer.js";

export const ADAPTERS = {
  claude: { label: "Claude", bin: "claude", args: ["-p"] },
  codex: { label: "Codex", bin: "codex", args: ["exec"] },
};

function agentConfig() {
  const cfg = load();
  return {
    cli: cfg.agent?.cli || "claude",
    cliPath: cfg.agent?.cliPath || "",
    timeoutMs: cfg.agent?.timeoutMs || 180000,
    historyRounds: cfg.agent?.historyRounds || 20,
    extraArgs: cfg.agent?.extraArgs || [],
    model: cfg.agent?.model || "",
  };
}

/** 非交互调用 agent CLI：prompt 经 stdin 传入，返回 stdout 文本 */
export function runAgent(prompt) {
  const cfg = agentConfig();
  const ad = ADAPTERS[cfg.cli] || ADAPTERS.claude;
  const cmd = cfg.cliPath || ad.bin;
  const args = [...ad.args, ...cfg.extraArgs];
  if (cfg.model) args.push("--model", cfg.model);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`agent 响应超时（${Math.round(cfg.timeoutMs / 1000)}s）`));
    }, cfg.timeoutMs);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 ${cmd}：${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) resolve(text);
      else reject(new Error(text || err.trim() || `${cmd} 退出码 ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** 从解析后的笔记中取目标条目上下文（书/章/当前条目 ± 相邻条目） */
export function buildItemContext(note, itemKey) {
  if (itemKey === ORPHAN_KEY) {
    return {
      bookTitle: note.bookTitle,
      chapterTitle: "仅想法",
      prev: "",
      current: note.orphans.map((o) => o.text || o.title || "").join("；").slice(0, 200),
      next: "",
    };
  }
  for (const ch of note.chapters) {
    for (let i = 0; i < ch.items.length; i++) {
      if (ch.items[i].key === itemKey) {
        const it = ch.items[i];
        return {
          bookTitle: note.bookTitle,
          chapterTitle: `${ch.num ? ch.num + "、" : ""}${ch.title}`,
          prev: (ch.items[i - 1]?.quote || []).join("\n").slice(0, 300),
          current: it.quote.join("\n"),
          next: (ch.items[i + 1]?.quote || []).join("\n").slice(0, 300),
        };
      }
    }
  }
  throw new Error("找不到目标条目（可能已被修改），请刷新后重试");
}

/** 组装最终 prompt：阅读上下文 + 同段公众想法（可选）+ 对话历史 + 本次问题。
 *  history 由调用方按 agent.historyRounds 截断后传入（服务端是对话历史的唯一持有者）。 */
export function buildPrompt(ctx, question, history = [], publicIdeas = []) {
  const lines = [
    "你是我的读书笔记助手，帮我深入理解阅读内容。",
    "回答要求：中文；简洁准确、有洞察；适合直接作为读书笔记的批注保存；涉及事实要严谨，不确定就明说；不要重复原文，要延伸和解释；直接输出内容本身，不要开场白、称呼和客套。",
    "",
    `【书籍】${ctx.bookTitle}`,
    `【章节】${ctx.chapterTitle}`,
    ctx.prev ? `【上一条内容】${ctx.prev}` : "",
    `【当前内容】${ctx.current}`,
    ctx.next ? `【下一条内容】${ctx.next}` : "",
    "",
  ].filter((l) => l !== "");
  if (publicIdeas.length) {
    lines.push("【其他读者对这段的想法】（对照参考：可认同、可补充、可反驳，不要照抄，标明是读者观点）");
    publicIdeas.slice(0, 3).forEach((t, i) => {
      lines.push(`读者${i + 1}：${String(t).slice(0, 200)}`);
    });
    lines.push("");
  }
  if (history.length) {
    lines.push("【对话历史】");
    for (const m of history) {
      lines.push(`${m.role === "user" ? "问" : "答"}：${m.content}`);
    }
    lines.push("");
  }
  lines.push(`【本次问题】${question}`);
  return lines.join("\n");
}
