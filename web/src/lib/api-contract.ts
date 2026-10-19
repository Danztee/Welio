function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camelKey(key: string) {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

type ContractOptions = { opaquePaths?: readonly string[] };

function transformKeys(
  value: unknown,
  keyTransform: (key: string) => string,
  opaquePaths: readonly string[],
  path = "",
): unknown {
  if (opaquePaths.includes(path)) return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value))
    return value.map((item) =>
      transformKeys(item, keyTransform, opaquePaths, `${path}[]`),
    );

  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      keyTransform(key),
      transformKeys(
        item,
        keyTransform,
        opaquePaths,
        path ? `${path}.${key}` : key,
      ),
    ]),
  );
}

/** Convert the web app's camelCase models to the Go API's snake_case wire contract. */
export function toAPIContract(
  value: unknown,
  options: ContractOptions = {},
): unknown {
  return transformKeys(value, snakeKey, options.opaquePaths ?? []);
}

/** Convert snake_case API responses to the web app's camelCase models. */
export function fromAPIContract<T>(
  value: unknown,
  options: ContractOptions = {},
): T {
  return transformKeys(value, camelKey, options.opaquePaths ?? []) as T;
}
