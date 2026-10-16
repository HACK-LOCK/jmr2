import { Check } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { StockExportColumn } from '@shared/domain';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StockColumnChoice } from '@/lib/stock-columns';

/**
 * Ticking the fields of stock items that downloaded Excel, CSV, and WhatsApp order messages carry.
 *
 * Allows shop owners to export:
 * - "Item Name only" (e.g., simple list to send to a distributor)
 * - "Item Name & Order Qty"
 * - Full stock details (Brand, Model, Category, Current Stock, Min Qty, Cost, Supplier)
 *
 * Exactly mirrors the column configuration experience in Customer Info.
 */
export function StockColumnSheet({
  open,
  onOpenChange,
  choice,
  rowCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: StockColumnChoice;
  /** How many stock items the export will hold. */
  rowCount: number;
}): JSX.Element {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Download Columns"
      description="Tick what the Excel, CSV, and WhatsApp order should contain. Nothing else is added."
      className="sm:max-w-lg"
    >
      <StockColumnBody choice={choice} rowCount={rowCount} onDone={() => onOpenChange(false)} />
    </Sheet>
  );
}

/**
 * The picker body itself, without the outer sheet wrapper.
 */
export function StockColumnBody({
  choice,
  rowCount,
  onDone,
}: {
  choice: StockColumnChoice;
  rowCount: number;
  onDone: () => void;
}): JSX.Element {
  const { all, selected, isSelected, toggle, selectOnly, selectAll, selectPreset } = choice;

  const isNameOnly = selected.length === 1 && selected[0]?.key === 'name';
  const isNameAndQty =
    selected.length === 2 &&
    selected.some((c) => c.key === 'name') &&
    selected.some((c) => c.key === 'orderQty');

  return (
    <div className="space-y-3 pb-2">
      {/* Top summary & Select All */}
      <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-border bg-secondary/40 px-3 py-2">
        <p className="text-sm font-semibold">
          {selected.length} of {all.length} columns in the file
        </p>
        <Button variant="ghost" size="sm" onClick={selectAll} className="shrink-0 text-xs font-bold">
          Select all
        </Button>
      </div>

      {/* Quick Presets for one-click selection */}
      <div className="space-y-1">
        <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
          Quick Presets
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={isNameOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => selectOnly('name')}
            className={cn('h-7 text-xs font-bold px-2.5', isNameOnly && 'bg-amber-500 text-black hover:bg-amber-600')}
          >
            Item Name only
          </Button>
          <Button
            type="button"
            variant={isNameAndQty ? 'default' : 'outline'}
            size="sm"
            onClick={() => selectPreset(['name', 'orderQty'])}
            className={cn('h-7 text-xs font-bold px-2.5', isNameAndQty && 'bg-amber-500 text-black hover:bg-amber-600')}
          >
            Name + Order Qty
          </Button>
          <Button
            type="button"
            variant={selected.length === all.length ? 'default' : 'outline'}
            size="sm"
            onClick={selectAll}
            className="h-7 text-xs font-bold px-2.5"
          >
            All Columns
          </Button>
        </div>
      </div>

      {/* Column Rows List */}
      <ul className="space-y-1.5" role="group" aria-label="Columns to include in download">
        {all.map((column) => (
          <li key={column.key}>
            <StockColumnRow
              column={column}
              on={isSelected(column.key)}
              onToggle={() => toggle(column.key)}
              onOnly={() => selectOnly(column.key)}
            />
          </li>
        ))}
      </ul>

      <p className="text-2xs text-muted-foreground">
        {rowCount > 0
          ? `The next download holds ${plural(rowCount, 'item')} in ${plural(selected.length, 'column')}. Your choice is remembered for next time.`
          : 'Your choice is remembered for next time.'}
      </p>

      <Button className="w-full font-bold" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** One column row: clicking the row toggles; tapping "Only" selects just this single column. */
function StockColumnRow({
  column,
  on,
  onToggle,
  onOnly,
}: {
  column: StockExportColumn;
  on: boolean;
  onToggle: () => void;
  onOnly: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-[52px] items-center gap-1 rounded-xl border-2 px-2 py-1.5 transition-colors',
        on ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={column.header}
        onClick={onToggle}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2',
            on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
          )}
        >
          {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
        <span className={cn('min-w-0 truncate text-sm', on ? 'font-bold' : 'font-medium')}>
          {column.header}
        </span>
      </button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onOnly}
        aria-label={`Select only ${column.header}`}
        className="shrink-0 h-8 text-xs font-semibold hover:bg-amber-500/20 hover:text-amber-700 dark:hover:text-amber-300"
      >
        Only
      </Button>
    </div>
  );
}
