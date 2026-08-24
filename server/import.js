// import.js — 旧手写笔记导入合并（PRD F7）
// 两种旧格式：
//   划线式（### 划线 N + 引用 + 批注）→ 按内容锚点挂到目标条目；对不上的进「仅想法」（带原文引用）
//   随笔式（### 思考 N：标题，含 #### AI 小节）→ 标题转粗体整块进「仅想法」
// 铁律：旧文件只读不动；图片复制进 attachments（确定性命名）；按内容去重保证幂等。
import fs from "node:fs";
import path from "node:path";
import { vaultRoot, attachmentsDir } from "./config.js";
import { listNotes, getNote } from "./notes.js";
import { editNote, ORPHAN_KEY } from "./writer.js";
import { quoteKey } from "./naming.js";
import { extractIdeaContent, contentKey } from "./merger.js";

/** 旧笔记路径安全化：只允许 vault 内 */
function safeVaultPath(relOrAbs) {
  const p = path.resolve(vaultRoot(), String(relOrAbs || "").trim());
  if (p !== vaultRoot() && !p.startsWith(vaultRoot() + path.sep)) {
    throw new Error("路径必须在 Obsidian 库内");
  }
  return p;
}

const norm = (s) => String(s || "").replace(/\s+/g, "");

/** 解析旧笔记：# 书名 / ### 小节（引用 + 正文）/ 其余行归入当前小节 */
function parseOldNote(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const doc = { bookTitle: "", sections: [] };
  let cur = null;
  for (const line of lines) {
    if (/^# [^#]/.test(line) && !doc.bookTitle) {
      doc.bookTitle = line.replace(/^# /, "").split(/\s*[—-]\s/)[0].trim();
      continue;
    }
    if (/^### /.test(line)) {
      cur = { heading: line.replace(/^### /, "").trim(), quote: [], body: [] };
      doc.sections.push(cur);
      continue;
    }
    if (!cur) continue;
    // 引用 = 小节开头（允许前置空行）的 > 行；一旦出现正文（非空行）后即止
    const bodyHasContent = cur.body.some((l) => l.trim());
    if (/^>/.test(line) && !bodyHasContent) cur.quote.push(line.replace(/^> ?/, ""));
    else cur.body.push(line);
  }
  for (const s of doc.sections) {
    s.bodyText = s.body.join("\n").trim();
    while (s.quote.length && !s.quote[s.quote.length - 1].trim()) s.quote.pop();
    // 随笔式小节内嵌的「原文摘录」引用（**原文摘录：** 之后的连续 > 行）——用于挂到目标条目
    s.passage = "";
    let inPassage = false;
    const kept = [];
    for (const line of s.body) {
      if (/^\*\*原文摘录[:：]?\*\*/.test(line.trim())) {
        inPassage = true;
        continue; // 标签行本身丢弃（目标条目自带原文）
      }
      if (inPassage && /^>/.test(line)) {
        s.passage += line.replace(/^> ?/, "") + "\n";
        continue;
      }
      inPassage = false;
      kept.push(line);
    }
    s.passage = s.passage.trim();
    s.bodyText = kept.join("\n").trim();
  }
  return doc;
}

/** 随笔式小节：标题/AI 小节标题转粗体，避免 ### 破坏目标笔记结构 */
const flattenHeadings = (text) => text.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");

function splitSegments(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 分析导入：产出匹配报告 + 待执行操作（不写任何文件） */
export function analyzeImport(oldPathInput) {
  const oldPath = safeVaultPath(oldPathInput);
  if (!fs.existsSync(oldPath)) throw new Error("旧笔记文件不存在");
  const old = parseOldNote(fs.readFileSync(oldPath, "utf-8"));

  // 定位目标笔记（书名精确匹配 frontmatter title）
  const target = listNotes().find((n) => n.title === old.bookTitle || n.displayTitle.split(" — ")[0] === old.bookTitle);
  if (!target) {
    return { error: `自管目录中找不到《${old.bookTitle}》的笔记，请先在书架同步该书` };
  }
  const detail = getNote(target.file);
  const targetStem = path.basename(target.file, ".md");

  // 目标已有内容（幂等去重用；rawJoined=全部批注拼接归一化，多块 raw 段插入后会被空行拆段，故用包含判断）
  const existingByKey = new Map(); // itemKey -> rawJoined
  const globalIdeaKeys = new Set(); // 全笔记范围的想法内容键（服务端可能把想法挂在别的划线下）
  for (const ch of detail.chapters) {
    for (const it of ch.items) {
      existingByKey.set(it.key, norm(it.extras.map((e) => e.raw).join("\n\n")));
      for (const e of it.extras) {
        if (e.kind === "idea" || e.kind === "thought") globalIdeaKeys.add(contentKey(e.text || ""));
      }
    }
  }
  const orphanJoined = norm(detail.orphans.map((o) => o.raw).join("\n\n"));
  for (const o of detail.orphans) globalIdeaKeys.add(contentKey(o.text || ""));

  const imageFiles = []; // {from(abs), to(name), ref}
  const imageMap = new Map();
  const rewriteImages = (text) => {
    const oldDir = path.dirname(oldPath);
    return text.replace(/!\[\[([^\]]+?)\]\]/g, (m, name) => {
      if (imageMap.has(name)) return `![[${imageMap.get(name)}]]`;
      const src = path.join(oldDir, name);
      const exists = fs.existsSync(src) && fs.statSync(src).isFile();
      const newName = `${targetStem}_导入_${name}`;
      imageFiles.push({ from: exists ? src : null, to: newName, ref: name });
      imageMap.set(name, newName);
      return `![[${newName}]]`;
    });
  };

  const ops = [];
  const report = { targetTitle: target.title, targetFile: target.file, matched: [], unmatched: [], essays: [], images: { total: 0, missing: [] }, inserted: 0, skippedDup: 0 };

  for (const sec of old.sections) {
    const isItemSection = /^(划线|💭 想法)\s*\d+/.test(sec.heading);
    const segments = splitSegments(sec.bodyText);

    if (isItemSection && sec.quote.length) {
      const key = quoteKey(sec.quote.join(""));
      const hit = existingByKey.get(key); // 注意：无批注条目值是空串，用 !== undefined 判定匹配
      if (hit !== undefined) {
        let n = 0;
        for (const seg of segments) {
          const rewritten = rewriteImages(seg);
          const idea = extractIdeaContent(rewritten);
          if (hit.includes(norm(rewritten)) || (idea && globalIdeaKeys.has(contentKey(idea)))) {
            report.skippedDup++;
            continue;
          }
          ops.push({ type: "insertSegment", itemKey: key, afterIndex: null, segment: { kind: "raw", text: rewritten } });
          report.inserted++;
          n++;
        }
        report.matched.push({ heading: sec.heading, quote: sec.quote.join("").slice(0, 50), segments: n });
      } else {
        // 对不上：有批注的 → 原文引用+批注进「仅想法」；纯原文无批注的 → 跳过（导入光秃原文只是噪音）
        const usable = segments.filter((s) => {
          const idea = extractIdeaContent(s);
          return !(idea && globalIdeaKeys.has(contentKey(idea)));
        });
        if (!usable.length) {
          report.skippedDup += segments.length;
          report.unmatched.push({ heading: sec.heading, quote: sec.quote.join("").slice(0, 50), toOrphan: false });
        } else {
          const merged = [`> ${sec.quote.join("\n> ")}`, "", ...usable.map((s) => rewriteImages(s))].join("\n\n");
          if (orphanJoined.includes(norm(merged))) {
            report.skippedDup++;
          } else {
            ops.push({ type: "insertSegment", itemKey: ORPHAN_KEY, afterIndex: null, segment: { kind: "raw", text: merged } });
            report.inserted++;
          }
          report.unmatched.push({ heading: sec.heading, quote: sec.quote.join("").slice(0, 50), toOrphan: true });
        }
      }
      continue;
    }

    // 随笔式（思考 N）：优先按「原文摘录」挂到目标条目下（丢重复原文，保留思考+AI 部分）；
    // 摘录对不上任何条目时，整节（含摘录）转粗体进「仅想法」兜底
    const passageKey = sec.passage ? quoteKey(sec.passage) : (sec.quote.length ? quoteKey(sec.quote.join("")) : "");
    const hostKey = passageKey && existingByKey.has(passageKey) ? passageKey : null;
    const quoteLines = sec.quote.map((q) => `> ${q}`);
    if (hostKey) {
      const chunk = flattenHeadings(
        [`### ${sec.heading}`, "", ...quoteLines, "", sec.bodyText].filter((x) => x !== "").join("\n")
      );
      const rewritten = rewriteImages(chunk);
      if (existingByKey.get(hostKey).includes(norm(rewritten))) {
        report.skippedDup++;
      } else {
        ops.push({ type: "insertSegment", itemKey: hostKey, afterIndex: null, segment: { kind: "raw", text: rewritten } });
        report.inserted++;
      }
      report.essays.push(sec.heading);
      continue;
    }
    const chunk = flattenHeadings([`### ${sec.heading}`, "", ...(sec.passage ? [`> ${sec.passage}`] : quoteLines), "", sec.bodyText].filter((x) => x !== "").join("\n"));
    const rewritten = rewriteImages(chunk);
    if (orphanJoined.includes(norm(rewritten))) {
      report.skippedDup++;
    } else {
      ops.push({ type: "insertSegment", itemKey: ORPHAN_KEY, afterIndex: null, segment: { kind: "raw", text: rewritten } });
      report.inserted++;
    }
    report.essays.push(sec.heading);
  }

  report.images.total = imageFiles.length;
  report.images.missing = imageFiles.filter((i) => !i.from).map((i) => i.ref);
  return { ...report, ops, imageFiles };
}

/** 执行导入：复制图片 → 应用操作（原子写回）。旧文件不动。 */
export function executeImport(oldPathInput) {
  const plan = analyzeImport(oldPathInput);
  if (plan.error) throw new Error(plan.error);
  if (!plan.ops.length) {
    return { ...plan, changed: false, message: "没有可导入的新内容（可能已导入过）" };
  }
  const attDir = attachmentsDir();
  fs.mkdirSync(attDir, { recursive: true });
  let copied = 0;
  for (const img of plan.imageFiles) {
    if (!img.from) continue;
    const dest = path.join(attDir, img.to);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(img.from, dest);
      copied++;
    }
  }
  const r = editNote(plan.targetFile, plan.ops);
  return {
    targetTitle: plan.targetTitle,
    inserted: plan.inserted,
    skippedDup: plan.skippedDup,
    matched: plan.matched.length,
    unmatched: plan.unmatched.length,
    essays: plan.essays.length,
    imagesCopied: copied,
    imagesMissing: plan.images.missing,
    changed: r.changed,
    message: `导入完成：新挂 ${plan.inserted} 段（匹配 ${plan.matched.length} 条 / 随笔 ${plan.essays.length} 节 / 转仅想法 ${plan.unmatched.length} 条），重复跳过 ${plan.skippedDup} 段，图片复制 ${copied} 张`,
  };
}
