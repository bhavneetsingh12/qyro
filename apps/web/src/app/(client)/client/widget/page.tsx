"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Copy, CheckCheck, MessageSquare } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");
const WIDGET_SRC = "https://widget.qyro.ai/widget.js";

export default function WidgetPage() {
  const { getToken } = useAuth();
  const [tenantId,   setTenantId]   = useState<string | null>(null);
  const [widgetToken, setWidgetToken] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");
  const [copied,     setCopied]     = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTenantId(data.id);
          setWidgetToken(String(data.widgetToken ?? ""));
          setTenantName(data.name ?? "");
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getToken]);

  const snippet = tenantId && widgetToken
    ? `<!-- QYRO Assist widget -->\n<script\n  src="${WIDGET_SRC}"\n  data-tenant-id="${tenantId}"\n  data-widget-token="${widgetToken}"\n  data-api-base="${API_URL}"\n  defer\n></script>`
    : "";

  function handleCopy() {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div className="p-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Widget</h1>
        <p className="text-sm text-stone-400 mt-0.5">Embed the QYRO Assist chat widget on your website</p>
      </div>

      {loading ? (
        <div className="mt-6 space-y-5">
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-3/4" />
          </div>
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#F0EEE9] flex items-center justify-between">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-7 w-16 rounded-lg" />
            </div>
            <div className="px-5 py-4 bg-[#FAFAF8]">
              <div className="skeleton h-3 w-full mb-2" />
              <div className="skeleton h-3 w-4/5 mb-2" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {/* Instructions */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-4">
            <p className="text-sm font-semibold text-stone-800">Installation</p>

            <ol className="space-y-2 text-sm text-stone-600 list-decimal list-inside">
              <li>Copy the code snippet below.</li>
              <li>Open your website&apos;s HTML source.</li>
              <li>Paste it just before the <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded font-mono">&lt;/body&gt;</code> closing tag.</li>
              <li>Save and publish your site — the widget appears automatically.</li>
            </ol>
          </div>

          {/* Code snippet */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0EEE9]">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Embed code</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
              >
                {copied ? (
                  <>
                    <CheckCheck size={13} />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="px-5 py-4 text-xs text-stone-700 font-mono leading-relaxed overflow-x-auto bg-[#FAFAF8] select-all whitespace-pre">
              {snippet}
            </pre>
          </div>

          {/* Widget preview */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-4">
            <p className="text-sm font-semibold text-stone-800">Preview</p>
            <p className="text-xs text-stone-400">
              This is how the widget button will appear in the corner of your website.
            </p>

            {/* Simulated widget button */}
            <div className="relative h-32 bg-[#F5F4F1] rounded-xl border border-[#E8E6E1] overflow-hidden">
              <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-stone-400">
                Your website
              </p>
              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                <div className="bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 shadow-md text-xs text-stone-600 font-medium">
                  {tenantName ? `Chat with ${tenantName}` : "Chat with us"}
                </div>
                <div className="w-10 h-10 rounded-full bg-amber-500 shadow-lg flex items-center justify-center">
                  <MessageSquare size={18} className="text-white" strokeWidth={1.75} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
