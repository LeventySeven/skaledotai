export type { Platform, Priority, LeadStage, DiscoverySource } from "@/lib/validations/shared";
export type { Lead, LeadPatch } from "@/lib/validations/leads";
export type { Project, ProjectPreviewLead, ProjectOverview, ProjectAnalysisResult } from "@/lib/validations/projects";

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

