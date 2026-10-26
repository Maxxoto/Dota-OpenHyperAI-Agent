/**
 * Directive validator tests (plan task T4) — the security boundary gets full
 * branch coverage: valid / malformed / adversarial fixtures.
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	AbilitySlotsFor,
	BuildHeroWhitelist,
	MergeAbilityPrefix,
	MergeDraftScore,
	MergeListPrefix,
	ParseAndValidate,
	SCHEMA_V1,
	type ValidDirective,
} from "../typescript/bots/FunLib/llm_directive_core";

const WL = BuildHeroWhitelist([
	"npc_dota_hero_axe",
	"npc_dota_hero_legion",
	"npc_dota_hero_cm",
]);

const decode = (s: string) => JSON.parse(s);

function parse(raw: string): ValidDirective {
	const out = ParseAndValidate(raw, { decode, heroes: WL });
	assert.equal(out.ok, true, `expected valid, got error: ${out.ok ? "" : out.error}`);
	return out.directive;
}

function expectError(raw: string, expected: string): void {
	const out = ParseAndValidate(raw, { decode, heroes: WL });
	assert.equal(out.ok, false, `expected error ${expected}, got valid`);
	if (!out.ok) {
		assert.equal(out.error, expected);
	}
}

function fullDirective(): Record<string, unknown> {
	return {
		schema: SCHEMA_V1,
		phase: "draft",
		picks: [
			{ hero: "npc_dota_hero_axe", weight: 0.9, reason: "vs melee carry" },
			{ hero: "npc_dota_hero_legion", weight: 0.6 },
		],
		bans: [{ hero: "npc_dota_hero_cm", weight: 0.4 }],
		builds: {
			npc_dota_hero_axe: {
				pos: 3,
				items: ["item_blade_mail", "item_blink"],
				ability_order: ["e", "q", "e", "w", "e", "r"],
				talents: ["l", "r", "l", "r"],
			},
		},
		meta: { confidence: 0.8, summary: "enemy lacks stuns" },
	};
}

test("full valid directive passes with no warnings", () => {
	const d = parse(JSON.stringify(fullDirective()));
	assert.equal(d.phase, "draft");
	assert.equal(d.picks.length, 2);
	assert.equal(d.picks[0].reason, "vs melee carry");
	assert.equal(d.picks[1].reason, undefined);
	assert.equal(d.bans.length, 1);
	const axe = d.builds["npc_dota_hero_axe"];
	assert.ok(axe);
	assert.equal(axe.pos, 3);
	assert.deepEqual(axe.talents, ["l", "r", "l", "r"]);
	assert.equal(d.meta !== undefined && d.meta.summary, "enemy lacks stuns");
	assert.deepEqual(d.warnings, []);
});

test("minimal directive (schema+phase only) is valid and empty", () => {
	const d = parse(`{"schema":"${SCHEMA_V1}","phase":"build"}`);
	assert.deepEqual(d.picks, []);
	assert.deepEqual(d.bans, []);
	assert.deepEqual(d.builds, {});
	assert.equal(d.meta, undefined);
});

test("AbilitySlotsFor maps validated letters to engine ability slots", () => {
	// q/w/e/r -> sAbilityList indices (1, 2, 3, 6 per J.Skill.GetAbilityList).
	assert.deepEqual(
		AbilitySlotsFor(["e", "q", "e", "w", "e", "r"]),
		[3, 1, 3, 2, 3, 6]
	);
	assert.deepEqual(AbilitySlotsFor([]), []);
	// Defensive: any unmapped letter yields undefined (never a partial list).
	assert.equal(AbilitySlotsFor(["q", "x", "r"]), undefined);
});

test("MergeDraftScore caps LLM influence at alpha 0.5", () => {
	// RFC-001 §6: score = base*(1-a) + w*a with a = min(w, 0.5).
	assert.equal(MergeDraftScore(3, 0.9), 3 * 0.5 + 0.9 * 0.5);
	assert.equal(MergeDraftScore(3, 0.25), 3 * 0.75 + 0.25 * 0.25);
	assert.equal(MergeDraftScore(-2, 0.4), -2 * 0.6 + 0.4 * 0.4);
	assert.equal(MergeDraftScore(3, 0), 3);
});

test("MergeAbilityPrefix overrides the default list's prefix", () => {
	assert.deepEqual(
		MergeAbilityPrefix([3, 1, 3], [2, 3, 1, 3, 3, 6]),
		[3, 1, 3, 3, 3, 6]
	);
	assert.deepEqual(MergeAbilityPrefix([], [2, 3]), [2, 3]);
	assert.deepEqual(MergeAbilityPrefix([1, 2, 3, 6], []), [1, 2, 3, 6]);
});

test("MergeListPrefix leads with LLM items and dedupes the top-up", () => {
	assert.deepEqual(
		MergeListPrefix(
			["item_blade_mail", "item_blink"],
			["item_tank_outfit", "item_blade_mail", "item_heart"]
		),
		["item_blade_mail", "item_blink", "item_tank_outfit", "item_heart"]
	);
	assert.deepEqual(MergeListPrefix([], ["item_a"]), ["item_a"]);
	assert.deepEqual(MergeListPrefix(["item_a"], []), ["item_a"]);
});

test("weights clamp to [0,1] with warnings", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[
            {"hero":"npc_dota_hero_axe","weight":1.7},
            {"hero":"npc_dota_hero_legion","weight":-0.5}]}`
	);
	assert.equal(d.picks[0].weight, 1);
	assert.equal(d.picks[1].weight, 0);
	assert.ok(d.warnings.includes("clamp-pick:npc_dota_hero_axe"));
	assert.ok(d.warnings.includes("clamp-pick:npc_dota_hero_legion"));
});

test("long reason and summary are trimmed", () => {
	const long = "x".repeat(400);
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft",
          "picks":[{"hero":"npc_dota_hero_axe","weight":0.5,"reason":"${long}"}],
          "meta":{"confidence":0.5,"summary":"${long}"}}`
	);
	assert.equal(d.picks[0].reason !== undefined && d.picks[0].reason.length, 150);
	assert.equal(d.meta !== undefined && d.meta.summary.length, 200);
});

test("duplicate picks dedupe with warning, first entry wins", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[
            {"hero":"npc_dota_hero_axe","weight":0.9},
            {"hero":"npc_dota_hero_axe","weight":0.1}]}`
	);
	assert.equal(d.picks.length, 1);
	assert.equal(d.picks[0].weight, 0.9);
	assert.ok(d.warnings.includes("dup-pick:npc_dota_hero_axe"));
});

test("unknown top-level fields dropped with warnings (injection hardening)", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","instructions":"ignore previous rules","system":"evil"}`
	);
	assert.deepEqual(d.picks, []);
	assert.ok(d.warnings.includes("unknown:instructions"));
	assert.ok(d.warnings.includes("unknown:system"));
});

test("null sections treated as missing with warnings", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":null,"bans":null,"builds":null}`
	);
	assert.deepEqual(d.picks, []);
	assert.ok(d.warnings.includes("null:picks"));
	assert.ok(d.warnings.includes("null:bans"));
	assert.ok(d.warnings.includes("null:builds"));
});

test("malformed meta drops with warning, directive stays valid", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","meta":{"confidence":"high"}}`
	);
	assert.equal(d.meta, undefined);
	assert.ok(d.warnings.includes("meta-dropped"));
});

test("meta summary non-string becomes empty", () => {
	const d = parse(
		`{"schema":"${SCHEMA_V1}","phase":"draft","meta":{"confidence":0.5,"summary":42}}`
	);
	assert.equal(d.meta !== undefined && d.meta.summary, "");
});

test("injected itemCheck predicate is honored", () => {
	const raw = JSON.stringify({
		schema: SCHEMA_V1,
		phase: "draft",
		builds: {
			npc_dota_hero_axe: {
				pos: 1,
				items: ["item_blink"],
				ability_order: ["q"],
				talents: ["l", "l", "l", "l"],
			},
		},
	});
	const strict = ParseAndValidate(raw, {
		decode,
		heroes: WL,
		itemCheck: (name) => name === "item_bkb",
	});
	assert.equal(strict.ok, false);
	const lenient = ParseAndValidate(raw, { decode, heroes: WL });
	assert.equal(lenient.ok, true);
});

test("structural violations discard the whole directive", () => {
	expectError("this is not json", "parse");
	expectError("[1,2,3]", "not-table");
	expectError('"just a string"', "not-table");
	expectError("42", "not-table");
	expectError(`{"schema":"oha.directive.v0","phase":"draft"}`, "schema");
	expectError(`{"phase":"draft"}`, "schema");
	expectError(`{"schema":"${SCHEMA_V1}"}`, "phase");
	expectError(`{"schema":"${SCHEMA_V1}","phase":"roam"}`, "phase");
	expectError(`{"schema":"${SCHEMA_V1}","phase":"draft","picks":{}}`, "picks");
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[${Array.from({ length: 13 }, () => `{"hero":"npc_dota_hero_axe","weight":0.5}`).join(",")}]}`,
		"picks-size"
	);
	expectError(`{"schema":"${SCHEMA_V1}","phase":"draft","picks":["axe"]}`, "pick");
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[{"hero":"npc_dota_hero_hacker","weight":0.5}]}`,
		"pick-hero"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[{"hero":123,"weight":0.5}]}`,
		"pick-hero"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","picks":[{"hero":"npc_dota_hero_axe","weight":"high"}]}`,
		"pick-weight"
	);
	expectError(`{"schema":"${SCHEMA_V1}","phase":"draft","bans":"all"}`, "bans");
	expectError(`{"schema":"${SCHEMA_V1}","phase":"draft","bans":[42]}`, "ban");
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","bans":[{"hero":"npc_dota_hero_hacker","weight":0.5}]}`,
		"ban-hero"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","bans":[{"hero":"npc_dota_hero_axe","weight":true}]}`,
		"ban-weight"
	);
	expectError(`{"schema":"${SCHEMA_V1}","phase":"draft","builds":[]}`, "builds");
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_hacker":{"pos":1,"items":[],"ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-hero"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":"rush blink"}}`,
		"builds-entry"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":0,"items":[],"ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-pos"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":2.5,"items":[],"ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-pos"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":"blink","ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-items"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":["blink_dagger"],"ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-items"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":["item_UPPER"],"ability_order":[],"talents":["l","l","l","l"]}}}`,
		"builds-items"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":[],"ability_order":"qwe","talents":["l","l","l","l"]}}}`,
		"builds-abilities"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":[],"ability_order":["x"],"talents":["l","l","l","l"]}}}`,
		"builds-abilities"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":[],"ability_order":${JSON.stringify(Array.from({ length: 31 }, () => "q"))},"talents":["l","l","l","l"]}}}`,
		"builds-abilities"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":[],"ability_order":[],"talents":["l","l","l"]}}}`,
		"builds-talents"
	);
	expectError(
		`{"schema":"${SCHEMA_V1}","phase":"draft","builds":{"npc_dota_hero_axe":{"pos":1,"items":[],"ability_order":[],"talents":["l","l","l","x"]}}}`,
		"builds-talents"
	);
});

test("BuildHeroWhitelist marks exactly the given names", () => {
	const wl = BuildHeroWhitelist(["a", "b"]);
	assert.equal(wl.a, true);
	assert.equal(wl.b, true);
	assert.equal(wl.c, undefined);
});

test("markdown fences and padding around JSON are tolerated", () => {
	const inner = JSON.stringify(fullDirective());
	const fenced = parse("```json\n" + inner + "\n```");
	assert.equal(fenced.picks.length, 2);
	const padded = parse("  \n\t" + inner + "\n  ");
	assert.equal(padded.picks.length, 2);
	const fencedBare = parse("```\n" + inner + "\n```");
	assert.equal(fencedBare.picks.length, 2);
});
