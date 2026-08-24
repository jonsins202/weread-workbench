// 同步器（PRD F1）：全量回填 + 增量更新，幂等，只在自管目录写文件
import fs from "node:fs";
import path from "node:path";
import { load, notesDir, attachmentsDir } from "./config.js";
import { listNotebooks, bookmarkList, reviewListMine } from "./weread.js";
import { renderNote, bumpSyncedAt } from "./template.js";
import { parseFrontmatter, parseNoteBody } from "./merger.js";
import { pencilImageName } from "./naming.js";

/**
 * 手写笔记图片下载到 attachments（确定性命名，已存在则跳过 → 幂等）。
 * dry-run 或下载失败时退回远程 URL，由模板渲染为 ![](url)。
 */
async function downloadPencilImages(reviews, title, dry) {
  const map = new Map();
  const dir = attachmentsDir();
  if (!dry) fs.mkdirSync(dir, { recursive: true });
  for (const r of reviews || []) {
    const url = r.pencilNote?.imageUrl;
    if (!url) continue;
    if (dry) {
      map.set(r.reviewId, { url });
      continue;
    }
    const ext = (url.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || "png").toLowerCase().replace("jpeg", "jpg");
    const name = pencilImageName(title, r.reviewId, ext);
    const target = path.join(dir, name);
    try {
      if (!fs.existsSync(target)) {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      }
      map.set(r.reviewId, { file: name });
    } catch (e) {
      console.log(`  [手写图片下载失败，退回远程链接] ${name}: ${e.message}`);
      map.set(r.reviewId, { url });
    }
  }
  return map;
}

/** 扫描自管目录，按 frontmatter bookId 建索引（PRD §6 锚点：改名也能找到） */
export function indexExistingNotes(dir) {
  const map = new Map(); // bookId -> { path, content, created, syncedAt, extrasByQuoteKey, orphanRaw }
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const p = path.join(dir, name);
    let content;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    if (!fm.bookId) {
      map.set(`#manual#${p}`, { path: p, content, manual: true, filename: name });
      continue;
    }
    const { extrasByQuoteKey, orphanRaw } = parseNoteBody(content);
    map.set(fm.bookId, {
      path: p,
      content,
      created: fm.created,
      syncedAt: fm.synced_at,
      hiddenKeys: Array.isArray(fm.hidden_keys) ? fm.hidden_keys : [],
      hiddenIdeas: Array.isArray(fm.hidden_ideas) ? fm.hidden_ideas : [],
      extrasByQuoteKey,
      orphanRaw,
      manual: false,
    });
  }
  return map;
}

/** 原子写入：临时文件 + rename（PRD §7） */
function atomicWrite(file, content) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

/**
 * 同步主流程
 * @param {{dryRun?: boolean, book?: string}} opts
 */
export async function syncAll(opts = {}) {
  const cfg = load();
  const dir = notesDir();
  const dry = !!opts.dryRun;
  const report = [];

  if (!dry) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(attachmentsDir(), { recursive: true });
  }

  const existing = indexExistingNotes(dir);
  const notebooks = await listNotebooks();
  const seenIds = new Set();

  for (const nb of notebooks) {
    seenIds.add(nb.bookId);
    if (opts.book && nb.bookId !== opts.book && !nb.title.includes(opts.book)) continue;

    const total = nb.noteCount + nb.reviewCount + nb.bookmarkCount;
    if (total === 0) {
      report.push(`[跳过] ${nb.title}（无笔记内容）`);
      continue;
    }

    let data;
    try {
      const [bl, reviews] = await Promise.all([
        bookmarkList(nb.bookId),
        reviewListMine(nb.bookId),
      ]);
      data = { bl, reviews };
    } catch (e) {
      report.push(`[失败] ${nb.title}: ${e.message}`);
      continue;
    }

    const prev = existing.get(nb.bookId) || null;
    const pencilMap = await downloadPencilImages(data.reviews, nb.title, dry);
    // 先用旧 synced_at 渲染：字节一致说明无任何变化（幂等跳过，不触碰文件）
    const rendered = renderNote({
      book: { ...nb, progress: nb.readingProgress },
      bookmarks: data.bl.updated || [],
      chaptersMeta: data.bl.chapters || [],
      reviews: data.reviews,
      existing: prev,
      pencil: pencilMap,
    });

    const target = prev ? prev.path : path.join(dir, rendered.filename);
    // 文件名被其它书占用（罕见）→ 附加 bookId 防覆盖
    let finalPath = target;
    if (!prev && fs.existsSync(finalPath)) {
      const other = [...existing.values()].find((e) => e.path === finalPath);
      if (other && other.manual) {
        finalPath = path.join(dir, rendered.filename.replace(/\.md$/, ` (${nb.bookId}).md`));
      }
    }

    if (prev && prev.content === rendered.content) {
      report.push(`[无变化] ${nb.title}（划线${rendered.stats.highlights} 想法${rendered.stats.ideas}）`);
      continue;
    }

    const newContent = prev ? bumpSyncedAt(rendered.content) : rendered.content;
    if (dry) {
      report.push(`[将${prev ? "更新" : "新建"}] ${nb.title} -> ${path.basename(finalPath)}（划线${rendered.stats.highlights} 想法${rendered.stats.ideas}）`);
      continue;
    }
    atomicWrite(finalPath, newContent);
    report.push(`[${prev ? "更新" : "新建"}] ${nb.title} -> ${path.basename(finalPath)}（划线${rendered.stats.highlights} 想法${rendered.stats.ideas}）`);
  }

  // 自管目录里存在、但服务器笔记本列表没有的 bookId：仅提示，不动（可能是手动笔记或已删笔记）
  for (const [key, info] of existing) {
    if (info.manual) {
      report.push(`[手动] ${path.basename(info.path)}（无 bookId，不参与同步）`);
    } else if (!seenIds.has(key)) {
      report.push(`[孤儿] ${path.basename(info.path)}（bookId=${key} 不在服务器列表，保留不动）`);
    }
  }

  return report;
}
