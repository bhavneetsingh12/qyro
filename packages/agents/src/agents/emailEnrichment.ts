// Email enrichment adapter for QYRO Lead
// This is a minimal next-step implementation for Phase 1.
// It supports a mock fallback and provider-based flow via env vars.

import { db, decryptSecret, tenantIntegrationSecrets, tenants } from "@qyro/db";
import { eq } from "drizzle-orm";

export type EmailEnrichmentResult = {
  email: string | null;
  source: string;
};

type EnrichmentSettings = {
  provider: "mock" | "apollo" | "hunter";
  apolloApiKey: string | null;
  hunterApiKey: string | null;
  monthlyLimit: number;
  monthlyUsed: number;
};

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").split("/")[0] ?? "";
}

async function getTenantEnrichmentSettings(tenantId: string): Promise<EnrichmentSettings> {
  const [tenant, integrationSecrets] = await Promise.all([
    db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { metadata: true },
    }),
    db.query.tenantIntegrationSecrets.findFirst({
      where: eq(tenantIntegrationSecrets.tenantId, tenantId),
      columns: { apolloApiKey: true, hunterApiKey: true },
    }),
  ]);

  const meta = (tenant?.metadata as Record<string, unknown>) ?? {};
  const provider = (meta.enrichmentProvider as string | undefined)?.toLowerCase();

  return {
    provider: provider === "apollo" || provider === "hunter" ? provider : "mock",
    apolloApiKey: decryptSecret(integrationSecrets?.apolloApiKey ?? (typeof meta.apolloApiKey === "string" ? meta.apolloApiKey : null)),
    hunterApiKey: decryptSecret(integrationSecrets?.hunterApiKey ?? (typeof meta.hunterApiKey === "string" ? meta.hunterApiKey : null)),
    monthlyLimit: Number(meta.enrichmentMonthlyLimit ?? 2500),
    monthlyUsed: Number(meta.enrichmentMonthlyUsed ?? 0),
  };
}

async function incrementMonthlyUsage(tenantId: string, amount: number): Promise<void> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { metadata: true },
  });
  if (!tenant) return;

  const meta = (tenant.metadata as Record<string, unknown>) ?? {};
  const used = Number(meta.enrichmentMonthlyUsed ?? 0);

  await db
    .update(tenants)
    .set({
      metadata: {
        ...meta,
        enrichmentMonthlyUsed: used + amount,
      },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

async function enrichWithHunter(domain: string, apiKey: string): Promise<string | null> {
  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.searchParams.set("domain", domain);
  url.searchParams.set("api_key", apiKey);

  const resp = await fetch(url.toString(), { method: "GET" });
  if (!resp.ok) return null;

  const data = await resp.json().catch(() => null) as {
    data?: { emails?: Array<{ value?: string; confidence?: number }> };
  } | null;

  const ranked = (data?.data?.emails ?? [])
    .filter((e) => !!e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return ranked[0]?.value ?? null;
}

async function enrichWithApollo(domain: string, apiKey: string): Promise<string | null> {
  const resp = await fetch("https://api.apollo.io/api/v1/organizations/enrich", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({ domain }),
  });

  if (!resp.ok) return null;

  const org = await resp.json().catch(() => null) as {
    organization?: { primary_domain?: string };
  } | null;

  const primary = org?.organization?.primary_domain ?? domain;
  return primary ? `info@${primary}` : null;
}

export async function enrichEmail(
  tenantId: string,
  domain: string | null,
  businessName: string,
): Promise<EmailEnrichmentResult> {
  const settings = await getTenantEnrichmentSettings(tenantId);
  const provider = settings.provider;

  if (!domain) {
    return { email: null, source: "none" };
  }

  if (settings.monthlyUsed >= settings.monthlyLimit) {
    return { email: null, source: "credit_limit_reached" };
  }

  const domainOnly = normalizeDomain(domain);
  if (!domainOnly) {
    return { email: null, source: provider };
  }

  // Mock provider for local dev: generate a best-effort from domain
  if (provider === "mock") {
    const candidate = `info@${domainOnly}`;
    return { email: candidate, source: "mock" };
  }

  if (provider === "hunter") {
    if (!settings.hunterApiKey) {
      return { email: null, source: "hunter_no_api_key" };
    }
    const email = await enrichWithHunter(domainOnly, settings.hunterApiKey);
    if (email) await incrementMonthlyUsage(tenantId, 1);
    return { email, source: "hunter" };
  }

  if (provider === "apollo") {
    if (!settings.apolloApiKey) {
      return { email: null, source: "apollo_no_api_key" };
    }
    const email = await enrichWithApollo(domainOnly, settings.apolloApiKey);
    if (email) await incrementMonthlyUsage(tenantId, 1);
    return { email, source: "apollo" };
  }

  return { email: null, source: "unsupported_provider" };
}
