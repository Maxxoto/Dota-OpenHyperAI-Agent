/**
 * Identity binding (RFC-002 §7.1): caches the seeded identity card per hero
 * and game seed, and renders the spawn-time announcement the chat layer logs.
 */
import { SeededIdentity, type IdentityCard } from "./llm_identity_core";

const cache = new Map<string, IdentityCard>();

/** Cached card for this hero under this game seed. */
export function IdentityFor(hero: string, seed: number): IdentityCard {
	const key = hero + "|" + seed;
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const card = SeededIdentity(hero, seed);
	cache.set(key, card);
	return card;
}

/** One-line spawn announcement, e.g. "[OHA-LLM] identity axe_enjoyer: cocky (chattiness 0.7)". */
export function IdentityAnnouncement(hero: string, seed: number): string {
	const card = IdentityFor(hero, seed);
	return "[OHA-LLM] identity " + card.handle + ": " + card.archetype + " (chattiness " + card.chattiness + ")";
}
