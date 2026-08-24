import test from "node:test";
import assert from "node:assert/strict";
import { matchTopToItems } from "../server/social.js";
import { buildPrompt } from "../server/agent.js";

const ctx = { bookTitle: "测试书", chapterTitle: "一、章", prev: "", current: "正文", next: "" };

test("matchTopToItems：精确键命中归属到条目", () => {
  const top = [{ key: "abcdefgh", count: 37, text: "热门段", ideas: [] }];
  const items = [{ key: "abcdefgh" }, { key: "zzzz" }];
  const { matched, others } = matchTopToItems(top, items);
  assert.equal(matched.size, 1);
  assert.ok(matched.has("abcdefgh"));
  assert.equal(others.length, 0);
});

test("matchTopToItems：前缀兜底（我的划线更长）", () => {
  const top = [{ key: "前缀重叠至少十二个字以上才算命中", count: 10, text: "t", ideas: [] }];
  const items = [{ key: "前缀重叠至少十二个字以上才算命中且我还多划了一截尾巴" }];
  const { matched, others } = matchTopToItems(top, items);
  assert.equal(matched.size, 1);
  assert.equal(others.length, 0);
});

test("matchTopToItems：热门段更长同样命中", () => {
  const top = [{ key: "开头完全一致且长度足够的同源段落热门版比较长", count: 9, text: "t", ideas: [] }];
  const items = [{ key: "开头完全一致且长度足够的同源段落" }];
  const { matched } = matchTopToItems(top, items);
  assert.equal(matched.size, 1);
});

test("matchTopToItems：重叠不足 12 字不匹配", () => {
  const top = [{ key: "短前缀abc", count: 5, text: "t", ideas: [] }];
  const items = [{ key: "短前缀abc后面是不同的内容走向" }];
  const { matched, others } = matchTopToItems(top, items);
  assert.equal(matched.size, 0);
  assert.equal(others.length, 1);
});

test("matchTopToItems：多条热门命中同一条目保留首条（热度最高），不落 others", () => {
  const key = "同一段落被两条热门条目覆盖的情况出现时";
  const top = [
    { key, count: 100, text: "t1", ideas: [] },
    { key: key + "略长一点", count: 50, text: "t2", ideas: [] },
  ];
  const items = [{ key }];
  const { matched, others } = matchTopToItems(top, items);
  assert.equal(matched.size, 1);
  assert.equal(matched.get(key).count, 100);
  assert.equal(others.length, 0);
});

test("matchTopToItems：完全无关的热门段落进 others", () => {
  const top = [
    { key: "毫无关系的段落一", count: 88, text: "a", ideas: [{ author: "x", content: "c", date: "2026-01-01" }] },
    { key: "毫无关系的段落二", count: 12, text: "b", ideas: [] },
  ];
  const items = [{ key: "我的划线" }];
  const { matched, others } = matchTopToItems(top, items);
  assert.equal(matched.size, 0);
  assert.equal(others.length, 2);
  assert.equal(others[0].ideas.length, 1);
});

test("buildPrompt：注入公众想法段且最多 3 条、每条截断", () => {
  const ideas = ["想法一", "想法二", "想法三", "想法四", "x".repeat(300)];
  const p = buildPrompt(ctx, "问题", [], ideas);
  assert.ok(p.includes("【其他读者对这段的想法】"));
  assert.ok(p.includes("读者1：想法一"));
  assert.ok(p.includes("读者3：想法三"));
  assert.ok(!p.includes("读者4：想法四"));
  assert.ok(p.includes("【本次问题】问题"));
});

test("buildPrompt：无公众想法时不出现该段", () => {
  const p = buildPrompt(ctx, "问题", [], []);
  assert.ok(!p.includes("其他读者"));
});
