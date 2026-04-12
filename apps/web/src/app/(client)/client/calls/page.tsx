"use client";

import { Fragment, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type CallRow = {
  id: string;
  prospectName: string | null;
  callSid: string | null;
  duration: number | null;
  durationSeconds: number | null;
  outcome: string | null;
  recordingUrl: string | null;
  transcriptText: string | null;
  transcriptJson: Array<{ role?: string; content?: string; ts?: string }> | null;
  transcriptUrl: string | null;
  createdAt: string;
};

function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Number(seconds ?? 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatOutcomeLabel(outcome: string | null): string {
  if (!outcome) return "-";
  if (outcome === "missing_prospect_phone") return "lead missing phone";
  if (outcome === "missing_voice_number") return "assist voice number missing";
  if (outcome === "missing_phone") return "phone configuration incomplete";
  if (outcome === "outside_calling_hours") return "scheduled for local calling hours";
  if (outcome === "capacity_throttled") return "waiting for outbound capacity";
  if (outcome === "do_not_contact") return "do not contact";
  if (outcome === "dial_failed_retry") return "dial failed, retry scheduled";
  if (outcome === "dial_failed") return "dial failed";
  if (outcome === "no_answer") return "no answer";
  return outcome.replace(/_/g, " ");
}

function normalizeTurns(row: CallRow): Array<{ role: string; content: string; ts?: string }> {
  const raw = Array.isArray(row.transcriptJson) ? row.transcriptJson : [];
  const turns = raw
    .map((turn) => ({
      role: String(turn?.role ?? "speaker").trim() || "speaker",
      content: String(turn?.content ?? "").trim(),
      ts: turn?.ts ? String(turn.ts) : undefined,
    }))
    .filter((turn) => turn.content.length > 0);

  if (turns.length > 0) return turns;

  if (row.transcriptText && row.transcriptText.trim().length > 0) {
    return [{ role: "transcript", content: row.transcriptText.trim() }];
  }

  return [];
}

function exportTranscriptText(row: CallRow): void {
  const turns = normalizeTurns(row);
  const text = turns.length > 0
    ? turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
    : (row.transcriptText ?? "");

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `call-transcript-${row.id}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ClientCallsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<string>("");

  async function load(selectedOutcome = outcome) {
    const token = await getToken();
    if (!token) return;
    const qp = selectedOutcome ? `?outcome=${encodeURIComponent(selectedOutcome)}` : "";
    const res = await fetch(`${API_URL}/api/v1/assist/calls${qp}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Call History</h1>
          <p className="text-sm text-stone-400 mt-0.5">Recordings, outcomes, and full transcript playback</p>
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Filter by outcome</label>
          <select
            value={outcome}
            onChange={(e) => {
              const v = e.target.value;
              setOutcome(v);
              setLoading(true);
              load(v);
            }}
            className="input"
          >
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="in_progress">In progress</option>
            <option value="no-answer">No answer</option>
            <option value="busy">Busy</option>
            <option value="failed">Failed</option>
            <option value="answered">Answered</option>
            <option value="missing_prospect_phone">Lead missing phone</option>
            <option value="missing_voice_number">Assist voice number missing</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-stone-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="mt-6 text-sm text-stone-500">No call logs found.</div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[12px] border border-[#E8E6E1] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Prospect</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isExpanded = expandedCallId === row.id;
                const turns = normalizeTurns(row);
                const hasTranscript = turns.length > 0;
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-[#F0EFEA]">
                      <td className="px-4 py-3 text-stone-700">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-stone-700">{row.prospectName || "Unknown customer"}</td>
                      <td className="px-4 py-3 text-stone-700">{formatOutcomeLabel(row.outcome)}</td>
                      <td className="px-4 py-3 text-stone-700">{formatDuration(row.durationSeconds ?? row.duration)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          {row.recordingUrl ? (
                            <a
                              href={row.recordingUrl}
                              className="text-emerald-700 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Play recording
                            </a>
                          ) : (
                            <span className="text-stone-400">No recording</span>
                          )}

                          {hasTranscript ? (
                            <button
                              type="button"
                              className="text-amber-700 hover:underline"
                              onClick={() => setExpandedCallId(isExpanded ? null : row.id)}
                            >
                              {isExpanded ? "Hide transcript" : "Show transcript"}
                            </button>
                          ) : row.transcriptUrl ? (
                            <a href={row.transcriptUrl} className="text-amber-700 hover:underline" target="_blank" rel="noreferrer">
                              View transcript
                            </a>
                          ) : (
                            <span className="text-stone-400">No transcript</span>
                          )}

                          {hasTranscript && (
                            <button
                              type="button"
                              className="text-violet-700 hover:underline"
                              onClick={() => exportTranscriptText(row)}
                            >
                              Export text
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && hasTranscript && (
                      <tr className="border-t border-[#F6F4EF] bg-stone-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="space-y-2 max-h-72 overflow-auto rounded-md border border-stone-200 bg-white p-3">
                            {turns.map((turn, idx) => (
                              <div key={`${row.id}-turn-${idx}`} className="text-sm">
                                <span className="font-semibold text-stone-700 capitalize">{turn.role}:</span>
                                <span className="text-stone-700 ml-1">{turn.content}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
