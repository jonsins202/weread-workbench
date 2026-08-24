// stats.js — 阅读热力图数据（PRD 二期扩展）
// 微信读书 /readdata/detail 只有 monthly 模式返回"每日"数据（annually=月桶、overall=年桶），
// 因此滚动拉取最近 12 个月的 monthly(baseTime) 合并成日历热力图。
// 缓存：内存 30 分钟 + 项目 .cache 文件（重启不重拉）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, getKey } from "./config.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_FILE = path.join(ROOT, ".cache", "heatmap.json");
const TTL_MS = 30 * 60 * 1000;

/** Unix 秒 → UTC+8 日历日期 "YYYY-MM-DD"（weread 的时间戳按东八区对齐） */
export function tsToUTC8Date(ts) {
  return new Date((Number(ts) + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

/** 最近 n 个月（含当月）每月月中旬的时间戳（作为 baseTime 定位该月） */
export function monthMidStamps(now = new Date(), n = 12) {
  const out = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 用 UTC+8 语义近似：调用方传东八区"当前"时间即可
  for (let i = 0; i < n; i++) {
    let yy = y;
    let mm = m - i;
    while (mm < 0) {
      mm += 12;
      yy -= 1;
    }
    // 月中 15 号 12:00 UTC（对任意月份都安全落在月内）
    out.push(Date.UTC(yy, mm, 15, 12, 0, 0) / 1000);
  }
  return out;
}

/** 合并多个月度 readTimes 为日历数据与汇总（纯函数，可测） */
export function buildHeatmap(readTimesList, today = new Date()) {
  const daySeconds = new Map();
  for (const rt of readTimesList) {
    for (const [ts, sec] of Object.entries(rt || {})) {
      if (!Number(sec)) continue;
      const date = tsToUTC8Date(ts);
      daySeconds.set(date, (daySeconds.get(date) || 0) + Number(sec));
    }
  }
  const days = [...daySeconds.entries()]
    .map(([date, seconds]) => ({ date, seconds }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalSeconds = days.reduce((n, d) => n + d.seconds, 0);
  const longest = days.reduce((m, d) => Math.max(m, d.seconds), 0);
  return {
    days,
    totalSeconds,
    readDays: days.length,
    longestSeconds: longest,
    avgSeconds: days.length ? Math.round(totalSeconds / days.length) : 0,
    range: { from: days[0]?.date || "", to: days[days.length - 1]?.date || tsToUTC8Date(Date.now() / 1000) },
    generatedAt: new Date().toISOString(),
  };
}

let memo = null; // { data, at }

async function callReaddata(body) {
  const cfg = load();
  const res = await fetch(cfg.gateway, {
    method: "POST",
    headers: { Authorization: "Bearer " + getKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, skill_version: cfg.skillVersion }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`readdata errcode=${data.errcode} ${data.errmsg || ""}`);
  return data;
}

/** 拉取最近 12 个月每日阅读秒数（带缓存） */
export async function getHeatmap(force = false) {
  const now = Date.now();
  if (!force && memo && now - memo.at < TTL_MS) return memo.data;
  if (!force) {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        if (c.at && now - c.at < TTL_MS) {
          memo = c;
          return c.data;
        }
      }
    } catch {
      /* 缓存损坏则忽略 */
    }
  }
  const stamps = monthMidStamps();
  const readTimesList = [];
  for (const baseTime of stamps) {
    const d = await callReaddata({ api_name: "/readdata/detail", mode: "monthly", baseTime });
    readTimesList.push(d.readTimes || {});
  }
  const data = buildHeatmap(readTimesList);
  memo = { data, at: now };
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memo));
  } catch {
    /* 缓存写失败不影响主流程 */
  }
  return data;
}
