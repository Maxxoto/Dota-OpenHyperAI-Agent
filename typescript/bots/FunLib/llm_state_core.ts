/**
 * Pure prompt-state serialization for the LLM advisor (RFC-001 §4.2, plan task T3).
 *
 * Contains no Lua globals: the JSON encoder is injected, so this module is fully
 * testable under Node (`npm test`). The Lua gatherers live in llm_state.ts.
 *
 * Budget contract (RFC-001 §4.2): game-state snapshots stay within a byte budget
 * by dropping fields in a deterministic least-salient-first order. Rendering is
 * structural — the JSON is re-encoded after every drop, so it is NEVER truncated
 * mid-structure. Memory notes are clamped separately (string-level trim at a
 * whitespace boundary, then re-encoded).
 */

export type Encoder = (value: any) => string;

export const DIRECTIVE_SCHEMA_V1 = "oha.directive.v1";
export const STATE_BUDGET_BYTES = 4096;
export const MEMORY_BUDGET_BYTES = 8192;

export interface DraftCandidate {
    hero: string;
    score: number;
}

export interface DraftSlot {
    team: number;
    pos: number;
    hero: string;
}

export interface DraftContext {
    mode: string;
    gameTimeSec: number;
    locale: string;
    radiantPicks: string[];
    direPicks: string[];
    bans: string[];
    slots: DraftSlot[];
    candidates: DraftCandidate[];
}

export interface MatchEnemy {
    hero: string;
    level: number;
    netWorth: number;
    items: string[];
}

export interface MatchContext {
    gameTimeSec: number;
    hero: string;
    level: number;
    netWorth: number;
    gold: number;
    kills: number;
    deaths: number;
    assists: number;
    items: string[];
    enemies: MatchEnemy[];
    /** -1 = unknown (tower IDs are not reliably enumerated in M1). */
    towersRadiant: number;
    towersDire: number;
}

export interface SerializeResult {
    json: string;
    bytes: number;
    dropped: string[];
    overBudget: boolean;
}

export interface PromptPair {
    system: string;
    user: string;
    dropped: string[];
    overBudget: boolean;
}

interface DraftOpts {
    locale: boolean;
    slots: boolean;
    bans: boolean;
    scores: boolean;
    candidateLimit: number;
}

interface MatchOpts {
    towers: boolean;
    enemyItems: boolean;
    enemyNetWorth: boolean;
    enemyLevels: boolean;
}

const DRAFT_STAGES: Array<Partial<DraftOpts>> = [
    {},
    { locale: false },
    { slots: false },
    { bans: false },
    { candidateLimit: 8 },
    { candidateLimit: 5 },
    { scores: false },
];

const MATCH_STAGES: Array<Partial<MatchOpts>> = [
    {},
    { towers: false },
    { enemyItems: false },
    { enemyNetWorth: false },
    { enemyLevels: false },
];

function RenderDraft(ctx: DraftContext, o: DraftOpts): any {
    const out: any = {
        mode: ctx.mode,
        gameTimeSec: ctx.gameTimeSec,
        radiantPicks: ctx.radiantPicks,
        direPicks: ctx.direPicks,
        candidates: ctx.candidates.slice(0, o.candidateLimit).map((c) =>
            o.scores ? { hero: c.hero, score: c.score } : { hero: c.hero }
        ),
    };
    if (o.locale) {
        out.locale = ctx.locale;
    }
    if (o.slots) {
        out.slots = ctx.slots;
    }
    if (o.bans) {
        out.bans = ctx.bans;
    }
    return out;
}

function RenderMatch(ctx: MatchContext, o: MatchOpts): any {
    const enemies = ctx.enemies.map((e) => {
        const item: any = { hero: e.hero };
        if (o.enemyLevels) {
            item.level = e.level;
        }
        if (o.enemyNetWorth) {
            item.netWorth = e.netWorth;
        }
        if (o.enemyItems) {
            item.items = e.items;
        }
        return item;
    });
    const out: any = {
        gameTimeSec: ctx.gameTimeSec,
        hero: ctx.hero,
        level: ctx.level,
        netWorth: ctx.netWorth,
        gold: ctx.gold,
        kda: [ctx.kills, ctx.deaths, ctx.assists],
        items: ctx.items,
        enemies,
    };
    if (o.towers && ctx.towersRadiant >= 0 && ctx.towersDire >= 0) {
        out.towers = { radiant: ctx.towersRadiant, dire: ctx.towersDire };
    }
    return out;
}

export function SerializeDraft(ctx: DraftContext, encode: Encoder, budgetBytes: number): SerializeResult {
    const opts: DraftOpts = { locale: true, slots: true, bans: true, scores: true, candidateLimit: 12 };
    const dropped: string[] = [];
    let json = "";
    for (const stage of DRAFT_STAGES) {
        if (stage.locale === false) {
            opts.locale = false;
            dropped.push("locale");
        }
        if (stage.slots === false) {
            opts.slots = false;
            dropped.push("slots");
        }
        if (stage.bans === false) {
            opts.bans = false;
            dropped.push("bans");
        }
        if (stage.candidateLimit !== undefined) {
            opts.candidateLimit = stage.candidateLimit;
            dropped.push("candidates<=" + stage.candidateLimit);
        }
        if (stage.scores === false) {
            opts.scores = false;
            dropped.push("scores");
        }
        json = encode(RenderDraft(ctx, opts));
        if (json.length <= budgetBytes) {
            return { json, bytes: json.length, dropped, overBudget: false };
        }
    }
    return { json, bytes: json.length, dropped, overBudget: true };
}

export function SerializeMatch(ctx: MatchContext, encode: Encoder, budgetBytes: number): SerializeResult {
    const opts: MatchOpts = { towers: true, enemyItems: true, enemyNetWorth: true, enemyLevels: true };
    const dropped: string[] = [];
    let json = "";
    for (const stage of MATCH_STAGES) {
        if (stage.towers === false) {
            opts.towers = false;
            dropped.push("towers");
        }
        if (stage.enemyItems === false) {
            opts.enemyItems = false;
            dropped.push("enemyItems");
        }
        if (stage.enemyNetWorth === false) {
            opts.enemyNetWorth = false;
            dropped.push("enemyNetWorth");
        }
        if (stage.enemyLevels === false) {
            opts.enemyLevels = false;
            dropped.push("enemyLevels");
        }
        json = encode(RenderMatch(ctx, opts));
        if (json.length <= budgetBytes) {
            return { json, bytes: json.length, dropped, overBudget: false };
        }
    }
    return { json, bytes: json.length, dropped, overBudget: true };
}

/** Trim text to maxBytes at a whitespace boundary (string-level; re-encoded by caller). */
export function ClampText(text: string, maxBytes: number): string {
    if (text.length <= maxBytes) {
        return text;
    }
    const cut = text.slice(0, maxBytes);
    for (let i = cut.length - 1; i > 0; i -= 1) {
        const ch = cut.charAt(i);
        if (ch === " " || ch === "\n") {
            return cut.slice(0, i);
        }
    }
    return cut;
}

export function DraftSystemPrompt(): string {
    return "You are the drafting brain of a Dota 2 bot team. "
        + "Reply with STRICT JSON only - no prose, no markdown fences. "
        + "Schema " + DIRECTIVE_SCHEMA_V1 + ": "
        + '{"schema":"' + DIRECTIVE_SCHEMA_V1 + '","phase":"draft",'
        + '"picks":[{"hero":"npc_dota_hero_x","weight":0.9,"reason":"short"}],'
        + '"bans":[{"hero":"npc_dota_hero_y","weight":0.5}],'
        + '"builds":{"npc_dota_hero_x":{"pos":3,"items":["item_blade_mail"],"ability_order":["e","q","e","w","e","r"],"talents":["l","r","l","r"]}},'
        + '"meta":{"confidence":0.8,"summary":"one line"}}. '
        + "Rules: hero names must be npc_dota_hero_* internal names; items must be item_* internal purchase names; "
        + "weights in [0,1]; at most 12 picks and 12 bans; ability_order letters from {q,w,e,r} only; "
        + "include builds for your recommended picks; prefer counter-picks against the enemy lineup shown.";
}

export function MatchSystemPrompt(): string {
    return "You are the item and skill build brain of one Dota 2 bot. "
        + "Reply with STRICT JSON only - no prose, no markdown fences. "
        + "Schema " + DIRECTIVE_SCHEMA_V1 + ": "
        + '{"schema":"' + DIRECTIVE_SCHEMA_V1 + '","phase":"build",'
        + '"builds":{"npc_dota_hero_x":{"pos":1,"items":["item_bkb"],"ability_order":["q","w","q","e","q","r"],"talents":["r","l","r","l"]}},'
        + '"meta":{"confidence":0.7,"summary":"one line"}}. '
        + "Adapt items to the enemy lineup and current game state shown; "
        + "items must be item_* internal purchase names.";
}

export function DraftPrompt(
    ctx: DraftContext,
    memoryNotes: string,
    encode: Encoder,
    budgetBytes: number
): PromptPair {
    const res = SerializeDraft(ctx, encode, budgetBytes);
    let user = res.json;
    if (memoryNotes !== "") {
        user = user + "\n\nMEMORY:\n" + ClampText(memoryNotes, MEMORY_BUDGET_BYTES);
    }
    return { system: DraftSystemPrompt(), user, dropped: res.dropped, overBudget: res.overBudget };
}

export function MatchPrompt(ctx: MatchContext, encode: Encoder, budgetBytes: number): PromptPair {
    const res = SerializeMatch(ctx, encode, budgetBytes);
    return { system: MatchSystemPrompt(), user: res.json, dropped: res.dropped, overBudget: res.overBudget };
}

export interface MatchEvent {
    at: number;
    text: string;
}

export interface MatchEventLog {
    events: MatchEvent[];
}

export function NewMatchEventLog(): MatchEventLog {
    return { events: [] };
}

function PadTwo(value: number): string {
    return value < 10 ? "0" + String(value) : String(value);
}

function FormatMatchEvent(ev: MatchEvent): string {
    return PadTwo(Math.floor(ev.at / 60)) + ":" + PadTwo(Math.floor(ev.at % 60)) + " " + ev.text;
}

/** Append one event, evicting the oldest past maxEvents and trimming text to 80 chars. */
export function AppendMatchEvent(log: MatchEventLog, at: number, text: string, maxEvents = 24): void {
    if (text === "") {
        return;
    }
    log.events.push({ at, text: text.length > 80 ? text.slice(0, 80) : text });
    const over = log.events.length - maxEvents;
    for (let i = 0; i < over; i += 1) {
        log.events.shift();
    }
}

/** Render the newest log events, oldest-first, within a byte budget (newest line always kept). */
export function RenderLogTail(log: MatchEventLog, budgetBytes = 600): string {
    const newestFirst: string[] = [];
    let used = 0;
    for (let i = log.events.length - 1; i >= 0; i -= 1) {
        const line = FormatMatchEvent(log.events[i]);
        const cost = newestFirst.length === 0 ? line.length : line.length + 1;
        if (newestFirst.length > 0 && used + cost > budgetBytes) {
            break;
        }
        newestFirst.push(line);
        used += cost;
    }
    const ordered: string[] = [];
    for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
        ordered.push(newestFirst[i]);
    }
    return ordered.join("\n");
}
