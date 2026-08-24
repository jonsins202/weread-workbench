// 笔记渲染器（PRD §5.3 结构，与用户手写笔记同构）
import { chineseNumeral, cleanText, quoteKey, noteFilename } from "./naming.js";
import {
  splitSegments,
  extractIdeaContent,
  contentKey,
} from "./merger.js";

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtMonth(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
function yamlStr(v) {
  return `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function rangeStart(range) {
  return parseInt(String(range || "0").split("-")[0], 10) || 0;
}
function parseRange(range) {
  const m = String(range || "").match(/^(\d+)-(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [null, null];
}
/**
 * 想法 → 宿主划线匹配：先精确匹配 range；
 * 实测想法的 range 末位与划线可能差 1（如 17104-17303 vs 17104-17304），加 ±2 容差兜底
 */
function findHost(review, bookmarks) {
  if (!review.range) return null;
  const exact = (bookmarks || []).find((b) => b.range === review.range);
  if (exact) return exact;
  const [rs, re] = parseRange(review.range);
  if (rs === null) return null;
  return (
    (bookmarks || []).find((b) => {
      const [bs, be] = parseRange(b.range);
      return bs === rs && be !== null && Math.abs(be - re) <= 2;
    }) || null
  );
}
function quoteBlock(text) {
  return cleanText(text)
    .split(/\n/)
    .map((l) => `> ${l.trim()}`)
    .join("\n");
}

/**
 * 把服务端想法渲染成 💭 段（多行内容首行带前缀，续行缩进跟随）
 */
function renderIdea(content) {
  const lines = cleanText(content).split(/\n/);
  const first = `💭 **我的想法：** ${lines[0].trim()}`;
  const rest = lines.slice(1).map((l) => l.trim()).filter(Boolean);
  return [first, ...rest].join("\n");
}

/**
 * 组装单条划线/想法的附加内容：
 * 服务端想法（重新生成）+ 已有文件中保留的用户内容（去重后原样保留）
 * allServerIdeaKeys：全书范围的服务端想法内容键（跨位置去重，防止附件位置漂移时旧副本残留）
 * pencilOf(r)：手写笔记图片引用（wikilink 或远程 URL），无则空串
 */
function assembleExtras(serverReviews, preservedRaw, allServerIdeaKeys, allServerImageNames, pencilLineOf) {
  const parts = [];
  const serverKeys = new Set(serverReviews.map((r) => contentKey(r.content)));
  for (const r of serverReviews) {
    if (cleanText(r.content)) parts.push(renderIdea(r.content));
    const line = pencilLineOf(r);
    if (line) parts.push(line);
  }
  // 整段原始内容按空行切块后逐块判断：与任一服务端想法/手写图片重复的剔除，其余原样保留
  for (const seg of preservedRaw.flatMap(splitSegments)) {
    const idea = extractIdeaContent(seg);
    const key = idea && contentKey(idea);
    if (key && (serverKeys.has(key) || allServerIdeaKeys.has(key))) continue;
    const imgName = seg.match(/^!\[\[(.+?)\]\]/)?.[1];
    if (imgName && allServerImageNames.has(imgName)) continue;
    parts.push(seg);
  }
  return parts;
}

/**
 * 渲染整篇笔记。
 * book: { bookId,title,author,cover,progress,finished,notebook },
 * bookmarks: bookmarklist.updated[], chaptersMeta: bookmarklist.chapters[],
 * reviews: reviewListMine[], existing: { extrasByQuoteKey, orphanRaw, created, syncedAt } | null,
 * now: Date
 */
export function renderNote({ book, bookmarks, chaptersMeta, reviews, existing, pencil = new Map(), now = new Date() }) {
  const created = existing?.created || fmtDate(now);
  const syncedAt = existing?.syncedAt || fmtDateTime(now);
  // 用户隐藏清单（PRD F4）：应用内删除的条目/想法不再被同步复活
  const hiddenKeys = new Set([].concat(existing?.hiddenKeys || []).map(String).filter(Boolean));
  const hiddenIdeas = new Set([].concat(existing?.hiddenIdeas || []).map(String).filter(Boolean));

  // ---- 章节表：划线接口的 chapters + 想法里出现的章节，按 chapterIdx 排序 ----
  const chapterMap = new Map(); // uid -> {uid, idx, title}
  for (const c of chaptersMeta || []) {
    chapterMap.set(String(c.chapterUid), {
      uid: String(c.chapterUid),
      idx: c.chapterIdx ?? 0,
      title: cleanText(c.title) || "未命名章节",
    });
  }
  for (const r of reviews || []) {
    const uid = String(r.chapterUid ?? "");
    if (uid && !chapterMap.has(uid)) {
      chapterMap.set(uid, {
        uid,
        idx: r.chapterIdx ?? 999999,
        title: cleanText(r.chapterTitle || r.chapterName) || "未命名章节",
      });
    }
  }
  const chapters = [...chapterMap.values()].sort((a, b) => a.idx - b.idx);

  // ---- 划线按章节分组，章内按 range 起点排序；想法按 range 挂到划线 ----
  // 注意：接口返回顺序不稳定，渲染前必须显式排序，否则同步永远判为「有变化」
  const byChapter = new Map(); // uid -> { highlights:[], ideas:[] }
  const ensure = (uid) => {
    if (!byChapter.has(uid)) byChapter.set(uid, { highlights: [], ideas: [] });
    return byChapter.get(uid);
  };
  for (const b of bookmarks || []) {
    if (hiddenKeys.has(quoteKey(cleanText(b.markText)))) continue; // 用户已删除该条目
    const uid = String(b.chapterUid ?? "");
    ensure(uid).highlights.push({
      quote: cleanText(b.markText),
      range: b.range,
      createTime: b.createTime,
    });
  }
  for (const g of byChapter.values()) {
    g.highlights.sort(
      (a, b) => rangeStart(a.range) - rangeStart(b.range) || (a.createTime || 0) - (b.createTime || 0)
    );
  }
  const reviewByKey = new Map(); // quoteKey -> [reviews]
  const orphanReviews = [];
  const sortedReviews = [...(reviews || [])].sort(
    (a, b) => (a.createTime || 0) - (b.createTime || 0) || String(a.reviewId || "").localeCompare(String(b.reviewId || ""))
  );
  // 全书服务端想法内容键：任何位置上与之重复的旧 💭 段都会被剔除（防位置漂移导致累积）
  const allServerIdeaKeys = new Set(
    sortedReviews.filter((r) => cleanText(r.content)).map((r) => contentKey(r.content))
  );
  // 手写笔记图片（reviewId -> {file} 已下载进 attachments / {url} 远程兜底）
  const pencilLineOf = (r) => {
    const v = pencil.get(r.reviewId);
    if (!v) return null;
    return v.file ? `![[${v.file}]]` : `![](${v.url})`;
  };
  const allServerImageNames = new Set([...pencil.values()].map((v) => v.file).filter(Boolean));
  for (const r of sortedReviews) {
    const content = cleanText(r.content);
    const hiddenIdea = !!content && hiddenIdeas.has(contentKey(content)); // 用户已删/已编辑该想法
    if (!content && !pencilLineOf(r)) continue;
    const host = findHost(r, bookmarks);
    if (host) {
      if (hiddenKeys.has(quoteKey(host.markText))) continue; // 宿主条目已删除
      if (hiddenIdea) continue; // 想法已隐藏：划线条目保留，仅不渲染这一条想法
      const key = quoteKey(host.markText);
      if (!reviewByKey.has(key)) reviewByKey.set(key, []);
      reviewByKey.get(key).push(r);
      continue;
    }
    // 无宿主划线：有原文摘录（abstract）→ 章节内的 💭 想法 条目；否则进「仅想法」
    if (r.abstract && String(r.chapterUid ?? "") !== "" && !hiddenKeys.has(quoteKey(cleanText(r.abstract)))) {
      ensure(String(r.chapterUid)).ideas.push({
        abstract: cleanText(r.abstract),
        range: r.range,
        createTime: r.createTime,
        review: r,
        hidden: hiddenIdea, // 隐藏想法仍保留条目壳（标题+原文），用户挂在条目下的内容不丢
      });
    } else if (!hiddenIdea) {
      orphanReviews.push(r);
    }
  }
  for (const g of byChapter.values()) {
    g.ideas.sort(
      (a, b) => rangeStart(a.range) - rangeStart(b.range) || (a.createTime || 0) - (b.createTime || 0)
    );
  }

  // ---- 逐章节渲染 ----
  const lines = [];
  const extrasMap = existing?.extrasByQuoteKey || new Map();
  let hlNo = 0;
  let ideaNo = 0;
  const totalHL = (bookmarks || []).length;

  lines.push(`# ${book.title} — 读书笔记`, "");
  const ts = [...(bookmarks || []).map((b) => b.createTime || 0), ...(reviews || []).map((r) => r.createTime || 0)].filter(Boolean);
  const month = ts.length ? fmtMonth(Math.min(...ts)) : `${now.getFullYear()}年${now.getMonth() + 1}月`;
  lines.push(
    `> 阅读时间：${month} ｜ 进度：${book.progress}% ｜ 打开阅读：[微信读书](weread://reading?bId=${book.bookId})`,
    ""
  );

  for (const ch of chapters) {
    const g = byChapter.get(ch.uid);
    if (!g || (!g.highlights.length && !g.ideas.length)) continue;
    const nIdeas =
      g.ideas.length +
      g.highlights.reduce((n, h) => n + (reviewByKey.get(quoteKey(h.quote))?.length || 0), 0);
    lines.push(
      "",
      `## ${chineseNumeral(chapters.indexOf(ch) + 1)}、${ch.title}`,
      "",
      `[跳转章节](weread://reading?bId=${book.bookId}&chapterUid=${ch.uid}) ｜ ${g.highlights.length} 条划线 · ${nIdeas} 条想法`,
      ""
    );

    for (const h of g.highlights) {
      hlNo += 1;
      const key = quoteKey(h.quote);
      const reviewsForHl = reviewByKey.get(key) || [];
      lines.push(`### 划线 ${hlNo}`, "", quoteBlock(h.quote));
      const extras = assembleExtras(reviewsForHl, extrasMap.get(key) || [], allServerIdeaKeys, allServerImageNames, pencilLineOf);
      if (extras.length) lines.push("", extras.join("\n\n"));
      lines.push("");
    }
    for (const it of g.ideas) {
      ideaNo += 1;
      const key = quoteKey(it.abstract);
      lines.push(`### 💭 想法 ${ideaNo}`, "", quoteBlock(it.abstract));
      const extras = assembleExtras(it.hidden ? [] : [it.review], extrasMap.get(key) || [], allServerIdeaKeys, allServerImageNames, pencilLineOf);
      if (extras.length) lines.push("", extras.join("\n\n"));
      lines.push("");
    }
  }

  // ---- 仅想法（无对应划线，也无原文摘录）----
  const preservedOrphanSegs = splitSegments(existing?.orphanRaw);
  const orphanParts = orphanReviews
    .map((r) => {
      const parts = [];
      if (cleanText(r.content)) parts.push(renderIdea(r.content));
      const line = pencilLineOf(r);
      if (line) parts.push(line);
      return parts.join("\n\n");
    })
    .filter(Boolean);
  for (const seg of preservedOrphanSegs) {
    const idea = extractIdeaContent(seg);
    const key = idea && contentKey(idea);
    if (key && allServerIdeaKeys.has(key)) continue;
    const imgName = seg.match(/^!\[\[(.+?)\]\]/)?.[1];
    if (imgName && allServerImageNames.has(imgName)) continue;
    orphanParts.push(seg);
  }
  if (orphanParts.length) {
    lines.push("", `### 💭 仅想法（无对应划线）`, "", orphanParts.join("\n\n"), "");
  }

  const hlCount = byChapter.size ? [...byChapter.values()].reduce((n, g) => n + g.highlights.length, 0) : 0;
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  const fmLines = [
    "---",
    `bookId: ${yamlStr(book.bookId)}`,
    `title: ${yamlStr(book.title)}`,
    `author: ${yamlStr(book.author)}`,
    `cover: ${yamlStr(book.cover)}`,
    `status: ${book.finished ? "读完" : "在读"}`,
    `progress: ${book.progress}`,
    "tags:",
    "  - 读书笔记",
    "  - 微信读书",
    "source: 微信读书",
    `created: ${created}`,
    `synced_at: ${syncedAt}`,
  ];
  // 用户隐藏清单随 frontmatter 一起重生成（应用内删除的条目/想法不被同步复活）
  for (const [k, set] of [["hidden_keys", hiddenKeys], ["hidden_ideas", hiddenIdeas]]) {
    if (set.size) {
      fmLines.push(`${k}:`);
      for (const v of set) fmLines.push(`  - ${yamlStr(v)}`);
    }
  }
  fmLines.push("---", "");
  const fm = fmLines.join("\n");

  const visibleReviews = sortedReviews.filter(
    (r) => !hiddenIdeas.has(contentKey(r.content)) && (!findHost(r, bookmarks) || !hiddenKeys.has(quoteKey(findHost(r, bookmarks).markText)))
  );
  return {
    filename: noteFilename(book.title),
    content: fm + body,
    stats: { highlights: hlCount, ideas: visibleReviews.length, chapters: chapters.length },
  };
}

/** 有真实变化时，用当前时间刷新 synced_at 再渲染一次 */
export function bumpSyncedAt(content) {
  return content.replace(/^(synced_at:).*$/m, `$1 ${fmtDateTime(new Date())}`);
}
