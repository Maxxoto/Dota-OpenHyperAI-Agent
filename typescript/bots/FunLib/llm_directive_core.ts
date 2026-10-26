/**
 * Directive validator — the security and reliability boundary of the LLM
 * advisor (RFC-001 §4.3, plan task T4). ALL LLM output passes through here
 * before any adapter may use it.
 *
 * Dual-runtime: this module runs under Node in tests and inside the Dota Lua
 * VM in game. Therefore it uses ONLY constructs that compile cleanly through
 * typescript-to-lua AND run natively in Node: `typeof` comparisons (tstl maps
 * "object" to Lua table checks), `Array.isArray` (tstl polyfill; dkjson tags
 * decoded arrays with __jsontype), `for..in` (pairs), and injected decode.
 *
 * Contract:
 * - Structural violations (bad schema/phase, unknown hero, wrong types,
 *   oversized lists, malformed builds) discard the WHOLE directive — never a
 *   partial application.
 * - Cosmetic adjustments (weights clamped to [0,1], long strings trimmed,
 *   unknown extra fields dropped, duplicate picks deduped) keep the directive
 *   and record warnings.
 */

export type Decoder = (text: string) => any;
export type HeroWhitelist = { [hero: string]: boolean | undefined };

export const SCHEMA_V1 = "oha.directive.v1";
export const MAX_LIST = 12;
export const MAX_ABILITY_ORDER = 30;
export const REASON_MAX = 150;
export const SUMMARY_MAX = 200;

export interface DirectivePick {
	hero: string;
	weight: number;
	reason?: string | undefined;
}

export interface DirectiveBan {
	hero: string;
	weight: number;
}

export interface DirectiveBuild {
	pos: number;
	items: string[];
	ability_order: string[];
	talents: string[];
}

/**
 * Ability-slot indices used by hero build lists (J.Skill.GetAbilityList
 * convention: sAbilityList[1]=Q, [2]=W, [3]=E, [6]=ultimate). Consumed by the
 * build adapter (RFC-001 §7, plan task T6).
 */
export const ABILITY_SLOTS: { [letter: string]: number | undefined } = {
	q: 1,
	w: 2,
	e: 3,
	r: 6,
};

/** Maps validated ability letters to ability-slot indices; undefined on any gap. */
export function AbilitySlotsFor(letters: string[]): number[] | undefined {
	const out: number[] = [];
	for (const letter of letters) {
		const slot = ABILITY_SLOTS[letter];
		if (slot === undefined) {
			return undefined;
		}
		out.push(slot);
	}
	return out;
}

/**
 * Draft score merge (RFC-001 §6): the LLM re-ranks, never forces — its weight
 * caps at 0.5 so an unpickable-by-base-score hero can never be forced up.
 */
export function MergeDraftScore(base: number, llmWeight: number): number {
	const alpha = Math.min(llmWeight, 0.5);
	return base * (1 - alpha) + llmWeight * alpha;
}

/** Build merge (RFC-001 §7): LLM slots override the default list's prefix. */
export function MergeAbilityPrefix(
	llmSlots: number[],
	defaultSlots: number[]
): number[] {
	const merged: number[] = [];
	for (let i = 0; i < defaultSlots.length; i += 1) {
		merged.push(defaultSlots[i]);
	}
	for (let i = 0; i < llmSlots.length; i += 1) {
		merged[i] = llmSlots[i];
	}
	return merged;
}

/**
 * Purchase-list merge (RFC-001 §7): the LLM list leads; the default list tops
 * it up (deduped) so late-game purchases never starve on a short LLM list.
 */
export function MergeListPrefix(prefix: string[], base: string[]): string[] {
	const merged: string[] = [];
	const seen: { [name: string]: boolean | undefined } = {};
	for (let i = 0; i < prefix.length; i += 1) {
		merged.push(prefix[i]);
		seen[prefix[i]] = true;
	}
	for (let i = 0; i < base.length; i += 1) {
		if (seen[base[i]] !== true) {
			merged.push(base[i]);
			seen[base[i]] = true;
		}
	}
	return merged;
}

export interface DirectiveMeta {
	confidence: number;
	summary: string;
}

export interface ValidDirective {
	schema: string;
	phase: "draft" | "build";
	picks: DirectivePick[];
	bans: DirectiveBan[];
	builds: { [hero: string]: DirectiveBuild | undefined };
	meta?: DirectiveMeta | undefined;
	warnings: string[];
}

export type ParseOutcome =
	| { ok: true; directive: ValidDirective }
	| { ok: false; error: string };

export interface ValidateOptions {
	decode: Decoder;
	heroes: HeroWhitelist;
	/** Optional stricter item check (e.g. against shop data); structural by default. */
	itemCheck?: ((name: string) => boolean) | undefined;
}

export function BuildHeroWhitelist(names: string[]): HeroWhitelist {
	const whitelist: HeroWhitelist = {};
	for (const name of names) {
		whitelist[name] = true;
	}
	return whitelist;
}

function TrimTo(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return text.slice(0, max);
}

function Clamp01(value: number): number {
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
}

function IsDict(v: any): boolean {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function DefaultItemCheck(name: string): boolean {
	if (name.length < 6 || name.length > 60) {
		return false;
	}
	if (name.slice(0, 5) !== "item_") {
		return false;
	}
	for (let i = 5; i < name.length; i += 1) {
		const c = name.charAt(i);
		const ok =
			(c >= "a" && c <= "z") ||
			(c >= "0" && c <= "9") ||
			c === "_";
		if (!ok) {
			return false;
		}
	}
	return true;
}

function IsAbilityLetter(v: any): boolean {
	return v === "q" || v === "w" || v === "e" || v === "r";
}

function IsTalentLetter(v: any): boolean {
	return v === "l" || v === "r";
}

function TrimSpace(s: string): string {
	let a = 0;
	let b = s.length;
	const ws = (c: string): boolean =>
		c === " " || c === "\n" || c === "\r" || c === "\t";
	while (a < b && ws(s.charAt(a))) {
		a += 1;
	}
	while (b > a && ws(s.charAt(b - 1))) {
		b -= 1;
	}
	return s.slice(a, b);
}

/** Real models wrap "strict JSON" in markdown fences despite instructions. */
function StripFences(text: string): string {
	let t = text;
	if (t.slice(0, 3) === "```") {
		const nl = t.indexOf("\n");
		if (nl >= 0) {
			t = t.slice(nl + 1);
		}
	}
	if (t.length >= 3 && t.slice(t.length - 3) === "```") {
		t = t.slice(0, t.length - 3);
	}
	return t;
}

export function ParseAndValidate(rawText: string, opts: ValidateOptions): ParseOutcome {
	let root: any;
	try {
		root = opts.decode(TrimSpace(StripFences(TrimSpace(rawText))));
	} catch {
		return { ok: false, error: "parse" };
	}
	if (!IsDict(root)) {
		return { ok: false, error: "not-table" };
	}
	if (root.schema !== SCHEMA_V1) {
		return { ok: false, error: "schema" };
	}
	if (root.phase !== "draft" && root.phase !== "build") {
		return { ok: false, error: "phase" };
	}
	const warnings: string[] = [];
	const itemCheck = opts.itemCheck !== undefined ? opts.itemCheck : DefaultItemCheck;

	// ---- picks ----
	const picks: DirectivePick[] = [];
	if (root.picks !== undefined && root.picks !== null) {
		// any[]-typed binding so tstl compiles .length to '#' (raw .length on
		// `any` is a property access, nil on Lua tables).
		const picksArr: any[] = root.picks;
		if (!Array.isArray(picksArr)) {
			return { ok: false, error: "picks" };
		}
		if (picksArr.length > MAX_LIST) {
			return { ok: false, error: "picks-size" };
		}
		const seen: HeroWhitelist = {};
		for (const entry of picksArr) {
			if (!IsDict(entry)) {
				return { ok: false, error: "pick" };
			}
			if (typeof entry.hero !== "string" || opts.heroes[entry.hero] !== true) {
				return { ok: false, error: "pick-hero" };
			}
			if (typeof entry.weight !== "number") {
				return { ok: false, error: "pick-weight" };
			}
			if (seen[entry.hero] === true) {
				warnings.push("dup-pick:" + entry.hero);
				continue;
			}
			seen[entry.hero] = true;
			const pick: DirectivePick = { hero: entry.hero, weight: Clamp01(entry.weight) };
			if (typeof entry.reason === "string") {
				pick.reason = TrimTo(entry.reason, REASON_MAX);
			}
			if (entry.weight < 0 || entry.weight > 1) {
				warnings.push("clamp-pick:" + entry.hero);
			}
			picks.push(pick);
		}
	} else if (root.picks === null) {
		warnings.push("null:picks");
	}

	// ---- bans ----
	const bans: DirectiveBan[] = [];
	if (root.bans !== undefined && root.bans !== null) {
		const bansArr: any[] = root.bans;
		if (!Array.isArray(bansArr)) {
			return { ok: false, error: "bans" };
		}
		if (bansArr.length > MAX_LIST) {
			return { ok: false, error: "bans-size" };
		}
		for (const entry of bansArr) {
			if (!IsDict(entry)) {
				return { ok: false, error: "ban" };
			}
			if (typeof entry.hero !== "string" || opts.heroes[entry.hero] !== true) {
				return { ok: false, error: "ban-hero" };
			}
			if (typeof entry.weight !== "number") {
				return { ok: false, error: "ban-weight" };
			}
			if (entry.weight < 0 || entry.weight > 1) {
				warnings.push("clamp-ban:" + entry.hero);
			}
			bans.push({ hero: entry.hero, weight: Clamp01(entry.weight) });
		}
	} else if (root.bans === null) {
		warnings.push("null:bans");
	}

	// ---- builds ----
	const builds: { [hero: string]: DirectiveBuild | undefined } = {};
	if (root.builds !== undefined && root.builds !== null) {
		if (!IsDict(root.builds)) {
			return { ok: false, error: "builds" };
		}
		for (const hero in root.builds) {
			if (opts.heroes[hero] !== true) {
				return { ok: false, error: "builds-hero" };
			}
			const entry = root.builds[hero];
			if (!IsDict(entry)) {
				return { ok: false, error: "builds-entry" };
			}
			if (
				typeof entry.pos !== "number" ||
				Math.floor(entry.pos) !== entry.pos ||
				entry.pos < 1 ||
				entry.pos > 5
			) {
				return { ok: false, error: "builds-pos" };
			}
			const itemsArr: any[] = entry.items;
			if (!Array.isArray(itemsArr) || itemsArr.length > MAX_LIST) {
				return { ok: false, error: "builds-items" };
			}
			const items: string[] = [];
			for (const item of itemsArr) {
				if (typeof item !== "string" || !itemCheck(item)) {
					return { ok: false, error: "builds-items" };
				}
				items.push(item);
			}
			const orderArr: any[] = entry.ability_order;
			if (!Array.isArray(orderArr) || orderArr.length > MAX_ABILITY_ORDER) {
				return { ok: false, error: "builds-abilities" };
			}
			const order: string[] = [];
			for (const letter of orderArr) {
				if (!IsAbilityLetter(letter)) {
					return { ok: false, error: "builds-abilities" };
				}
				order.push(letter);
			}
			const talentsArr: any[] = entry.talents;
			if (!Array.isArray(talentsArr) || talentsArr.length !== 4) {
				return { ok: false, error: "builds-talents" };
			}
			const talents: string[] = [];
			for (const t of talentsArr) {
				if (!IsTalentLetter(t)) {
					return { ok: false, error: "builds-talents" };
				}
				talents.push(t);
			}
			builds[hero] = { pos: entry.pos, items, ability_order: order, talents };
		}
	} else if (root.builds === null) {
		warnings.push("null:builds");
	}

	// ---- meta (cosmetic: malformed meta drops with a warning, never discards) ----
	let meta: DirectiveMeta | undefined = undefined;
	if (root.meta !== undefined && root.meta !== null) {
		if (IsDict(root.meta) && typeof root.meta.confidence === "number") {
			meta = {
				confidence: Clamp01(root.meta.confidence),
				summary:
					typeof root.meta.summary === "string"
						? TrimTo(root.meta.summary, SUMMARY_MAX)
						: "",
			};
		} else {
			warnings.push("meta-dropped");
		}
	}

	// ---- unknown top-level fields are dropped (prompt-injection hardening) ----
	for (const key in root) {
		if (
			key !== "schema" && key !== "phase" && key !== "picks" &&
			key !== "bans" && key !== "builds" && key !== "meta"
		) {
			warnings.push("unknown:" + key);
		}
	}

	return {
		ok: true,
		directive: { schema: SCHEMA_V1, phase: root.phase, picks, bans, builds, meta, warnings },
	};
}
