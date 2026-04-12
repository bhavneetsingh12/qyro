export type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

export function normalizeProductAccess(value: unknown): ProductAccess {
  if (!value || typeof value !== "object") {
    return { lead: false, assist: false };
  }

  const candidate = value as Record<string, unknown>;
  return {
    lead: candidate.lead === true,
    assist: candidate.assist === true,
  };
}

export function getPreferredWorkspace(params: {
  productAccess: ProductAccess;
  tenantType?: string | null;
}): string | null {
  const { productAccess, tenantType } = params;

  if (productAccess.lead && !productAccess.assist) return "/internal/dashboard";
  if (productAccess.assist && !productAccess.lead) return "/client/dashboard";
  if (productAccess.lead && productAccess.assist) {
    return tenantType === "assistant" ? "/client/dashboard" : "/internal/dashboard";
  }

  return null;
}

export function hasAnyProductAccess(productAccess: ProductAccess): boolean {
  return productAccess.lead || productAccess.assist;
}
