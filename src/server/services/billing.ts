import "@/lib/server-runtime";
import { FEATURES } from "@/lib/autumn";

/** Check if a user can use a feature. Returns { allowed, balance }. */
export async function checkFeature(_userId: string, _featureId: string) {
  // Billing checks bypassed — Autumn not configured
  return { allowed: true, balance: null };
}

/** Track usage of a feature after a successful action. */
export async function trackUsage(_userId: string, _featureId: string, _value = 1) {
  // Billing tracking bypassed — Autumn not configured
  return;
}

/** Get a checkout URL to subscribe the user to a plan. */
export async function attachPlan(_userId: string, _planId: string) {
  // Billing bypassed — Autumn not configured
  return { paymentUrl: null };
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
