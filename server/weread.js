// weread 官方 Agent 网关客户端（零依赖，Node 原生 fetch）
// 契约依据 ~/.claude/skills/weread/{SKILL,notes}.md + 实测：
// - 业务参数平铺在 body 顶层，必带 skill_version
// - /user/notebooks 用 count + lastSort 游标分页（禁 offset/limit）
// - /review/list/mine 参数名是小写 bookid，用 synckey 翻页
// - markedStatus 实测：4=读完，其余视为在读
import { load, getKey } from "./config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(body) {
  const cfg = load();
  const payload = { ...body, skill_version: cfg.skillVersion };
  const res = await fetch(cfg.gateway, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + getKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.errcode) throw new Error(`errcode=${data.errcode} ${data.errmsg || ""}`);
  if (cfg.requestDelayMs > 0) await sleep(cfg.requestDelayMs);
  return data;
}

/** 笔记本概览（全量翻页）：[{bookId,title,author,cover,noteCount,reviewCount,readingProgress,markedStatus,sort}] */
export async function listNotebooks() {
  const out = [];
  let lastSort;
  for (;;) {
    const body = { api_name: "/user/notebooks", count: 50 };
    if (lastSort !== undefined) body.lastSort = lastSort;
    const page = await call(body);
    out.push(...(page.books || []));
    if (page.hasMore === 1 && (page.books || []).length) {
      lastSort = page.books[page.books.length - 1].sort;
    } else {
      break;
    }
  }
  return out.map((b) => ({
    bookId: b.bookId,
    title: b.book?.title || b.bookId,
    author: b.book?.author || "",
    cover: b.book?.cover || "",
    noteCount: b.noteCount || 0,
    reviewCount: b.reviewCount || 0,
    bookmarkCount: b.bookmarkCount || 0,
    readingProgress: b.readingProgress || 0,
    markedStatus: b.markedStatus || 0,
    finished: b.markedStatus === 4 || (b.readingProgress || 0) >= 100,
  }));
}

/** 划线列表：{ updated:[{chapterUid,chapterIdx,markText,createTime,range,...}], chapters:[{chapterUid,chapterIdx,title}] } */
export async function bookmarkList(bookId) {
  return call({ api_name: "/book/bookmarklist", bookId });
}

/** 全书热门划线 TOP20（同段共鸣）：{ items:[{chapterUid,range,markText,totalCount,...}] } */
export async function bestBookmarks(bookId) {
  return call({ api_name: "/book/bestbookmarks", bookId });
}

/** 指定划线范围下的公开想法（同段共鸣）；ranges 为字符串数组，每段取前 count 条 */
export async function readReviews(bookId, chapterUid, ranges, count = 5) {
  return call({
    api_name: "/book/readreviews",
    bookId,
    chapterUid,
    reviews: ranges.map((range) => ({ range, count })),
  });
}

/**
 * 个人想法全量翻页：[{content,abstract,range,chapterUid,chapterName,createTime,...}]
 * 实测注意：接口的 hasMore 不可靠（hasMore=0 时 totalCount 可能远大于已返回数），
 * count 调大到 50 可单页拉全；仍保留 synckey 翻页兜底 + reviewId 去重防重复。
 */
export async function reviewListMine(bookId) {
  const out = [];
  const seen = new Set();
  let synckey = 0;
  for (;;) {
    const page = await call({
      api_name: "/review/list/mine",
      bookid: bookId,
      synckey,
      count: 50,
    });
    const revs = page.reviews || [];
    let added = 0;
    for (const r of revs) {
      const id = r.review?.reviewId || r.reviewId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(r.review || r);
      added++;
    }
    if (!added || !page.synckey || page.synckey === synckey) break;
    if (revs.length < 50 && page.hasMore !== 1) break; // 一页没拉满且接口说没有更多
    synckey = page.synckey;
  }
  return out;
}
