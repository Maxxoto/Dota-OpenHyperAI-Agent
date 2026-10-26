/**
 * Chat core tests (Workstream W) — persona prompt shape, sanitizer rules,
 * reply policy limits. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	BuildChatPrompts,
	CHAT_MAX_LEN,
	CHAT_MAX_PER_GAME,
	SanitizeChatReply,
	ShouldReply,
	type ChatContext,
	type ChatLimiterState,
} from "../typescript/bots/FunLib/llm_chat_core";

const ctx: ChatContext = {
	botName: "Pudge.OHA",
	hero: "npc_dota_hero_pudge",
	team: "Radiant",
	minute: 21,
	kills: 7,
	deaths: 2,
	assists: 4,
	netWorth: 14200,
	difficulty: "unfair",
	speakerName: "Maxxoto",
	speakerHero: "npc_dota_hero_sniper",
	message: "mid diff or what",
};

test("BuildChatPrompts keeps persona rules and match context", () => {
	const p = BuildChatPrompts(ctx);
	assert.match(p.system, /NOT an AI/);
	assert.match(p.system, /SAME language/);
	assert.match(p.system, /slurs/);
	assert.ok(p.system.includes("under 12 words"));
	assert.ok(p.user.includes("Pudge.OHA"));
	assert.ok(p.user.includes("21"));
	assert.ok(p.user.includes("7/2/4"));
	assert.ok(p.user.includes("Maxxoto (npc_dota_hero_sniper)"));
	assert.ok(p.user.includes("mid diff or what"));
});

test("SanitizeChatReply passes clean trash talk through", () => {
	assert.equal(SanitizeChatReply("ez mid, gap too big"), "ez mid, gap too big");
});

test("SanitizeChatReply takes the first line only", () => {
	assert.equal(SanitizeChatReply("lol nice try\nanyway gg"), "lol nice try");
});

test("SanitizeChatReply strips wrapping quotes and collapses inner ones", () => {
	assert.equal(SanitizeChatReply('"gg wp"'), "gg wp");
	assert.equal(SanitizeChatReply('he said "run" lol'), "he said 'run' lol");
});

test("SanitizeChatReply rejects links, AI admissions, and empties", () => {
	assert.equal(SanitizeChatReply("check http://x.y"), undefined);
	assert.equal(SanitizeChatReply("see www.dotabuff.com"), undefined);
	assert.equal(SanitizeChatReply("As an AI I cannot"), undefined);
	assert.equal(SanitizeChatReply("I am a bot btw"), undefined);
	assert.equal(SanitizeChatReply("language model diff"), undefined);
	assert.equal(SanitizeChatReply("  "), undefined);
	assert.equal(SanitizeChatReply(undefined), undefined);
});

test("SanitizeChatReply hard-cuts oversized replies at a word boundary", () => {
	const long = "a".repeat(60) + " " + "b".repeat(200);
	const out = SanitizeChatReply(long) as string;
	assert.ok(out.endsWith("..."));
	assert.ok(out.length <= CHAT_MAX_LEN + 3);
});

test("ShouldReply enforces cap, cooldown, and chance", () => {
	const base: ChatLimiterState = { replies: 0, lastReplyAt: 0 };
	assert.equal(ShouldReply(base, 100, 0.1), true);
	assert.equal(ShouldReply(base, 100, 0.9), false, "roll above chance blocks");
	assert.equal(
		ShouldReply({ replies: 0, lastReplyAt: 90 }, 100, 0.1),
		false,
		"cooldown blocks"
	);
	assert.equal(
		ShouldReply({ replies: CHAT_MAX_PER_GAME, lastReplyAt: 0 }, 1000, 0.1),
		false,
		"per-game cap blocks"
	);
});
