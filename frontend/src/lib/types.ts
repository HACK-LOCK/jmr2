import type {
  Customer,
  OrderPart,
  OrderStatus,
  Part,
  Payment,
  RepairOrder,
  ShopSettings,
  StockMovement,
  Supplier,
  StatusHistory,
} from '@shared/domain';

/** Extra fields the API decorates onto list rows. */
export interface OrderListItem extends RepairOrder {
  balance: number;
  payable: number;
  partCount: number;
  partsPending: number;
}

export interface PartListItem extends Part {
  low: boolean;
  stockValue: number;
  usedInOpenOrders: number;
}

export interface PartDetail extends PartListItem {
  movements: StockMovement[];
  openOrderLines: { orderId: string; quantity: number }[];
}

export interface CustomerListItem extends Customer {
  orderCount: number;
  lastOrderAt: string;
  totalBilled: number;
  balanceDue: number;
}

export interface OrderDetail extends RepairOrder {
  parts: OrderPart[];
  payments: Payment[];
  history: StatusHistory[];
  balance: number;
  payable: number;
  partCount: number;
  partsPending: number;
  customer?: Customer;
}

export interface StockSummary {
  items: number;
  units: number;
  value: number;
  low: number;
}

export interface ReportBucket {
  count: number;
  amount: number;
}

/** From Date / To Date totals shown on the All Bills screen. */
export interface OrderDateReport {
  from: string;
  to: string;
  received: ReportBucket;
  delivered: ReportBucket;
  pending: ReportBucket;
  collected: number;
}

export interface SearchHit {
  kind: 'order' | 'part' | 'customer';
  id: string;
  title: string;
  subtitle: string;
  status: string;
  amount: number;
  balance: number;
  billLink: string;
}

/** One bill as the Bill History screen and its spreadsheet show it. */
export interface BillHistoryRow {
  id: string;
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
  total: number;
  advance: number;
  balance: number;
  expectedDelivery: string;
  deliveredDate: string;
  technician: string;
  imei: string;
}

/** A checked date range plus its bills and the three totals above them. */
export interface BillHistory {
  from: string;
  to: string;
  count: number;
  total: number;
  advance: number;
  balance: number;
  bills: BillHistoryRow[];
}

/** One person, as the Customer History screen and its spreadsheet show them. */
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

export interface SupplierListItem extends Supplier {
  itemCount: number;
  stockValue: number;
}

export interface DatasetLabels {
  key: string;
  label: string;
  tab: string;
  rows: number;
}

/** Brands and models this shop has repaired, offered on the new bill screen. */
export interface DeviceHints {
  brands: string[];
  models: { label: string; brand: string }[];
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
  id: string; // Stock Added ID e.g. "STK-ADD-0001"
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

export type { OrderStatus, ShopSettings, Part, RepairOrder, Payment, StockMovement };
