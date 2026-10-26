/**
 * Gateway core tests (plan task T2) — pure state machine, no Lua globals.
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	BudgetKindFor,
	CacheKey,
	CreateGatewayCore,
	type AskCallback,
	type GatewayStats,
	type GatewayTransport,
} from "../typescript/bots/FunLib/llm_gateway_core";
import type { LlmConfig as Config } from "../typescript/bots/FunLib/llm_config";

interface Dispatched {
	url: string;
	model: string;
	system: string;
	user: string;
	respond: (statusCode: number, contentText: string) => void;
}

class FakeTransport implements GatewayTransport {
	dispatched: Dispatched[] = [];
	Post(
		url: string,
		apiKey: string,
		model: string,
		system: string,
		user: string,
		respond: (statusCode: number, contentText: string) => void
	): void {
		assert.strictEqual(apiKey, "k");
		this.dispatched.push({ url, model, system, user, respond });
	}
}

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		Enable: true,
		Endpoint: "https://api.groq.com/openai/v1/chat/completions",
		Model: "m",
		APIKey: "k",
		TimeoutMs: 8000,
		MaxConcurrent: 1,
		Phases: { draft: true, builds: true, desire: false, chat: true },
		...overrides,
	};
}

interface Result {
	ok: boolean;
	text: string;
	via: string;
	reason?: string;
	count: number;
}

function capture(): { cb: AskCallback; result: () => Result } {
	const r: Result = { ok: false, text: "", via: "", reason: undefined, count: 0 };
	const cb: AskCallback = (ok, text, via, reason) => {
		r.count += 1;
		r.ok = ok;
		r.text = text;
		r.via = via;
		r.reason = reason;
	};
	return { cb, result: () => r };
}

test("BudgetKindFor splits chat from policy phases", () => {
	assert.equal(BudgetKindFor("chat"), "chat");
	assert.equal(BudgetKindFor("draft"), "policy");
	assert.equal(BudgetKindFor("builds"), "policy");
});

test("disabled config answers fallback immediately, no transport call", () => {
	const t = new FakeTransport();
	let now = 0;
	const g = CreateGatewayCore(makeConfig({ Enable: false }), () => now, t);
	const { cb, result } = capture();
	g.Ask("draft", "s", "u", 30, cb);
	assert.equal(result().count, 1);
	assert.equal(result().ok, false);
	assert.equal(result().via, "fallback");
	assert.equal(result().reason, "disabled");
	assert.equal(t.dispatched.length, 0);
});

test("phase toggled off answers fallback with phase-off", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	const { cb, result } = capture();
	g.Ask("desire", "s", "u", 30, cb);
	assert.equal(result().reason, "phase-off");
	assert.equal(t.dispatched.length, 0);
});

test("no per-game call cap: repeated asks keep dispatching", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	const first = capture();
	g.Ask("draft", "s1", "u1", 30, first.cb);
	assert.equal(t.dispatched.length, 1);
	t.dispatched[0].respond(200, "answer-1");
	assert.equal(first.result().via, "net");
	const second = capture();
	g.Ask("draft", "s2", "u2", 30, second.cb);
	assert.equal(t.dispatched.length, 2);
	t.dispatched[1].respond(200, "answer-2");
	assert.equal(second.result().text, "answer-2");
	const stats = g.Stats();
	assert.equal(stats.usedPolicy, 2);
});

test("identical ask hits cache; counters track dispatches", () => {
	const t = new FakeTransport();
	let now = 0;
	const g = CreateGatewayCore(makeConfig(), () => now, t);
	const first = capture();
	g.Ask("draft", "same-s", "same-u", 30, first.cb);
	t.dispatched[0].respond(200, "cached-answer");
	assert.equal(first.result().via, "net");
	const second = capture();
	g.Ask("draft", "same-s", "same-u", 30, second.cb);
	assert.equal(second.result().via, "cache");
	assert.equal(second.result().text, "cached-answer");
	const stats = g.Stats();
	assert.equal(stats.usedPolicy, 1);
	assert.equal(stats.cacheEntries, 1);
});

test("cache expires after ttl", () => {
	const t = new FakeTransport();
	let now = 0;
	const g = CreateGatewayCore(makeConfig(), () => now, t);
	const first = capture();
	g.Ask("draft", "s", "u", 10, first.cb);
	t.dispatched[0].respond(200, "v1");
	now = 11;
	const second = capture();
	g.Ask("draft", "s", "u", 10, second.cb);
	assert.equal(t.dispatched.length, 2);
});

test("latest-wins supersedes queued jobs, not inflight ones", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t); // MaxConcurrent = 1
	const first = capture();
	g.Ask("draft", "s-1", "u-1", 30, first.cb);
	assert.equal(t.dispatched.length, 1); // first is inflight

	const stale = capture();
	g.Ask("draft", "s-2", "u-2", 30, stale.cb); // queued (slot busy)
	const fresh = capture();
	g.Ask("draft", "s-3", "u-3", 30, fresh.cb); // supersedes the queued one

	assert.equal(stale.result().count, 1);
	assert.equal(stale.result().reason, "superseded");
	assert.equal(t.dispatched.length, 1); // fresh still queued

	t.dispatched[0].respond(200, "first-answer"); // inflight completes normally
	assert.equal(first.result().via, "net");
	assert.equal(first.result().text, "first-answer");
	assert.equal(t.dispatched.length, 2); // fresh dispatched into freed slot

	t.dispatched[1].respond(200, "third-answer");
	assert.equal(fresh.result().count, 1);
	assert.equal(fresh.result().text, "third-answer");

	const stats: GatewayStats = g.Stats();
	assert.equal(stats.usedPolicy, 2);
	assert.equal(stats.inflight, 0);
	assert.equal(stats.pending, 0);
});

test("timeout releases the slot; late response is dropped", () => {
	const t = new FakeTransport();
	let now = 0;
	const g = CreateGatewayCore(makeConfig({ TimeoutMs: 8000 }), () => now, t);
	const first = capture();
	g.Ask("draft", "s", "u", 30, first.cb);
	assert.equal(t.dispatched.length, 1);
	now = 9; // past the 8 s deadline
	const second = capture();
	g.Ask("builds", "s2", "u2", 30, second.cb); // triggers Pump -> first times out
	assert.equal(first.result().count, 1);
	assert.equal(first.result().reason, "timeout");
	// second dispatched into the freed slot
	assert.equal(t.dispatched.length, 2);
	// late arrival for the timed-out job must be ignored
	t.dispatched[0].respond(200, "too-late");
	assert.equal(first.result().count, 1);
	assert.equal(second.result().count, 0);
	t.dispatched[1].respond(200, "second-answer");
	assert.equal(second.result().text, "second-answer");
});

test("http error maps to fallback with http-status reason", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	const r = capture();
	g.Ask("draft", "s", "u", 30, r.cb);
	t.dispatched[0].respond(429, "");
	assert.equal(r.result().ok, false);
	assert.equal(r.result().reason, "http-429");
});

test("empty 200 body counts as failure (malformed envelope upstream)", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	const r = capture();
	g.Ask("draft", "s", "u", 30, r.cb);
	t.dispatched[0].respond(200, "");
	assert.equal(r.result().ok, false);
	assert.equal(r.result().via, "fallback");
});

test("policy phases dispatch before chat when queued together", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	const chatJob = capture();
	g.Ask("chat", "cs", "cu", 30, chatJob.cb); // dispatched first (queue empty)
	const draftJob = capture();
	g.Ask("draft", "ds", "du", 30, draftJob.cb); // pending (slot busy)
	const buildsJob = capture();
	g.Ask("builds", "bs", "bu", 30, buildsJob.cb); // pending, replaces? no — different phase
	assert.equal(g.Stats().pending, 2);
	t.dispatched[0].respond(200, "chat-done"); // frees slot -> draft (policy) first
	assert.equal(t.dispatched.length, 2);
	assert.equal(t.dispatched[1].system, "ds");
	t.dispatched[1].respond(200, "draft-done");
	assert.equal(t.dispatched.length, 3);
	assert.equal(t.dispatched[2].system, "bs");
});

test("CacheKey separates phases and prompts", () => {
	assert.notEqual(CacheKey("draft", "s", "u"), CacheKey("builds", "s", "u"));
	assert.notEqual(CacheKey("draft", "s", "u1"), CacheKey("draft", "s", "u2"));
});

test("Enabled reflects config and phase toggles", () => {
	const t = new FakeTransport();
	const g = CreateGatewayCore(makeConfig(), () => 0, t);
	assert.equal(g.Enabled("draft"), true);
	assert.equal(g.Enabled("desire"), false);
	assert.equal(g.Enabled("chat"), true);
	const r = capture();
	g.Ask("draft", "s", "u", 30, r.cb);
	t.dispatched[0].respond(200, "x");
	assert.equal(g.Enabled("draft"), true);
	const off = CreateGatewayCore(makeConfig({ Enable: false }), () => 0, t);
	assert.equal(off.Enabled("draft"), false);
});
