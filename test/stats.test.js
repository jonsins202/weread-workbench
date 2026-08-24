import test from "node:test";
import assert from "node:assert/strict";
import { tsToUTC8Date, monthMidStamps, buildHeatmap } from "../server/stats.js";

test("Unix 秒按东八区转日期", () => {
  assert.equal(tsToUTC8Date(1767196800), "2026-01-01"); // 2026-01-01 00:00 +08
  assert.equal(tsToUTC8Date(1767196799), "2025-12-31"); // 前一秒
  assert.equal(tsToUTC8Date(1796054400), "2026-12-01");
});

test("monthMidStamps：连续 12 个月且都在月内", () => {
  const now = new Date(Date.UTC(2026, 7, 24, 4, 0, 0)); // 2026-08（0起算：7=8月）
  const stamps = monthMidStamps(now, 12);
  assert.equal(stamps.length, 12);
  const dates = stamps.map((s) => new Date(s * 1000).toISOString().slice(0, 7)).reverse();
  assert.equal(dates[0], "2025-09"); // reverse 后按时间正序：最旧在前
  assert.equal(dates[11], "2026-08");
  for (const s of stamps) assert.match(new Date(s * 1000).toISOString(), /-15T12:00:00/); // 都落在 15 号中午
});

test("buildHeatmap：合并/汇总/排序/跳过零值", () => {
  const h = buildHeatmap([
    { "1785513600": 3600, "1785600000": 120 }, // 2026-08-01 / 08-02 (+08)
    { "1785600000": 60, bogus: 0 },
    null,
  ]);
  assert.deepEqual(
    h.days,
    [
      { date: "2026-08-01", seconds: 3600 },
      { date: "2026-08-02", seconds: 180 },
    ]
  );
  assert.equal(h.totalSeconds, 3780);
  assert.equal(h.readDays, 2);
  assert.equal(h.longestSeconds, 3600);
  assert.equal(h.avgSeconds, 1890);
  assert.equal(h.range.from, "2026-08-01");
});
