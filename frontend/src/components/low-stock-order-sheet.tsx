import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  Columns3,
  Copy,
  FileSpreadsheet,
  FileText,
  Minus,
  Package,
  Plus,
  Search,
  Square,
  X,
} from 'lucide-react';
import { StockColumnSheet } from '@/components/stock-column-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { downloadProtectedFile } from '@/lib/api';
import { money, plural, todayIso } from '@/lib/format';
import { useStockExportColumns } from '@/lib/stock-columns';
import { cn } from '@/lib/utils';
import type { PartListItem } from '@/lib/types';

export type StockLevelFilter = 'all' | 'zero' | 'one';

export interface LowStockOrderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PartListItem[];
}

/**
 * Custom order list and download sheet for low stock items.
 *
 * Allows shop owners to:
 * 1. Filter by Stock Level: All Low, 0 Out of Stock, or Min 1 Pc Stock (<= 1)
 * 2. Filter by Brand: All Brands or specific brand
 * 3. Filter by Multiple Categories: toggle multiple categories (Display, Battery, Charger, etc.)
 * 4. Select specific pieces ("specific pic") via checkboxes
 * 5. Adjust order quantities per item
 * 6. Download as Excel (.xlsx), CSV, or copy formatted WhatsApp message for supplier
 */
export function LowStockOrderSheet({
  open,
  onOpenChange,
  items,
}: LowStockOrderSheetProps): JSX.Element {
  const toast = useToast();

  // Filters state
  const [level, setLevel] = useState<StockLevelFilter>('all');
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [search, setSearch] = useState<string>('');
  const stockColumns = useStockExportColumns();
  const [columnsOpen, setColumnsOpen] = useState(false);

  // Selected piece IDs (specific piece selection)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));

  // Custom order quantities per piece: partId -> orderQty
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState<boolean>(false);

  // Derive unique brands from available items
  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.brand && item.brand.trim()) {
        set.add(item.brand.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Derive unique categories from available items
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const cat = (item.category || 'Other').trim();
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Filtered items based on stock level, brand, categories, and search query
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const brandLower = selectedBrand.toLowerCase();
    const catSet = selectedCategories.length > 0 ? new Set(selectedCategories.map((c) => c.toLowerCase())) : null;

    return items
      .filter((item) => {
        // Stock level filter
        if (level === 'zero' && item.quantity > 0) return false;
        if (level === 'one' && item.quantity > 1) return false;

        // Brand filter
        if (selectedBrand !== 'all' && item.brand.toLowerCase() !== brandLower) return false;

        // Multiple category filter
        if (catSet && !catSet.has((item.category || 'Other').toLowerCase())) return false;

        // Text search
        if (needle) {
          const matchName = item.name.toLowerCase().includes(needle);
          const matchBrand = item.brand.toLowerCase().includes(needle);
          const matchModel = item.model.toLowerCase().includes(needle);
          const matchCat = (item.category || '').toLowerCase().includes(needle);
          if (!matchName && !matchBrand && !matchModel && !matchCat) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Items with quantity < 2 appear at the very top (0 first, then 1)
        const aCrit = a.quantity < 2 ? 0 : 1;
        const bCrit = b.quantity < 2 ? 0 : 1;
        if (aCrit !== bCrit) return aCrit - bCrit;
        if (a.quantity !== b.quantity) return a.quantity - b.quantity;
        return a.name.localeCompare(b.name);
      });
  }, [items, level, selectedBrand, selectedCategories, search]);

  // Selected items list
  const selectedItems = useMemo(() => {
    return filteredItems.filter((item) => selectedIds.has(item.id));
  }, [filteredItems, selectedIds]);

  // Suggested order qty helper
  const getOrderQty = (item: PartListItem): number => {
    if (customQuantities[item.id] !== undefined) {
      return customQuantities[item.id] ?? 1;
    }
    // Default to at least 1, or minQuantity - current stock (with min stock threshold 2)
    const threshold = Math.max(item.minQuantity || 2, 2);
    return Math.max(1, threshold - item.quantity);
  };

  const updateOrderQty = (id: string, delta: number): void => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const current = getOrderQty(item);
    const next = Math.max(1, current + delta);
    setCustomQuantities((prev) => ({ ...prev, [id]: next }));
  };

  const setDirectOrderQty = (id: string, value: number): void => {
    const next = Math.max(1, Math.floor(value) || 1);
    setCustomQuantities((prev) => ({ ...prev, [id]: next }));
  };

  // Toggle specific piece
  const toggleItem = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select all visible filtered items
  const selectAllFiltered = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) {
        next.add(item.id);
      }
      return next;
    });
  };

  // Deselect all visible filtered items
  const deselectAllFiltered = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) {
        next.delete(item.id);
      }
      return next;
    });
  };

  // Category toggle handler (multi-category selection)
  const toggleCategory = (catName: string): void => {
    setSelectedCategories((prev) => {
      if (prev.includes(catName)) {
        return prev.filter((c) => c !== catName);
      }
      return [...prev, catName];
    });
  };

  // Summary counts
  const totalUnits = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + getOrderQty(item), 0);
  }, [selectedItems, customQuantities]);

  const estimatedCost = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + getOrderQty(item) * item.purchaseCost, 0);
  }, [selectedItems, customQuantities]);

  // Export to Excel (.xlsx) with chosen columns
  const downloadExcel = async (): Promise<void> => {
    if (selectedItems.length === 0) {
      toast.error('No items selected', 'Please select at least one piece to download.');
      return;
    }
    setDownloading(true);
    try {
      const queryParams = new URLSearchParams();
      if (selectedBrand !== 'all') queryParams.set('brand', selectedBrand);
      if (selectedCategories.length > 0) queryParams.set('categories', selectedCategories.join(','));
      if (level !== 'all') queryParams.set('level', level);
      if (search.trim()) queryParams.set('q', search.trim());
      queryParams.set('cols', stockColumns.query);
      if (Object.keys(customQuantities).length > 0) {
        queryParams.set('quantities', JSON.stringify(customQuantities));
      }

      // If user selected a subset of filtered items, pass exact IDs
      if (selectedItems.length !== filteredItems.length || filteredItems.length !== items.length) {
        queryParams.set('ids', selectedItems.map((i) => i.id).join(','));
      }

      await downloadProtectedFile(`/parts/low-stock.xlsx?${queryParams.toString()}`);
      const colNote = stockColumns.narrowed
        ? ` in ${plural(stockColumns.selected.length, 'column')}`
        : '';
      toast.success(
        'Excel downloaded',
        `${plural(selectedItems.length, 'item')} order list (${totalUnits} units)${colNote} saved.`,
      );
    } catch (caught) {
      toast.error(
        'Could not download',
        caught instanceof Error ? caught.message : 'Please try again.',
      );
    } finally {
      setDownloading(false);
    }
  };

  // Export to CSV client-side with chosen columns
  const downloadCsv = (): void => {
    if (selectedItems.length === 0) {
      toast.error('No items selected', 'Please select at least one piece to download.');
      return;
    }

    const activeCols = stockColumns.selected;
    const headers = activeCols.map((c) => c.header);

    const escapeCsv = (val: string | number | null | undefined): string => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = selectedItems.map((item) =>
      activeCols.map((col) => {
        switch (col.key) {
          case 'name':
            return escapeCsv(item.name);
          case 'brand':
            return escapeCsv(item.brand);
          case 'model':
            return escapeCsv(item.model);
          case 'category':
            return escapeCsv(item.category || 'Other');
          case 'quantity':
            return escapeCsv(item.quantity);
          case 'minQuantity':
            return escapeCsv(item.minQuantity);
          case 'orderQty':
            return escapeCsv(getOrderQty(item));
          case 'purchaseCost':
            return escapeCsv(item.purchaseCost);
          case 'supplierName':
            return escapeCsv(item.supplierName || '-');
        }
      }),
    );

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `JMR-Low-Stock-Order-List-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const colNote = stockColumns.narrowed
      ? ` in ${plural(stockColumns.selected.length, 'column')}`
      : '';
    toast.success('CSV downloaded', `${plural(selectedItems.length, 'item')} order list${colNote} exported.`);
  };

  // Copy WhatsApp formatted order message with chosen columns
  const copyForWhatsApp = async (): Promise<void> => {
    if (selectedItems.length === 0) {
      toast.error('No items selected', 'Please select at least one piece.');
      return;
    }

    const hasName = stockColumns.isSelected('name');
    const hasBrand = stockColumns.isSelected('brand');
    const hasModel = stockColumns.isSelected('model');
    const hasCategory = stockColumns.isSelected('category');
    const hasQuantity = stockColumns.isSelected('quantity');
    const hasMinQuantity = stockColumns.isSelected('minQuantity');
    const hasOrderQty = stockColumns.isSelected('orderQty');
    const hasCost = stockColumns.isSelected('purchaseCost');
    const hasSupplier = stockColumns.isSelected('supplierName');

    const lines: string[] = [
      `📦 *JMR STOCK ORDER LIST*`,
      `📅 *Date:* ${todayIso()}`,
      `----------------------------------------`,
    ];

    selectedItems.forEach((item, index) => {
      const orderQty = getOrderQty(item);

      // Name & brand/model
      const brandModel = [hasBrand ? item.brand : '', hasModel ? item.model : ''].filter(Boolean).join(' ');
      let desc = hasName ? item.name : '';
      if (brandModel) {
        desc = desc ? `${desc} (${brandModel})` : brandModel;
      }
      if (!desc) {
        desc = item.name;
      }

      let line = `${index + 1}. *${desc}*`;
      if (hasOrderQty) {
        line += ` — *Qty: ${orderQty} pcs*`;
      }

      const metaTags: string[] = [];
      if (hasCategory && item.category) {
        metaTags.push(item.category);
      }
      if (hasQuantity) {
        const stockInfo = item.quantity <= 0 ? 'Out of Stock' : `Stock: ${item.quantity}`;
        metaTags.push(stockInfo);
      }
      if (hasMinQuantity) {
        metaTags.push(`Min: ${item.minQuantity}`);
      }
      if (hasCost && item.purchaseCost > 0) {
        metaTags.push(`Cost: ₹${item.purchaseCost}`);
      }
      if (hasSupplier && item.supplierName) {
        metaTags.push(`Supplier: ${item.supplierName}`);
      }

      if (metaTags.length > 0) {
        line += ` [${metaTags.join(', ')}]`;
      }

      lines.push(line);
    });

    lines.push(`----------------------------------------`);
    let summaryLine = `📊 *Total Items:* ${selectedItems.length}`;
    if (hasOrderQty) {
      summaryLine += ` | *Total Units:* ${totalUnits}`;
    }
    lines.push(summaryLine);

    if (hasCost && estimatedCost > 0) {
      lines.push(`💰 *Est. Amount:* ${money(estimatedCost)}`);
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      const colNote = stockColumns.narrowed
        ? ` (${plural(stockColumns.selected.length, 'column')})`
        : '';
      toast.success(
        'Order list copied!',
        `Formatted WhatsApp message${colNote} ready to paste directly to your supplier.`,
      );
    } catch {
      toast.error('Failed to copy', 'Please check clipboard permissions.');
    }
  };

  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
  const someVisibleSelected =
    filteredItems.some((item) => selectedIds.has(item.id)) && !allVisibleSelected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] flex flex-col p-0">
        <DialogHeader className="p-4 sm:p-5 border-b pb-3">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black">
                  Low Stock Order List &amp; Download
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Select specific pieces, brands, categories and download for supplier re-order
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-4 p-4 sm:p-5 overflow-y-auto flex-1">
          {/* Top Filters: Level & Brand */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {/* Stock Level Selector */}
            <div className="space-y-1">
              <label className="text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">
                Stock Level
              </label>
              <div className="flex rounded-lg border bg-muted/30 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setLevel('all')}
                  className={cn(
                    'flex-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all',
                    level === 'all'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  All Low Stock
                </button>
                <button
                  type="button"
                  onClick={() => setLevel('one')}
                  className={cn(
                    'flex-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all',
                    level === 'one'
                      ? 'bg-amber-500 text-black shadow-sm font-black'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title="Items with 0 or 1 piece in stock"
                >
                  Min 1 Pc Stock
                </button>
                <button
                  type="button"
                  onClick={() => setLevel('zero')}
                  className={cn(
                    'flex-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all',
                    level === 'zero'
                      ? 'bg-destructive text-destructive-foreground shadow-sm font-black'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title="Items completely out of stock"
                >
                  0 Out of Stock
                </button>
              </div>
            </div>

            {/* Brand Selector */}
            <div className="space-y-1">
              <label className="text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">
                Brand
              </label>
              <select
                aria-label="Filter by brand"
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="h-10 w-full rounded-lg border-2 border-input bg-background px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All Brands ({brands.length} available)</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Multiple Categories Filter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">
                Categories ({selectedCategories.length === 0 ? 'All Selected' : `${selectedCategories.length} Selected`})
              </label>
              {selectedCategories.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedCategories([])}
                  className="text-2xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
                >
                  Reset to All
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 rounded-lg border bg-muted/20">
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
                  selectedCategories.length === 0
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background border hover:bg-muted text-muted-foreground',
                )}
              >
                All Categories
              </button>
              {categories.map(([cat, count]) => {
                const active = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
                      active
                        ? 'bg-amber-500 text-black font-black shadow-sm'
                        : 'bg-background border hover:bg-muted text-foreground',
                    )}
                  >
                    <span>{cat}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10px] tabular',
                        active ? 'bg-black/20 text-black' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search bar inside order modal */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="order-search-filter"
              name="order-search-filter"
              aria-label="Filter items list"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search in low stock list..."
              className="pl-9 h-9 text-xs"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* Piece Selection Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={allVisibleSelected ? deselectAllFiltered : selectAllFiltered}
                className="flex items-center gap-1.5 text-xs font-black text-foreground hover:opacity-80"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : someVisibleSelected ? (
                  <CheckSquare className="h-4 w-4 text-amber-500 opacity-60" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
                <span>
                  {selectedItems.length} of {filteredItems.length} pieces selected
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setColumnsOpen(true)}
                className="h-7 text-xs font-bold px-2.5 gap-1.5 border-amber-500/40 text-foreground hover:bg-amber-500/10"
                title="Choose which columns to include in download and WhatsApp"
              >
                <Columns3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>Columns</span>
                <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] tabular font-bold text-muted-foreground">
                  {stockColumns.selected.length}
                </span>
              </Button>
              {stockColumns.narrowed ? (
                <button
                  type="button"
                  onClick={() => setColumnsOpen(true)}
                  className="hidden sm:inline-flex items-center gap-1 text-2xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/15 hover:bg-amber-500/25 rounded-md px-2 py-0.5 transition-colors"
                  title="Click to edit download columns"
                >
                  {stockColumns.selected.length === 1
                    ? `${stockColumns.selected[0]?.header ?? ''} only`
                    : `${stockColumns.selected.length} cols`}
                </button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs font-bold px-2"
                onClick={selectAllFiltered}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs font-bold px-2"
                onClick={deselectAllFiltered}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Items Table List */}
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed">
              <Package className="h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-bold">No low stock items match this filter</p>
              <p className="text-xs text-muted-foreground">
                Try selecting "All Brands" or resetting the category filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border max-h-[360px] overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur z-10 border-b">
                  <tr>
                    <th className="w-8 px-3 py-2 text-center">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-2 font-bold">Item Description</th>
                    <th className="px-2 py-2 font-bold text-center">Current Stock</th>
                    <th className="px-3 py-2 font-bold text-center">Order Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredItems.map((item) => {
                    const checked = selectedIds.has(item.id);
                    const isOut = item.quantity <= 0;
                    const isCritical = item.quantity === 1;
                    const orderQty = getOrderQty(item);

                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          'transition-colors align-middle cursor-pointer',
                          checked ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/50 opacity-60',
                          isOut && checked && 'border-l-4 border-l-destructive',
                          isCritical && checked && 'border-l-4 border-l-amber-500',
                        )}
                        onClick={() => toggleItem(item.id)}
                      >
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-black text-sm text-foreground truncate" title={item.name}>
                                {item.name}
                              </p>
                              {isOut ? (
                                <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-black uppercase text-destructive-foreground">
                                  Out of Stock
                                </span>
                              ) : isCritical ? (
                                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                                  Critical (1 pc)
                                </span>
                              ) : null}
                            </div>
                            <p className="text-2xs text-muted-foreground truncate">
                              {[item.brand, item.model].filter(Boolean).join(' ')}
                              {item.category ? ` · ${item.category}` : ''}
                              {item.supplierName ? ` · ${item.supplierName}` : ''}
                            </p>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                          {isOut ? (
                            <span className="inline-block rounded-md bg-destructive px-2 py-0.5 text-xs font-black text-destructive-foreground">
                              0
                            </span>
                          ) : isCritical ? (
                            <span className="inline-block rounded-md bg-amber-500 px-2 py-0.5 text-xs font-black text-black">
                              1
                            </span>
                          ) : (
                            <span className="tabular font-bold text-xs">{item.quantity}</span>
                          )}
                          <p className="text-[10px] text-muted-foreground">min {item.minQuantity}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center rounded-lg border bg-background shadow-xs">
                            <button
                              type="button"
                              onClick={() => updateOrderQty(item.id, -1)}
                              disabled={orderQty <= 1}
                              className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={orderQty}
                              onChange={(e) => setDirectOrderQty(item.id, Number(e.target.value))}
                              className="h-7 w-10 text-center font-black text-xs border-x focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateOrderQty(item.id, 1)}
                              className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick Stats Summary */}
          {selectedItems.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 rounded-xl border bg-secondary/30 p-2.5 text-center">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Selected Items</p>
                <p className="text-sm font-black tabular">{selectedItems.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Units to Order</p>
                <p className="text-sm font-black tabular text-primary">{totalUnits} pcs</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Est. Amount</p>
                <p className="text-sm font-black tabular">{money(estimatedCost)}</p>
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="p-3 sm:p-4 border-t bg-muted/20 flex flex-col sm:flex-row gap-2 justify-between items-center">
          <div className="text-xs text-muted-foreground font-semibold w-full sm:w-auto text-center sm:text-left">
            {selectedItems.length > 0 ? (
              <span>Ready to order <strong>{totalUnits} units</strong> for {plural(selectedItems.length, 'part')}</span>
            ) : (
              <span>Tick items to generate order list</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setColumnsOpen(true)}
              className="gap-1.5 flex-1 sm:flex-none font-bold border-amber-500/40 text-foreground hover:bg-amber-500/10"
              title="Customize columns for Excel, CSV and WhatsApp"
            >
              <Columns3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>Columns ({stockColumns.selected.length})</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={copyForWhatsApp}
              disabled={selectedItems.length === 0}
              className="gap-1.5 flex-1 sm:flex-none font-bold"
              title="Copy formatted order list to clipboard for WhatsApp"
            >
              <Copy className="h-4 w-4" />
              <span>Copy for WhatsApp</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={downloadCsv}
              disabled={selectedItems.length === 0}
              className="gap-1.5 flex-1 sm:flex-none font-bold"
              title="Download CSV spreadsheet"
            >
              <FileText className="h-4 w-4" />
              <span>CSV</span>
            </Button>

            <Button
              size="sm"
              onClick={() => void downloadExcel()}
              disabled={selectedItems.length === 0 || downloading}
              loading={downloading}
              loadingText="Creating Excel..."
              className="gap-1.5 flex-1 sm:flex-none bg-success hover:bg-success/90 text-success-foreground font-black"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Download Excel</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <StockColumnSheet
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        choice={stockColumns}
        rowCount={selectedItems.length}
      />
    </Dialog>
  );
}
