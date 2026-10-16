import { useCallback, useSyncExternalStore } from 'react';
import {
  allStockExportColumns,
  isStockExportKey,
  type StockExportColumn,
  type StockExportKey,
} from '@shared/domain';

/**
 * Which fields of stock / low-stock parts end up in a downloaded file or WhatsApp order.
 *
 * Allows shop owners to choose specific columns like "Item Name only" or "Item Name + Order Qty"
 * or any custom subset. The choice is remembered across visits in localStorage.
 */
const KEY = 'jmmr.stock-export-columns';

function readKeys(): Set<StockExportKey> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is StockExportKey => typeof value === 'string' && isStockExportKey(value)),
    );
  } catch {
    return new Set();
  }
}

function writeKeys(keys: ReadonlySet<StockExportKey>): void {
  try {
    if (keys.size === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify([...keys]));
  } catch {
    /* private mode */
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === KEY || event.key === null) emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

let cached: Set<StockExportKey> = new Set();
let cachedRaw: string | null = null;

function snapshot(): Set<StockExportKey> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readKeys();
  }
  return cached;
}

export interface StockColumnChoice {
  /** Every available column for stock export. */
  all: readonly StockExportColumn[];
  /** Ticked columns in defined order. */
  selected: StockExportColumn[];
  /** Comma-separated query string, e.g. "name,orderQty". */
  query: string;
  /** True when a custom subset of columns is active. */
  narrowed: boolean;
  isSelected: (key: StockExportKey) => boolean;
  toggle: (key: StockExportKey) => void;
  selectOnly: (key: StockExportKey) => void;
  selectAll: () => void;
  selectPreset: (keys: StockExportKey[]) => void;
}

export function useStockExportColumns(): StockColumnChoice {
  const keys = useSyncExternalStore(subscribe, snapshot, snapshot);
  const all = allStockExportColumns();

  const toggle = useCallback((key: StockExportKey) => {
    const next = readKeys();
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    writeKeys(next);
    emit();
  }, []);

  const selectOnly = useCallback((key: StockExportKey) => {
    writeKeys(new Set([key]));
    emit();
  }, []);

  const selectAll = useCallback(() => {
    writeKeys(new Set());
    emit();
  }, []);

  const selectPreset = useCallback((presetKeys: StockExportKey[]) => {
    writeKeys(new Set(presetKeys));
    emit();
  }, []);

  const chosen = keys.size > 0 ? all.filter((column) => keys.has(column.key)) : all;
  const selected = chosen.length > 0 ? chosen : all;

  return {
    all,
    selected,
    query: selected.map((column) => column.key).join(','),
    narrowed: keys.size > 0 && keys.size < all.length,
    isSelected: (key) => keys.size === 0 || keys.has(key),
    toggle,
    selectOnly,
    selectAll,
    selectPreset,
  };
}
