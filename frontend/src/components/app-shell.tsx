import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  MoreVertical,
  Package,
  PackageMinus,
  PackagePlus,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useSettings, type SupabaseSyncResponse } from '@/hooks/use-queries';
import { useTheme } from '@/lib/theme';
import { useStockAccess } from '@/lib/stock-access';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { DeviceLogSheet } from '@/components/device-log-sheet';

/** The app has exactly two areas. Nothing sits outside them. */
export type SideKey = 'billing' | 'stock';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  /** Shown in the phone bottom bar. */
  primary?: boolean;
}

export const SIDES: Record<
  SideKey,
  { title: string; short: string; accent: string; items: NavItem[] }
> = {
  billing: {
    title: 'JMR — BILLING',
    short: 'Billing',
    accent: 'bg-primary',
    items: [
      { to: '/', label: 'Home', short: 'Home', icon: LayoutDashboard, end: true, primary: true },
      { to: '/new', label: 'New Bill', short: 'New', icon: PlusCircle, primary: true },
      { to: '/orders', label: 'All Bills / Orders', short: 'Bills', icon: ClipboardList, primary: true },
      { to: '/search', label: 'Search Order', short: 'Search', icon: Search },
      { to: '/customers', label: 'Customers', short: 'Customers', icon: Users },
    ],
  },
  stock: {
    title: 'JMR — STOCK',
    short: 'Stock',
    accent: 'bg-success',
    items: [
      { to: '/stock', label: 'Stock Home', short: 'Home', icon: Package, end: true, primary: true },
      { to: '/stock-history', label: 'Stock History', short: 'History', icon: History, primary: true },
      { to: '/stock/import', label: 'Add / Import Stock', short: 'Add/Import', icon: PackagePlus, primary: true },
      { to: '/stock/settings', label: 'Stock Settings', short: 'Setting', icon: Settings, primary: true },
    ],
  },
};

/**
 * The shop's mark, shown in the sidebar open or closed. The full shop name is
 * long and the sidebar is a rail for getting around, not for reading the name -
 * the phone header, which has room for it, is where the name belongs.
 */
const LOGO = 'JMR';

/** Which area a path belongs to - drives the accent colour and the menu. */
export function sideForPath(pathname: string): SideKey {
  if (pathname.startsWith('/stock') || pathname.startsWith('/parts')) return 'stock';
  return 'billing';
}

function SideSwitcher({
  side,
  onChange,
}: {
  side: SideKey;
  onChange: (side: SideKey) => void;
}): JSX.Element {
  return (
    <div className="flex rounded-xl bg-secondary p-1">
      {(Object.keys(SIDES) as SideKey[]).map((key) => {
        const active = key === side;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-colors sm:text-sm',
              active
                ? key === 'billing'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-success text-success-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            {key === 'billing' ? (
              <ClipboardList className="h-4 w-4" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            {SIDES[key].short}
          </button>
        );
      })}
    </div>
  );
}

function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className="shrink-0"
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

/**
 * The three-dot menu. It replaced the sign out button that used to sit in the
 * header, so the two things a person rarely does no longer take up space next
 * to the things they do all day. Logout is last on purpose.
 */
function MenuItems({
  onSignOut,
  onPick,
  side,
  onSideChange,
  onOpenLogs,
}: {
  onSignOut: () => void;
  onPick: (to: string) => void;
  side?: SideKey;
  onSideChange?: (s: SideKey) => void;
  onOpenLogs?: () => void;
}): JSX.Element {
  const [activeSection, setActiveSection] = useState<'billing' | 'stock'>(
    side === 'stock' ? 'stock' : 'billing',
  );
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    toast.info('Syncing with Supabase...', 'Restoring bills and updating cloud backup.');
    try {
      const res = await api.post<SupabaseSyncResponse>('/supabase/sync');
      await queryClient.invalidateQueries();
      toast.success(
        'Supabase sync complete',
        `${res.data.ordersCount} bills, ${res.data.partsCount} stock items verified and up to date.`,
      );
    } catch (err) {
      toast.error('Sync failed', err instanceof Error ? err.message : 'Please check internet and try again.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* 2-Button Segmented Selector: Left = Bill, Right = Stock */}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/70 p-1">
        <button
          type="button"
          onClick={() => {
            setActiveSection('billing');
            onSideChange?.('billing');
          }}
          className={cn(
            'flex min-h-[42px] items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all sm:text-sm',
            activeSection === 'billing'
              ? 'bg-primary text-primary-foreground font-black shadow-sm'
              : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
          )}
        >
          <ClipboardList className="h-4 w-4 shrink-0" />
          <span>Bill</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSection('stock');
            onSideChange?.('stock');
          }}
          className={cn(
            'flex min-h-[42px] items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all sm:text-sm',
            activeSection === 'stock'
              ? 'bg-success text-success-foreground font-black shadow-sm'
              : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
          )}
        >
          <Package className="h-4 w-4 shrink-0" />
          <span>Stock</span>
        </button>
      </div>

      {/* Button-styled option cards */}
      {activeSection === 'billing' ? (
        <div className="space-y-1.5 pt-1">
          <MenuItem
            icon={ClipboardList}
            label="Bill History"
            onClick={() => onPick('/bill-history')}
          />
          <MenuItem
            icon={Users}
            label="Customers"
            onClick={() => onPick('/customers')}
          />
        </div>
      ) : (
        <div className="space-y-1.5 pt-1">
          <MenuItem
            icon={History}
            label="Stock History"
            onClick={() => onPick('/stock-history')}
          />
          <MenuItem
            icon={Package}
            label="All Items"
            onClick={() => onPick('/stock')}
          />
          <MenuItem
            icon={AlertTriangle}
            label="Low Stock"
            onClick={() => onPick('/stock?tab=low')}
          />
          <MenuItem
            icon={PackagePlus}
            label="Stock In"
            onClick={() => onPick('/stock?tab=in')}
          />
          <MenuItem
            icon={PackageMinus}
            label="Stock Out"
            onClick={() => onPick('/stock?tab=out')}
          />
          <MenuItem
            icon={Building2}
            label="Suppliers"
            onClick={() => onPick('/stock?tab=suppliers')}
          />
        </div>
      )}

      {/* Common actions for BOTH Bill and Stock */}
      <div className="space-y-1.5 border-t pt-2">
        <MenuItem
          icon={RefreshCw}
          label={syncing ? 'Syncing Supabase...' : 'Sync with Supabase'}
          spinning={syncing}
          onClick={() => void handleSync()}
        />
        {onOpenLogs ? (
          <MenuItem
            icon={History}
            label="Log / Edit History"
            onClick={onOpenLogs}
          />
        ) : null}
        <MenuItem
          icon={LogOut}
          label="Logout"
          onClick={onSignOut}
          tone="destructive"
        />
      </div>
    </div>
  );
}

function MoreTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onToggle}
      aria-label="More options"
      aria-haspopup="menu"
      aria-expanded={open}
      title="More options"
      className="bg-card"
    >
      <MoreVertical className="h-5 w-5" />
    </Button>
  );
}

/**
 * The header three-dot menu. It opens as a page view over the whole screen, so
 * nothing behind it can be reached by accident while it is up. This is where you
 * sign out, and a stray tap must never land on a half typed bill. It reuses the
 * modal every other pick-something flow uses, which is also what gives it the
 * dimmed screen and the tap-anywhere-to-close.
 */
function HeaderMenu({
  onSignOut,
  side,
  onSideChange,
  onOpenLogs,
}: {
  onSignOut: () => void;
  side: SideKey;
  onSideChange: (s: SideKey) => void;
  onOpenLogs: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <MoreTrigger open={open} onToggle={() => setOpen((value) => !value)} />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Menu"
        description="Switch area, bill history, customers, and signing out."
        className="sm:max-w-sm"
      >
        <div className="pb-2">
          <MenuItems
            onSignOut={onSignOut}
            side={side}
            onSideChange={(s) => { setOpen(false); onSideChange(s); }}
            onOpenLogs={() => { setOpen(false); onOpenLogs(); }}
            onPick={(to) => {
              setOpen(false);
              navigate(to);
            }}
          />
        </div>
      </Sheet>
    </>
  );
}

/**
 * The foot of the sidebar: theme, three-dot menu, collapse. The panel is
 * anchored to this whole block instead of to its own 40px button, so an open
 * sidebar gets a panel exactly as wide as the sidebar and a collapsed one gets a
 * panel beside it. Either way it opens upward, clear of the three buttons.
 */
function SidebarFooter({
  collapsed,
  userName,
  onToggleCollapsed,
  onSignOut,
  onOpenLogs,
}: {
  collapsed: boolean;
  userName?: string;
  onToggleCollapsed: () => void;
  onSignOut: () => void;
  onOpenLogs: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

  // The panel floats over the nav rather than behind a full screen overlay, so
  // the tap outside it has to be caught by hand.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (blockRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    // Collapsed, the column is 76px wide. With p-3 that leaves 52px of usable
    // width, and a 48px control has almost no room to be centred - which is how
    // the three controls ended up hanging outside the sidebar. px-2 and
    // items-center give 60px, so each 48px control sits properly inside.
    <div className={cn('space-y-2 border-t p-3', collapsed && 'flex items-center px-2')}>
      <div ref={blockRef} className="relative w-full">
        {open ? (
          <div
            role="menu"
            aria-label="More options"
            className={cn(
              'absolute z-50 mb-2 overflow-hidden rounded-xl border bg-card p-1 shadow-lg',
              collapsed ? 'bottom-full left-full ml-2 w-56' : 'bottom-full left-0 right-0',
            )}
          >
            <MenuItems
              onSignOut={onSignOut}
              onOpenLogs={() => {
                setOpen(false);
                onOpenLogs();
              }}
              onPick={(to) => {
                setOpen(false);
                navigate(to);
              }}
            />
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-center gap-2',
            // Stacked when collapsed, because three 48px controls are 160px in a
            // row and the column is 76px. A block row shrink-wraps to the
            // sidebar and the fixed-width controls then overflow it; a full-width
            // column stacks them instead, and each one fits on its own line.
            collapsed && 'w-full flex-col justify-center gap-1.5',
          )}
        >
          <ThemeToggle />
          <MoreTrigger open={open} onToggle={() => setOpen((value) => !value)} />
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            className="shrink-0"
          >
            <ChevronLeft className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>
      </div>
      {collapsed || !userName ? null : (
        <div className="px-1">
          <p className="truncate text-sm font-bold">{userName}</p>
          <p className="text-xs text-muted-foreground">Signed in</p>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  spinning = false,
}: {
  icon: typeof ClipboardList;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'destructive';
  spinning?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 text-left text-sm font-semibold transition-all hover:bg-secondary/70 active:scale-[0.98]',
        tone === 'destructive'
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
          : 'text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', spinning && 'animate-spin')} />
      <span className="flex-1">{label}</span>
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { user, signOut } = useAuth();
  const { data: settings } = useSettings();
  const { lock } = useStockAccess();
  const location = useLocation();
  const navigate = useNavigate();
  const pathSide = sideForPath(location.pathname);
  const [side, setSide] = useState<SideKey>(pathSide);
  const [collapsed, setCollapsed] = useState(false);
  const [logSheetOpen, setLogSheetOpen] = useState(false);

  const activeSide = pathSide !== side ? pathSide : side;
  const items = SIDES[activeSide].items;
  const primary = items.filter((item) => item.primary);
  const shopName = settings?.shopName?.trim() || 'Jai Mataji Mobile Repairing';

  // Never leave the Stock area open behind a later sign in.
  useEffect(() => {
    if (!user) lock();
  }, [user, lock]);

  const handleSideChange = (next: SideKey): void => {
    setSide(next);
    navigate(next === 'billing' ? '/' : '/stock');
  };

  const handleSignOut = (): void => {
    lock();
    signOut();
  };

  return (
    <div className="flex min-h-dvh bg-muted/40">
      {/* Desktop sidebar - collapses to icons so the bill list gets more room. */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card transition-[width] duration-200 md:flex',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <div className={cn('border-b p-4', collapsed && 'px-2 text-center')}>
          {collapsed ? (
            <p className="text-lg font-black leading-none text-primary">{LOGO}</p>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {SIDES[activeSide].title}
              </p>
              <p className="truncate text-lg font-black leading-tight" title={LOGO}>
                {LOGO}
              </p>
            </>
          )}
        </div>

        {!collapsed ? (
          <div className="p-3">
            <SideSwitcher side={activeSide} onChange={handleSideChange} />
          </div>
        ) : null}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {!collapsed ? (
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {SIDES[activeSide].title}
            </p>
          ) : null}
          {items.map((item) => (
            <SideLink key={item.to} item={item} accent={SIDES[activeSide].accent} collapsed={collapsed} />
          ))}
        </nav>

        {/*
          * Three 48px controls will not fit side by side in the 76px collapsed
          * column, so they stack there and sit in a row when it is open. The
          * sidebar is already hidden below md, so no breakpoint class is needed
          * on the controls themselves. The three-dot panel is anchored to this
          * block, so it opens upward over the nav and never onto the controls.
         */}
        <SidebarFooter
          collapsed={collapsed}
          userName={user?.name}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onSignOut={handleSignOut}
          onOpenLogs={() => setLogSheetOpen(true)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone header */}
        <header className="safe-top sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {SIDES[activeSide].title}
              </p>
              {/* The one animated thing in the app: the shop name the header is
                  built around, breathing continuously while the app is open. */}
              <p className="animate-shop-mark truncate text-base font-black leading-tight" title={shopName}>
                {shopName}
              </p>
            </div>
            <ThemeToggle />
            {/* <HeaderMenu onSignOut={handleSignOut} /> */}
            <HeaderMenu
              onSignOut={handleSignOut}
              side={activeSide}
              onSideChange={handleSideChange}
              onOpenLogs={() => setLogSheetOpen(true)}
            />
          </div>

        </header>

        <main className="flex-1 px-3 pb-28 pt-3 md:px-5 md:pb-8 md:pt-5">{children}</main>

        {/*
          * Phone bottom bar. There is no "More" button here any more: the
          * three-dot menu in the header already holds everything that used to
          * sit behind it, so a second way in was one more tap for nothing.
         */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t bg-card/97 backdrop-blur md:hidden">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}>
            {primary.map((item) => (
              <BottomLink key={item.to} item={item} accent={SIDES[activeSide].accent} />
            ))}
          </div>
        </nav>
      </div>

      <DeviceLogSheet open={logSheetOpen} onOpenChange={setLogSheetOpen} />
    </div>
  );
}

function SideLink({
  item,
  accent,
  collapsed,
}: {
  item: NavItem;
  accent: string;
  collapsed: boolean;
}): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? `${accent} text-white shadow-sm` : 'text-foreground hover:bg-secondary',
        )
      }
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {collapsed ? null : item.label}
    </NavLink>
  );
}

function BottomLink({ item, accent }: { item: NavItem; accent: string }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors',
          isActive ? accent + ' text-white' : 'text-muted-foreground',
        )
      }
    >
      <item.icon className="h-5 w-5" />
      {item.short}
    </NavLink>
  );
}

/** Header used at the top of every screen. */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
  center = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: boolean;
  /** Centres the title and subtitle instead of lining them up on the left. */
  center?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    // On a narrow screen a head-wide action (buttons plus a status pill, say)
    // would squeeze the title to nothing, so the text keeps a floor width and a
    // wide action wraps onto its own row, pushed to the right. A compact action
    // that fits stays on the same line as before.
    <div className="mb-3 flex flex-wrap items-start gap-2">
      {back ? (
        <Button
          variant="outline"
          size="icon"
          aria-label="Go back"
          onClick={() => navigate(-1)}
          className="shrink-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      ) : null}
      <div className={cn('min-w-[9rem] flex-1 sm:min-w-0', center && 'text-center')}>
        <h1 className="truncate text-xl font-black leading-tight tracking-tight md:text-2xl">
          {title}
        </h1>
        {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  );
}

/** Prompt shown when a screen needs a search bar. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        name="search"
        aria-label={placeholder}
        autoComplete="off"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border-2 border-input bg-background pl-11 pr-10 text-base focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Big filter chips used above every list. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 py-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 text-sm font-bold transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-2xs font-bold',
                  active ? 'bg-white/25' : 'bg-muted text-muted-foreground',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Small labelled number used by the stock summary strip. */
export function MiniStat({
  label,
  value,
  tone = 'default',
  icon: Icon,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  icon?: typeof Package;
}): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3',
        tone === 'success' && 'border-success/40',
        tone === 'warning' && 'border-warning/40',
        tone === 'destructive' && 'border-destructive/40',
      )}
    >
      <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1.5 text-xl font-black leading-none',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning-foreground',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Section wrapper used by the single page Stock Desktop. */
export function SectionCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: typeof Building2;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('rounded-2xl border bg-card shadow-sm', className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-black leading-tight">
          {Icon ? <Icon className="h-5 w-5 text-success" /> : null}
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
