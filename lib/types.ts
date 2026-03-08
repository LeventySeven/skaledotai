// Platform values stored in DB are always 'twitter' | 'linkedin'
// 'both' only exists as a search-form option on the search page
export type Platform = "twitter" | "linkedin";

export type PostStats = {
  id: string;
  leadId: string;
  fetchedAt: string;
  postCount: number;
  avgViews?: number;
  avgLikes?: number;
  avgReplies?: number;
  avgRetweets?: number;
  topTopics?: string[];
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  leadCount?: number;
};

export type Lead = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  platform: Platform;
  followers: number;
  following?: number;
  avatarUrl?: string;
  profileUrl?: string;
  linkedinUrl?: string;
  email?: string;
  budget?: number;

  // CRM fields
  priority: "P0" | "P1";
  dmComfort: boolean;
  theAsk: string;
  hasDmed: boolean;
  replied: boolean;
  inOutreach: boolean;

  createdAt?: string;
};
