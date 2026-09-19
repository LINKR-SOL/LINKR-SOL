"use client";

import { ArrowUpRight, X } from "@/components/ui/icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  title: string;
  body?: string;
  link?: string;
}

/** Time the exit transition needs before the node can be unmounted. */
const EXIT_MS = 180;
const LIFETIME = { error: 9000, success: 6000, info: 6000 } as const;

const ToastContext = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());

  // Remaining lifetime per toast, so hovering can pause and resume it.
  const timers = useRef(new Map<number, { id: ReturnType<typeof setTimeout>; endsAt: number; left: number }>());
  const paused = useRef(false);

  const dismiss = useCallback((id: number) => {
    setLeaving((s) => new Set(s).add(id));
    // Unmount only after the exit transition has actually played.
    setTimeout(() => {
      setToasts((all) => all.filter((x) => x.id !== id));
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      timers.current.delete(id);
    }, EXIT_MS);
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      const handle = setTimeout(() => dismiss(id), ms);
      timers.current.set(id, { id: handle, endsAt: Date.now() + ms, left: ms });
    },
    [dismiss],
  );

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all, { ...t, id }]);
      arm(id, LIFETIME[t.kind]);
    },
    [arm],
  );

  // Reading a tx hash shouldn't race a timer: hold every toast while hovered.
  const pause = useCallback(() => {
    if (paused.current) return;
    paused.current = true;
    for (const [id, timer] of [...timers.current]) {
      clearTimeout(timer.id);
      // Replace the entry rather than mutating it in place.
      timers.current.set(id, { ...timer, left: Math.max(0, timer.endsAt - Date.now()) });
    }
  }, []);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    for (const [id, timer] of timers.current) {
      const handle = setTimeout(() => dismiss(id), timer.left);
      timers.current.set(id, { id: handle, endsAt: Date.now() + timer.left, left: timer.left });
    }
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const [, timer] of map) clearTimeout(timer.id);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-viewport"
        onPointerEnter={pause}
        onPointerLeave={resume}
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            data-kind={t.kind}
            data-leaving={leaving.has(t.id) || undefined}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
            {t.link && (
              <a href={t.link} target="_blank" rel="noreferrer" className="toast-link">
                View on explorer
                <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5" />
              </a>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
