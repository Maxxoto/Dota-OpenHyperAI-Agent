/**
 * Identity core tests (RFC-002 §7.1) — seeded determinism, trait ranges,
 * phrase count, handle shape, weighting monotonicity, card validation.
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	ChatWeighting,
	SeededIdentity,
	ValidateIdentityCard,
	type Archetype,
	type IdentityCard,
} from "../typescript/bots/FunLib/llm_identity_core";

const HEROES = [
	"npc_dota_hero_axe",
	"npc_dota_hero_pudge",
	"npc_dota_hero_sniper",
	"npc_dota_hero_lina",
	"npc_dota_hero_crystal_maiden",
];
const SEEDS = [0, 1, 7, 42, 20261027];
const ARCHETYPES: Archetype[] = ["cocky", "chill", "whiny", "strategist"];

function Card(overrides: Partial<IdentityCard>): IdentityCard {
	return {
		handle: "axe_enjoyer",
		archetype: "cocky",
		chattiness: 0.5,
		tilt: 0.5,
		timingJitter: 0.5,
		catchphrases: ["ez mid", "gap is gap"],
		...overrides,
	};
}

test("SeededIdentity is deterministic per hero and seed", () => {
	assert.deepEqual(SeededIdentity("npc_dota_hero_axe", 7), SeededIdentity("npc_dota_hero_axe", 7));
	assert.deepEqual(SeededIdentity("axe", 7), SeededIdentity("axe", 7));
	assert.notDeepEqual(SeededIdentity("npc_dota_hero_axe", 7), SeededIdentity("npc_dota_hero_axe", 8));
	assert.notDeepEqual(SeededIdentity("npc_dota_hero_axe", 7), SeededIdentity("npc_dota_hero_pudge", 7));
});

test("archetype always lands in the enum", () => {
	for (const hero of HEROES) {
		for (const seed of SEEDS) {
			const card = SeededIdentity(hero, seed);
			assert.ok(ARCHETYPES.includes(card.archetype), card.archetype + " is not an archetype");
		}
	}
});

test("numeric traits stay clamped in 0..1", () => {
	for (const hero of HEROES) {
		for (const seed of SEEDS) {
			const card = SeededIdentity(hero, seed);
			const traits = [card.chattiness, card.tilt, card.timingJitter];
			for (const value of traits) {
				assert.ok(value >= 0 && value <= 1, card.handle + " trait out of range: " + value);
			}
		}
	}
});

test("catchphrases are two or three distinct non-empty strings", () => {
	for (const hero of HEROES) {
		for (const seed of SEEDS) {
			const card = SeededIdentity(hero, seed);
			assert.ok(card.catchphrases.length >= 2 && card.catchphrases.length <= 3);
			for (const phrase of card.catchphrases) {
				assert.equal(typeof phrase, "string");
				assert.ok(phrase.length > 0);
			}
			assert.equal(new Set(card.catchphrases).size, card.catchphrases.length);
		}
	}
});

test("handle strips the hero prefix and appends a suffix", () => {
	const card = SeededIdentity("npc_dota_hero_axe", 7);
	assert.ok(!card.handle.includes("npc_dota_hero_"));
	assert.ok(card.handle.startsWith("axe_"));
	const suffixes = ["enjoyer", "diff", "gap", "gg", "xp"];
	const suffix = card.handle.slice("axe_".length);
	assert.ok(suffixes.includes(suffix), suffix + " is not a handle suffix");
	for (const hero of HEROES) {
		for (const seed of SEEDS) {
			assert.ok(!SeededIdentity(hero, seed).handle.includes("npc_dota_hero_"));
		}
	}
});

test("ChatWeighting is monotonic in chattiness with fixed endpoints", () => {
	const low = ChatWeighting(Card({ chattiness: 0 }));
	const high = ChatWeighting(Card({ chattiness: 1 }));
	assert.equal(low.chanceMultiplier, 0.5);
	assert.equal(low.cooldownMultiplier, 1.5);
	assert.equal(high.chanceMultiplier, 1.5);
	assert.equal(high.cooldownMultiplier, 0.75);
	assert.equal(low.toneHint, "cocky");
	let prevChance = -1;
	let prevCooldown = 2;
	for (let i = 0; i <= 10; i++) {
		const weight = ChatWeighting(Card({ chattiness: i / 10 }));
		assert.ok(weight.chanceMultiplier > prevChance, "chance must rise with chattiness");
		assert.ok(weight.cooldownMultiplier < prevCooldown, "cooldown must fall with chattiness");
		prevChance = weight.chanceMultiplier;
		prevCooldown = weight.cooldownMultiplier;
	}
});

test("ValidateIdentityCard accepts a real card and rejects junk", () => {
	assert.equal(ValidateIdentityCard(SeededIdentity("npc_dota_hero_axe", 3)), true);
	assert.equal(ValidateIdentityCard(Card({})), true);
	const junk: any[] = [
		undefined,
		null,
		42,
		"axe",
		{},
		Card({ handle: "" }),
		Card({ handle: 7 as any }),
		Card({ archetype: "toxic" as Archetype }),
		Card({ chattiness: -0.1 }),
		Card({ tilt: 1.5 }),
		Card({ timingJitter: NaN }),
		Card({ catchphrases: ["only one"] }),
		Card({ catchphrases: ["a", "b", "c", "d"] }),
		Card({ catchphrases: "ez mid" as any }),
		Card({ catchphrases: ["ok", 7 as any] }),
	];
	for (const card of junk) {
		assert.equal(ValidateIdentityCard(card), false, "accepted junk: " + JSON.stringify(card));
	}
});
