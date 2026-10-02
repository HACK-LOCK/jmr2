import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  Building2,
  Download,
  FileSpreadsheet,
  History,
  Lock,
  Minus,
  Package,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Search as SearchIcon,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { MiniStat, PageHeader, SectionCard } from '@/components/app-shell';
import { PartPicker } from '@/components/part-picker';
import { StockGate } from '@/components/stock-gate';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, InlineNotice, LoadingBlock } from '@/components/ui/feedback';
import { Input, Textarea, numberPad } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
  useCreatePart,
  useCreateSupplier,
  useDeletePart,
  useDeleteSupplier,
  useImportParts,
  useParts,
  useStockIn,
  useStockOut,
  useStockReturn,
  useStockSummary,
  useSuppliers,
  useUpdatePart,
  useUpdateSupplier,
} from '@/hooks/use-queries';
import { useDebounced } from '@/lib/hooks';
import { isValidMobile, mobileOnly, money, plural } from '@/lib/format';
import { parseStockList, detectBrand, detectCategory } from '@/lib/stock-import';
import { useStockAccess } from '@/lib/stock-access';
import { cn } from '@/lib/utils';
import { CONSUME_MODES, PART_CATEGORIES } from '@shared/domain';
import type { PartListItem, SupplierListItem } from '@/lib/types';
import SheetSync from './SheetSync';
import Settings from './Settings';
import { LowStockOrderSheet } from '@/components/low-stock-order-sheet';
import { StockHistorySection } from './StockHistory';

const TABS = [
  { key: 'items', label: 'All Items', icon: Package },
  { key: 'history', label: 'Stock History', icon: History },
  { key: 'low', label: 'Low Stock', icon: AlertTriangle },
  { key: 'in', label: 'Stock In', icon: PackagePlus },
  { key: 'out', label: 'Stock Out', icon: PackageMinus },
  { key: 'suppliers', label: 'Suppliers', icon: Building2 },
  { key: 'sync', label: 'Sheet Sync', icon: FileSpreadsheet },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export type StockMode = 'home' | 'import' | 'settings';

/**
 * JMR - STOCK. One screen with every stock job on it, behind the PIN. The
 * bottom bar carries the three main doors - Home (items, low stock, stock in
 * and out, suppliers, sheet sync), Add / Import, and Setting - exactly like
 * the billing side carries Home / New / Bills.
 */
export default function StockDesktop({ mode = 'home' }: { mode?: StockMode } = {}): JSX.Element {
  const { unlocked, lock } = useStockAccess();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('tab') ?? 'items';
  const tab = (TABS.find((entry) => entry.key === raw)?.key ?? 'items') as TabKey;

  // Old links that pointed at import / settings tabs now land on the doors.
  useEffect(() => {
    if (raw === 'import') navigate('/stock/import', { replace: true });
    else if (raw === 'settings') navigate('/stock/settings', { replace: true });
  }, [raw, navigate]);

  const setTab = (next: TabKey): void => {
    const copy = new URLSearchParams(params);
    if (next === 'items') copy.delete('tab');
    else copy.set('tab', next);
    setParams(copy, { replace: true });
  };

  if (!unlocked) return <StockGate />;

  if (mode === 'settings') return <Settings />;

  if (mode === 'import') {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          title="Add / Import Stock"
          subtitle="Add stock to one item or import a whole supplier list"
        />
        <StockInSection />
        <ImportSection />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title="JMR STOCK" center
        subtitle="Everything about items, suppliers and sync"
        action={
          <Button variant="outline" onClick={lock} className="gap-2">
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Lock</span>
          </Button>
        }
      />

      <StockSummaryStrip onPick={setTab} />

      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
        {TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={cn(
                'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-bold transition-colors',
                active
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-border bg-card text-foreground',
              )}
            >
              <entry.icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </div>

      {tab === 'items' ? <ItemsSection /> : null}
      {tab === 'history' ? <StockHistorySection /> : null}
      {tab === 'low' ? <ItemsSection lowOnly /> : null}
      {tab === 'in' ? <StockInSection /> : null}
      {tab === 'out' ? <StockOutSection /> : null}
      {tab === 'suppliers' ? <SuppliersSection /> : null}
      {tab === 'sync' ? <SheetSync /> : null}
    </div>
  );
}

function StockSummaryStrip({
  onPick,
}: {
  onPick: (tab: TabKey) => void;
}): JSX.Element {
  const { data, isLoading } = useStockSummary();
  if (isLoading && !data) return <LoadingBlock label="Loading stock..." />;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <button type="button" onClick={() => onPick('items')} className="text-left">
        <MiniStat label="Items" value={data?.items ?? 0} icon={Package} />
      </button>
      <button type="button" onClick={() => onPick('items')} className="text-left">
        <MiniStat label="Units" value={data?.units ?? 0} icon={Boxes} />
      </button>
      <button type="button" onClick={() => onPick('items')} className="text-left">
        <MiniStat label="Stock Value" value={money(data?.value ?? 0)} icon={Wallet} tone="success" />
      </button>
      <button type="button" onClick={() => onPick('low')} className="text-left">
        <MiniStat
          label="Low Stock"
          value={data?.low ?? 0}
          icon={AlertTriangle}
          tone={(data?.low ?? 0) > 0 ? 'warning' : 'default'}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

function ItemsSection({ lowOnly = false }: { lowOnly?: boolean }): JSX.Element {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 200);
  const { data, isLoading, error, refetch } = useParts(debounced, lowOnly);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PartListItem | null>(null);
  const [menuFor, setMenuFor] = useState<PartListItem | null>(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);

  const items = useMemo(() => {
    const list = data ?? [];
    if (!lowOnly) return list;
    return [...list].sort((a, b) => {
      const aCrit = a.quantity < 2 ? 0 : 1;
      const bCrit = b.quantity < 2 ? 0 : 1;
      if (aCrit !== bCrit) return aCrit - bCrit;
      if (a.quantity !== b.quantity) return a.quantity - b.quantity;
      return a.name.localeCompare(b.name);
    });
  }, [data, lowOnly]);

  return (
    <SectionCard
      title={lowOnly ? 'Low Stock Items' : 'All Items'}
      icon={lowOnly ? AlertTriangle : Package}
      action={
        <div className="flex items-center gap-2">
          {lowOnly && items.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOrderModalOpen(true)}
              className="gap-1.5 border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold"
            >
              <Download className="h-4 w-4" />
              <span>Order List / Download</span>
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      }
    >
      {items.length > 5 || search ? (
        <div className="relative mb-3">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="items-search"
            name="items-search"
            aria-label="Search items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search item, brand or model"
            className="pl-11"
          />
        </div>
      ) : null}

      {error && !data ? (
        <ErrorBlock message={error.message} onRetry={() => void refetch()} />
      ) : isLoading && !data ? (
        <LoadingBlock label="Loading items..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={lowOnly ? 'Nothing is running low' : 'No items yet'}
          description={
            lowOnly
              ? 'Every item is above its minimum level.'
              : 'Add the parts and packaging you keep on the shelf.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-secondary/80 backdrop-blur z-10 border-b">
              <tr>
                <th className="w-8 px-3 py-2.5 text-center">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-3 py-2.5 font-bold text-muted-foreground">Item Description</th>
                <th className="px-2 py-2.5 font-bold text-center text-muted-foreground">Current Stock</th>
                <th className="px-3 py-2.5 font-bold text-center text-muted-foreground">Adjust Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((part) => {
                const isOut = part.quantity <= 0;
                const isCritical = part.quantity === 1;
                const isLow = part.quantity > 0 && (part.low || part.quantity < 2);
                return (
                  <tr
                    key={part.id}
                    className={cn(
                      'transition-colors align-middle cursor-pointer hover:bg-muted/50',
                      isOut && 'border-l-4 border-l-destructive',
                      isCritical && 'border-l-4 border-l-amber-500',
                    )}
                    onClick={() => setMenuFor(part)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <Pencil
                        className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => setMenuFor(part)}
                      />
                    </td>

                    {/* Item Description */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-black text-sm text-foreground truncate" title={part.name}>
                            {part.name}
                          </p>
                          {isOut ? (
                            <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-black uppercase text-destructive-foreground">
                              Out of Stock
                            </span>
                          ) : isCritical ? (
                            <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                              Critical (1 pc)
                            </span>
                          ) : isLow ? (
                            <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                              Low
                            </span>
                          ) : null}
                        </div>
                        <p className="text-2xs text-muted-foreground truncate">
                          {[part.brand, part.model].filter(Boolean).join(' ')}
                          {part.category ? ` · ${part.category}` : ''}
                          {part.supplierName ? ` · ${part.supplierName}` : ''}
                        </p>
                      </div>
                    </td>

                    {/* Current Stock */}
                    <td className="px-2 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {isOut ? (
                        <span className="inline-block rounded-full bg-destructive w-8 h-8 flex items-center justify-center text-sm font-black text-destructive-foreground">
                          0
                        </span>
                      ) : isCritical ? (
                        <span className="inline-block rounded-full bg-amber-500 w-8 h-8 flex items-center justify-center text-sm font-black text-black">
                          1
                        </span>
                      ) : isLow ? (
                        <span className="inline-block rounded-full bg-amber-400 w-8 h-8 flex items-center justify-center text-sm font-black text-black">
                          {part.quantity}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-muted w-8 h-8 flex items-center justify-center text-sm font-bold">
                          {part.quantity}
                        </span>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">min {part.minQuantity}</p>
                    </td>

                    {/* Adjust Qty - compact stepper matching Order Sheet style */}
                    <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <CompactStepper part={part} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ItemSheet open={addOpen} onOpenChange={setAddOpen} />
      <ItemSheet
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        part={editing}
      />
      <ItemMenuSheet
        part={menuFor}
        onClose={() => setMenuFor(null)}
        onEdit={(part) => {
          setMenuFor(null);
          setEditing(part);
        }}
      />
      {lowOnly ? (
        <LowStockOrderSheet
          open={orderModalOpen}
          onOpenChange={setOrderModalOpen}
          items={items}
        />
      ) : null}
    </SectionCard>
  );
}

/**
 * Compact stepper that shows the LIVE current stock count in the middle.
 * − removes 1 from stock, + adds 1 to stock. The displayed number is always
 * the real server value (part.quantity) with an optimistic local offset while
 * a mutation is in-flight. You can also type any number to set stock directly.
 */
function CompactStepper({ part }: { part: PartListItem }): JSX.Element {
  const toast = useToast();
  const stockIn = useStockIn();
  const stockOut = useStockOut();
  // optimistic offset: how much we've already mutated but server hasn't confirmed yet
  const [offset, setOffset] = useState(0);
  // input-mode: when user focuses the field we let them type a target value
  const [inputVal, setInputVal] = useState<string | null>(null);
  const busy = stockIn.isPending || stockOut.isPending;

  // Displayed count: server value + pending offset
  const displayed = part.quantity + offset;

  const add = async (): Promise<void> => {
    if (busy) return;
    setOffset((o) => o + 1);
    try {
      await stockIn.mutateAsync({
        partId: part.id,
        quantity: 1,
        reason: 'Quick add from items',
        idempotencyKey: crypto.randomUUID(),
      });
      setOffset(0); // server updated, reset optimistic delta
    } catch (caught) {
      setOffset((o) => o - 1); // rollback
      toast.error('Could not add stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  const remove = async (): Promise<void> => {
    if (busy || displayed <= 0) return;
    setOffset((o) => o - 1);
    try {
      await stockOut.mutateAsync({
        partId: part.id,
        quantity: 1,
        reason: 'Shelf adjustment',
        idempotencyKey: crypto.randomUUID(),
      });
      setOffset(0); // server updated, reset optimistic delta
    } catch (caught) {
      setOffset((o) => o + 1); // rollback
      toast.error('Could not remove stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  // When user types directly in the box and confirms, set stock to that target
  const commitInput = async (): Promise<void> => {
    if (inputVal === null) return;
    const target = Math.max(0, Math.floor(Number(inputVal)) || 0);
    setInputVal(null);
    const diff = target - part.quantity;
    if (diff === 0) return;
    setOffset(diff);
    try {
      if (diff > 0) {
        await stockIn.mutateAsync({
          partId: part.id,
          quantity: diff,
          reason: 'Manual stock set',
          idempotencyKey: crypto.randomUUID(),
        });
      } else {
        await stockOut.mutateAsync({
          partId: part.id,
          quantity: Math.abs(diff),
          reason: 'Manual stock set',
          idempotencyKey: crypto.randomUUID(),
        });
      }
      setOffset(0);
    } catch (caught) {
      setOffset(0);
      toast.error('Could not update stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <div className="inline-flex items-center rounded-lg border bg-background shadow-xs">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy || displayed <= 0}
        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
        aria-label={`Remove 1 of ${part.name}`}
        title="Remove 1 from stock"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        id={`stepper-qty-${part.id}`}
        name={`stepper-qty-${part.id}`}
        type="number"
        min={0}
        value={inputVal !== null ? inputVal : displayed}
        onFocus={() => setInputVal(String(displayed))}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={() => void commitInput()}
        onKeyDown={(e) => { if (e.key === 'Enter') void commitInput(); if (e.key === 'Escape') setInputVal(null); }}
        className={cn(
          'h-7 w-10 text-center font-black text-xs border-x focus:outline-none bg-transparent transition-colors',
          displayed <= 0 ? 'text-destructive' : displayed < 2 ? 'text-amber-600 dark:text-amber-400' : '',
        )}
        aria-label={`Current stock for ${part.name}`}
        title="Current stock — type to set directly, or use + / − buttons"
      />
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
        aria-label={`Add 1 of ${part.name}`}
        title="Add 1 to stock"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function ItemSheet({
  open,
  onOpenChange,
  part,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  part?: PartListItem | null;
}): JSX.Element {
  const toast = useToast();
  const createPart = useCreatePart();
  const updatePart = useUpdatePart(part?.id ?? '');
  const { data: supplierList } = useSuppliers();
  const [touched, setTouched] = useState(false);
  const [form, setForm] = useState(emptyItemForm());

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setForm(
      part
        ? {
          name: part.name,
          category: part.category,
          brand: part.brand,
          model: part.model,
          quantity: String(part.quantity),
          minQuantity: String(part.minQuantity),
          purchaseCost: String(part.purchaseCost),
          sellingPrice: String(part.sellingPrice),
          supplierId: part.supplierId,
          consumeMode: part.consumeMode,
        }
        : emptyItemForm(),
    );
  }, [open, part]);

  const nameError = form.name.trim() ? '' : 'Item name is required';
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async (): Promise<void> => {
    setTouched(true);
    if (nameError) return;
    const payload = {
      name: form.name.trim(),
      category: form.category,
      brand: form.brand.trim(),
      model: form.model.trim(),
      minQuantity: Number(form.minQuantity) || 0,
      purchaseCost: Number(form.purchaseCost) || 0,
      sellingPrice: Number(form.sellingPrice) || 0,
      supplierId: form.supplierId,
      consumeMode: form.consumeMode,
      ...(part ? {} : { quantity: Number(form.quantity) || 0 }),
    };
    try {
      if (part) {
        await updatePart.mutateAsync(payload);
        toast.success('Item updated', form.name.trim());
      } else {
        await createPart.mutateAsync(payload);
        toast.success('Item added', form.name.trim());
      }
      onOpenChange(false);
    } catch (caught) {
      toast.error('Could not save item', caught instanceof Error ? caught.message : undefined);
    }
  };

  const busy = createPart.isPending || updatePart.isPending;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={part ? 'Edit item' : 'Add item'}
      description={part ? 'Quantity changes through Stock In or Stock Out.' : 'Opening quantity is recorded as Stock In.'}
      className="sm:max-w-2xl"
    >
      <div className="space-y-3 pb-2">
        <Field label="Item Name" htmlFor="item-name" error={touched ? nameError || null : null}>
          <Input
            id="item-name"
            value={form.name}
            onChange={(event) => {
              const val = event.target.value;
              set('name', val);
              if (!part) {
                const autoBrand = detectBrand(val);
                const autoCat = detectCategory(val);
                if (autoBrand && !form.brand) set('brand', autoBrand);
                if (autoCat && (!form.category || form.category === 'Repair Part')) set('category', autoCat);
              }
            }}
            placeholder="Mobile display"
            invalid={touched && Boolean(nameError)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="item-category">
            <Select
              value={form.category}
              onValueChange={(value) => set('category', value)}
              options={PART_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Supplier" htmlFor="item-supplier" optional>
            <Select
              value={form.supplierId}
              onValueChange={(value) => set('supplierId', value)}
              options={(supplierList ?? []).map((s) => ({ value: s.id, label: s.name }))}
              allowEmpty
              emptyLabel="No supplier"
            />
          </Field>
          <Field label="Brand" htmlFor="item-brand" optional>
            <Input
              id="item-brand"
              value={form.brand}
              onChange={(event) => set('brand', event.target.value)}
              placeholder="Samsung"
            />
          </Field>
          <Field label="Model" htmlFor="item-model" optional>
            <Input
              id="item-model"
              value={form.model}
              onChange={(event) => set('model', event.target.value)}
              placeholder="M30"
            />
          </Field>
          {part ? null : (
            <Field label="Opening Quantity" htmlFor="item-quantity">
              <Input
                id="item-quantity"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.quantity}
                onChange={(event) => set('quantity', event.target.value)}
              />
            </Field>
          )}
          <Field label="Low Stock Level" htmlFor="item-min">
            <Input
              id="item-min"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.minQuantity}
              onChange={(event) => set('minQuantity', event.target.value)}
              hint="Shown as low at or below this."
            />
          </Field>
          <Field label="Purchase Cost" htmlFor="item-cost">
            <Input
              id="item-cost"
              type="number"
              inputMode="decimal"
              min={0}
              value={form.purchaseCost}
              onChange={(event) => set('purchaseCost', event.target.value)}
            />
          </Field>
          <Field label="Selling Price" htmlFor="item-price">
            <Input
              id="item-price"
              type="number"
              inputMode="decimal"
              min={0}
              value={form.sellingPrice}
              onChange={(event) => set('sellingPrice', event.target.value)}
            />
          </Field>
          <Field label="Stock Leaves" htmlFor="item-consume">
            <Select
              value={form.consumeMode}
              onValueChange={(value) => set('consumeMode', value as ItemForm['consumeMode'])}
              options={CONSUME_MODES.map((mode) => ({
                value: mode,
                label: mode === 'PART_USED' ? 'When part is used' : 'On delivery',
              }))}
            />
          </Field>
        </div>

        <Button
          size="lg"
          className="w-full"
          loading={busy}
          loadingText="Saving..."
          onClick={() => void save()}
        >
          {part ? 'Save Changes' : 'Add Item'}
        </Button>
      </div>
    </Sheet>
  );
}

interface ItemForm {
  name: string;
  category: string;
  brand: string;
  model: string;
  quantity: string;
  minQuantity: string;
  purchaseCost: string;
  sellingPrice: string;
  supplierId: string;
  consumeMode: string;
}

function emptyItemForm(): ItemForm {
  return {
    name: '',
    category: 'Repair Part',
    brand: '',
    model: '',
    quantity: '0',
    minQuantity: '0',
    purchaseCost: '',
    sellingPrice: '',
    supplierId: '',
    consumeMode: 'PART_USED',
  };
}

/** The three things you can do to one item. */
function ItemMenuSheet({
  part,
  onClose,
  onEdit,
}: {
  part: PartListItem | null;
  onClose: () => void;
  onEdit: (part: PartListItem) => void;
}): JSX.Element {
  const toast = useToast();
  const deletePart = useDeletePart();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (part) setConfirming(false);
  }, [part]);

  const remove = async (): Promise<void> => {
    if (!part) return;
    try {
      await deletePart.mutateAsync(part.id);
      toast.success('Item removed', `${part.name} is off the shelf.`);
      onClose();
    } catch (caught) {
      toast.error('Could not remove item', caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <Sheet open={Boolean(part)} onOpenChange={(open) => !open && onClose()} title={part?.name ?? ''}>
      <div className="space-y-2 pb-2">
        {confirming ? (
          <>
            <InlineNotice tone="error">
              Remove <strong>{part?.name}</strong> from the item list? Past bills and stock movements keep
              their record.
            </InlineNotice>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                loading={deletePart.isPending}
                onClick={() => void remove()}
              >
                Yes, remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => part && onEdit(part)}>
              <Pencil className="h-5 w-5" /> Edit item
            </Button>
            <Button asChild variant="outline" className="w-full justify-start gap-2">
              <Link to={`/parts/${part?.id ?? ''}`} onClick={onClose}>
                <History className="h-5 w-5" /> Stock history
              </Link>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-5 w-5" /> Remove item
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Stock in / out                                                       */
/* ------------------------------------------------------------------ */

function StockInSection(): JSX.Element {
  const toast = useToast();
  const stockIn = useStockIn();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [part, setPart] = useState<PartListItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  const amount = Number(quantity) || 0;
  const ready = Boolean(part) && amount > 0;

  const save = async (): Promise<void> => {
    if (!part || !ready) return;
    try {
      await stockIn.mutateAsync({
        partId: part.id,
        quantity: amount,
        reason: reason.trim() || 'Stock received',
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Stock added', `${part.name} is now ${part.quantity + amount}.`);
      setPart(null);
      setQuantity('1');
      setReason('');
    } catch (caught) {
      toast.error('Could not add stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <SectionCard title="Stock In" icon={PackagePlus}>
      {!part ? (
        <Button className="w-full gap-2" onClick={() => setPickerOpen(true)}>
          <SearchIcon className="h-5 w-5" /> Choose item
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-xl border-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{part.name}</p>
              <p className="text-xs text-muted-foreground">now {part.quantity} in stock</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPart(null)}>
              Change
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="in-qty">
              <Input
                id="in-qty"
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-14 text-xl font-black"
              />
            </Field>
            <Field label="Reason" htmlFor="in-reason" optional>
              <Input
                id="in-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Stock received"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            {[1, 5, 10].map((n) => (
              <Button key={n} variant="outline" size="sm" onClick={() => setQuantity(String(n))}>
                +{n}
              </Button>
            ))}
          </div>
          <Button
            size="lg"
            className="w-full"
            loading={stockIn.isPending}
            disabled={!ready}
            onClick={() => void save()}
          >
            Add {amount > 0 ? amount : ''} to stock
          </Button>
        </div>
      )}

      <PartPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(picked) => setPart(picked)}
        title="Add stock for"
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Import a supplier list                                               */
/* ------------------------------------------------------------------ */

const EXPORT_EXAMPLE = `Samsung
Charger 5
Earphones 3
Back Cover 10`;

function ImportSection(): JSX.Element {
  const toast = useToast();
  const importParts = useImportParts();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');

  const plan = useMemo(() => parseStockList(text), [text]);
  const ready = plan.rows.length > 0 && !importParts.isPending;








  const run = async (): Promise<void> => {
    if (!ready) return;
    try {
      const response = await importParts.mutateAsync({
        items: plan.rows.map((row) => ({
          name: row.name,
          brand: row.brand,
          category: row.category,
          quantity: row.quantity,
        })),
        idempotencyKey: crypto.randomUUID(),
      });
      const created = response.data?.created ?? 0;
      const toppedUp = response.data?.toppedUp ?? 0;
      const bits = [created > 0 ? `${created} new` : '', toppedUp > 0 ? `${toppedUp} topped up` : ''].filter(Boolean);
      toast.success('Stock imported', bits.join(', ') || 'Nothing changed');
      setText('');
      setFileName('');
    } catch (caught) {
      toast.error('Could not import stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  return (
    <SectionCard title="Import Stock" icon={Upload}>
      <InlineNotice>
        Paste a supplier list or upload a <strong>.txt</strong> / <strong>.csv</strong> sheet. A brand
        on its own line, then one item per line with its quantity before or after the name; a{' '}
        <strong>-</strong> or <strong>=</strong> in front of the number is fine (<code>Samsung</code>,{' '}
        <code>Battery -5</code>, <code>=2 Charger</code>). Names that start with a known brand are
        filed under it and part names are filed into their section (e.g. <strong>OPPO</strong> Battery
        lands under Oppo in Battery) automatically.
      </InlineNotice>

      <pre className="overflow-x-auto rounded-xl border-2 bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        {EXPORT_EXAMPLE}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border-2 border-primary bg-primary px-4 text-sm font-bold text-primary-foreground">
          <Upload className="h-4 w-4" /> Choose a file
          <input
            type="file"
            id="import-file"
            name="import-file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={pickFile}
            className="hidden"
          />
        </label>
        {fileName ? <p className="truncate text-sm text-muted-foreground">{fileName}</p> : null}
      </div>

      <Field label="Or paste the list here" htmlFor="import-list" optional>
        <Textarea
          id="import-list"
          name="import-list"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={EXPORT_EXAMPLE}
          className="min-h-[140px] font-mono text-sm"
        />
      </Field>

      {plan.rows.length > 0 ? (
        <div className="rounded-xl border-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {plan.rows.length} item{plan.rows.length === 1 ? '' : 's'} ready
            </p>
            <Button
              size="sm"
              loading={importParts.isPending}
              loadingText="Importing..."
              disabled={!ready}
              className="gap-1.5"
              onClick={() => void run()}
            >
              <Upload className="h-4 w-4" /> Import now
            </Button>
          </div>
          <ul className="space-y-2">
            {plan.grouped.map((bGroup) => (
              <li key={bGroup.brand || '(no brand)'} className="rounded-xl border bg-card/60 p-2.5">
                <p className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                  {bGroup.brand.toUpperCase() || 'No brand'}
                </p>
                <ul className="mt-0.5">
                  {bGroup.categories.map((cGroup) => (
                    <div key={cGroup.category} className="rounded-lg border bg-muted/30 p-2 my-1.5 space-y-1">
                      <div className="flex items-center justify-between mb-1 pb-1 border-b border-border/40">
                        <span className="text-[11px] font-bold text-foreground">
                          {cGroup.category} Section
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">
                          {cGroup.rows.length} {cGroup.rows.length === 1 ? 'part' : 'parts'} ({cGroup.totalUnits} pcs)
                        </span>
                      </div>
                      {cGroup.rows.map((row, index) => (
                        <li
                          key={`${row.name}-${index}`}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{row.name}</span>
                            {row.category !== 'Repair Part' ? (
                              <span className="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-foreground">
                                {row.category}
                              </span>
                            ) : null}
                          </div>
                          <span className="shrink-0 tabular font-bold">{row.quantity}</span>
                        </li>
                      ))}
                    </div>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.skipped.length > 0 ? (
        <InlineNotice tone="warning">
          {plan.skipped.length} line{plan.skipped.length === 1 ? '' : 's'} could not be read:{' '}
          {plan.skipped.slice(0, 3).join(' Â· ')}
          {plan.skipped.length > 3 ? ` Â· and ${plan.skipped.length - 3} more` : ''}
        </InlineNotice>
      ) : null}
    </SectionCard>
  );
}

function StockOutSection(): JSX.Element {
  const toast = useToast();
  const stockOut = useStockOut();
  const stockReturn = useStockReturn();
  const [mode, setMode] = useState<'out' | 'return'>('out');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [part, setPart] = useState<PartListItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [orderId, setOrderId] = useState('');

  const amount = Number(quantity) || 0;
  const needsOrder = mode === 'out' && /repair|used|order/i.test(reason);
  const tooMuch = part !== null && amount > part.quantity;
  const ready = part !== null && amount > 0 && !tooMuch && (!needsOrder || orderId.trim().length > 0);

  const save = async (): Promise<void> => {
    if (!part || !ready) return;
    const payload = {
      partId: part.id,
      quantity: amount,
      reason: reason.trim() || (mode === 'out' ? 'Used for repair' : 'Returned to stock'),
      orderId: orderId.trim(),
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      if (mode === 'out') {
        await stockOut.mutateAsync(payload);
        toast.success('Stock reduced', `${part.name} is now ${part.quantity - amount}.`);
      } else {
        await stockReturn.mutateAsync(payload);
        toast.success('Stock returned', `${part.name} is now ${part.quantity + amount}.`);
      }
      setPart(null);
      setQuantity('1');
      setReason('');
      setOrderId('');
    } catch (caught) {
      toast.error('Could not update stock', caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <SectionCard title="Stock Out / Return" icon={PackageMinus}>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('out')}
          className={cn(
            'min-h-[52px] rounded-xl border-2 text-sm font-bold',
            mode === 'out' ? 'border-destructive bg-destructive/5 text-destructive' : 'border-border',
          )}
        >
          Stock Out
        </button>
        <button
          type="button"
          onClick={() => setMode('return')}
          className={cn(
            'min-h-[52px] rounded-xl border-2 text-sm font-bold',
            mode === 'return' ? 'border-success bg-success/5 text-success' : 'border-border',
          )}
        >
          Return
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {!part ? (
          <Button className="w-full gap-2" onClick={() => setPickerOpen(true)}>
            <SearchIcon className="h-5 w-5" /> Choose item
          </Button>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl border-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{part.name}</p>
                <p className="text-xs text-muted-foreground">{part.quantity} in stock</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPart(null)}>
                Change
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quantity" htmlFor="out-qty" error={tooMuch ? 'More than in stock' : null}>
                <Input
                  id="out-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  invalid={tooMuch}
                  className="h-14 text-xl font-black"
                />
              </Field>
              <Field label="Reason" htmlFor="out-reason" optional>
                <Input
                  id="out-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={mode === 'out' ? 'Used for repair' : 'Returned to stock'}
                />
              </Field>
            </div>
            {needsOrder ? (
              <Field label="Bill No." htmlFor="out-order" hint="Needed when the reason mentions a repair.">
                <Input
                  id="out-order"
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value.toUpperCase())}
                  placeholder="JMR-0001"
                  className="tabular"
                />
              </Field>
            ) : null}
            <Button
              size="lg"
              className="w-full"
              variant={mode === 'out' ? 'destructive' : 'success'}
              loading={stockOut.isPending || stockReturn.isPending}
              disabled={!ready}
              onClick={() => void save()}
            >
              {mode === 'out' ? 'Reduce stock' : 'Return to stock'}
            </Button>
          </>
        )}
      </div>

      <PartPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(picked) => setPart(picked)}
        title="Take from"
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Suppliers                                                           */
/* ------------------------------------------------------------------ */

function SuppliersSection(): JSX.Element {
  const toast = useToast();
  const { data, isLoading, error, refetch } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierListItem | null>(null);
  const [menuFor, setMenuFor] = useState<SupplierListItem | null>(null);

  const all = data ?? [];
  const q = search.trim().toLowerCase();
  const suppliers = q
    ? all.filter((s) => s.name.toLowerCase().includes(q) || s.mobile.includes(q))
    : all;

  return (
    <SectionCard
      title="Suppliers"
      icon={Building2}
      action={
        <Button size="sm" className="gap-1.5" onClick={() => setEditing(EMPTY_SUPPLIER)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      }
    >
      {all.length > 5 ? (
        <div className="relative mb-3">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="suppliers-search"
            name="suppliers-search"
            aria-label="Search suppliers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Supplier name or number"
            className="pl-11"
          />
        </div>
      ) : null}

      {error && !data ? (
        <ErrorBlock message={error.message} onRetry={() => void refetch()} />
      ) : isLoading && !data ? (
        <LoadingBlock label="Loading suppliers..." />
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={q ? 'No matching supplier' : 'No suppliers yet'}
          description="Add the people you buy parts and packaging from."
        />
      ) : (
        <ul className="space-y-2">
          {suppliers.map((supplier) => (
            <li key={supplier.id} className="flex items-center gap-3 rounded-xl border-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{supplier.name}</p>
                <p className="tabular truncate text-xs text-muted-foreground">
                  {supplier.mobile || 'No number'} Â· {plural(supplier.itemCount, 'item')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Actions for ${supplier.name}`}
                onClick={() => setMenuFor(supplier)}
                className="shrink-0"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <SupplierSheet
        supplier={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (!editing) return;
          try {
            if (editing.id) {
              await updateSupplier.mutateAsync({ id: editing.id, body });
              toast.success('Supplier updated', body.name as string);
            } else {
              await createSupplier.mutateAsync(body);
              toast.success('Supplier added', body.name as string);
            }
            setEditing(null);
          } catch (caught) {
            toast.error('Could not save supplier', caught instanceof Error ? caught.message : undefined);
          }
        }}
        busy={createSupplier.isPending || updateSupplier.isPending}
      />

      <Sheet
        open={Boolean(menuFor)}
        onOpenChange={(open) => !open && setMenuFor(null)}
        title={menuFor?.name ?? ''}
      >
        <div className="space-y-2 pb-2">
          {menuFor?.mobile ? (
            <a
              href={`tel:${menuFor.mobile}`}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border-2 px-4 font-semibold"
            >
              Call {menuFor.mobile}
            </a>
          ) : null}
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => {
              if (menuFor) setEditing(menuFor);
              setMenuFor(null);
            }}
          >
            <Pencil className="h-5 w-5" /> Edit supplier
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-destructive"
            loading={deleteSupplier.isPending}
            onClick={async () => {
              if (!menuFor) return;
              try {
                await deleteSupplier.mutateAsync(menuFor.id);
                toast.success('Supplier removed', menuFor.name);
              } catch (caught) {
                toast.error(
                  'Could not remove supplier',
                  caught instanceof Error ? caught.message : undefined,
                );
              }
              setMenuFor(null);
            }}
          >
            <Trash2 className="h-5 w-5" /> Remove supplier
          </Button>
        </div>
      </Sheet>
    </SectionCard>
  );
}

const EMPTY_SUPPLIER = { id: '', name: '', mobile: '', notes: '' } as SupplierListItem;

function SupplierSheet({
  supplier,
  onClose,
  onSave,
  busy,
}: {
  supplier: SupplierListItem | null;
  onClose: () => void;
  onSave: (body: { name: string; mobile: string; notes: string }) => Promise<void>;
  busy: boolean;
}): JSX.Element {
  const [form, setForm] = useState({ name: '', mobile: '', notes: '' });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setTouched(false);
    setForm({ name: supplier.name, mobile: supplier.mobile, notes: supplier.notes });
  }, [supplier]);

  const nameError = form.name.trim() ? '' : 'Supplier name is required';
  const mobileError = !form.mobile || isValidMobile(form.mobile) ? '' : 'Enter a valid 10 digit number';

  return (
    <Sheet
      open={Boolean(supplier)}
      onOpenChange={(open) => !open && onClose()}
      title={supplier?.id ? 'Edit supplier' : 'Add supplier'}
    >
      <div className="space-y-3 pb-2">
        <Field label="Supplier Name" htmlFor="supplier-name" error={touched ? nameError || null : null}>
          <Input
            id="supplier-name"
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            placeholder="Mobile wholesale market"
            invalid={touched && Boolean(nameError)}
          />
        </Field>
        <Field label="Mobile" htmlFor="supplier-mobile" optional error={touched ? mobileError || null : null}>
          <Input
            id="supplier-mobile"
            {...numberPad}
            value={form.mobile}
            onChange={(event) =>
              setForm((c) => ({ ...c, mobile: mobileOnly(event.target.value).slice(0, 10) }))
            }
            invalid={touched && Boolean(mobileError)}
          />
        </Field>
        <Field label="Notes" htmlFor="supplier-notes" optional>
          <Textarea
            id="supplier-notes"
            value={form.notes}
            onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
            placeholder="Gujarat market, best rate for displays"
            className="min-h-[70px]"
          />
        </Field>
        <Button
          size="lg"
          className="w-full"
          loading={busy}
          onClick={async () => {
            setTouched(true);
            if (nameError || mobileError) return;
            await onSave({
              name: form.name.trim(),
              mobile: form.mobile ? mobileOnly(form.mobile) : '',
              notes: form.notes.trim(),
            });
          }}
        >
          Save Supplier
        </Button>
      </div>
    </Sheet>
  );
}

