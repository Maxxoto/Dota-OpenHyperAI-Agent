/**
 * Draft adapter (RFC-001 §6, plan task T5).
 *
 * Owns the ask-loop state machine and the candidate-score merge so the
 * hero_selection.lua hook stays data-only (repo rule: new logic lives in TS;
 * legacy Lua files get minimal hooks). Async and purely additive: with the
 * layer off, the budget spent, or the response late, the caller's existing
 * scoring runs unchanged (G5).
 *
 * Ask policy: at most MAX_DRAFT_ASKS per game, one per enemy-lineup
 * signature (so the advisor re-considers once the enemy lineup
 * materializes), and the first pick waits a bounded grace window for the
 * first response before falling back to existing pacing.
 */
import { AskDraftDirective, CachedDraftDirective, DraftAskEnabled } from "./llm_directive";
import { MergeDraftScore } from "./llm_directive_core";
import type { DraftCandidate } from "./llm_state_core";

const MAX_DRAFT_ASKS = 2;
const FIRST_PICK_WAIT_SEC = 6;
const MAX_CANDIDATES = 25;

interface DraftAskState {
	askedSig: string | undefined;
	inFlight: boolean;
	waitUntil: number;
	askedCount: number;
}

let state: DraftAskState | undefined;

function State(): DraftAskState {
	if (state === undefined) {
		state = { askedSig: undefined, inFlight: false, waitUntil: 0, askedCount: 0 };
	}
	return state;
}

/** Score-merge hook: re-ranks one candidate via the cached directive (alpha <= 0.5). */
export function AdjustScore(hero: string, base: number): number {
	const directive = CachedDraftDirective();
	if (directive === undefined) {
		return base;
	}
	for (const pick of directive.picks) {
		if (pick.hero === hero) {
			return MergeDraftScore(base, pick.weight);
		}
	}
	return base;
}

export type DraftStepResult = "wait" | "go";

/**
 * Per-tick draft driver: fire-and-observe, never blocks. May start one async
 * LLM ask (see policy above). Returns "wait" only inside the bounded
 * first-pick grace window with no directive cached yet; "go" otherwise.
 */
export function DraftStep(
	enemyNames: string[],
	candidates: DraftCandidate[],
	bans: string[],
	now: number,
	scheduleInitialized: boolean
): DraftStepResult {
	const s = State();
	if (DraftAskEnabled() && !s.inFlight && s.askedCount < MAX_DRAFT_ASKS) {
		if (CachedDraftDirective() === undefined) {
			const sig = SignatureOf(enemyNames);
			if (sig !== s.askedSig && candidates.length > 0) {
				AskOnce(sig, candidates, bans, now, scheduleInitialized, s);
			}
		}
	}
	if (now < s.waitUntil && CachedDraftDirective() === undefined) {
		return "wait";
	}
	return "go";
}

/**
 * Order-independent lineup signature: identical lineups build identical
 * count tables, so pairs() iteration order (stable per VM for a fixed table)
 * cannot cause spurious re-asks across ticks.
 */
function SignatureOf(enemyNames: string[]): string {
	const counts: { [name: string]: number | undefined } = {};
	for (const name of enemyNames) {
		const current = counts[name];
		counts[name] = current === undefined ? 1 : current + 1;
	}
	// Counted multiset over <=10 names: distinct lineups stay distinct.
	const parts: string[] = [];
	for (const name in counts) {
		parts.push(name + ":" + counts[name]);
	}
	return parts.join("|");
}

function AskOnce(
	sig: string,
	candidates: DraftCandidate[],
	bans: string[],
	now: number,
	scheduleInitialized: boolean,
	s: DraftAskState
): void {
	s.askedSig = sig;
	s.askedCount += 1;
	s.inFlight = true;
	if (!scheduleInitialized) {
		s.waitUntil = now + FIRST_PICK_WAIT_SEC;
	}
	const trimmed =
		candidates.length > MAX_CANDIDATES ? candidates.slice(0, MAX_CANDIDATES) : candidates;
	print("[OHA-LLM] draft ask #" + s.askedCount + " (" + trimmed.length + " candidates)");
	AskDraftDirective({ candidates: trimmed, bans }, "", (directive) => {
		s.inFlight = false;
		if (directive !== undefined) {
			print(
				"[OHA-LLM] draft directive active: "
				+ directive.picks.length + " picks, "
				+ directive.bans.length + " bans"
			);
		}
	});
}
