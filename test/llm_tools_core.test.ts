/**
 * Tool-call core tests (RFC-002 §6) - envelope parse, roster validation,
 * pre-filter, and the execution rate limit. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	CanExecuteTool,
	EnvelopeParse,
	Prefilter,
	TOOLS,
	ValidateToolCall,
	type EnvelopeToolCall,
	type ToolRateState,
} from "../typescript/bots/FunLib/llm_tools_core";

const teamBotHeroes = ["npc_dota_hero_axe", "npc_dota_hero_crystal_maiden"];
const humanHeroes = ["npc_dota_hero_sniper"];

function Rejection(call: EnvelopeToolCall): string {
	const res = ValidateToolCall(call, { teamBotHeroes, humanHeroes });
	if (res.ok) {
		assert.fail("expected the call to be rejected");
	}
	return res.reason;
}

test("TOOLS lists the v1 role-assignment tools", () => {
	assert.deepEqual(TOOLS.slice(), ["swap_lane", "swap_position"]);
});

test("EnvelopeParse accepts the RFC §6.1 envelope sample", () => {
	const parsed = EnvelopeParse({
		schema: "oha-chat-envelope-v1",
		reply: "on it",
		tool_calls: [{ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "safe" } }],
	});
	if (parsed === undefined) {
		assert.fail("expected a parsed envelope");
	}
	assert.equal(parsed.reply, "on it");
	const calls = parsed.tool_calls;
	if (calls === undefined) {
		assert.fail("expected tool calls");
	}
	assert.equal(calls.length, 1);
	assert.equal(calls[0].tool, "swap_lane");
	assert.equal(calls[0].args.hero, "npc_dota_hero_axe");
	assert.equal(calls[0].args.lane, "safe");
});

test("EnvelopeParse discards malformed envelopes whole", () => {
	assert.equal(EnvelopeParse(undefined), undefined);
	assert.equal(EnvelopeParse(null), undefined);
	assert.equal(EnvelopeParse("on it"), undefined);
	assert.equal(EnvelopeParse(42), undefined);
	assert.equal(EnvelopeParse([]), undefined);
	assert.equal(EnvelopeParse({ reply: 7 }), undefined);
	assert.equal(EnvelopeParse({ tool_calls: "swap_lane" }), undefined);
	assert.equal(EnvelopeParse({ tool_calls: [null] }), undefined);
	assert.equal(EnvelopeParse({ tool_calls: ["swap_lane"] }), undefined);
	assert.equal(EnvelopeParse({ tool_calls: [{ args: { hero: "npc_dota_hero_axe" } }] }), undefined);
	assert.equal(EnvelopeParse({ reply: "ok", tool_calls: [{ tool: "swap_lane", args: { lane: 1 } }] }), undefined);
	assert.equal(
		EnvelopeParse({ tool_calls: [{ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "safe" } }, 3] }),
		undefined
	);
});

test("EnvelopeParse keeps only the first reply line", () => {
	const parsed = EnvelopeParse({ reply: "on it\nthen push", tool_calls: [] });
	if (parsed === undefined) {
		assert.fail("expected a parsed envelope");
	}
	assert.equal(parsed.reply, "on it");
	assert.deepEqual(parsed.tool_calls, []);
});

test("ValidateToolCall maps swap_lane axe safe to position 1", () => {
	const res = ValidateToolCall(
		{ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "safe" } },
		{ teamBotHeroes, humanHeroes }
	);
	assert.deepEqual(res, { ok: true, tool: "swap_lane", hero: "npc_dota_hero_axe", pos: 1 });
});

test("ValidateToolCall resolves every lane and swap_position", () => {
	const opts = { teamBotHeroes, humanHeroes };
	assert.deepEqual(ValidateToolCall({ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "mid" } }, opts), {
		ok: true,
		tool: "swap_lane",
		hero: "npc_dota_hero_axe",
		pos: 2,
	});
	assert.deepEqual(ValidateToolCall({ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "off" } }, opts), {
		ok: true,
		tool: "swap_lane",
		hero: "npc_dota_hero_axe",
		pos: 3,
	});
	assert.deepEqual(
		ValidateToolCall({ tool: "swap_position", args: { hero: "npc_dota_hero_crystal_maiden", pos: 5 } }, opts),
		{ ok: true, tool: "swap_position", hero: "npc_dota_hero_crystal_maiden", pos: 5 }
	);
});

test("ValidateToolCall rejects human heroes", () => {
	assert.ok(Rejection({ tool: "swap_lane", args: { hero: "npc_dota_hero_sniper", lane: "safe" } }).length > 0);
});

test("ValidateToolCall rejects enemy and unknown heroes", () => {
	assert.ok(Rejection({ tool: "swap_lane", args: { hero: "npc_dota_hero_lina", lane: "safe" } }).length > 0);
	assert.ok(Rejection({ tool: "swap_lane", args: { lane: "safe" } }).length > 0);
});

test("ValidateToolCall rejects unknown tools", () => {
	assert.ok(Rejection({ tool: "sell_hero", args: { hero: "npc_dota_hero_axe" } }).length > 0);
});

test("ValidateToolCall rejects bad lanes and out-of-range positions", () => {
	assert.ok(Rejection({ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", lane: "jungle" } }).length > 0);
	assert.ok(Rejection({ tool: "swap_lane", args: { hero: "npc_dota_hero_axe" } }).length > 0);
	assert.ok(Rejection({ tool: "swap_position", args: { hero: "npc_dota_hero_axe", pos: 0 } }).length > 0);
	assert.ok(Rejection({ tool: "swap_position", args: { hero: "npc_dota_hero_axe", pos: 6 } }).length > 0);
	assert.ok(Rejection({ tool: "swap_position", args: { hero: "npc_dota_hero_axe", pos: 2.5 } }).length > 0);
	assert.ok(Rejection({ tool: "swap_position", args: { hero: "npc_dota_hero_axe" } }).length > 0);
});

test("Prefilter passes command-shaped messages", () => {
	const hints = ["axe", "cm"];
	assert.equal(Prefilter("axe go safelane", hints), true);
	assert.equal(Prefilter("cm come mid", hints), true);
	assert.equal(Prefilter("AXE GO MID", hints), true);
});

test("Prefilter drops ordinary banter and hero-less commands", () => {
	const hints = ["axe", "cm"];
	assert.equal(Prefilter("gg wp", hints), false);
	assert.equal(Prefilter("nice try", hints), false);
	assert.equal(Prefilter("go mid", []), false);
	assert.equal(Prefilter("axe", []), false);
});

test("CanExecuteTool enforces the per-game cap and the cooldown", () => {
	const state: ToolRateState = { executed: 0, lastAt: 0 };
	assert.equal(CanExecuteTool(100, state), true);
	assert.equal(CanExecuteTool(100, { executed: 0, lastAt: 90 }), false);
	assert.equal(CanExecuteTool(130, { executed: 0, lastAt: 90 }), true);
	assert.equal(CanExecuteTool(1000, { executed: 4, lastAt: 0 }), false);
	assert.equal(CanExecuteTool(1000, { executed: 3, lastAt: 0 }), true);
	assert.equal(CanExecuteTool(100, { executed: 0, lastAt: 0 }, 1, 0), true);
});

test("ValidateToolCall accepts pos-resolved swap_lane (envelope-normalized form)", () => {
	const v = ValidateToolCall(
		{ tool: "swap_lane", args: { hero: "npc_dota_hero_axe", pos: 1 } },
		{ teamBotHeroes: ["npc_dota_hero_axe"], humanHeroes: [] }
	);
	assert.equal(v.ok, true);
	if (v.ok === true) {
		assert.equal(v.pos, 1);
	}
});
