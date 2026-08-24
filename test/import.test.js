import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 测试沙盒 vault（在导入前设置，config.js 读取环境变量）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wb-test-"));
process.env.WEREAD_VAULT_ROOT = TMP;
const NOTES = path.join(TMP, "微信读书笔记");
fs.mkdirSync(path.join(NOTES, "attachments"), { recursive: true });

const { renderNote } = await import("../server/template.js");
const { analyzeImport, executeImport } = await import("../server/import.js");
const { parseNoteStructured } = await import("../server/notes.js");
const { parseFrontmatter, parseNoteBody } = await import("../server/merger.js");

const book = { bookId: "777", title: "测试书", author: "作者", cover: "", progress: 60, finished: false };
const bookmarks = [
  { chapterUid: 1, chapterIdx: 1, markText: "可匹配的划线原文", range: "1-10", createTime: 1747000000 },
  { chapterUid: 1, chapterIdx: 1, markText: "另一条划线", range: "20-30", createTime: 1747100000 },
];
const chaptersMeta = [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }];
const reviews = [{ content: "服务端已有想法", range: "1-10", chapterUid: 1, createTime: 1747000100 }];

// 目标笔记（模拟已同步）
const target = renderNote({ book, bookmarks, chaptersMeta, reviews, existing: null });
fs.writeFileSync(path.join(NOTES, "测试书_读书笔记.md"), target.content);

// 旧笔记：划线式（可匹配 + 不可匹配）+ 随笔式 + 图片
const OLD_DIR = path.join(TMP, "旧笔记目录");
fs.mkdirSync(OLD_DIR, { recursive: true });
fs.writeFileSync(path.join(OLD_DIR, "old.png"), Buffer.from("89504e47", "hex"));
const oldNote = `# 测试书 — 读书笔记

> 阅读时间：2026年5月

## 一、第一章

### 划线 1

> 可匹配的划线原文

💭 **我的想法：** 服务端已有想法

💭 **我的思考：** 这是旧笔记独有的思考

![[old.png]]

> [!example] 🤖 AI 分析（Claude · 2026.05.01）
> **问：** 老问题
>
> **答：** 老回答

### 划线 2

> 旧笔记里有但服务器已删的划线

💭 **我的思考：** 无处安放的思考

### 思考 1：随笔标题

#### 🤖 AI发散

随笔正文内容。

`;
fs.writeFileSync(path.join(OLD_DIR, "旧测试_读书笔记.md"), oldNote);

test("analyze：匹配报告正确（匹配/转仅想法/随笔/图片/去重）", () => {
  const r = analyzeImport("旧笔记目录/旧测试_读书笔记.md");
  assert.ok(!r.error, r.error || "");
  assert.equal(r.matched.length, 1); // 划线1 匹配
  assert.equal(r.matched[0].segments, 3); // 思考+图片+callout（想法与服务器重复被跳过）
  assert.equal(r.skippedDup, 1); // 服务端已有想法
  assert.equal(r.unmatched.length, 1); // 划线2 → 仅想法
  assert.equal(r.essays.length, 1); // 思考1
  assert.equal(r.images.total, 1);
  assert.equal(r.ops.length, 5); // 3 + 1(转仅想法) + 1(随笔)
});

test("execute：内容落到正确位置，图片已复制，旧文件不动", () => {
  const before = fs.readFileSync(path.join(OLD_DIR, "旧测试_读书笔记.md"), "utf-8");
  const r = executeImport("旧笔记目录/旧测试_读书笔记.md");
  assert.ok(r.changed);
  assert.ok(r.message.includes("新挂 5 段"), r.message);
  const doc = parseNoteStructured(fs.readFileSync(path.join(NOTES, "测试书_读书笔记.md"), "utf-8"));
  // 匹配划线下：旧思考 + 图片 + callout（图片引用已改写）
  const it = doc.chapters[0].items[0];
  const kinds = it.extras.map((e) => e.kind).join(",");
  assert.ok(kinds.includes("thought") && kinds.includes("callout") && kinds.includes("image"), kinds);
  const imgSeg = it.extras.find((e) => e.kind === "image");
  assert.match(imgSeg.name, /^测试书_读书笔记_导入_old\.png$/);
  assert.ok(fs.existsSync(path.join(NOTES, "attachments", imgSeg.name)));
  // 仅想法区：无主划线（带原文引用）+ 随笔（标题转粗体）
  const orphansRaw = doc.orphans.map((o) => o.raw).join("\n---\n");
  assert.match(orphansRaw, /旧笔记里有但服务器已删的划线/);
  assert.match(orphansRaw, /无处安放的思考/);
  assert.match(orphansRaw, /\*\*思考 1：随笔标题\*\*/);
  assert.match(orphansRaw, /\*\*🤖 AI发散\*\*/);
  // 旧文件未动
  assert.equal(fs.readFileSync(path.join(OLD_DIR, "旧测试_读书笔记.md"), "utf-8"), before);
});

test("幂等：二次导入 0 新增", () => {
  const r = executeImport("旧笔记目录/旧测试_读书笔记.md");
  assert.equal(r.changed, false);
  assert.match(r.message, /没有可导入/);
});

test("路径越界拒绝", () => {
  assert.throws(() => analyzeImport("../outside.md"), /必须在 Obsidian 库内/);
});

test("v2：带「原文摘录」的随笔挂到对应想法条目下，原文不重复", () => {
  // 独立目标书：服务器想法以「想法条目」形式存在（有 abstract 无宿主划线）
  const t2 = renderNote({
    book: { bookId: "888", title: "随笔书", author: "", cover: "", progress: 10, finished: false },
    bookmarks: [],
    chaptersMeta: [],
    reviews: [{ content: "短想法", abstract: "某段独立原文", range: "9-9", chapterUid: 5, createTime: 1747000000 }],
    existing: null,
  });
  fs.writeFileSync(path.join(NOTES, "随笔书_读书笔记.md"), t2.content);
  // 旧笔记：随笔节带 原文摘录 → 应挂到想法条目下（丢摘录，保留思考）
  fs.writeFileSync(
    path.join(OLD_DIR, "随笔旧_读书笔记.md"),
    "# 随笔书 — 读书笔记\n\n### 思考 1：带摘录的随笔\n\n**原文摘录：**\n> 某段独立原文\n\n**我的思考：**\n围绕摘录的思考\n"
  );
  const plan = analyzeImport("旧笔记目录/随笔旧_读书笔记.md");
  assert.ok(!plan.error, plan.error || "");
  assert.equal(plan.ops.length, 1);
  assert.notEqual(plan.ops[0].itemKey, "__orphans__"); // 挂到条目，不是仅想法
  assert.match(plan.ops[0].segment.text, /围绕摘录的思考/);
  assert.doesNotMatch(plan.ops[0].segment.text, /某段独立原文/); // 重复原文被丢
  executeImport("旧笔记目录/随笔旧_读书笔记.md");
  const doc = parseNoteStructured(fs.readFileSync(path.join(NOTES, "随笔书_读书笔记.md"), "utf-8"));
  const entry = doc.chapters[0].items.find((i) => i.type === "idea");
  assert.ok(entry.extras.some((e) => (e.raw || "").includes("围绕摘录的思考")));
  assert.equal(doc.orphans.length, 0);
  // 同步后仍在（挂靠条目壳，extras 保全）
  const saved = fs.readFileSync(path.join(NOTES, "随笔书_读书笔记.md"), "utf-8");
  const fm = parseFrontmatter(saved);
  const body = parseNoteBody(saved);
  const resync = renderNote({
    book: { bookId: "888", title: "随笔书", author: "", cover: "", progress: 10, finished: false },
    bookmarks: [],
    chaptersMeta: [],
    reviews: [{ content: "短想法", abstract: "某段独立原文", range: "9-9", chapterUid: 5, createTime: 1747000000 }],
    existing: { created: fm.created, syncedAt: fm.synced_at, extrasByQuoteKey: body.extrasByQuoteKey, orphanRaw: body.orphanRaw },
  });
  assert.match(resync.content, /围绕摘录的思考/);
});

test("目标书未同步时给出明确错误", () => {
  fs.writeFileSync(path.join(OLD_DIR, "无目标_读书笔记.md"), "# 不存在的书 — 读书笔记\n\n### 划线 1\n\n> 原文\n");
  const r = analyzeImport("旧笔记目录/无目标_读书笔记.md");
  assert.match(r.error, /请先在书架同步/);
});
