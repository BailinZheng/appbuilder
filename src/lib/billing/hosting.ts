import { HOSTING_GRACE_DAYS } from "./catalog";

export type HostingStatus =
  | { state: "none" } // never bought hosting
  | { state: "active"; until: Date }
  | { state: "grace"; until: Date; offlineAt: Date } // expired, still online for the grace period
  | { state: "lapsed"; until: Date }; // offline, but nothing is deleted

/** Pure helper – usable on server and client. */
export function hostingStatus(hostedUntil: Date | null, now = new Date()): HostingStatus {
  if (!hostedUntil) return { state: "none" };
  if (hostedUntil > now) return { state: "active", until: hostedUntil };
  const offlineAt = new Date(hostedUntil.getTime() + HOSTING_GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (offlineAt > now) return { state: "grace", until: hostedUntil, offlineAt };
  return { state: "lapsed", until: hostedUntil };
}

/** Publishing needs a currently paid hosting period (not just the grace period). */
export const canPublish = (hostedUntil: Date | null, now = new Date()) =>
  hostingStatus(hostedUntil, now).state === "active";

/** A published site is served while hosting is active or in its grace period. */
export const isServing = (hostedUntil: Date | null, now = new Date()) => {
  const s = hostingStatus(hostedUntil, now).state;
  return s === "active" || s === "grace";
};
