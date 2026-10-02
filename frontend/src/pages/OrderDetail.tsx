import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Banknote,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FileText,
  History,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Printer,
  Trash2,
  Truck,
  Wallet,
  Wrench,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import {
  COUNTER_STATUSES,
  DEVICE_CONDITIONS,
  DEVICE_TYPES,
  PAYMENT_MODES,
  type OrderStatus,
  round2,
} from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea, numberPad } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
  import { Select } from '@/components/ui/select';
import { ProblemField } from '@/components/problem-field';
import { BrandField, ModelField } from '@/components/device-fields';
import { ErrorBlock, InlineNotice, LoadingBlock } from '@/components/ui/feedback';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { PaymentBadge, StatusBadge } from '@/components/status-badge';
import { ContactActions } from '@/components/contact-actions';
import { api, openProtectedFile } from '@/lib/api';
import {
  useAddOrderPart,
  useChangeStatus,
  useDeleteOrderPart,
  useDeletePayment,
  useDeliverOrder,
  useOrder,
  useParts,
  useRecordPayment,
  useUpdateOrder,
  useUpdatePayment,
} from '@/hooks/use-queries';
import { useDebounced } from '@/lib/hooks';
import { dateOnly, dateTime, deviceLabel, money } from '@/lib/format';
import type { PartListItem } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function OrderDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: order, isLoading, error, refetch } = useOrder(id);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [totalOpen, setTotalOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const changeStatus = useChangeStatus(id ?? '');
  const deliver = useDeliverOrder(id ?? '');
  const addPart = useAddOrderPart(id ?? '');
  const deletePart = useDeleteOrderPart(id ?? '');
  const removePayment = useDeletePayment(id ?? '');
  const recordPayment = useRecordPayment(id ?? '');
  const updatePayment = useUpdatePayment(id ?? '');
  const update = useUpdateOrder(id ?? '');

  if (isLoading && !order) return <LoadingBlock label="Loading bill..." />;
  if (error && !order) {
    return (
      <ErrorBlock
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!order) return <ErrorBlock message="Bill not found." />;

  const closed = order.status === 'Delivered' || order.status === 'Cancelled' || order.status === 'Unable to Repair';
  const cancelled = order.status === 'Cancelled';
  // What the parts fitted to this job add up to. The server will not let the
  // bill be priced under it, so the total sheet needs it to say so up front.
  const partsTotal = round2(
    order.parts.reduce((sum, line) => sum + round2(line.quantity * line.unitPrice), 0),
  );

  const pickStatus = async (status: OrderStatus): Promise<void> => {
    try {
      const response = await changeStatus.mutateAsync(status);
      if (response.warning) toast.warning(response.warning.message);
      else toast.success(`Marked as ${status}`);
    } catch (caught) {
      toast.error('Could not change status', caught instanceof Error ? caught.message : undefined);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={order.customerName}
        subtitle={`${order.id} · ${order.mobile} · ${deviceLabel(order.brand, order.model, order.deviceType)}`}
        back
        action={
          <div className="flex items-center gap-1.5 shrink-0">
            <ContactActions order={order} size="sm" iconOnly />
            <StatusBadge status={order.status} size="lg" />
          </div>
        }
      />

      {order.pendingSync ? (
        <InlineNotice tone="warning">
          This bill is saved on the device but is not yet in Google Sheets. It will go up
          automatically, or you can retry from Sheet Sync.
        </InlineNotice>
      ) : null}

      {/* Money summary. These three figures are how the money on a bill is
          changed: tap the total to re-price the job, tap what was paid to take
          or correct a payment. They are the numbers the counter is already
          looking at, so they are the buttons - a separate row of money buttons
          would be one more place for the same figure to be edited from, and the
          two would drift apart.
          A cancelled bill keeps what was paid on it, so the last figure is the
          money going back rather than a balance still to collect - the server
          refuses payments on a cancelled bill, so offering to take one would be
          a button that always fails. */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <MoneyCell
              label="Total"
              value={money(order.finalAmount)}
              actionLabel={closed ? undefined : 'Change total'}
              onClick={closed ? undefined : () => setTotalOpen(true)}
            />
            <MoneyCell
              label={cancelled ? 'Received' : 'Paid'}
              value={money(order.paidAmount)}
              tone="success"
              actionLabel={cancelled ? undefined : 'Take or change'}
              onClick={cancelled ? undefined : () => setPaymentOpen(true)}
            />
            <MoneyCell
              label={cancelled ? 'To return' : 'Balance'}
              value={money(cancelled ? order.paidAmount : order.balance)}
              tone={cancelled ? 'destructive' : order.balance > 0 ? 'destructive' : 'success'}
              actionLabel={cancelled || order.balance <= 0 ? undefined : 'Collect'}
              onClick={cancelled || order.balance <= 0 ? undefined : () => setPaymentOpen(true)}
            />
          </div>
          {order.discount > 0 ? (
            <p className="tabular text-center text-xs text-muted-foreground">
              Discount given: {money(order.discount)} (payable {money(order.payable)})
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            {cancelled ? (
              <Badge variant="destructive">Return {money(order.paidAmount)} to customer</Badge>
            ) : (
              <PaymentBadge status={order.paymentStatus} payable={order.payable} />
            )}
            {order.paymentMode && order.paidAmount > 0 ? (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                {order.paymentMode}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Primary actions. The whole life of the job sits together here, under
          the header: adding what the repair needs, handing the device back, and
          the statuses the counter sets. Money is not here - it is the three
          figures at the top of the bill, so the figure and the way to change it
          are never in different parts of the screen. Handing the device over is
          the existing Give Device button, kept exactly as it was, so it still
          asks who took it and still refuses to deliver while money is due. */}
      {!closed ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Button size="lg" variant="outline" className="gap-2" onClick={() => setPartOpen(true)}>
            <Plus className="h-5 w-5" /> Add Part
          </Button>
          <Button
            size="lg"
            variant={order.balance > 0 ? 'outline' : 'success'}
            className="gap-2"
            onClick={() => setDeliverOpen(true)}
          >
            <Truck className="h-5 w-5" /> Give Device
          </Button>
          {COUNTER_STATUSES.filter((status) => status !== 'Delivered').map((status) => {
            const isCurrent = status === order.status;
            return (
              <Button
                key={status}
                size="lg"
                variant={isCurrent ? 'secondary' : 'outline'}
                disabled={isCurrent || changeStatus.isPending}
                className="gap-2"
                onClick={() => {
                  if (status === 'Cancelled') {
                    setCancelOpen(true);
                  } else {
                    void pickStatus(status);
                  }
                }}
              >
                {status === 'Cancelled' ? (
                  <XCircle className="h-5 w-5" />
                ) : status === 'Ready' ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : status === 'Repairing' ? (
                  <Wrench className="h-5 w-5" />
                ) : (
                  <PackageCheck className="h-5 w-5" />
                )}
                {status}
              </Button>
            );
          })}
        </div>
      ) : (
        <InlineNotice tone={cancelled ? 'warning' : order.status === 'Delivered' ? 'success' : 'info'}>
          This bill is closed ({order.status}). {order.deliveredAt ? `Closed on ${dateOnly(order.deliveredAt)}.` : ''}
          {cancelled && order.paidAmount > 0
            ? ` ${money(order.paidAmount)} was taken on this bill and has to be returned to the customer.`
            : ''}
          {cancelled ? ' The bill, its parts and its history are all kept as they are.' : ''}
        </InlineNotice>
      )}

      {closed ? (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => openProtectedFile(`/orders/${order.id}/bill.pdf`)}
        >
          <Printer className="h-5 w-5" /> Print Bill
        </Button>
      ) : null}

      {/* Customer & device */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Device Details</CardTitle>
            {!closed ? (
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border overflow-hidden rounded-xl border-2 border-border">
            <DeviceField
              label="Customer"
              value={
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${order.customerId}`)}
                  className="font-bold text-primary underline-offset-2 hover:underline"
                >
                  {order.customerName}
                </button>
              }
            />
            <DeviceField
              label="Mobile"
              value={
                <a
                  href={`tel:${order.mobile}`}
                  className="tabular inline-flex items-center gap-1.5 font-bold text-primary underline-offset-2 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" /> {order.mobile}
                </a>
              }
            />
            <DeviceField label="Device" value={deviceLabel(order.brand, order.model, order.deviceType)} />
            <DeviceField label="Type" value={order.deviceType} />
            <DeviceField label="Condition" value={order.deviceCondition} />
            {order.imei ? <DeviceField label="IMEI" value={<span className="tabular">{order.imei}</span>} /> : null}
            {order.accessories ? <DeviceField label="Accessories" value={order.accessories} /> : null}
            <DeviceField label="Problem" value={order.complaint} />
            {order.technician ? <DeviceField label="Technician" value={order.technician} /> : null}
            {order.expectedDelivery ? (
              <DeviceField label="Expected" value={dateOnly(order.expectedDelivery)} />
            ) : null}
            <DeviceField label="Received" value={dateTime(order.receivedAt)} />
            {order.notes ? <DeviceField label="Notes" value={order.notes} /> : null}
          </div>
        </CardContent>
      </Card>

      {/*
        What the customer was charged for. Anything about how many are on the
        shelf lives in JMR - STOCK, so none of it is shown here.
      */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Items on this bill
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.parts.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing added to this bill yet.
            </p>
          ) : (
            order.parts.map((line) => (
              <div key={line.id} className="flex items-start justify-between gap-2 rounded-xl border-2 border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{line.partName}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {line.quantity} x {money(line.unitPrice)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="tabular text-sm font-black">
                    {money(line.quantity * line.unitPrice)}
                  </p>
                  {!closed ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${line.partName}`}
                      loading={deletePart.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${line.partName} from this bill?`)) {
                          void deletePart.mutateAsync(line.id).catch((caught: unknown) =>
                            toast.error('Could not remove', caught instanceof Error ? caught.message : undefined),
                          );
                        }
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-success" /> Payments
            </CardTitle>
            {!cancelled && (order.paidAmount > 0 || order.finalAmount > 0) ? (
              <Button variant="outline" size="sm" onClick={() => setPaymentOpen(true)} className="gap-1.5">
                <Wallet className="h-4 w-4" /> {order.balance > 0 ? 'Take payment' : 'Add payment'}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.payments.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
              No payment received yet.
            </p>
          ) : (
            order.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                onDelete={
                  closed
                    ? undefined
                    : () => {
                        if (window.confirm(`Remove this ${money(payment.amount)} payment?`)) {
                          void removePayment
                            .mutateAsync(payment.id)
                            .then(() => toast.success('Payment removed'))
                            .catch((caught: unknown) =>
                              toast.error(
                                'Could not remove payment',
                                caught instanceof Error ? caught.message : undefined,
                              ),
                            );
                        }
                      }
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Bill */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Bill / Job Card
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => openProtectedFile(`/orders/${order.id}/bill.pdf`)}
          >
            <Printer className="h-5 w-5" /> Open / Print Bill PDF
          </Button>
          <BillActions orderId={order.id} hasDrive={Boolean(order.billDriveLink)} />
          {order.billDriveLink ? (
            <a
              href={order.billDriveLink}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold"
            >
              <ExternalLink className="h-4 w-4" /> Open in Google Drive
            </a>
          ) : null}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" /> Status History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {order.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No status changes recorded.</p>
          ) : (
            <ol className="space-y-3">
              {[...order.history].reverse().map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                    <span className="w-0.5 flex-1 bg-border" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm font-bold">
                      {entry.fromStatus ? `${entry.fromStatus} - ` : 'Created - '}
                      {entry.toStatus}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateTime(entry.at)} - {entry.user}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <PaymentSheet
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        balance={order.balance}
        payments={order.payments}
        busy={recordPayment.isPending || updatePayment.isPending}
        onSubmit={async (body) => {
          const response = await recordPayment.mutateAsync(body);
          if (response.warning) toast.warning(response.warning.message);
          else toast.success('Payment recorded', money(body.amount));
          setPaymentOpen(false);
        }}
        onModifySubmit={async (body) => {
          const response = await updatePayment.mutateAsync(body);
          if (response.warning) toast.warning(response.warning.message);
          else toast.success('Payment corrected', `${money(body.amount)} is now on the bill.`);
        }}
      />

      <TotalSheet
        open={totalOpen}
        onOpenChange={setTotalOpen}
        finalAmount={order.finalAmount}
        discount={order.discount}
        paidAmount={order.paidAmount}
        partsTotal={partsTotal}
        busy={update.isPending}
        onSave={async (body) => {
          const response = await update.mutateAsync(body);
          if (response.warning) toast.warning(response.warning.message);
          else toast.success('Total changed', `The bill is now ${money(order.finalAmount)}.`);
          setTotalOpen(false);
        }}
      />

      <DeliverSheet
        open={deliverOpen}
        onOpenChange={setDeliverOpen}
        customerName={order.customerName}
        balance={order.balance}
        onSubmit={async (deliveredTo) => {
          if (order.balance > 0) {
            toast.error('Payment still due', `Collect ${money(order.balance)} before giving the device.`);
            return;
          }
          // The server will not hand back a device that is still marked as
          // being worked on. That guard is worth keeping - a bill can be
          // genuinely unfinished - but the counter is not making a mistake
          // by handing the device over, so the status is corrected here
          // instead of making them tap Ready and then Give Device again.
          if (order.status !== 'Ready' && order.status !== 'Unable to Repair') {
            try {
              await changeStatus.mutateAsync('Ready');
            } catch (caught) {
              toast.error(
                'Could not mark the bill Ready',
                caught instanceof Error ? caught.message : undefined,
              );
              return;
            }
          }
          const response = await deliver.mutateAsync(deliveredTo);
          if (response.warning) toast.warning(response.warning.message);
          else toast.success('Device handed over', 'Bill is ready to print.');
          setDeliverOpen(false);
          navigate('/orders?scope=delivered');
        }}
        extraPayment={
          order.balance > 0 ? (
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={() => {
                setDeliverOpen(false);
                setPaymentOpen(true);
              }}
            >
              <Wallet className="h-5 w-5" /> Pay {money(order.balance)} first
            </Button>
          ) : null
        }
      />

      <BillItemPicker
        open={partOpen}
        onOpenChange={setPartOpen}
        excludeIds={order.parts.map((line) => line.partId)}
        busy={addPart.isPending}
        onPick={(part) => {
          void addPart
            .mutateAsync({ partId: part.id, name: part.name, quantity: 1, unitPrice: part.sellingPrice })
            .then((response) => {
              if (response.warning) toast.warning(response.warning.message);
              else toast.success(`${part.name} added to the bill`);
            })
            .catch((caught: unknown) =>
              toast.error('Could not add the item', caught instanceof Error ? caught.message : undefined),
            );
        }}
        onAddTyped={(input) => {
          void addPart
            .mutateAsync({ partId: '', ...input })
            .then((response) => {
              if (response.warning) toast.warning(response.warning.message);
              else toast.success(`${input.name} added to the bill`);
            })
            .catch((caught: unknown) =>
              toast.error('Could not add the item', caught instanceof Error ? caught.message : undefined),
            );
        }}
      />

      <EditOrderSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        order={order}
        saving={update.isPending}
        onSave={async (body) => {
          const response = await update.mutateAsync(body);
          if (response.warning) toast.warning(response.warning.message);
          else toast.success('Bill updated');
          setEditOpen(false);
        }}
      />

      <CancelOrderSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        order={order}
        busy={changeStatus.isPending}
        onConfirm={async (reason) => {
          try {
            const response = await changeStatus.mutateAsync('Cancelled');
            if (response.warning) toast.warning(response.warning.message);
            else toast.success('Bill cancelled', `Marked as Cancelled (${reason})`);
            setCancelOpen(false);
          } catch (caught) {
            toast.error('Could not cancel bill', caught instanceof Error ? caught.message : undefined);
          }
        }}
      />
    </div>
  );
}

/**
 * One row of the compact device table on the bill: every name sits flush on the
 * left, every value lines up on the right edge, so the two columns read cleanly.
 * Thin padding keeps the whole card small.
 */
function DeviceField({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-1">
      <span className="shrink-0 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words text-right text-sm font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * One of the three figures at the top of the bill. Where the number can be
 * changed, the whole cell is the button - a counter should be able to reach the
 * number they want to fix by touching the number itself, not by hunting for a
 * separate control that happens to be next to it.
 */
function MoneyCell({
  label,
  value,
  tone = 'default',
  actionLabel,
  onClick,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'destructive';
  actionLabel?: string;
  onClick?: () => void;
}): JSX.Element {
  const tones = cn(
    'relative rounded-xl p-3 text-left transition-colors',
    tone === 'success' && 'bg-success/10',
    tone === 'destructive' && 'bg-destructive/10',
    tone === 'default' && 'bg-secondary',
    onClick && 'cursor-pointer hover:brightness-95 active:brightness-90',
  );

  const body = (
    <>
      <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-0.5 text-lg font-black leading-tight',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {actionLabel ? (
        <p className="mt-1 flex items-center gap-1 text-2xs font-bold text-muted-foreground">
          <Pencil className="h-3 w-3" /> {actionLabel}
        </p>
      ) : null}
    </>
  );

  if (!onClick) return <div className={tones}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={`${label} ${value}. ${actionLabel ?? ''}`} className={tones}>
      {body}
    </button>
  );
}

function PaymentRow({
  payment,
  onDelete,
}: {
  payment: { id: string; amount: number; mode: string; date: string; user: string; note: string };
  onDelete?: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-border p-3">
      <div className="min-w-0">
        <p className="tabular text-base font-black text-success">{money(payment.amount)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {payment.mode} - {dateTime(payment.date)} - {payment.user}
        </p>
        {payment.note ? <p className="truncate text-xs text-muted-foreground">{payment.note}</p> : null}
      </div>
      {onDelete ? (
        <Button variant="ghost" size="icon" aria-label="Remove payment" onClick={onDelete} className="shrink-0 text-destructive">
          <Trash2 className="h-5 w-5" />
        </Button>
      ) : null}
    </div>
  );
}

/** Saves / prints the bill, and pushes it to Drive when connected. */
function BillActions({ orderId, hasDrive }: { orderId: string; hasDrive: boolean }): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      className="w-full justify-start gap-2"
      loading={busy}
      loadingText="Saving to Google Drive..."
      onClick={() => {
        setBusy(true);
        void api
          .post<{ saved: boolean; driveFileId?: string; message?: string }>(
            `/orders/${orderId}/bill/save`,
          )
          .then((response) => {
            if (response.data.saved) toast.success('Bill saved to Google Drive');
            else
              toast.warning(
                'Bill not saved to Drive',
                response.data.message ?? 'Connect Google Sheets first.',
              );
          })
          .catch((caught: unknown) =>
            toast.error('Could not save the bill', caught instanceof Error ? caught.message : undefined),
          )
          .finally(() => setBusy(false));
      }}
    >
      <CloudUpload className="h-5 w-5" />
      {hasDrive ? 'Update Bill in Google Drive' : 'Save Bill to Google Drive'}
    </Button>
  );
}

type BillPayment = { id: string; amount: number; mode: string; note: string; date: string };

/**
 * One sheet for all money at the counter. The counter usually comes here to take
 * a payment, but a mistyped amount is corrected in the same place - it is the
 * same screen, not a second dialog, because it is the same job. Correcting
 * changes that one payment: no adjustment row, no second payment, so the bill's
 * paid figure, balance and payment status are the only record and the shop never
 * looks like it took the same money twice.
 */
function PaymentSheet({
  open,
  onOpenChange,
  balance,
  payments,
  busy,
  onSubmit,
  onModifySubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number;
  payments: BillPayment[];
  busy: boolean;
  onSubmit: (body: { amount: number; mode: string; note: string; idempotencyKey: string }) => Promise<void>;
  onModifySubmit: (body: { paymentId: string; amount: number; mode: string; note: string }) => Promise<void>;
}): JSX.Element {
  const toast = useToast();
  const [view, setView] = useState<'take' | 'modify'>('take');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState('');

  const selected = payments.find((payment) => payment.id === selectedId);

  const choose = (payment: BillPayment): void => {
    setSelectedId(payment.id);
    setAmount(String(payment.amount));
    setMode(payment.mode);
    setNote(payment.note);
  };

  const value = Number(amount);
  const takeValue = Number(amount) || 0;
  const unchanged = selected ? round2(value) === round2(selected.amount) : false;

  const submit = async (): Promise<void> => {
    // An empty box is a mistake, but a typed 0 is a real answer: sometimes
    // nothing is collected. Both are allowed as long as something was typed.
    if (amount.trim() === '' || !(Number.isFinite(value) && value >= 0)) {
      toast.error('Enter the amount received');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ amount: round2(takeValue), mode, note: note.trim(), idempotencyKey });
      setAmount('');
      setNote('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (caught) {
      toast.error('Could not save the payment', caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const saveCorrection = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    if (amount.trim() === '' || !(Number.isFinite(value) && value >= 0)) {
      toast.error('Enter the amount that was actually received');
      return;
    }
    setSaving(true);
    try {
      await onModifySubmit({ paymentId: selected.id, amount: round2(value), mode, note: note.trim() });
      // Stay open and go back to taking a payment. A counter who just corrected
      // one amount usually still has the rest of the balance to collect, and
      // making them close and reopen the sheet to do it is a miscount waiting
      // to happen.
      setView('take');
      setAmount('');
      setNote('');
      setSelectedId('');
    } catch (caught) {
      toast.error('Could not change the payment', caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  // Start clean every time, so a correction never inherits the last amount typed.
  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setView('take');
      setAmount('');
      setNote('');
      setSelectedId('');
    }
    onOpenChange(next);
  };

  if (view === 'modify') {
    return (
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        title="Modify a payment"
        description="Fix the amount on a payment already received. Nothing extra is added to the bill."
      >
        <div className="space-y-3 pb-2">
          <ul className="space-y-2">
            {payments.map((payment) => (
              <li key={payment.id}>
                <button
                  type="button"
                  onClick={() => choose(payment)}
                  className={cn(
                    'flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 px-3 text-left',
                    selectedId === payment.id ? 'border-primary bg-primary/5' : 'border-border',
                  )}
                >
                  <span className="min-w-0">
                    <span className="tabular block font-black">{money(payment.amount)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {payment.mode} - {dateTime(payment.date)}
                    </span>
                  </span>
                  {selectedId === payment.id ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <form className="space-y-3 border-t-2 border-border pt-3" onSubmit={(e) => void saveCorrection(e)}>
              <Field label="Amount received" htmlFor="modify-payment-amount">
                <Input
                  id="modify-payment-amount"
                  name="modify-payment-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-16 text-2xl font-black"
                />
              </Field>
              <Field label="Paid By" htmlFor="modify-payment-mode">
                <Select
                  value={mode}
                  onValueChange={setMode}
                  options={PAYMENT_MODES.map((item) => ({ value: item, label: item }))}
                />
              </Field>
              <Field label="Note" htmlFor="modify-payment-note" optional>
                <Textarea
                  id="modify-payment-note"
                  name="modify-payment-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                />
              </Field>
              <Button type="submit" size="lg" loading={busy || saving} disabled={unchanged} className="w-full gap-2">
                <CheckCircle2 className="h-5 w-5" /> Save this amount
              </Button>
            </form>
          ) : (
            <p className="rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
              Tap the payment you need to correct.
            </p>
          )}

          <Button variant="ghost" className="w-full gap-2" onClick={() => setView('take')}>
            <Wallet className="h-5 w-5" /> Back to taking a payment
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Take payment"
      description={balance > 0 ? `${money(balance)} is still due` : 'Advance or extra payment'}
    >
      <div className="space-y-3 pb-2">
        <Field label="Amount Received" htmlFor="payment-amount">
          <Input
            id="payment-amount"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            className="h-16 text-2xl font-black"
          />
        </Field>

        {balance > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setAmount(String(balance))}>
              Full {money(balance)}
            </Button>
            <Button variant="outline" onClick={() => setAmount(String(round2(balance / 2)))}>
              Half {money(round2(balance / 2))}
            </Button>
          </div>
        ) : null}

        <Field label="Paid By" htmlFor="payment-mode">
          <Select
            value={mode}
            onValueChange={setMode}
            options={PAYMENT_MODES.map((item) => ({ value: item, label: item }))}
          />
        </Field>

        <Field label="Note" htmlFor="payment-note" optional>
          <Input
            id="payment-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Advance at counter"
          />
        </Field>

        <Button size="lg" className="w-full" loading={busy || saving} onClick={() => void submit()}>
          Save Payment
        </Button>

        {payments.length > 0 ? (
          <div className="space-y-2 border-t-2 border-border pt-3">
            <Button variant="outline" className="w-full gap-2" onClick={() => setView('modify')}>
              <Pencil className="h-5 w-5" /> Modify a payment received
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {money(payments.reduce((sum, payment) => sum + payment.amount, 0))} received so far. Wrong
              amount? Correct it here instead of adding a second payment.
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Re-prices the job. The total is the number the customer agrees at the counter,
 * and it is often wrong until the repair is actually opened up, so it has to be
 * one tap from the top of the bill rather than buried in the full edit form.
 *
 * Money already taken is never touched here. Lowering the total does not take
 * money back; it changes what the customer still owes, and if the new total
 * would sit under what they have already paid, the server refuses it - the shop
 * has to correct the payment itself, so both numbers have to keep meaning
 * something.
 */
function TotalSheet({
  open,
  onOpenChange,
  finalAmount,
  discount,
  paidAmount,
  partsTotal,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalAmount: number;
  discount: number;
  paidAmount: number;
  partsTotal: number;
  busy: boolean;
  onSave: (body: { finalAmount: number; discount: number }) => Promise<void>;
}): JSX.Element {
  const toast = useToast();
  const [total, setTotal] = useState(String(finalAmount));
  const [off, setOff] = useState(String(discount));
  const [saving, setSaving] = useState(false);

  const totalValue = Number(total);
  const offValue = Number(off) || 0;
  const payable = round2(totalValue - offValue);
  const left = round2(payable - paidAmount);

  const reset = (next: boolean): void => {
    if (!next) {
      setTotal(String(finalAmount));
      setOff(String(discount));
    }
    onOpenChange(next);
  };

  // The two floors the server enforces, shown before the save is attempted so
  // the counter finds out here rather than from an error.
  const belowParts = partsTotal > 0 && totalValue < partsTotal;
  const belowPaid = totalValue < paidAmount;

  return (
    <Sheet
      open={open}
      onOpenChange={reset}
      title="Change the total"
      description="What the customer has to pay for this repair."
    >
      <div className="space-y-3 pb-2">
        <Field label="Total" htmlFor="total-amount">
          <Input
            id="total-amount"
            name="total-amount"
            type="number"
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            className="h-16 text-2xl font-black"
          />
        </Field>
        <Field label="Discount" htmlFor="total-discount" optional>
          <Input
            id="total-discount"
            name="total-discount"
            type="number"
            inputMode="decimal"
            value={off}
            onChange={(event) => setOff(event.target.value)}
          />
        </Field>

        {partsTotal > 0 ? (
          <p className="text-xs text-muted-foreground">
            Parts on this repair come to {money(partsTotal)}.
            {belowParts ? ' The total cannot be less than that.' : ''}
          </p>
        ) : null}

        {paidAmount > 0 ? (
          <p className={cn('text-xs', belowPaid ? 'font-bold text-destructive' : 'text-muted-foreground')}>
            {money(paidAmount)} has already been paid.
            {belowPaid
              ? ' The total cannot be less than that. Correct the payment instead.'
              : ' Money already paid is not changed here.'}
          </p>
        ) : null}

        {!belowParts && !belowPaid && Number.isFinite(totalValue) ? (
          <div className="rounded-xl bg-secondary p-3 text-center">
            <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
              Balance after this change
            </p>
            <p className="tabular text-lg font-black">{money(Math.max(0, left))}</p>
          </div>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          loading={busy || saving}
          disabled={!Number.isFinite(totalValue) || belowParts || belowPaid}
          onClick={() => {
            if (totalValue < 0 || offValue < 0) {
              toast.error('Enter a valid amount');
              return;
            }
            setSaving(true);
            void onSave({ finalAmount: round2(totalValue), discount: round2(offValue) })
              .catch((caught: unknown) =>
                toast.error('Could not change the total', caught instanceof Error ? caught.message : undefined),
              )
              .finally(() => setSaving(false));
          }}
        >
          Save Total
        </Button>
      </div>
    </Sheet>
  );
}

function DeliverSheet({
  open,
  onOpenChange,
  customerName,
  balance,
  onSubmit,
  extraPayment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  balance: number;
  onSubmit: (deliveredTo: string) => Promise<void>;
  extraPayment?: React.ReactNode;
}): JSX.Element {
  const [deliveredTo, setDeliveredTo] = useState(customerName);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Give device back to customer"
      description="Mark the bill as handed over."
    >
      <div className="space-y-3 pb-2">
        <Field label="Handed over to" htmlFor="delivered-to" hint="Usually the same person who brought it.">
          <Input
            id="delivered-to"
            value={deliveredTo}
            onChange={(event) => setDeliveredTo(event.target.value)}
            className="h-14"
          />
        </Field>

        {balance > 0 ? (
          <InlineNotice tone="error">
            {money(balance)} is still due. The server will not allow delivery until the payment is
            recorded.
          </InlineNotice>
        ) : (
          <InlineNotice tone="success">All money received. Device can be handed over.</InlineNotice>
        )}

        {extraPayment}

        <Button
          size="lg"
          variant="success"
          className="w-full gap-2"
          disabled={balance > 0}
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onSubmit(deliveredTo.trim())
              .catch((caught: unknown) =>
                toast.error('Could not complete delivery', caught instanceof Error ? caught.message : undefined),
              )
              .finally(() => setBusy(false));
          }}
        >
          <Truck className="h-5 w-5" /> Confirm Delivery
        </Button>
      </div>
    </Sheet>
  );
}

function EditOrderSheet({
  open,
  onOpenChange,
  order,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    customerName: string;
    mobile: string;
    deviceType: string;
    brand: string;
    model: string;
    complaint: string;
    imei: string;
    deviceCondition: string;
    accessories: string;
    expectedDelivery: string;
    technician: string;
    notes: string;
    estimatedAmount: number;
    finalAmount: number;
    discount: number;
  };
  saving: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState(order);
  const [editingMoney, setEditingMoney] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit bill"
      description="Money already paid is not changed here."
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer" htmlFor="edit-name">
            <Input id="edit-name" value={form.customerName} onChange={(event) => set('customerName', event.target.value)} />
          </Field>
          <Field label="Mobile" htmlFor="edit-mobile">
            <Input
              id="edit-mobile"
              {...numberPad}
              value={form.mobile}
              onChange={(event) => set('mobile', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Device Type" htmlFor="edit-type">
            <Select
              value={form.deviceType}
              onValueChange={(value) => set('deviceType', value)}
              options={DEVICE_TYPES.map((item) => ({ value: item, label: item }))}
            />
          </Field>
          <Field label="Condition" htmlFor="edit-condition">
            <Select
              value={form.deviceCondition}
              onValueChange={(value) => set('deviceCondition', value)}
              options={DEVICE_CONDITIONS.map((item) => ({ value: item, label: item }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand" htmlFor="edit-brand">
            <BrandField
              id="edit-brand"
              value={form.brand}
              onChange={(next) => set('brand', next)}
            />
          </Field>
          <Field label="Model" htmlFor="edit-model">
            <ModelField
              id="edit-model"
              value={form.model}
              onChange={(next) => set('model', next)}
              brand={form.brand}
            />
          </Field>
        </div>

        <Field label="Problem" htmlFor="edit-complaint">
          <ProblemField
            id="edit-complaint"
            value={form.complaint}
            onChange={(next) => set('complaint', next)}
            placeholder="Display change, mic problem..."
          />
        </Field>

        <Field label="Accessories" htmlFor="edit-accessories" optional>
          <Textarea
            id="edit-accessories"
            value={form.accessories}
            onChange={(event) => set('accessories', event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected Delivery" htmlFor="edit-expected" optional>
            <Input
              id="edit-expected"
              type="date"
              value={form.expectedDelivery ?? ''}
              onChange={(event) => set('expectedDelivery', event.target.value)}
            />
          </Field>
          <Field label="Technician" htmlFor="edit-technician" optional>
            <Input
              id="edit-technician"
              value={form.technician}
              onChange={(event) => set('technician', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="edit-notes" optional>
          <Textarea id="edit-notes" value={form.notes} onChange={(event) => set('notes', event.target.value)} />
        </Field>

        <button
          type="button"
          onClick={() => setEditingMoney((current) => !current)}
          className="flex w-full items-center justify-between rounded-xl border-2 border-border px-4 py-3 text-sm font-bold"
        >
          Money
          <span className="text-muted-foreground">{editingMoney ? 'Hide' : 'Edit'}</span>
        </button>

        {editingMoney ? (
          <div className="space-y-3 rounded-xl bg-secondary p-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Estimate" htmlFor="edit-estimate">
                <Input
                  id="edit-estimate"
                  type="number"
                  inputMode="decimal"
                  value={form.estimatedAmount}
                  onChange={(event) => set('estimatedAmount', Number(event.target.value) || 0)}
                />
              </Field>
              <Field label="Final" htmlFor="edit-final">
                <Input
                  id="edit-final"
                  type="number"
                  inputMode="decimal"
                  value={form.finalAmount}
                  onChange={(event) => set('finalAmount', Number(event.target.value) || 0)}
                />
              </Field>
              <Field label="Discount" htmlFor="edit-discount">
                <Input
                  id="edit-discount"
                  type="number"
                  inputMode="decimal"
                  value={form.discount}
                  onChange={(event) => set('discount', Number(event.target.value) || 0)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Changing the final amount never changes money already paid. The balance updates by
              itself.
            </p>
          </div>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          loading={saving}
          onClick={() =>
            void onSave({
              customerName: form.customerName,
              mobile: form.mobile,
              deviceType: form.deviceType,
              brand: form.brand,
              model: form.model,
              complaint: form.complaint,
              imei: form.imei,
              deviceCondition: form.deviceCondition,
              accessories: form.accessories,
              expectedDelivery: form.expectedDelivery,
              technician: form.technician,
              notes: form.notes,
              estimatedAmount: form.estimatedAmount,
              finalAmount: form.finalAmount,
              discount: form.discount,
            })
          }
        >
          Save Changes
        </Button>
      </div>
    </Sheet>
  );
}

function CancelOrderSheet({
  open,
  onOpenChange,
  order,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: string;
    customerName: string;
    mobile: string;
    brand: string;
    model: string;
    deviceType: string;
    paidAmount: number;
    balance: number;
  };
  busy: boolean;
  onConfirm: (reason: string) => Promise<void>;
}): JSX.Element {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState('Customer changed mind');
  const [customReason, setCustomReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setReason('Customer changed mind');
      setCustomReason('');
      setAcknowledged(false);
    }
  }, [open]);

  const reasons = [
    'Customer changed mind',
    'Parts unavailable / too costly',
    'Customer took device back without repair',
    'Device dead / unrepairable',
    'Other reason',
  ];

  const effectiveReason = reason === 'Other reason' && customReason.trim() ? customReason.trim() : reason;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={step === 1 ? `Cancel Bill - Step 1 of 2` : `Cancel Bill - Step 2 of 2`}
    >
      <div className="space-y-4 pb-2">
        {/* 2-Step Progress Indicator */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div
            className={cn(
              'rounded-xl border p-2.5 text-center font-bold transition-all',
              step === 1
                ? 'border-destructive bg-destructive/10 text-destructive shadow-2xs'
                : 'border-muted bg-muted/30 text-muted-foreground opacity-60',
            )}
          >
            <div className="text-2xs uppercase tracking-wider">Step 1</div>
            <div>Reason & Impact</div>
          </div>
          <div
            className={cn(
              'rounded-xl border p-2.5 text-center font-bold transition-all',
              step === 2
                ? 'border-destructive bg-destructive/10 text-destructive shadow-2xs'
                : 'border-muted bg-muted/30 text-muted-foreground opacity-60',
            )}
          >
            <div className="text-2xs uppercase tracking-wider">Step 2</div>
            <div>Final Confirmation</div>
          </div>
        </div>

        {step === 1 ? (
          <div className="space-y-3.5">
            {/* Bill Summary */}
            <div className="rounded-xl border bg-secondary/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between items-center font-bold">
                <span className="text-foreground">{order.customerName}</span>
                <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {order.id}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {deviceLabel(order.brand, order.model, order.deviceType)} {order.mobile ? `· ${order.mobile}` : ''}
              </p>
            </div>

            {/* Refund Notice */}
            {order.paidAmount > 0 ? (
              <InlineNotice tone="warning">
                <strong>Refund Required:</strong> ₹{money(order.paidAmount)} was received as advance on this bill. Cancelling will close this repair and require returning {money(order.paidAmount)} in cash to the customer.
              </InlineNotice>
            ) : (
              <InlineNotice tone="info">
                No advance was collected on this bill. Cancelling will mark it closed without refund needed.
              </InlineNotice>
            )}

            {/* Select Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Step 1: Reason for Cancellation
              </label>
              <div className="space-y-1.5">
                {reasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={cn(
                      'w-full text-left rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all',
                      reason === r
                        ? 'border-destructive bg-destructive/10 text-destructive shadow-2xs font-bold'
                        : 'border-input hover:bg-secondary/70 text-foreground',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reason === 'Other reason' ? (
                <Input
                  id="cancel-custom-reason"
                  name="cancel-custom-reason"
                  placeholder="Specify cancellation reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="mt-2"
                />
              ) : null}
            </div>

            {/* Step 1 Actions */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Keep Bill Active
              </Button>
              <Button
                variant="destructive"
                onClick={() => setStep(2)}
                className="gap-1.5 font-bold"
              >
                Proceed to Step 2 →
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {/* Step 2 Danger Notice */}
            <InlineNotice tone="error">
              <strong>Final Step:</strong> Are you completely sure you want to cancel bill <strong>{order.id}</strong>? Once cancelled, the bill cannot be moved back to repairing or delivered.
            </InlineNotice>

            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-sm">
              <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground">
                <span>Cancellation Reason:</span>
                <span className="font-bold text-foreground">{effectiveReason}</span>
              </div>
              {order.paidAmount > 0 ? (
                <div className="border-t border-destructive/20 pt-2 flex justify-between items-center text-destructive font-bold text-sm">
                  <span>Cash Refund to Customer:</span>
                  <span className="tabular">{money(order.paidAmount)}</span>
                </div>
              ) : null}
            </div>

            {/* Explicit Confirmation Checkbox */}
            <label className="flex items-start gap-3 rounded-xl border-2 border-input bg-card p-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-destructive cursor-pointer"
              />
              <span className="text-xs font-bold leading-snug text-foreground">
                I have verified and confirm cancellation of bill {order.id}
                {order.paidAmount > 0 ? ` and acknowledge refund of ${money(order.paidAmount)}` : ''}.
              </span>
            </label>

            {/* Step 2 Actions */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                ← Back to Step 1
              </Button>
              <Button
                variant="destructive"
                disabled={!acknowledged || busy}
                loading={busy}
                onClick={() => void onConfirm(effectiveReason)}
                className="font-bold"
              >
                Yes, Cancel Bill
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Picks what to charge for. It deliberately shows only the name and the price
 * - how many are on the shelf is stock information and does not belong on a
 * billing screen.
 */
function BillItemPicker({
  open,
  onOpenChange,
  onPick,
  onAddTyped,
  excludeIds = [],
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (part: PartListItem) => void;
  onAddTyped: (input: { name: string; quantity: number; unitPrice: number }) => void;
  excludeIds?: string[];
  busy?: boolean;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'typed'>('list');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [touched, setTouched] = useState(false);
  const debounced = useDebounced(search, 200);
  const { data, isLoading } = useParts(debounced, false);

  const items = (data ?? []).filter((part) => !excludeIds.includes(part.id));

  const reset = (): void => {
    setSearch('');
    setName('');
    setQuantity('1');
    setPrice('');
    setTouched(false);
    setMode('list');
  };

  const qty = Number(quantity);
  const rupees = Number(price);
  const nameError = touched && !name.trim() ? 'Type what the item is' : '';
  const priceError =
    touched && (!Number.isFinite(rupees) || rupees < 0) ? 'Enter a price' : '';
  const canAdd = name.trim() !== '' && Number.isFinite(rupees) && rupees >= 0 && Number.isInteger(qty) && qty > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Add to this bill"
      description="Pick from the price list, or type the item and its price."
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={mode === 'list' ? 'default' : 'outline'}
            onClick={() => setMode('list')}
            className="gap-2"
          >
            <Package className="h-4 w-4" /> Price list
          </Button>
          <Button
            variant={mode === 'typed' ? 'default' : 'outline'}
            onClick={() => setMode('typed')}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Type it in
          </Button>
        </div>

        {mode === 'list' ? (
          <>
            <Input
              id="bill-item-search"
              name="bill-item-search"
              aria-label="Search item name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item name"
              autoFocus
            />
            {isLoading && !data ? (
              <LoadingBlock label="Loading items..." />
            ) : items.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {search ? 'Nothing matches that search.' : 'No items on the price list yet.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(part);
                        onOpenChange(false);
                        reset();
                      }}
                      className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border-2 border-border px-3 text-left"
                    >
                      <span className="min-w-0 truncate font-bold">{part.name}</span>
                      <span className="tabular shrink-0 font-black">{money(part.sellingPrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (!canAdd) return;
              onAddTyped({ name: name.trim(), quantity: qty, unitPrice: rupees });
              onOpenChange(false);
              reset();
            }}
          >
            <Field label="Item name" htmlFor="typed-part-name" error={nameError}>
              <Input
                id="typed-part-name"
                name="typed-part-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Display, battery, paste..."
                className="h-14"
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="How many" htmlFor="typed-part-qty">
                <Input
                  id="typed-part-qty"
                  name="typed-part-qty"
                  {...numberPad}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="h-14 text-center"
                />
              </Field>
              <Field label="Price each" htmlFor="typed-part-price" error={priceError}>
                <Input
                  id="typed-part-price"
                  name="typed-part-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0"
                  className="h-14 text-center"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Typed in at the counter, so it is billed and printed like any other line but
              comes off no stock.
            </p>
            <Button type="submit" size="lg" loading={busy} disabled={!canAdd} className="w-full gap-2">
              <Plus className="h-5 w-5" /> Add to this bill
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
