// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under Apache-2.0. Modified for Domain Inbox, 2026-10-27.

import type { Env } from "../types";
import type { SendEmailParams } from "../email-sender";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

export function prepareAttachments(emailId: string, attachments?: SendEmailParams["attachments"]) {
	return (attachments || []).map((attachment, index) => {
		const content = Uint8Array.from(atob(attachment.content), (character) =>
			character.charCodeAt(0),
		);
		const metadata: StoredAttachment = {
			id: `${emailId}-${index}`,
			email_id: emailId,
			filename: (attachment.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_"),
			mimetype: attachment.type,
			size: content.byteLength,
			content_id: attachment.contentId || null,
			disposition: attachment.disposition,
		};
		return { metadata, content };
	});
}

export async function storePreparedAttachments(
	bucket: Env["BUCKET"],
	attachments: ReturnType<typeof prepareAttachments>,
) {
	for (const { metadata, content } of attachments) {
		await bucket.put(
			`attachments/${metadata.email_id}/${metadata.id}/${metadata.filename}`,
			content,
		);
	}
}
