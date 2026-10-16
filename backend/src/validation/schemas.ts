import { z } from 'zod';
import {
  CONSUME_MODES,
  DEVICE_CONDITIONS,
  DEVICE_TYPES,
  ORDER_STATUSES,
  PAYMENT_MODES,
  PART_CATEGORIES,
} from '../../../shared/domain';
import { isValidIndianMobile, normalizeMobile } from '../core/id';

const trimmed = z.string().trim();
const optionalText = trimmed.max(2000).optional().default('');
const money = z.coerce.number().min(0).max(9_999_999).refine((n) => Number.isFinite(n), 'Invalid amount');
const qty = z.coerce.number().int().min(0).max(1_000_000);

export const mobileField = trimmed
  .min(1, 'Mobile number is required')
  .transform(normalizeMobile)
  .refine(isValidIndianMobile, 'Enter a valid 10 digit mobile number');

const orderStatusEnum = z.enum(ORDER_STATUSES);
const paymentModeEnum = z.enum(PAYMENT_MODES);
const consumeModeEnum = z.enum(CONSUME_MODES);

/* ----------------------------- customers ----------------------------- */

export const customerCreateSchema = z.object({
  name: trimmed.min(1, 'Customer name is required').max(80),
  mobile: mobileField,
  altMobile: trimmed
    .max(15)
    .optional()
    .default('')
    .transform((v) => (v ? normalizeMobile(v) : ''))
    .refine((v) => v === '' || isValidIndianMobile(v), 'Enter a valid 10 digit alternate number'),
  email: trimmed.max(120).optional().default('').refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email'),
  address: optionalText,
  notes: optionalText,
});

export const customerUpdateSchema = customerCreateSchema.partial().extend({
  id: trimmed.optional(),
});

/* ------------------------------- parts -------------------------------- */

export const partCreateSchema = z.object({
  name: trimmed.min(1, 'Item name is required').max(120),
  category: z.enum(PART_CATEGORIES).optional().default('Repair Part'),
  brand: trimmed.max(60).optional().default(''),
  model: trimmed.max(60).optional().default(''),
  quantity: qty.optional().default(0),
  minQuantity: qty.optional().default(0),
  purchaseCost: money.optional().default(0),
  sellingPrice: money.optional().default(0),
  supplierId: trimmed.optional().default(''),
  consumeMode: consumeModeEnum.optional().default('PART_USED'),
  active: z.coerce.boolean().optional().default(true),
});

export const partUpdateSchema = partCreateSchema.partial();

/* ------------------------------ orders -------------------------------- */

export const orderCreateSchema = z
  .object({
    customerName: trimmed.min(1, 'Customer name is required').max(80),
    mobile: mobileField,
    customerId: trimmed.optional().default(''),
    deviceType: z.enum(DEVICE_TYPES).optional().default('Mobile'),
    brand: trimmed.min(1, 'Brand is required').max(60),
    model: trimmed.max(60).optional().default(''),
    complaint: trimmed.min(1, 'Please write the problem').max(1000),
    imei: trimmed.max(40).optional().default(''),
    deviceCondition: z.enum(DEVICE_CONDITIONS).optional().default('Good'),
    accessories: optionalText,
    expectedDelivery: trimmed.max(30).optional().default(''),
    technician: trimmed.max(60).optional().default(''),
    notes: optionalText,
    estimatedAmount: money.optional().default(0),
    discount: money.optional().default(0),
    /** Optional opening advance. Recorded as a real payment row. */
    advance: money.optional().default(0),
    advanceMode: paymentModeEnum.optional().default('Cash'),
    parts: z
      .array(
        z.object({
          partId: trimmed.min(1),
          quantity: z.coerce.number().int().min(1).max(999),
          unitPrice: money.optional().default(0),
        }),
      )
      .max(30)
      .optional()
      .default([]),
  })
  .strict();

export const orderUpdateSchema = z
  .object({
    customerName: trimmed.min(1).max(80).optional(),
    mobile: mobileField.optional(),
    deviceType: z.enum(DEVICE_TYPES).optional(),
    brand: trimmed.max(60).optional(),
    model: trimmed.max(60).optional(),
    complaint: trimmed.max(1000).optional(),
    imei: trimmed.max(40).optional(),
    deviceCondition: z.enum(DEVICE_CONDITIONS).optional(),
    accessories: optionalText,
    expectedDelivery: trimmed.max(30).optional(),
    technician: trimmed.max(60).optional(),
    notes: optionalText,
    estimatedAmount: money.optional(),
    finalAmount: money.optional(),
    discount: money.optional(),
  })
  .strict();

export const statusChangeSchema = z.object({
  status: orderStatusEnum,
  note: trimmed.max(300).optional().default(''),
});

/**
 * A bill line can come from the price list, or be typed in at the counter as a
 * plain name and price. A typed line has no stock item behind it, so it is
 * billed and printed like any other line but never takes stock out - the shop
 * has not said it owns that item.
 */
export const orderPartAddSchema = z
  .object({
    partId: trimmed.optional().default(''),
    name: trimmed.max(120).optional().default(''),
    quantity: z.coerce.number().int().min(1).max(999),
    unitPrice: money.optional().default(0),
  })
  .refine((input) => Boolean(input.partId || input.name), {
    message: 'Choose an item or type a name',
    path: ['name'],
  });

/**
 * Taking a payment. 0 is a valid amount: sometimes nothing is collected and the
 * counter still wants that written on the bill. Negative amounts are refused
 * here, before the domain ever sees the request.
 */
export const paymentCreateSchema = z.object({
  amount: z.coerce
    .number()
    .min(0, 'Amount cannot be negative')
    .max(9_999_999, 'Amount is too large')
    .refine((n) => Number.isFinite(n), 'Invalid amount'),
  mode: paymentModeEnum.optional().default('Cash'),
  note: trimmed.max(200).optional().default(''),
  idempotencyKey: trimmed.max(80).optional().default(''),
});

/**
 * Correcting a payment already taken. The original row is changed in place - no
 * second row, no reversal - so the bill's paid figure, balance and payment
 * status are the only place the correction shows up.
 */
export const paymentUpdateSchema = z.object({
  amount: z.coerce
    .number()
    .min(0, 'Amount cannot be negative')
    .max(9_999_999, 'Amount is too large')
    .refine((n) => Number.isFinite(n), 'Invalid amount'),
  mode: paymentModeEnum.optional(),
  note: trimmed.max(200).optional(),
});

export const deliverSchema = z.object({
  deliveredTo: trimmed.max(80).optional().default(''),
  idempotencyKey: trimmed.max(80).optional().default(''),
});

/* ------------------------------ suppliers ----------------------------- */

export const supplierCreateSchema = z.object({
  name: trimmed.min(1, 'Supplier name is required').max(100),
  mobile: trimmed
    .max(15)
    .optional()
    .default('')
    .transform((v) => (v ? normalizeMobile(v) : ''))
    .refine((v) => v === '' || isValidIndianMobile(v), 'Enter a valid 10 digit number'),
  notes: optionalText,
});

export const supplierUpdateSchema = supplierCreateSchema.partial();

/* ------------------------------- stock -------------------------------- */

export const stockInSchema = z.object({
  partId: trimmed.min(1, 'Choose an item'),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(1_000_000),
  reason: trimmed.max(200).optional().default('Stock received'),
  idempotencyKey: trimmed.max(80).optional().default(''),
});

/**
 * A supplier list pasted in or uploaded as a text / sheet file. Each line has a
 * part name and a quantity; the brand comes from a heading line above it. The
 * app reads the list up front, so what arrives here is already clean rows.
 */
export const stockImportSchema = z.object({
  items: z
    .array(
      z.object({
        partId: trimmed.max(40).optional().default(''),
        name: trimmed.min(1, 'Item name is required').max(120),
        brand: trimmed.max(60).default(''),
        category: trimmed.max(60).default('Repair Part'),
        quantity: z.coerce.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'Nothing to import')
    .max(500, 'Too many lines for one import'),
  /** One key per file, so sending the same list twice cannot double the stock. */
  idempotencyKey: trimmed.min(8).max(80).optional().default(''),
});

export const stockClearSchema = z.object({
  mode: z.enum(['RESET_COUNT_ONLY', 'DELETE_ITEMS']),
  category: trimmed.max(60).optional().default('ALL'),
  resetPrices: z.boolean().optional().default(false),
  clearMovements: z.boolean().optional().default(false),
});

export const stockOutSchema = z
  .object({
    partId: trimmed.min(1, 'Choose an item'),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(1_000_000),
    reason: trimmed.max(200).optional().default('Used for repair'),
    orderId: trimmed.max(40).optional().default(''),
    idempotencyKey: trimmed.max(80).optional().default(''),
  })
  .superRefine((value, ctx) => {
    // Rule: every stock-out linked to a repair must carry its Order ID.
    if (/repair|order|used/i.test(value.reason) && !value.orderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orderId'],
        message: 'Order ID is required for repair stock',
      });
    }
  });

export const stockAdjustSchema = z.object({
  partId: trimmed.min(1),
  newQuantity: z.coerce.number().int().min(0).max(1_000_000),
  reason: trimmed.max(200).optional().default('Stock corrected'),
});

/* ------------------------------ settings ------------------------------ */

export const settingsUpdateSchema = z.object({
  shopName: trimmed.min(1, 'Shop name is required').max(100),
  contact1Name: trimmed.max(60).optional().default(''),
  contact1Number: trimmed.max(20).optional().default(''),
  contact2Name: trimmed.max(60).optional().default(''),
  contact2Number: trimmed.max(20).optional().default(''),
  address: optionalText,
  serviceDescription: trimmed.max(500).optional().default(''),
  upiId: trimmed.max(80).optional().default(''),
  receiptInformation: trimmed.max(500).optional().default(''),
  billFooter: trimmed.max(200).optional().default(''),
  allowNegativeStock: z.coerce.boolean().optional(),
});

/* -------------------------------- sync -------------------------------- */

export const importSchema = z.object({
  dataset: z.enum(['customers', 'orders', 'parts', 'suppliers', 'payments', 'stockMovements']),
  rows: z.array(z.record(z.string(), z.unknown())).max(5000),
  mode: z.enum(['merge', 'replace']).optional().default('merge'),
});

export const loginSchema = z.object({
  username: trimmed.min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});

/**
 * The PIN typed on the Stock lock screen and on the hidden-figures prompt.
 * Checked on the server only.
 *
 * Digits only, because the phone opens a digits-only keypad for these boxes.
 * That is what makes a 4-digit PIN quick to enter at a counter, and it also means
 * a PIN can never be a word someone has to spell out on an alphabet keyboard.
 */
export const stockUnlockSchema = z.object({
  pin: trimmed
    .regex(/^\d+$/, 'The PIN is the shop number, digits only')
    .min(4, 'The PIN is at least 4 digits')
    .max(12, 'The PIN is at most 12 digits'),
});

/** Self-service password change: you must prove you know the current one. */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(4, 'Password must be at least 4 characters').max(100),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must be different from the current one',
    path: ['newPassword'],
  });

export const userCreateSchema = z.object({
  name: trimmed.min(1, 'Name is required').max(60),
  username: trimmed
    .min(3, 'Username must be at least 3 characters')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only'),
  password: z.string().min(4, 'Password must be at least 4 characters').max(100),
  role: z.enum(['OWNER', 'STAFF']).optional().default('STAFF'),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type CustomerInput = z.infer<typeof customerCreateSchema>;
export type PartInput = z.infer<typeof partCreateSchema>;
