import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useClearStock, useParts } from '@/hooks/use-queries';
import { PART_CATEGORIES } from '@shared/domain';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/format';

export interface ClearStockSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClearStockSheet({ open, onOpenChange }: ClearStockSheetProps): JSX.Element {
  const toast = useToast();
  const clearStock = useClearStock();
  const { data: parts } = useParts('', false);

  const [mode, setMode] = useState<'RESET_COUNT_ONLY' | 'DELETE_ITEMS'>('RESET_COUNT_ONLY');
  const [category, setCategory] = useState<string>('ALL');
  const [resetPrices, setResetPrices] = useState(false);
  const [clearMovements, setClearMovements] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  // Extract all categories in current stock + standard categories
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of PART_CATEGORIES) set.add(c);
    for (const p of parts ?? []) {
      if (p.category) set.add(p.category);
    }
    const list = Array.from(set).sort();
    return [
      { value: 'ALL', label: 'All Categories (Entire Stock)' },
      ...list.map((c) => ({ value: c, label: `${c} Category` })),
    ];
  }, [parts]);

  // Calculate target impact
  const targetSummary = useMemo(() => {
    const list = parts ?? [];
    const filtered =
      category === 'ALL'
        ? list
        : list.filter((p) => p.category.toLowerCase() === category.toLowerCase());

    const totalUnits = filtered.reduce((sum, p) => sum + Math.max(0, p.quantity), 0);
    return {
      count: filtered.length,
      totalUnits,
    };
  }, [parts, category]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmStep(false);
    }
    onOpenChange(nextOpen);
  };

  const executeClear = async (): Promise<void> => {
    try {
      const res = await clearStock.mutateAsync({
        mode,
        category: category === 'ALL' ? undefined : category,
        resetPrices: mode === 'RESET_COUNT_ONLY' ? resetPrices : false,
        clearMovements,
      });

      const affected = res.data?.affectedItems ?? targetSummary.count;
      const catLabel = category === 'ALL' ? 'all categories' : `category "${category}"`;

      if (mode === 'RESET_COUNT_ONLY') {
        toast.success(
          'Stock counts reset to 0',
          `Successfully cleared stock count to 0 for ${plural(affected, 'item')} in ${catLabel}. Item names and catalog info kept intact.`,
        );
      } else {
        toast.success(
          'Items deleted from stock',
          `Successfully removed ${plural(affected, 'item')} in ${catLabel} from the active stock inventory.`,
        );
      }

      setConfirmStep(false);
      onOpenChange(false);
    } catch (caught) {
      toast.error(
        'Could not clear stock',
        caught instanceof Error ? caught.message : 'An error occurred while updating stock.',
      );
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Clear / Reset Stock Info"
      description="One-click stock reset & deletion. Changes apply ONLY to stock side."
      className="sm:max-w-xl"
    >
      <div className="space-y-4 pb-4">
        {/* Safety banner */}
        <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-foreground">
          <ShieldCheck className="h-5 w-5 shrink-0 text-success mt-0.5" />
          <div>
            <p className="font-bold text-success-foreground">100% Stock-Side Only Guarantee</p>
            <p className="text-muted-foreground mt-0.5">
              Your billing side is <strong>completely untouched</strong>. Existing bills, invoices,
              customer records, and repair orders will never be modified or deleted.
            </p>
          </div>
        </div>

        {/* Action Mode Choice */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            Choose What to Clear / Delete
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode('RESET_COUNT_ONLY');
                setConfirmStep(false);
              }}
              className={cn(
                'flex flex-col justify-between rounded-xl border-2 p-3 text-left transition-all',
                mode === 'RESET_COUNT_ONLY'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/30',
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-sm flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4 text-primary" />
                    Reset Count Only
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Deletes completely <strong>stock count only</strong> (sets quantity to 0). Item
                  names, brands, categories & prices remain in your catalog.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('DELETE_ITEMS');
                setConfirmStep(false);
              }}
              className={cn(
                'flex flex-col justify-between rounded-xl border-2 p-3 text-left transition-all',
                mode === 'DELETE_ITEMS'
                  ? 'border-destructive bg-destructive/5 ring-1 ring-destructive'
                  : 'border-border bg-card hover:bg-muted/30',
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-sm flex items-center gap-1.5 text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Delete Items
                  </span>
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive uppercase">
                    Full Remove
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Deletes <strong>item name, count & info</strong> completely from the stock side.
                  Items are removed from your active shelf.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Category Selection */}
        <Field
          label="Category Filter (Select Which Items to Clear)"
          htmlFor="clear-category"
          hint="Choose 'All Categories' or pick a specific category."
        >
          <Select
            value={category}
            onValueChange={(val) => {
              setCategory(val);
              setConfirmStep(false);
            }}
            options={categoryOptions}
          />
        </Field>

        {/* Live Target Impact Badge */}
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Scope of change:</span>
            <span className="text-xs font-bold text-foreground">
              {category === 'ALL' ? 'All Categories' : `${category} Category`}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-sm">
            <span className="font-medium">Items affected:</span>
            <span className="font-black tabular text-foreground">
              {targetSummary.count} item{targetSummary.count === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="font-medium">Current stock units:</span>
            <span className="font-black tabular text-foreground">
              {targetSummary.totalUnits} unit{targetSummary.totalUnits === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Result after clear:</span>
            <span className="font-bold text-destructive">
              {mode === 'RESET_COUNT_ONLY'
                ? '0 units (items preserved)'
                : 'Deleted from stock list'}
            </span>
          </div>
        </div>

        {/* Additional Custom Options */}
        <div className="space-y-2 rounded-xl border p-3 bg-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Custom Options
          </p>

          {mode === 'RESET_COUNT_ONLY' ? (
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={resetPrices}
                onChange={(e) => setResetPrices(e.target.checked)}
                className="rounded border-border"
              />
              <span>Also reset purchase cost & selling price to ₹0</span>
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={clearMovements}
              onChange={(e) => setClearMovements(e.target.checked)}
              className="rounded border-border"
            />
            <span>Also clear stock movement history for affected items</span>
          </label>
        </div>

        {/* Confirmation Step / Action button */}
        {confirmStep ? (
          <div className="space-y-2 rounded-xl border-2 border-destructive/60 bg-destructive/10 p-3">
            <p className="text-xs font-bold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Confirm Action
            </p>
            <p className="text-xs text-foreground leading-relaxed">
              Are you sure you want to{' '}
              {mode === 'RESET_COUNT_ONLY'
                ? `reset the stock count to 0 for ${targetSummary.count} item(s)?`
                : `permanently delete ${targetSummary.count} item(s) from the stock side?`}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmStep(false)}
                disabled={clearStock.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={clearStock.isPending}
                loadingText="Clearing..."
                onClick={() => void executeClear()}
              >
                Yes, Clear Now
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            variant={mode === 'RESET_COUNT_ONLY' ? 'default' : 'destructive'}
            className="w-full gap-2 font-bold"
            disabled={targetSummary.count === 0 || clearStock.isPending}
            onClick={() => setConfirmStep(true)}
          >
            {mode === 'RESET_COUNT_ONLY' ? (
              <>
                <RotateCcw className="h-4 w-4" />
                Reset Stock Counts to 0 ({targetSummary.count} items)
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete {targetSummary.count} Items from Stock
              </>
            )}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
