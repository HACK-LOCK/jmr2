import {
  isLowStock,
  round2,
  type ConsumeMode,
  type Part,
  type StockMovement,
} from '../../../shared/domain';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors';
import { newId, nowIso } from '../core/id';
import { mutate, read, type MutationResult } from '../data/mutate';
import { applyAdjust, applyStockIn, applyStockOut, applyReturn } from '../domain/stockOps';
import type { z } from 'zod';
import type { partCreateSchema, stockClearSchema, stockImportSchema } from '../validation/schemas';
import {
  syncAllStockToSupabase,
  syncPartToSupabase,
  syncStockMovementToSupabase,
} from './supabaseSync';

type PartInput = z.infer<typeof partCreateSchema>;

export interface PartListItem extends Part {
  low: boolean;
  stockValue: number;
  usedInOpenOrders: number;
}

export interface PartDetail extends Part {
  low: boolean;
  stockValue: number;
  movements: StockMovement[];
  openOrderLines: { orderId: string; quantity: number }[];
}

function decorate(part: Part, movements: StockMovement[], openLines: { orderId: string; quantity: number }[]): PartDetail {
  return {
    ...part,
    low: isLowStock(part),
    stockValue: round2(part.quantity * part.purchaseCost),
    movements,
    openOrderLines: openLines,
  };
}

function openLinesFor(partId: string): { orderId: string; quantity: number }[] {
  return read().orderParts
    .filter((line) => line.partId === partId && !line.consumed)
    .map((line) => ({ orderId: line.orderId, quantity: line.quantity }));
}

export function listParts(input: { q?: string; lowOnly?: boolean; includeInactive?: boolean } = {}): PartListItem[] {
  const db = read();
  const q = (input.q ?? '').trim().toLowerCase();
  const openByPart = new Map<string, number>();
  for (const line of db.orderParts) {
    if (line.consumed) continue;
    openByPart.set(line.partId, (openByPart.get(line.partId) ?? 0) + line.quantity);
  }

  return db.parts
    .filter((part) => (input.includeInactive ? true : part.active))
    .filter((part) => (input.lowOnly ? isLowStock(part) : true))
    .filter((part) =>
      q
        ? part.name.toLowerCase().includes(q) ||
          part.brand.toLowerCase().includes(q) ||
          part.model.toLowerCase().includes(q) ||
          part.id.toLowerCase().includes(q)
        : true,
    )
    .sort((a, b) => {
      if (input.lowOnly) {
        const aCrit = a.quantity < 2 ? 0 : 1;
        const bCrit = b.quantity < 2 ? 0 : 1;
        if (aCrit !== bCrit) return aCrit - bCrit;
        if (a.quantity !== b.quantity) return a.quantity - b.quantity;
      }
      return a.name.localeCompare(b.name);
    })
    .map((part) => ({
      ...part,
      low: isLowStock(part),
      stockValue: round2(part.quantity * part.purchaseCost),
      usedInOpenOrders: openByPart.get(part.id) ?? 0,
    }));
}

export function getPart(id: string): PartDetail {
  const db = read();
  const part = db.parts.find((item) => item.id === id);
  if (!part) throw new NotFoundError('Item not found.');
  const movements = db.stockMovements
    .filter((row) => row.partId === id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 100);
  return decorate(part, movements, openLinesFor(id));
}

/** A brand new item. Opening quantity is recorded as a proper Stock In. */
export async function createPart(
  input: PartInput,
  user: string,
): Promise<MutationResult<PartDetail>> {
  const now = nowIso();
  const partId = newId('PRT');
  const supplier = input.supplierId
    ? read().suppliers.find((item) => item.id === input.supplierId)
    : undefined;

  return mutate((draft) => {
    const part: Part = {
      id: partId,
      name: input.name,
      category: input.category,
      brand: input.brand,
      model: input.model,
      quantity: 0,
      minQuantity: input.minQuantity,
      purchaseCost: round2(input.purchaseCost),
      sellingPrice: round2(input.sellingPrice),
      supplierId: supplier?.id ?? '',
      supplierName: supplier?.name ?? '',
      consumeMode: input.consumeMode as ConsumeMode,
      active: input.active,
      createdAt: now,
      updatedAt: now,
    };
    draft.parts.push(part);

    if (input.quantity > 0) {
      applyStockIn(draft, {
        partId,
        quantity: input.quantity,
        type: 'IN',
        reason: 'Opening stock',
        user,
      });
    }
    return part.id;
  }).then((result) => {
    void syncPartToSupabase(result.data).catch(() => undefined);
    return {
      data: getPart(result.data),
      ...(result.warning ? { warning: result.warning } : {}),
    };
  });
}

export interface StockImportResult {
  /** Brand-new items added to the list. */
  created: number;
  /** Existing items that had the quantity added on top. */
  toppedUp: number;
  /** Lines that matched an existing item at quantity 0 - nothing to do. */
  unchanged: number;
  /** Every line read from the list, including the unchanged ones. */
  total: number;
}

export interface StockClearResult {
  affectedItems: number;
  mode: 'RESET_COUNT_ONLY' | 'DELETE_ITEMS';
  category: string;
}

/**
 * A supplier list imported in one go. New names become items with their opening
 * stock; names that are already on the shelf get the quantity added on top, so
 * the same list can come back next month without errors. Runs as one write, so
 * a list either lands whole or not at all.
 */
export async function importParts(
  input: z.infer<typeof stockImportSchema>,
  user: string,
): Promise<MutationResult<StockImportResult>> {
  const now = nowIso();
  return mutate((draft) => {
    // The whole file uses one key (movements get per-line sub keys), so sending
    // the same list twice is caught before a single quantity is doubled.
    if (
      input.idempotencyKey &&
      draft.stockMovements.some((row) => row.idempotencyKey.startsWith(`${input.idempotencyKey}#`))
    ) {
      throw new ConflictError('This stock list was already imported.');
    }

    let movementIndex = 0;
    const result: StockImportResult = { created: 0, toppedUp: 0, unchanged: 0, total: 0 };
    const movementKey = (): string =>
      input.idempotencyKey ? `${input.idempotencyKey}#${movementIndex++}` : '';

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const item of input.items) {
      const name = item.name.trim();
      const brand = item.brand.trim();
      const partId = (item.partId ?? '').trim();

      // Find existing active part:
      // 1. By direct partId if provided
      // 2. By exact name and brand
      // 3. By exact name alone
      // 4. By normalized string match (e.g. brand + name combined or clean token match)
      let existing: Part | undefined;
      if (partId) {
        existing = draft.parts.find((p) => p.id === partId && p.active);
      }
      if (!existing) {
        const nameLower = name.toLowerCase();
        const brandLower = brand.toLowerCase();
        const targetNorm = norm(name);
        const combinedNorm = norm(`${brand} ${name}`);

        existing = draft.parts.find((part) => {
          if (!part.active) return false;
          const pNameLower = part.name.trim().toLowerCase();
          const pBrandLower = part.brand.trim().toLowerCase();
          const pNorm = norm(part.name);
          const pCombinedNorm = norm(`${part.brand} ${part.name}`);

          if (pNameLower === nameLower && (!brand || pBrandLower === brandLower)) return true;
          if (pNameLower === nameLower) return true;
          if (pCombinedNorm && (pCombinedNorm === combinedNorm || pCombinedNorm === targetNorm)) return true;
          if (pNorm && (pNorm === combinedNorm || pNorm === targetNorm)) return true;
          return false;
        });
      }

      if (existing) {
        if (item.quantity > 0) {
          applyStockIn(draft, {
            partId: existing.id,
            quantity: item.quantity,
            type: 'IN',
            reason: 'Stock import',
            idempotencyKey: movementKey(),
            user,
          });
          result.toppedUp += 1;
        } else {
          result.unchanged += 1;
        }
      } else {
        const newPartId = newId('PRT');
        const part: Part = {
          id: newPartId,
          name,
          category: item.category?.trim() || 'Repair Part',
          brand,
          model: '',
          quantity: 0,
          minQuantity: 0,
          purchaseCost: 0,
          sellingPrice: 0,
          supplierId: '',
          supplierName: '',
          consumeMode: 'PART_USED',
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        draft.parts.push(part);
        if (item.quantity > 0) {
          applyStockIn(draft, {
            partId: newPartId,
            quantity: item.quantity,
            type: 'IN',
            reason: 'Stock import',
            idempotencyKey: movementKey(),
            user,
          });
        }
        result.created += 1;
      }
      result.total += 1;
    }

    return result;
  }).then((result) => {
    void syncAllStockToSupabase().catch(() => undefined);
    return { data: result.data };
  });
}

/**
 * Clears or resets stock information strictly on the stock side.
 * Orders, bills, customer records, and invoices are 100% untouched.
 *
 * Mode:
 *  - RESET_COUNT_ONLY: Resets stock count/quantity to 0 for matching items. Names and info stay in catalog.
 *  - DELETE_ITEMS: Deletes items completely (marks inactive), removing them from active stock.
 * Category:
 *  - 'ALL' or empty: All stock items.
 *  - Specific category: Only items in that category.
 */
export async function clearStock(
  input: z.infer<typeof stockClearSchema>,
  user: string,
): Promise<MutationResult<StockClearResult>> {
  const now = nowIso();
  return mutate((draft) => {
    const categoryFilter = (input.category ?? '').trim();
    const isAll = !categoryFilter || categoryFilter.toUpperCase() === 'ALL';

    const targetParts = draft.parts.filter((p) => {
      if (!p.active) return false;
      if (isAll) return true;
      return p.category.trim().toLowerCase() === categoryFilter.toLowerCase();
    });

    const targetPartIds = new Set(targetParts.map((p) => p.id));

    if (input.mode === 'RESET_COUNT_ONLY') {
      for (const part of targetParts) {
        const oldQty = part.quantity;
        part.quantity = 0;
        if (input.resetPrices) {
          part.purchaseCost = 0;
          part.sellingPrice = 0;
        }
        part.updatedAt = now;

        if (oldQty !== 0) {
          draft.stockMovements.push({
            id: newId('MOV'),
            partId: part.id,
            partName: part.name,
            orderId: '',
            type: 'ADJUST',
            quantity: Math.abs(oldQty),
            reason: 'Stock count cleared to 0',
            balanceAfter: 0,
            date: now,
            user,
            idempotencyKey: '',
            createdAt: now,
          });
        }
      }
    } else if (input.mode === 'DELETE_ITEMS') {
      for (const part of targetParts) {
        part.active = false;
        part.quantity = 0;
        part.updatedAt = now;
      }
    }

    if (input.clearMovements) {
      draft.stockMovements = draft.stockMovements.filter(
        (m) => !targetPartIds.has(m.partId),
      );
    }

    return {
      affectedItems: targetParts.length,
      mode: input.mode,
      category: isAll ? 'ALL' : categoryFilter,
    };
  }).then((result) => {
    void syncAllStockToSupabase().catch(() => undefined);
    return { data: result.data };
  });
}

export async function updatePart(
  id: string,
  patch: Partial<PartInput>,
): Promise<MutationResult<PartDetail>> {
  return mutate((draft) => {
    const part = draft.parts.find((item) => item.id === id);
    if (!part) throw new NotFoundError('Item not found.');
    if (patch.name !== undefined) part.name = patch.name;
    if (patch.category !== undefined) part.category = patch.category;
    if (patch.brand !== undefined) part.brand = patch.brand;
    if (patch.model !== undefined) part.model = patch.model;
    if (patch.minQuantity !== undefined) part.minQuantity = patch.minQuantity;
    if (patch.purchaseCost !== undefined) part.purchaseCost = round2(patch.purchaseCost);
    if (patch.sellingPrice !== undefined) part.sellingPrice = round2(patch.sellingPrice);
    if (patch.consumeMode !== undefined) part.consumeMode = patch.consumeMode;
    if (patch.active !== undefined) part.active = patch.active;
    if (patch.supplierId !== undefined) {
      const supplier = draft.suppliers.find((item) => item.id === patch.supplierId);
      part.supplierId = supplier?.id ?? '';
      part.supplierName = supplier?.name ?? '';
    }
    if (patch.quantity !== undefined && patch.quantity !== part.quantity) {
      throw new ValidationError('Use Stock In, Stock Out or Stock Correct to change quantity.');
    }
    part.updatedAt = nowIso();
    return part.id;
  }).then((result) => {
    void syncPartToSupabase(result.data).catch(() => undefined);
    return {
      data: getPart(result.data),
      ...(result.warning ? { warning: result.warning } : {}),
    };
  });
}

/**
 * Removes an item from the shop without touching history. Old bills and stock
 * movements keep referring to it, so the item is only marked inactive - it
 * disappears from the lists but the numbers on past bills stay correct.
 */
export async function deletePart(id: string): Promise<MutationResult<{ id: string }>> {
  return mutate((draft) => {
    const part = draft.parts.find((item) => item.id === id);
    if (!part) throw new NotFoundError('Item not found.');
    part.active = false;
    part.updatedAt = nowIso();
    return { id };
  }).then((result) => {
    void syncPartToSupabase(result.data.id).catch(() => undefined);
    return result;
  });
}

export async function stockIn(
  input: { partId: string; quantity: number; reason: string; idempotencyKey: string },
  user: string,
): Promise<MutationResult<{ movement: StockMovement; part: Part }>> {
  return mutate((draft) => {
    const { movement, part } = applyStockIn(draft, { ...input, type: 'IN', user });
    return { movement, part };
  }).then((result) => {
    void syncPartToSupabase(result.data.part.id).catch(() => undefined);
    void syncStockMovementToSupabase(result.data.movement.id).catch(() => undefined);
    return result;
  });
}

export async function stockOut(
  input: {
    partId: string;
    quantity: number;
    reason: string;
    orderId: string;
    idempotencyKey: string;
  },
  user: string,
): Promise<MutationResult<{ movement: StockMovement; part: Part }>> {
  return mutate((draft) => {
    const { movement, part } = applyStockOut(draft, { ...input, type: 'OUT', user });
    return { movement, part };
  }).then((result) => {
    void syncPartToSupabase(result.data.part.id).catch(() => undefined);
    void syncStockMovementToSupabase(result.data.movement.id).catch(() => undefined);
    return result;
  });
}

export async function stockReturn(
  input: { partId: string; quantity: number; reason: string; orderId: string },
  user: string,
): Promise<MutationResult<{ movement: StockMovement; part: Part }>> {
  return mutate((draft) => {
    const { movement, part } = applyReturn(draft, { ...input, type: 'RETURN', user });
    return { movement, part };
  }).then((result) => {
    void syncPartToSupabase(result.data.part.id).catch(() => undefined);
    void syncStockMovementToSupabase(result.data.movement.id).catch(() => undefined);
    return result;
  });
}

export async function stockAdjust(
  input: { partId: string; newQuantity: number; reason: string },
  user: string,
): Promise<MutationResult<{ movement: StockMovement; part: Part }>> {
  return mutate((draft) => {
    const { movement, part } = applyAdjust(draft, { ...input, user });
    return { movement, part };
  }).then((result) => {
    void syncPartToSupabase(result.data.part.id).catch(() => undefined);
    void syncStockMovementToSupabase(result.data.movement.id).catch(() => undefined);
    return result;
  });
}

export function listMovements(input: {
  partId?: string;
  orderId?: string;
  limit?: number;
} = {}): StockMovement[] {
  const db = read();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return db.stockMovements
    .filter((row) => (input.partId ? row.partId === input.partId : true))
    .filter((row) => (input.orderId ? row.orderId === input.orderId : true))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function lowStockItems(): PartListItem[] {
  return listParts({ lowOnly: true });
}

export function stockSummary(): {
  items: number;
  units: number;
  value: number;
  low: number;
} {
  const items = read().parts.filter((part) => part.active);
  return {
    items: items.length,
    units: items.reduce((sum, part) => sum + part.quantity, 0),
    value: round2(items.reduce((sum, part) => sum + part.quantity * part.purchaseCost, 0)),
    low: items.filter(isLowStock).length,
  };
}
