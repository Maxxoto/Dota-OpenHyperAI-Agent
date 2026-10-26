/**
 * Pure core for the natural-language tool-call framework (RFC-002 §6).
 *
 * Human chat is the command line. A heuristic pre-filter decides whether a
 * message is command-shaped, the gateway returns one envelope (reply + tool
 * calls), and this module owns the envelope contract: parse it, validate each
 * call against the live roster, and rate-limit execution. No engine or HTTP
 * calls here - the binding queues validated calls for the next safe tick.
 *
 * Portability: this file runs in Node tests and tstl-compiled Lua, so it uses
 * typeof/table-shape checks only (no regex literals, no lastIndexOf, no Lua
 * globals). Empty Lua tables decode identically to arrays, so the container
 * checks below never reject a table solely on Array.isArray.
 */

export interface EnvelopeToolCall {
	tool: string;
	args: { hero?: string; lane?: string; pos?: number };
}

export interface ChatEnvelope {
	reply?: string;
	tool_calls?: EnvelopeToolCall[];
}

export const TOOLS = ["swap_lane", "swap_position"] as const;

const COMMAND_WORDS: string[] = [
	"go",
	"come",
	"swap",
	"move",
	"lane",
	"mid",
	"safe",
	"off",
	"top",
	"bot",
	"push",
];

function IsTable(v: any): boolean {
	return typeof v === "object" && v !== null;
}

/**
 * A real JS array has a length; a decoded Lua object table does not, which
 * keeps an empty `{}` from being mistaken for `[]` after tstl compilation.
 */
function IsRealArray(v: any): boolean {
	return Array.isArray(v) && (v as { length?: number }).length !== undefined;
}

function IsKnownTool(tool: string): boolean {
	for (let i = 0; i < TOOLS.length; i += 1) {
		if (TOOLS[i] === tool) {
			return true;
		}
	}
	return false;
}

/** Maps a lane word to its position number; 0 means the lane is unknown. */
function LaneToPos(lane: string): number {
	if (lane === "safe") {
		return 1;
	}
	if (lane === "mid") {
		return 2;
	}
	if (lane === "off") {
		return 3;
	}
	return 0;
}

function IsPosition(pos: any): boolean {
	return typeof pos === "number" && pos === Math.floor(pos) && pos >= 1 && pos <= 5;
}

/**
 * Parses a model-emitted envelope. Anything malformed discards the whole
 * envelope (no partial tool runs); `reply` keeps only its first line.
 */
export function EnvelopeParse(raw: any): ChatEnvelope | undefined {
	if (!IsTable(raw) || IsRealArray(raw)) {
		return undefined;
	}
	let reply: string | undefined = undefined;
	if (raw.reply !== undefined) {
		if (typeof raw.reply !== "string") {
			return undefined;
		}
		// Typed local: tstl only emits __TS__StringSplit for a `string` receiver.
		const replyText: string = raw.reply;
		reply = replyText.split("\n")[0] ?? "";
	}
	const calls: EnvelopeToolCall[] = [];
	if (raw.tool_calls !== undefined) {
		if (!Array.isArray(raw.tool_calls)) {
			return undefined;
		}
		const rawCalls: any = raw.tool_calls;
		for (let i = 0; i < rawCalls.length; i += 1) {
			const rawCall: any = rawCalls[i];
			if (!IsTable(rawCall) || typeof rawCall.tool !== "string" || rawCall.tool === "") {
				return undefined;
			}
			const args: { hero?: string; lane?: string; pos?: number } = {};
			const rawArgs: any = rawCall.args;
			if (rawArgs !== undefined && rawArgs !== null) {
				if (!IsTable(rawArgs) || IsRealArray(rawArgs)) {
					return undefined;
				}
				if (rawArgs.hero !== undefined) {
					if (typeof rawArgs.hero !== "string") {
						return undefined;
					}
					args.hero = rawArgs.hero;
				}
				if (rawArgs.lane !== undefined) {
					if (typeof rawArgs.lane !== "string") {
						return undefined;
					}
					args.lane = rawArgs.lane;
				}
				if (rawArgs.pos !== undefined) {
					if (typeof rawArgs.pos !== "number") {
						return undefined;
					}
					args.pos = rawArgs.pos;
				}
			}
			calls.push({ tool: rawCall.tool, args });
		}
	}
	const out: ChatEnvelope = {};
	if (reply !== undefined) {
		out.reply = reply;
	}
	if (raw.tool_calls !== undefined) {
		out.tool_calls = calls;
	}
	return out;
}

/**
 * Validates one call against the roster: the hero must be a teammate bot
 * (never a human, never an enemy) and the lane/position must be in range.
 * The returned pos is the resolved position number (1 safe, 2 mid, 3 off).
 */
export function ValidateToolCall(
	call: EnvelopeToolCall,
	opts: { teamBotHeroes: string[]; humanHeroes: string[] }
): { ok: true; tool: string; hero: string; pos: number } | { ok: false; reason: string } {
	const raw: any = call;
	if (!IsTable(raw) || typeof raw.tool !== "string" || raw.tool === "") {
		return { ok: false, reason: "missing-tool" };
	}
	const tool: string = raw.tool;
	if (!IsKnownTool(tool)) {
		return { ok: false, reason: "unknown-tool" };
	}
	const rawArgs: any = raw.args;
	let hero = "";
	let lane = "";
	let pos = 0;
	if (IsTable(rawArgs)) {
		if (typeof rawArgs.hero === "string") {
			hero = rawArgs.hero;
		}
		if (typeof rawArgs.lane === "string") {
			lane = rawArgs.lane;
		}
		if (typeof rawArgs.pos === "number") {
			pos = rawArgs.pos;
		}
	}
	if (hero === "") {
		return { ok: false, reason: "hero-missing" };
	}
	if (opts.humanHeroes.includes(hero)) {
		return { ok: false, reason: "hero-is-human" };
	}
	if (!opts.teamBotHeroes.includes(hero)) {
		return { ok: false, reason: "hero-not-teammate" };
	}
	if (tool === TOOLS[0]) {
		const lanePos = LaneToPos(lane);
		if (lanePos === 0) {
			return { ok: false, reason: "lane-invalid" };
		}
		return { ok: true, tool: tool, hero: hero, pos: lanePos };
	}
	if (!IsPosition(pos)) {
		return { ok: false, reason: "pos-invalid" };
	}
	return { ok: true, tool: tool, hero: hero, pos: pos };
}

/**
 * Cheap, LLM-free gate: true only when the message names a hero hint AND
 * carries a command word, so ordinary banter never costs a gateway call.
 */
export function Prefilter(text: string, heroHints: string[]): boolean {
	if (typeof text !== "string" || text === "") {
		return false;
	}
	const lower = text.toLowerCase();
	let hasHero = false;
	for (let i = 0; i < heroHints.length; i += 1) {
		const hint = heroHints[i];
		if (typeof hint !== "string" || hint === "") {
			continue;
		}
		if (lower.includes(hint.toLowerCase())) {
			hasHero = true;
			break;
		}
	}
	if (!hasHero) {
		return false;
	}
	for (let i = 0; i < COMMAND_WORDS.length; i += 1) {
		if (lower.includes(COMMAND_WORDS[i])) {
			return true;
		}
	}
	return false;
}

export interface ToolRateState {
	executed: number;
	lastAt: number;
}

/** Per-game tool budget plus a cooldown between executed calls. */
export function CanExecuteTool(now: number, state: ToolRateState, max = 4, cooldownSec = 30): boolean {
	if (state.executed >= max) {
		return false;
	}
	if (now - state.lastAt < cooldownSec) {
		return false;
	}
	return true;
}
