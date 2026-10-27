// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under Apache-2.0. Modified for Domain Inbox, 2026-10-27.

export function configuredDomains(raw: string | undefined): string[] {
 return [...new Set((raw || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function receivingAddress(address: string, domains: string[], allowed: string[] = []): string {
 const normalized = address.trim().toLowerCase();
 const parts = normalized.split("@");
 if (parts.length !== 2 || !parts[0] || !domains.includes(parts[1]) || /[\s\x00-\x1f]/.test(normalized)) {
  throw new Error("Recipient must belong to a configured domain");
 }
 if (allowed.length && !allowed.some((value) => value.toLowerCase() === normalized)) {
  throw new Error("Recipient is not a configured address");
 }
 return normalized;
}

export function defaultMailboxSettings(email: string, name?: string) {
 return { fromName: name || email.split("@")[0], forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
}

export function groupMailboxes<T extends { email: string }>(domains: string[], mailboxes: T[]) {
 const groups = new Map(domains.map((domain) => [domain, [] as T[]]));
 for (const mailbox of mailboxes) {
  const domain = mailbox.email.slice(mailbox.email.lastIndexOf("@") + 1).toLowerCase();
  if (groups.has(domain)) groups.get(domain)!.push(mailbox);
 }
 return [...groups].map(([domain, addresses]) => ({ domain, addresses: addresses.sort((a, b) => a.email.localeCompare(b.email)) }));
}
