import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  ExternalLink,
  Laptop,
  Pencil,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import {
  getDeviceId,
  getDeviceName,
  setDeviceName,
  useDeviceLogs,
} from '@/lib/device-log';
import { timeAgo, dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DeviceLogSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const { data: logs = [], isLoading } = useDeviceLogs();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'NEW' | 'EDIT' | 'STATUS' | 'LOGIN'>('ALL');

  const [editingDevice, setEditingDevice] = useState(false);
  const [customNameInput, setCustomNameInput] = useState('');

  const currentDevId = getDeviceId();
  const [currentDevName, setCurrentDevName] = useState(getDeviceName());

  const handleSaveDeviceName = (): void => {
    if (customNameInput.trim()) {
      const updated = setDeviceName(customNameInput.trim());
      setCurrentDevName(updated);
    }
    setEditingDevice(false);
  };

  // Dedicated in-section search and filter (no extra data queried)
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (filterType === 'NEW') {
      result = result.filter((l) => l.action === 'NEW_BILL');
    } else if (filterType === 'EDIT') {
      result = result.filter((l) => l.action === 'EDIT_BILL');
    } else if (filterType === 'STATUS') {
      result = result.filter((l) => l.action === 'STATUS');
    } else if (filterType === 'LOGIN') {
      result = result.filter((l) => l.action === 'LOGIN');
    }

    if (!searchQuery.trim()) return result;

    const q = searchQuery.toLowerCase().trim();
    return result.filter(
      (l) =>
        (l.orderId && l.orderId.toLowerCase().includes(q)) ||
        (l.devId && l.devId.toLowerCase().includes(q)) ||
        (l.devName && l.devName.toLowerCase().includes(q)) ||
        (l.tag && l.tag.toLowerCase().includes(q)) ||
        (l.user && l.user.toLowerCase().includes(q)),
    );
  }, [logs, searchQuery, filterType]);

  const handleOpenOrder = (orderId: string): void => {
    onOpenChange(false);
    navigate(`/orders/${orderId}`);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Device & Edit History"
      description="Track which device created or modified each bill."
      className="sm:max-w-md"
    >
      <div className="space-y-3 pb-3">
        {/* Current Device Identification Card */}
        <div className="rounded-xl border bg-secondary/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              {currentDevName.toLowerCase().includes('phone') || currentDevName.toLowerCase().includes('android') ? (
                <Smartphone className="h-4 w-4 text-primary" />
              ) : (
                <Laptop className="h-4 w-4 text-primary" />
              )}
              <span>This Device:</span>
              <span className="font-extrabold text-primary">{currentDevName}</span>
            </div>
            <span className="font-mono text-2xs font-bold bg-background px-2 py-0.5 rounded border text-muted-foreground">
              {currentDevId}
            </span>
          </div>

          {editingDevice ? (
            <div className="flex items-center gap-1.5 pt-1">
              <Input
                id="device-custom-name"
                name="device-custom-name"
                value={customNameInput}
                onChange={(e) => setCustomNameInput(e.target.value)}
                placeholder="e.g. Counter PC, Mobile..."
                className="h-8 text-xs"
                autoFocus
              />
              <Button size="sm" onClick={handleSaveDeviceName} className="h-8 text-xs font-bold">
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingDevice(false)}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between text-2xs text-muted-foreground pt-0.5">
              <span>All creations & edits from this browser are tagged with this ID.</span>
              <button
                type="button"
                onClick={() => {
                  setCustomNameInput(currentDevName);
                  setEditingDevice(true);
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
              >
                <Pencil className="h-3 w-3" /> Rename
              </button>
            </div>
          )}
        </div>

        {/* Section Search Button & Controls */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant={searchOpen ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setSearchOpen((prev) => !prev);
                if (searchOpen) setSearchQuery('');
              }}
              className="gap-1.5 text-xs font-bold"
            >
              <Search className="h-3.5 w-3.5" />
              {searchOpen ? 'Hide Search' : 'Search Logs'}
            </Button>

            <span className="text-2xs text-muted-foreground font-semibold">
              {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {/* Search Input Filter for This Section Only */}
          {searchOpen ? (
            <div className="relative">
              <Input
                id="device-log-search"
                name="device-log-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Order ID (e.g. JMR-0016), Device, Tag..."
                className="h-9 pr-8 text-xs"
                autoFocus
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1 text-2xs font-bold">
            {(
              [
                ['ALL', 'All'],
                ['NEW', '+ New Bills'],
                ['EDIT', '✎ Modified'],
                ['STATUS', 'Status'],
                ['LOGIN', 'Logins'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterType(key)}
                className={cn(
                  'rounded-lg px-2.5 py-1 transition-all',
                  filterType === key
                    ? 'bg-primary text-primary-foreground shadow-2xs font-extrabold'
                    : 'bg-muted/70 text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Logs List (Ultra-lean and compact) */}
        <div className="space-y-2 max-h-[60dvh] overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground font-medium">Loading history...</p>
          ) : filteredLogs.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <EmptyState icon={Clock} title="No logs found" />
              {searchQuery ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSearchQuery('')}
                  className="text-xs"
                >
                  Clear search query
                </Button>
              ) : null}
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isCurrentDev = log.devId === currentDevId;
              const hasOrder = Boolean(log.orderId);

              return (
                <div
                  key={log.id}
                  className="rounded-xl border bg-card p-2.5 text-xs shadow-2xs space-y-1.5 transition-colors hover:border-primary/40"
                >
                  {/* Top Line: Device Name & ID + Time */}
                  <div className="flex items-center justify-between gap-1 text-2xs">
                    <div className="flex items-center gap-1.5 min-w-0 font-bold truncate">
                      <span className="truncate text-foreground/90">{log.devName}</span>
                      <span
                        className={cn(
                          'font-mono px-1.5 py-0.2 rounded text-[10px] shrink-0 font-bold',
                          isCurrentDev
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {log.devId}
                      </span>
                    </div>

                    <span className="text-muted-foreground shrink-0 tabular" title={dateTime(log.ts)}>
                      {timeAgo(log.ts)}
                    </span>
                  </div>

                  {/* Bottom Line: Action Tag & Target Order ID */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      {log.action === 'NEW_BILL' ? (
                        <Badge variant="success" className="text-2xs font-black">
                          + New Bill Added
                        </Badge>
                      ) : log.action === 'EDIT_BILL' ? (
                        <Badge variant="info" className="text-2xs font-black">
                          ✎ Bill Modified
                        </Badge>
                      ) : log.action === 'STATUS' ? (
                        <Badge variant="warning" className="text-2xs font-black">
                          {log.tag}
                        </Badge>
                      ) : log.action === 'LOGIN' ? (
                        <Badge variant="secondary" className="text-2xs font-semibold">
                          🔑 Session Login
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-2xs font-semibold">
                          {log.tag}
                        </Badge>
                      )}

                      {log.detail ? (
                        <span className="text-2xs text-muted-foreground truncate max-w-[140px]">
                          {log.detail}
                        </span>
                      ) : null}
                    </div>

                    {hasOrder && log.orderId ? (
                      <button
                        type="button"
                        onClick={() => handleOpenOrder(log.orderId!)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary px-2 py-0.5 font-mono text-xs font-black transition-colors"
                        title={`View bill ${log.orderId}`}
                      >
                        <span>{log.orderId}</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Memory Footer */}
        <p className="text-center text-[10px] text-muted-foreground/80 font-semibold pt-1">
          Ultra-low memory storage · Auto-trimmed to 200 events
        </p>
      </div>
    </Sheet>
  );
}
