export type Platform = "twitter";

export type Priority = "P0" | "P1";

export type LeadStage = "found" | "messaged" | "replied" | "agreed";

export type DiscoverySource =
  | "profile_search"
  | "post_search"
  | "reply_search"
  | "followers"
  | "following";

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

export type Lead = {
  id: string;
  // id is used as crmId since CRM fields live on the lead itself
  crmId?: string;
  projectId?: string;
  projectName?: string;
  xUserId?: string;
  name: string;
  handle: string;
  bio: string;
  platform: Platform;
  followers: number;
  following?: number;
  avatarUrl?: string;
  profileUrl?: string;
  email?: string;
  budget?: number;
  priority: Priority;
  dmComfort: boolean;
  theAsk: string;
  inOutreach: boolean;
  stage: LeadStage;
  discoverySource?: DiscoverySource;
  discoveryQuery?: string;
  createdAt?: string;
  updatedAt?: string;
  editable?: boolean;
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

export type LeadPatch = Partial<{
  stage: LeadStage;
  priority: Priority;
  dmComfort: boolean;
  theAsk: string;
  inOutreach: boolean;
  email: string | null;
  budget: number | null;
}>;
