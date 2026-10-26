# RFC-002: Humanized Strategy and Match Memory

-   **Status:** DRAFT - awaiting approval
-   **Date:** 2026-10-27
-   **Extends:** [RFC-001](2026-10-11-llm-adaptive-bots-design.md) (draft, builds, chat shipped)
-   **Decisions locked with owner (2026-10-27):** Phase A (strategy) first; humanization is expression-only (no skill reduction); memory v1 is per-match only (no cross-match persistence yet). Framework phase F added same day: natural-language chat control via tool calls.

## 1. Goals

1. **Smarter** - team-level strategy that adapts to the actual match (push pressure, fight-vs-split, Roshan aggression, farm priority) instead of fixed heuristics.
2. **More human** - bots with per-game personality: chattiness, tilt expression, timing variance, event-driven reactions. Expression only; competence untouched.
3. **Per-match memory** - a rolling, byte-budgeted in-match event log that every later LLM ask consumes ("they 5-man at 20 min, keep split-push").
4. **Natural-language control** - type like a human, not like a manual: `"axe go safelane"` instead of `!3pos 1`. The LLM detects intent, resolves hero and lane, and executes via validated tool calls.

## 2. Non-goals (v1)

-   No per-frame or per-second LLM calls (slow brain / fast reflexes, unchanged).
-   No skill reduction from personality: tilt changes what bots SAY and their timing variance, never their decision quality.
-   No cross-match persistence (Phase D sketch only; needs C's format proven in real matches first).
-   No new network endpoints beyond Groq; everything stays behind `Allow_LLM_Advisor` (G5: off = byte-identical default behavior).

## 3. Phase A - Strategic desire bias (first milestone)

### 3.1 Checkpoints

Strategy is re-evaluated at fixed checkpoints, never continuously:

| Checkpoint  | Trigger                      | Notes                                                                  |
| ----------- | ---------------------------- | ---------------------------------------------------------------------- |
| C0          | Post-draft, ~0:00            | Consumes the draft directive's context; free continuity                |
| C1..Cn      | Every 5 minutes of game time | Bounded: max 8 strategy asks per game (policy budget 12 minus 2 draft) |
| Event bonus | Team wipe, Roshan, 3rd tower | Consumes the next slot; never exceeds the cap                          |

Each checkpoint is fire-and-observe (async), identical to the draft ask loop. A late or failed reply means the previous directive stays active - never a stall.

### 3.2 Ask and directive

-   **Input:** `SerializeMatch` (already in `llm_state_core`, currently unused) - towers, kills/deaths, enemy net worth/items, game time, lane pressures, plus Phase C memory notes once it exists.
-   **Output schema (`strategy` directive, validated, whole-directive discard on error):**

```json
{
    "schema": "oha-strategy-v1",
    "push": { "top": 0.0, "mid": 0.6, "bot": 0.3 },
    "defend": { "top": 0.2, "mid": 0.5, "bot": 0.2 },
    "farm": { "top": 0.3, "mid": 0.3, "bot": 0.4 },
    "rosh": 0.4,
    "stance": "split-push",
    "note": "enemy groups at 20, avoid 5v5"
}
```

All numeric fields clamped to [0, 1] in the validator; `stance` is one of an enum used only for the visible announcement and the chat persona's framing, not for control flow.

### 3.3 Application seam (the critical zero-regression decision)

The fork has **no `team_desires.lua`**; bots read Valve's C++ default desires through exactly one consumption seam: the push/defend/farm aggregation in `jmz_func.lua` (~line 3437, `GetPushLaneDesire` etc.).

-   **Chosen:** apply validated multipliers at that seam, wrapped in a TS helper (`llm_strategy.ts`): `effective = clamp(base * (1 - alpha) + directive * alpha)` with `alpha <= 0.5`, mirroring the draft score merge. Gate off => multiplier is identity, byte-identical behavior (G5).
-   **Rejected:** implementing `team_desires.lua` (the Valve override file). Overriding replaces the C++ defaults wholesale, and scripts cannot read the would-be default values back (circular `Get*Desire` calls) - an unacceptable regression surface for a bias feature.

### 3.4 Visibility

Every checkpoint logs to the proven channels (chat/message feed + console): `[OHA-LLM] strategy @15m: split-push, push mid/bot (ask 3/8)` - consistent with the draft and build announcements.

## 4. Phase B - Humanization (expression only)

### 4.1 Personality profile

Seeded once per bot per game (`llm_personality_core.ts`, pure): `{ chattiness: 0..1, tilt: 0..1, aggressionStyle: "cocky"|"chill"|"whiny", timingJitter: 0..1 }`. Deterministic per game seed, logged at spawn alongside build announcements.

### 4.2 What it affects (and never affects)

| Affects                                                      | Never affects                           |
| ------------------------------------------------------------ | --------------------------------------- |
| Chat reply chance / cooldown scaling (persona knobs per-bot) | Any decision quality, mode selection    |
| Event chat triggers (first blood, spree, tower death, GG)    | Build or skill choices                  |
| Response timing jitter on non-critical actions               | Reaction speed on danger checks         |
| Tilt _expression_: chat tone via persona context             | Tilt _decisions_: thresholds stay fixed |

### 4.3 Chat integration

Extends `llm_chat_core.BuildChatPrompts` with personality + live context (current stance from Phase A, tilt counter, recent events from Phase C). Rate limits remain global (budget 30, 25s cooldown, 12/game) - personality only re-weights the existing dice.

## 5. Phase C - Per-match memory

### 5.1 Event log

`llm_state_core` gains a compact append-only match log (fixed slots, oldest evicted, byte-budgeted like `STATE_BUDGET_BYTES`):

```
00:40 first_blood radiant
07:12 tower t1_bot dire
18:30 fight 4-1 dire (roshan)
20:05 enemy_group_5
26:44 item: enemy carry blink
```

Events are appended from existing seams (kill/death counters in `SetTalkMessage`, tower/push logic, item purchase observations) - a handful of one-line Lua hooks into TS helpers, no new decision paths.

### 5.2 Injection

-   Every strategy ask (Phase A) and chat ask (Phase B/F) carries the log tail as context (already the shape `AskDraftDirective`'s `memoryNotes` parameter anticipates).
-   Mid-match pattern notes ("enemy 5-mans after 20") only ever bias LLM _suggestions_; they never act alone.

## 6. Phase F - Natural-language control framework (tool calls)

Own framework, no more memorized commands: you type like a human (`"axe go safelane, cm come mid"`) and the layer turns it into validated tool calls. This is the fork's generic command surface - lane swap is the v1 tool; every future control plugs into the same registry.

### 6.1 Single-ask router

Every human chat message flows through the existing persona/chat seam. One gateway call returns a structured envelope - a chat reply, tool calls, or both:

```json
{
    "schema": "oha-chat-envelope-v1",
    "reply": "on it",
    "tool_calls": [{ "tool": "swap_lane", "args": { "hero": "npc_dota_hero_axe", "lane": "safe" } }]
}
```

-   **Cost control:** a cheap local pre-filter (lane words, hero names, imperative verbs) decides whether a message is routed to the LLM at all; pure banter skips the router or rides the persona dice unchanged.
-   **No native function-calling dependency:** the envelope is prompt-emitted JSON validated like every other directive (model-agnostic, works on any OpenAI-compatible endpoint). Native Groq tool-use can be an optimization later if the model supports it.
-   Failure/discard => no tool runs, optional local fallback reply (G5).

### 6.2 Tool registry (the framework)

Each tool = name + arg schema + validator + executor + announcement. Executors never run inside the chat callback: they enqueue into team-VM module state and apply on the next safe tick (chat callbacks fire per bot; execution must be once, in the team context).

| Tool                                              | Args                     | Executor (v1)                                                      |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `swap_lane`                                       | hero, lane(safe/mid/off) | maps to position 1/2/3 and reuses the existing `!Xpos Y` role path |
| `swap_position`                                   | hero, pos 1-5            | direct role reassignment, same path                                |
| (later) `group_up`, `push_focus`, `farm_priority` | ...                      | compose on Phase A's strategy multipliers                          |

Validators check: hero is a teammate bot (never humans, never enemies), lane/pos in range, rate limit (max ~4 tool calls per game, 30s cooldown). Every execution is announced: `[OHA-LLM] axe -> safe lane (from "axe go safelane")`.

### 6.3 Draft window

During hero selection the same router runs on the pick-phase chat callback (`SelectHeroChatCallback` seam) so `"ban am and pick ls"` works as natural language alongside `!ban`/`!pick`.

## 7. Phase D - Cross-match learning (sketch, deliberately last)

Post-match, summarize the match + directive outcomes into a small JSON written to gitignored `game/Customize/memory/` (per game mode). Next game's draft/strategy asks read it ("last game: they counter-picked our PA with MK - respect it"). Requires C's format proven across real matches; also the seam for the planned out-of-game `npm run learn` analysis loop.

## 8. Budgets and latency

| Phase           | Budget                                   | Latency tolerance                                |
| --------------- | ---------------------------------------- | ------------------------------------------------ |
| Draft (shipped) | 2/game                                   | 6s grace on first pick                           |
| Strategy (A)    | 8/game from policy 12                    | none - non-blocking, old directive holds         |
| Chat (shipped)  | 12 effective/30 budget                   | drop-on-slow                                     |
| Router (F)      | shares the chat ask (one call, envelope) | 8s - late tool call is dropped, human can repeat |

## 9. Plan tasks

-   **S1** `llm_strategy_core.ts`: directive schema, validator, clamps, merge math + node tests.
-   **S2** `llm_strategy.ts` binding + checkpoint scheduler in the team VM + `SerializeMatch` wiring.
-   **S3** `jmz_func.lua` seam hook (multiplier application, G5-identity when off) + chat announcement.
-   **S4** Strategy smoke + live roundtrip; in-lobby verification gate (announcements visible, `!llm status` shows strategy asks).
-   **F1** Envelope schema + tool registry core (`llm_tools_core.ts`): validation, hero/lane resolution, rate limits + node tests.
-   **F2** Router merge into the chat persona ask (single call) + pre-filter.
-   **F3** `swap_lane`/`swap_position` executors wired to the existing role-assignment path + chat announcements + draft-window variant.
-   **F4** Router smoke + live lobby gate (natural chat moves a bot's lane; announcement logged).
-   **M1** Match event log in `llm_state_core` + append hooks.
-   **M2** Log injection into strategy + chat asks.
-   **H1** `llm_personality_core.ts` + seeding + spawn announcement.
-   **H2** Persona integration into `llm_chat` (per-bot chance/cooldown/tone) + event chat triggers.

Order: S1-S4 (milestone 1), then F1-F4 (framework - natural control, shares the persona ask), then M1-M2 (memory enriches strategy + router context), then H1-H2.

## 10. Open questions

1. Strategy checkpoint cadence: 5 min fixed vs event-weighted slots - default above, tune after first lobby soak.
2. Should the `stance` field also nudge chat persona tone, or stay display-only? (Default: display-only in v1.)
3. Event-log eviction policy: pure oldest-first vs keeping "anchor" events (first blood, Roshan) pinned. Default: oldest-first, revisit with real logs.
4. Router pre-filter strictness: miss a valid command vs spend an ask on banter - default leans strict (fewer calls), loosen with real logs.
5. Does `qwen3.8-27b` on Groq support native tool-use? Prompt-emitted JSON is the v1 path regardless; check via the models endpoint during F1.
