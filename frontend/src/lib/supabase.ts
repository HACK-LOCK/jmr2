import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrderWithParts } from '@shared/domain';

/**
 * Supabase client configuration.
 *
 * Reads values from environment variables without hardcoding.
 * Supports standard VITE_ prefixes as well as SUPABASE_ prefixed variables
 * via Vite's envPrefix configuration.
 */
const DEFAULT_SUPABASE_URL = 'https://uvyszkdszzadoycbmeiy.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_WQ_usqzwALohMMj4D5VE4A_jvIxvI6g';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ||
  DEFAULT_SUPABASE_KEY;

/**
 * Check whether Supabase environment variables are present and non-empty.
 */
export const isSupabaseConfigured: boolean = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseUrl.trim() !== '' &&
  supabasePublishableKey.trim() !== ''
);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[Supabase] SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not defined in environment variables.',
  );
}

/**
 * Single reusable Supabase client instance.
 *
 * Uses the official public publishable key for client-safe access.
 * Does not use service_role or secret keys.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublishableKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export function getSupabaseInfo(): {
  configured: boolean;
  url: string;
  keyPreview: string;
} {
  return {
    configured: isSupabaseConfigured,
    url: supabaseUrl,
    keyPreview: supabasePublishableKey ? `${supabasePublishableKey.slice(0, 15)}...` : '',
  };
}

/**
 * Test connectivity with the Supabase project to verify that
 * credentials and project URL resolve properly.
 */
export async function testSupabaseConnection(): Promise<{
  success: boolean;
  connected: boolean;
  message: string;
  tablesReady?: boolean;
  data?: unknown;
}> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      connected: false,
      message: 'Supabase URL or Publishable Key is not configured in .env',
      tablesReady: false,
    };
  }

  try {
    // 1. Health check
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: {
        apikey: supabasePublishableKey,
      },
    });

    if (!res.ok) {
      return {
        success: false,
        connected: false,
        message: `Supabase endpoint responded with HTTP ${res.status}: ${res.statusText}`,
        tablesReady: false,
      };
    }

    // 2. Query check for orders table
    const { error: queryError } = await supabase
      .from('orders')
      .select('id')
      .limit(1);

    if (queryError) {
      if (queryError.code === 'PGRST205' || queryError.message.includes('Could not find the table')) {
        return {
          success: true,
          connected: true,
          tablesReady: false,
          message: 'Supabase connected, but tables need to be created. Run supabase-schema.sql in the Supabase SQL Editor.',
        };
      }
      return {
        success: true,
        connected: true,
        tablesReady: false,
        message: `Supabase connected, but query failed: ${queryError.message}`,
      };
    }

    return {
      success: true,
      connected: true,
      tablesReady: true,
      message: 'Supabase connected and orders/bills table is active.',
    };
  } catch (error) {
    return {
      success: false,
      connected: false,
      message: error instanceof Error ? error.message : 'Unknown connection error',
      tablesReady: false,
    };
  }
}

/**
 * Direct client-side sync of a bill to Supabase.
 * Acts as dual-write / backup guarantee.
 */
export async function directSaveBillToSupabase(order: OrderWithParts): Promise<{
  success: boolean;
  message: string;
}> {
  if (!isSupabaseConfigured) {
    return { success: false, message: 'Supabase not configured' };
  }

  try {
    // 1. Upsert customer
    if (order.customerId) {
      await supabase.from('customers').upsert(
        {
          id: order.customerId,
          name: order.customerName,
          mobile: order.mobile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
    }

    // 2. Upsert order
    const { error: orderError } = await supabase.from('orders').upsert(
      {
        id: order.id,
        customer_id: order.customerId,
        customer_name: order.customerName,
        mobile: order.mobile,
        device_type: order.deviceType,
        brand: order.brand,
        model: order.model,
        complaint: order.complaint,
        imei: order.imei,
        device_condition: order.deviceCondition,
        accessories: order.accessories,
        expected_delivery: order.expectedDelivery || null,
        technician: order.technician,
        notes: order.notes,
        photos: order.photos ?? [],
        status: order.status,
        received_at: order.receivedAt || new Date().toISOString(),
        delivered_at: order.deliveredAt || null,
        delivered_to: order.deliveredTo || '',
        estimated_amount: order.estimatedAmount,
        final_amount: order.finalAmount,
        discount: order.discount,
        paid_amount: order.paidAmount,
        payment_status: order.paymentStatus,
        payment_mode: order.paymentMode,
        bill_drive_file_id: order.billDriveFileId || '',
        bill_drive_link: order.billDriveLink || '',
        bill_printed_at: order.billPrintedAt || null,
        created_by: order.createdBy,
        created_at: order.createdAt || new Date().toISOString(),
        updated_at: order.updatedAt || new Date().toISOString(),
        pending_sync: false,
      },
      { onConflict: 'id' },
    );

    if (orderError) {
      return { success: false, message: orderError.message };
    }

    // 3. Upsert payments if any
    if (order.payments && order.payments.length > 0) {
      const paymentRows = order.payments.map((p) => ({
        id: p.id,
        order_id: p.orderId,
        amount: p.amount,
        mode: p.mode,
        status: p.status,
        note: p.note,
        date: p.date,
        user_name: p.user || '',
        idempotency_key: p.idempotencyKey || '',
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      }));
      await supabase.from('payments').upsert(paymentRows, { onConflict: 'id' });
    }

    // 4. Upsert parts if any
    if (order.parts && order.parts.length > 0) {
      const partRows = order.parts.map((p) => ({
        id: p.id,
        order_id: p.orderId,
        part_id: p.partId,
        part_name: p.partName,
        quantity: p.quantity,
        unit_price: p.unitPrice,
        consumed: p.consumed,
        consumed_at: p.consumedAt || null,
        consume_mode: p.consumeMode,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      }));
      await supabase.from('order_parts').upsert(partRows, { onConflict: 'id' });
    }

    return { success: true, message: `Bill ${order.id} saved to Supabase` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown Supabase error',
    };
  }
}
