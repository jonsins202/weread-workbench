// 解析已存在的笔记文件：为重同步提供「用户批注保全」数据（PRD §6 锚点机制 + F1 幂等）
// 只提取三类信息：frontmatter 关键值 / 每条划线下的用户追加内容 / 「仅想法」区块
import { quoteKey, cleanText } from "./naming.js";

const RE_FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const RE_HEADING = /^#{1,6} /;
const RE_HIGHLIGHT = /^### 划线\s*\d+\s*$/;
const RE_IDEA_ITEM = /^### 💭 想法\s*\d+\s*$/;
const RE_ORPHAN = /^### 💭 仅想法/;
const RE_QUOTE_LINE = /^> ?/;
const RE_CALLOUT = /^>\s*\[!\w+\]/;

/** 引用行：> 开头但不是 callout（callout 属于用户附加内容，不能并入划线原文） */
function isQuoteLine(line) {
  return RE_QUOTE_LINE.test(line) && !RE_CALLOUT.test(line);
}

function stripQuote(v) {
  return String(v || "").trim().replace(/^["']|["']$/g, "");
}

/** 解析 frontmatter（扁平 key: value + 简单列表，够用即可，不引 YAML 库） */
export function parseFrontmatter(content) {
  const m = content.match(RE_FM);
  if (!m) return {};
  const out = {};
  let curKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      curKey = kv[1];
      out[curKey] = stripQuote(kv[2]);
      continue;
    }
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && curKey) {
      if (!Array.isArray(out[curKey])) out[curKey] = out[curKey] === "" ? [] : [out[curKey]];
      out[curKey].push(stripQuote(li[1]));
    }
  }
  return out;
}

/**
 * 解析笔记正文，提取：
 * - extrasByQuoteKey: Map<quoteKey, string[]>  每条划线/想法条目之后、下一标题之前的原始内容段
 * - orphanRaw: 「仅想法（无对应划线）」区块的原始内容
 */
export function parseNoteBody(content) {
  const body = content.replace(RE_FM, "");
  const lines = body.split(/\r?\n/);
  const extrasByQuoteKey = new Map();
  let orphanRaw = "";

  let i = 0;
  let mode = "outside"; // outside | collectQuote | collectExtras | collectOrphan
  let quoteLines = [];
  let extraLines = [];
  let orphanLines = [];

  const flushExtras = () => {
    if (mode === "collectExtras" && extraLines.length) {
      const raw = extraLines.join("\n").trim();
      if (raw) {
        const key = quoteKey(quoteLines.join(""));
        const arr = extrasByQuoteKey.get(key) || [];
        arr.push(raw);
        extrasByQuoteKey.set(key, arr);
      }
    }
    extraLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (RE_HIGHLIGHT.test(line) || RE_IDEA_ITEM.test(line)) {
      flushExtras();
      orphanRaw += orphanLines.join("\n").trim() + "\n";
      orphanLines = [];
      // 收集标题后的引用原文（容忍标题后/引用段之间的空行，遇到 callout 或普通内容即止）
      i++;
      quoteLines = [];
      while (i < lines.length) {
        const line = lines[i];
        if (isQuoteLine(line)) {
          quoteLines.push(line.replace(RE_QUOTE_LINE, ""));
          i++;
          continue;
        }
        if (line.trim() === "" && (quoteLines.length === 0 || isQuoteLine(lines[i + 1] || ""))) {
          i++; // 标题后首空行，或引用块内的段间空行
          continue;
        }
        break;
      }
      mode = "collectExtras";
      continue;
    }

    if (RE_ORPHAN.test(line)) {
      flushExtras();
      orphanLines = [];
      mode = "collectOrphan";
      i++;
      continue;
    }

    if (RE_HEADING.test(line)) {
      // 更高级标题（章节/书名）：结束当前收集
      flushExtras();
      orphanRaw += orphanLines.join("\n").trim() + "\n";
      orphanLines = [];
      mode = "outside";
      i++;
      continue;
    }

    if (mode === "collectExtras") extraLines.push(line);
    else if (mode === "collectOrphan") orphanLines.push(line);
    i++;
  }
  flushExtras();
  orphanRaw += orphanLines.join("\n").trim();

  return { extrasByQuoteKey, orphanRaw: orphanRaw.trim() };
}

/** 把原始附加内容按空行切成段（callout 的连续 > 行天然是一段） */
export function splitSegments(raw) {
  return String(raw || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 提取 💭想法 段的内容文本（用于和服务端想法去重） */
const RE_MY_IDEA = /^💭\s*\*\*我的想法：?\*\*\s*([\s\S]*)$/;

export function extractIdeaContent(segment) {
  const m = segment.match(RE_MY_IDEA);
  return m ? cleanText(m[1]) : null;
}

/** 内容归一化（去空白标点，用于重复判断） */
export function contentKey(s) {
  return cleanText(s).replace(/[\s，。！？、；：""''（）,.!?;:()·—…-]/g, "");
}
