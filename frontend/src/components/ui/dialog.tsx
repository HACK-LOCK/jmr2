import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-foreground/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, style, ...props }, ref) => {
  const [keyboardOffset, setKeyboardOffset] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleViewport = () => {
      const offset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      setKeyboardOffset(offset);
    };

    vv.addEventListener('resize', handleViewport);
    vv.addEventListener('scroll', handleViewport);
    return () => {
      vv.removeEventListener('resize', handleViewport);
      vv.removeEventListener('scroll', handleViewport);
    };
  }, []);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={{
          ...style,
          ...(keyboardOffset > 0 ? { bottom: `${keyboardOffset}px`, maxHeight: `calc(90dvh - ${keyboardOffset}px)` } : {}),
        }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border bg-background shadow-2xl transition-[bottom,max-height] duration-150',
          'data-[state=open]:animate-sheet-up sm:inset-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[88dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        {/* Drag handle: tells the employee this sheet can be swiped away. */}
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-border sm:hidden" />
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('space-y-1 p-5 pb-2 pr-12', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogBody = ({ className, onFocus, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const handleFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    const target = event.target as HTMLElement;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  };

  return (
    <div
      onFocus={handleFocus}
      className={cn('flex-1 overflow-y-auto overscroll-contain px-5 py-2', className)}
      {...props}
    />
  );
};
DialogBody.displayName = 'DialogBody';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-bold leading-tight tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogBody,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
