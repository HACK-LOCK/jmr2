import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Spinner } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { useState, type FormEvent } from 'react';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const NewBill = lazy(() => import('@/pages/NewBill'));
const Orders = lazy(() => import('@/pages/Orders'));
const OrderDetail = lazy(() => import('@/pages/OrderDetail'));
const BillHistory = lazy(() => import('@/pages/BillHistory'));
const Customers = lazy(() => import('@/pages/Customers'));
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const StockDesktop = lazy(() => import('@/pages/StockDesktop'));
const StockHistory = lazy(() => import('@/pages/StockHistory'));
const PartDetailPage = lazy(() => import('@/pages/PartDetailPage'));

function FullScreenLoader(): JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

/** One sign-in screen for the whole app - no per-page auth handling. */
function SignInGate(): JSX.Element {
  const { signIn } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(username.trim(), password);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not sign in.';
      setError(message);
      toast.error('Sign in failed', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-gradient-to-b from-primary/10 via-background to-background px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground shadow-lg">
            JM
          </div>
          <h1 className="text-2xl font-black leading-tight">Jai Mataji Mobile Repairing</h1>
          <p className="text-sm text-muted-foreground">Sign in to open the shop app</p>
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <Field label="Username" htmlFor="username">
            <Input
              id="username"
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="ashok"
              className="h-14"
            />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              className="h-14"
              invalid={Boolean(error)}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy} loadingText="Signing in...">
            Sign In
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Need an account? Ask at the counter.
        </p>
      </div>
    </div>
  );
}

export default function App(): JSX.Element {
  const { user, ready } = useAuth();

  if (!ready) return <FullScreenLoader />;
  if (!user) return <SignInGate />;

  return (
    <AppShell>
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          {/* JMR - BILLING */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewBill />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/bill-history" element={<BillHistory />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/search" element={<SearchPage />} />

          {/* JMR - STOCK */}
          <Route path="/stock" element={<StockDesktop />} />
          <Route path="/stock-history" element={<StockHistory />} />
          <Route path="/stock/import" element={<StockDesktop mode="import" />} />
          <Route path="/stock/settings" element={<StockDesktop mode="settings" />} />
          <Route path="/parts/:id" element={<PartDetailPage />} />

          {/* Old links keep working and land on the right new screen. */}
          <Route path="/stock/history" element={<Navigate to="/stock?tab=history" replace />} />
          <Route path="/repair/new" element={<Navigate to="/new" replace />} />
          <Route path="/billing" element={<Navigate to="/new" replace />} />
          <Route path="/pickup" element={<Navigate to="/orders?scope=active" replace />} />
          <Route path="/parts" element={<Navigate to="/stock?tab=items" replace />} />
          <Route path="/stock/in" element={<Navigate to="/stock?tab=in" replace />} />
          <Route path="/stock/out" element={<Navigate to="/stock?tab=out" replace />} />
          <Route path="/suppliers" element={<Navigate to="/stock?tab=suppliers" replace />} />
          <Route path="/sync" element={<Navigate to="/stock?tab=sync" replace />} />
          <Route path="/settings" element={<Navigate to="/stock/settings" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
