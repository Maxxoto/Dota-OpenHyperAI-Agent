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
	// Per-bot identity (RFC-002 §7.1). Optional: a bare ChatContext keeps the
	// shared persona voice, while populated fields weave a distinct bot voice.
	identityHandle?: string | undefined;
	archetype?: string | undefined;
	toneHint?: string | undefined;
	catchphrases?: string[] | undefined;
	chanceMultiplier?: number | undefined;
	cooldownMultiplier?: number | undefined;
}

/**
 * Appended to every persona prompt: one ask must serve the reply and the
 * command surface (RFC-002 §6.1), so the model always answers in the same
 * envelope shape instead of free chat text.
 */
const TOOL_CONTRACT = "Output exactly ONE JSON object and nothing else: "
	+ "{\"reply\": \"<chat line>\", \"tool_calls\": [{\"tool\": \"swap_lane\" | \"swap_position\", "
	+ "\"args\": {\"hero\": \"<hero internal_name>\", \"lane\": \"safe\" | \"mid\" | \"off\" | \"pos\": 1-5}}]}. "
	+ "swap_lane takes lane, swap_position takes pos 1-5, and hero is the npc_dota_hero_... id. "
	+ "Set \"tool_calls\": [] when the message is not a command. "
	+ "The reply string is your chat line only and follows the persona rules above: short, in character, never an AI admission.";

function NonEmpty(value: string | undefined): string {
	if (value === undefined) {
		return "";
	}
	return value.trim();
}

/** Identity voice clause for the system prompt; "" when no identity is set. */
function IdentityVoice(ctx: ChatContext): string {
	const handle = NonEmpty(ctx.identityHandle);
	const archetype = NonEmpty(ctx.archetype);
	const parts: string[] = [];
	if (handle !== "" && archetype !== "") {
		parts.push("You are " + handle + ", a " + archetype + " player.");
	} else if (handle !== "") {
		parts.push("You are " + handle + ".");
	} else if (archetype !== "") {
		parts.push("You are a " + archetype + " player.");
	}
	const phrases: string[] = [];
	const rawPhrases = ctx.catchphrases;
	if (rawPhrases !== undefined) {
		for (let i = 0; i < rawPhrases.length; i += 1) {
			const phrase = NonEmpty(rawPhrases[i]);
			if (phrase !== "") {
				phrases.push(phrase);
			}
		}
	}
	if (phrases.length > 0) {
		parts.push("You sometimes use phrases like: " + phrases.join(" / ") + ".");
	}
	const tone = NonEmpty(ctx.toneHint);
	if (tone !== "") {
		parts.push("Tone: " + tone + ".");
	}
	if (parts.length === 0) {
		return "";
	}
	return "Your voice: " + parts.join(" ");
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
		"No emojis, no links, no hashtags, no quotes around your message.",
	];
	const voice = IdentityVoice(ctx);
	if (voice !== "") {
		system.push(voice);
	}
	system.push(TOOL_CONTRACT);
	const systemText = system.join(" ");
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
	return { system: systemText, user };
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
	// Identity weighting (RFC-002 §7.1): scales the dice and the cooldown.
	chanceMultiplier?: number | undefined;
	cooldownMultiplier?: number | undefined;
}

/** Effective reply chance never drops below this, whatever the weighting. */
export const CHAT_MIN_CHANCE = 0.05;
export const CHAT_MAX_CHANCE = 1;

export const DEFAULT_CHAT_LIMITER: ChatLimiterConfig = {
	cooldownSec: CHAT_COOLDOWN_SEC,
	chance: CHAT_REPLY_CHANCE,
};

/** Defaults plus this bot's identity weighting, if any. */
export function ChatLimiterConfigFor(ctx: ChatContext): ChatLimiterConfig {
	return {
		cooldownSec: DEFAULT_CHAT_LIMITER.cooldownSec,
		chance: DEFAULT_CHAT_LIMITER.chance,
		chanceMultiplier: ctx.chanceMultiplier,
		cooldownMultiplier: ctx.cooldownMultiplier,
	};
}

function EffectiveChance(config: ChatLimiterConfig): number {
	if (config.chanceMultiplier === undefined) {
		return config.chance;
	}
	const scaled = config.chance * config.chanceMultiplier;
	if (scaled < CHAT_MIN_CHANCE) {
		return CHAT_MIN_CHANCE;
	}
	if (scaled > CHAT_MAX_CHANCE) {
		return CHAT_MAX_CHANCE;
	}
	return scaled;
}

function EffectiveCooldown(config: ChatLimiterConfig): number {
	if (config.cooldownMultiplier === undefined) {
		return config.cooldownSec;
	}
	return config.cooldownSec * config.cooldownMultiplier;
}

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
	if (now - state.lastReplyAt < EffectiveCooldown(config)) {
		return false;
	}
	return roll < EffectiveChance(config);
}
