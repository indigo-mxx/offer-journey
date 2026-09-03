import assert from "node:assert/strict";
import test from "node:test";

const { matchesFieldsSearch, matchingAutocompleteOptions } = await import("../lib/search.ts");

const rows = [
  ["台达电子", "机器人研发工程师", "上海/杭州"],
  ["原力灵机", "软件工程师", "北京"],
  ["新凯来", "自动化控制工程师", "上海"],
  ["视源股份（CVTE）", "嵌入式系统软件工程师", "合肥"],
  ["云深处科技", "具身导航算法工程师", "杭州"],
  ["特斯拉", "C++软件工程师（语音/图形/地图）", "上海"],
  ["影石", "决策规划算法工程师", "深圳"],
  ["宇树科技", "初级软件开发工程师", "杭州"],
  ["杉川机器人", "嵌入式软件工程师", "深圳"],
];

function companies(query) {
  return rows.filter((row) => matchesFieldsSearch(row, query)).map((row) => row[0]);
}

test("full pinyin search does not leak into unrelated rows", () => {
  assert.deepEqual(companies("taida"), ["台达电子"]);
});

test("two-letter initials require an exact acronym", () => {
  assert.deepEqual(companies("ys"), ["影石"]);
  assert.deepEqual(companies("ysc"), ["云深处科技"]);
  assert.deepEqual(companies("yskj"), ["宇树科技"]);
});

test("multiple query tokens may match different visible fields", () => {
  assert.deepEqual(companies("台达 杭州"), ["台达电子"]);
  assert.deepEqual(companies("软件 北京"), ["原力灵机"]);
});

test("autocomplete uses the same strict short-initial boundary", () => {
  assert.deepEqual(matchingAutocompleteOptions(rows.map((row) => row[0]), "ys"), ["影石"]);
});
