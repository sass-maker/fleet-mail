// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under Apache-2.0. Modified for Domain Inbox, 2026-10-27.

import { sendEmail, type SendEmailParams } from "../email-sender";
import { prepareAttachments, storePreparedAttachments } from "./attachments";
import { buildThreadingHeaders, SenderValidationError, validateSender } from "./email-helpers";
import { configuredDomains, receivingAddress } from "../../shared/mailboxes";
import type { Env } from "../types";

export class DeliveryError extends Error {
	constructor(
		message: string,
		public status: 409 | 502,
		public id: string,
	) {
		super(message);
	}
}

export async function sendOutgoing(
	env: Env,
	mailboxId: string,
	params: SendEmailParams & {
		send_id?: string;
		in_reply_to?: string;
		references?: string[];
		thread_id?: string;
	},
) {
	try {
		receivingAddress(mailboxId, configuredDomains(env.DOMAINS), env.EMAIL_ADDRESSES ?? []);
	} catch (error) {
		throw new SenderValidationError((error as Error).message);
	}
	const { fromEmail, toStr } = validateSender(params.to, params.from, mailboxId);
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	const id = params.send_id || crypto.randomUUID();
	const content = JSON.stringify(params);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	const attachments = prepareAttachments(id, params.attachments);
	let claimed;
	try {
		claimed = await stub.beginDelivery(
			{
				id,
				subject: params.subject,
				sender: fromEmail,
				recipient: toStr,
				cc: params.cc ? (Array.isArray(params.cc) ? params.cc.join(", ") : params.cc) : null,
				bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc.join(", ") : params.bcc) : null,
				date: new Date().toISOString(),
				body: params.html || params.text || "",
				in_reply_to: params.in_reply_to || null,
				email_references: params.references ? JSON.stringify(params.references) : null,
				thread_id: params.thread_id || id,
				raw_headers: JSON.stringify([
					{ key: "from", value: fromEmail },
					{ key: "to", value: toStr },
				]),
				delivery_status: "pending",
				delivery_fingerprint: fingerprint,
			},
			attachments.map((attachment) => attachment.metadata),
		);
	} catch (error) {
		if (
			(error as Error).message.includes("Send ID") ||
			(error as Error).message.includes("attempt limit")
		)
			throw new DeliveryError((error as Error).message, 409, id);
		throw error;
	}
	if (!claimed.claimed) {
		if (claimed.status === "accepted") return { id, status: "accepted" as const };
		throw new DeliveryError(
			"Sending was already started. Check Drafts and Sent before retrying; this request will not send a duplicate.",
			409,
			id,
		);
	}
	try {
		await storePreparedAttachments(env.BUCKET, attachments);
		const result = await sendEmail(env.EMAIL, {
			...params,
			...(params.in_reply_to
				? { headers: buildThreadingHeaders(params.in_reply_to, params.references || []) }
				: {}),
		});
		await stub.completeDelivery(id, result.messageId.replace(/^<|>$/g, ""));
		return { id, status: "accepted" as const };
	} catch {
		await stub.markDeliveryUnknown(id).catch(() => {});
		throw new DeliveryError(
			"Sending was not confirmed. A copy is in Drafts. Check the message status before starting another send.",
			502,
			id,
		);
	}
}
