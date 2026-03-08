import { supabase } from "@/lib/supabase";
import type { Lead, Platform, Project, PostStats } from "@/lib/types";

// ── Row shape from Supabase (snake_case) ──────────────────────────────────────
type Row = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  platform: string;
  followers: number;
  following: number | null;
  avatar_url: string | null;
  profile_url: string | null;
  linkedin_url: string | null;
  email: string | null;
  budget: number | null;
  priority: string;
  dm_comfort: boolean;
  the_ask: string;
  has_dmed: boolean;
  replied: boolean;
  in_outreach: boolean;
  created_at: string;
};

function rowToLead(r: Row): Lead {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    bio: r.bio,
    platform: r.platform as Platform,
    followers: r.followers,
    following: r.following ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    profileUrl: r.profile_url ?? undefined,
    linkedinUrl: r.linkedin_url ?? undefined,
    email: r.email ?? undefined,
    budget: r.budget ?? undefined,
    priority: (r.priority ?? "P1") as "P0" | "P1",
    dmComfort: r.dm_comfort,
    theAsk: r.the_ask,
    hasDmed: r.has_dmed,
    replied: r.replied,
    inOutreach: r.in_outreach,
    createdAt: r.created_at,
  };
}

type GetLeadsOptions = {
  page?: number;
  pageSize?: number;
  platform?: string;
  sort?: string;
  search?: string;
  inOutreach?: boolean;
};

export async function getLeads(opts: GetLeadsOptions = {}): Promise<{ leads: Lead[]; total: number }> {
  const { page = 1, pageSize = 25, platform, sort = "followers-desc", search, inOutreach } = opts;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase.from("leads").select("*", { count: "exact" });

  if (platform && platform !== "all") q = q.eq("platform", platform);
  if (search) q = q.or(`name.ilike.%${search}%,bio.ilike.%${search}%,handle.ilike.%${search}%`);
  if (inOutreach !== undefined) q = q.eq("in_outreach", inOutreach);

  if (sort === "followers-desc") q = q.order("followers", { ascending: false });
  else if (sort === "followers-asc") q = q.order("followers", { ascending: true });
  else q = q.order("name", { ascending: true });

  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;
  return { leads: (data as Row[]).map(rowToLead), total: count ?? 0 };
}

// Raw lead shape coming from Apify (before DB IDs are assigned)
type RawLead = Omit<Lead, "id" | "priority" | "dmComfort" | "theAsk" | "hasDmed" | "replied" | "inOutreach" | "createdAt">;

export async function upsertLeads(leads: RawLead[]): Promise<Lead[]> {
  if (leads.length === 0) return [];

  const rows = leads.map((l) => ({
    name: l.name,
    handle: l.handle,
    bio: l.bio,
    platform: l.platform,
    followers: l.followers,
    following: l.following ?? null,
    avatar_url: l.avatarUrl ?? null,
    profile_url: l.profileUrl ?? null,
    linkedin_url: l.linkedinUrl ?? null,
    email: l.email ?? null,
  }));

  const { data, error } = await supabase
    .from("leads")
    .upsert(rows, {
      onConflict: "handle,platform",
      // Only update profile fields, never overwrite CRM fields
      ignoreDuplicates: false,
    })
    .select("*");

  if (error) throw error;
  return (data as Row[]).map(rowToLead);
}

type LeadPatch = Partial<Pick<Lead, "priority" | "dmComfort" | "theAsk" | "hasDmed" | "replied" | "inOutreach" | "email" | "budget">>;

export async function updateLead(id: string, patch: LeadPatch): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.dmComfort !== undefined) row.dm_comfort = patch.dmComfort;
  if (patch.theAsk !== undefined) row.the_ask = patch.theAsk;
  if (patch.hasDmed !== undefined) row.has_dmed = patch.hasDmed;
  if (patch.replied !== undefined) row.replied = patch.replied;
  if (patch.inOutreach !== undefined) row.in_outreach = patch.inOutreach;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.budget !== undefined) row.budget = patch.budget;
  row.updated_at = new Date().toISOString();

  const { error } = await supabase.from("leads").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) throw error;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at, project_leads(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    leadCount: (r.project_leads as { count: number }[])?.[0]?.count ?? 0,
  }));
}

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name })
    .select("id, name, created_at")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, createdAt: data.created_at, leadCount: 0 };
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function addLeadsToProject(projectId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  const rows = leadIds.map((lead_id) => ({ project_id: projectId, lead_id }));
  const { error } = await supabase.from("project_leads").upsert(rows, { onConflict: "project_id,lead_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function getLeadsByProject(projectId: string, opts: GetLeadsOptions = {}): Promise<{ leads: Lead[]; total: number }> {
  const { page = 1, pageSize = 25, platform, sort = "followers-desc", search } = opts;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("project_leads")
    .select("leads!inner(*)", { count: "exact" })
    .eq("project_id", projectId);

  if (platform && platform !== "all") q = q.eq("leads.platform", platform);
  if (search) q = q.or(`name.ilike.%${search}%,bio.ilike.%${search}%,handle.ilike.%${search}%`, { referencedTable: "leads" });

  if (sort === "followers-desc") q = q.order("followers", { referencedTable: "leads", ascending: false });
  else if (sort === "followers-asc") q = q.order("followers", { referencedTable: "leads", ascending: true });
  else q = q.order("name", { referencedTable: "leads", ascending: true });

  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;
  const leads = (data ?? []).map((r) => rowToLead(r.leads as unknown as Row));
  return { leads, total: count ?? 0 };
}

// ── Post Stats ────────────────────────────────────────────────────────────────

export async function getPostStats(leadId: string): Promise<PostStats | null> {
  const { data, error } = await supabase
    .from("post_stats")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    leadId: data.lead_id,
    fetchedAt: data.fetched_at,
    postCount: data.post_count,
    avgViews: data.avg_views ?? undefined,
    avgLikes: data.avg_likes ?? undefined,
    avgReplies: data.avg_replies ?? undefined,
    avgRetweets: data.avg_retweets ?? undefined,
    topTopics: data.top_topics ?? undefined,
  };
}

export async function upsertPostStats(stats: Omit<PostStats, "id" | "fetchedAt">): Promise<PostStats> {
  const { data, error } = await supabase
    .from("post_stats")
    .upsert({
      lead_id: stats.leadId,
      post_count: stats.postCount,
      avg_views: stats.avgViews ?? null,
      avg_likes: stats.avgLikes ?? null,
      avg_replies: stats.avgReplies ?? null,
      avg_retweets: stats.avgRetweets ?? null,
      top_topics: stats.topTopics ?? null,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "lead_id" })
    .select("*")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    leadId: data.lead_id,
    fetchedAt: data.fetched_at,
    postCount: data.post_count,
    avgViews: data.avg_views ?? undefined,
    avgLikes: data.avg_likes ?? undefined,
    avgReplies: data.avg_replies ?? undefined,
    avgRetweets: data.avg_retweets ?? undefined,
    topTopics: data.top_topics ?? undefined,
  };
}
