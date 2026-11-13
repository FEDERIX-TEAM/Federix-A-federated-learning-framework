"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import styles from "./toast.module.css";

type ToastTone = "ok" | "bad";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

const ToastContext = createContext<(tone: ToastTone, title: string, text?: string) => void>(() => {});
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, title: string, text?: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, tone, title, text }]);
      setTimeout(() => dismiss(id), tone === "bad" ? 8000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast} data-tone={t.tone} role={t.tone === "bad" ? "alert" : "status"} data-testid="toast">
            {t.tone === "ok" ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <div className={styles.text}>
              <strong>{t.title}</strong>
              {t.text ? <span>{t.text}</span> : null}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
