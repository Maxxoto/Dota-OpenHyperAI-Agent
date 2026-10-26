/**
 * Strategy core tests (RFC-002 §5) — directive validation, desire merge,
 * checkpoint gating, identity fallback. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	IdentityDirectives,
	MergeDesire,
	ParseStrategy,
	ShouldAskStrategy,
	STRATEGY_NOTE_MAX,
} from "../typescript/bots/FunLib/llm_strategy_core";

const SAMPLE = {
	schema: "oha-strategy-v1",
	push: { top: 0.0, mid: 0.6, bot: 0.3 },
	defend: { top: 0.2, mid: 0.5, bot: 0.2 },
	farm: { top: 0.3, mid: 0.3, bot: 0.4 },
	rosh: 0.4,
	stance: "split-push",
	note: "enemy groups at 20, avoid 5v5",
};

function Sample(): any {
	return JSON.parse(JSON.stringify(SAMPLE));
}

test("ParseStrategy accepts the RFC §5.2 sample verbatim", () => {
	const parsed = ParseStrategy(Sample());
	assert.ok(parsed !== undefined);
	assert.deepEqual(parsed, SAMPLE);
});

test("ParseStrategy discards payloads that are not objects", () => {
	assert.equal(ParseStrategy(undefined), undefined);
	assert.equal(ParseStrategy(null), undefined);
	assert.equal(ParseStrategy("oha-strategy-v1"), undefined);
	assert.equal(ParseStrategy([SAMPLE]), undefined);
	assert.equal(ParseStrategy(42), undefined);
});

test("ParseStrategy discards a missing or wrong schema", () => {
	const missing = Sample();
	delete missing.schema;
	assert.equal(ParseStrategy(missing), undefined);

	const wrong = Sample();
	wrong.schema = "oha-strategy-v0";
	assert.equal(ParseStrategy(wrong), undefined);
});

test("ParseStrategy discards an unknown stance", () => {
	const unknown = Sample();
	unknown.stance = "rotating";
	assert.equal(ParseStrategy(unknown), undefined);

	const missing = Sample();
	delete missing.stance;
	assert.equal(ParseStrategy(missing), undefined);
});

test("ParseStrategy discards a missing or non-numeric lane key", () => {
	const missingLane = Sample();
	delete missingLane.push.mid;
	assert.equal(ParseStrategy(missingLane), undefined);

	const missingBlock = Sample();
	delete missingBlock.farm;
	assert.equal(ParseStrategy(missingBlock), undefined);

	const wrongType = Sample();
	wrongType.defend.bot = "0.2";
	assert.equal(ParseStrategy(wrongType), undefined);
});

test("ParseStrategy discards a missing or non-numeric rosh", () => {
	const missing = Sample();
	delete missing.rosh;
	assert.equal(ParseStrategy(missing), undefined);

	const wrongType = Sample();
	wrongType.rosh = "0.4";
	assert.equal(ParseStrategy(wrongType), undefined);
});

test("ParseStrategy clamps out-of-range numerics instead of discarding", () => {
	const raw = Sample();
	raw.push.top = 1.7;
	raw.push.mid = -0.2;
	raw.defend.bot = 3;
	raw.farm.top = -5;
	raw.rosh = 2.5;
	const parsed = ParseStrategy(raw);
	assert.ok(parsed !== undefined);
	assert.equal(parsed.push.top, 1);
	assert.equal(parsed.push.mid, 0);
	assert.equal(parsed.push.bot, 0.3);
	assert.equal(parsed.defend.bot, 1);
	assert.equal(parsed.farm.top, 0);
	assert.equal(parsed.rosh, 1);
});

test("ParseStrategy truncates note to the core limit and ignores non-strings", () => {
	const long = Sample();
	long.note = "x".repeat(400);
	const parsed = ParseStrategy(long);
	assert.ok(parsed !== undefined);
	assert.equal(parsed.note === undefined ? -1 : parsed.note.length, STRATEGY_NOTE_MAX);
	assert.equal(parsed.note, "x".repeat(STRATEGY_NOTE_MAX));

	const absent = Sample();
	delete absent.note;
	const noNote = ParseStrategy(absent);
	assert.ok(noNote !== undefined);
	assert.equal(noNote.note, undefined);

	const wrongType = Sample();
	wrongType.note = 7;
	const ignored = ParseStrategy(wrongType);
	assert.ok(ignored !== undefined);
	assert.equal(ignored.note, undefined);
});

test("MergeDesire interpolates, caps alpha at 0.5, and stays in bounds", () => {
	assert.equal(MergeDesire(0.3, 0.9, 0), 0.3, "alpha 0 keeps the base");
	assert.equal(
		Math.round(MergeDesire(0.4, 0.8, 0.25) * 1000) / 1000,
		0.5,
		"alpha 0.25 is a quarter step"
	);
	assert.equal(MergeDesire(0, 1, 10), 0.5, "alpha clamps to 0.5");
	assert.equal(MergeDesire(0, 1, 0.5), 0.5);
	assert.equal(MergeDesire(2, 2, 0.5), 1, "output clamps above 1");
	assert.equal(MergeDesire(-1, -1, 0.5), 0, "output clamps below 0");
});

test("ShouldAskStrategy enforces spacing and the per-game cap", () => {
	assert.equal(ShouldAskStrategy(0, -1000000, 0), true, "first checkpoint");
	assert.equal(ShouldAskStrategy(299, 0, 0), false, "299s < 300s spacing");
	assert.equal(ShouldAskStrategy(300, 0, 0), true, "300s spacing reached");
	assert.equal(
		ShouldAskStrategy(10000, 0, 8),
		false,
		"cap reached blocks even when spaced"
	);
	assert.equal(ShouldAskStrategy(10000, 0, 7), true, "one slot left");
	assert.equal(
		ShouldAskStrategy(60, 0, 0, 8, 300),
		false,
		"default spacing applies"
	);
	assert.equal(ShouldAskStrategy(60, 0, 0, 8, 30), true, "custom spacing");
	assert.equal(ShouldAskStrategy(60, 0, 4, 4, 30), false, "custom cap");
});

test("IdentityDirectives is the neutral group fallback", () => {
	const d = IdentityDirectives();
	assert.equal(d.schema, "oha-strategy-v1");
	assert.equal(d.stance, "group");
	assert.equal(d.rosh, 0.5);
	for (const lane of ["push", "defend", "farm"]) {
		const weights = d[lane as "push" | "defend" | "farm"];
		assert.equal(weights.top, 0.5);
		assert.equal(weights.mid, 0.5);
		assert.equal(weights.bot, 0.5);
	}
	assert.deepEqual(ParseStrategy(d), d, "the fallback parses as a valid directive");
});
