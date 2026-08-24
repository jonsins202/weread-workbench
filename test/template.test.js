import test from "node:test";
import assert from "node:assert/strict";
import { renderNote, bumpSyncedAt } from "../server/template.js";
import { parseFrontmatter, parseNoteBody } from "../server/merger.js";

const book = {
  bookId: "3300207184",
  title: "财经（2026年第11期）",
  author: "财经",
  cover: "https://example.com/c.jpg",
  progress: 88,
  finished: false,
};

const bookmarks = [
  {
    chapterUid: 3,
    chapterIdx: 3,
    markText: "第一条划线原文",
    range: "100-120",
    createTime: 1747000000,
  },
  {
    chapterUid: 3,
    chapterIdx: 3,
    markText: "第二条划线原文",
    range: "200-240",
    createTime: 1747100000,
  },
];

const chaptersMeta = [{ chapterUid: 3, chapterIdx: 3, title: "算力短缺真相" }];

const reviews = [
  { content: "这条划线我的想法A", range: "100-120", chapterUid: 3, createTime: 1747000100 },
  { content: "没有宿主划线的想法", abstract: "被删除划线的原文", range: "999-1000", chapterUid: 3, createTime: 1747200000 },
  { content: "完全独立的想法", chapterUid: 0, createTime: 1747300000 },
];

function baseRender(existing = null) {
  return renderNote({ book, bookmarks, chaptersMeta, reviews, existing });
}

test("基本结构：frontmatter / 章节 / 划线编号 / 想法挂载", () => {
  const r = baseRender();
  assert.ok(r.content.startsWith("---\n"));
  const fm = parseFrontmatter(r.content);
  assert.equal(fm.bookId, "3300207184");
  assert.equal(fm.status, "在读");
  assert.match(r.content, /## 一、算力短缺真相/);
  assert.match(r.content, /### 划线 1[\s\S]*第一条划线原文/);
  assert.match(r.content, /### 划线 2[\s\S]*第二条划线原文/);
  // range 挂载：想法A 在划线1 下
  assert.match(r.content, /### 划线 1[\s\S]*?第一条划线原文[\s\S]*?💭 \*\*我的想法：\*\* 这条划线我的想法A[\s\S]*?### 划线 2/);
  // 无宿主但有原文摘录 → 💭 想法 条目
  assert.match(r.content, /### 💭 想法 1[\s\S]*被删除划线的原文[\s\S]*没有宿主划线的想法/);
  // 完全独立 → 仅想法区
  assert.match(r.content, /### 💭 仅想法（无对应划线）[\s\S]*完全独立的想法/);
  assert.equal(r.stats.highlights, 2);
  assert.equal(r.stats.ideas, 3);
});

test("幂等：渲染 → 解析 → 再渲染 字节一致", () => {
  const first = baseRender();
  const fm = parseFrontmatter(first.content);
  const { extrasByQuoteKey, orphanRaw } = parseNoteBody(first.content);
  const second = baseRender({ created: fm.created, syncedAt: fm.synced_at, extrasByQuoteKey, orphanRaw });
  assert.equal(second.content, first.content);
});

test("用户内容保全：手工批注/图片/AI callout 重同步不丢", () => {
  const first = baseRender();
  const withUser = first.content
    .replace(
      "💭 **我的想法：** 这条划线我的想法A",
      "💭 **我的想法：** 这条划线我的想法A\n\n💭 **我的思考：** 这是用户手写的思考\n\n![[截图_20260824.png]]\n\n> [!example] 🤖 AI 分析（Claude · 2026.08.24）\n> **问：** x\n>\n> **答：** y"
    )
    // 划线 2 的引用后面直接跟 callout（无 💭 间隔的边界情况）
    .replace(
      "> 第二条划线原文",
      "> 第二条划线原文\n\n> [!tip] 🧠 延伸思考\n> 紧跟引用的 callout"
    );
  const fm = parseFrontmatter(withUser);
  const { extrasByQuoteKey, orphanRaw } = parseNoteBody(withUser);
  const third = baseRender({ created: fm.created, syncedAt: fm.synced_at, extrasByQuoteKey, orphanRaw });
  // 服务端想法去重（不重复），用户三段内容全部保留
  assert.equal(third.content.match(/我的想法：\*\* 这条划线我的想法A/g).length, 1);
  assert.match(third.content, /我的思考：\*\* 这是用户手写的思考/);
  assert.match(third.content, /!\[\[截图_20260824\.png\]\]/);
  assert.match(third.content, /\[!example\] 🤖 AI 分析（Claude · 2026\.08\.24）/);
  // 紧跟引用的 callout 也保留，且不被并入划线原文
  assert.match(third.content, /### 划线 2\n\n> 第二条划线原文\n\n> \[!tip\] 🧠 延伸思考/);
});

test("新增划线时编号顺延、旧想法仍挂原划线", () => {
  const first = baseRender();
  const fm = parseFrontmatter(first.content);
  const { extrasByQuoteKey, orphanRaw } = parseNoteBody(first.content);
  const grown = baseRender({
    created: fm.created,
    syncedAt: fm.synced_at,
    extrasByQuoteKey,
    orphanRaw,
  });
  // 在中间插入一条新划线后重渲染
  const withNew = renderNote({
    book,
    bookmarks: [
      bookmarks[0],
      { chapterUid: 3, chapterIdx: 3, markText: "插入的新划线", range: "150-160", createTime: 1747050000 },
      bookmarks[1],
    ],
    chaptersMeta,
    reviews,
    existing: { created: fm.created, syncedAt: fm.synced_at, extrasByQuoteKey, orphanRaw },
  });
  assert.match(withNew.content, /### 划线 2[\s\S]*插入的新划线/);
  assert.match(withNew.content, /### 划线 3[\s\S]*第二条划线原文/);
  // 划线1 的服务端想法仍在划线1 下
  assert.match(withNew.content, /### 划线 1[\s\S]*?第一条划线原文[\s\S]*?这条划线我的想法A[\s\S]*?### 划线 2/);
});

test("bumpSyncedAt 只改 synced_at 行", () => {
  const first = baseRender();
  const bumped = bumpSyncedAt(first.content);
  // 除 synced_at 行外逐字节一致（同一分钟内 bump 可能恰好相等，属正常）
  const strip = (s) => s.replace(/^synced_at:.*$/m, "");
  assert.equal(strip(bumped), strip(first.content));
  assert.match(bumped, /^synced_at: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m);
});
