// Re-exports from validation schemas for backward compatibility.
// Prefer importing directly from @/lib/validations/* in new code.

export type { Platform, Priority, LeadStage, DiscoverySource } from "@/lib/validations/shared";
export type { Lead, LeadPatch } from "@/lib/validations/leads";
export type { Project, ProjectPreviewLead, ProjectOverview, ProjectAnalysisResult } from "@/lib/validations/projects";
export type { PostStats } from "@/lib/validations/stats";
export type { OutreachTemplate } from "@/lib/validations/outreach";
export type { SearchLeadInput, XProfile } from "@/lib/validations/search";
