import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, postStats, projectLeads, projects } from "@/db/schema";
import { generateOutreachTemplate } from "@/lib/openai";
import type { Lead, OutreachTemplate } from "@/lib/types";
import { listOutreachQueue } from "./leads";

const STANDARD_TEMPLATE_EXAMPLES: Array<Omit<OutreachTemplate, "id" | "generated">> = [
  {
    title: "Template 1",
    subject: "Quick note",
    body: "Hi {{name}},\n\nI came across your work and was really impressed.\nWould love to connect!\n\nBest,",
    replyRate: "35%",
  },
  {
    title: "Template 2",
    subject: "Collaboration idea",
    body: "Hello {{name}},\n\nI hope this message finds you well! I admire your recent projects and would be thrilled to discuss potential collaborations.\n\nCheers,",
    replyRate: "32%",
  },
  {
    title: "Template 3",
    subject: "Big fan of your work",
    body: "Dear {{name}},\n\nI’ve been following your work and it truly resonates with me. Let’s explore ways we can work together!\n\nRegards,",
    replyRate: "30%",
  },
  {
    title: "Template 4",
    subject: "Loved your recent insights",
    body: "Hey {{name}},\n\nYour insights into the industry are remarkable! I’d love to chat about how we can share knowledge and experiences.\n\nSincerely,",
    replyRate: "45%",
  },
];

export async function getOutreachQueue(userId: string): Promise<Lead[]> {
  return listOutreachQueue(userId);
}

export async function buildAiOutreachTemplate(input: {
  userId: string;
  projectIds?: string[];
  leadIds?: string[];
  requestedStyle?: string;
}): Promise<Omit<OutreachTemplate, "id" | "generated">> {
  const projectIds = [...new Set(input.projectIds ?? [])];
  const leadIds = [...new Set(input.leadIds ?? [])];

  const ownedProjects = projectIds.length > 0
    ? await db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, input.userId), inArray(projects.id, projectIds)))
    : [];

  if (projectIds.length > 0 && ownedProjects.length !== projectIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "One or more selected projects were not found." });
  }

  const conditions = [eq(leads.userId, input.userId)];
  if (leadIds.length > 0) conditions.push(inArray(leads.id, leadIds));
  if (projectIds.length > 0) conditions.push(inArray(projectLeads.projectId, projectIds));

  const rows = await db
    .select({
      lead: leads,
      stats: postStats,
      projectName: projects.name,
    })
    .from(leads)
    .leftJoin(postStats, eq(postStats.leadId, leads.id))
    .leftJoin(projectLeads, eq(projectLeads.leadId, leads.id))
    .leftJoin(projects, eq(projects.id, projectLeads.projectId))
    .where(and(...conditions))
    .orderBy(desc(leads.followers));

  const deduped = new Map<string, {
    lead: typeof leads.$inferSelect;
    stats: typeof postStats.$inferSelect | null;
    projectNames: Set<string>;
  }>();

  for (const row of rows) {
    const existing = deduped.get(row.lead.id);
    if (existing) {
      if (row.projectName) existing.projectNames.add(row.projectName);
      continue;
    }

    deduped.set(row.lead.id, {
      lead: row.lead,
      stats: row.stats,
      projectNames: new Set(row.projectName ? [row.projectName] : []),
    });
  }

  const candidates = [...deduped.values()].slice(0, 12);
  if (candidates.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No leads found for the selected projects or users.",
    });
  }

  return generateOutreachTemplate({
    projectNames: ownedProjects.map((project) => project.name),
    leads: candidates.map(({ lead, stats }) => ({
      name: lead.name,
      handle: lead.handle,
      bio: lead.bio,
      followers: lead.followers,
      topics: stats?.topTopics ?? [],
      postActivity: stats
        ? `${stats.postCount} posts, ${stats.avgLikes ? Number(stats.avgLikes) : 0} avg likes, ${stats.avgReplies ? Number(stats.avgReplies) : 0} avg replies`
        : "No stored post stats yet",
    })),
    templateExamples: STANDARD_TEMPLATE_EXAMPLES,
    requestedStyle: input.requestedStyle,
  });
}

export function getStandardOutreachTemplates(): Array<OutreachTemplate> {
  return STANDARD_TEMPLATE_EXAMPLES.map((template, index) => ({
    id: `standard-${index + 1}`,
    ...template,
    generated: false,
  }));
}
