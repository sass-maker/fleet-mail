// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under Apache-2.0. Modified for Domain Inbox, 2026-10-27.

import { Button, Loader } from "@cloudflare/kumo";
import { EnvelopeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { groupMailboxes } from "../../shared/mailboxes";
import { useMailboxes } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

export function meta() { return [{ title: "Domain Inbox" }]; }

export default function HomeRoute() {
 const inboxes = useMailboxes();
 const config = useQuery({ queryKey: queryKeys.config, queryFn: () => api.getConfig(), staleTime: Infinity });
 const groups = groupMailboxes(config.data?.domains || [], inboxes.data || []);
 const error = config.error || inboxes.error;
 return <div className="min-h-screen bg-kumo-recessed">
  <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-16">
   <header className="mb-8">
    <div className="flex items-center gap-3"><EnvelopeIcon size={28} /><h1 className="text-2xl font-bold text-kumo-default">Domain Inbox</h1></div>
    <p className="mt-2 text-sm text-kumo-subtle">All your domain mail, organized by receiving address.</p>
   </header>
   {error ? <div role="alert" className="rounded-xl border border-kumo-line bg-kumo-base p-6"><p className="text-sm text-kumo-default">Could not load your inboxes.</p><Button className="mt-4" onClick={() => { config.refetch(); inboxes.refetch(); }}>Try again</Button></div>
    : config.isPending || inboxes.isPending ? <div className="flex justify-center py-20" aria-label="Loading inboxes"><Loader size="lg" /></div>
    : groups.length === 0 ? <div className="rounded-xl border border-kumo-line bg-kumo-base p-6"><h2 className="font-semibold">No domains configured</h2><p className="mt-2 text-sm text-kumo-subtle">Add your domains to the app configuration before receiving mail.</p></div>
    : <div className="space-y-5">{groups.map(({ domain, addresses }) => <section key={domain} className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base" aria-label={domain}>
     <div className="border-b border-kumo-line px-5 py-4"><h2 className="break-all font-semibold text-kumo-default">{domain}</h2><p className="mt-1 text-xs text-kumo-subtle">{addresses.length} {addresses.length === 1 ? "address" : "addresses"}</p></div>
     {addresses.length ? addresses.map((account, index) => <Link key={account.id} to={`/mailbox/${encodeURIComponent(account.id)}/emails/inbox`} className={`flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${index ? "border-t border-kumo-line" : ""}`}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">{account.email[0].toUpperCase()}</div>
      <div className="min-w-0"><div className="break-all text-sm font-medium text-kumo-default">{account.email.split("@")[0]}</div><div className="break-all text-sm text-kumo-subtle">{account.email}</div></div>
     </Link>) : <p className="px-5 py-6 text-sm text-kumo-subtle">No mail yet. An inbox appears automatically when any address on this domain receives mail.</p>}
    </section>)}</div>}
  </div>
 </div>;
}
