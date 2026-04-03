"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";

type Props = {
  idleLabel: string;
  pendingLabel?: string;
  className?: string;
};

export default function PendingSubmitButton({
  idleLabel,
  pendingLabel = "Processing...",
  className,
}: Props) {
  const { pending } = useFormStatus();
  const [showPending, setShowPending] = useState(false);
  const pendingStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (pending) {
      pendingStartedAt.current = Date.now();
      setShowPending(true);
      return;
    }

    if (!showPending) return;

    const elapsed = pendingStartedAt.current ? Date.now() - pendingStartedAt.current : 0;
    const minVisibleMs = 900;
    const remaining = Math.max(0, minVisibleMs - elapsed);

    const timer = setTimeout(() => setShowPending(false), remaining);
    return () => clearTimeout(timer);
  }, [pending, showPending]);

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending || showPending}
        className={
          className ??
          "text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-60"
        }
      >
        {showPending ? pendingLabel : idleLabel}
      </button>
      {showPending && <div className="h-0.5 w-full rounded bg-amber-300 animate-pulse" />}
    </div>
  );
}
