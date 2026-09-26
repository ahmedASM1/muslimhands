'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

interface ToastContextValue {
  push: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const value = useMemo(
    () => ({
      push: (message: string, tone: Toast['tone'] = 'success') => {
        const id = Date.now() + Math.random();
        setToasts((current) => [...current, { id, message, tone }]);
        window.setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== id));
        }, 3500);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={
              toast.tone === 'error'
                ? 'rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground shadow'
                : 'rounded-md bg-foreground px-3 py-2 text-sm text-background shadow'
            }
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
