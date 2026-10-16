import {
  balanceAmount,
  customerExportColumns,
  isLowStock,
  payableAmount,
  round2,
  stockExportColumns,
  allStockExportColumns,
  type CustomerExportColumn,
  type StockExportColumn,
  type RepairOrder,
} from '../../../shared/domain';
import { shopDateString } from '../core/datetime';
import { normalizeMobile } from '../core/id';
import { NotFoundError, ValidationError } from '../core/errors';
import { read } from '../data/mutate';
import { listCustomers } from './customers';
import { renderCustomerListPdf } from '../pdf/customer-list';
import { buildWorkbook, type XlsxColumn } from '../xlsx/workbook';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A range the owner asked for, already checked. */
export interface BillRange {
  from: string;
  to: string;
}

/**
 * One bill, flattened for the screen and for the spreadsheet. Every money
 * figure is derived through the shared helpers, so a column can never disagree
 * with the bill the customer was handed.
 */
export interface BillHistoryRow {
  id: string;
  /** Bill date in the shop's calendar, YYYY-MM-DD. */
  date: string;
  customerName: string;
  mobile: string;
  deviceType: string;
  brand: string;
  model: string;
  device: string;
  complaint: string;
  status: string;
  paymentStatus: string;
  paymentMode: string;
  finalAmount: number;
  discount: number;
  /** What the customer owes in total. */
  total: number;
  /** Everything paid so far, at the counter and later. */
  advance: number;
  /** Still owed. Never negative. The same word the rest of the app uses. */
  balance: number;
  expectedDelivery: string;
  deliveredDate: string;
  technician: string;
  imei: string;
}

export interface BillHistory {
  from: string;
  to: string;
  count: number;
  total: number;
  advance: number;
  balance: number;
  bills: BillHistoryRow[];
}

/** One customer, flattened for the screen and for the spreadsheet. */
export interface CustomerHistoryRow {
  id: string;
  name: string;
  mobile: string;
  altMobile: string;
  email: string;
  address: string;
  repairCount: number;
  lastRepairDate: string;
  totalBilled: number;
  balanceDue: number;
  addedDate: string;
}

/* ------------------------------------------------------------------ */
/* Date handling                                                       */
/* ------------------------------------------------------------------ */

/** Accepts only a real YYYY-MM-DD day, so a typo cannot silently match nothing. */
function requireDay(value: string | undefined, label: string): string {
  const day = (value ?? '').trim();
  if (!day) throw new ValidationError(`Choose a ${label}.`);
  if (!ISO_DATE.test(day)) throw new ValidationError(`${label} is not a valid date.`);
  // Date.parse accepts 2026-02-31 and rolls it over to March, so check the round trip.
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new ValidationError(`${label} is not a valid date.`);
  }
  return day;
}

export function parseBillRange(input: { from?: string; to?: string }): BillRange {
  const from = requireDay(input.from, 'From date');
  const to = requireDay(input.to, 'To date');
  if (from > to) throw new ValidationError('From date must be on or before To date.');
  return { from, to };
}

function deviceName(order: Pick<RepairOrder, 'brand' | 'model' | 'deviceType'>): string {
  return [order.brand, order.model].filter(Boolean).join(' ') || order.deviceType;
}

function toBillRow(order: RepairOrder): BillHistoryRow {
  return {
    id: order.id,
    date: shopDateString(new Date(order.receivedAt)),
    customerName: order.customerName,
    mobile: order.mobile,
    deviceType: order.deviceType,
    brand: order.brand,
    model: order.model,
    device: deviceName(order),
    complaint: order.complaint,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMode: order.paymentMode,
    finalAmount: round2(order.finalAmount),
    discount: round2(order.discount),
    total: payableAmount(order),
    advance: round2(order.paidAmount),
    balance: balanceAmount(order),
    expectedDelivery: order.expectedDelivery,
    deliveredDate: order.deliveredAt ? shopDateString(new Date(order.deliveredAt)) : '',
    technician: order.technician,
    imei: order.imei,
  };
}

/**
 * Every bill written between two days, oldest first, one row per bill number.
 *
 * A bill is dated by when it was received, which is the same day the dashboard
 * counts as "Bills Today", so the two screens can never disagree. Cancelled
 * bills stay in: they were written on that day and the owner needs to see them.
 * The seen-set is a guard, not an optimisation - a restored backup can contain
 * the same id twice, and the spreadsheet must not either.
 */
export function billHistory(input: { from?: string; to?: string }): BillHistory {
  const { from, to } = parseBillRange(input);
  const seen = new Set<string>();
  const bills: BillHistoryRow[] = [];

  for (const order of read().orders) {
    if (seen.has(order.id)) continue;
    if (shopDateString(new Date(order.receivedAt)) < from) continue;
    if (shopDateString(new Date(order.receivedAt)) > to) continue;
    seen.add(order.id);
    bills.push(toBillRow(order));
  }

  bills.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  return {
    from,
    to,
    count: bills.length,
    total: round2(bills.reduce((sum, bill) => sum + bill.total, 0)),
    advance: round2(bills.reduce((sum, bill) => sum + bill.advance, 0)),
    balance: round2(bills.reduce((sum, bill) => sum + bill.balance, 0)),
    bills,
  };
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

function day(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : shopDateString(parsed);
}

function firstFilled(...values: string[]): string {
  return values.find((value) => value.trim() !== '') ?? '';
}

/**
 * One row per person, from the customers the app already keeps. Nothing is
 * created here and no second list exists.
 *
 * Customers are matched on mobile number when a bill is saved, so a repeat
 * number can only reach this far through a hand edit or a restored backup.
 * Those are folded into the row that is already there instead of being listed
 * twice, and the money follows the merge so the figures still add up.
 */
export function customerHistory(query = ''): CustomerHistoryRow[] {
  const merged = new Map<string, CustomerHistoryRow>();

  for (const customer of listCustomers(query, 5000)) {
    const mobile = normalizeMobile(customer.mobile);
    const key = mobile.length === 10 ? `m:${mobile}` : `i:${customer.id}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        id: customer.id,
        name: customer.name,
        mobile,
        altMobile: normalizeMobile(customer.altMobile),
        email: customer.email ?? '',
        address: customer.address ?? '',
        repairCount: customer.orderCount,
        lastRepairDate: day(customer.lastOrderAt),
        totalBilled: round2(customer.totalBilled),
        balanceDue: round2(customer.balanceDue),
        addedDate: day(customer.createdAt),
      });
      continue;
    }

    existing.name = firstFilled(existing.name, customer.name);
    existing.altMobile = firstFilled(existing.altMobile, normalizeMobile(customer.altMobile));
    existing.email = firstFilled(existing.email, customer.email ?? '');
    existing.address = firstFilled(existing.address, customer.address ?? '');
    existing.repairCount += customer.orderCount;
    // Later wins, and both sides go through the shop's calendar first so a
    // timestamp and a plain day can be compared at all.
    existing.lastRepairDate =
      day(customer.lastOrderAt) > existing.lastRepairDate ? day(customer.lastOrderAt) : existing.lastRepairDate;
    existing.totalBilled = round2(existing.totalBilled + customer.totalBilled);
    existing.balanceDue = round2(existing.balanceDue + customer.balanceDue);
    existing.addedDate =
      day(customer.createdAt) < existing.addedDate || !existing.addedDate
        ? day(customer.createdAt)
        : existing.addedDate;
  }

  return [...merged.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.mobile.localeCompare(b.mobile),
  );
}

/* ------------------------------------------------------------------ */
/* Spreadsheet                                                          */
/* ------------------------------------------------------------------ */

/**
 * The bill and customer columns come from one shared list, so the picker on
 * screen and the file that gets written can never disagree about what exists.
 */
const BILL_COLUMNS: XlsxColumn[] = [
  { header: 'Order ID', width: 12 },
  { header: 'Date', width: 12 },
  { header: 'Customer Name', width: 24 },
  { header: 'Mobile Number', width: 15 },
  { header: 'Device', width: 20 },
  { header: 'Device Type', width: 14 },
  { header: 'Problem', width: 32 },
  { header: 'Total Amount', width: 14, money: true },
  { header: 'Discount', width: 11, money: true },
  { header: 'Advance Paid', width: 14, money: true },
  { header: 'Balance Due', width: 13, money: true },
  { header: 'Payment Status', width: 15 },
  { header: 'Payment Mode', width: 13 },
  { header: 'Status', width: 20 },
  { header: 'Expected Delivery', width: 17 },
  { header: 'Delivered Date', width: 15 },
  { header: 'Technician', width: 16 },
  { header: 'IMEI', width: 16 },
];

/** One customer row cut down to exactly the ticked columns, in list order. */
function customerRowCells(
  customer: CustomerHistoryRow,
  columns: CustomerExportColumn[],
): (string | number)[] {
  return columns.map((column) => customer[column.key]);
}

/** Reads the ticked column keys out of a `?cols=` query value. */
export function parseCustomerExportColumns(raw: unknown): CustomerExportColumn[] {
  const asked =
    typeof raw === 'string'
      ? raw.split(',')
      : Array.isArray(raw)
        ? raw.flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
        : [];
  return customerExportColumns(asked);
}

function billRowCells(bill: BillHistoryRow): (string | number)[] {
  return [
    bill.id,
    bill.date,
    bill.customerName,
    bill.mobile,
    bill.device,
    bill.deviceType,
    bill.complaint,
    bill.total,
    bill.discount,
    bill.advance,
    bill.balance,
    bill.paymentStatus,
    bill.paymentMode,
    bill.status,
    bill.expectedDelivery,
    bill.deliveredDate,
    bill.technician,
    bill.imei,
  ];
}

/**
 * JMR-Bills-2026-09-27.xlsx for one day, or JMR-Bills-2026-09-01-to-2026-09-27.xlsx
 * for a range, so a file saved into a folder says what is inside it.
 */
export function billsFilename(range: BillRange): string {
  return range.from === range.to
    ? `JMR-Bills-${range.from}.xlsx`
    : `JMR-Bills-${range.from}-to-${range.to}.xlsx`;
}

/**
 * The bill spreadsheet: one sheet of bills and one sheet of totals, so the
 * totals never sit in the bill list where they could be mistaken for a bill.
 */
export function exportBills(input: { from?: string; to?: string }): { filename: string; buffer: Buffer } {
  const history = billHistory(input);
  if (history.bills.length === 0) {
    throw new NotFoundError(`No bills found for ${history.from === history.to ? 'this date' : 'this date range'}.`);
  }

  const buffer = buildWorkbook([
    { name: 'Bills', columns: BILL_COLUMNS, rows: history.bills.map(billRowCells) },
    {
      name: 'Summary',
      totalsRow: true,
      columns: [
        { header: 'Detail', width: 30 },
        { header: 'Value', width: 18 },
      ],
      rows: [
        ['From date', history.from],
        ['To date', history.to],
        ['Bills', history.count],
        ['Total amount', history.total],
        ['Advance collected', history.advance],
        ['Balance due', history.balance],
        ['Exported on', shopDateString()],
      ],
    },
  ]);

  return { filename: billsFilename({ from: history.from, to: history.to }), buffer };
}

/**
 * One customer file name for both formats, so a spreadsheet and a PDF of the
 * same list sit together in a folder looking like the same thing.
 */
export function customersFilename(extension: 'xlsx' | 'pdf'): string {
  return `JMR-Customer-History.${extension}`;
}

/**
 * The customer file, holding only the ticked columns. A download with no
 * `cols` keeps every column, which is what this button has always produced.
 */
function customerSelection(
  query: string,
  requested: readonly CustomerExportColumn[],
): { columns: CustomerExportColumn[]; rows: CustomerHistoryRow[] } {
  const columns = requested.length > 0 ? [...requested] : customerExportColumns();
  const rows = customerHistory(query);
  if (rows.length === 0) {
    throw new NotFoundError(
      query.trim() ? 'No customer found for this search.' : 'No customer data to export yet.',
    );
  }
  return { columns, rows };
}

export function exportCustomers(
  query = '',
  requested: readonly CustomerExportColumn[] = [],
): { filename: string; buffer: Buffer } {
  const { columns, rows } = customerSelection(query, requested);

  const buffer = buildWorkbook([
    {
      name: 'Customers',
      columns: columns.map((column) => ({ header: column.header, width: column.width, money: column.money })),
      rows: rows.map((row) => customerRowCells(row, columns)),
    },
  ]);

  return { filename: customersFilename('xlsx'), buffer };
}

/** The same rows and the same ticked columns, printed instead of written. */
export async function exportCustomersPdf(
  query = '',
  requested: readonly CustomerExportColumn[] = [],
): Promise<{ filename: string; buffer: Buffer }> {
  const { columns, rows } = customerSelection(query, requested);
  const buffer = await renderCustomerListPdf({
    shopName: read().settings.shopName,
    columns,
    rows: rows.map((row) => customerRowCells(row, columns)),
    exportedOn: shopDateString(),
    search: query,
  });
  return { filename: customersFilename('pdf'), buffer };
}

/** Reads the ticked stock column keys out of a `?cols=` query value. */
export function parseStockExportColumns(raw: unknown): StockExportColumn[] {
  const asked =
    typeof raw === 'string'
      ? raw.split(',')
      : Array.isArray(raw)
        ? raw.flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
        : [];
  return stockExportColumns(asked);
}

export interface LowStockExportInput {
  q?: string;
  brand?: string;
  categories?: string[];
  level?: 'all' | 'zero' | 'one';
  ids?: string[];
  cols?: StockExportColumn[];
  quantities?: Record<string, number>;
}

export function exportLowStockParts(input: LowStockExportInput = {}): { filename: string; buffer: Buffer } {
  const db = read();
  const q = (input.q ?? '').trim().toLowerCase();
  const brand = (input.brand ?? '').trim().toLowerCase();
  const categorySet =
    input.categories && input.categories.length > 0
      ? new Set(input.categories.map((c) => c.trim().toLowerCase()))
      : null;
  const idSet = input.ids && input.ids.length > 0 ? new Set(input.ids) : null;

  let parts = db.parts.filter((part) => part.active && isLowStock(part));

  if (input.level === 'zero') {
    parts = parts.filter((part) => part.quantity <= 0);
  } else if (input.level === 'one') {
    parts = parts.filter((part) => part.quantity <= 1);
  }

  if (brand && brand !== 'all') {
    parts = parts.filter((part) => part.brand.toLowerCase() === brand);
  }

  if (categorySet && categorySet.size > 0) {
    parts = parts.filter((part) => categorySet.has((part.category || '').toLowerCase()));
  }

  if (idSet && idSet.size > 0) {
    parts = parts.filter((part) => idSet.has(part.id));
  }

  if (q) {
    parts = parts.filter(
      (part) =>
        part.name.toLowerCase().includes(q) ||
        part.brand.toLowerCase().includes(q) ||
        part.model.toLowerCase().includes(q) ||
        (part.category || '').toLowerCase().includes(q),
    );
  }

  if (parts.length === 0) {
    throw new NotFoundError('No low stock items found matching the selected filter.');
  }

  // Parts with quantity < 2 appear at the very top (0 first, then 1)
  parts.sort((a, b) => {
    const aCrit = a.quantity < 2 ? 0 : 1;
    const bCrit = b.quantity < 2 ? 0 : 1;
    if (aCrit !== bCrit) return aCrit - bCrit;
    if (a.quantity !== b.quantity) return a.quantity - b.quantity;
    return a.name.localeCompare(b.name);
  });

  const chosenColumns = input.cols && input.cols.length > 0 ? input.cols : allStockExportColumns();

  const columns: XlsxColumn[] = chosenColumns.map((col) => ({
    header: col.header,
    width: col.width,
    money: col.money,
  }));

  const rows = parts.map((part) => {
    const customQty = input.quantities?.[part.id];
    const orderQty =
      customQty !== undefined && customQty > 0
        ? customQty
        : Math.max(1, Math.max(part.minQuantity, 2) - part.quantity);

    return chosenColumns.map((col) => {
      switch (col.key) {
        case 'name':
          return part.name;
        case 'brand':
          return part.brand || '-';
        case 'model':
          return part.model || '-';
        case 'category':
          return part.category || '-';
        case 'quantity':
          return part.quantity;
        case 'minQuantity':
          return part.minQuantity;
        case 'orderQty':
          return orderQty;
        case 'purchaseCost':
          return part.purchaseCost;
        case 'supplierName':
          return part.supplierName || '-';
      }
    });
  });

  const outOfStockCount = parts.filter((p) => p.quantity <= 0).length;
  const criticalCount = parts.filter((p) => p.quantity === 1).length;
  const totalOrderUnits = parts.reduce((sum, p) => {
    const customQty = input.quantities?.[p.id];
    return (
      sum +
      (customQty !== undefined && customQty > 0
        ? customQty
        : Math.max(1, Math.max(p.minQuantity, 2) - p.quantity))
    );
  }, 0);
  const estimatedCost = round2(
    parts.reduce((sum, p) => {
      const customQty = input.quantities?.[p.id];
      const qty =
        customQty !== undefined && customQty > 0
          ? customQty
          : Math.max(1, Math.max(p.minQuantity, 2) - p.quantity);
      return sum + qty * p.purchaseCost;
    }, 0),
  );

  const buffer = buildWorkbook([
    {
      name: 'Order List',
      columns,
      rows,
    },
    {
      name: 'Summary',
      totalsRow: true,
      columns: [
        { header: 'Metric', width: 28 },
        { header: 'Value', width: 18 },
      ],
      rows: [
        ['Total Items to Order', parts.length],
        ['Out of Stock Items (0 Qty)', outOfStockCount],
        ['Critical Items (1 Qty)', criticalCount],
        ['Total Units Needed', totalOrderUnits],
        ['Estimated Order Cost', estimatedCost],
        ['Exported On', shopDateString()],
      ],
    },
  ]);

  const dateStr = shopDateString();
  const filename = `JMR-Low-Stock-Order-List-${dateStr}.xlsx`;
  return { filename, buffer };
}

function partOrderQty(p: { minQuantity: number; quantity: number }): number {
  return p.quantity;
}


