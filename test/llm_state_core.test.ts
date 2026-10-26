/**
 * Serializer core tests (plan task T3) — budget enforcement, drop order,
 * never-truncated JSON, clamp behavior. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
    AppendMatchEvent,
    ClampText,
    DIRECTIVE_SCHEMA_V1,
    DraftPrompt,
    MatchPrompt,
    NewMatchEventLog,
    RenderLogTail,
    SerializeDraft,
    SerializeMatch,
    STATE_BUDGET_BYTES,
    type DraftContext,
    type DraftSlot,
    type MatchContext,
} from "../typescript/bots/FunLib/llm_state_core";

const encode = (v: any) => JSON.stringify(v);

function baseDraft(): DraftContext {
    return {
        mode: "dota_mode_3",
        gameTimeSec: -60,
        locale: "en",
        radiantPicks: ["npc_dota_hero_axe", "npc_dota_hero_cm"],
        direPicks: ["npc_dota_hero_pa"],
        bans: ["npc_dota_hero_tinker"],
        slots: [
            { team: 2, pos: 1, hero: "npc_dota_hero_axe" },
            { team: 2, pos: 2, hero: "" },
        ],
        candidates: [
            { hero: "npc_dota_hero_legion", score: 0.8 },
            { hero: "npc_dota_hero_sand_king", score: 0.6 },
        ],
    };
}

function adversarialDraft(): DraftContext {
    const longName = (tag: string) => "npc_dota_hero_" + tag.padEnd(40, "x");
    const candidates = Array.from({ length: 20 }, (_, i) => ({
        hero: longName("cand" + i),
        score: i / 20,
    }));
    const slots: DraftSlot[] = Array.from({ length: 10 }, (_, i) => ({
        team: i < 5 ? 2 : 3,
        pos: (i % 5) + 1,
        hero: i % 3 === 0 ? longName("slot" + i) : "",
    }));
    const bans = Array.from({ length: 20 }, (_, i) => longName("ban" + i));
    return {
        mode: "dota_mode_3",
        gameTimeSec: -85,
        locale: "en",
        radiantPicks: Array.from({ length: 5 }, (_, i) => longName("r" + i)),
        direPicks: Array.from({ length: 5 }, (_, i) => longName("d" + i)),
        bans,
        slots,
        candidates,
    };
}

function baseMatch(): MatchContext {
    return {
        gameTimeSec: 900,
        hero: "npc_dota_hero_axe",
        level: 12,
        netWorth: 8500,
        gold: 900,
        kills: 4,
        deaths: 2,
        assists: 7,
        items: ["item_blade_mail", "item_blink"],
        enemies: [
            { hero: "npc_dota_hero_pa", level: 13, netWorth: 9200, items: ["item_bfury"] },
        ],
        towersRadiant: -1,
        towersDire: -1,
    };
}

test("base draft context fits budget untouched and round-trips", () => {
    const res = SerializeDraft(baseDraft(), encode, STATE_BUDGET_BYTES);
    assert.equal(res.overBudget, false);
    assert.deepEqual(res.dropped, []);
    const parsed = JSON.parse(res.json);
    assert.equal(parsed.mode, "dota_mode_3");
    assert.equal(parsed.candidates.length, 2);
    assert.equal(parsed.candidates[0].score, 0.8);
    assert.deepEqual(parsed.radiantPicks, ["npc_dota_hero_axe", "npc_dota_hero_cm"]);
});

test("adversarial draft fits budget with valid JSON and ordered drops", () => {
    const res = SerializeDraft(adversarialDraft(), encode, STATE_BUDGET_BYTES);
    assert.equal(res.overBudget, false);
    assert.ok(res.bytes <= STATE_BUDGET_BYTES);
    const parsed = JSON.parse(res.json); // never truncated mid-JSON
    assert.ok(Array.isArray(parsed.candidates));
    assert.ok(parsed.candidates.length <= 12);
    // drop order is deterministic and least-salient-first
    const order = ["locale", "slots", "bans", "candidates<=8", "candidates<=5", "scores"];
    for (let i = 1; i < res.dropped.length; i += 1) {
        assert.ok(order.indexOf(res.dropped[i]) > order.indexOf(res.dropped[i - 1]));
    }
});

test("impossible budget still emits parseable JSON with a 5-candidate floor", () => {
    const res = SerializeDraft(adversarialDraft(), encode, 10);
    assert.equal(res.overBudget, true);
    const parsed = JSON.parse(res.json);
    assert.equal(parsed.candidates.length, 5);
    assert.equal(parsed.candidates[0].score, undefined); // scores stage applied
    assert.ok(res.dropped.includes("scores"));
});

test("ClampText passthrough, whitespace trim, and hard cut", () => {
    assert.equal(ClampText("short", 100), "short");
    const trimmed = ClampText("word word word word", 11);
    assert.ok(trimmed.length <= 11);
    assert.ok(trimmed.endsWith("word"));
    const hard = ClampText("xxxxxxxxxxxxxxxxxxxx", 5);
    assert.equal(hard, "xxxxx");
});

test("DraftPrompt embeds schema in system, memory in user, clamped", () => {
    const hugeNotes = "note about pa. ".repeat(2000); // ~28 KB
    const prompt = DraftPrompt(baseDraft(), hugeNotes, encode, STATE_BUDGET_BYTES);
    assert.ok(prompt.system.includes(DIRECTIVE_SCHEMA_V1));
    assert.ok(prompt.user.includes("MEMORY:"));
    assert.ok(prompt.user.length < STATE_BUDGET_BYTES + 8192 + 500);
    const noMemory = DraftPrompt(baseDraft(), "", encode, STATE_BUDGET_BYTES);
    assert.ok(!noMemory.user.includes("MEMORY:"));
});

test("match serialization drops enemy detail in order, omits unknown towers", () => {
    const fat: MatchContext = {
        ...baseMatch(),
        enemies: Array.from({ length: 5 }, (_, i) => ({
            hero: "npc_dota_hero_" + String(i).padEnd(40, "e"),
            level: 10 + i,
            netWorth: 5000 + i,
            items: ["item_long_item_name_" + i],
        })),
    };
    const res = SerializeMatch(fat, encode, 400);
    const parsed = JSON.parse(res.json);
    assert.equal(parsed.towers, undefined); // -1 = unknown, always omitted
    assert.equal(parsed.hero, "npc_dota_hero_axe");
    // drops proceed in the fixed order
    const order = ["towers", "enemyItems", "enemyNetWorth", "enemyLevels"];
    for (let i = 1; i < res.dropped.length; i += 1) {
        assert.ok(order.indexOf(res.dropped[i]) > order.indexOf(res.dropped[i - 1]));
    }
    const prompt = MatchPrompt(baseMatch(), encode, STATE_BUDGET_BYTES);
    assert.ok(prompt.system.includes(DIRECTIVE_SCHEMA_V1));
    assert.ok(!prompt.overBudget);
});

test("AppendMatchEvent evicts the oldest entries past the cap", () => {
    const log = NewMatchEventLog();
    assert.equal(log.events.length, 0);
    for (let i = 0; i < 30; i += 1) {
        AppendMatchEvent(log, i, "event " + i);
    }
    assert.equal(log.events.length, 24);
    assert.equal(log.events[0].text, "event 6");
    assert.equal(log.events[23].text, "event 29");
    const small = NewMatchEventLog();
    AppendMatchEvent(small, 0, "a", 2);
    AppendMatchEvent(small, 1, "b", 2);
    AppendMatchEvent(small, 2, "c", 2);
    assert.deepEqual(
        small.events.map((e) => e.text),
        ["b", "c"]
    );
});

test("AppendMatchEvent trims text to 80 chars and keeps short text intact", () => {
    const log = NewMatchEventLog();
    AppendMatchEvent(log, 5, "x".repeat(120));
    assert.equal(log.events[0].text.length, 80);
    assert.equal(log.events[0].text, "x".repeat(80));
    AppendMatchEvent(log, 6, "short line");
    assert.equal(log.events[1].text, "short line");
});

test("AppendMatchEvent ignores empty text", () => {
    const log = NewMatchEventLog();
    AppendMatchEvent(log, 10, "");
    assert.equal(log.events.length, 0);
    AppendMatchEvent(log, 11, "kept");
    assert.equal(log.events.length, 1);
});

test("RenderLogTail formats MM:SS with zero padding", () => {
    const log = NewMatchEventLog();
    AppendMatchEvent(log, 195, "roshan fight");
    assert.equal(RenderLogTail(log), "03:15 roshan fight");
    const early = NewMatchEventLog();
    AppendMatchEvent(early, 5, "bounty rune");
    assert.equal(RenderLogTail(early), "00:05 bounty rune");
});

test("RenderLogTail keeps the newest line even when over budget", () => {
    const log = NewMatchEventLog();
    AppendMatchEvent(log, 60, "old event here");
    AppendMatchEvent(log, 120, "newest event");
    assert.equal(RenderLogTail(log, 4), "02:00 newest event");
});

test("RenderLogTail renders oldest-first and drops the oldest lines first", () => {
    const log = NewMatchEventLog();
    AppendMatchEvent(log, 0, "first");
    AppendMatchEvent(log, 65, "second");
    AppendMatchEvent(log, 195, "third");
    assert.equal(RenderLogTail(log), "00:00 first\n01:05 second\n03:15 third");
    // 12 + 1 + 11 = 24 bytes fits the two newest lines exactly
    assert.equal(RenderLogTail(log, 24), "01:05 second\n03:15 third");
    assert.equal(RenderLogTail(NewMatchEventLog()), "");
});
