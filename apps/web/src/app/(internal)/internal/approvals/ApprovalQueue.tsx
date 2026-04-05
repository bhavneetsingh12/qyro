"use client";

import { useState, useTransition } from "react";
import { Check, X, AlertTriangle, Mail, MessageSquare, Phone } from "lucide-react";
import { approveMessageAction, rejectMessageAction } from "./actions";

export type QueueItem = {
  id: string;
  sequenceId: string | null;
  channel: string;
  messageText: string | null;
  qaFlags: unknown[];
  createdAt: string;
  businessName: string;
  campaignName: string | null;
};

type QAFlag = { type: string; reason?: string; message?: string };

function ChannelIcon({ channel }: { channel: string }) {
  const cls = "w-3.5 h-3.5";
  if (channel === "email")  return <Mail size={14} className={cls} />;
  if (channel === "sms")    return <MessageSquare size={14} className={cls} />;
  if (channel === "voice")  return <Phone size={14} className={cls} />;
  return null;
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, string> = {
    email: "bg-sky-50 text-sky-700",
    sms:   "bg-violet-50 text-violet-700",
    voice: "bg-amber-50 text-amber-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${map[channel] ?? "bg-stone-100 text-stone-500"}`}>
      <ChannelIcon channel={channel} />
      {channel.toUpperCase()}
    </span>
  );
}

function QAFlagList({ flags }: { flags: unknown[] }) {
  if (!flags.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {(flags as QAFlag[]).map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
        >
          <AlertTriangle size={10} />
          {f.reason ?? f.message ?? f.type}
        </span>
      ))}
    </div>
  );
}

function MessageCard({
  item,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason]         = useState("");
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(() => { onApprove(); });
  }

  function handleRejectConfirm() {
    startTransition(() => {
      onReject(reason);
      setShowReject(false);
      setReason("");
    });
  }

  return (
    <div
      className={`bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden transition-opacity ${isPending ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Card header */}
      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-[#F5F4F1]">
        <div className="min-w-0">
          <p className="font-semibold text-stone-900 truncate">{item.businessName}</p>
          {item.campaignName && (
            <p className="text-xs text-stone-400 mt-0.5 truncate">{item.campaignName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ChannelBadge channel={item.channel} />
          <span className="text-xs text-stone-300">
            {new Date(item.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* Message body */}
      <div className="px-5 py-4">
        {item.messageText ? (
          <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
            {item.messageText}
          </p>
        ) : (
          <p className="text-sm text-stone-300 italic">No message text</p>
        )}
        <QAFlagList flags={item.qaFlags} />
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-t border-[#F5F4F1] bg-[#FAFAF8] sticky bottom-0">
        {showReject ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={2}
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 placeholder:text-stone-300"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleRejectConfirm}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-rose-500 hover:bg-rose-600 text-white transition-colors disabled:opacity-50"
              >
                <X size={13} />
                Confirm reject
              </button>
              <button
                onClick={() => { setShowReject(false); setReason(""); }}
                className="px-3 py-2.5 rounded-lg text-sm font-medium text-stone-500 hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
            >
              <Check size={13} />
              Approve
            </button>
            <button
              onClick={() => setShowReject(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-white border border-[#E8E6E1] text-stone-600 hover:border-rose-300 hover:text-rose-600 transition-colors disabled:opacity-50"
            >
              <X size={13} />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ApprovalQueue({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function restoreItem(item: QueueItem, error: string) {
    setItems((prev) =>
      [...prev, item].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    );
    setErrors((prev) => ({ ...prev, [item.id]: error }));
    setTimeout(() => setErrors((prev) => { const n = { ...prev }; delete n[item.id]; return n; }), 4000);
  }

  async function handleApprove(item: QueueItem) {
    removeItem(item.id);
    const result = await approveMessageAction(item.sequenceId ?? "", item.id);
    if (result?.error) restoreItem(item, result.error);
  }

  async function handleReject(item: QueueItem, reason: string) {
    removeItem(item.id);
    const result = await rejectMessageAction(item.sequenceId ?? "", item.id, reason);
    if (result?.error) restoreItem(item, result.error);
  }

  if (items.length === 0) {
    return (
      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-5 py-16 text-center">
        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <Check size={18} className="text-emerald-500" />
        </div>
        <p className="text-sm font-medium text-stone-700">No messages pending approval</p>
        <p className="text-xs text-stone-400 mt-1">You&apos;re all caught up.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {items.map((item) => (
        <div key={item.id}>
          {errors[item.id] && (
            <p className="text-xs text-rose-500 mb-1.5 px-1">{errors[item.id]}</p>
          )}
          <MessageCard
            item={item}
            onApprove={() => handleApprove(item)}
            onReject={(reason) => handleReject(item, reason)}
          />
        </div>
      ))}
    </div>
  );
}
