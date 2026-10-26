/**
 * Pure core for the skill-tier humanization profile (RFC-003 H1, §6.3) and its
 * sampled latencies (RFC-003 H4, §9.2).
 *
 * Everything here is a pure function of (tier, roll01): the binding owns the
 * config file, the seed, the per-signal release queue and the engine seams, so
 * the tier table stays unit-testable with no engine, no clock and no RNG.
 *
 * Dual-runtime: this module runs under Node in tests and inside the Dota Lua
 * VM in game, so it uses ONLY constructs that compile cleanly through
 * typescript-to-lua. No regex literals, no `lastIndexOf`, no `Math.random`,
 * no Lua globals (`type`, `string.find`). Callers supply the 0..1 roll from
 * the seeded RNG; this layer never samples one itself.
 *
 * The gate is deliberately mechanical: `HumanizeEnabled` is true only for the
 * boolean `true`, so a config value of `1`, `"true"` or a table can never
 * switch humanization on by accident.
 */

export type SkillTier = "herald" | "guardian" | "legend";

export type LatencyKind = "reaction" | "lastHit" | "rotation";

export interface HumanizeProfile {
	tier: SkillTier;
	reactionLatencySec: [number, number];
	lastHitJitterSec: [number, number];
	rotationDelaySec: [number, number];
	tradeWindowChance: number;
	mistakeChance: number;
}

/**
 * Tier table. Herald is late and sloppy, guardian sits in the middle, legend
 * reacts near current-bot speed but still misses a little (RFC-003 §9.2:
 * herald p50 420 ms / p90 700 ms, guardian 340 / 560, legend 270 / 420).
 * Every magnitude pair is ordered herald > guardian > legend.
 */
export function ProfileFor(tier: SkillTier): HumanizeProfile {
	if (tier === "herald") {
		return {
			tier: "herald",
			reactionLatencySec: [0.6, 1.2],
			lastHitJitterSec: [0.25, 0.45],
			rotationDelaySec: [1.2, 2.4],
			tradeWindowChance: 0.35,
			mistakeChance: 0.1,
		};
	}
	if (tier === "legend") {
		return {
			tier: "legend",
			reactionLatencySec: [0.15, 0.35],
			lastHitJitterSec: [0.04, 0.14],
			rotationDelaySec: [0.2, 0.6],
			tradeWindowChance: 0.8,
			mistakeChance: 0.02,
		};
	}
	// Unrecognized runtime values resolve mid-tier; the engine gate owns "off".
	return {
		tier: "guardian",
		reactionLatencySec: [0.34, 0.56],
		lastHitJitterSec: [0.12, 0.28],
		rotationDelaySec: [0.6, 1.4],
		tradeWindowChance: 0.55,
		mistakeChance: 0.05,
	};
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

function PairFor(profile: HumanizeProfile, kind: LatencyKind): [number, number] {
	if (kind === "reaction") {
		return profile.reactionLatencySec;
	}
	if (kind === "lastHit") {
		return profile.lastHitJitterSec;
	}
	return profile.rotationDelaySec;
}

/**
 * Deterministic linear interpolation inside the tier's pair: roll01 0 returns
 * the low bound, 1 the high bound, and the result is clamped to the pair so a
 * stray roll can never stretch a latency outside its design band.
 */
export function SampleLatency(profile: HumanizeProfile, kind: LatencyKind, roll01: number): number {
	const pair = PairFor(profile, kind);
	const low = pair[0];
	const high = pair[1];
	return low + (high - low) * Clamp01(roll01);
}

export function RollEvent(profile: HumanizeProfile, roll01: number): "mistake" | "normal" {
	if (Clamp01(roll01) < profile.mistakeChance) {
		return "mistake";
	}
	return "normal";
}

export function HumanizeEnabled(flag: any): boolean {
	return flag === true;
}
