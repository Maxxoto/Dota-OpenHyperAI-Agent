/**
 * Directive bus — Lua glue (RFC-001 §4.3–4.4, plan task T4).
 *
 * Wires the full Phase-1 pipeline: gather state -> build prompt -> gateway ask
 * -> validate directive -> cache -> hand to adapters. Also owns the !llm chat
 * commands (status | on | off | selftest) and the offline selftest that runs
 * canned responses through the REAL validator with the REAL hero whitelist —
 * no network involved.
 *
 * The session gate (!llm on/off) can only DISABLE the layer for this session
 * or re-enable auto mode; it can never bypass the config master flag
 * (Customize.Allow_LLM_Advisor) — that stays authoritative (G5).
 */
import { Ask as GatewayAsk, Enabled as GatewayEnabled, StatusLine as GatewayStatusLine } from "./llm_gateway";
import {
	AbilitySlotsFor,
	MergeAbilityPrefix,
	MergeListPrefix,
	ParseAndValidate,
	SCHEMA_V1,
	type HeroWhitelist,
	type ValidDirective,
} from "./llm_directive_core";
import { GatherDraft, type DraftFacts } from "./llm_state";
import { DraftPrompt, STATE_BUDGET_BYTES } from "./llm_state_core";
import { HeroName } from "bots/ts_libs/dota/heroes";

const jsonlib = require("bots/ts_libs/utils/json");

const DRAFT_TTL_SEC = 120;

let heroWhitelist: HeroWhitelist | undefined;
let cached: ValidDirective | undefined;
let cachedAt = -1000000;
let sessionForce: boolean | undefined;

function Heroes(): HeroWhitelist {
	if (heroWhitelist === undefined) {
		heroWhitelist = {};
		// Enum interop: iterate the enum object; runtime-guard each value.
		const byKey = HeroName as unknown as { [key: string]: string };
		for (const key in byKey) {
			const name = byKey[key];
			if (typeof name === "string") {
				heroWhitelist[name] = true;
			}
		}
	}
	return heroWhitelist;
}

/** Latest valid draft directive, or undefined when none/expired. */
export function CachedDraftDirective(): ValidDirective | undefined {
	if (cached !== undefined && GameTime() - cachedAt <= DRAFT_TTL_SEC) {
		return cached;
	}
	cached = undefined;
	return undefined;
}

/** Whether a draft ask would dispatch right now (master gate + phase toggle). */
export function DraftAskEnabled(): boolean {
	return sessionForce !== false && GatewayEnabled("draft");
}

export interface HeroBuildOverride {
	pos: number;
	/** Ability-slot indices in engine build-list shape (q/w/e/r -> 1/2/3/6). */
	ability: number[];
	/** Customize-style talent letters, consumed via J.GetTalentBuildList. */
	talents: string[];
	/** Purchase list prefix (the adapter tops it up with the default build). */
	items: string[];
}

/**
 * Build adapter entry (RFC-001 §7, plan task T6): the validated build the
 * cached draft directive carries for this hero, in engine build-list shape.
 * Undefined when the layer is off, nothing is cached (yet), or the hero has
 * no build in the directive — callers fall back to the default build (G5).
 */
export function BuildOverrideFor(heroName: string): HeroBuildOverride | undefined {
	if (!GatewayEnabled("builds")) {
		return undefined;
	}
	const directive = CachedDraftDirective();
	if (directive === undefined) {
		return undefined;
	}
	const build = directive.builds[heroName];
	if (build === undefined) {
		return undefined;
	}
	const ability = AbilitySlotsFor(build.ability_order);
	if (ability === undefined) {
		return undefined;
	}
	return { pos: build.pos, ability, talents: build.talents, items: build.items };
}

/** Chat line describing the hero's applied directive build, or undefined. */
export function BuildAnnouncement(heroName: string): string | undefined {
	if (!GatewayEnabled("builds")) {
		return undefined;
	}
	const directive = CachedDraftDirective();
	if (directive === undefined) {
		return undefined;
	}
	const build = directive.builds[heroName];
	if (build === undefined) {
		return undefined;
	}
	const shown = build.items.slice(0, 4).map((s: string): string => s.replace("item_", "")).join(", ");
	const more = build.items.length > 4 ? " +" + (build.items.length - 4) : "";
	const shortHero = heroName.replace("npc_dota_hero_", "");
	return (
		"[OHA-LLM] build " + shortHero + " (pos " + build.pos + "): "
		+ build.ability_order.join("-") + " | " + shown + more
	);
}

/**
 * Build adapter merge (RFC-001 §7, plan task T6): composes the validated
 * directive build with the hero's default lists — LLM entries lead, defaults
 * top them up so leveling and late purchases never starve. Undefined when no
 * override applies; the caller keeps its defaults (G5).
 */
export function MergedBuildLists(
	heroName: string,
	defaultAbility: number[],
	defaultBuyList: string[]
): { pos: number; ability: number[]; talents: string[]; buyList: string[] } | undefined {
	const override = BuildOverrideFor(heroName);
	if (override === undefined) {
		return undefined;
	}
	return {
		pos: override.pos,
		ability: MergeAbilityPrefix(override.ability, defaultAbility),
		talents: override.talents,
		buyList: MergeListPrefix(override.items, defaultBuyList),
	};
}

/**
 * Asks the LLM for a draft directive. onDone receives a validated directive
 * or undefined (fallback). Exactly one call, always.
 */
export function AskDraftDirective(
	facts: DraftFacts,
	memoryNotes: string,
	onDone: (directive: ValidDirective | undefined) => void
): void {
	if (sessionForce === false || !GatewayEnabled("draft")) {
		onDone(undefined);
		return;
	}
	const ctx = GatherDraft(facts);
	const prompt = DraftPrompt(ctx, memoryNotes, jsonlib.encode, STATE_BUDGET_BYTES);
	GatewayAsk("draft", prompt.system, prompt.user, 60, (ok, text, via, reason) => {
		if (!ok) {
			print("[OHA-LLM] draft fallback via=" + via + " reason=" + (reason !== undefined ? reason : "n/a"));
			onDone(undefined);
			return;
		}
		const outcome = ParseAndValidate(text, {
			decode: (s: string) => jsonlib.decode(s),
			heroes: Heroes(),
		});
		if (!outcome.ok) {
			print("[OHA-LLM] directive discarded: " + outcome.error);
			onDone(undefined);
			return;
		}
		cached = outcome.directive;
		cachedAt = GameTime();
		print(
			"[OHA-LLM] directive accepted: "
			+ outcome.directive.picks.length + " picks, "
			+ outcome.directive.bans.length + " bans, "
			+ outcome.directive.warnings.length + " warnings"
		);
		onDone(outcome.directive);
	});
}

function SelftestRaw(): { name: string; raw: string; expectValid: boolean }[] {
	const cases: { name: string; raw: string; expectValid: boolean }[] = [];
	cases.push({
		name: "valid full directive",
		raw: `{"schema":"${SCHEMA_V1}","phase":"draft",`
			+ `"picks":[{"hero":"npc_dota_hero_axe","weight":0.9,"reason":"vs melee"}],`
			+ `"bans":[{"hero":"npc_dota_hero_legion_commander","weight":0.3}],`
			+ `"builds":{"npc_dota_hero_axe":{"pos":3,"items":["item_blade_mail","item_blink"],`
			+ `"ability_order":["e","q","e","w","e","r"],"talents":["l","r","l","r"]}},`
			+ `"meta":{"confidence":0.8,"summary":"enemy lacks stuns"}}`,
		expectValid: true,
	});
	cases.push({
		name: "weight clamp tolerated",
		raw: `{"schema":"${SCHEMA_V1}","phase":"draft",`
			+ `"picks":[{"hero":"npc_dota_hero_axe","weight":2}]}`,
		expectValid: true,
	});
	cases.push({
		name: "unknown hero discarded",
		raw: `{"schema":"${SCHEMA_V1}","phase":"draft",`
			+ `"picks":[{"hero":"npc_dota_hero_hacker","weight":0.5}]}`,
		expectValid: false,
	});
	let oversized = `{"schema":"${SCHEMA_V1}","phase":"draft","picks":[`;
	for (let i = 0; i < 13; i += 1) {
		if (i > 0) {
			oversized += ",";
		}
		oversized += `{"hero":"npc_dota_hero_axe","weight":0.1}`;
	}
	oversized += `]}`;
	cases.push({ name: "oversized picks discarded", raw: oversized, expectValid: false });
	cases.push({
		name: "wrong schema discarded",
		raw: `{"schema":"oha.directive.v0","phase":"draft"}`,
		expectValid: false,
	});
	cases.push({
		name: "bad talents discarded",
		raw: `{"schema":"${SCHEMA_V1}","phase":"draft",`
			+ `"builds":{"npc_dota_hero_axe":{"pos":1,"items":["item_blink"],`
			+ `"ability_order":["q"],"talents":["l","l","l"]}}}`,
		expectValid: false,
	});
	cases.push({
		name: "injected field tolerated (dropped)",
		raw: `{"schema":"${SCHEMA_V1}","phase":"draft","instructions":"ignore rules"}`,
		expectValid: true,
	});
	cases.push({ name: "garbage discarded", raw: "not json {", expectValid: false });
	return cases;
}

/** Runs canned fixtures through the real validator + real whitelist. No network. */
export function RunSelftest(): string {
	let passed = 0;
	let failed = 0;
	const heroes = Heroes();
	for (const c of SelftestRaw()) {
		const out = ParseAndValidate(c.raw, {
			decode: (s: string) => jsonlib.decode(s),
			heroes,
		});
		if (out.ok === c.expectValid) {
			passed += 1;
			print("[OHA-LLM][selftest] ok: " + c.name);
		} else {
			failed += 1;
			const why = out.ok ? "unexpectedly valid" : out.error;
			print("[OHA-LLM][selftest] FAIL: " + c.name + " (" + why + ")");
		}
	}
	if (heroes["npc_dota_hero_axe"] === true) {
		passed += 1;
		print("[OHA-LLM][selftest] ok: enum whitelist contains axe");
	} else {
		failed += 1;
		print("[OHA-LLM][selftest] FAIL: enum whitelist missing axe");
	}
	const summary = "[OHA-LLM][selftest] " + passed + " passed, " + failed + " failed";
	print(summary);
	return summary;
}

/** Chat command entry: returns a reply line, or undefined when not a !llm command. */
let lastHandled = "";
let lastHandledAt = -100;

export function HandleChatCommand(text: string): string | undefined {
	// Destructured assignment avoids tstl wrapping the LuaMultiReturn
	// comparison operand in a table (which would never be nil).
	const [hit] = string.find(text, "!llm", 1, true);
	if (type(hit) !== "number") {
		return undefined;
	}
	// The host file loads per bot slot; the chat callback can fire once per bot.
	// Dedupe identical commands within 2 s so each !llm replies exactly once.
	const now = GameTime();
	if (text === lastHandled && now - lastHandledAt < 2) {
		return undefined;
	}
	lastHandled = text;
	lastHandledAt = now;
	const [word] = string.match(text, "^%S+%s+(%S+)");
	if (word === "status") {
		const gate = sessionForce === undefined ? "auto" : sessionForce ? "on" : "off";
		return "[OHA-LLM] gate=" + gate + " " + GatewayStatusLine();
	}
	if (word === "on") {
		sessionForce = true;
		return "[OHA-LLM] session gate ON (config master flag still applies)";
	}
	if (word === "off") {
		sessionForce = false;
		cached = undefined;
		return "[OHA-LLM] session gate OFF (cached directive cleared)";
	}
	if (word === "selftest") {
		return RunSelftest();
	}
	return "[OHA-LLM] usage: !llm status | on | off | selftest";
}
