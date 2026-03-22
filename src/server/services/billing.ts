import "@/lib/server-runtime";
import { autumn, FEATURES } from "@/lib/autumn";

/** Check if a user can use a feature. Returns { allowed, balance }. */
export async function checkFeature(userId: string, featureId: string) {
  const result = await autumn.check({ customerId: userId, featureId });
  return {
    allowed: result.allowed,
    balance: result.balance ?? null,
  };
}

/** Track usage of a feature after a successful action. */
export async function trackUsage(userId: string, featureId: string, value = 1) {
  return autumn.track({ customerId: userId, featureId, value });
}

/** Get a checkout URL to subscribe the user to a plan. */
export async function attachPlan(userId: string, planId: string) {
  const result = await autumn.billing.attach({ customerId: userId, planId });
  return { paymentUrl: result.paymentUrl ?? null };
}

/** Helpers scoped to specific features */
export const billing = {
  checkSearches: (userId: string) => checkFeature(userId, FEATURES.SEARCHES),
  checkLeads: (userId: string) => checkFeature(userId, FEATURES.LEADS),
  checkDmOutreach: (userId: string) => checkFeature(userId, FEATURES.DM_OUTREACH),
  checkProjects: (userId: string) => checkFeature(userId, FEATURES.PROJECTS),

  trackSearch: (userId: string) => trackUsage(userId, FEATURES.SEARCHES),
  trackLead: (userId: string, count = 1) => trackUsage(userId, FEATURES.LEADS, count),
  trackDm: (userId: string, count = 1) => trackUsage(userId, FEATURES.DM_OUTREACH, count),
  trackProject: (userId: string) => trackUsage(userId, FEATURES.PROJECTS),
};
