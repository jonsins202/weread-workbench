// 库操作：扫描自管目录 / 结构化解析（供前端展示）/ 重命名 / 删除（PRD F2/F3）
import fs from "node:fs";
import path from "node:path";
import { notesDir, attachmentsDir } from "./config.js";
import { parseFrontmatter } from "./merger.js";
import { sanitizeFilename, quoteKey } from "./naming.js";

/** :file 参数安全化：只允许 notesDir 下的单个文件名，防目录穿越 */
export function safeNotePath(file) {
  const name = path.basename(decodeURIComponent(file));
  const p = path.resolve(notesDir(), name);
  if (!p.startsWith(path.resolve(notesDir()) + path.sep) && p !== path.resolve(notesDir())) {
    throw new Error("非法路径");
  }
  return p;
}

/** 章节序号前缀「一、」剥离 */
function splitChapterTitle(raw) {
  const m = raw.match(/^([一二三四五六七八九十百]{1,4})、(.*)$/);
  return m ? { num: m[1], title: m[2] } : { num: "", title: raw };
}

/** 附加内容段分类（UI 渲染 + writer 定位共用） */
export function classifySegment(seg) {
  const s = seg.trim();
  if (/^!\[\[.+?\]\]/.test(s)) {
    const m = s.match(/^!\[\[(.+?)\]\]/);
    return { kind: "image", name: m[1], raw: s };
  }
  // callout 判断只看首行（整段是多行，`$` 锚定首行结尾）
  const firstLine = s.split(/\r?\n/)[0];
  const callout = firstLine.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
  if (callout) {
    return {
      kind: "callout",
      type: callout[1],
      title: callout[2].trim(),
      body: s.split(/\r?\n/).slice(1).map((l) => l.replace(/^>\s?/, "")).join("\n").trim(),
      raw: s,
    };
  }
  const idea = s.match(/^💭\s*\*\*我的想法：?\*\*/);
  if (idea) return { kind: "idea", text: s.replace(/^💭\s*\*\*我的想法：?\*\*\s*/, "").replace(/\n/g, "\n"), raw: s };
  if (/^💭/.test(s)) return { kind: "thought", text: s.replace(/^💭\s*\*\*[^*]*\*\*\s*/, "").replace(/^💭\s*/, ""), raw: s };
  const link = s.match(/^\[(.+?)\]\((.+?)\)$/);
  if (link) return { kind: "link", text: link[1], url: link[2], raw: s };
  return { kind: "text", text: s, raw: s };
}

/**
 * 结构化解析一篇笔记（与生成模板同构；也兼容手动笔记的大致结构）
 */
export function parseNoteStructured(content) {
  const fm = parseFrontmatter(content);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split(/\r?\n/);

  const doc = {
    meta: fm,
    bookTitle: "",
    headerMeta: "",
    chapters: [],
    orphans: [],
    counts: { chapters: 0, highlights: 0, ideas: 0, thoughts: 0, callouts: 0, images: 0 },
  };

  let i = 0;
  let chapter = null;
  let item = null; // {type:"highlight"|"idea", heading, quote, extras:[]}
  let orphanMode = false;
  let orphanBuffer = [];

  const closeItem = () => {
    if (item) {
      item.key = quoteKey(item.quote.join(""));
      item.extras = item.extras
        .join("\n")
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(classifySegment);
      for (const e of item.extras) {
        // 💭想法 条目自身的想法在收尾统计里算一次，这里只统计挂在划线下的想法，避免重复计数
        if (e.kind === "idea" && item.type === "idea") continue;
        if (e.kind === "idea") doc.counts.ideas++;
        else if (e.kind === "thought") doc.counts.thoughts++;
        else if (e.kind === "callout") doc.counts.callouts++;
        else if (e.kind === "image") doc.counts.images++;
      }
      chapter.items.push(item);
      item = null;
    }
  };
  const closeChapter = () => {
    closeItem();
    if (chapter) doc.chapters.push(chapter);
    chapter = null;
  };
  const closeOrphan = () => {
    const raw = orphanBuffer.join("\n").trim();
    if (raw) doc.orphans.push(...raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map(classifySegment));
    orphanBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^# [^#]/.test(line) && !doc.bookTitle) {
      doc.bookTitle = line.replace(/^# /, "").trim();
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      closeOrphan();
      closeChapter();
      orphanMode = false;
      const t = splitChapterTitle(line.replace(/^## /, "").trim());
      chapter = { id: `ch${doc.chapters.length}`, ...t, metaLine: "", jumpUrl: "", stats: "", items: [] };
      doc.counts.chapters++;
      i++;
      continue;
    }
    if (/^### 划线\s*\d+/.test(line) || /^### 💭 想法\s*\d+/.test(line)) {
      if (orphanMode) { closeOrphan(); orphanMode = false; }
      else closeItem();
      const isIdea = line.includes("💭");
      item = { id: `${chapter ? chapter.id : "noch"}-it${(chapter?.items.length || 0) + 1}`, type: isIdea ? "idea" : "highlight", heading: line.replace(/^### /, "").trim(), quote: [], extras: [], key: "" };
      if (isIdea) doc.counts.highlights += 0;
      else doc.counts.highlights++;
      // 收集引用块（容忍标题后的空行，与 merger.js 同一套容错）
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;
      while (i < lines.length && /^>/.test(lines[i]) && !/^>\s*\[!/.test(lines[i])) {
        item.quote.push(lines[i].replace(/^> ?/, ""));
        i++;
      }
      continue;
    }
    if (/^### 💭 仅想法/.test(line)) {
      closeItem();
      closeChapter();
      orphanMode = true;
      i++;
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      closeOrphan();
      closeItem();
      i++;
      continue;
    }

    if (!doc.headerMeta && /^> 阅读时间/.test(line)) {
      doc.headerMeta = line.replace(/^> ?/, "");
      i++;
      continue;
    }
    if (chapter && !item && !chapter.stats && /^\[跳转章节\]/.test(line)) {
      const m = line.match(/\((.+?)\)/);
      chapter.jumpUrl = m ? m[1] : "";
      chapter.stats = line.split("｜").slice(1).join("｜").trim();
      chapter.metaLine = line;
      i++;
      continue;
    }
    if (chapter && !item && !chapter.metaLine && !chapter.jumpUrl && /^>/.test(line) && doc.chapters.length === 0) {
      // 兜底：首个章节前的其它引用行
      i++;
      continue;
    }
    if (item) {
      item.extras.push(line);
    } else if (orphanMode) {
      orphanBuffer.push(line);
    } else if (chapter && !chapter.metaLine) {
      // 章节标题与跳转行之间的杂项
      chapter.metaLine = line;
    }
    i++;
  }
  closeOrphan();
  closeChapter();

  // 想法条目（### 💭 想法 N）本身计为一条想法（quote 是原文摘录，extras 含 💭）
  doc.counts.ideas += doc.chapters.reduce(
    (n, c) => n + c.items.filter((it) => it.type === "idea").length,
    0
  );
  doc.counts.ideas += doc.orphans.filter((o) => o.kind === "idea").length;
  return doc;
}

/** 书架列表：全部 .md 的元信息 + 统计 */
export function listNotes() {
  const dir = notesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const p = path.join(dir, file);
      let content = "";
      try {
        content = fs.readFileSync(p, "utf-8");
      } catch {
        return null;
      }
      const doc = parseNoteStructured(content);
      const st = fs.statSync(p);
      return {
        file,
        bookId: doc.meta.bookId || null,
        title: doc.meta.title || doc.bookTitle || file.replace(/_读书笔记\.md$/, ""),
        displayTitle: doc.bookTitle || doc.meta.title || file.replace(/\.md$/, ""),
        author: doc.meta.author || "",
        cover: doc.meta.cover || "",
        status: doc.meta.status || "",
        progress: Number(doc.meta.progress) || 0,
        syncedAt: doc.meta.synced_at || "",
        createdAt: doc.meta.created || "",
        manual: !doc.meta.bookId,
        counts: doc.counts,
        mtime: st.mtime.toISOString(),
      };
    })
    .filter(Boolean);
}

export function getNote(file) {
  const p = safeNotePath(file);
  if (!fs.existsSync(p)) throw new Error("笔记不存在");
  const content = fs.readFileSync(p, "utf-8");
  return { file: path.basename(p), ...parseNoteStructured(content) };
}

/** 重命名：只改文件名，不动内容（PRD §6） */
export function renameNote(file, newName) {
  const p = safeNotePath(file);
  if (!fs.existsSync(p)) throw new Error("笔记不存在");
  const stem = sanitizeFilename(newName);
  if (!stem) throw new Error("名称不能为空");
  const target = path.join(notesDir(), stem + ".md");
  if (fs.existsSync(target) && target !== p) throw new Error("同名笔记已存在");
  fs.renameSync(p, target);
  return path.basename(target);
}

/** 删除：物理删除笔记 + 连带删 attachments 里以其前缀命名的图片（PRD §6） */
export function deleteNote(file) {
  const p = safeNotePath(file);
  if (!fs.existsSync(p)) throw new Error("笔记不存在");
  const stem = path.basename(p, ".md");
  let removedImages = 0;
  const adir = attachmentsDir();
  if (fs.existsSync(adir)) {
    for (const f of fs.readdirSync(adir)) {
      if (f.startsWith(stem + "_")) {
        fs.unlinkSync(path.join(adir, f));
        removedImages++;
      }
    }
  }
  fs.unlinkSync(p);
  return { removedImages };
}
