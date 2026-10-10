import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = idRef.current++;
      setToasts((t) => [...t.slice(-4), { id, kind, message }]);
      const ttl = kind === 'error' ? 9000 : kind === 'warning' ? 7000 : 4000;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  return { toasts, notify, dismiss };
}
