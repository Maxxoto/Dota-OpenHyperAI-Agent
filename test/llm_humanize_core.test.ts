import test from "node:test";
import assert from "node:assert/strict";
import {
	HumanizeEnabled,
	ProfileFor,
	RollEvent,
	SampleLatency,
	type HumanizeProfile,
	type LatencyKind,
	type SkillTier,
} from "../typescript/bots/FunLib/llm_humanize_core";

const TIERS: SkillTier[] = ["herald", "guardian", "legend"];
const KINDS: LatencyKind[] = ["reaction", "lastHit", "rotation"];

function PairFor(profile: HumanizeProfile, kind: LatencyKind): [number, number] {
	if (kind === "reaction") {
		return profile.reactionLatencySec;
	}
	if (kind === "lastHit") {
		return profile.lastHitJitterSec;
	}
	return profile.rotationDelaySec;
}

function Close(got: number, want: number): void {
	assert.ok(Math.abs(got - want) < 1e-9, `expected ${got} to be within 1e-9 of ${want}`);
}

test("ProfileFor keeps tiers distinct and ordered by magnitude", () => {
	const herald = ProfileFor("herald");
	const guardian = ProfileFor("guardian");
	const legend = ProfileFor("legend");

	assert.equal(herald.tier, "herald");
	assert.equal(guardian.tier, "guardian");
	assert.equal(legend.tier, "legend");
	assert.notDeepEqual(herald, guardian);
	assert.notDeepEqual(guardian, legend);
	assert.notDeepEqual(herald, legend);

	for (const kind of KINDS) {
		const h = PairFor(herald, kind);
		const g = PairFor(guardian, kind);
		const l = PairFor(legend, kind);
		assert.ok(h[0] < h[1], `${kind} herald pair is ordered`);
		assert.ok(g[0] < g[1], `${kind} guardian pair is ordered`);
		assert.ok(l[0] < l[1], `${kind} legend pair is ordered`);
		assert.ok(h[0] > g[0] && g[0] > l[0], `${kind} low bound herald > guardian > legend`);
		assert.ok(h[1] > g[1] && g[1] > l[1], `${kind} high bound herald > guardian > legend`);
	}

	assert.deepEqual(herald.reactionLatencySec, [0.6, 1.2]);
	assert.deepEqual(legend.reactionLatencySec, [0.15, 0.35]);
	assert.equal(herald.mistakeChance, 0.1);
	assert.equal(legend.mistakeChance, 0.02);
	assert.ok(herald.mistakeChance > guardian.mistakeChance);
	assert.ok(guardian.mistakeChance > legend.mistakeChance);

	for (const tier of TIERS) {
		const p = ProfileFor(tier);
		assert.ok(p.tradeWindowChance > 0 && p.tradeWindowChance < 1);
		assert.ok(p.mistakeChance > 0 && p.mistakeChance < 1);
	}

	herald.tradeWindowChance = 0;
	assert.notEqual(ProfileFor("herald").tradeWindowChance, 0);
});

test("SampleLatency interpolates between pair bounds for every kind", () => {
	for (const tier of TIERS) {
		const profile = ProfileFor(tier);
		for (const kind of KINDS) {
			const pair = PairFor(profile, kind);
			Close(SampleLatency(profile, kind, 0), pair[0]);
			Close(SampleLatency(profile, kind, 1), pair[1]);
			Close(SampleLatency(profile, kind, 0.5), (pair[0] + pair[1]) / 2);
			Close(SampleLatency(profile, kind, 0.25), pair[0] + (pair[1] - pair[0]) * 0.25);
			Close(SampleLatency(profile, kind, -0.5), pair[0]);
			Close(SampleLatency(profile, kind, 2), pair[1]);
		}
	}

	const herald = ProfileFor("herald");
	assert.ok(SampleLatency(herald, "rotation", 1) > SampleLatency(herald, "reaction", 1));
	assert.ok(SampleLatency(herald, "reaction", 1) > SampleLatency(herald, "lastHit", 1));
	assert.equal(SampleLatency(herald, "reaction", 0.37), SampleLatency(herald, "reaction", 0.37));
});

test("RollEvent splits exactly at mistakeChance", () => {
	for (const tier of TIERS) {
		const profile = ProfileFor(tier);
		assert.equal(RollEvent(profile, 0), "mistake");
		assert.equal(RollEvent(profile, profile.mistakeChance - 0.001), "mistake");
		assert.equal(RollEvent(profile, profile.mistakeChance), "normal");
		assert.equal(RollEvent(profile, 0.999), "normal");
		assert.equal(RollEvent(profile, 1), "normal");
	}

	const never = { ...ProfileFor("legend"), mistakeChance: 0 };
	assert.equal(RollEvent(never, 0), "normal");
	const always = { ...ProfileFor("legend"), mistakeChance: 1 };
	assert.equal(RollEvent(always, 0.999), "mistake");
});

test("HumanizeEnabled accepts only boolean true", () => {
	assert.equal(HumanizeEnabled(true), true);

	const rejected: any[] = [false, undefined, null, 0, 1, -1, "true", "1", "", {}, [], { Enable: true }];
	for (const value of rejected) {
		assert.equal(HumanizeEnabled(value), false);
	}
});
