# RFC-001: Adaptive LLM Intelligence for OpenHyperAI Dota 2 Bots

| Field | Value |
|---|---|
| **Status** | Draft — awaiting review |
| **Type** | RFC with embedded PRD |
| **Date** | 2026-10-11 |
| **Author** | Research: Dota-OpenHyperAI-Agent |
| **Scope** | Bot hero draft, item/skill builds, in-match strategy adaptation, cross-game learning, natural chat |
| **LLM provider** | Groq — Qwen family (OpenAI-compatible API); local Ollama optional for keyless/offline use |
| **Target patch** | Dota 2 7.39 (current script baseline) |

---

## 1. Summary

This RFC specifies an adaptive intelligence layer for the OpenHyperAI bot script: bots that **counter-draft, adapt item/skill builds to the enemy composition, bias their macro strategy mid-game, chat like real players, and accumulate learning across matches** — powered by LLM calls made **directly from the in-game Lua VM**. Default provider: **Groq (Qwen model family)** via its OpenAI-compatible API; any compatible endpoint works, including a local Ollama.

The architecture follows one non-negotiable principle:

> **Slow Brain / Fast Reflexes.** The LLM operates exclusively at slow timescales (draft screen, respawn, game end) and communicates only through small, strictly-validated *directives*. The existing battle-tested Lua heuristics continue to execute every frame, merely biased by cached directives. If the LLM is unavailable, slow, or wrong, behavior degrades gracefully to today's bots — never worse.

Learning across games closes through **generated config files** — the repository's already-proven pattern (`bots/FretBots/matchups_data.lua` and `neutrals_data.lua` are machine-generated Lua tables loaded via `require`). An offline Node script (`npm run learn`) captures post-game telemetry and writes learned data into the gitignored permanent customization tier (`game/Customize/learned/`), which the game script loads at the next match start.

---

## 2. PRD — Product Requirements

### 2.1 Problem statement

Valve's bot scripting API caps bot intelligence: decision logic must be hand-written heuristics (mode desires, per-hero `Consider` functions, static build tables). The README itself states the ambition: *"We need ML/LLM bots like OpenAI Five."* Today:

- Item/skill builds are static tables per hero (`BotLib/hero_*.lua` `sBuyList`, `tAllAbilityBuildList`), identical regardless of the enemy lineup.
- Drafting scores heroes against a scraped counter table (`matchups_data.lua`) with fixed weights — no reasoning about team composition, synergy, or the human player's patterns.
- The only adaptive mechanism is `FretBots/DynamicDifficulty.lua`, which adjusts gold/XP bonuses in-memory during a single match.
- Nothing persists across matches (the in-game Lua sandbox has no file I/O and no `SetUserData` usage).

### 2.2 Goals

| # | Goal | Phase |
|---|---|---|
| G1 | Bots counter-pick and ban intelligently against the enemy lineup | 1 |
| G2 | Bots adapt item builds, skill orders, and talents to the actual game (enemy comp, own team needs, game state) | 1 |
| G3 | Bots bias macro strategy mid-game (push / defend / group / retreat tendencies) | 2 |
| G4 | Bots accumulate learning across games (matchup notes, build adjustments) via an offline learning loop | 1 (loop) / 2 (mature) |
| G5 | Zero regression: with the LLM layer disabled or failed, behavior is bit-for-bit today's bots | all |
| G6 | Zero per-frame impact: no HTTP, JSON parsing, or validation in any per-tick path | all |
| G7 | Bots chat naturally: persona-consistent, event-aware, `!sp`-localized replies (Groq/Qwen), replacing the proxy chatbot | W |

### 2.3 Non-goals

- **NG1** — Per-frame micro control (ability targeting in `Consider*` functions). The seams are documented (Phase 3) but LLM-driven micro is out of scope; it requires distilled local policies, not live calls.
- **NG2** — Training models (RL, fine-tuning). Phase 3 *prepares the dataset*, running training is future work.
- **NG3** — Multiplayer/competitive integrity guarantees. This runs in **Local Host custom lobbies** (a hard requirement of the script itself); anti-cheat scope is N/A, but API-key hygiene is still addressed (§10).
- **NG4** — Replacing the existing heuristics. They remain the execution engine and the fallback, indefinitely.
- **NG5** — Captain's Mode drafting support. Phase 1 targets All Pick (the dominant custom-lobby mode); CM integration via `FunLib/captain_mode.lua` is an open question (§15).

### 2.4 User stories

- **US1 (solo practicer)**: As a player practicing against bots, I want the enemy team to counter-pick my hero and itemize against me, so practice transfers to real matches.
- **US2 (researcher)**: As the project owner, I want every game to produce a structured telemetry record and an LLM post-mortem, so the system demonstrably learns across sessions and I can study what changed.
- **US3 (tinkerer)**: As a customizer, I want the LLM's generated builds to land in the same format as `Customize/hero/*.lua`, so I can inspect, tweak, or freeze them.
- **US4 (cautious user)**: As a user with no LLM API key, I want the feature fully off by default with zero behavioral change, and a local-Ollama option that needs no key at all.

### 2.5 Success metrics

| Metric | Target | Measurement |
|---|---|---|
| Counter-pick quality | ≥ 60% of LLM picks in top-3 of `matchups_data` counter list for the enemy anchor hero, or accompanied by valid compositional rationale | Draft telemetry, per game |
| Build adaptation | ≥ 1 justified build deviation per game vs the static `sBuyList` (e.g., BKB vs heavy disable, Heaven's Halberd vs right-click) | Build diff log |
| Match outcome | Directional win-rate improvement vs baseline over N ≥ 20 games at fixed difficulty; ±0 acceptable, regression triggers investigation | A/B telemetry (`npm run learn` report) |
| Latency | Draft phase extended ≤ 10 s beyond current pacing; 0 LLM work in any `Think()`/`GetDesire()` call | Gateway instrumentation |
| Reliability | 100% of malformed/timed-out responses fall back silently; no crash, no stuck draft | Validator unit tests + soak lobbies |
| Learning loop | After ≥ 5 games vs a repeated lineup, draft prompts include learned counter-notes and ≥ 1 build adjustment traces to a prior game's insight | `learned/memory.lua` provenance |
| Chat latency | Reply lands ≤ 3 s after trigger (Groq LPU inference) | Gateway instrumentation |
| Chat naturalness | Owner blind-rating ≥ 4/5 on ≥ 30 sampled replies vs the current proxy chatbot; persona consistency per bot across a match | Manual rubric: human-like, context-relevant, correct `!sp` language, no AI-assistant phrasing |

---

## 3. Background — current architecture (as surveyed)

Grounding facts from the codebase (file:line references from the current tree):

### 3.1 Decision pipeline

The engine (Valve's bot framework) drives everything; there is no custom scheduler:

- **Mode arbitration**: each `bots/mode_*_generic.lua` exposes `GetDesire()` (called every ~300 ms); the engine activates the highest-desire mode and calls its `Think()` every frame. Desire bands are defined in `bots/ts_libs/enums.lua:27-41` (`BOT_MODE_DESIRE_NONE..ABSOLUTE`).
- **Ability/item hooks** in `bots/ability_item_usage_generic.lua` (~222 KB): engine-called `ItemUsageThink` (:7717), `AbilityUsageThink` (:7725, dispatches to per-hero `BotBuild.SkillsComplement()`), `BuybackUsageThink` (:7733), `CourierUsageThink` (:7741), `AbilityLevelUpThink` (:7748). Self-throttled via `frameProcessTime` and `Customize.ThinkLess`.
- **Per-hero policy**: ~126 handwritten `bots/BotLib/hero_*.lua` files. Shape (e.g. `hero_axe.lua`): static tables (`tAllAbilityBuildList`, `tTalentTreeList`, `sRoleItemsBuyList['pos_1'..'pos_5']`, `sBuyList`/`sSellList`, lines 19-92) + `X.SkillsComplement()` (:151) calling `X.ConsiderQ/W/E/R` which return `(desire, target, motive)`.
- **Purchases**: `bots/item_purchase_generic.lua` `ItemPurchaseThink` (:464, 1 s cadence) consumes the hero's `sBuyList`; role-based list selection via `FunLib/aba_item.lua:GetRoleItemsBuyList` (:1506).
- **Draft**: `bots/hero_selection.lua` — `Think` (:899) dispatches to `AllPickHeros` (:675) for All Pick; scoring uses the generated counter table at :594-596, gated by `CanPickHero` (:434) and `SkipPickingWeakHeroes` (:481, driven by `Customize.Weak_Hero_Cap`/`Weak_Penalty`). Lane assignment at `UpdateLaneAssignments` (:987). CM path: `FunLib/captain_mode.lua` `CaptainModeLogic` (:344).
- **Per-hero mode overrides already exist**: `FunLib/override_generic/mode_{laning,attack}_generic.lua`, and an extensibility table `ConsiderHeroSpecificRoaming[botName]` in `bots/mode_roam_generic.lua:23` (invoked :104).

### 3.2 Networking is already proven in-game

- `bots/FretBots/Chat.lua:31-58` — live production HTTP: `CreateHTTPRequest("POST", "https://chatgpt-with-dota2bot.onrender.com/"..api)`, JSON body via bundled dkjson, `Authorization` header, async `Send(callback)` with status/timeout handling. Endpoints in use: `start` (game start), `chat` (LLM chatbot), `end` (post-game).
- `bots/ts_libs/utils/http_utils/http_req.lua` — a second, TS-generated HTTP layer using `CreateRemoteHTTPRequest` with `BASE_URL = "http://127.0.0.1:5000/"`; its TS source states the intent: *"Interact with backend services empowered with machine learning AI. ML AI is the way out."*
- JSON encode/decode is bundled and bootstrapped: `bots/ts_libs/utils/json.lua`, `game/dkjson.lua`.

**Consequence**: LLM transport from inside the game is a solved problem in this codebase. This RFC adds policy, validation, and memory — not plumbing.

### 3.3 Configuration & generated-data patterns

- **Two-tier config precedence**: `game/Customize/**` (permanent, user-owned) overrides `bots/Customize/**` (workshop, replaced on updates). Implemented by `FunLib/custom_loader.lua:LoadCustomize()` and `FunLib/jmz_func.lua:J.SetUserHeroInit` (:39-56). Critically, **`game/Customize` is gitignored** (`.gitignore:68`) — the natural home for secrets and learned state.
- **Machine-generated Lua tables are an established pattern**: `bots/FretBots/matchups_data.lua` (~16 K lines, from `npm run matchups`, Puppeteer + Cheerio scraping Dotabuff), `neutrals_data.lua` (`npm run neutrals`), `static_neutrals_matchup.lua` (`npm run update-ne`, Stratz GraphQL API with `STRATZ_API_KEY`). All loaded at runtime via `require`.
- **Feature flags** live in `bots/Customize/general.lua` (e.g. `Allow_AI_GPT_Response`, `Allow_Trash_Talk`, `ThinkLess`).

### 3.4 Build pipeline

- TypeScript → Lua via **tstl**: `tsconfig-tstl.json` maps `typescript/bots/**` → `bots/**`; `typescript/post-process/post-process-lua.js` rewrites requires into engine-safe `GetScriptDirectory()` form. 22 of 271 Lua files are currently TS-generated; the typed Dota API layer already exists (`typescript/bots/ts_libs/dota/`).
- **No tests, no CI** exist anywhere in the repo. This RFC introduces the first testable seams (§11).

### 3.5 Hard constraints

| # | Constraint | Consequence for design |
|---|---|---|
| C1 | `Think()` runs per frame; `GetDesire()` every ~300 ms | LLM may never be called synchronously in these paths (G6) |
| C2 | In-game Lua sandbox has no file I/O, no `io`/`os`, no `SetUserData` usage | Cross-game memory must exit the game (telemetry) and re-enter as `require`d Lua files |
| C3 | Script must keep working with no network / no key / LLM down | Every integration point is additive + guarded (G5) |
| C4 | Workshop distribution must not regress for existing users | Default-off feature flag; zero-diff when disabled |
| C5 | API key must not enter the repo | Keys live only in gitignored `game/Customize/llm.lua`; local Ollama endpoint eliminates keys entirely |
| C6 | LLM output is untrusted | Whitelist validation, clamped numerics, bounded list sizes, hero/item names verified against game data before use |

### 3.6 Valve-documented API surface → RFC seams

Every seam this RFC touches is a **documented override point** in the official scripting guide (Valve Developer Community, "Dota Bot Scripting", §2 Directory Structure) or the ModDota Lua (Bots) API reference. Nothing relies on undocumented engine internals:

| Documented surface (per guide) | Used by | Treatment |
|---|---|---|
| `Think()` per-frame bot entry; "If any of these functions are not implemented, it will fall back to the default C++ implementation" | — (model for G5) | The C++-fallback contract is the degradation pattern our adapters replicate |
| `ItemUsageThink` / `AbilityUsageThink` / `BuybackUsageThink` / `CourierUsageThink` / `AbilityLevelUpThink` (per-frame hooks) | — (untouched in Phases 1–2) | C1: the gateway is never called from these |
| Mode override files `mode_<name>_generic.lua`: `GetDesire()` (~300 ms), `OnStart()`, `OnEnd()`, `Think()` | Desire adapter (§8) | Additive clamped bias on `GetDesire()` return only; `Think()` untouched |
| Team-level desires (`team_desires.lua`) | Phase 2 alternative seam | Documented team-wide desire file — evaluated vs per-mode bias as the Phase 2 injection point (§15) |
| Per-hero override files (`item_purchase_<hero>.lua` convention) | Build adapter (§7) | Same philosophy: the adapter rewrites build tables per hero through the existing override path rather than new logic |
| Hero selection logic (guide §2.7) | Draft adapter (§6) | Bias scoring inside the existing pick loop; `CanPickHero` gates stay authoritative |
| Action APIs (`Action_UseAbilityOnEntity/Location/Tree`, `ActionImmediate_*`) | — (untouched) | Existing heuristics issue all actions; the LLM never issues actions directly |
| `ActionImmediate_Chat(_sMessage_, _bAllChat_)` — documented bot-chat emission | Chat adapter (§8A) | The single sanctioned API for natural-chat output |
| Bot difficulty tiers (Passive → Unfair, guide §5) | Deployment context | Unchanged; FretBots dynamic difficulty remains orthogonal |

---

## 4. Proposed architecture

```
┌────────────────────────────── Dota 2 Lua VM (Local Host lobby) ─────────────────────────────┐
│                                                                                              │
│  Engine hooks (unchanged)          NEW: Adaptive Layer (all optional, default-off)          │
│  ┌───────────────────────┐        ┌────────────────────────────────────────────────┐         │
│  │ mode_*_generic        │◄─bias──│ 4. Seam Adapters                                │         │
│  │  GetDesire/Think      │ (Ph2)  │  draft / build / desire (§6-8)                  │         │
│  ├───────────────────────┤        ├────────────────────────────────────────────────┤         │
│  │ hero_selection        │◄───────│ 3. Directive Bus  (validate → cache → apply)   │         │
│  │ item_purchase_generic │        ├────────────────────────────────────────────────┤         │
│  │ ability_item_usage_*  │  ─────►│ 2. State Serializer (compact game-state JSON)  │         │
│  └───────────────────────┘        ├────────────────────────────────────────────────┤         │
│         ▲                         │ 1. LLM Gateway   (queue, cache, timeout, TLS)  │         │
│         │ existing heuristics     └───────────────┬────────────────────────────────┘         │
│         │ always execute                           │ async HTTP (CreateHTTPRequest)          │
└─────────┼──────────────────────────────────────────┼─────────────────────────────────────────┘
          │                                          ▼
   [OHA-TELEMETRY] markers              OpenAI-compatible endpoint (cloud or local Ollama)
          │ (console, -condebug)                    — draft analysis / build gen / post-mortem
          ▼
┌── Offline (between games, Node) ────────────────────────────────────────────────────────────┐
│  npm run learn:  parse console log → merge telemetry → LLM distillation (full SDK)          │
│                  → writes game/Customize/learned/memory.lua  (gitignored, permanent tier)   │
│                  → next match's draft prompt includes learned counter-notes                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Component 1 — LLM Gateway (`typescript/bots/FunLib/llm_gateway.ts` → `bots/FunLib/llm_gateway.lua`)

The **only** module permitted to open HTTP connections (the existing `FretBots/Chat.lua` chatbot remains separate and untouched).

- **Config**: loaded from `game/Customize/llm.lua` (gitignored). Shape:

```lua
-- game/Customize/llm.lua  (user-owned, never committed)
return {
  Enable = true,
  Endpoint = "https://api.groq.com/openai/v1/chat/completions", -- Groq default; Ollama: http://127.0.0.1:11434/v1/chat/completions
  Model = "qwen/qwen3-32b",                                   -- Groq-hosted Qwen (verify current catalog id); any OpenAI-compatible id works
  APIKey = "",                                                -- Groq key from console.groq.com; empty for local endpoints
  TimeoutMs = 8000,
  MaxCallsPerGame = 12,
  MaxConcurrent = 1,
  Phases = { draft = true, builds = true, desire = false, chat = false }, -- phase toggles; chat enabled with W (§8A)
}
```

- **Provider (v1 default): Groq + Qwen.** Groq exposes an OpenAI-compatible API; the Qwen family (e.g. `qwen/qwen3-32b` — confirm the current catalog id) offers strong drafting reasoning and excellent Chinese/multilingual coverage, a direct fit for `!sp` chat locales (§8A). LPU inference keeps time-to-first-token low, so draft/build calls sit well inside the ≤ 10 s budget (§2.5) and Phase 2 re-evaluation stays cheap. Groq's free tier is rate-limited but comfortably covers the per-game call budget. Switching providers is a config edit, not code.
- **Behavior**: single in-flight request (queued, latest-wins per slot); response cache keyed by prompt hash (TTL = game-time bucket); hard timeout ⇒ fallback result; per-game call budget enforced; every call/response/result logged to telemetry.
- **Request shape**: OpenAI `chat/completions` messages array. System prompt embeds the serialized game state (Component 2), the relevant excerpt of `matchups_data`, learned memory, and the directive schema (instructed as *strict JSON, no prose*).

### 4.2 Component 2 — State Serializer (`FunLib/llm_state.lua`)

Produces a compact, token-bounded JSON snapshot. Sources already exist — this is a thin reshaper of `FretBots/Utilities.lua` payload builders (`GetPInfo`, `HeroStatsInGame`, `GetMatchData`):

- **Draft phase**: both teams' picked/available/banned heroes (from `hero_selection.lua` state), lobby slots, assigned positions, `matchups_data` excerpt limited to candidate heroes, learned memory notes.
- **In-match (respawn/death triggers)**: hero, level, net worth, KDA, current items, enemy lineup + visible items, towers up/down, game time, current `sBuyList` progress, relevant cooldown events.
- Budget: ≤ 4 KB serialized for the game-state snapshot, **plus** ≤ 8 KB for learned memory when present (the memory bound is owned by `npm run learn`, §15.2). Overshoot in either part ⇒ drop least-salient fields (defined order), never truncate JSON mid-structure.

### 4.3 Component 3 — Directive Bus (`FunLib/llm_directive.lua`)

Receives raw LLM text → `json.decode` → **validate** → cache → hand to the matching adapter. Validation is the security and reliability boundary (C6):

- Top-level `schema` field must match a known version (`oha.directive.v1` Phase 1, `oha.directive.v2` Phase 2).
- **Whitelist fields only**; unknown keys dropped (logged to telemetry).
- Hero names must match `npc_dota_hero_*` entries known to `ts_libs/dota/heroes`; item names must be valid `item_*` purchase names and purchasable in the shop context; ability letters restricted to `{q,w,e,r}`-mapped abilities the hero actually has.
- Numeric clamps: pick/ban `weight ∈ [0,1]`; `desire_bias ∈ [-0.3, +0.3]` per mode (Phase 2); list lengths ≤ 12.
- Any violation ⇒ discard directive entirely, increment `discarded` counter, fall back. **Never partially apply** a malformed directive.
- A directive has a TTL (game-time); expired ⇒ reverts to defaults.

Phase 1 schema (`oha.directive.v1`):

```json
{
  "schema": "oha.directive.v1",
  "phase": "draft",
  "picks":  [{ "hero": "npc_dota_hero_axe", "weight": 0.9, "reason": "vs melee carry + low-mobility core" }],
  "bans":   [{ "hero": "npc_dota_hero_tinker", "weight": 0.7 }],
  "builds": {
    "npc_dota_hero_axe": {
      "pos": 3,
      "items":  ["item_blade_mail", "item_blink", "item_crimson_guard"],
      "ability_order": ["e","q","e","w","e","r","e","q","q","q","r","w","w","w","r"],
      "talents": ["l","r","l","r"],
      "notes": "armor + initiation vs their PA/Slardar lineup"
    }
  },
  "meta": { "confidence": 0.8, "summary": "enemy lacks stuns -> blink aggressive timings" }
}
```

### 4.4 Component 4 — Seam Adapters

Each adapter is a thin, guarded wrapper at an existing seam. All read `Allow_LLM_Advisor` + the per-phase toggles + directive validity. Ordered by phase:

| Adapter | Seam (existing code) | Application | Phase |
|---|---|---|---|
| **Draft** | `hero_selection.lua` `AllPickHeros` (:675) scoring loop | LLM picks/bans become weighted candidates merged with (not replacing) `matchups_data` scoring; `CanPickHero` gates remain authoritative | 1 |
| **Build** | `jmz_func.lua` `J.SetUserHeroInit` (:39) merge path | Validated LLM build is injected through the **same mechanism as user customization** — it overrides `AbilityUpgrade`/`Talent`/`PurchaseList`/`SellList` per hero. Applied once at spawn; re-applied on death/respawn (throttled ≥ 60 s) | 1 |
| **Desire** | `mode_*_generic.lua` `GetDesire()` returns | Additive clamped bias per mode, cached per directive TTL; never replaces, only biases | 2 |

The Build adapter's reuse of `SetUserHeroInit` is deliberate: LLM output becomes structurally indistinguishable from a user's `Customize/hero/<hero>.lua` file — one override path to test, one mental model, US3 satisfied.

### 4.5 Component 5 — Telemetry & Learning Loop

- **In-game**: the gateway and adapters append structured events (draft decisions, build diffs, directive discards, call latencies, game result) to a per-game record. At game end, the record is printed as single-line markers: `[OHA-TELEMETRY] {"t":"game_end", ...}` (requires Dota launched with `-condebug` to persist console to `console.log`; documented in the runbook, §14.4).
- **Offline** — new `typescript/post-process/learn.ts`, run as `npm run learn`:
  1. Locate and tail the Dota `console.log` for `[OHA-TELEMETRY]` lines (paths per OS documented; overridable via CLI flag).
  2. Merge into a local telemetry store (`game/Customize/learned/telemetry.json`).
  3. Call an LLM (Node-side, full SDK freedom — this is *not* constrained by the Lua sandbox) to distill: per-enemy-lineup counter-notes, build adjustments with provenance, draft heuristics deltas.
  4. Write `game/Customize/learned/memory.lua` (a plain Lua table with `version`, `games`, `insights[]`, bounded to ≤ 8 KB) into the permanent gitignored tier.
  5. Print a human-readable report (what was learned, metric deltas vs baseline).
- **Next match**: Component 2 includes `learned/memory.lua` contents in draft/build prompts. G4 closed.
- **M0 fallback**: if `-condebug` is off or the log isn't found, `npm run learn` reports stateless mode and the system still functions per-game (no cross-game memory) — degraded, never broken.

### 4.6 Chat commands & flags

- `bots/Customize/general.lua` gains `Allow_LLM_Advisor = false` (default off ⇒ C4 zero-diff for workshop users).
- In-game chat commands (handled alongside the existing `!pick`/`!ban` parser in `hero_selection.lua:SelectHeroChatCallback` and the FretBots chat path): `!llm status | on | off` — status prints endpoint, model, calls used/ budget, directives applied/discarded.

---

## 5. Phasing

| Phase | Delivers | Exit criteria |
|---|---|---|
| **1 — Draft & Builds** | Gateway, serializer, directive bus, draft + build adapters, telemetry markers, `npm run learn` (M0+loop) | US1/US3 demonstrable in local lobby; metrics baseline collected over ≥ 20 games |
| **2 — In-match directives** | Desire adapter (`oha.directive.v2`), event triggers (respawn, tower falls, Roshan), throttled re-evaluation | Mid-game bias observable (telemetry shows desire shifts traceable to directives); no stuck-idle regressions |
| **3 — Distilled policy (sketch)** | Offline analysis over accumulated telemetry emits *weighting tables* (per-archetype desire modifiers, build preference priors) consumed per-tick with zero latency; dataset export for future RL/fine-tuning | Out of scope for implementation in this RFC; dataset format specified only |
| **W — Natural chat (parallel)** | Migrate the chatbot onto the gateway (Groq/Qwen): persona cards, event-aware context, in-game rolling memory, `!sp` localization (§8A) | Side-by-side naturalness win vs current proxy chatbot; ≤ 3 s reply latency; graceful fallback to canned chat |

Phase 3 is the bridge from "LLM-advised heuristics" toward learned policy — the LLM's accumulated judgment, *compiled* into deterministic tables the per-frame engine can consume freely. It deliberately requires no training infrastructure.

---

## 6. Phase 1 specification — Draft adapter

**Trigger**: `hero_selection.lua:Think` detects an active pick/ban window for the bot team and no cached draft directive for the current step.

**Flow**:
1. Serializer builds the draft snapshot (§4.2).
2. Gateway enqueues the draft-analysis request (budget slot: 1 per pick/ban step, counted against `MaxCallsPerGame`).
3. On response (typical 2-8 s, well within All Pick pacing; the existing pick logic continues meanwhile): validator produces a directive or a discard.
4. Valid picks/bans are merged into the `AllPickHeros` candidate scoring. Per candidate hero `h`:

   `score(h) = base_matchup_score(h) × (1 − α) + llm_rank_score(h) × α`, where `α = min(directive.weight, 0.5)` and `llm_rank_score(h)` is the directive's normalized weight for `h` (0 if absent).

   The cap (α ≤ 0.5) means the LLM can *re-rank*, never *force* an unpickable hero. `CanPickHero`, `Weak_Hero_Cap`, ban list, and chat-command overrides (`!pick`/`!ban`) all retain precedence over the LLM.
5. The directive's `builds` map is cached for the Build adapter; a `reason` string per pick is logged to telemetry (observability + US2).

**Fallback**: no response by the pick deadline ⇒ existing scoring, unchanged.

---

## 7. Phase 1 specification — Build adapter

**Trigger**: `dota_on_hero_finish_spawn` for a bot hero (the same event FretBots already listens to), plus death/respawn re-evaluation (cooldown ≥ 60 s, budget-checked).

**Flow**:
1. If the draft directive carries a build for this hero and it validates (items purchasable, ability letters map to real abilities, talents well-formed): inject via the `SetUserHeroInit` merge path as the highest-priority override.
2. On respawn re-evaluation: serializer emits in-match state; the gateway may return a **build patch** (same schema, `phase: "build"`) — applied only between deaths, never mid-fight (C1 respected trivially: purchases already run on a 1 s cadence in `item_purchase_generic.lua`).
3. Item swaps must respect gold/stock; the existing purchase sequencer handles component logic — the adapter only rewrites the target list, it does not touch the sequencer.

**Fallback**: no valid build ⇒ static `sBuyList`/`sRoleItemsBuyList`, exactly today.

**US3 tie-in**: `npm run learn` (and the gateway telemetry) can export any applied build as a ready-to-paste `Customize/hero/<hero>.lua` file for manual freezing.

---

## 8. Phase 2 specification — Desire adapter (summary)

- Wrap each mode's `GetDesire()` return: `final = clamp(desire + bias, BOT_MODE_DESIRE_NONE, BOT_MODE_DESIRE_ABSOLUTE)`, bias from the newest valid `oha.directive.v2`, TTL-bounded.
- Triggers for a re-evaluation call: ≥ 5 min since last, plus events (any tower falls, Roshan kill, ≥ 2 team deaths within 30 s) — all throttled by the global budget.
- The existing `ConsiderHeroSpecificRoaming` table and `override_generic/` mechanism remain the escape hatches if a hero needs bespoke treatment; the adapter never special-cases heroes itself.
- Explicitly **out of scope**: biasing `Retreat`/`Attack` desires for heroes channeling or committing — bias categories are limited to `push`, `defend`, `farm`, `roam`, `group` in v2.

---

## 8A. Workstream W — Natural chat adapter (parallel track)

The script ships two chat systems today (§3.2): the FretBots LLM chatbot (routed through the `chatgpt-with-dota2bot.onrender.com` proxy, rolling memory capped at 3 messages, a random bot speaks each reply, error strings can be spoken by bots) and the canned/random `aba_chat` fallback. W makes bot chat **feel like real players** and runs it on the same gateway as everything else — one transport, one budget, one fallback chain. Output uses the documented `ActionImmediate_Chat` / `Say` API only (§3.6).

- **Migration**: `FretBots/Chat.lua`'s HTTP code is replaced by gateway calls (Groq/Qwen); the `player_chat` capture in `FretBots/Settings.lua` is untouched. Gateway off or failed ⇒ chat degrades to the existing canned `aba_chat` — never silence, never errors spoken by bots.
- **Persona cards**: each bot gets a stable persona (voice, optimism level, running jokes, role-appropriate flavor — the pos-5 support gripes about wards, the mid-laner is cocky). Personas are generated once offline via `npm run learn` and stored in `game/Customize/learned/personas.lua`; each prompt injects the *speaking* bot's card, so replies stay consistent per bot across a match.
- **Event-aware context**: the same event taps planned for Phase 2 triggers (first blood, tower falls, Roshan, deaths) feed chat context, enabling **proactive** lines (commenting on a fight that just happened) instead of only reactive replies. Event chat is throttled (≥ 45 s apart, chat-budget-shared) and respects `Allow_Trash_Talk` / `Trash_Talk_Level`.
- **Memory**: raise the in-game rolling history from 3 messages to a session window (last ~10 exchanges + a running one-line summary), so bots reference earlier conversation instead of amnesia. Cross-game chat memory stays out of scope (policy memory only, §4.5).
- **Style guardrails**: the system prompt enforces short messages (≤ 2 sentences), in-game jargon, no AI-assistant phrasing, and replies **in the language selected by `!sp`** (en/zh/ru/ja — Qwen's multilingual strength is the direct fit; the `locale_language_code` already plumbed through `Chat.lua` is reused).
- **Budget split**: W evolves the flat `MaxCallsPerGame` into `MaxCalls = { policy = 12, chat = 30 }` so chat can never starve draft/build calls.

---

## 9. Data flow — end-to-end (Phase 1, one game)

```
Lobby start ──► hero_selection Think
                 │ construct snapshot (lineups + matchups excerpt + memory.lua)
                 ▼
        Gateway ── POST /chat/completions (async) ──► model
                 │                                     │ strict-JSON directive
                 ▼                                     ▼
        Directive Bus: validate (whitelist/clamps/names)
                 │ valid                    └─ invalid → discard+log → existing logic
                 ▼
   Draft adapter: merge weights ──► picks/bans executed (reason strings logged)
   Build adapter: cache builds
                 │
   hero spawn ──► SetUserHeroInit path applies LLM build
   respawn  ──► (≥60s cooldown) build patch if game state changed materially
                 │
   game end ──► [OHA-TELEMETRY] single-line markers to console
                 │  (offline, next hours/days)
                 ▼
   npm run learn ──► telemetry store ──► LLM distill ──► game/Customize/learned/memory.lua
                 │
   next lobby ──► snapshot includes learned notes  ⟲ learning loop closed
```

---

## 10. Security & privacy

| Risk | Mitigation |
|---|---|
| API key shipped in a distributed script | Keys live **only** in `game/Customize/llm.lua` (gitignored by existing `.gitignore:68`); default endpoint is local Ollama needing no key; the repo never receives keys; docs warn against committing |
| Prompt-injection via player chat | Player chat is **never** included in policy prompts (the chatbot remains a separate, existing feature); game state is engine-sourced, not user-authored text |
| LLM output attacks the game | Validation layer (§4.3): whitelist, clamps, name checks against game data; no `loadstring`/dynamic execution of any model output — ever |
| Telemetry privacy | Telemetry contains match data only (heroes, items, outcomes) — no Steam identity beyond what the existing `start`/`end` calls already send; all learned state stays local |
| Spend control | Split call budgets (`policy` 12 / `chat` 30, §8A) + response cache + phase toggles; a full game stays within Groq free-tier limits by default |

---

## 11. Testing & validation strategy

The repo currently has **zero tests**; this feature introduces the first testable seams (pure TS modules → Node-runnable):

1. **Unit — directive validator** (`typescript/bots/FunLib/llm_directive.ts` + `test/llm_directive.test.ts`, using Node's built-in `node:test` runner — zero new dependencies): golden files of recorded LLM outputs (valid, malformed, adversarial — oversized lists, unknown heroes, out-of-range weights, injected extra fields) → expected accept/discard. This is the security boundary; it gets 100% branch coverage of the validator.
2. **Unit — gateway config & budget**: timeout, cache-hit, budget-exhaustion, latest-wins queue behavior (mock transport).
3. **Integration — serializer shape**: snapshot JSON validates against a JSON schema; token-budget enforcement verified at adversarial game states (10 heroes, full items).
4. **Simulation — Lua-side smoke**: a `bots/FunLib/__llm_selftest.lua` invoked via a debug chat command (`!llm selftest`) runs validator + fallback path in-lobby with a canned response (no network needed), printing pass/fail to console. This respects the repo's no-CI reality: verification happens in the Local Host lobby, scripted and repeatable.
5. **Soak — regression protocol**: 10 lobbies with `Allow_LLM_Advisor=false` must produce zero behavioral diff (log-compare of draft picks against baseline seeds). 10 lobbies with the layer on: collect §2.5 metrics.
6. **Determinism guard**: with a fixed canned directive, draft output is reproducible given the same snapshot (seeds logged).

---

## 12. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | LLM latency exceeds draft pacing | Med | Low | Async everywhere; existing logic runs until a directive lands; response never blocks a pick |
| R2 | Poor model judgment (bad counter-picks) | Med | Med | Weight ≤ 0.5 merge (re-rank, not replace); metric M1 tracks alignment; learned memory can down-weight systematically bad suggestions |
| R3 | `-condebug` console log path varies / logging disabled | Med | Med | M0 stateless mode; runbook documents enabling it; `npm run learn` degrades loudly, not silently |
| R4 | `game/Customize` absent (fresh install) | High | None | Two-tier loader already falls back to `bots/Customize`; gateway disables itself with a console notice |
| R5 | tstl build overwrite hazard: `typescript/bots/Customize/general.ts` re-export can clobber handwritten `bots/Customize/general.lua` on `build:lua` | Certain (if unaddressed) | High | Pre-req fix: exclude that file from tstl input or delete the re-export; tracked as a Phase 1 task |
| R6 | Patch drift (7.39 → next) changes hero/item data | Certain (time) | Low | Validation rejects unknown names ⇒ auto-fallback until data scripts (`matchups`, `neutrals`, Stratz) are re-run — the pipeline already exists |
| R7 | Token cost / rate limits on cloud providers | Low | Low | Default budget 12 calls/game; local Ollama path is unlimited & free |
| R8 | Desire bias (Phase 2) causes stuck/passive bots | Med | High | Bias clamped ±0.3, limited mode set, TTL expiry, soak protocol specifically watches for idle-bot regressions (a class of bug this project already fixed historically) |

---

## 13. Alternatives considered

| Alternative | Why rejected (for now) |
|---|---|
| **Local sidecar service** (Node/Python agent on `localhost:5000`, game ↔ sidecar ↔ LLM) | Strong option — richest capability (real-time policy, DB memory). Rejected for Phase 1 per project decision: extra runtime dependency, more moving parts; direct-from-Lua already covers draft/build timescales. The TS `http_req` layer already points at `localhost:5000`, so this remains a natural Phase 3+ evolution without schema changes |
| **Cloud backend** (extend the `chatgpt-with-dota2bot.onrender.com` pattern) | Requires hosting + holds all users' data + key management for others; wrong trade for a research codebase. The OpenAI-compatible endpoint config keeps this door open per-user |
| **LLM in the think loop** (micro decisions) | Violates C1/G6; impossible at per-frame cadence. Phase 3's distilled tables are the correct route to micro intelligence |
| **Fine-tuned local model** | Premature before a dataset exists; Phase 3 exports exactly that dataset |

---

## 14. Rollout plan

1. **Pre-req** (R5): guard the tstl overwrite hazard; add `Allow_LLM_Advisor=false` to `bots/Customize/general.lua`; create `bots/Customize/llm.example.lua` as a safe, committable template (no key) — the runbook instructs copying it to `game/Customize/llm.lua` (gitignored, permanent tier), since anything under `game/Customize/` cannot be committed.
2. **M1 (dev)**: gateway + serializer + validator + unit tests; `!llm selftest` in-lobby against canned responses.
3. **M2 (draft)**: draft adapter live with local Ollama; soak + baseline A/B begins.
4. **M3 (builds)**: build adapter + respawn patches; build-export command for US3.
5. **M4 (learning loop)**: telemetry markers + `npm run learn` + `memory.lua` consumption; first cross-game adaptation demonstrated.
6. **M4.5 (W — natural chat, parallel)**: chat adapter on the gateway (Groq/Qwen), persona cards, event-aware context, `!sp` language enforcement; A/B against the current proxy chatbot.
7. **M5 (Phase 2 preview)**: desire adapter behind `Phases.desire=true`, default off, soak-gated.
8. **Docs**: runbook section in README — enabling `-condebug`, per-OS console log paths, Groq + Ollama setup, key hygiene.

Feature flags at every milestone; any milestone can ship dark.

---

## 15. Open questions

1. **CM drafting** — should Phase 1 also hook `captain_mode.lua` (`CaptainModeLogic`) or wait for All Pick maturity? (Leaning: wait; All Pick dominates custom lobbies.)
2. **Learned-memory size bound** — 8 KB prompt budget for memory vs prompt bloat at 50+ games: cap insights count, age-weight, or summarize-then-replace?
3. **Multi-model routing** — cheap model for build patches, strong model for draft analysis: worth the config complexity in v1, or hardcode one model until metrics justify routing?
4. **Telemetry log robustness** — accept `-condebug` requirement, or add an optional zero-config UDP listener (a *minimal* sidecar, opt-in) as backup transport for users who skip the launch flag?
5. **Prompt language** — policy prompts/notes in English only for v1; chat replies follow `!sp` (delivered by W, §8A) — does policy reasoning ever need localization?
6. **Persona calibration** — how "spicy" should default personas be, and how do they interact with `Allow_Trash_Talk` / `Trash_Talk_Level` (one global dial vs per-bot intensity)?
7. **Phase 2 injection seam** — per-mode `GetDesire()` bias (§8) vs the documented team-level `team_desires.lua` (§3.6): which is more robust against mode-priority oscillation?

---

## 16. References

- Valve Bot Scripting — https://developer.valvesoftware.com/wiki/Dota_Bot_Scripting (directory structure & override conventions, mode `GetDesire` cadence, think hooks, `team_desires.lua`, `ActionImmediate_Chat`, engine fallback behavior)
- ModDota Lua (Bots) API — https://docs.moddota.com/lua_bots/
- Groq API (OpenAI-compatible) — https://console.groq.com/docs — default provider; Qwen model family
- Existing in-repo prior art: `bots/FretBots/Chat.lua` (HTTP+JSON+async), `bots/ts_libs/utils/http_utils/http_req.lua` (TS HTTP layer), `bots/FretBots/matchups_data.lua` (generated-data pattern), `bots/FunLib/jmz_func.lua` (customization merge path), `bots/FunLib/custom_loader.lua` (two-tier config)
- Build pipeline: `tsconfig-tstl.json`, `typescript/post-process/post-process-lua.js`, data scripts `matchups.ts` / `neutrals.ts` / `static-neutrals-matchup.ts`
- Project discussions: Steam Workshop item 3246316298; upstream repo https://github.com/forest0xia/dota2bot-OpenHyperAI
