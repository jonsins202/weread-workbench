// writer.js — 块级编辑引擎（PRD F4）
// 原则：每次操作前重新解析磁盘内容、按内容锚点（quoteKey/段落序号）定位，
// 外部修改不冲突时自动适应；锚点找不到时报 409 让前端刷新，绝不盲写。
// 同步安全：用户删除同步条目/想法 → frontmatter 隐藏清单，同步器不再复活它们。
import fs from "node:fs";
import path from "node:path";
import { safeNotePath } from "./notes.js";
import { attachmentsDir } from "./config.js";
import { parseFrontmatter, contentKey, extractIdeaContent } from "./merger.js";
import { quoteKey } from "./naming.js";

const RE_ITEM_H = /^### (划线|💭 想法)\s*\d+\s*$/;
const RE_ORPHAN_H = /^### 💭 仅想法/;
const RE_HEADING = /^#{1,6} /;
const RE_QUOTE = /^> ?/;
const RE_CALLOUT = /^>\s*\[!\w+\]/;
export const ORPHAN_KEY = "__orphans__";

/** 行级模型：items（含 quote/segments 行区间）+ orphan 段区间 + frontmatter 区间 */
function parseModel(lines) {
  const model = { fmStart: -1, fmEnd: -1, items: [], orphan: null };
  let i = 0;
  if (lines[0] === "---") {
    model.fmStart = 0;
    for (i = 1; i < lines.length; i++) {
      if (lines[i] === "---") break;
    }
    model.fmEnd = i; // 含 closing ---
    i++;
  }

  const segmentsOf = (from, to) => {
    const segs = [];
    let s = -1;
    for (let k = from; k < to; k++) {
      const blank = lines[k].trim() === "";
      if (!blank && s === -1) s = k;
      if ((blank || k === to - 1) && s !== -1) {
        const end = blank ? k : k + 1;
        segs.push({ start: s, end, raw: lines.slice(s, end).join("\n").trim() });
        s = -1;
      }
    }
    return segs;
  };

  let item = null; // {start, quoteStart, quoteEnd}
  let orphanStart = -1;

  const closeItem = (end) => {
    if (!item) return;
    const segs = segmentsOf(item.quoteEnd, end);
    model.items.push({
      key: quoteKey(
        lines.slice(item.quoteStart, item.quoteEnd).map((l) => l.replace(RE_QUOTE, "")).join("")
      ),
      start: item.start,
      end,
      heading: lines[item.start],
      quoteStart: item.quoteStart,
      quoteEnd: item.quoteEnd,
      segments: segs,
    });
    item = null;
  };
  const closeOrphan = (end) => {
    if (orphanStart === -1) return;
    model.orphan = { start: orphanStart, end, segments: segmentsOf(orphanStart, end) };
    orphanStart = -1;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (RE_ITEM_H.test(line)) {
      closeOrphan(i);
      closeItem(i);
      item = { start: i, quoteStart: -1, quoteEnd: -1 };
      // 收集引用（容忍标题后空行）
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const qs = j;
      while (j < lines.length && RE_QUOTE.test(lines[j]) && !RE_CALLOUT.test(lines[j])) j++;
      if (j > qs) {
        item.quoteStart = qs;
        item.quoteEnd = j;
      } else {
        item.quoteStart = item.quoteEnd = i + 1; // 无引用条目
      }
      i = j - 1;
      continue;
    }
    if (RE_ORPHAN_H.test(line)) {
      closeItem(i);
      orphanStart = i + 1;
      continue;
    }
    if (RE_HEADING.test(line)) {
      closeItem(i);
      closeOrphan(i);
      continue;
    }
  }
  closeItem(lines.length);
  closeOrphan(lines.length);
  return model;
}

/** 渲染一个段为 markdown 行 */
function segmentLines(seg) {
  const text = String(seg.text ?? "").replace(/\r/g, "");
  switch (seg.kind) {
    case "thought":
      return [`💭 **我的思考：** ${text.split("\n")[0].trim()}`, ...text.split("\n").slice(1).map((l) => l.trim())];
    case "idea":
      return [`💭 **我的想法：** ${text.split("\n")[0].trim()}`, ...text.split("\n").slice(1).map((l) => l.trim())];
    case "orphanIdea": {
      const first = `💭 **我的想法：** ${text.split("\n")[0].trim()}`;
      const rest = text.split("\n").slice(1).map((l) => l.trim());
      const out = seg.quote ? [`> ${String(seg.quote).split("\n")[0]}`, "", first, ...rest] : [first, ...rest];
      return out;
    }
    case "callout": {
      const head = `> [!${seg.calloutType || "example"}] ${seg.title || ""}`.trimEnd();
      const body = text ? text.split("\n").map((l) => `> ${l}`) : [];
      return [head, ...body];
    }
    default:
      return text.split("\n");
  }
}

/** 在 pos 处插入块，保证前后各恰好一个空行 */
function insertBlock(lines, pos, block) {
  const pre = pos > 0 && lines[pos - 1].trim() !== "" ? [""] : [];
  const post = pos < lines.length && lines[pos].trim() !== "" ? [""] : [];
  lines.splice(pos, 0, ...pre, ...block, ...post);
}

/** 删除行区间后收敛连续空行 */
function spliceKeepBlank(lines, start, end) {
  lines.splice(start, end - start);
  let k = start - 1;
  while (k >= 0 && k + 1 < lines.length && lines[k].trim() === "" && lines[k + 1].trim() === "") {
    lines.splice(k + 1, 1);
    k--;
  }
}

function locateItem(model, itemKey) {
  if (itemKey === ORPHAN_KEY) return null; // orphan 用专门分支
  const hits = model.items.filter((it) => it.key === itemKey);
  if (hits.length === 0) throw new Error(`定位失败：找不到目标条目（内容可能已被外部修改），请刷新后重试`);
  if (hits.length > 1) throw new Error(`定位失败：存在 ${hits.length} 个内容相同的条目，请在 Obsidian 中手动编辑`);
  return hits[0];
}

function locateSegments(model, itemKey) {
  if (itemKey === ORPHAN_KEY) {
    if (!model.orphan) throw new Error("定位失败：「仅想法」区块不存在");
    return model.orphan.segments;
  }
  return locateItem(model, itemKey).segments;
}

// ---- frontmatter 隐藏清单读写 ----
function readFmList(content, key) {
  const fm = parseFrontmatter(content);
  const v = fm[key];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

function writeFmLists(content, lists) {
  const lines = content.split("\n");
  let fmEnd = -1;
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        fmEnd = i;
        break;
      }
    }
  }
  if (fmEnd === -1) return content;
  // 先移除旧的 key 块
  for (const key of ["hidden_keys", "hidden_ideas"]) {
    for (let i = 1; i < fmEnd; i++) {
      if (new RegExp(`^${key}:`).test(lines[i])) {
        let j = i + 1;
        while (j < lines.length && /^\s+-\s/.test(lines[j])) j++;
        lines.splice(i, j - i);
        fmEnd -= j - i;
        break;
      }
    }
  }
  // 再按需插入（插在 closing --- 之前）
  const insertAt = (idx, blockLines) => {
    lines.splice(idx, 0, ...blockLines);
    fmEnd += blockLines.length;
  };
  let cursor = fmEnd;
  for (const [key, set] of [
    ["hidden_keys", lists.keys],
    ["hidden_ideas", lists.ideas],
  ]) {
    if (!set.size) continue;
    const block = [`${key}:`, ...[...set].map((v) => `  - ${JSON.stringify(v)}`)];
    insertAt(cursor, block);
    cursor += block.length;
  }
  return lines.join("\n");
}

/**
 * 应用一批编辑操作。每个操作独立「解析→定位→改」，天然适应中途变化。
 * @param {string} content 当前文件内容（\n 规范化后）
 * @param {Array} ops 操作列表
 * @param {{synced: boolean}} opts synced=笔记来自同步（删除需记隐藏清单；禁改划线原文）
 */
export function applyEdits(content, ops, opts = {}) {
  const report = [];
  const lists = {
    keys: new Set(readFmList(content, "hidden_keys")),
    ideas: new Set(readFmList(content, "hidden_ideas")),
  };

  for (const op of ops) {
    const lines = content.split("\n");
    const model = parseModel(lines);

    if (op.type === "insertSegment" || op.type === "insertImage") {
      // 目标是「仅想法」区但笔记里还没有该区块：先在文末创建
      if (op.itemKey === ORPHAN_KEY && !model.orphan) {
        while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
        const block =
          op.type === "insertImage" ? [`![[${op.name}]]`] : segmentLines(op.segment);
        lines.push("", "### 💭 仅想法（无对应划线）", "", ...block, "");
        content = lines.join("\n");
        report.push(`已插入${op.type === "insertImage" ? "图片" : op.segment.kind === "callout" ? "批注" : "段落"}`);
        continue;
      }
      const segs = locateSegments(model, op.itemKey);
      const block =
        op.type === "insertImage"
          ? [`![[${op.name}]]`]
          : segmentLines(op.segment);
      let pos;
      if (op.itemKey === ORPHAN_KEY) {
        pos = model.orphan.end;
      } else if (op.afterIndex == null || !segs.length) {
        const it = locateItem(model, op.itemKey);
        pos = segs.length ? segs[segs.length - 1].end : it.quoteEnd;
      } else {
        pos = segs[Math.min(op.afterIndex, segs.length - 1)].end;
      }
      insertBlock(lines, pos, block);
      content = lines.join("\n");
      report.push(`已插入${op.type === "insertImage" ? "图片" : op.segment.kind === "callout" ? "批注" : "段落"}`);
      continue;
    }

    if (op.type === "updateSegment" || op.type === "deleteSegment") {
      const segs = locateSegments(model, op.itemKey);
      const idx = op.index;
      if (idx == null || idx < 0 || idx >= segs.length) throw new Error("定位失败：段落序号超出范围，请刷新后重试");
      const seg = segs[idx];
      // 同步笔记中编辑/删除「服务端想法」→ 记入隐藏清单，防止下次同步复活
      const idea = extractIdeaContent(seg.raw);
      if (idea && opts.synced) lists.ideas.add(contentKey(idea));
      if (op.type === "deleteSegment") {
        spliceKeepBlank(lines, seg.start, seg.end);
        report.push("已删除段落");
      } else {
        // 编辑后的想法以「我的思考」身份保留（服务端原文已隐藏）
        const newSeg = idea && opts.synced ? { ...op.segment, kind: op.segment.kind === "idea" ? "thought" : op.segment.kind } : op.segment;
        const block = segmentLines(newSeg);
        lines.splice(seg.start, seg.end - seg.start, ...block);
        report.push("已更新段落");
      }
      content = lines.join("\n");
      continue;
    }

    if (op.type === "deleteItem") {
      const it = locateItem(model, op.itemKey);
      if (opts.synced) lists.keys.add(it.key);
      spliceKeepBlank(lines, it.start, it.end);
      content = lines.join("\n");
      report.push(opts.synced ? "已删除条目（不再同步恢复）" : "已删除条目");
      continue;
    }

    if (op.type === "editQuote") {
      if (opts.synced) throw new Error("同步笔记的划线原文由微信读书管理，暂不支持在应用内修改");
      const it = locateItem(model, op.itemKey);
      const quoteLines = String(op.text || "")
        .split("\n")
        .map((l) => `> ${l.trim()}`);
      lines.splice(it.quoteStart, it.quoteEnd - it.quoteStart, ...quoteLines);
      content = lines.join("\n");
      report.push("已修改原文");
      continue;
    }

    throw new Error(`未知操作类型: ${op.type}`);
  }

  if (lists.keys.size || lists.ideas.size) {
    content = writeFmLists(content, lists);
  }
  return { content, report };
}

/** 编辑入口：重读磁盘 → 应用 → 原子写回 */
export function editNote(file, ops) {
  const p = safeNotePath(file);
  if (!fs.existsSync(p)) throw new Error("笔记不存在");
  const raw = fs.readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
  const fm = parseFrontmatter(raw);
  const { content, report } = applyEdits(raw, ops, { synced: !!fm.bookId });
  if (content === raw) return { changed: false, report };
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, p);
  return { changed: true, report };
}

/** 图片上传落盘：attachments/{笔记主名}_{时间戳}.{ext}，重名自动加序号 */
export function saveImage(file, name, base64) {
  const ext = (String(name || "").match(/\.(jpe?g|png|gif|webp)$/i)?.[1] || "png").toLowerCase().replace("jpeg", "jpg");
  const buf = Buffer.from(String(base64 || ""), "base64");
  if (!buf.length || buf.length > 15 * 1024 * 1024) throw new Error("图片为空或超过 15MB");
  safeNotePath(file); // 校验合法性（防目录穿越）
  const stem = path.basename(decodeURIComponent(file), ".md");
  const p2 = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const attDir = attachmentsDir();
  fs.mkdirSync(attDir, { recursive: true });
  let final = `${stem}_${stamp}.${ext}`;
  for (let k = 2; fs.existsSync(path.join(attDir, final)); k++) final = `${stem}_${stamp}-${k}.${ext}`;
  fs.writeFileSync(path.join(attDir, final), buf);
  return { name: final };
}
