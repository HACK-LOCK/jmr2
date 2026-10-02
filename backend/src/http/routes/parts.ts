import { Router } from 'express';
import { exportsService, partsService, stockHistoryService } from '../../services';
import { actorName, requireAuth } from '../middleware/auth';
import { asyncRoute, param, sendData } from '../middleware/respond';
import {
  partCreateSchema,
  partUpdateSchema,
  stockAdjustSchema,
  stockImportSchema,
  stockInSchema,
  stockOutSchema,
} from '../../validation/schemas';

export const partsRouter = Router();
partsRouter.use(requireAuth);

/* ------------------------------ items ------------------------------- */

partsRouter.get(
  '/parts',
  asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const lowOnly = req.query.low === '1' || req.query.low === 'true';
    sendData(res, partsService.listParts({ q, lowOnly }));
  }),
);

partsRouter.post(
  '/parts',
  asyncRoute(async (req, res) => {
    const input = partCreateSchema.parse(req.body);
    const result = await partsService.createPart(input, actorName(req));
    res.status(201);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.post(
  '/parts/import',
  asyncRoute(async (req, res) => {
    const input = stockImportSchema.parse(req.body);
    const result = await partsService.importParts(input, actorName(req));
    res.status(201);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.get(
  '/parts/summary',
  asyncRoute(async (_req, res) => {
    sendData(res, partsService.stockSummary());
  }),
);

partsRouter.get(
  '/parts/low-stock.xlsx',
  asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const brand = typeof req.query.brand === 'string' ? req.query.brand : undefined;
    const categories =
      typeof req.query.categories === 'string'
        ? req.query.categories.split(',').filter(Boolean)
        : undefined;
    const level =
      req.query.level === 'zero' || req.query.level === 'one' || req.query.level === 'all'
        ? req.query.level
        : undefined;
    const ids =
      typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : undefined;

    const file = exportsService.exportLowStockParts({ q, brand, categories, level, ids });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }),
);

partsRouter.get(
  '/parts/:id',
  asyncRoute(async (req, res) => {
    sendData(res, partsService.getPart(param(req, 'id')));
  }),
);

partsRouter.patch(
  '/parts/:id',
  asyncRoute(async (req, res) => {
    const patch = partUpdateSchema.parse(req.body);
    const result = await partsService.updatePart(param(req, 'id'), patch);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.delete(
  '/parts/:id',
  asyncRoute(async (req, res) => {
    const result = await partsService.deletePart(param(req, 'id'));
    sendData(res, result.data, result.warning);
  }),
);

/* ---------------------------- stock history ------------------------- */

partsRouter.get(
  '/stock/history',
  asyncRoute(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    sendData(res, stockHistoryService.getStockHistory({ from, to, q }));
  }),
);

partsRouter.get(
  '/stock/history.xlsx',
  asyncRoute(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const file = stockHistoryService.exportStockHistory({ from, to, q });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }),
);

partsRouter.delete(
  '/stock/history/items/:movementId',
  asyncRoute(async (req, res) => {
    const movementId = param(req, 'movementId');
    const result = await stockHistoryService.deleteStockAddedItem(movementId);
    sendData(res, result);
  }),
);

partsRouter.patch(
  '/stock/history/items/:movementId',
  asyncRoute(async (req, res) => {
    const movementId = param(req, 'movementId');
    const patch = req.body as stockHistoryService.StockItemPatch;
    const result = await stockHistoryService.updateStockAddedItem(movementId, patch);
    sendData(res, result);
  }),
);

partsRouter.delete(
  '/stock/history/batches/:batchId',
  asyncRoute(async (req, res) => {
    const batchId = param(req, 'batchId');
    const result = await stockHistoryService.deleteStockAddedBatch(batchId);
    sendData(res, result);
  }),
);

partsRouter.patch(
  '/stock/history/batches/:batchId',
  asyncRoute(async (req, res) => {
    const batchId = param(req, 'batchId');
    const patch = req.body as stockHistoryService.StockBatchPatch;
    const result = await stockHistoryService.updateStockAddedBatch(batchId, patch);
    sendData(res, result);
  }),
);

/* ---------------------------- movements ----------------------------- */

partsRouter.get(
  '/stock/movements',
  asyncRoute(async (req, res) => {
    const partId = typeof req.query.partId === 'string' ? req.query.partId : undefined;
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
    sendData(res, partsService.listMovements({ partId, orderId }));
  }),
);

partsRouter.post(
  '/stock/in',
  asyncRoute(async (req, res) => {
    const input = stockInSchema.parse(req.body);
    const result = await partsService.stockIn(input, actorName(req));
    res.status(201);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.post(
  '/stock/out',
  asyncRoute(async (req, res) => {
    const input = stockOutSchema.parse(req.body);
    const result = await partsService.stockOut(input, actorName(req));
    res.status(201);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.post(
  '/stock/return',
  asyncRoute(async (req, res) => {
    const input = stockOutSchema.parse(req.body);
    const result = await partsService.stockReturn(
      { partId: input.partId, quantity: input.quantity, reason: input.reason, orderId: input.orderId },
      actorName(req),
    );
    res.status(201);
    sendData(res, result.data, result.warning);
  }),
);

partsRouter.post(
  '/stock/adjust',
  asyncRoute(async (req, res) => {
    const input = stockAdjustSchema.parse(req.body);
    const result = await partsService.stockAdjust(input, actorName(req));
    sendData(res, result.data, result.warning);
  }),
);
