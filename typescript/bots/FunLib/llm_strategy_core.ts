/**
 * Pure core for the adaptive team strategy layer (RFC-002 §5).
 *
 * Validates the `oha-strategy-v1` directive the LLM returns at match
 * checkpoints, merges its weights into Valve's desire seam under a hard alpha
 * cap, and gates checkpoint asks by spacing and per-game budget. No engine or
 * HTTP calls here - the binding (llm_strategy.ts) supplies those - so every
 * rule is unit-testable.
 *
 * Dual-runtime: this module runs under Node in tests and inside the Dota Lua
 * VM in game. Therefore it uses ONLY constructs that compile cleanly through
 * typescript-to-lua AND run natively in Node: `typeof` comparisons. Whole
 * payloads are discarded on any structural violation (schema, stance, lane
 * keys, rosh); present numerics are clamped to [0,1] rather than discarded.
 */

export const STRATEGY_SCHEMA = "oha-strategy-v1";
export const STRATEGY_MAX_ASKS = 8;
export const STRATEGY_SPACING_SEC = 300;
export const STRATEGY_NOTE_MAX = 120;
export const STRATEGY_ALPHA_MAX = 0.5;

export type StrategyStance = "group" | "split-push" | "defend" | "aggro";

export interface LaneWeights {
	top: number;
	mid: number;
	bot: number;
}

export interface StrategyDirective {
	schema: "oha-strategy-v1";
	push: LaneWeights;
	defend: LaneWeights;
	farm: LaneWeights;
	rosh: number;
	stance: StrategyStance;
	note?: string | undefined;
}

function IsDict(v: any): boolean {
	return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** Lane weights are structural: a missing or non-numeric lane discards the payload. */
function ParseLane(raw: any): LaneWeights | undefined {
	if (!IsDict(raw)) {
		return undefined;
	}
	if (
		typeof raw.top !== "number" ||
		typeof raw.mid !== "number" ||
		typeof raw.bot !== "number"
	) {
		return undefined;
	}
	return { top: Clamp01(raw.top), mid: Clamp01(raw.mid), bot: Clamp01(raw.bot) };
}

function IsStance(v: any): boolean {
	return v === "group" || v === "split-push" || v === "defend" || v === "aggro";
}

/** Validates one `oha-strategy-v1` payload; undefined means discard the whole directive. */
export function ParseStrategy(raw: any): StrategyDirective | undefined {
	if (!IsDict(raw)) {
		return undefined;
	}
	if (raw.schema !== STRATEGY_SCHEMA) {
		return undefined;
	}
	if (!IsStance(raw.stance)) {
		return undefined;
	}
	const push = ParseLane(raw.push);
	const defend = ParseLane(raw.defend);
	const farm = ParseLane(raw.farm);
	if (push === undefined || defend === undefined || farm === undefined) {
		return undefined;
	}
	if (typeof raw.rosh !== "number") {
		return undefined;
	}
	const directive: StrategyDirective = {
		schema: STRATEGY_SCHEMA,
		push,
		defend,
		farm,
		rosh: Clamp01(raw.rosh),
		stance: raw.stance,
	};
	if (typeof raw.note === "string") {
		const note: string = raw.note;
		directive.note = note.slice(0, STRATEGY_NOTE_MAX);
	}
	return directive;
}

/**
 * Desire-seam merge (RFC-002 §5.3): the directive biases Valve's desire, it
 * never replaces it - alpha caps at 0.5 and the result stays in [0,1].
 */
export function MergeDesire(
	base: number,
	directiveValue: number,
	alpha: number
): number {
	const a = alpha > STRATEGY_ALPHA_MAX ? STRATEGY_ALPHA_MAX : alpha;
	return Clamp01(base * (1 - a) + directiveValue * a);
}

/** Whether a checkpoint ask fits the per-game cap and the spacing window. */
export function ShouldAskStrategy(
	now: number,
	lastAskAt: number,
	askedCount: number,
	maxAsks: number = STRATEGY_MAX_ASKS,
	spacingSec: number = STRATEGY_SPACING_SEC
): boolean {
	if (askedCount >= maxAsks) {
		return false;
	}
	return now - lastAskAt >= spacingSec;
}

/** Neutral directive for the layer-off / nothing-cached path (RFC-002 G5). */
export function IdentityDirectives(): StrategyDirective {
	return {
		schema: STRATEGY_SCHEMA,
		push: { top: 0.5, mid: 0.5, bot: 0.5 },
		defend: { top: 0.5, mid: 0.5, bot: 0.5 },
		farm: { top: 0.5, mid: 0.5, bot: 0.5 },
		rosh: 0.5,
		stance: "group",
	};
}
