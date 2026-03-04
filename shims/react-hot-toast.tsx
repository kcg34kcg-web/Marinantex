import * as React from 'react';

type ToastRenderer = (ctx: { visible: boolean }) => React.ReactNode;

type ToastFn = ((message?: string, options?: Record<string, unknown>) => string) & {
  success: (message?: string, options?: Record<string, unknown>) => string;
  error: (message?: string, options?: Record<string, unknown>) => string;
  loading: (message?: string, options?: Record<string, unknown>) => string;
  custom: (renderer: ToastRenderer, options?: Record<string, unknown>) => string;
  dismiss: (id?: string) => void;
};

function noopToast(message?: string) {
  if (message) {
    // Keep this lightweight and non-blocking in environments without toast library.
    // eslint-disable-next-line no-console
    console.info(`[toast] ${message}`);
  }
  return '';
}

const toast = noopToast as ToastFn;
toast.success = noopToast;
toast.error = noopToast;
toast.loading = noopToast;
toast.custom = (renderer: ToastRenderer) => {
  renderer({ visible: true });
  return '';
};
toast.dismiss = () => {};

type ToasterPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

type ToasterProps = {
  position?: ToasterPosition;
  reverseOrder?: boolean;
  gutter?: number;
  containerClassName?: string;
  toastOptions?: Record<string, unknown>;
};

export const Toaster = (_props: ToasterProps) => null;

export { toast };

export default toast;
