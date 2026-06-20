import { useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
const listeners: Set<(toasts: ToastItem[]) => void> = new Set();
let currentToasts: ToastItem[] = [];

function notifyChange() {
  listeners.forEach((fn) => fn([...currentToasts]));
}

export function toast(message: string, type: "success" | "error" | "info" = "info") {
  const id = ++toastId;
  currentToasts = [...currentToasts, { id, message, type }];
  notifyChange();
  setTimeout(() => {
    currentToasts = currentToasts.filter((t) => t.id !== id);
    notifyChange();
  }, 3000);
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const handleChange = useCallback((list: ToastItem[]) => {
    setToasts(list);
  }, []);

  useState(() => {
    listeners.add(handleChange);
    return () => {
      listeners.delete(handleChange);
    };
  });

  const bgMap = {
    success: "bg-green-500",
    error: "bg-red-500",
    info: "bg-teal-700",
  };

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${bgMap[t.type]} text-white px-4 py-3 rounded-lg shadow-lg text-sm min-w-[240px] animate-slide-in`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

let initialized = false;
export function initToast() {
  if (initialized) return;
  initialized = true;
  const el = document.createElement("div");
  el.id = "toast-root";
  document.body.appendChild(el);
  createRoot(el).render(<ToastContainer />);
}
