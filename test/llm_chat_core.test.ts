/**
 * Chat core tests (Workstream W) — persona prompt shape, sanitizer rules,
 * reply policy limits. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	BuildChatPrompts,
	CHAT_COOLDOWN_SEC,
	CHAT_MAX_LEN,
	CHAT_REPLY_CHANCE,
	ChatLimiterConfigFor,
	SanitizeChatReply,
	ShouldReply,
	type ChatContext,
	type ChatLimiterState,
} from "../typescript/bots/FunLib/llm_chat_core";
import { EnvelopeParse, ValidateToolCall } from "../typescript/bots/FunLib/llm_tools_core";

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
	assert.match(p.system, /SEA server/);
	assert.match(p.system, /mga tanga/);
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

test("ShouldReply enforces cooldown and chance, with no per-game cap", () => {
	const base: ChatLimiterState = { replies: 0, lastReplyAt: 0 };
	assert.equal(ShouldReply(base, 100, 0.999), true);
	assert.equal(
		ShouldReply({ replies: 0, lastReplyAt: 98 }, 100, 0.1),
		false,
		"cooldown blocks"
	);
	assert.equal(
		ShouldReply({ replies: 500, lastReplyAt: 0 }, 1000, 0.5),
		true,
		"no per-game cap blocks a late reply"
	);
	assert.equal(
		ShouldReply(base, 100, 0.9, { cooldownSec: 10, chance: 0.5 }),
		false,
		"roll above a reduced chance blocks"
	);
});

const identityCtx: ChatContext = {
	...ctx,
	identityHandle: "axe_enjoyer",
	archetype: "cocky",
	toneHint: "cocky",
	catchphrases: ["ez mid", "gap is gap"],
	chanceMultiplier: 1.5,
	cooldownMultiplier: 0.75,
};

test("BuildChatPrompts weaves a per-bot identity voice when present", () => {
	const p = BuildChatPrompts(identityCtx);
	assert.ok(p.system.includes("You are axe_enjoyer, a cocky player"));
	assert.ok(p.system.includes("sometimes use phrases like: ez mid / gap is gap"));
	assert.ok(p.system.includes("Tone: cocky"));
	assert.match(p.system, /NOT an AI/);
	assert.ok(p.system.includes("under 12 words"));
	assert.ok(p.user.includes("mid diff or what"));
});

test("BuildChatPrompts omits the identity voice when fields are absent", () => {
	const p = BuildChatPrompts(ctx);
	assert.ok(!p.system.includes("Your voice:"));
	assert.ok(!p.system.includes("sometimes use phrases like"));
});

test("BuildChatPrompts always appends the reply plus tool-call JSON contract", () => {
	for (const c of [ctx, identityCtx]) {
		const p = BuildChatPrompts(c);
		assert.ok(p.system.includes('"reply"'));
		assert.ok(p.system.includes('"tool_calls": []'));
		assert.ok(p.system.includes("swap_lane"));
		assert.ok(p.system.includes("swap_position"));
		assert.ok(p.system.includes("npc_dota_hero_"));
		assert.ok(p.system.includes("not a command"));
		assert.ok(p.system.includes("never an AI admission"));
	}
});

test("ShouldReply clamps a weighted chance to the 0.05 floor", () => {
	const state: ChatLimiterState = { replies: 0, lastReplyAt: 0 };
	const config = { cooldownSec: 10, chance: 0.5, chanceMultiplier: 0.04 };
	assert.equal(ShouldReply(state, 100, 0.04, config), true);
	assert.equal(ShouldReply(state, 100, 0.06, config), false);
});

test("ShouldReply clamps a weighted chance at 1", () => {
	const state: ChatLimiterState = { replies: 0, lastReplyAt: 0 };
	assert.equal(ShouldReply(state, 100, 0.999, { cooldownSec: 10, chance: 0.5, chanceMultiplier: 4 }), true);
	assert.equal(ShouldReply(state, 100, 0.999, { cooldownSec: 10, chance: 0.5 }), false);
});

test("ShouldReply stretches the cooldown with the identity multiplier", () => {
	const state: ChatLimiterState = { replies: 0, lastReplyAt: 0 };
	const slow = { cooldownSec: 10, chance: 1, cooldownMultiplier: 2 };
	assert.equal(ShouldReply(state, 15, 0, slow), false);
	assert.equal(ShouldReply(state, 20, 0, slow), true);
	const fast = { cooldownSec: 10, chance: 1, cooldownMultiplier: 0.5 };
	assert.equal(ShouldReply(state, 5, 0, fast), true);
});

test("ChatLimiterConfigFor carries identity multipliers onto the defaults", () => {
	const weighted = ChatLimiterConfigFor(identityCtx);
	assert.equal(weighted.cooldownSec, CHAT_COOLDOWN_SEC);
	assert.equal(weighted.chance, CHAT_REPLY_CHANCE);
	assert.equal(weighted.chanceMultiplier, 1.5);
	assert.equal(weighted.cooldownMultiplier, 0.75);
	const bare = ChatLimiterConfigFor(ctx);
	assert.equal(bare.chanceMultiplier, undefined);
	assert.equal(bare.cooldownMultiplier, undefined);
});

const roster = {
	teamBotHeroes: ["npc_dota_hero_axe", "npc_dota_hero_crystal_maiden"],
	humanHeroes: ["npc_dota_hero_sniper"],
};

test("a canned envelope JSON round-trips into a reply and a validated tool call", () => {
	const canned = JSON.stringify({
		schema: "oha-chat-envelope-v1",
		reply: "on it, going safe",
		tool_calls: [{ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "safe" } }],
	});
	const parsed = EnvelopeParse(JSON.parse(canned));
	if (parsed === undefined) {
		assert.fail("expected a parsed envelope");
	}
	assert.equal(SanitizeChatReply(parsed.reply), "on it, going safe");
	const calls = parsed.tool_calls;
	if (calls === undefined) {
		assert.fail("expected tool calls");
	}
	assert.equal(calls.length, 1);
	assert.deepEqual(ValidateToolCall(calls[0], roster), {
		ok: true,
		tool: "swap_lane",
		hero: "npc_dota_hero_axe",
		pos: 1,
	});
});

test("an envelope with empty tool_calls yields only the reply", () => {
	const parsed = EnvelopeParse(JSON.parse('{"reply":"ez mid","tool_calls":[]}'));
	if (parsed === undefined) {
		assert.fail("expected a parsed envelope");
	}
	assert.equal(SanitizeChatReply(parsed.reply), "ez mid");
	assert.deepEqual(parsed.tool_calls, []);
});

test("a tool call against the human hero parses but never validates", () => {
	const parsed = EnvelopeParse(
		JSON.parse('{"reply":"sure","tool_calls":[{"tool":"swap_lane","args":{"hero":"npc_dota_hero_sniper","lane":"mid"}}]}')
	);
	if (parsed === undefined) {
		assert.fail("expected a parsed envelope");
	}
	const calls = parsed.tool_calls;
	if (calls === undefined) {
		assert.fail("expected tool calls");
	}
	const res = ValidateToolCall(calls[0], roster);
	if (res.ok) {
		assert.fail("expected the human-targeted call to be rejected");
	}
	assert.equal(res.reason, "hero-is-human");
});
