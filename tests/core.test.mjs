import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

async function load(entry, worker = false) {
 const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, plugins: worker ? [{ name: "worker-base", setup(builder) { builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "test" })); builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }" })); } }] : [] });
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { receivingAddress, configuredDomains, groupMailboxes } = await load("shared/mailboxes.ts");
const { receiveEmail, app } = await load("workers/index.ts");
const { sendOutgoing } = await load("workers/lib/outbound.ts");
const { MailboxDO } = await load("workers/durableObject/index.ts", true);

function storage() {
 const database = new DatabaseSync(":memory:");
 return {
  sql: { exec(query, ...bindings) {
   let rows = [];
   if (!bindings.length && query.trim().split(";").filter(Boolean).length > 1) database.exec(query);
   else rows = database.prepare(query).all(...bindings);
   return { [Symbol.iterator]: () => rows[Symbol.iterator](), toArray: () => rows, raw: function* () { for (const row of rows) yield Object.values(row); }, rowsRead: rows.length, rowsWritten: 0 };
  } },
  transactionSync(fn) { database.exec("BEGIN"); try { const value = fn(); database.exec("COMMIT"); return value; } catch (error) { database.exec("ROLLBACK"); throw error; } },
 };
}
function environment(sender = async () => ({ messageId: "provider-id@example.net" })) {
 const objects = new Map(); const boxes = new Map();
 const env = {
  DOMAINS: "alpha.test,beta.test", EMAIL_ADDRESSES: [], AI_ENABLED: "false",
  BUCKET: {
   async put(key, value, options) { if (options?.onlyIf && objects.has(key)) return null; objects.set(key, value); return { key }; },
   async head(key) { return objects.has(key) ? { key } : null; },
   async get(key) { return objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null; },
   async list() { return { objects: [...objects.keys()].filter((key) => key.startsWith("mailboxes/")).map((key) => ({ key })), truncated: false }; },
  },
  EMAIL: { send: sender },
  MAILBOX: { idFromName: (id) => id, get(id) { if (!boxes.has(id)) boxes.set(id, new MailboxDO({ storage: storage() }, env)); return boxes.get(id); } },
  EMAIL_AGENT: { get() { throw new Error("AI must remain disabled"); } },
 };
 return { env, objects, boxes };
}
function message(to, raw = "From: Sender <sender@example.org>\r\nTo: someone@elsewhere.test\r\nReply-To: replies@example.org\r\nSubject: Catch-all\r\nMessage-ID: <source@example.org>\r\n\r\nHello catch-all") {
 const bytes = new TextEncoder().encode(raw);
 return { to, rawSize: bytes.length, raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
}
const ctx = { waitUntil() { throw new Error("Disabled AI must not schedule work"); } };

test("domain allowlist is exact, normalizes case, and preserves address identities", () => {
 assert.deepEqual(configuredDomains(" Alpha.Test,alpha.test, beta.test "), ["alpha.test", "beta.test"]);
 assert.equal(receivingAddress("Sales+News@ALPHA.TEST", ["alpha.test"]), "sales+news@alpha.test");
 assert.throws(() => receivingAddress("user@notalpha.test", ["alpha.test"]));
 assert.throws(() => receivingAddress("user@alpha.test.evil.test", ["alpha.test"]));
 assert.throws(() => receivingAddress("user@alpha.test", ["alpha.test"], ["other@alpha.test"]));
});

test("domain groups include configured empty domains and sort exact addresses", () => {
 assert.deepEqual(groupMailboxes(["alpha.test", "beta.test"], [{ email: "z@alpha.test" }, { email: "a@alpha.test" }]), [{ domain: "alpha.test", addresses: [{ email: "a@alpha.test" }, { email: "z@alpha.test" }] }, { domain: "beta.test", addresses: [] }]);
});

test("catch-all routes by envelope, preserves raw mail, creates unknown address and deduplicates retries", async () => {
 const { env, objects, boxes } = environment();
 await receiveEmail(message("bcc+tag@alpha.test"), env, ctx);
 await receiveEmail(message("bcc+tag@alpha.test"), env, ctx);
 assert.equal(boxes.size, 1);
 const box = boxes.get("bcc+tag@alpha.test");
 const emails = await box.getEmails();
 assert.equal(emails.length, 1);
 assert.equal(emails[0].subject, "Catch-all");
 assert.ok(objects.has("mailboxes/bcc+tag@alpha.test.json"));
 assert.equal([...objects.keys()].filter((key) => key.startsWith("raw/")).length, 1);
 assert.equal(boxes.has("someone@elsewhere.test"), false);
});

test("a second envelope on the same message owns a separate mailbox", async () => {
 const { env, boxes } = environment();
 await receiveEmail(message("first@alpha.test"), env, ctx);
 await receiveEmail(message("second@beta.test"), env, ctx);
 assert.equal((await boxes.get("first@alpha.test").getEmails()).length, 1);
 assert.equal((await boxes.get("second@beta.test").getEmails()).length, 1);
});

test("headers may omit To and mailbox initialization never replaces owner settings", async () => {
 const { env, objects, boxes } = environment();
 objects.set("mailboxes/hidden@alpha.test.json", JSON.stringify({ fromName: "Owner chosen name" }));
 await receiveEmail(message("hidden@alpha.test", "From: sender@example.org\r\nSubject: Hidden recipient\r\n\r\nHello"), env, ctx);
 assert.equal(JSON.parse(objects.get("mailboxes/hidden@alpha.test.json")).fromName, "Owner chosen name");
 assert.equal((await boxes.get("hidden@alpha.test").getEmails()).length, 1);
});

test("unsupported recipient rejects before accepting or storing mail", async () => {
 const { env, objects, boxes } = environment();
 await assert.rejects(receiveEmail(message("user@evil.test"), env, ctx), /configured domain/);
 assert.equal(objects.size, 0); assert.equal(boxes.size, 0);
});

test("concurrent duplicate delivery creates one persisted message", async () => {
 const { env, boxes } = environment();
 await Promise.all([receiveEmail(message("one@alpha.test"), env, ctx), receiveEmail(message("one@alpha.test"), env, ctx)]);
 assert.equal((await boxes.get("one@alpha.test").getEmails()).length, 1);
});

test("provider acceptance moves the saved attempt to Sent and uses the provider Message-ID", async () => {
 let calls = 0;
 const { env, boxes } = environment(async () => { calls++; return { messageId: "<real-provider-id@example.net>" }; });
 const params = { send_id: crypto.randomUUID(), from: "reply@alpha.test", to: "sender@example.org", subject: "Reply", text: "Hello" };
 const result = await sendOutgoing(env, "reply@alpha.test", params);
 assert.equal(result.status, "accepted");
 const saved = await boxes.get("reply@alpha.test").getEmail(result.id);
 assert.equal(saved.folder_id, "sent"); assert.equal(saved.delivery_status, "accepted");
 assert.equal(saved.message_id, "real-provider-id@example.net");
 await sendOutgoing(env, "reply@alpha.test", params);
 assert.equal(calls, 1);
});

test("unconfirmed send keeps recoverable content in Drafts and repeated request never sends twice", async () => {
 let calls = 0;
 const { env, boxes } = environment(async () => { calls++; throw new Error("provider timeout"); });
 const params = { send_id: crypto.randomUUID(), from: "reply@alpha.test", to: "sender@example.org", subject: "Reply", text: "Saved content" };
 await assert.rejects(sendOutgoing(env, "reply@alpha.test", params), /not confirmed/);
 const saved = await boxes.get("reply@alpha.test").getEmail(params.send_id);
 assert.equal(saved.folder_id, "draft"); assert.equal(saved.body, "Saved content"); assert.equal(saved.delivery_status, "unknown");
 await assert.rejects(sendOutgoing(env, "reply@alpha.test", params), /already started/);
 assert.equal(calls, 1);
});

test("sending as another receiving address is rejected before provider call", async () => {
 let calls = 0;
 const { env } = environment(async () => { calls++; return { messageId: "bad" }; });
 await assert.rejects(sendOutgoing(env, "first@alpha.test", { from: "second@alpha.test", to: "sender@example.org", subject: "Bad", text: "Bad" }), /must match/);
 assert.equal(calls, 0);
});

test("API propagates provider failure and does not return sent success", async () => {
 const { env, objects } = environment(async () => { throw new Error("provider rejection"); });
 objects.set("mailboxes/reply@alpha.test.json", "{}");
 const response = await app.request("https://inbox.test/api/v1/mailboxes/reply%40alpha.test/emails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "reply@alpha.test", to: "sender@example.org", subject: "Reply", text: "Hello" }) }, env);
 assert.equal(response.status, 502);
 const body = await response.json(); assert.match(body.error, /not confirmed/); assert.equal(body.status, undefined);
});


test("an altered send cannot reuse an accepted operation id", async () => {
 let calls = 0;
 const { env } = environment(async () => { calls++; return { messageId: "one@example.net" }; });
 const params = { send_id: crypto.randomUUID(), from: "reply@alpha.test", to: "sender@example.org", subject: "Reply", text: "Original" };
 await sendOutgoing(env, "reply@alpha.test", params);
 await assert.rejects(sendOutgoing(env, "reply@alpha.test", { ...params, text: "Changed" }), /different content/);
 assert.equal(calls, 1);
});

test("a reply to a new outbound message joins its stored provider thread", async () => {
 const { env, boxes } = environment();
 const result = await sendOutgoing(env, "reply@alpha.test", { from: "reply@alpha.test", to: "sender@example.org", subject: "Start", text: "Original" });
 const outgoing = await boxes.get("reply@alpha.test").getEmail(result.id);
 await receiveEmail(message("reply@alpha.test", "From: sender@example.org\r\nTo: reply@alpha.test\r\nSubject: Re: Start\r\nReferences: <provider-id@example.net>\r\nIn-Reply-To: <provider-id@example.net>\r\n\r\nResponse"), env, ctx);
 const messages = await boxes.get("reply@alpha.test").getEmails();
 assert.equal(messages.length, 2);
 assert.ok(messages.every((entry) => entry.thread_id === outgoing.thread_id));
});


test("deleting a sent message does not erase duplicate-send protection", async () => {
 let calls = 0;
 const { env, boxes } = environment(async () => { calls++; return { messageId: "one@example.net" }; });
 const params = { send_id: crypto.randomUUID(), from: "reply@alpha.test", to: "sender@example.org", subject: "Reply", text: "Original" };
 await sendOutgoing(env, "reply@alpha.test", params);
 await boxes.get("reply@alpha.test").deleteEmail(params.send_id);
 await sendOutgoing(env, "reply@alpha.test", params);
 assert.equal(calls, 1);
});


test("inbound-first conversation keeps receive, exact-address reply and follow-up in one thread", async () => {
 let sent;
 const { env, objects, boxes } = environment(async (payload) => { sent = payload; return { messageId: "provider-reply@example.net" }; });
 await receiveEmail(message("support@alpha.test"), env, ctx);
 const box = boxes.get("support@alpha.test");
 const [first] = await box.getEmails();
 const response = await app.request(`https://inbox.test/api/v1/mailboxes/support%40alpha.test/emails/${first.id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ send_id: crypto.randomUUID(), from: "support@alpha.test", to: "replies@example.org", subject: "Re: Catch-all", text: "Our reply" }) }, env);
 assert.equal(response.status, 200);
 assert.equal(sent.from, "support@alpha.test");
 assert.equal(sent.to, "replies@example.org");
 assert.equal(sent.headers["In-Reply-To"], "<source@example.org>");
 await receiveEmail(message("support@alpha.test", "From: sender@example.org\r\nTo: support@alpha.test\r\nSubject: Re: Catch-all\r\nMessage-ID: <follow-up@example.org>\r\nReferences: <source@example.org> <provider-reply@example.net>\r\nIn-Reply-To: <provider-reply@example.net>\r\n\r\nFollow-up"), env, ctx);
 const messages = await box.getEmails();
 assert.equal(messages.length, 3);
 assert.ok(messages.every((entry) => entry.thread_id === first.thread_id));
});
