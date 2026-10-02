import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncRoute, param, sendData } from '../middleware/respond';
import {
  clearAllBills,
  syncAllToSupabase,
  syncAndRestoreSupabase,
  syncOrderToSupabase,
  testSupabase,
} from '../../services/supabaseSync';

export const supabaseRouter = Router();
supabaseRouter.use(requireAuth);

supabaseRouter.get(
  '/supabase/status',
  asyncRoute(async (_req, res) => {
    sendData(res, await testSupabase());
  }),
);

supabaseRouter.post(
  '/supabase/test',
  asyncRoute(async (_req, res) => {
    sendData(res, await testSupabase());
  }),
);

/**
 * Full bidirectional sync & restore.
 * Called automatically on login and manually via 3-dot menu.
 */
supabaseRouter.post(
  '/supabase/sync',
  asyncRoute(async (_req, res) => {
    sendData(res, await syncAndRestoreSupabase());
  }),
);

supabaseRouter.post(
  '/supabase/restore',
  asyncRoute(async (_req, res) => {
    sendData(res, await syncAndRestoreSupabase());
  }),
);

supabaseRouter.post(
  '/supabase/push',
  asyncRoute(async (_req, res) => {
    sendData(res, await syncAllToSupabase());
  }),
);

supabaseRouter.post(
  '/supabase/sync-order/:id',
  asyncRoute(async (req, res) => {
    const orderId = param(req, 'id');
    sendData(res, await syncOrderToSupabase(orderId));
  }),
);

/**
 * Direct command to wipe all bills, orders, payments, order parts,
 * status history, and test customers from both local memory and Supabase.
 */
supabaseRouter.post(
  '/supabase/clear-bills',
  asyncRoute(async (_req, res) => {
    sendData(res, await clearAllBills());
  }),
);
