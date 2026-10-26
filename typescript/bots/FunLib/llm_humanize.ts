/**
 * Humanize binding (RFC-003 H1/H2): exposes gated gameplay-variance helpers
 * built on llm_humanize_core's skill-tier profiles. Every function returns
 * the identity value (0) when Allow_Humanized_Gameplay is false, so the
 * gameplay seams read as unchanged until the gate is flipped (G5).
 *
 * Tier comes from Customize.Humanize_Tier ("herald"|"guardian"|"legend"),
 * default "guardian". Jitter is signed: sampled within the tier window then
 * centered on zero, so delays shift both ways like human error.
 */
import { ProfileFor, SampleLatency, type SkillTier } from "./llm_humanize_core";

let cached: { on: boolean; tier: SkillTier } | undefined;

function Gate(): { on: boolean; tier: SkillTier } {
	if (cached !== undefined) {
		return cached;
	}
	let on = false;
	let tier: SkillTier = "guardian";
	const [ok, customize] = pcall(require, GetScriptDirectory() + "/FunLib/custom_loader");
	if (ok && type(customize) === "table") {
		on = customize.Allow_Humanized_Gameplay === true;
		const raw = customize.Humanize_Tier;
		if (raw === "herald" || raw === "guardian" || raw === "legend") {
			tier = raw;
		}
	}
	cached = { on, tier };
	return cached;
}

/** Signed last-hit timing error in seconds; 0 when the layer is off. */
export function LastHitDelayJitter(): number {
	const gate = Gate();
	if (!gate.on) {
		return 0;
	}
	const profile = ProfileFor(gate.tier);
	const [lo, hi] = profile.lastHitJitterSec;
	const sampled = SampleLatency(profile, "lastHit", RandomFloat(0, 1));
	return sampled - (lo + hi) / 2;
}
