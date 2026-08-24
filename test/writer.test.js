import test from "node:test";
import assert from "node:assert/strict";
import { applyEdits, ORPHAN_KEY } from "../server/writer.js";
import { renderNote } from "../server/template.js";
import { parseFrontmatter, parseNoteBody } from "../server/merger.js";
import { parseNoteStructured } from "../server/notes.js";
import { quoteKey } from "../server/naming.js";

const book = {
  bookId: "999",
  title: "测试书",
  author: "作者",
  cover: "",
  progress: 50,
  finished: false,
};
const bookmarks = [
  { chapterUid: 1, chapterIdx: 1, markText: "第一条划线", range: "1-10", createTime: 1747000000 },
  { chapterUid: 1, chapterIdx: 1, markText: "第二条划线", range: "20-30", createTime: 1747100000 },
];
const chaptersMeta = [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }];
const reviews = [
  { content: "服务端想法A", range: "1-10", chapterUid: 1, createTime: 1747000100 },
  { content: "孤儿想法B", chapterUid: 0, createTime: 1747300000 },
];

function baseNote(extraOps = []) {
  const r = renderNote({ book, bookmarks, chaptersMeta, reviews, existing: null });
  return extraOps.length ? applyEdits(r.content, extraOps, { synced: true }).content : r.content;
}

const K1 = "第一条划线";
const K2 = "第二条划线";
const body = (c) => c.replace(/^---[\s\S]*?---\n/, ""); // 断言只看正文（frontmatter 的隐藏清单会包含被删文本）

test("writer：插入思考段 → 出现在对应划线下", () => {
  const out = applyEdits(baseNote(), [
    { type: "insertSegment", itemKey: K1, afterIndex: 0, segment: { kind: "thought", text: "我的手工思考" } },
  ], { synced: true }).content;
  assert.match(out, /### 划线 1[\s\S]*?第一条划线[\s\S]*?💭 \*\*我的想法：\*\* 服务端想法A[\s\S]*?💭 \*\*我的思考：\*\* 我的手工思考[\s\S]*?### 划线 2/);
});

test("writer：插入 callout 与图片", () => {
  const out = applyEdits(baseNote(), [
    { type: "insertSegment", itemKey: K2, afterIndex: null, segment: { kind: "callout", calloutType: "tip", title: "🧠 延伸思考", text: "行1\n行2" } },
    { type: "insertImage", itemKey: K2, afterIndex: null, name: "测试书_20260824_120000.png" },
  ], { synced: true }).content;
  assert.match(out, /> \[!tip\] 🧠 延伸思考\n> 行1\n> 行2/);
  assert.match(out, /!\[\[测试书_20260824_120000\.png\]\]/);
});

test("writer：更新段 + 删除段；其余内容无损", () => {
  const withThought = applyEdits(baseNote(), [
    { type: "insertSegment", itemKey: K1, afterIndex: null, segment: { kind: "thought", text: "待修改的思考" } },
  ], { synced: true }).content;
  const model1 = parseNoteStructured(withThought);
  const segCount1 = model1.counts.highlights + model1.counts.ideas;
  const out = applyEdits(withThought, [
    { type: "updateSegment", itemKey: K1, index: 1, segment: { kind: "thought", text: "改好的思考" } },
    { type: "deleteSegment", itemKey: K1, index: 0, }, // 删除服务端想法A → 记隐藏清单
  ], { synced: true }).content;
  assert.match(out, /💭 \*\*我的思考：\*\* 改好的思考/);
  assert.doesNotMatch(body(out), /服务端想法A/);
  const fm = parseFrontmatter(out);
  assert.ok(Array.isArray(fm.hidden_ideas) && fm.hidden_ideas.length === 1);
  // 条目与章节数不变（无损）
  const model2 = parseNoteStructured(out);
  assert.equal(model2.counts.highlights, model1.counts.highlights);
});

test("writer：删除条目 → frontmatter 隐藏 + 同步不复活", () => {
  const deleted = applyEdits(baseNote(), [{ type: "deleteItem", itemKey: K1 }], { synced: true }).content;
  assert.doesNotMatch(body(deleted), /第一条划线/);
  const fm = parseFrontmatter(deleted);
  assert.deepEqual(fm.hidden_keys, [K1]);
  // 模拟下次同步：带着 existing（隐藏清单+已解析内容）重渲染
  const { extrasByQuoteKey, orphanRaw } = parseNoteBody(deleted);
  const resync = renderNote({
    book, bookmarks, chaptersMeta, reviews,
    existing: {
      created: fm.created, syncedAt: fm.synced_at,
      hiddenKeys: fm.hidden_keys, hiddenIdeas: fm.hidden_ideas,
      extrasByQuoteKey, orphanRaw,
    },
  });
  assert.doesNotMatch(body(resync.content), /第一条划线/); // 不复活
  assert.match(resync.content, /第二条划线/);
  assert.match(resync.content, /hidden_keys:/); // 清单随 frontmatter 保留
  // 再同步一次（幂等）
  const fm2 = parseFrontmatter(resync.content);
  const p2 = parseNoteBody(resync.content);
  const resync2 = renderNote({
    book, bookmarks, chaptersMeta, reviews,
    existing: { created: fm2.created, syncedAt: fm2.synced_at, hiddenKeys: fm2.hidden_keys, hiddenIdeas: fm2.hidden_ideas, extrasByQuoteKey: p2.extrasByQuoteKey, orphanRaw: p2.orphanRaw },
  });
  assert.equal(resync2.content, resync.content);
});

test("writer：删除孤儿想法 → 隐藏后同步不复活", () => {
  const deleted = applyEdits(baseNote(), [{ type: "deleteSegment", itemKey: ORPHAN_KEY, index: 0 }], { synced: true }).content;
  assert.doesNotMatch(body(deleted), /孤儿想法B/);
  const fm = parseFrontmatter(deleted);
  assert.equal(fm.hidden_ideas.length, 1);
  const p = parseNoteBody(deleted);
  const resync = renderNote({
    book, bookmarks, chaptersMeta, reviews,
    existing: { created: fm.created, syncedAt: fm.synced_at, hiddenKeys: [], hiddenIdeas: fm.hidden_ideas, extrasByQuoteKey: p.extrasByQuoteKey, orphanRaw: p.orphanRaw },
  });
  assert.doesNotMatch(body(resync.content), /孤儿想法B/);
});

test("writer：外部修改后按内容锚点自动重定位", () => {
  const c1 = baseNote();
  // 外部在第 5 行插入一行（模拟 Obsidian 同时编辑）
  const lines = c1.split("\n");
  lines.splice(4, 0, "> 外部加的说明行");
  const c2 = lines.join("\n");
  const out = applyEdits(c2, [{ type: "insertSegment", itemKey: K2, afterIndex: null, segment: { kind: "thought", text: "外部修改后追加" } }], { synced: true }).content;
  assert.match(out, /外部加的说明行/); // 外部内容保留
  assert.match(out, /💭 \*\*我的思考：\*\* 外部修改后追加/); // 编辑仍落在正确位置
});

test("writer：锚点找不到时报错而非盲写", () => {
  const c = baseNote();
  assert.throws(
    () => applyEdits(c, [{ type: "deleteItem", itemKey: "不存在的划线xyz" }], { synced: true }),
    /定位失败/
  );
});

test("writer：手动笔记可改原文，同步笔记禁止", () => {
  const manual = baseNote().replace(/^bookId:.*$/m, "bookId: \"\"");
  const fmManual = parseFrontmatter(manual);
  assert.equal(fmManual.bookId, "");
  const out = applyEdits(manual, [{ type: "editQuote", itemKey: K1, text: "改写后的原文" }], { synced: false }).content;
  assert.match(out, /> 改写后的原文/);
  assert.throws(
    () => applyEdits(baseNote(), [{ type: "editQuote", itemKey: K1, text: "x" }], { synced: true }),
    /暂不支持/
  );
});

test("writer：编辑想法条目 → 同步后条目壳保留、用户编辑存活、原想法不复活", () => {
  // 想法条目（无宿主划线，有原文摘录 abstract）
  const solo = [{ content: "独立想法C", abstract: "某段原文", range: "99-100", chapterUid: 1, createTime: 1747400000 }];
  const base = renderNote({ book, bookmarks, chaptersMeta, reviews: solo, existing: null }).content;
  assert.match(base, /### 💭 想法 1[\s\S]*某段原文[\s\S]*💭 \*\*我的想法：\*\* 独立想法C/);
  // 应用内编辑这条想法 → 转为「我的思考」+ 原想法进隐藏清单
  const edited = applyEdits(base, [
    { type: "updateSegment", itemKey: quoteKey("某段原文"), index: 0, segment: { kind: "idea", text: "编辑后的想法" } },
  ], { synced: true }).content;
  assert.match(edited, /💭 \*\*我的思考：\*\* 编辑后的想法/);
  // 同步：壳（标题+原文）保留、编辑存活、原想法不复活
  const fm = parseFrontmatter(edited);
  const p = parseNoteBody(edited);
  const once = (content) => {
    const f = parseFrontmatter(content);
    const pp = parseNoteBody(content);
    return renderNote({
      book, bookmarks, chaptersMeta, reviews: solo,
      existing: { created: f.created, syncedAt: f.synced_at, hiddenKeys: Array.isArray(f.hidden_keys) ? f.hidden_keys : [], hiddenIdeas: Array.isArray(f.hidden_ideas) ? f.hidden_ideas : [], extrasByQuoteKey: pp.extrasByQuoteKey, orphanRaw: pp.orphanRaw },
    }).content;
  };
  const r1 = once(edited);
  assert.match(r1, /### 💭 想法 1\n\n> 某段原文/);
  assert.match(r1, /💭 \*\*我的思考：\*\* 编辑后的想法/);
  assert.doesNotMatch(body(r1), /💭 \*\*我的想法：\*\* 独立想法C/);
  const r2 = once(r1); // 幂等
  assert.equal(r2, r1);
});

test("writer：无操作时内容逐字节不变", () => {
  const c = baseNote([{ type: "insertSegment", itemKey: K1, afterIndex: null, segment: { kind: "thought", text: "已有思考" } }]);
  const { content } = applyEdits(c, [], { synced: true });
  assert.equal(content, c);
});
