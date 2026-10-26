/**
 * Chat binding (RFC-001 Workstream W): routes bot chat replies through the
 * Groq gateway with the human-persona prompt from llm_chat_core.
 *
 * MaybeReply returns "asked" (an LLM call is in flight; caller must NOT use
 * the local-table fallback - the async callback speaks or stays silent) or
 * "skipped" (layer off / cooldown / cap / dice - caller falls back to the
 * legacy local replies, G5). Timeouts are enforced by the gateway, the
 * reply cooldown by llm_chat_core's limiter (no per-game cap).
 */
import * as Gateway from "./llm_gateway";
import { ForkLog } from "./fork_log";
import {
	BuildChatPrompts,
	SanitizeChatReply,
	ShouldReply,
	type ChatContext,
	type ChatLimiterState,
} from "./llm_chat_core";

export type ChatAttempt = "asked" | "skipped";

const limiter: ChatLimiterState = { replies: 0, lastReplyAt: -999 };
let inFlight = false;

export function ChatEnabled(): boolean {
	return Gateway.Enabled("chat");
}

export function ChatStatusLine(): string {
	return "replies=" + limiter.replies + (inFlight ? " inflight" : "");
}

export function MaybeReply(
	ctx: ChatContext,
	now: number,
	onReply: (text: string | undefined, via?: string, reason?: string) => void
): ChatAttempt {
	if (!ChatEnabled() || inFlight) {
		return "skipped";
	}
	const roll = RandomFloat(0, 1);
	if (!ShouldReply(limiter, now, roll)) {
		return "skipped";
	}
	inFlight = true;
	const prompts = BuildChatPrompts(ctx);
	Gateway.Ask("chat", prompts.system, prompts.user, 45, (ok, text, via, reason) => {
		inFlight = false;
		if (!ok) {
			ForkLog("[OHA-LLM] chat fallback via=" + via + " reason=" + (reason !== undefined ? reason : "n/a"));
			onReply(undefined, via, reason);
			return;
		}
		const reply = SanitizeChatReply(text);
		if (reply !== undefined) {
			limiter.replies += 1;
			limiter.lastReplyAt = now;
		}
		onReply(reply);
	});
	return "asked";
}
