import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  ListFilter,
  Package,
  Search,
  Tag,
  TriangleAlert,
  User,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useStockHistory } from '@/hooks/use-queries';
import { downloadProtectedFile } from '@/lib/api';
import { money, plusDaysIso, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StockAddedBatch } from '@/lib/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatDateTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoStr;
  }
}

/**
 * Stock History Section - Embedded into StockDesktop tabs or rendered standalone.
 */
export function StockHistorySection({ standalone = false }: { standalone?: boolean }): JSX.Element {
  const toast = useToast();
  const [mode, setMode] = useState<'day' | 'range' | 'all'>('all');
  const [day, setDay] = useState(todayIso);
  const [from, setFrom] = useState(() => plusDaysIso(-29));
  const [to, setTo] = useState(todayIso);
  const [search, setSearch] = useState('');
  const [viewType, setViewType] = useState<'batches' | 'items'>('batches');
  const [downloading, setDownloading] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  const activeFrom = mode === 'all' ? '' : mode === 'day' ? day : from;
  const activeTo = mode === 'all' ? '' : mode === 'day' ? day : to;

  const rangeError =
    mode === 'all'
      ? ''
      : !isRealDay(activeFrom)
        ? 'Choose a valid date.'
        : !isRealDay(activeTo)
          ? 'Choose a valid date.'
          : activeFrom > activeTo
            ? 'From date must be on or before To date.'
            : '';

  const ready = rangeError === '';
  const { data, isLoading, isFetching, error, refetch } = useStockHistory(
    ready ? activeFrom : '',
    ready ? activeTo : '',
    search,
  );

  const batches = data?.batches ?? [];
  const allItems = data?.allAddedItems ?? [];

  const toggleBatch = (batchId: string): void => {
    setExpandedBatches((prev) => ({
      ...prev,
      [batchId]: !prev[batchId],
    }));
  };

  const expandAll = (): void => {
    const next: Record<string, boolean> = {};
    for (const b of batches) next[b.id] = true;
    setExpandedBatches(next);
  };

  const collapseAll = (): void => {
    setExpandedBatches({});
  };

  const download = async (): Promise<void> => {
    if (!ready) {
      toast.error('Check the dates', rangeError);
      return;
    }
    if (batches.length === 0) {
      toast.error('Nothing to download', 'No stock additions found for this date/range.');
      return;
    }
    setDownloading(true);
    try {
      const queryParams = new URLSearchParams();
      if (activeFrom) queryParams.set('from', activeFrom);
      if (activeTo) queryParams.set('to', activeTo);
      if (search) queryParams.set('q', search);
      const query = queryParams.toString();
      await downloadProtectedFile(`/stock/history.xlsx${query ? `?${query}` : ''}`);
      toast.success(
        'Excel downloaded',
        `${plural(batches.length, 'batch')}, ${plural(data?.totalQuantity ?? 0, 'unit')} saved.`,
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

  return (
    <div className="space-y-3.5">
      {standalone ? (
        <PageHeader
          title="Stock History"
          subtitle={
            mode === 'all'
              ? 'All stock addition batches and items'
              : data
                ? `${data.from} to ${data.to}`
                : 'Pick a date or range'
          }
          back
          action={
            <Button
              className="gap-2"
              onClick={() => void download()}
              loading={downloading}
              loadingText="Preparing"
              disabled={!ready || batches.length === 0}
            >
              <Download className="h-4 w-4" />
              <span>Excel Export</span>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-1">
          <div>
            <h2 className="text-base font-black tracking-tight text-foreground sm:text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Stock Addition History
            </h2>
            <p className="text-xs text-muted-foreground">
              Track when, where, and which stock was added together with Stock Added IDs
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void download()}
            loading={downloading}
            loadingText="Preparing"
            disabled={!ready || batches.length === 0}
          >
            <Download className="h-4 w-4 text-primary" />
            <span className="font-bold">Export Excel</span>
          </Button>
        </div>
      )}

      {/* Date Filter Modes */}
      <div className="grid grid-cols-3 gap-2">
        <ModeButton
          active={mode === 'all'}
          onClick={() => setMode('all')}
          icon={Layers}
          label="All Time"
        />
        <ModeButton
          active={mode === 'day'}
          onClick={() => setMode('day')}
          icon={CalendarDays}
          label="One Date"
        />
        <ModeButton
          active={mode === 'range'}
          onClick={() => setMode('range')}
          icon={ListFilter}
          label="Date Range"
        />
      </div>

      {/* Date Pickers Card */}
      {mode !== 'all' ? (
        <Card>
          <CardContent className="pt-3 pb-3">
            {mode === 'day' ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="stock-history-day"
                  className="text-2xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Date
                </label>
                <input
                  id="stock-history-day"
                  name="stock-history-day"
                  type="date"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className="h-11 w-full rounded-xl border-2 border-input bg-background px-3 text-base"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="stock-history-from"
                    className="text-2xs font-bold uppercase tracking-wide text-muted-foreground"
                  >
                    From
                  </label>
                  <input
                    id="stock-history-from"
                    name="stock-history-from"
                    type="date"
                    value={from}
                    max={isRealDay(to) ? to : undefined}
                    onChange={(event) => setFrom(event.target.value)}
                    className="h-11 w-full rounded-xl border-2 border-input bg-background px-3 text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="stock-history-to"
                    className="text-2xs font-bold uppercase tracking-wide text-muted-foreground"
                  >
                    To
                  </label>
                  <input
                    id="stock-history-to"
                    name="stock-history-to"
                    type="date"
                    value={to}
                    min={isRealDay(from) ? from : undefined}
                    onChange={(event) => setTo(event.target.value)}
                    className="h-11 w-full rounded-xl border-2 border-input bg-background px-3 text-base"
                  />
                </div>
              </div>
            )}

            {rangeError ? (
              <p className="mt-2.5 flex items-center gap-1.5 text-sm font-bold text-destructive">
                <TriangleAlert className="h-4 w-4" /> {rangeError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Summary KPI Cards */}
      {ready && data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Stock Added Batches"
            value={String(data.totalBatches)}
            icon={Layers}
            sub="Events"
          />
          <StatCard
            label="Parts Added"
            value={String(data.totalItems)}
            icon={Package}
            sub="Distinct items"
          />
          <StatCard
            label="Units Added Together"
            value={String(data.totalQuantity)}
            icon={Boxes}
            sub="Total quantity"
          />
          <StatCard
            label="Stock Value Added"
            value={money(data.totalValue)}
            icon={Wallet}
            sub="Purchase cost"
            tone={data.totalValue > 0 ? 'success' : 'default'}
          />
        </div>
      ) : null}

      {/* Search Input & View Toggles */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="stock-history-search"
            name="stock-history-search"
            aria-label="Search stock addition history"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Stock Added ID (e.g. STK-ADD-0001), part, brand, supplier..."
            className="h-11 pl-10 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setViewType('batches')}
            className={cn(
              'px-3 py-2 text-xs font-bold rounded-lg border transition-colors',
              viewType === 'batches'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground',
            )}
          >
            Batches View
          </button>
          <button
            type="button"
            onClick={() => setViewType('items')}
            className={cn(
              'px-3 py-2 text-xs font-bold rounded-lg border transition-colors',
              viewType === 'items'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground',
            )}
          >
            All Items View ({allItems.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {rangeError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Pick a valid date"
          description={rangeError}
        />
      ) : error && !data ? (
        <ErrorBlock message={error.message} onRetry={() => void refetch()} />
      ) : isLoading && !data ? (
        <LoadingBlock label="Loading stock history..." />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No stock additions found"
          description={
            search
              ? 'No additions matched your search filter.'
              : 'Add stock from the Stock In or Add / Import tab.'
          }
        />
      ) : (
        <>
          {isFetching ? (
            <p className="text-2xs text-muted-foreground">Updating data...</p>
          ) : null}

          {viewType === 'batches' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  Showing {plural(batches.length, 'addition batch')} ({plural(allItems.length, 'part addition')})
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={expandAll}
                    className="text-primary hover:underline font-semibold"
                  >
                    Expand All
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="text-primary hover:underline font-semibold"
                  >
                    Collapse All
                  </button>
                </div>
              </div>

              {batches.map((batch) => {
                const expanded = Boolean(expandedBatches[batch.id]);
                return (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    expanded={expanded}
                    onToggle={() => toggleBatch(batch.id)}
                  />
                );
              })}
            </div>
          ) : (
            /* Flat Items View */
            <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-secondary/80 backdrop-blur border-b">
                  <tr>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Stock Added ID</th>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Date & Time</th>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Item Name</th>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Brand / Model</th>
                    <th className="px-3 py-2.5 font-bold text-center text-muted-foreground">Added Qty</th>
                    <th className="px-3 py-2.5 font-bold text-center text-muted-foreground">Stock After</th>
                    <th className="px-3 py-2.5 font-bold text-right text-muted-foreground">Cost</th>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Added By</th>
                    <th className="px-3 py-2.5 font-bold text-muted-foreground">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allItems.map((it, idx) => (
                    <tr key={`${it.movementId}_${idx}`} className="hover:bg-muted/40 transition-colors">
                      <td className="px-3 py-2.5 font-mono font-bold text-primary whitespace-nowrap">
                        {it.stockAddedId}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(it.date)}
                      </td>
                      <td className="px-3 py-2.5 font-bold text-foreground">
                        <Link to={`/parts/${it.partId}`} className="hover:underline hover:text-primary">
                          {it.partName}
                        </Link>
                        {it.category ? (
                          <span className="block text-[10px] text-muted-foreground">{it.category}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {[it.brand, it.model].filter(Boolean).join(' ') || '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-black text-success">
                          +{it.quantityAdded}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold">
                        {it.balanceAfter} pcs
                      </td>
                      <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                        {it.purchaseCost > 0 ? money(it.purchaseCost) : '₹0'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {it.user}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold">
                          {it.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Clean, structured Batch Card representing one Stock Addition Event.
 */
function BatchCard({
  batch,
  expanded,
  onToggle,
}: {
  batch: StockAddedBatch;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Card className="overflow-hidden border-2 transition-all shadow-xs">
      <CardContent className="p-0">
        {/* Header Bar */}
        <div
          onClick={onToggle}
          className="flex flex-col gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-0.5 font-mono text-xs font-black text-primary tracking-wide">
                {batch.id}
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-2xs font-semibold text-secondary-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" /> {batch.reason}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-2xs font-semibold text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> {batch.user}
              </span>
              {batch.supplierName ? (
                <span className="rounded-full bg-primary/5 px-2.5 py-0.5 text-2xs font-semibold text-primary flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {batch.supplierName}
                </span>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground pt-0.5">
              Added on <span className="font-semibold text-foreground">{formatDateTime(batch.date)}</span>
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0">
            {/* Quick Metrics */}
            <div className="flex items-center gap-3 text-right">
              <div className="text-center sm:text-right">
                <p className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Parts</p>
                <p className="text-sm font-black">{batch.totalItems} items</p>
              </div>
              <div className="text-center sm:text-right">
                <p className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Total Units</p>
                <p className="text-sm font-black text-success">+{batch.totalQuantity} pcs</p>
              </div>
              {batch.totalValue > 0 ? (
                <div className="text-center sm:text-right">
                  <p className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Value</p>
                  <p className="text-sm font-black">{money(batch.totalValue)}</p>
                </div>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="gap-1 font-bold text-xs"
            >
              {expanded ? (
                <>
                  <span>Hide Items</span>
                  <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span>View Items ({batch.items.length})</span>
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Expandable Items List */}
        {expanded ? (
          <div className="border-t bg-muted/20 p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                Stock Breakdown for {batch.id} ({batch.items.length} parts added together)
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-secondary/60 border-b">
                  <tr>
                    <th className="px-3 py-2 font-bold text-muted-foreground">Item Name</th>
                    <th className="px-3 py-2 font-bold text-muted-foreground">Brand / Model</th>
                    <th className="px-3 py-2 font-bold text-muted-foreground">Category</th>
                    <th className="px-3 py-2 font-bold text-center text-muted-foreground">Added</th>
                    <th className="px-3 py-2 font-bold text-center text-muted-foreground">Stock After</th>
                    <th className="px-3 py-2 font-bold text-right text-muted-foreground">Unit Cost</th>
                    <th className="px-3 py-2 font-bold text-right text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batch.items.map((it) => (
                    <tr key={it.movementId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-bold text-foreground">
                        <Link to={`/parts/${it.partId}`} className="hover:underline hover:text-primary">
                          {it.partName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[it.brand, it.model].filter(Boolean).join(' ') || '-'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {it.category || 'Repair Part'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-black text-success">
                          +{it.quantityAdded}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-muted-foreground">
                        {it.balanceAfter} pcs
                      </td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">
                        {it.purchaseCost > 0 ? money(it.purchaseCost) : '₹0'}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-bold text-foreground">
                        {it.totalCost > 0 ? money(it.totalCost) : '₹0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  icon: typeof Package;
  sub?: string;
  tone?: 'default' | 'success';
}): JSX.Element {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-2xs">
      <div className="flex items-center justify-between gap-1">
        <p className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4', tone === 'success' ? 'text-success' : 'text-primary')} />
      </div>
      <p
        className={cn(
          'tabular mt-1 text-lg font-black leading-none',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-[10px] text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof CalendarDays;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 text-xs sm:text-sm font-bold transition-colors',
        active ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

export default function StockHistory(): JSX.Element {
  return <StockHistorySection standalone />;
}
