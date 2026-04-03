import { type AgentResult } from "../runner";
export type LeadDiscoveryInput = {
    tenantId: string;
    niche: string;
    location: string;
    maxResults: number;
    radius?: number;
    filters?: LeadFilters;
    runId?: string;
};
export type LeadFilters = {
    minEmployees?: number;
    maxEmployees?: number;
    minRevenue?: number;
    maxRevenue?: number;
    excludeDomains?: string[];
};
export type LeadDiscoveryOutput = {
    leadsQueued: number;
    duplicatesSkipped: number;
    sourceBreakdown: {
        google: number;
        places: number;
    };
};
export declare function runLeadDiscovery(input: LeadDiscoveryInput): Promise<AgentResult<LeadDiscoveryOutput>>;
//# sourceMappingURL=leadDiscovery.d.ts.map