// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under Apache-2.0. Modified for Domain Inbox, 2026-10-27.

import type { Context } from "hono";
import {
	buildReferencesChain,
	resolveOriginalEmail,
	SenderValidationError,
} from "../lib/email-helpers";
import { SendEmailRequestSchema, type EmailFull } from "../lib/schemas";
import { DeliveryError, sendOutgoing } from "../lib/outbound";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

async function deliver(c: AppContext, reply: boolean) {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const original = (await c.var.mailboxStub.getEmail(c.req.param("id")!)) as EmailFull | null;
	if (!original) return c.json({ error: "Original email not found" }, 404);
	const resolved = await resolveOriginalEmail(c.var.mailboxStub, original);
	const chain = buildReferencesChain(resolved);
	try {
		const result = await sendOutgoing(c.env, mailboxId, {
			...body,
			...(reply
				? {
						in_reply_to: chain.originalMsgId,
						references: chain.references,
						thread_id: chain.threadId,
					}
				: {}),
		});
		if (reply)
			await c.var.mailboxStub
				.markThreadRead(chain.threadId)
				.catch(() => console.error("Reply accepted, but marking the thread read failed"));
		return c.json(result);
	} catch (error) {
		if (error instanceof DeliveryError)
			return c.json({ error: error.message, id: error.id }, error.status);
		if (error instanceof SenderValidationError) return c.json({ error: error.message }, 400);
		throw error;
	}
}

export const handleReplyEmail = (c: AppContext) => deliver(c, true);
export const handleForwardEmail = (c: AppContext) => deliver(c, false);
