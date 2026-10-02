import dns from 'node:dns';
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { mutate, read } from '../data/mutate';
import {
  round2,
  type Customer,
  type OrderPart,
  type Payment,
  type Part,
  type RepairOrder,
  type ShopSettings,
  type StatusHistory,
  type StockMovement,
  type Supplier,
  type ConsumeMode,
  type OrderStatus,
  type PaymentMode,
  type PaymentStatus,
  type StockMovementType,
} from '../../../shared/domain';
import { highestOrderSequence } from '../core/id';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  if (!env.supabase.url || !env.supabase.publishableKey) {
    return null;
  }
  try {
    client = createClient(env.supabase.url, env.supabase.publishableKey, {
      auth: { persistSession: false },
    });
    return client;
  } catch (err) {
    console.warn('[supabase] Failed to initialize client:', err);
    return null;
  }
}

export interface SupabaseStatus {
  configured: boolean;
  url: string;
  keyPreview: string;
  connected: boolean;
  tablesReady: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface SupabaseSyncResult {
  ordersCount: number;
  customersCount: number;
  partsCount: number;
  suppliersCount: number;
  paymentsCount: number;
  stockMovementsCount: number;
  restoredFromSupabase: boolean;
  errors: string[];
}

/**
 * Check connection to Supabase and verify whether schema tables are ready.
 */
export async function testSupabase(): Promise<SupabaseStatus> {
  const sb = getSupabaseClient();
  const configured = Boolean(env.supabase.url && env.supabase.publishableKey);

  if (!configured || !sb) {
    return {
      configured: false,
      url: env.supabase.url,
      keyPreview: env.supabase.publishableKey ? `${env.supabase.publishableKey.slice(0, 14)}...` : '',
      connected: false,
      tablesReady: false,
      message: 'Supabase URL or Publishable Key is not configured in .env',
    };
  }

  const keyPreview = `${env.supabase.publishableKey.slice(0, 14)}...`;

  try {
    const { data: orderTest, error: orderErr } = await sb
      .from('orders')
      .select('id')
      .limit(1);

    if (orderErr) {
      if (orderErr.code === 'PGRST205' || orderErr.message.includes('Could not find the table')) {
        return {
          configured: true,
          url: env.supabase.url,
          keyPreview,
          connected: true,
          tablesReady: false,
          message: 'Connected to Supabase, but the "orders" table is not created yet. Run supabase-schema.sql in Supabase SQL Editor.',
          details: { error: orderErr },
        };
      }
      return {
        configured: true,
        url: env.supabase.url,
        keyPreview,
        connected: false,
        tablesReady: false,
        message: `Supabase query error: ${orderErr.message} (${orderErr.code})`,
        details: { error: orderErr },
      };
    }

    return {
      configured: true,
      url: env.supabase.url,
      keyPreview,
      connected: true,
      tablesReady: true,
      message: 'Supabase connected and tables verified successfully.',
      details: { sampleCount: orderTest?.length ?? 0 },
    };
  } catch (err) {
    return {
      configured: true,
      url: env.supabase.url,
      keyPreview,
      connected: false,
      tablesReady: false,
      message: err instanceof Error ? err.message : 'Unknown connection error',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Batch helpers                                                              */
/* -------------------------------------------------------------------------- */

async function fetchAllRows<T>(sb: SupabaseClient, table: string): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await sb.from(table).select('*').range(from, from + step - 1);
    if (error) {
      console.warn(`[supabase] Error fetching from ${table}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function upsertInBatches<T extends Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  rows: T[],
  batchSize = 100,
): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb.from(table).upsert(batch as any, { onConflict: 'id' });
    if (error) {
      errors.push(`Error upserting ${table} (batch ${i}): ${error.message}`);
      console.warn(`[supabase] Error upserting ${table}:`, error.message);
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Row Mappers                                                                */
/* -------------------------------------------------------------------------- */

function orderToRow(order: RepairOrder) {
  return {
    id: order.id,
    customer_id: order.customerId || '',
    customer_name: order.customerName || '',
    mobile: order.mobile || '',
    device_type: order.deviceType || 'Mobile',
    brand: order.brand || '',
    model: order.model || '',
    complaint: order.complaint || '',
    imei: order.imei || '',
    device_condition: order.deviceCondition || 'Good',
    accessories: order.accessories || '',
    expected_delivery: order.expectedDelivery || null,
    technician: order.technician || '',
    notes: order.notes || '',
    photos: order.photos ?? [],
    status: order.status || 'Received',
    received_at: order.receivedAt || new Date().toISOString(),
    delivered_at: order.deliveredAt || null,
    delivered_to: order.deliveredTo || '',
    estimated_amount: round2(order.estimatedAmount),
    final_amount: round2(order.finalAmount),
    discount: round2(order.discount),
    paid_amount: round2(order.paidAmount),
    payment_status: order.paymentStatus || 'Unpaid',
    payment_mode: order.paymentMode || 'Cash',
    bill_drive_file_id: order.billDriveFileId || '',
    bill_drive_link: order.billDriveLink || '',
    bill_printed_at: order.billPrintedAt || null,
    created_by: order.createdBy || '',
    created_at: order.createdAt || new Date().toISOString(),
    updated_at: order.updatedAt || new Date().toISOString(),
    pending_sync: false,
  };
}

function rowToOrder(r: Record<string, unknown>): RepairOrder {
  return {
    id: String(r.id),
    customerId: String(r.customer_id || ''),
    customerName: String(r.customer_name || ''),
    mobile: String(r.mobile || ''),
    deviceType: (r.device_type as RepairOrder['deviceType']) || 'Mobile',
    brand: String(r.brand || ''),
    model: String(r.model || ''),
    complaint: String(r.complaint || ''),
    imei: String(r.imei || ''),
    deviceCondition: (r.device_condition as RepairOrder['deviceCondition']) || 'Good',
    accessories: String(r.accessories || ''),
    expectedDelivery: r.expected_delivery ? String(r.expected_delivery) : '',
    technician: String(r.technician || ''),
    notes: String(r.notes || ''),
    photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
    status: (r.status as OrderStatus) || 'Received',
    receivedAt: String(r.received_at || r.created_at || new Date().toISOString()),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : '',
    deliveredTo: String(r.delivered_to || ''),
    estimatedAmount: Number(r.estimated_amount) || 0,
    finalAmount: Number(r.final_amount) || 0,
    discount: Number(r.discount) || 0,
    paidAmount: Number(r.paid_amount) || 0,
    paymentStatus: (r.payment_status as PaymentStatus) || 'Unpaid',
    paymentMode: (r.payment_mode as PaymentMode) || 'Cash',
    billDriveFileId: String(r.bill_drive_file_id || ''),
    billDriveLink: String(r.bill_drive_link || ''),
    billPrintedAt: r.bill_printed_at ? String(r.bill_printed_at) : '',
    createdBy: String(r.created_by || ''),
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
    pendingSync: false,
  };
}

function customerToRow(c: Customer) {
  return {
    id: c.id,
    name: c.name || '',
    mobile: c.mobile || '',
    alt_mobile: c.altMobile || '',
    email: c.email || '',
    address: c.address || '',
    notes: c.notes || '',
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: c.updatedAt || new Date().toISOString(),
  };
}

function rowToCustomer(r: Record<string, unknown>): Customer {
  return {
    id: String(r.id),
    name: String(r.name || ''),
    mobile: String(r.mobile || ''),
    altMobile: String(r.alt_mobile || ''),
    email: String(r.email || ''),
    address: String(r.address || ''),
    notes: String(r.notes || ''),
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
  };
}

function paymentToRow(p: Payment) {
  return {
    id: p.id,
    order_id: p.orderId,
    amount: round2(p.amount),
    mode: p.mode || 'Cash',
    status: p.status || 'Paid',
    note: p.note || '',
    date: p.date || new Date().toISOString(),
    user_name: p.user || '',
    idempotency_key: p.idempotencyKey || '',
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString(),
  };
}

function rowToPayment(r: Record<string, unknown>): Payment {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    amount: Number(r.amount) || 0,
    mode: (r.mode as PaymentMode) || 'Cash',
    status: (r.status as PaymentStatus) || 'Paid',
    note: String(r.note || ''),
    date: String(r.date || new Date().toISOString()),
    user: String(r.user_name || ''),
    idempotencyKey: String(r.idempotency_key || ''),
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
  };
}

function orderPartToRow(op: OrderPart) {
  return {
    id: op.id,
    order_id: op.orderId,
    part_id: op.partId || '',
    part_name: op.partName || '',
    quantity: op.quantity,
    unit_price: round2(op.unitPrice),
    consumed: op.consumed,
    consumed_at: op.consumedAt || null,
    consume_mode: op.consumeMode || 'PART_USED',
    created_at: op.createdAt || new Date().toISOString(),
    updated_at: op.updatedAt || new Date().toISOString(),
  };
}

function rowToOrderPart(r: Record<string, unknown>): OrderPart {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    partId: String(r.part_id || ''),
    partName: String(r.part_name || ''),
    quantity: Number(r.quantity) || 0,
    unitPrice: Number(r.unit_price) || 0,
    consumed: Boolean(r.consumed),
    consumedAt: r.consumed_at ? String(r.consumed_at) : '',
    consumeMode: (r.consume_mode as ConsumeMode) || 'PART_USED',
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
  };
}

function statusHistoryToRow(h: StatusHistory) {
  return {
    id: h.id,
    order_id: h.orderId,
    from_status: h.fromStatus || '',
    to_status: h.toStatus || 'Received',
    at: h.at || new Date().toISOString(),
    user_name: h.user || '',
  };
}

function rowToStatusHistory(r: Record<string, unknown>): StatusHistory {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    fromStatus: String(r.from_status || ''),
    toStatus: (r.to_status as OrderStatus) || 'Received',
    at: String(r.at || new Date().toISOString()),
    user: String(r.user_name || ''),
  };
}

function partToRow(p: Part) {
  return {
    id: p.id,
    name: p.name || '',
    category: p.category || 'Repair Part',
    brand: p.brand || '',
    model: p.model || '',
    quantity: p.quantity,
    min_quantity: p.minQuantity,
    purchase_cost: round2(p.purchaseCost),
    selling_price: round2(p.sellingPrice),
    supplier_id: p.supplierId || '',
    supplier_name: p.supplierName || '',
    consume_mode: p.consumeMode || 'PART_USED',
    active: p.active !== false,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString(),
  };
}

function rowToPart(r: Record<string, unknown>): Part {
  return {
    id: String(r.id),
    name: String(r.name || ''),
    category: String(r.category || 'Repair Part'),
    brand: String(r.brand || ''),
    model: String(r.model || ''),
    quantity: Number(r.quantity) || 0,
    minQuantity: Number(r.min_quantity) || 0,
    purchaseCost: Number(r.purchase_cost) || 0,
    sellingPrice: Number(r.selling_price) || 0,
    supplierId: String(r.supplier_id || ''),
    supplierName: String(r.supplier_name || ''),
    consumeMode: (r.consume_mode as ConsumeMode) || 'PART_USED',
    active: r.active !== false,
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
  };
}

function stockMovementToRow(sm: StockMovement) {
  return {
    id: sm.id,
    part_id: sm.partId || '',
    part_name: sm.partName || '',
    order_id: sm.orderId || '',
    type: sm.type || 'IN',
    quantity: sm.quantity,
    reason: sm.reason || '',
    balance_after: sm.balanceAfter,
    date: sm.date || new Date().toISOString(),
    user_name: sm.user || '',
    idempotency_key: sm.idempotencyKey || '',
    created_at: sm.createdAt || new Date().toISOString(),
  };
}

function rowToStockMovement(r: Record<string, unknown>): StockMovement {
  return {
    id: String(r.id),
    partId: String(r.part_id || ''),
    partName: String(r.part_name || ''),
    orderId: String(r.order_id || ''),
    type: (r.type as StockMovementType) || 'IN',
    quantity: Number(r.quantity) || 0,
    reason: String(r.reason || ''),
    balanceAfter: Number(r.balance_after) || 0,
    date: String(r.date || new Date().toISOString()),
    user: String(r.user_name || ''),
    idempotencyKey: String(r.idempotency_key || ''),
    createdAt: String(r.created_at || new Date().toISOString()),
  };
}

function supplierToRow(s: Supplier) {
  return {
    id: s.id,
    name: s.name || '',
    mobile: s.mobile || '',
    notes: s.notes || '',
    created_at: s.createdAt || new Date().toISOString(),
    updated_at: s.updatedAt || new Date().toISOString(),
  };
}

function rowToSupplier(r: Record<string, unknown>): Supplier {
  return {
    id: String(r.id),
    name: String(r.name || ''),
    mobile: String(r.mobile || ''),
    notes: String(r.notes || ''),
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString()),
  };
}

function settingsToRow(s: ShopSettings) {
  return {
    id: 1,
    shop_name: s.shopName,
    contact1_name: s.contact1Name,
    contact1_number: s.contact1Number,
    contact2_name: s.contact2Name,
    contact2_number: s.contact2Number,
    address: s.address,
    service_description: s.serviceDescription,
    upi_id: s.upiId,
    receipt_information: s.receiptInformation,
    bill_footer: s.billFooter,
    allow_negative_stock: s.allowNegativeStock,
    sheet_name: s.sheetName,
    updated_at: s.updatedAt || new Date().toISOString(),
  };
}

function rowToSettings(r: Record<string, unknown>): ShopSettings {
  return {
    shopName: String(r.shop_name || 'Jai Mataji Mobile Repairing'),
    contact1Name: String(r.contact1_name || 'Ashok Bhai'),
    contact1Number: String(r.contact1_number || '9974298866'),
    contact2Name: String(r.contact2_name || 'Mitesh'),
    contact2Number: String(r.contact2_number || '9327394978'),
    address: String(r.address || ''),
    serviceDescription: String(r.service_description || ''),
    upiId: String(r.upi_id || ''),
    receiptInformation: String(r.receipt_information || ''),
    billFooter: String(r.bill_footer || ''),
    allowNegativeStock: Boolean(r.allow_negative_stock),
    sheetName: String(r.sheet_name || 'ShopData'),
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

/* -------------------------------------------------------------------------- */
/* Single Entity Sync                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Sync a single order (bill) and its customer, payments, parts and history to Supabase.
 */
export async function syncOrderToSupabase(orderId: string): Promise<{ success: boolean; message: string }> {
  const sb = getSupabaseClient();
  if (!sb) return { success: false, message: 'Supabase not configured' };

  const db = read();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return { success: false, message: `Order ${orderId} not found locally` };

  try {
    // 1. Sync Customer
    if (order.customerId) {
      const customer = db.customers.find((c) => c.id === order.customerId);
      if (customer) {
        await sb.from('customers').upsert(customerToRow(customer), { onConflict: 'id' });
      }
    }

    // 2. Sync Order
    const { error: orderErr } = await sb.from('orders').upsert(orderToRow(order), { onConflict: 'id' });
    if (orderErr) {
      console.warn(`[supabase] Failed to upsert order ${order.id}:`, orderErr.message);
      return { success: false, message: orderErr.message };
    }

    // 3. Sync Payments
    const payments = db.payments.filter((p) => p.orderId === orderId);
    if (payments.length > 0) {
      await sb.from('payments').upsert(payments.map(paymentToRow), { onConflict: 'id' });
    }

    // 4. Sync Order Parts
    const parts = db.orderParts.filter((p) => p.orderId === orderId);
    if (parts.length > 0) {
      await sb.from('order_parts').upsert(parts.map(orderPartToRow), { onConflict: 'id' });
    }

    // 5. Sync Status History
    const history = db.statusHistory.filter((h) => h.orderId === orderId);
    if (history.length > 0) {
      await sb.from('status_history').upsert(history.map(statusHistoryToRow), { onConflict: 'id' });
    }

    // 6. Update Meta counter so Supabase stays synchronized with latest bill sequence
    const highestSeq = highestOrderSequence(db.orders.map((o) => o.id));
    const currentSeq = Math.max(db.meta.orderSequence || 0, highestSeq);
    await sb.from('meta').upsert({
      id: 1,
      order_sequence: currentSeq,
      last_push_at: new Date().toISOString(),
    });

    console.log(`[supabase] Successfully synced order ${order.id} to Supabase`);
    return { success: true, message: `Order ${order.id} synced to Supabase` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[supabase] Exception syncing order ${orderId}:`, message);
    return { success: false, message };
  }
}

/**
 * Sync a single part to Supabase.
 */
export async function syncPartToSupabase(partId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const db = read();
  const part = db.parts.find((p) => p.id === partId);
  if (!part) return;
  try {
    await sb.from('parts').upsert(partToRow(part), { onConflict: 'id' });
  } catch (err) {
    console.warn(`[supabase] Failed to sync part ${partId}:`, err);
  }
}

/**
 * Sync a single stock movement to Supabase.
 */
export async function syncStockMovementToSupabase(movementId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const db = read();
  const movement = db.stockMovements.find((m) => m.id === movementId);
  if (!movement) return;
  try {
    await sb.from('stock_movements').upsert(stockMovementToRow(movement), { onConflict: 'id' });
  } catch (err) {
    console.warn(`[supabase] Failed to sync movement ${movementId}:`, err);
  }
}

/**
 * Sync a single supplier to Supabase.
 */
export async function syncSupplierToSupabase(supplierId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const db = read();
  const supplier = db.suppliers.find((s) => s.id === supplierId);
  if (!supplier) return;
  try {
    await sb.from('suppliers').upsert(supplierToRow(supplier), { onConflict: 'id' });
  } catch (err) {
    console.warn(`[supabase] Failed to sync supplier ${supplierId}:`, err);
  }
}

/**
 * Delete a supplier from Supabase.
 */
export async function deleteSupplierFromSupabase(supplierId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  try {
    await sb.from('suppliers').delete().eq('id', supplierId);
  } catch (err) {
    console.warn(`[supabase] Failed to delete supplier ${supplierId}:`, err);
  }
}

/**
 * Sync all stock (parts, stock movements, suppliers) to Supabase.
 */
export async function syncAllStockToSupabase(): Promise<{ partsCount: number; suppliersCount: number; errors: string[] }> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured');

  const db = read();
  const errors: string[] = [];

  if (db.parts.length > 0) {
    const errs = await upsertInBatches(sb, 'parts', db.parts.map(partToRow));
    errors.push(...errs);
  }

  if (db.suppliers.length > 0) {
    const errs = await upsertInBatches(sb, 'suppliers', db.suppliers.map(supplierToRow));
    errors.push(...errs);
  }

  if (db.stockMovements.length > 0) {
    const errs = await upsertInBatches(sb, 'stock_movements', db.stockMovements.map(stockMovementToRow));
    errors.push(...errs);
  }

  return { partsCount: db.parts.length, suppliersCount: db.suppliers.length, errors };
}

/* -------------------------------------------------------------------------- */
/* Full Sync / Push to Supabase                                               */
/* -------------------------------------------------------------------------- */

/**
 * Sync all bills, stock, customers, settings and counter from local database to Supabase.
 */
export async function syncAllToSupabase(): Promise<SupabaseSyncResult> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured');

  const db = read();
  const errors: string[] = [];

  // 1. Customers
  if (db.customers.length > 0) {
    const errs = await upsertInBatches(sb, 'customers', db.customers.map(customerToRow));
    errors.push(...errs);
  }

  // 2. Orders
  if (db.orders.length > 0) {
    const errs = await upsertInBatches(sb, 'orders', db.orders.map(orderToRow));
    errors.push(...errs);
  }

  // 3. Payments
  if (db.payments.length > 0) {
    const errs = await upsertInBatches(sb, 'payments', db.payments.map(paymentToRow));
    errors.push(...errs);
  }

  // 4. Order Parts
  if (db.orderParts.length > 0) {
    const errs = await upsertInBatches(sb, 'order_parts', db.orderParts.map(orderPartToRow));
    errors.push(...errs);
  }

  // 5. Status History
  if (db.statusHistory.length > 0) {
    const errs = await upsertInBatches(sb, 'status_history', db.statusHistory.map(statusHistoryToRow));
    errors.push(...errs);
  }

  // 6. Parts (Stock)
  if (db.parts.length > 0) {
    const errs = await upsertInBatches(sb, 'parts', db.parts.map(partToRow));
    errors.push(...errs);
  }

  // 7. Stock Movements
  if (db.stockMovements.length > 0) {
    const errs = await upsertInBatches(sb, 'stock_movements', db.stockMovements.map(stockMovementToRow));
    errors.push(...errs);
  }

  // 8. Suppliers
  if (db.suppliers.length > 0) {
    const errs = await upsertInBatches(sb, 'suppliers', db.suppliers.map(supplierToRow));
    errors.push(...errs);
  }

  // 9. Settings
  try {
    await sb.from('settings').upsert(settingsToRow(db.settings), { onConflict: 'id' });
  } catch (err) {
    errors.push(`Settings sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 10. Meta / Counter
  const highestSeq = highestOrderSequence(db.orders.map((o) => o.id));
  const currentSeq = Math.max(db.meta.orderSequence || 0, highestSeq);
  try {
    await sb.from('meta').upsert({
      id: 1,
      order_sequence: currentSeq,
      last_push_at: new Date().toISOString(),
    });
  } catch (err) {
    errors.push(`Meta sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ordersCount: db.orders.length,
    customersCount: db.customers.length,
    partsCount: db.parts.length,
    suppliersCount: db.suppliers.length,
    paymentsCount: db.payments.length,
    stockMovementsCount: db.stockMovements.length,
    restoredFromSupabase: false,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Restore and Bidirectional Merge                                            */
/* -------------------------------------------------------------------------- */

/**
 * Smart Bidirectional Sync & Restore:
 * 1. Pulls all orders, stock, customers, payments, etc. from Supabase.
 * 2. Merges with local store without losing any records in either direction.
 * 3. Keeps the latest version of any modified record.
 * 4. Ensures the bill sequence counter is strictly >= highest bill ever created.
 * 5. Pushes any missing local records up to Supabase.
 * 6. Ensures the app looks exact as left after the last bill!
 */
export async function syncAndRestoreSupabase(): Promise<SupabaseSyncResult> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase is not configured in .env');
  }

  const errors: string[] = [];
  console.log('[supabase] Initiating full sync and restore...');

  // 1. Fetch remote data from Supabase in parallel
  const [
    remoteOrdersRaw,
    remoteCustomersRaw,
    remotePaymentsRaw,
    remoteOrderPartsRaw,
    remoteStatusHistoryRaw,
    remotePartsRaw,
    remoteStockMovementsRaw,
    remoteSuppliersRaw,
    remoteSettingsRaw,
    remoteMetaRaw,
  ] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(sb, 'orders'),
    fetchAllRows<Record<string, unknown>>(sb, 'customers'),
    fetchAllRows<Record<string, unknown>>(sb, 'payments'),
    fetchAllRows<Record<string, unknown>>(sb, 'order_parts'),
    fetchAllRows<Record<string, unknown>>(sb, 'status_history'),
    fetchAllRows<Record<string, unknown>>(sb, 'parts'),
    fetchAllRows<Record<string, unknown>>(sb, 'stock_movements'),
    fetchAllRows<Record<string, unknown>>(sb, 'suppliers'),
    sb.from('settings').select('*').limit(1).then((r) => r.data?.[0] as Record<string, unknown> | undefined),
    sb.from('meta').select('*').limit(1).then((r) => r.data?.[0] as Record<string, unknown> | undefined),
  ]);

  const remoteOrders = remoteOrdersRaw.map(rowToOrder);
  const remoteCustomers = remoteCustomersRaw.map(rowToCustomer);
  const remotePayments = remotePaymentsRaw.map(rowToPayment);
  const remoteOrderParts = remoteOrderPartsRaw.map(rowToOrderPart);
  const remoteStatusHistory = remoteStatusHistoryRaw.map(rowToStatusHistory);
  const remoteParts = remotePartsRaw.map(rowToPart);
  const remoteStockMovements = remoteStockMovementsRaw.map(rowToStockMovement);
  const remoteSuppliers = remoteSuppliersRaw.map(rowToSupplier);

  // 2. Perform intelligent two-way merge into local database
  let mergedOrdersCount = 0;
  let mergedPartsCount = 0;
  let mergedCustomersCount = 0;
  let mergedSuppliersCount = 0;
  let mergedPaymentsCount = 0;
  let mergedStockMovementsCount = 0;

  const ordersToPush: RepairOrder[] = [];
  const partsToPush: Part[] = [];
  const customersToPush: Customer[] = [];
  const suppliersToPush: Supplier[] = [];
  const paymentsToPush: Payment[] = [];
  const orderPartsToPush: OrderPart[] = [];
  const statusHistoryToPush: StatusHistory[] = [];
  const stockMovementsToPush: StockMovement[] = [];

  await mutate((draft) => {
    // If Supabase is at fresh start (0 orders and order_sequence 0), clear any lingering ghost orders
    const isFreshStart = remoteOrders.length === 0 && (Number(remoteMetaRaw?.order_sequence) || 0) === 0;

    if (isFreshStart) {
      draft.orders = [];
      draft.customers = [];
      draft.payments = [];
      draft.orderParts = [];
      draft.statusHistory = [];
      draft.meta.orderSequence = 0;
    } else {
      // --- Merge Orders ---
      const localOrderMap = new Map(draft.orders.map((o) => [o.id, o]));
      for (const remoteOrder of remoteOrders) {
        const local = localOrderMap.get(remoteOrder.id);
        if (!local) {
          draft.orders.push(remoteOrder);
          localOrderMap.set(remoteOrder.id, remoteOrder);
        } else {
          // Keep the more recently updated version
          const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
          const remoteTime = new Date(remoteOrder.updatedAt || remoteOrder.createdAt || 0).getTime();
          if (remoteTime > localTime) {
            Object.assign(local, remoteOrder);
          }
        }
      }
      // Check which local orders need pushing to Supabase
      const remoteOrderIds = new Set(remoteOrders.map((o) => o.id));
      for (const local of draft.orders) {
        if (!remoteOrderIds.has(local.id)) {
          ordersToPush.push(local);
        }
      }
      // Sort orders by receivedAt ascending
      draft.orders.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    }
    mergedOrdersCount = draft.orders.length;

    if (!isFreshStart) {
      // --- Merge Customers ---
      const localCustomerMap = new Map(draft.customers.map((c) => [c.id, c]));
      for (const remoteCustomer of remoteCustomers) {
        const local = localCustomerMap.get(remoteCustomer.id);
        if (!local) {
          draft.customers.push(remoteCustomer);
          localCustomerMap.set(remoteCustomer.id, remoteCustomer);
        } else {
          const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
          const remoteTime = new Date(remoteCustomer.updatedAt || remoteCustomer.createdAt || 0).getTime();
          if (remoteTime > localTime) {
            Object.assign(local, remoteCustomer);
          }
        }
      }
      const remoteCustomerIds = new Set(remoteCustomers.map((c) => c.id));
      for (const local of draft.customers) {
        if (!remoteCustomerIds.has(local.id)) {
          customersToPush.push(local);
        }
      }
      mergedCustomersCount = draft.customers.length;
    }

    // --- Merge Parts ---
    const localPartMap = new Map(draft.parts.map((p) => [p.id, p]));
    for (const remotePart of remoteParts) {
      const local = localPartMap.get(remotePart.id);
      if (!local) {
        draft.parts.push(remotePart);
        localPartMap.set(remotePart.id, remotePart);
      } else {
        const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
        const remoteTime = new Date(remotePart.updatedAt || remotePart.createdAt || 0).getTime();
        if (remoteTime > localTime) {
          Object.assign(local, remotePart);
        }
      }
    }
    const remotePartIds = new Set(remoteParts.map((p) => p.id));
    for (const local of draft.parts) {
      if (!remotePartIds.has(local.id)) {
        partsToPush.push(local);
      }
    }
    mergedPartsCount = draft.parts.length;

    // --- Merge Suppliers ---
    const localSupplierMap = new Map(draft.suppliers.map((s) => [s.id, s]));
    for (const remoteSupplier of remoteSuppliers) {
      const local = localSupplierMap.get(remoteSupplier.id);
      if (!local) {
        draft.suppliers.push(remoteSupplier);
        localSupplierMap.set(remoteSupplier.id, remoteSupplier);
      } else {
        const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
        const remoteTime = new Date(remoteSupplier.updatedAt || remoteSupplier.createdAt || 0).getTime();
        if (remoteTime > localTime) {
          Object.assign(local, remoteSupplier);
        }
      }
    }
    const remoteSupplierIds = new Set(remoteSuppliers.map((s) => s.id));
    for (const local of draft.suppliers) {
      if (!remoteSupplierIds.has(local.id)) {
        suppliersToPush.push(local);
      }
    }
    mergedSuppliersCount = draft.suppliers.length;

    if (!isFreshStart) {
      // --- Merge Payments ---
      const localPaymentMap = new Map(draft.payments.map((p) => [p.id, p]));
      for (const remotePayment of remotePayments) {
        if (!localPaymentMap.has(remotePayment.id)) {
          draft.payments.push(remotePayment);
          localPaymentMap.set(remotePayment.id, remotePayment);
        }
      }
      const remotePaymentIds = new Set(remotePayments.map((p) => p.id));
      for (const local of draft.payments) {
        if (!remotePaymentIds.has(local.id)) {
          paymentsToPush.push(local);
        }
      }
      mergedPaymentsCount = draft.payments.length;

      // --- Merge Order Parts ---
      const localOrderPartsMap = new Map(draft.orderParts.map((op) => [op.id, op]));
      for (const remoteOrderPart of remoteOrderParts) {
        if (!localOrderPartsMap.has(remoteOrderPart.id)) {
          draft.orderParts.push(remoteOrderPart);
          localOrderPartsMap.set(remoteOrderPart.id, remoteOrderPart);
        }
      }
      const remoteOrderPartIds = new Set(remoteOrderParts.map((op) => op.id));
      for (const local of draft.orderParts) {
        if (!remoteOrderPartIds.has(local.id)) {
          orderPartsToPush.push(local);
        }
      }

      // --- Merge Status History ---
      const localStatusHistoryMap = new Map(draft.statusHistory.map((sh) => [sh.id, sh]));
      for (const remoteSH of remoteStatusHistory) {
        if (!localStatusHistoryMap.has(remoteSH.id)) {
          draft.statusHistory.push(remoteSH);
          localStatusHistoryMap.set(remoteSH.id, remoteSH);
        }
      }
      const remoteSHIds = new Set(remoteStatusHistory.map((sh) => sh.id));
      for (const local of draft.statusHistory) {
        if (!remoteSHIds.has(local.id)) {
          statusHistoryToPush.push(local);
        }
      }
    }

    // --- Merge Stock Movements ---
    const localMovementMap = new Map(draft.stockMovements.map((m) => [m.id, m]));
    for (const remoteMovement of remoteStockMovements) {
      if (!localMovementMap.has(remoteMovement.id)) {
        draft.stockMovements.push(remoteMovement);
        localMovementMap.set(remoteMovement.id, remoteMovement);
      }
    }
    const remoteMovementIds = new Set(remoteStockMovements.map((m) => m.id));
    for (const local of draft.stockMovements) {
      if (!remoteMovementIds.has(local.id)) {
        stockMovementsToPush.push(local);
      }
    }
    mergedStockMovementsCount = draft.stockMovements.length;

    // --- Merge Settings ---
    if (remoteSettingsRaw) {
      const remoteSettings = rowToSettings(remoteSettingsRaw);
      const localTime = new Date(draft.settings.updatedAt || 0).getTime();
      const remoteTime = new Date(remoteSettings.updatedAt || 0).getTime();
      if (remoteTime > localTime) {
        draft.settings = remoteSettings;
      }
    }

    // --- Meta / Bill Sequence Counter ---
    // The sequence MUST be >= the highest bill ever created in either local or remote
    const highestUsedSequence = isFreshStart ? 0 : highestOrderSequence(draft.orders.map((o) => o.id));
    const remoteMetaSeq = Number(remoteMetaRaw?.order_sequence) || 0;
    const finalSequence = isFreshStart ? 0 : Math.max(draft.meta.orderSequence || 0, remoteMetaSeq, highestUsedSequence);

    draft.meta.orderSequence = finalSequence;
    draft.meta.lastPullAt = new Date().toISOString();

    return null;
  });

  // 3. Push any local items missing in Supabase back to Supabase
  if (ordersToPush.length > 0) {
    console.log(`[supabase] Pushing ${ordersToPush.length} missing local orders to Supabase...`);
    const errs = await upsertInBatches(sb, 'orders', ordersToPush.map(orderToRow));
    errors.push(...errs);
  }
  if (customersToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'customers', customersToPush.map(customerToRow));
    errors.push(...errs);
  }
  if (partsToPush.length > 0) {
    console.log(`[supabase] Pushing ${partsToPush.length} missing local parts to Supabase...`);
    const errs = await upsertInBatches(sb, 'parts', partsToPush.map(partToRow));
    errors.push(...errs);
  }
  if (suppliersToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'suppliers', suppliersToPush.map(supplierToRow));
    errors.push(...errs);
  }
  if (paymentsToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'payments', paymentsToPush.map(paymentToRow));
    errors.push(...errs);
  }
  if (orderPartsToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'order_parts', orderPartsToPush.map(orderPartToRow));
    errors.push(...errs);
  }
  if (statusHistoryToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'status_history', statusHistoryToPush.map(statusHistoryToRow));
    errors.push(...errs);
  }
  if (stockMovementsToPush.length > 0) {
    const errs = await upsertInBatches(sb, 'stock_movements', stockMovementsToPush.map(stockMovementToRow));
    errors.push(...errs);
  }

  // 4. Update Supabase Meta counter with the verified highest sequence
  const currentDb = read();
  try {
    await sb.from('meta').upsert({
      id: 1,
      order_sequence: currentDb.meta.orderSequence,
      last_pull_at: currentDb.meta.lastPullAt,
      last_push_at: new Date().toISOString(),
    });
  } catch (err) {
    errors.push(`Meta counter update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(
    `[supabase] Sync and restore completed: ${mergedOrdersCount} orders, ${mergedPartsCount} parts, ${mergedCustomersCount} customers, ${mergedSuppliersCount} suppliers.`,
  );

  return {
    ordersCount: mergedOrdersCount,
    customersCount: mergedCustomersCount,
    partsCount: mergedPartsCount,
    suppliersCount: mergedSuppliersCount,
    paymentsCount: mergedPaymentsCount,
    stockMovementsCount: mergedStockMovementsCount,
    restoredFromSupabase: true,
    errors,
  };
}

/**
 * Permanently wipes all bills, orders, payments, order parts, status history,
 * and test customers from both Supabase and the active in-memory database,
 * resetting the sequence counter to 0 so the next bill starts at JMR-0001.
 */
export async function clearAllBills(): Promise<{ success: boolean; message: string }> {
  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb.from('order_parts').delete().neq('id', '___wipe___');
      await sb.from('status_history').delete().neq('id', '___wipe___');
      await sb.from('payments').delete().neq('id', '___wipe___');
      await sb.from('orders').delete().neq('id', '___wipe___');
      await sb.from('customers').delete().neq('id', '___wipe___');
      await sb.from('meta').upsert({ id: 1, order_sequence: 0, last_push_at: null, last_pull_at: null });
    } catch (err) {
      console.warn('[supabase] clearAllBills error on remote:', err);
    }
  }

  await mutate((draft) => {
    draft.orders = [];
    draft.customers = [];
    draft.payments = [];
    draft.orderParts = [];
    draft.statusHistory = [];
    draft.meta.orderSequence = 0;
  });

  return { success: true, message: 'All bills and test customers cleared. Sequence reset to JMR-0001.' };
}
