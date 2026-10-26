/**
 * Type declarations for the handwritten Lua module `bots/Customize/general.lua`.
 *
 * This is a declaration-only file: tstl never emits Lua for `.d.ts` modules, which
 * prevents the build from overwriting the handwritten configuration file
 * (RFC-001 risk R5 / plan task T0). The require path is listed in
 * `tsconfig-tstl.json` `noResolvePaths` (same pattern as `bots/FunLib/jmz_func`),
 * so runtime `require` calls emitted by importers resolve to the handwritten Lua
 * module, exactly as before.
 */
interface WeakPenalty {
    type: "linear" | "quad" | "exp";
    /** linear/quad coefficient */
    k?: number;
    /** exp base */
    base?: number;
}

interface FretbotsSettings {
    /** Default difficulty, a number between: [0, 10] */
    Default_Difficulty: number;
    /** Default ally bots bonus scale comparing to enemy bots, a number between: [0, 1] */
    Default_Ally_Scale: number;
    /** Whether the team may vote for difficulty; false applies the default difficulty directly. */
    Allow_To_Vote: boolean;
    /** Set to false to disable all sounds from Fretbots mode */
    Play_Sounds: boolean;
    /** Set to play chatwheel taunt sounds when the human player dies */
    Player_Death_Sound: boolean;
}

interface CustomizeTable {
    /** Master switch: true to turn on ALL custom settings in general.lua, false to turn them off. */
    Enable: boolean;
    /** Bot chat locale: "en" | "zh" | "ru" | "ja" (best effort). */
    Localization: string;
    /** Hero internal names the bots must not pick (best effort; see general.lua notes). */
    Ban: string[];
    /** Radiant picks by lobby slot order, pos 1-5 top to bottom; missing/"Random" entries fall back to random. */
    Radiant_Heros: string[];
    /** Dire picks, same rules as Radiant_Heros. */
    Dire_Heros: string[];
    /** Allow bots to randomly pick repeated heroes (may reduce experience; see general.lua notes). */
    Allow_Repeated_Heroes: boolean;
    /** Max number of "weak" heroes allowed in a bot team. */
    Weak_Hero_Cap: number;
    /** Weak-hero pick penalty curve. */
    Weak_Penalty: WeakPenalty;
    /** Exact match on unit names for the ban list; false allows guarded substring matches (length >= 6). */
    Strict_Ban_Match: boolean;
    /** Allow trash talk (first blood, kills, etc.). Disabling this also disables GPT chat. */
    Allow_Trash_Talk: boolean;
    /** Allow bots to answer player chat with GPT-generated text. Requires Allow_Trash_Talk. */
    Allow_AI_GPT_Response: boolean;
    /**
     * Master switch for the LLM advisor layer (RFC-001): adaptive draft counter-picks,
     * adaptive builds, natural chat. OFF by default; also requires game/Customize/llm.lua.
     * Optional because permanent user overrides (game/Customize/general.lua) may predate it;
     * nil is treated as false at runtime.
     */
    Allow_LLM_Advisor?: boolean;
    /** Trash talk level: 1 = none from allies/taunts only, 2 = allies also trash talk + enemy taunts. */
    Trash_Talk_Level: number;
    /** Radiant bot names by slot; missing entries get a random name. */
    Radiant_Names: string[];
    /** Dire bot names by slot; missing entries get a random name. */
    Dire_Names: string[];
    /** Desire level for group pushing: 1 mild, 3 almost always push together. */
    Force_Group_Push_Level: number;
    /** Enhanced Fretbots mode settings (override FretBots/SettingsDefault.lua). */
    Fretbots: FretbotsSettings;
    /** 0: fully think through, 1-10: think less frequently (trades bot IQ for FPS). */
    ThinkLess: number;
}

declare const Customize: CustomizeTable;
export = Customize;
