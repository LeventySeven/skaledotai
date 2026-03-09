import type { Priority } from "@/lib/validations/shared";
export type { Platform, Priority, LeadStage, DiscoverySource } from "@/lib/validations/shared";
export type { Lead, LeadPatch } from "@/lib/validations/leads";

export type PostStats = {
  id: string;
  leadId: string;
  fetchedAt: string;
  postCount: number;
  avgViews?: number;
  avgLikes?: number;
  avgReplies?: number;
  avgReposts?: number;
  topTopics?: string[];
};

export type Project = {
  id: string;
  name: string;
  query?: string;
  seedUsername?: string;
  createdAt: string;
  leadCount?: number;
};

export type ProjectPreviewLead = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  followers: number;
  priority: Priority;
  avatarUrl?: string;
};

export type ProjectOverview = Project & {
  leadCount: number;
  avgFollowers: number;
  topFollowers: number;
  p0LeadCount: number;
  previewLeads: ProjectPreviewLead[];
};

export type ProjectAnalysisResult = {
  summary: string;
  selectedLeadIds: string[];
  project: Project;
  previewLeads: ProjectPreviewLead[];
  analyzedProjectIds: string[];
};

export type OutreachTemplate = {
  id: string;
  title: string;
  subject: string;
  body: string;
  replyRate: string;
  generated?: boolean;
};

export type XProfile = {
  xUserId: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  profileUrl?: string;
  followersCount: number;
  followingCount: number;
  tweetCount?: number;
  listedCount?: number;
  verified?: boolean;
  verifiedType?: string;
  location?: string;
  url?: string;
};

export type SearchLeadInput = {
  query: string;
  projectId?: string;
  projectName?: string;
  followerUsername?: string;
  minFollowers?: number;
};

