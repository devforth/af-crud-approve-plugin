export type DiffRow = { path: string[]; before: unknown; after: unknown };

const CAPITAL_BOUNDARY_RE = /(?=[A-Z])/;

// copy of guessLabelFromName from adminforth/modules/utils.ts, so nested keys read like column labels
function label(name: string): string {
  const parts = name.includes('_') ? name.split('_') : name.includes('-') ? name.split('-') : name.split(CAPITAL_BOUNDARY_RE);
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

const isObject = (value: unknown) => typeof value === 'object' && value !== null;
const isNested = (value: unknown) => Array.isArray(value) ? value.some(isObject) : isObject(value);

/**
 * One row per plain value that differs between the records, nested JSON flattened into readable paths.
 * fieldsOrder lists keys to go first, in that order: "title" orders columns, "reward.type" orders keys inside
 * the "reward" JSON (inside every item when it is an array). Unlisted keys follow in the order they are stored.
 */
export function diffRows(oldRecord: object, newRecord: object, fieldsOrder: string[] = []): DiffRow[] {
  const rows: DiffRow[] = [];

  // keyPath is the path of raw keys without array indexes, "reward" or "promocodes"
  const listedKeys = (keyPath: string) => {
    const prefix = keyPath ? `${keyPath}.` : '';
    return fieldsOrder
      .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('.'))
      .map((entry) => entry.slice(prefix.length));
  };

  const walk = (before: any, after: any, path: string[], keyPath: string): void => {
    // go inside only when both sides have the same nested shape (or one is missing), else a changed shape would hide a side
    const present = [before, after].filter((value) => value !== undefined && value !== null);
    const sameShape = present.every(isNested) && new Set(present.map(Array.isArray)).size === 1;
    if (!sameShape) {
      // a missing value and null both read "Empty", a row between them would show no change
      if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
        rows.push({ path, before, after });
      }
      return;
    }
    if (Array.isArray(before ?? after)) {
      const name = path[path.length - 1];
      for (let i = 0; i < Math.max(before?.length ?? 0, after?.length ?? 0); i++) {
        walk(before?.[i], after?.[i], [...path.slice(0, -1), `${name} #${i + 1}`], keyPath);
      }
    } else {
      for (const key of new Set([...listedKeys(keyPath), ...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        walk(before?.[key], after?.[key], [...path, label(key)], keyPath ? `${keyPath}.${key}` : key);
      }
    }
  };

  walk(oldRecord, newRecord, [], '');
  return rows;
}
