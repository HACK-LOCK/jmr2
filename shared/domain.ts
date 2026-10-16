/**
 * Shared domain model.
 * Imported by both the backend API and the PWA frontend so the two can never
 * drift apart. Contains ONLY types and constant tables (no runtime logic that
 * needs Node or the DOM).
 */

/* ------------------------------------------------------------------ */
/* Constant tables                                                     */
/* ------------------------------------------------------------------ */

/** Predefined repair statuses. Employees only ever pick from this list. */
export const ORDER_STATUSES = [
  'Received',
  'Checking',
  'Waiting for Approval',
  'Approved',
  'Repairing',
  'Waiting for Part',
  'Ready',
  'Delivered',
  'Cancelled',
  'Unable to Repair',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only statuses the counter ever sets: the device comes in, it gets
 * repaired, it goes back to the customer, or the job is called off. Nothing
 * else is offered.
 *
 * Cancelling is a label, not a deletion: the bill stays exactly where it is,
 * its parts stay on it, and nothing is written back to stock. It only takes
 * the bill out of the collection, the dues and the day's counts, which is what
 * a job that was never going to happen should do.
 *
 * ORDER_STATUSES stays the full set of values a stored bill may still hold, so
 * bills written before this trim keep reading, filtering and printing exactly
 * as they did. This is the shortlist the status buttons offer, not a narrowing
 * of what the server accepts.
 */
export const COUNTER_STATUSES = [
  'Received',
  'Repairing',
  'Ready',
  'Delivered',
  'Cancelled',
] as const satisfies readonly OrderStatus[];

/** Statuses that mean the device is physically in the shop being worked on. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'Received',
  'Checking',
  'Waiting for Approval',
  'Approved',
  'Repairing',
  'Waiting for Part',
];

/** Statuses that mean work has stopped but the device is still with us. */
export const ON_HOLD_ORDER_STATUSES: readonly OrderStatus[] = [
  'Waiting for Approval',
  'Waiting for Part',
];

/** Statuses that close an order. */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = [
  'Delivered',
  'Cancelled',
  'Unable to Repair',
];

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_STATUSES = ['Unpaid', 'Partially Paid', 'Paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** When a stock item is taken out of stock. */
export const CONSUME_MODES = ['PART_USED', 'DELIVERY'] as const;
/** PART_USED - physical repair parts (display, battery...). Stock leaves when employee confirms "Part Used".
 *  DELIVERY   - consumables (folders, packaging...). Stock leaves when the customer collects the device. */
export type ConsumeMode = (typeof CONSUME_MODES)[number];

export const CONSUME_MODE_LABELS: Record<ConsumeMode, string> = {
  PART_USED: 'Consume On Part Used',
  DELIVERY: 'Consume On Delivery',
};

export const STOCK_MOVEMENT_TYPES = ['IN', 'OUT', 'RETURN', 'ADJUST'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  IN: 'Stock In',
  OUT: 'Stock Out',
  RETURN: 'Part Returned',
  ADJUST: 'Stock Corrected',
};

export const PART_CATEGORIES = [
  'Repair Part',
  'Repair Material',
  'Battery',
  'Display',
  'Charger',
  'Back Cover',
  'Tempered Glass',
  'Speaker',
  'Mic',
  'Camera',
  'Earphone',
  'Circuit',
  'Button',
  'Connector',
  'Folder',
  'Accessory',
  'Other',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const DEVICE_TYPES = [
  'Mobile',
  'Laptop',
  'Computer',
  'Tablet',
  'TV',
  'Audio',
  'Other Device',
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_CONDITIONS = ['Good', 'Fair', 'Broken', 'Damaged'] as const;
export type DeviceCondition = (typeof DEVICE_CONDITIONS)[number];

/**
 * The faults this shop is asked to fix, in the order the counter tends to see
 * them. Offered as suggestions while the problem is typed, so a bill says
 * "Charging Socket (CC) Change" rather than however that was spelled that day -
 * which is what makes the history searchable and the printed bill readable.
 *
 * Not a closed list: the problem is free text, and anything a customer actually
 * says is kept word for word. "Other Problem" is the named fallback for the
 * faults that are not on the list.
 */
export const COMMON_PROBLEMS = [
  'Display Change',
  'Folder Change',
  'Body Frame Change',
  'Back Body Change',
  'Charging Socket (CC) Change',
  'Mic Problem',
  'Speaker / Ringer Problem',
  'Power On/Off Switch Problem',
  'Volume Up Button Problem',
  'Volume Down Button Problem',
  'Battery Problem',
  'Software Problem',
  'Software Lock Problem',
  'FRP Problem',
  'Network Problem',
  'Camera Problem',
  'CPU Problem',
  'Motherboard Problem',
  'Water Damage',
] as const;
export type CommonProblem = (typeof COMMON_PROBLEMS)[number];

/** The fallback label kept out of the suggestion list until nothing else fits. */
export const OTHER_PROBLEM = 'Other Problem';

export const USER_ROLES = ['OWNER', 'STAFF'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Tab groups used by the Google Sheet sync screen. */
export const DATASETS = [
  'customers',
  'orders',
  'payments',
  'parts',
  'stockMovements',
  'suppliers',
  'settings',
] as const;
export type DatasetKey = (typeof DATASETS)[number];

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface ShopSettings {
  shopName: string;
  contact1Name: string;
  contact1Number: string;
  contact2Name: string;
  contact2Number: string;
  address: string;
  serviceDescription: string;
  upiId: string;
  receiptInformation: string;
  /** Extra footer text shown on the job card / bill. */
  billFooter: string;
  /** Safety switch. false = stock can never go below zero. */
  allowNegativeStock: boolean;
  /** Which Google Sheet tab holds business data. */
  sheetName: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  altMobile: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Customer export columns                                             */
/* ------------------------------------------------------------------ */

/**
 * The columns a customer file may contain. This is the one list: the picker on
 * screen, the spreadsheet and the PDF all read it, so the screen can never
 * offer a column the exporter cannot produce, and a heading can never differ
 * between the two files.
 *
 * Every key is a field of a customer row, and no column invents a value that
 * the shop does not already hold.
 */
export const CUSTOMER_EXPORT_COLUMNS = [
  { key: 'name', header: 'Customer Name', width: 26 },
  { key: 'mobile', header: 'Mobile Number', width: 15 },
  { key: 'altMobile', header: 'Alternate Mobile', width: 17 },
  { key: 'repairCount', header: 'Repairs', width: 9 },
  { key: 'lastRepairDate', header: 'Last Repair Date', width: 16 },
  { key: 'totalBilled', header: 'Total Billed', width: 14, money: true },
  { key: 'balanceDue', header: 'Balance Due', width: 14, money: true },
  { key: 'email', header: 'Email', width: 24 },
  { key: 'address', header: 'Address', width: 32 },
  { key: 'addedDate', header: 'Added On', width: 13 },
] as const;

export type CustomerExportKey = (typeof CUSTOMER_EXPORT_COLUMNS)[number]['key'];

export interface CustomerExportColumn {
  key: CustomerExportKey;
  header: string;
  /** Relative weight, used to share out the width of a printed page. */
  width: number;
  /** True for the rupee columns, so money lines up and reads as money. */
  money: boolean;
}

const CUSTOMER_EXPORT_BY_KEY = new Map<string, CustomerExportColumn>(
  CUSTOMER_EXPORT_COLUMNS.map((column) => [
    column.key,
    { key: column.key, header: column.header, width: column.width, money: 'money' in column },
  ]),
);

export function isCustomerExportKey(value: string): value is CustomerExportKey {
  return CUSTOMER_EXPORT_BY_KEY.has(value);
}

/** Every column, in the order a file lists them when nothing was chosen. */
export function allCustomerExportColumns(): CustomerExportColumn[] {
  return CUSTOMER_EXPORT_COLUMNS.map((column) => CUSTOMER_EXPORT_BY_KEY.get(column.key) as CustomerExportColumn);
}

/**
 * Turns a requested list of keys into the columns to write, in the order this
 * file defines rather than the order they arrived, so the same choice always
 * produces the same file.
 *
 * An empty or unrecognised list means every column, which is what a download
 * asked for without a `cols` parameter has always meant. Keys that are not in
 * the list are dropped rather than guessed at, so a file can never end up with a
 * column nobody ticked.
 */
export function customerExportColumns(requested: readonly string[] = []): CustomerExportColumn[] {
  const wanted = new Set(requested.filter(isCustomerExportKey));
  if (wanted.size === 0) return allCustomerExportColumns();
  return allCustomerExportColumns().filter((column) => wanted.has(column.key));
}

/* ------------------------------------------------------------------ */
/* Stock export columns                                               */
/* ------------------------------------------------------------------ */

/**
 * The columns a stock or low-stock export file may contain.
 * Configurable so users can export specific columns like 'Item Name only'
 * or any custom subset for supplier re-orders.
 */
export const STOCK_EXPORT_COLUMNS = [
  { key: 'name', header: 'Item Name', width: 32 },
  { key: 'brand', header: 'Brand', width: 16 },
  { key: 'model', header: 'Model', width: 16 },
  { key: 'category', header: 'Category', width: 20 },
  { key: 'quantity', header: 'Current Stock', width: 14 },
  { key: 'minQuantity', header: 'Min Qty', width: 12 },
  { key: 'orderQty', header: 'Order Qty', width: 14 },
  { key: 'purchaseCost', header: 'Cost (₹)', width: 14, money: true },
  { key: 'supplierName', header: 'Supplier', width: 22 },
] as const;

export type StockExportKey = (typeof STOCK_EXPORT_COLUMNS)[number]['key'];

export interface StockExportColumn {
  key: StockExportKey;
  header: string;
  width: number;
  money: boolean;
}

const STOCK_EXPORT_BY_KEY = new Map<string, StockExportColumn>(
  STOCK_EXPORT_COLUMNS.map((column) => [
    column.key,
    { key: column.key, header: column.header, width: column.width, money: 'money' in column },
  ]),
);

export function isStockExportKey(value: string): value is StockExportKey {
  return STOCK_EXPORT_BY_KEY.has(value);
}

/** Every column in default order. */
export function allStockExportColumns(): StockExportColumn[] {
  return STOCK_EXPORT_COLUMNS.map((column) => STOCK_EXPORT_BY_KEY.get(column.key) as StockExportColumn);
}

/**
 * Filter columns by requested keys preserving the defined order.
 */
export function stockExportColumns(requested: readonly string[] = []): StockExportColumn[] {
  const wanted = new Set(requested.filter(isStockExportKey));
  if (wanted.size === 0) return allStockExportColumns();
  return allStockExportColumns().filter((column) => wanted.has(column.key));
}

export interface RepairOrder {
  id: string;
  customerId: string;
  customerName: string;
  mobile: string;

  deviceType: string;
  brand: string;
  model: string;
  complaint: string;

  imei: string;
  deviceCondition: string;
  accessories: string;
  expectedDelivery: string;
  technician: string;
  notes: string;
  /** Drive file ids / urls of repair photos. */
  photos: string[];

  status: OrderStatus;
  receivedAt: string;
  deliveredAt: string;
  deliveredTo: string;

  estimatedAmount: number;
  finalAmount: number;
  discount: number;
  /** Sum of all recorded payments. Never edited directly. */
  paidAmount: number;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;

  billDriveFileId: string;
  billDriveLink: string;
  billPrintedAt: string;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** True when a local change could not be written to Google Sheets yet. */
  pendingSync: boolean;
}

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  mode: PaymentMode;
  status: PaymentStatus;
  note: string;
  date: string;
  user: string;
  /** Client generated key. Blocks duplicate submissions / double taps. */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Part {
  id: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  quantity: number;
  minQuantity: number;
  purchaseCost: number;
  sellingPrice: number;
  supplierId: string;
  supplierName: string;
  consumeMode: ConsumeMode;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A part reserved on a repair order. Stock is NOT touched until it is consumed. */
export interface OrderPart {
  id: string;
  orderId: string;
  partId: string;
  partName: string;
  quantity: number;
  unitPrice: number;
  /** Stock has already been taken out for this line. */
  consumed: boolean;
  consumedAt: string;
  consumeMode: ConsumeMode;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  partId: string;
  partName: string;
  orderId: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  /** Stock level of the item right after this movement. Makes history auditable. */
  balanceAfter: number;
  date: string;
  user: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  mobile: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatusHistory {
  id: string;
  orderId: string;
  fromStatus: string;
  toStatus: OrderStatus;
  at: string;
  user: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Derived helpers (pure, shared by client + server)                   */
/* ------------------------------------------------------------------ */

export function payableAmount(order: Pick<RepairOrder, 'finalAmount' | 'discount'>): number {
  return Math.max(0, round2(order.finalAmount) - round2(order.discount));
}

export function balanceAmount(
  order: Pick<RepairOrder, 'finalAmount' | 'discount' | 'paidAmount'>,
): number {
  return Math.max(0, round2(payableAmount(order) - order.paidAmount));
}

/**
 * A bill can be opened before anyone knows what the repair will cost, so a zero
 * total is a real state and not a mistake. It is reported as Unpaid, not Paid:
 * nothing has been charged and nothing has been received, and calling it Paid
 * would let a device be handed over for a repair nobody has quoted yet. Once a
 * real figure is on the bill the usual rules apply again.
 */
export function derivePaymentStatus(
  order: Pick<RepairOrder, 'finalAmount' | 'discount' | 'paidAmount'>,
): PaymentStatus {
  const payable = payableAmount(order);
  if (payable <= 0) {
    return round2(order.paidAmount) > 0 ? 'Paid' : 'Unpaid';
  }
  const paid = round2(order.paidAmount);
  if (paid <= 0) return 'Unpaid';
  if (paid + 0.009 >= payable) return 'Paid';
  return 'Partially Paid';
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_ORDER_STATUSES.includes(status);
}

export function isOnHold(status: OrderStatus): boolean {
  return ON_HOLD_ORDER_STATUSES.includes(status);
}

export function isClosedStatus(status: OrderStatus): boolean {
  return CLOSED_ORDER_STATUSES.includes(status);
}

export function isLowStock(part: Pick<Part, 'quantity' | 'minQuantity' | 'active'>): boolean {
  return part.active && (part.quantity < 2 || part.quantity <= (part.minQuantity ?? 0));
}

/* ------------------------------------------------------------------ */
/* API payloads                                                        */
/* ------------------------------------------------------------------ */

export interface OrderWithParts extends RepairOrder {
  parts: OrderPart[];
  payments: Payment[];
  history: StatusHistory[];
  balance: number;
  payable: number;
  customer?: Customer;
}

/** Minimal order shape used in dashboard and search results. */
export interface OrderSummary extends RepairOrder {
  balance: number;
  payable: number;
  partsPending: number;
}

/**
 * The dashboard answers six questions and nothing else.
 * No charts, no trends, no analytics.
 */
export interface DashboardData {
  /** Devices received today. */
  todayRepairs: number;
  /** Devices physically on the bench being worked on. */
  onBench: number;
  /** Devices finished and waiting for the customer. */
  readyForPickup: number;
  /** How many repairs still have money outstanding. */
  pendingPaymentCount: number;
  /** Total money still owed to the shop. */
  pendingPaymentAmount: number;
  /** Items at or below their low stock level. */
  lowStock: number;
  /** Money actually received today. */
  todayCollected: number;
  /** Reserved parts the employee has not yet confirmed as used. */
  partsToConfirm: number;
  recentOrders: OrderSummary[];
  readyOrders: OrderSummary[];
  lowStockItems: (Part & { low: boolean })[];
}

/**
 * Where the bills live.
 *   local    - a JSON file on this computer
 *   sheets   - mirrored to a Google spreadsheet
 *   postgres - the online database, which is the real store
 */
export type SyncMode = 'local' | 'sheets' | 'postgres';

export interface SyncStatus {
  mode: SyncMode;
  connected: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  driveConnected: boolean;
  lastPushAt: string;
  lastPullAt: string;
  pendingCount: number;
  message: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  message: string;
  details: string[];
}

/* ------------------------- google connection --------------------------- */

/** ok = done, todo = not done yet, problem = done wrong and needs fixing. */
export type GoogleCheckState = 'ok' | 'todo' | 'problem';

export interface GoogleCheckItem {
  id: string;
  /** Short label for the checklist row. */
  label: string;
  state: GoogleCheckState;
  /** What is true right now, in plain words. */
  detail: string;
  /** The single next action, only when something needs doing. */
  fix: string;
}

export interface GoogleCheckReport {
  /** The service account address the owner has to share files with. */
  serviceAccountEmail: string;
  /** Key file currently in use, shown so it is obvious which one is loaded. */
  credentialsFile: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  driveFolderId: string;
  driveFolderName: string;
  items: GoogleCheckItem[];
  /** True when the shop data can be written to Google Sheets. */
  sheetsReady: boolean;
  /** True when bill PDFs / photos can be uploaded to Drive. */
  driveReady: boolean;
  summary: string;
}

export interface GoogleConnectResult {
  status: SyncStatus;
  report: GoogleCheckReport;
  shared: number;
  message: string;
}

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
}

export interface ApiWarning {
  code: string;
  message: string;
}

export interface ApiSuccess<T> {
  data: T;
  warning?: ApiWarning;
}

export interface OrderNumberPreview {
  orderId: string;
}
