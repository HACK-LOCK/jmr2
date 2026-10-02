import { round2, type Part, type StockMovement } from '../../../shared/domain';
import { read } from '../data/mutate';
import { ValidationError } from '../core/errors';
import { shopDateString } from '../core/datetime';
import { buildWorkbook, type XlsxColumn } from '../xlsx/workbook';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDay(value: string | undefined, label: string): string {
  const day = (value ?? '').trim();
  if (!day) throw new ValidationError(`Choose a ${label}.`);
  if (!ISO_DATE.test(day)) throw new ValidationError(`${label} is not a valid date.`);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new ValidationError(`${label} is not a valid date.`);
  }
  return day;
}

export interface StockAddedItem {
  movementId: string;
  partId: string;
  partName: string;
  category: string;
  brand: string;
  model: string;
  quantityAdded: number;
  balanceAfter: number;
  purchaseCost: number;
  sellingPrice: number;
  totalCost: number;
  supplierName: string;
  reason: string;
  time: string;
}

export interface StockAddedBatch {
  id: string; // Stock Added ID, e.g. "STK-ADD-0001"
  batchKey: string;
  date: string;
  day: string;
  user: string;
  reason: string;
  supplierName: string;
  totalItems: number;
  totalQuantity: number;
  totalValue: number;
  items: StockAddedItem[];
}

export interface StockHistoryReport {
  from: string;
  to: string;
  totalBatches: number;
  totalItems: number;
  totalQuantity: number;
  totalValue: number;
  batches: StockAddedBatch[];
  allAddedItems: (StockAddedItem & { stockAddedId: string; date: string; user: string })[];
}

/**
 * Groups all stock addition movements chronologically into stable batches
 * and assigns permanent sequential Stock Added IDs ("STK-ADD-0001", etc.).
 */
export function buildAllStockBatches(): StockAddedBatch[] {
  const db = read();
  const partsMap = new Map<string, Part>(db.parts.map((p) => [p.id, p]));

  // Only consider positive additions: type IN or RETURN
  const inMovements = db.stockMovements
    .filter((m) => m.type === 'IN' || m.type === 'RETURN')
    .sort((a, b) => (a.date || a.createdAt || '').localeCompare(b.date || b.createdAt || ''));

  interface RawBatch {
    batchKey: string;
    firstDate: string;
    user: string;
    reason: string;
    movements: StockMovement[];
  }

  const rawBatches: RawBatch[] = [];
  let currentBatch: RawBatch | null = null;

  for (const m of inMovements) {
    const mDate = m.date || m.createdAt || '';
    const mTime = new Date(mDate).getTime();
    const rawKey = m.idempotencyKey ? m.idempotencyKey.split('#')[0] : '';

    let belongsToCurrent = false;

    if (currentBatch) {
      if (rawKey && currentBatch.batchKey === rawKey) {
        belongsToCurrent = true;
      } else if (!rawKey && !currentBatch.batchKey) {
        const lastBatchTime = new Date(currentBatch.firstDate).getTime();
        const diffSeconds = Math.abs((mTime - lastBatchTime) / 1000);
        if (
          diffSeconds <= 60 &&
          currentBatch.user.toLowerCase() === (m.user || '').toLowerCase() &&
          currentBatch.reason.toLowerCase() === (m.reason || '').toLowerCase()
        ) {
          belongsToCurrent = true;
        }
      }
    }

    if (belongsToCurrent && currentBatch) {
      currentBatch.movements.push(m);
    } else {
      currentBatch = {
        batchKey: rawKey || `MOV_GRP_${m.id}`,
        firstDate: mDate,
        user: m.user || 'Ashok Bhai',
        reason: m.reason || 'Stock Added',
        movements: [m],
      };
      rawBatches.push(currentBatch);
    }
  }

  // Convert raw batches to formal StockAddedBatch with deterministic STK-ADD-XXXX ids
  return rawBatches.map((raw, index) => {
    const stockAddedId = `STK-ADD-${String(index + 1).padStart(4, '0')}`;
    const day = raw.firstDate.slice(0, 10);

    let totalQuantity = 0;
    let totalValue = 0;
    const supplierNames = new Set<string>();

    const items: StockAddedItem[] = raw.movements.map((m) => {
      const part = partsMap.get(m.partId);
      const purchaseCost = part?.purchaseCost ?? 0;
      const sellingPrice = part?.sellingPrice ?? 0;
      const totalCost = round2(m.quantity * purchaseCost);
      const supplier = part?.supplierName || '';
      if (supplier) supplierNames.add(supplier);

      totalQuantity += m.quantity;
      totalValue += totalCost;

      return {
        movementId: m.id,
        partId: m.partId,
        partName: m.partName || part?.name || 'Unnamed item',
        category: part?.category || 'Repair Part',
        brand: part?.brand || '',
        model: part?.model || '',
        quantityAdded: m.quantity,
        balanceAfter: m.balanceAfter,
        purchaseCost,
        sellingPrice,
        totalCost,
        supplierName: supplier,
        reason: m.reason || raw.reason,
        time: m.date || raw.firstDate,
      };
    });

    const supplierStr = Array.from(supplierNames).join(', ');

    return {
      id: stockAddedId,
      batchKey: raw.batchKey,
      date: raw.firstDate,
      day,
      user: raw.user,
      reason: raw.reason,
      supplierName: supplierStr,
      totalItems: items.length,
      totalQuantity,
      totalValue: round2(totalValue),
      items,
    };
  });
}

/**
 * Filter stock addition history by date range and search keyword.
 */
export function getStockHistory(filter: {
  from?: string;
  to?: string;
  q?: string;
}): StockHistoryReport {
  let from = filter.from ? requireDay(filter.from, 'From date') : '';
  let to = filter.to ? requireDay(filter.to, 'To date') : '';

  if (from && to && from > to) {
    throw new ValidationError('From date must be on or before To date.');
  }

  const allBatches = buildAllStockBatches();
  const q = (filter.q ?? '').trim().toLowerCase();

  const filteredBatches = allBatches.filter((b) => {
    if (from && b.day < from) return false;
    if (to && b.day > to) return false;
    if (q) {
      const matchesId = b.id.toLowerCase().includes(q);
      const matchesUser = b.user.toLowerCase().includes(q);
      const matchesReason = b.reason.toLowerCase().includes(q);
      const matchesSupplier = b.supplierName.toLowerCase().includes(q);
      const matchesItems = b.items.some(
        (it) =>
          it.partName.toLowerCase().includes(q) ||
          it.brand.toLowerCase().includes(q) ||
          it.model.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          it.partId.toLowerCase().includes(q),
      );
      if (!matchesId && !matchesUser && !matchesReason && !matchesSupplier && !matchesItems) {
        return false;
      }
    }
    return true;
  });

  // Calculate totals
  const totalBatches = filteredBatches.length;
  let totalItems = 0;
  let totalQuantity = 0;
  let totalValue = 0;

  const allAddedItems: (StockAddedItem & { stockAddedId: string; date: string; user: string })[] = [];

  for (const b of filteredBatches) {
    totalItems += b.totalItems;
    totalQuantity += b.totalQuantity;
    totalValue += b.totalValue;

    for (const it of b.items) {
      allAddedItems.push({
        ...it,
        stockAddedId: b.id,
        date: it.time || b.date,
        user: b.user,
      });
    }
  }

  // Sort batches newest first for display
  const sortedBatches = [...filteredBatches].sort((a, b) => b.date.localeCompare(a.date));
  const sortedItems = [...allAddedItems].sort((a, b) => b.date.localeCompare(a.date));

  return {
    from: from || allBatches[0]?.day || shopDateString(),
    to: to || allBatches[allBatches.length - 1]?.day || shopDateString(),
    totalBatches,
    totalItems,
    totalQuantity,
    totalValue: round2(totalValue),
    batches: sortedBatches,
    allAddedItems: sortedItems,
  };
}

/**
 * Excel export for Stock Addition History.
 */
export function exportStockHistory(filter: {
  from?: string;
  to?: string;
  q?: string;
}): { filename: string; buffer: Buffer } {
  const history = getStockHistory(filter);

  const itemColumns: XlsxColumn[] = [
    { header: 'Stock Added ID', width: 16 },
    { header: 'Date & Time', width: 22 },
    { header: 'Part Name', width: 28 },
    { header: 'Brand', width: 18 },
    { header: 'Model', width: 16 },
    { header: 'Category', width: 18 },
    { header: 'Quantity Added', width: 15 },
    { header: 'Stock After', width: 14 },
    { header: 'Unit Cost', width: 14, money: true },
    { header: 'Total Value', width: 15, money: true },
    { header: 'Selling Price', width: 15, money: true },
    { header: 'Supplier', width: 20 },
    { header: 'Added By', width: 16 },
    { header: 'Reason', width: 20 },
  ];

  const itemRows = history.allAddedItems.map((item) => [
    item.stockAddedId,
    item.date,
    item.partName,
    item.brand || '-',
    item.model || '-',
    item.category || '-',
    item.quantityAdded,
    item.balanceAfter,
    item.purchaseCost,
    item.totalCost,
    item.sellingPrice,
    item.supplierName || '-',
    item.user,
    item.reason,
  ]);

  const batchColumns: XlsxColumn[] = [
    { header: 'Stock Added ID', width: 16 },
    { header: 'Date & Time', width: 22 },
    { header: 'Reason', width: 20 },
    { header: 'Added By', width: 16 },
    { header: 'Supplier', width: 22 },
    { header: 'Parts Count', width: 14 },
    { header: 'Total Units Added', width: 18 },
    { header: 'Total Value Added', width: 18, money: true },
  ];

  const batchRows = history.batches.map((b) => [
    b.id,
    b.date,
    b.reason,
    b.user,
    b.supplierName || '-',
    b.totalItems,
    b.totalQuantity,
    b.totalValue,
  ]);

  const summaryColumns: XlsxColumn[] = [
    { header: 'Summary Metric', width: 30 },
    { header: 'Value', width: 24 },
  ];

  const summaryRows = [
    ['Report Period', `${history.from} to ${history.to}`],
    ['Total Addition Batches', history.totalBatches],
    ['Total Distinct Parts Added', history.totalItems],
    ['Total Stock Units Added', history.totalQuantity],
    ['Total Purchase Cost / Value', history.totalValue],
    ['Generated On', shopDateString()],
  ];

  const buffer = buildWorkbook([
    {
      name: 'All Added Parts',
      columns: itemColumns,
      rows: itemRows,
    },
    {
      name: 'Addition Batches',
      columns: batchColumns,
      rows: batchRows,
    },
    {
      name: 'Summary',
      totalsRow: true,
      columns: summaryColumns,
      rows: summaryRows,
    },
  ]);

  const rangeSuffix =
    history.from === history.to ? history.from : `${history.from}-to-${history.to}`;
  const filename = `JMR-Stock-History-${rangeSuffix}.xlsx`;

  return { filename, buffer };
}
