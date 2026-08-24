// social.js — 同段共鸣（PRD 二期 P1-4）
// 数据链路：/book/bestbookmarks（全书热门划线 TOP20，带人数+原文）
//         → 按 chapterUid 分组调 /book/readreviews（热门段下的公开想法）。
// 归属匹配：笔记条目 key（quoteKey 文本指纹）与热门划线 markText 的 quoteKey 比对，
//           完全相等或互为前缀（重叠≥12字）视为同段——range 在不同接口间会漂移，不能比 range。
// 缓存：原始数据按 bookId 内存 + .cache/social-{bookId}.json，24 小时；
//       匹配每次请求实时算（笔记内容可能刚被编辑过）。
// 原则：公众内容只在 UI 展示，绝不写进 .md；用户点「引入」才经 writer 落盘为 callout。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quoteKey } from "./naming.js";
import { getNote } from "./notes.js";
import { bestBookmarks, readReviews } from "./weread.js";
import { tsToUTC8Date } from "./stats.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, ".cache");
const TTL_MS = 24 * 3600 * 1000;
const IDEAS_PER_RANGE = 5;
const PREFIX_MIN = 12; // 前缀匹配的最小重叠字数，防短前缀误配

const mem = new Map(); // bookId -> { top:[{range,chapterUid,count,text,ideas}], fetchedAtMs, fetchedAt }

/**
 * 热门划线 ↔ 我的条目 归属匹配（纯函数，可测）。
 * top: [{key, count, text, ideas}]；items: [{key}]。
 * 返回 { matched: Map<itemKey, top条目>, others: [top条目] }。
 * 规则：先精确命中，再前缀兜底（我的划线与热门段常同源不同长）；
 *       多条热门命中同一条目时保留人数最多的一条（bestbookmarks 本身按热度降序，取首个即可）。
 */
export function matchTopToItems(top, items) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const matched = new Map(); // itemKey -> top 条目
  const others = [];
  for (const t of top) {
    let item = byKey.get(t.key);
    if (!item) {
      for (const [k, it] of byKey) {
        const n = Math.min(k.length, t.key.length);
        if (n >= PREFIX_MIN && (k.startsWith(t.key) || t.key.startsWith(k))) {
          item = it;
          break;
        }
      }
    }
    if (item) {
      if (!matched.has(item.key)) matched.set(item.key, t);
      // 已被更高热度条目占用：仍算"我划过"，不落入 others
    } else {
      others.push(t);
    }
  }
  return { matched, others };
}

async function fetchRaw(bookId) {
  const bb = await bestBookmarks(bookId);
  const top = (bb.items || [])
    .map((it) => ({
      key: quoteKey(it.markText || ""),
      range: String(it.range || ""),
      chapterUid: it.chapterUid,
      count: it.totalCount || 0,
      text: String(it.markText || "").trim(),
      ideas: [],
    }))
    .filter((t) => t.text);

  const groups = new Map(); // chapterUid -> [top条目]
  for (const t of top) {
    if (!groups.has(t.chapterUid)) groups.set(t.chapterUid, []);
    groups.get(t.chapterUid).push(t);
  }
  for (const [chUid, list] of groups) {
    try {
      const rr = await readReviews(bookId, chUid, list.map((t) => t.range), IDEAS_PER_RANGE);
      for (const r of rr.reviews || []) {
        const t = list.find((x) => x.range === String(r.range));
        if (!t) continue;
        t.ideas = (r.pageReviews || [])
          .map((pr) => ({
            author: pr.review?.author?.name || "匿名读者",
            content: String(pr.review?.content || "").trim(),
            date: pr.review?.createTime ? tsToUTC8Date(pr.review.createTime) : "",
          }))
          .filter((i) => i.content);
      }
    } catch {
      // 单章想法拉取失败不致命，热门数据仍可展示
    }
  }
  return { top, fetchedAtMs: Date.now(), fetchedAt: new Date().toISOString() };
}

async function getRaw(bookId, force) {
  const now = Date.now();
  if (!force && mem.has(bookId)) {
    const v = mem.get(bookId);
    if (now - v.fetchedAtMs < TTL_MS) return v;
  }
  const cf = path.join(CACHE_DIR, `social-${bookId}.json`);
  if (!force && fs.existsSync(cf)) {
    try {
      const v = JSON.parse(fs.readFileSync(cf, "utf-8"));
      if (v?.top && now - v.fetchedAtMs < TTL_MS) {
        mem.set(bookId, v);
        return v;
      }
    } catch {
      // 缓存损坏则重拉
    }
  }
  const v = await fetchRaw(bookId);
  mem.set(bookId, v);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cf, JSON.stringify(v));
  return v;
}

/**
 * 某篇笔记的同段共鸣数据：
 * { fetchedAt, matched: { [itemKey]: {count, ideas:[{author,content,date}]} },
 *   others: [{count, text, ideas}] }  // others = 我没划过的热门段
 */
export async function getResonance(file, force = false) {
  const note = getNote(file);
  const bookId = note.meta?.bookId;
  if (!bookId) throw new Error("手动笔记没有 bookId，无同段共鸣数据");
  const raw = await getRaw(bookId, force);
  const items = note.chapters.flatMap((ch) => ch.items.map((it) => ({ key: it.key })));
  const { matched, others } = matchTopToItems(raw.top, items);
  const matchedOut = {};
  for (const [itemKey, t] of matched) {
    matchedOut[itemKey] = { count: t.count, ideas: t.ideas };
  }
  return { fetchedAt: raw.fetchedAt, matched: matchedOut, others };
}
