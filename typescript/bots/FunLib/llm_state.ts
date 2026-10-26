/**
 * Lua-bound gatherers building llm_state_core contexts from live game state
 * (RFC-001 §4.2, plan task T3). Accessor patterns mirror FretBots/Utilities.lua
 * (production-proven). Pure serialization/budget logic lives in llm_state_core.
 */
import type {
    DraftCandidate,
    DraftContext,
    DraftSlot,
    MatchContext,
    MatchEnemy,
} from "./llm_state_core";

export interface ItemHandle {
    GetName(): string;
}

/** Minimal typed surface of a bot hero handle (colon-call semantics via interface). */
export interface BotHandle {
    GetUnitName(): string;
    GetLevel(): number;
    GetGold(): number;
    GetPlayerID(): number;
    GetKills(): number;
    GetDeaths(): number;
    GetAssists(): number;
    GetItemInSlot(slot: number): ItemHandle | undefined;
}

const RADIANT = 2; // DOTA_TEAM_GOODGUYS
const DIRE = 3; // DOTA_TEAM_BADGUYS

function LocaleCode(): string {
    // Two-tier loader precedence for Customize (game/Customize overrides bots/).
    const [ok, customize] = pcall(require, GetScriptDirectory() + "/FunLib/custom_loader");
    if (ok && type(customize) === "table" && type(customize.Localization) === "string") {
        return customize.Localization;
    }
    return "en";
}

function PicksForTeam(team: number): string[] {
    const picks: string[] = [];
    const count = PlayerResource.GetPlayerCount();
    for (let pId = 0; pId < count; pId += 1) {
        if (
            PlayerResource.IsValidPlayerID(pId) &&
            PlayerResource.GetTeam(pId) === team
        ) {
            const hero = GetSelectedHeroName(pId);
            if (hero !== "") {
                picks.push(hero);
            }
        }
    }
    return picks;
}

function InventoryItems(bot: BotHandle): string[] {
    const items: string[] = [];
    // Slots 0-5 inventory, 6-8 backpack.
    for (let i = 0; i <= 8; i += 1) {
        const item = bot.GetItemInSlot(i);
        if (item !== undefined) {
            const [ok, name] = pcall(() => item.GetName());
            if (ok && type(name) === "string") {
                items.push(name);
            }
        }
    }
    return items;
}

export interface DraftFacts {
    /** Top-N candidates with base engine scores, supplied by the draft adapter (T5). */
    candidates: DraftCandidate[];
    bans?: string[] | undefined;
    slots?: DraftSlot[] | undefined;
}

export function GatherDraft(facts: DraftFacts): DraftContext {
    return {
        mode: "dota_mode_" + GetGameMode(),
        gameTimeSec: GameTime(),
        locale: LocaleCode(),
        radiantPicks: PicksForTeam(RADIANT),
        direPicks: PicksForTeam(DIRE),
        bans: facts.bans !== undefined ? facts.bans : [],
        slots: facts.slots !== undefined ? facts.slots : [],
        candidates: facts.candidates,
    };
}

export function GatherMatch(bot: BotHandle): MatchContext {
    const pId = bot.GetPlayerID();
    const team = PlayerResource.GetTeam(pId);
    const enemies: MatchEnemy[] = [];
    const count = PlayerResource.GetPlayerCount();
    for (let eId = 0; eId < count; eId += 1) {
        if (
            eId !== pId &&
            PlayerResource.IsValidPlayerID(eId) &&
            PlayerResource.GetTeam(eId) !== team
        ) {
            const hero = GetSelectedHeroName(eId);
            if (hero !== "") {
                // M1: enemy item handles are not gathered (needs unit handles);
                // the serializer drops empty item lists under budget pressure.
                enemies.push({
                    hero,
                    level: PlayerResource.GetLevel(eId),
                    netWorth: PlayerResource.GetNetWorth(eId),
                    items: [],
                });
            }
        }
    }
    return {
        gameTimeSec: GameTime(),
        hero: bot.GetUnitName(),
        level: bot.GetLevel(),
        netWorth: PlayerResource.GetNetWorth(pId),
        gold: bot.GetGold(),
        kills: PlayerResource.GetKills(pId),
        deaths: PlayerResource.GetDeaths(pId),
        assists: PlayerResource.GetAssists(pId),
        items: InventoryItems(bot),
        enemies,
        towersRadiant: -1,
        towersDire: -1,
    };
}
