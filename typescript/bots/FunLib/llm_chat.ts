/**
 * Chat binding (RFC-001 Workstream W, RFC-002 §6.1): routes bot chat through
 * the Groq gateway with the persona prompt from llm_chat_core and returns ONE
 * envelope per ask - the in-character reply plus validated tool calls.
 *
 * MaybeReplyEnvelope is the router-facing path: it reuses the chat limiter and
 * the phase-"chat" gateway ask, parses the model text as an
 * `oha-chat-envelope-v1` object with llm_tools_core, sanitizes the reply, and
 * validates every tool call against the live roster (teammate bots only, never
 * the human or an enemy). onResult fires exactly once; any failure yields
 * { reply: undefined, toolCalls: [] } (G5).
 *
 * MaybeReply keeps the legacy reply-only shape and the "asked" | "skipped"
 * contract (skipped => caller may use the local-table fallback): it runs the
 * same limiter and ask and reduces the envelope to its reply.
 */
import * as Gateway from "./llm_gateway";
import { ForkLog } from "./fork_log";
import {
	BuildChatPrompts,
	ChatLimiterConfigFor,
	SanitizeChatReply,
	ShouldReply,
	type ChatContext,
	type ChatLimiterState,
} from "./llm_chat_core";
import {
	EnvelopeParse,
	ValidateToolCall,
	type EnvelopeToolCall,
} from "./llm_tools_core";

const jsonlib = require("bots/ts_libs/utils/json");

export type ChatAttempt = "asked" | "skipped";

export interface EnvelopeReply {
	reply: string | undefined;
	toolCalls: EnvelopeToolCall[];
}

export interface ChatRoster {
	teamBotHeroes: string[];
	humanHeroes: string[];
}

export type ChatEnvelopeContext = ChatContext & ChatRoster;

const limiter: ChatLimiterState = { replies: 0, lastReplyAt: -999 };
let inFlight = false;
let inflightAt = 0;

export function ChatEnabled(): boolean {
	return Gateway.Enabled("chat");
}

export function ChatStatusLine(): string {
	return "replies=" + limiter.replies + (inFlight ? " inflight" : "");
}

function EmptyEnvelopeReply(): EnvelopeReply {
	return { reply: undefined, toolCalls: [] };
}

function TrimFences(text: string): string {
	let t = text.trim();
	if (t.slice(0, 3) === "```") {
		const nl = t.indexOf("\n");
		t = nl >= 0 ? t.slice(nl + 1) : t.slice(3);
	}
	if (t.length >= 3 && t.slice(t.length - 3) === "```") {
		t = t.slice(0, t.length - 3);
	}
	return t.trim();
}

function DecodeJson(text: string): any {
	if (typeof text !== "string" || text === "") {
		return undefined;
	}
	const [ok, decoded] = pcall(jsonlib.decode, TrimFences(text));
	if (!ok) {
		return undefined;
	}
	return decoded;
}

/**
 * Parses and validates one model reply. A malformed envelope returns nothing
 * at all; otherwise reply and tool calls stay independent - a sanitized-away
 * reply never drops a validated call, and a rejected call never drops the
 * reply. Every rejected call is dropped individually.
 */
export function EnvelopeResultFrom(text: string, roster: ChatRoster): EnvelopeReply {
	const envelope = EnvelopeParse(DecodeJson(text));
	if (envelope === undefined) {
		return EmptyEnvelopeReply();
	}
	const reply = SanitizeChatReply(envelope.reply);
	const toolCalls: EnvelopeToolCall[] = [];
	const rawCalls = envelope.tool_calls;
	if (rawCalls !== undefined) {
		for (let i = 0; i < rawCalls.length; i += 1) {
			const res = ValidateToolCall(rawCalls[i], roster);
			if (res.ok) {
				toolCalls.push({ tool: res.tool, args: { hero: res.hero, pos: res.pos } });
			}
		}
	}
	return { reply, toolCalls };
}

/**
 * One chat ask that yields both the persona reply and validated tool calls.
 * "asked" means the gateway call is in flight and onResult will fire once;
 * "skipped" means the layer is off, a call is already in flight, or the dice
 * and cooldown said no - the caller keeps its local fallback.
 */
export function MaybeReplyEnvelope(
	ctx: ChatEnvelopeContext,
	now: number,
	onResult: (r: EnvelopeReply) => void
): ChatAttempt {
	if (inFlight && now - inflightAt > 15) {
		// Engine callback never fired (dropped request): recover instead of
		// silencing chat for the rest of the game.
		inFlight = false;
	}
	if (!ChatEnabled() || inFlight) {
		return "skipped";
	}
	const roll = RandomFloat(0, 1);
	if (!ShouldReply(limiter, now, roll, ChatLimiterConfigFor(ctx))) {
		return "skipped";
	}
	inFlight = true;
	inflightAt = now;
	let delivered = false;
	const deliver = (result: EnvelopeReply) => {
		if (delivered) {
			return;
		}
		delivered = true;
		onResult(result);
	};
	const prompts = BuildChatPrompts(ctx);
	const roster: ChatRoster = { teamBotHeroes: ctx.teamBotHeroes, humanHeroes: ctx.humanHeroes };
	// A synchronous throw inside Ask (missing http global, bad config) must not
	// leave inFlight stuck, or every later message is skipped for the game.
	const [okAsk, errAsk] = pcall(() => {
		Gateway.Ask("chat", prompts.system, prompts.user, 45, (ok, text, via, reason) => {
			inFlight = false;
			if (!ok) {
				ForkLog("[OHA-LLM] chat fallback via=" + (via !== undefined ? via : "n/a") + " reason=" + (reason !== undefined ? reason : "n/a"));
				deliver(EmptyEnvelopeReply());
				return;
			}
			const result = EnvelopeResultFrom(text, roster);
			if (result.reply !== undefined || result.toolCalls.length > 0) {
				limiter.replies += 1;
				limiter.lastReplyAt = now;
			}
			deliver(result);
		});
	});
	if (!okAsk) {
		inFlight = false;
		ForkLog("[OHA-LLM] chat ask threw: " + tostring(errAsk));
		deliver(EmptyEnvelopeReply());
	}
	return "asked";
}

/** Legacy reply-only path; same limiter and ask, envelope reduced to its reply. */
export function MaybeReply(
	ctx: ChatContext,
	now: number,
	onReply: (text: string | undefined, via?: string, reason?: string) => void
): ChatAttempt {
	const envelopeCtx: ChatEnvelopeContext = {
		botName: ctx.botName,
		hero: ctx.hero,
		team: ctx.team,
		minute: ctx.minute,
		kills: ctx.kills,
		deaths: ctx.deaths,
		assists: ctx.assists,
		netWorth: ctx.netWorth,
		difficulty: ctx.difficulty,
		speakerName: ctx.speakerName,
		speakerHero: ctx.speakerHero,
		message: ctx.message,
		identityHandle: ctx.identityHandle,
		archetype: ctx.archetype,
		toneHint: ctx.toneHint,
		catchphrases: ctx.catchphrases,
		chanceMultiplier: ctx.chanceMultiplier,
		cooldownMultiplier: ctx.cooldownMultiplier,
		// No roster on the legacy path: every tool call validates out, so only
		// the reply is delivered (exactly the old behaviour).
		teamBotHeroes: [],
		humanHeroes: [],
	};
	return MaybeReplyEnvelope(envelopeCtx, now, (result) => {
		onReply(result.reply);
	});
}
