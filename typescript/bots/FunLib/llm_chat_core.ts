/**
 * Pure core for LLM-driven bot chat (RFC-001 Workstream W).
 *
 * Owns the human-persona system prompt, the reply sanitizer, and the reply
 * policy (cooldown / per-game cap / reply chance). No engine or HTTP calls
 * here - the binding (llm_chat.ts) supplies those - so every rule is
 * unit-testable. Mirrors the *_core.ts split used by the draft/build layer.
 *
 * Safety rules (enforced by the sanitizer, not just the prompt): one line,
 * <= CHAT_MAX_LEN chars, no links, no prompt leakage ("system"/"instruction"
 * echo), and never an admission of being an AI (the prompt forbids it, the
 * sanitizer rejects replies that break character).
 */

export const CHAT_MAX_LEN = 140;
export const CHAT_COOLDOWN_SEC = 10;
export const CHAT_REPLY_CHANCE = 1;

export interface ChatContext {
	botName: string;
	hero: string;
	team: string;
	minute: number;
	kills: number;
	deaths: number;
	assists: number;
	netWorth: number;
	difficulty: string;
	speakerName: string;
	speakerHero?: string | undefined;
	message: string;
}

/**
 * Human-player persona: SEA server trash talk.
 *
 * The style samples come from the dffesalbon/dota-2-toxic-chat-data dataset
 * (Hugging Face), filtered to lines that carry the SEA register without
 * slurs, threats, sexual content or family insults.
 */
export function BuildChatPrompts(ctx: ChatContext): { system: string; user: string } {
	const system = [
		"You are a real human Dota 2 player on the SEA server, chatting with other players during a ranked match.",
		"You are cocky, sarcastic and funny. You banter and trash talk the way SEA players do, mixing English with Filipino, Indonesian or Malay slang (bobo, tanga, noob, anjir, wkwk, sial, ez, diff, lag, report).",
		"Hard limits: no racial, religious or homophobic slurs, no threats, no sexual talk, no insults about anyone's mother or family, nothing a normal ranked chat would get you banned for.",
		"Write ONE chat message only. Keep it short like real game chat: usually under 12 words, all lowercase is fine.",
		"Style samples from real SEA chat: \"report void and qop\" / \"trash offlane\" / \"why crying\" / \"mga tanga\" / \"u happy now\" / \"void you are really noob\" / \"he bitching about the lane\" / \"are u guys trash like the last team we faced\" / \"tang ina magquit kayo hahaha\" / \"ez mid\" / \"wkwk gg\".",
		"Reply in the SAME language the other player used.",
		"You are NOT an AI. Never mention being a bot, an AI, a script, or a language model. Stay in character at all times.",
		"No emojis, no links, no hashtags, no quotes around your message. Output only the chat text.",
	].join(" ");
	const speaker =
		ctx.speakerHero !== undefined && ctx.speakerHero !== ""
			? ctx.speakerName + " (" + ctx.speakerHero + ")"
			: ctx.speakerName;
	const user = [
		"You are " + ctx.botName + " playing " + ctx.hero + " for " + ctx.team + ".",
		"Match: minute " + ctx.minute + ", your score " + ctx.kills + "/" + ctx.deaths + "/" + ctx.assists
		+ ", net worth " + ctx.netWorth + " gold, bot difficulty " + ctx.difficulty + ".",
		speaker + " said in chat: \"" + ctx.message + "\"",
		"Write your one-line reply as " + ctx.botName + ".",
	].join("\n");
	return { system, user };
}

function Contains(text: string, needle: string): boolean {
	return text.includes(needle);
}

const QUOTE_CHARS = "\"'\u201c\u201d";

function IsQuote(ch: string): boolean {
	return QUOTE_CHARS.includes(ch);
}

function LastSpaceBefore(s: string): number {
	let last = -1;
	let pos = s.indexOf(" ");
	while (pos !== -1) {
		last = pos;
		pos = s.indexOf(" ", pos + 1);
	}
	return last;
}

/** Rejects rule-breaking replies; returns undefined so callers fall back. */
export function SanitizeChatReply(raw: string | undefined): string | undefined {
	if (raw === undefined || typeof raw !== "string") {
		return undefined;
	}
	// First line only: game chat is single-line.
	let line = raw.split("\n")[0] ?? "";
	// Strip quotes the model sometimes wraps replies in; collapse inner ones.
	while (line.length > 0 && IsQuote(line.slice(0, 1))) {
		line = line.slice(1);
	}
	while (line.length > 0 && IsQuote(line.slice(line.length - 1))) {
		line = line.slice(0, line.length - 1);
	}
	line = line.split('"').join("'");
	line = line.trim();
	if (line.length < 2 || line.length > 400) {
		return undefined;
	}
	const lower = line.toLowerCase();
	if (Contains(lower, "http") || Contains(lower, "www.")) {
		return undefined;
	}
	// Character break = automatic rejection: never admit being an AI/bot.
	if (
		Contains(lower, "as an ai") || Contains(lower, "language model")
		|| Contains(lower, "i am a bot") || Contains(lower, "i'm a bot")
	) {
		return undefined;
	}
	if (line.length > CHAT_MAX_LEN) {
		// Hard cut on a word boundary if possible.
		const cut = line.slice(0, CHAT_MAX_LEN);
		const spaceAt = LastSpaceBefore(cut);
		line = (spaceAt > 40 ? cut.slice(0, spaceAt) : cut).trim() + "...";
	}
	return line;
}

export interface ChatLimiterState {
	replies: number;
	lastReplyAt: number;
}

export interface ChatLimiterConfig {
	cooldownSec: number;
	chance: number;
}

export const DEFAULT_CHAT_LIMITER: ChatLimiterConfig = {
	cooldownSec: CHAT_COOLDOWN_SEC,
	chance: CHAT_REPLY_CHANCE,
};

/**
 * Pure reply decision. `roll` is a 0..1 random supplied by the binding so
 * tests are deterministic. No per-game cap: trash talk stays on all game.
 */
export function ShouldReply(
	state: ChatLimiterState,
	now: number,
	roll: number,
	config: ChatLimiterConfig = DEFAULT_CHAT_LIMITER
): boolean {
	if (now - state.lastReplyAt < config.cooldownSec) {
		return false;
	}
	return roll < config.chance;
}
