export type DiffRow = { path: string[]; before: unknown; after: unknown };

const CAPITAL_BOUNDARY_RE = /(?=[A-Z])/;

// copy of guessLabelFromName from adminforth/modules/utils.ts, so nested keys read like column labels
function label(name: string): string {
  const parts = name.includes('_') ? name.split('_') : name.includes('-') ? name.split('-') : name.split(CAPITAL_BOUNDARY_RE);
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

const isObject = (value: unknown) => typeof value === 'object' && value !== null;
const isNested = (value: unknown) => Array.isArray(value) ? value.some(isObject) : isObject(value);

function walk(before: any, after: any, path: string[], rows: DiffRow[]): void {
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
      walk(before?.[i], after?.[i], [...path.slice(0, -1), `${name} #${i + 1}`], rows);
    }
  } else {
    for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
      walk(before?.[key], after?.[key], [...path, label(key)], rows);
    }
  }
}

/** One row per plain value that differs between the records, nested JSON flattened into readable paths. */
export function diffRows(oldRecord: object, newRecord: object): DiffRow[] {
  const rows: DiffRow[] = [];
  walk(oldRecord, newRecord, [], rows);
  return rows;
}
