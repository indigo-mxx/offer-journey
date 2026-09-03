import { pinyin } from "pinyin-pro";

const SEPARATORS = /[\s\-_/.,，。；;:：|]+/g;

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function compactSearchText(value: string) {
  return normalizedText(value).replace(SEPARATORS, "");
}

export function searchTokens(query: string) {
  return normalizedText(query).split(SEPARATORS).map((item) => item.trim()).filter(Boolean);
}

export function pinyinSearchForms(value: string) {
  const syllables = pinyin(value, { toneType: "none", type: "array", nonZh: "consecutive" })
    .flatMap((part) => normalizedText(part).match(/[a-z0-9]+/g) ?? []);
  return {
    full: syllables.join(""),
    initials: syllables.map((syllable) => syllable[0]).join(""),
  };
}

function matchesToken(value: string, token: string) {
  const keyword = compactSearchText(token);
  if (!keyword) return true;
  if (compactSearchText(value).includes(keyword)) return true;
  if (!/^[a-z0-9]+$/.test(keyword) || keyword.length < 2) return false;

  const forms = pinyinSearchForms(value);
  if (forms.full.includes(keyword)) return true;

  // Two-letter initials are highly ambiguous: only accept an exact acronym
  // ("ys" -> 影石), not every longer acronym beginning with the same letters.
  if (keyword.length === 2) return forms.initials === keyword;
  if (keyword.length === 3) return forms.initials.startsWith(keyword);
  return forms.initials.includes(keyword);
}

export function matchesTextSearch(value: string, query: string) {
  const tokens = searchTokens(query);
  return tokens.length === 0 || tokens.every((token) => matchesToken(value, token));
}

export function matchesFieldsSearch(values: string[], query: string) {
  const tokens = searchTokens(query);
  return tokens.length === 0 || tokens.every((token) => values.some((value) => matchesToken(value, token)));
}

export function matchesLiteralSearch(value: string, query: string) {
  const normalized = normalizedText(value);
  const tokens = searchTokens(query);
  return tokens.length === 0 || tokens.every((token) => normalized.includes(normalizedText(token)));
}

export function autocompleteScore(value: string, query: string) {
  const keyword = compactSearchText(query.trim());
  if (!keyword) return 0;
  const normalized = compactSearchText(value);
  if (normalized.startsWith(keyword)) return 100;
  if (normalized.includes(keyword)) return 80;
  if (!/^[a-z0-9]+$/.test(keyword) || keyword.length < 2) return 0;
  const forms = pinyinSearchForms(value);
  if (forms.full.startsWith(keyword)) return 75;
  if (forms.full.includes(keyword)) return 68;
  if (keyword.length === 2 && forms.initials === keyword) return 72;
  if (keyword.length === 3 && forms.initials.startsWith(keyword)) return 70;
  if (keyword.length >= 4 && forms.initials.includes(keyword)) return 64;
  return 0;
}

export function matchingAutocompleteOptions(values: string[], query: string) {
  const options = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!query.trim()) return options;
  return options
    .map((value) => ({ value, score: autocompleteScore(value, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, "zh-CN"))
    .slice(0, 6)
    .map(({ value }) => value);
}
