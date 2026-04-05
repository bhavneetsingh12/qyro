"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { Phone, RefreshCw, Ban, Clock, CheckCircle2, AlertCircle, Loader2, Voicemail, Upload } from "lucide-react";
import clsx from "clsx";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type CallAttempt = {
  id: string;
  prospectId: string | null;
  phone: string | null;
  businessName: string | null;
  status: string;
  outcome: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  callSid: string | null;
  dndAt: string | null;
  createdAt: string;
};

type ImportContact = {
  businessName: string;
  phone?: string;
  email?: string;
  domain?: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  queued:    { label: "Queued",    color: "text-amber-600 bg-amber-50 border-amber-200",  Icon: Clock },
  dialing:   { label: "Dialing",   color: "text-blue-600 bg-blue-50 border-blue-200",    Icon: Phone },
  ringing:   { label: "Ringing",   color: "text-blue-600 bg-blue-50 border-blue-200",    Icon: Phone },
  completed: { label: "Completed", color: "text-green-600 bg-green-50 border-green-200", Icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "text-red-600 bg-red-50 border-red-200",        Icon: AlertCircle },
  dnd:       { label: "DND",       color: "text-stone-500 bg-stone-100 border-stone-200", Icon: Ban },
  voicemail: { label: "Voicemail", color: "text-purple-600 bg-purple-50 border-purple-200", Icon: Voicemail },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-stone-500 bg-stone-100 border-stone-200", Icon: Clock };
  const { Icon, label, color } = cfg;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", color)}>
      <Icon size={11} strokeWidth={2} />
      {label}
    </span>
  );
}

function fmt(ts: string | null) {
  if (!ts) return "–";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseDelimitedLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseContacts(input: string): ImportContact[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => parseDelimitedLine(line, delimiter));
  const firstRow = rows[0].map((value) => value.toLowerCase());
  const looksLikeHeader = firstRow.some((value) => ["businessname", "business", "name", "phone", "email", "domain"].includes(value.replace(/[^a-z]/g, "")));

  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  const headerMap = looksLikeHeader
    ? rows[0].map((value) => value.toLowerCase().replace(/[^a-z]/g, ""))
    : ["businessname", "phone", "email", "domain"];

  return dataRows
    .map((row) => {
      const record: ImportContact = { businessName: "" };

      row.forEach((value, index) => {
        const key = headerMap[index] ?? "";
        if (["businessname", "business", "name"].includes(key)) record.businessName = value;
        if (key === "phone") record.phone = value;
        if (key === "email") record.email = value;
        if (key === "domain" || key === "website") record.domain = value;
      });

      if (!looksLikeHeader) {
        record.businessName = row[0] ?? "";
        record.phone = row[1] ?? "";
        record.email = row[2] ?? "";
        record.domain = row[3] ?? "";
      }

      return {
        businessName: record.businessName.trim(),
        phone: record.phone?.trim() || undefined,
        email: record.email?.trim() || undefined,
        domain: record.domain?.trim() || undefined,
      };
    })
    .filter((row) => row.businessName);
}

export default function OutboundPipelinePage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<CallAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [queueImportedCalls, setQueueImportedCalls] = useState(true);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/v1/assist/outbound-calls/pipeline?limit=200`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setRows(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 20_000);
    return () => clearInterval(iv);
  }, [load]);

  async function cancelAttempt(attemptId: string) {
    setCancellingId(attemptId);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      await fetch(`${API_URL}/api/v1/assist/outbound-calls/attempt/${attemptId}/cancel`, {
        method: "POST",
        headers,
      });
      await load(true);
    } finally {
      setCancellingId(null);
    }
  }

  async function importContacts() {
    const contacts = parseContacts(importText);
    if (contacts.length === 0) {
      setError("Paste contacts first. Use CSV columns: businessName, phone, email, domain.");
      return;
    }

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const createdIds: string[] = [];
      const results = await Promise.allSettled(
        contacts.map(async (contact) => {
          const res = await fetch(`${API_URL}/api/leads`, {
            method: "POST",
            headers,
            body: JSON.stringify(contact),
          });

          const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; message?: string };
          if (!res.ok) {
            throw new Error(body.message ?? `Failed to create ${contact.businessName}`);
          }

          if (body.data?.id) createdIds.push(body.data.id);
          return contact;
        }),
      );

      const created = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - created;

      let queued = 0;
      if (queueImportedCalls && createdIds.length > 0) {
        const enqueueRes = await fetch(`${API_URL}/api/v1/assist/outbound-calls/enqueue`, {
          method: "POST",
          headers,
          body: JSON.stringify({ prospectIds: createdIds }),
        });

        const enqueueBody = (await enqueueRes.json().catch(() => ({}))) as { data?: { enqueued?: number }; message?: string };
        if (!enqueueRes.ok) {
          throw new Error(enqueueBody.message ?? "Contacts were created but queueing calls failed");
        }

        queued = Number(enqueueBody.data?.enqueued ?? 0);
      }

      setImportResult(`Imported ${created} contact${created === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}${queueImportedCalls ? `, ${queued} queued for calls` : ""}.`);
      setImportText("");
      await load(true);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import contacts");
    } finally {
      setImporting(false);
    }
  }

  const active  = rows.filter(r => ["queued", "dialing", "ringing"].includes(r.status));
  const done    = rows.filter(r => !["queued", "dialing", "ringing"].includes(r.status));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Outbound Pipeline</h1>
          <p className="text-sm text-stone-500 mt-1">
            Leads queued from QYRO Lead and their call status.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Add Contacts</h2>
            <p className="text-sm text-stone-500 mt-1">
              Paste CSV rows or upload a CSV to add leads directly in QYRO Assist.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 cursor-pointer hover:bg-stone-100 transition-colors">
            <Upload size={14} />
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setImportText(await file.text());
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={"businessName,phone,email,domain\nAcme Dental,+15035551234,frontdesk@acme.com,acmedental.com"}
          className="w-full min-h-[140px] rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
          disabled={importing}
        />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={queueImportedCalls}
              onChange={(event) => setQueueImportedCalls(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
            Queue calls immediately for imported contacts with phone numbers
          </label>

          <button
            onClick={importContacts}
            disabled={importing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import Contacts"}
          </button>
        </div>

        {importResult && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {importResult}
          </div>
        )}
      </section>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-stone-400">
          <Loader2 size={24} className="animate-spin mr-3" />
          Loading pipeline…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center">
          <Phone size={36} className="mx-auto text-stone-300 mb-3" strokeWidth={1.5} />
          <p className="text-stone-600 font-medium">No outbound calls yet</p>
          <p className="text-stone-400 text-sm mt-1">
            Select leads in QYRO Lead and click &ldquo;Queue Calls Selected&rdquo; to add them here.
          </p>
        </div>
      )}

      {/* Active calls table */}
      {!loading && active.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 uppercase tracking-wide">
            Active · {active.length}
          </h2>
          <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-xs text-stone-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Business</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Attempts</th>
                  <th className="text-left px-4 py-3 font-medium">Next attempt</th>
                  <th className="text-left px-4 py-3 font-medium">Queued</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {active.map(row => (
                  <tr key={row.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">
                      {row.businessName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600 font-mono">{row.phone ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-stone-600">{row.attemptCount} / {row.maxAttempts}</td>
                    <td className="px-4 py-3 text-stone-500">{fmt(row.nextAttemptAt)}</td>
                    <td className="px-4 py-3 text-stone-400">{fmt(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cancelAttempt(row.id)}
                        disabled={cancellingId === row.id}
                        className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        {cancellingId === row.id ? "…" : "Cancel"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Completed / past calls table */}
      {!loading && done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 uppercase tracking-wide">
            History · {done.length}
          </h2>
          <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-xs text-stone-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Business</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Outcome</th>
                  <th className="text-left px-4 py-3 font-medium">Attempts</th>
                  <th className="text-left px-4 py-3 font-medium">Last attempt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {done.map(row => (
                  <tr key={row.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">
                      {row.businessName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600 font-mono">{row.phone ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-stone-500 capitalize">{row.outcome ?? "—"}</td>
                    <td className="px-4 py-3 text-stone-600">{row.attemptCount} / {row.maxAttempts}</td>
                    <td className="px-4 py-3 text-stone-400">{fmt(row.lastAttemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
