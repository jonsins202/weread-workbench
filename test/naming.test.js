import test from "node:test";
import assert from "node:assert/strict";
import {
  compactTitle,
  sanitizeFilename,
  noteFilename,
  noteStem,
  quoteKey,
  chineseNumeral,
  cleanText,
} from "../server/naming.js";

test("杂志标题紧凑式", () => {
  assert.equal(compactTitle("财经（2026年第18期）"), "财经2026第18期");
  assert.equal(compactTitle("财经(2026年第3期)"), "财经2026第3期");
});

test("普通书名只清洗非法字符", () => {
  assert.equal(sanitizeFilename('全球通史：从史前到21世纪（第7版）_【美】斯塔夫里阿诺斯'), "全球通史：从史前到21世纪（第7版）_【美】斯塔夫里阿诺斯");
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
});

test("笔记文件名", () => {
  assert.equal(noteFilename("财经（2026年第18期）"), "财经2026第18期_读书笔记.md");
  assert.equal(noteFilename("牧羊少年奇幻之旅"), "牧羊少年奇幻之旅_读书笔记.md");
});

test("超长书名截断到 80 字", () => {
  const long = "很".repeat(100);
  assert.equal(noteStem(long).length, 80);
});

test("quoteKey 去空白取前 80 字", () => {
  assert.equal(quoteKey("你好 世界\n\t继续"), "你好世界继续");
  assert.equal(quoteKey("x".repeat(100)).length, 80);
});

test("中文数字", () => {
  assert.equal(chineseNumeral(1), "一");
  assert.equal(chineseNumeral(10), "十");
  assert.equal(chineseNumeral(12), "十二");
  assert.equal(chineseNumeral(21), "二十一");
  assert.equal(chineseNumeral(30), "三十");
});

test("cleanText 去零宽字符", () => {
  assert.equal(cleanText("墨西哥\u200b和中国"), "墨西哥和中国");
});
