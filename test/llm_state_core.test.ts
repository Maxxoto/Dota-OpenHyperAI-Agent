/**
 * Serializer core tests (plan task T3) — budget enforcement, drop order,
 * never-truncated JSON, clamp behavior. Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
    ClampText,
    DIRECTIVE_SCHEMA_V1,
    DraftPrompt,
    MatchPrompt,
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
