export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 20;

const USERNAME_PATTERN = /^[A-Za-z0-9_\u3400-\u4DBF\u4E00-\u9FFF]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isValidUsername(value: string) {
  const normalized = normalizeUsername(value);
  const length = Array.from(normalized).length;
  return length >= USERNAME_MIN_LENGTH && length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(normalized);
}
