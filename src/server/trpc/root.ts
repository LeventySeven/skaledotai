import "@/lib/server-runtime";
import { router } from "./trpc";
import { projectsRouter } from "./routers/projects";
import { leadsRouter } from "./routers/leads";
import { searchRouter } from "./routers/search";
import { statsRouter } from "./routers/stats";
import { outreachRouter } from "./routers/outreach";
import { settingsRouter } from "./routers/settings";
// import { billingRouter } from "./routers/billing";
import { contraRouter } from "./routers/contra";
import { monitoringRouter } from "./routers/monitoring";

export const appRouter = router({
  projects: projectsRouter,
  leads: leadsRouter,
  search: searchRouter,
  stats: statsRouter,
  outreach: outreachRouter,
  settings: settingsRouter,
  // billing: billingRouter,
  contra: contraRouter,
  monitoring: monitoringRouter,
});

export type AppRouter = typeof appRouter;
