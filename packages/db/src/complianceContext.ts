export type OutboundComplianceContext = {
  campaignId: string | null;
  sellerName: string | null;
  automated: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveOutboundComplianceContextFromInput(params: {
  body: unknown;
  defaultSellerName?: string | null;
}): OutboundComplianceContext {
  const body = (params.body as Record<string, unknown> | null) ?? {};
  const campaign = (body.campaign as Record<string, unknown> | null) ?? {};
  const campaignId = clean(campaign.id ?? body.campaignId) || null;
  const sellerName = clean(campaign.sellerName ?? body.sellerName ?? params.defaultSellerName) || params.defaultSellerName || null;
  const automated = campaign.automated !== undefined
    ? Boolean(campaign.automated)
    : body.automated !== undefined
      ? Boolean(body.automated)
      : true;

  return { campaignId, sellerName, automated };
}

export function resolveOutboundComplianceContextFromAttempt(params: {
  campaignId?: string | null;
  complianceSellerName?: string | null;
  complianceAutomated?: boolean | null;
  defaultSellerName?: string | null;
}): OutboundComplianceContext {
  return {
    campaignId: clean(params.campaignId) || null,
    sellerName: clean(params.complianceSellerName ?? params.defaultSellerName) || params.defaultSellerName || null,
    automated: params.complianceAutomated !== false,
  };
}
