/**
 * Pure core for the per-bot identity card (RFC-002 §7.1).
 *
 * A card is derived only from (hero, seed) through a hand-rolled string hash,
 * so the same bot keeps the same voice on every run without Math.random or
 * Date. No engine or HTTP calls here - the binding (llm_identity.ts) owns the
 * cache - which keeps the whole seed-to-voice mapping unit-testable. Identity
 * is expression only (§7.3): it re-weights chat dice and supplies a tone hint,
 * never a gameplay decision.
 */

export type Archetype = "cocky" | "chill" | "whiny" | "strategist";

export interface IdentityCard {
	handle: string;
	archetype: Archetype;
	chattiness: number;
	tilt: number;
	timingJitter: number;
	catchphrases: string[];
}

const HERO_PREFIX = "npc_dota_hero_";
const ARCHETYPES: Archetype[] = ["cocky", "chill", "whiny", "strategist"];
const HANDLE_SUFFIXES = ["enjoyer", "diff", "gap", "gg", "xp"];
const HASH_MOD = 1000000007;
const HASH_BASE = 131;

const PHRASES: { [archetype: string]: string[] } = {
	cocky: [
		"ez mid",
		"you're not ready for this",
		"call it now, it's over",
		"watch the map, not me",
		"gap is gap",
		"too easy",
	],
	chill: [
		"all good, we scale",
		"one fight at a time",
		"no rush, take the farm",
		"we're fine, breathe",
		"play your game",
		"gg either way",
	],
	whiny: [
		"where is my team though",
		"another gank, no ward?",
		"this lane is cursed",
		"i'm dying out here",
		"can someone rotate please",
		"of course i die first",
	],
	strategist: [
		"push the lane, then rotate",
		"they group, we split",
		"ward their jungle first",
		"smoke now, they're split",
		"trade towers, don't fight blind",
		"buy back, we hold high ground",
	],
};

/** Hero id without its `npc_dota_hero_` prefix, lowercased; "bot" if empty. */
export function ShortHeroName(hero: string): string {
	const trimmed = hero.trim().toLowerCase();
	const stem = trimmed.indexOf(HERO_PREFIX) === 0 ? trimmed.slice(HERO_PREFIX.length) : trimmed;
	return stem.length > 0 ? stem : "bot";
}

function Fold(state: number, value: number): number {
	return (state * HASH_BASE + value) % HASH_MOD;
}

/** Hand-rolled deterministic hash: no regex, no locale, no time. */
function HashString(text: string, seed: number): number {
	let h = 7;
	for (let i = 0; i < text.length; i++) {
		h = Fold(h, text.charCodeAt(i));
	}
	let rest = Math.floor(seed < 0 ? -seed : seed);
	do {
		h = Fold(h, rest % 1000);
		rest = Math.floor(rest / 1000);
	} while (rest > 0);
	return h;
}

function Round2(value: number): number {
	const scaled = Math.round(value * 100) / 100;
	if (scaled < 0) {
		return 0;
	}
	return scaled > 1 ? 1 : scaled;
}

function Fraction(hash: number, salt: string): number {
	return Round2((HashString(salt, hash) % 1000) / 1000);
}

function PickPhrases(archetype: Archetype, start: number, count: number): string[] {
	const pool = PHRASES[archetype];
	const picked: string[] = [];
	for (let i = 0; i < count && i < pool.length; i++) {
		picked.push(pool[(start + i) % pool.length]);
	}
	return picked;
}

/** Fully deterministic identity card from (hero, seed). */
export function SeededIdentity(hero: string, seed: number): IdentityCard {
	const stem = ShortHeroName(hero);
	const archetypeHash = HashString(stem + "|archetype", seed);
	const archetype = ARCHETYPES[archetypeHash % ARCHETYPES.length];
	const suffix = HANDLE_SUFFIXES[HashString(stem + "|suffix", seed) % HANDLE_SUFFIXES.length];
	const count = HashString(stem + "|count", seed) % 2 === 0 ? 2 : 3;
	const start = HashString(stem + "|phrases", seed) % PHRASES[archetype].length;
	return {
		handle: stem + "_" + suffix,
		archetype,
		chattiness: Fraction(archetypeHash, "chattiness"),
		tilt: Fraction(archetypeHash, "tilt"),
		timingJitter: Fraction(archetypeHash, "timingJitter"),
		catchphrases: PickPhrases(archetype, start, count),
	};
}

function IsArchetype(value: any): boolean {
	for (let i = 0; i < ARCHETYPES.length; i++) {
		if (ARCHETYPES[i] === value) {
			return true;
		}
	}
	return false;
}

function IsFraction(value: any): boolean {
	return typeof value === "number" && value >= 0 && value <= 1;
}

/** Shape check for a card that came back from serialized state. */
export function ValidateIdentityCard(card: any): boolean {
	if (card === null || card === undefined || typeof card !== "object") {
		return false;
	}
	if (typeof card.handle !== "string" || card.handle.length === 0) {
		return false;
	}
	if (!IsArchetype(card.archetype)) {
		return false;
	}
	if (!IsFraction(card.chattiness) || !IsFraction(card.tilt) || !IsFraction(card.timingJitter)) {
		return false;
	}
	if (!Array.isArray(card.catchphrases)) {
		return false;
	}
	if (card.catchphrases.length < 2 || card.catchphrases.length > 3) {
		return false;
	}
	for (let i = 0; i < card.catchphrases.length; i++) {
		const phrase = card.catchphrases[i];
		if (typeof phrase !== "string" || phrase.length === 0) {
			return false;
		}
	}
	return true;
}

/** Chat dice weights and prompt tone for this card (§7.1). */
export function ChatWeighting(card: IdentityCard): {
	chanceMultiplier: number;
	cooldownMultiplier: number;
	toneHint: string;
} {
	return {
		chanceMultiplier: Math.round((0.5 + card.chattiness) * 10000) / 10000,
		cooldownMultiplier: Math.round((1.5 - 0.75 * card.chattiness) * 10000) / 10000,
		toneHint: card.archetype,
	};
}
