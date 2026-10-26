# Open Hyper AI (OHA) - Dota 2 Bot Scripts

**The most feature-rich custom bot script for Dota 2.** Play against bots that actually fight, farm, push, and use items intelligently.

> **To play:** Create a **Custom Lobby** and select **Local Host** as the server location. Bots should have names ending with **".OHA"** when installed correctly.

[Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3246316298) | [GitHub](https://github.com/forest0xia/dota2bot-OpenHyperAI) | [Feature Requests](https://github.com/forest0xia/dota2bot-OpenHyperAI/issues?q=is%3Aissue+is%3Aopen+%5BFeature+request%5D)

![Screenshot](asset/images/steam-profile-screenshot.jpg)

---

## What Makes This Different

-   **127 heroes supported** on Patch 7.41/7.41a - including Largo, Kez, Ringmaster, Invoker, Techies, Meepo, Lone Druid, and more
-   **Bots actually play the game** - they lane, gank, push towers, defend, farm jungle, take Roshan, and use active items
-   **Dynamic difficulty (FretBots mode)** - bots get unfair bonuses that scale with difficulty for a real challenge
-   **Bots communicate** - they announce pushes, defends, Roshan, and respond to your pings with "On my way!" (in 4 languages)
-   **10+ Game modes supported** - All pick, Turbo, All random, Captain mode, 1v1 mid, All Random Deathmatch, etc.
-   **Customizable everything** - bot names, roles, hero picks, bans, item builds, skill builds, and more
-   **AI Chatbot** - bots chat like real (toxic) players (requires FretBots mode)
-   **All roles supported** - deterministic position 1-5 lane assignment

---

## Quick Start

1. Subscribe on [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3246316298)
2. Create a **Custom Lobby** with **Local Host** server
3. Start the game - bots auto-pick and play

For **FretBots mode** (harder bots, neutral items, chatbot): [Manual installation guide](https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions/68)

---

## Install This Fork (LLM build)

The Workshop copy is upstream Open Hyper AI. This fork adds the LLM advisor, so it's installed from a git clone instead of a subscription.

**1. Clone the fork** somewhere outside the Steam folder:

```
git clone https://github.com/Maxxoto/Dota-OpenHyperAI-Agent.git
```

**2. Link (or copy) `bots/` and `game/` into `vscripts`.** A symlink keeps the clone and the game in sync, so a `git pull` updates your bots. All install targets sit under your Steam root:

| OS      | Steam root                                 | Install target                                                |
| ------- | ------------------------------------------ | ------------------------------------------------------------- |
| Windows | `C:\Program Files (x86)\Steam`             | `...\steamapps\common\dota 2 beta\game\dota\scripts\vscripts` |
| macOS   | `~/Library/Application Support/Steam`      | `.../steamapps/common/dota 2 beta/game/dota/scripts/vscripts` |
| Linux   | `~/.steam/steam` or `~/.local/share/Steam` | `.../steamapps/common/dota 2 beta/game/dota/scripts/vscripts` |

Windows (Developer Mode on, or an elevated Command Prompt, since `mklink` needs one of the two):

```
mklink /d "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\scripts\vscripts\bots" "C:\src\Dota-OpenHyperAI-Agent\bots"
mklink /d "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\scripts\vscripts\game" "C:\src\Dota-OpenHyperAI-Agent\game"
```

macOS:

```bash
V="$HOME/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/scripts/vscripts"
ln -s "$HOME/src/Dota-OpenHyperAI-Agent/bots" "$V/bots"
ln -s "$HOME/src/Dota-OpenHyperAI-Agent/game" "$V/game"
```

Linux:

```bash
V="$HOME/.steam/steam/steamapps/common/dota 2 beta/game/dota/scripts/vscripts"
ln -s "$HOME/src/Dota-OpenHyperAI-Agent/bots" "$V/bots"
ln -s "$HOME/src/Dota-OpenHyperAI-Agent/game" "$V/game"
```

Copying works too if you'd rather not touch symlinks: `xcopy /E` on Windows, `cp -R` elsewhere, with the same source and target paths.

One caveat before you link: `vscripts/game` is a stock Valve folder and this fork ships its own copy of it (engine glue plus the permanent `Customize` tier). Rename the existing one to `game_old_<date>` first so you can restore it.

**3. Turn on the LLM advisor** with the [setup steps below](#setup).

**Quick way (Windows):** run `bots\Install-to-vscript\quick-install-oha.bat` from your clone, as Administrator. It auto-detects your Steam install (registry), links `bots/` (junction fallback if symlinks are blocked), copies `Customize` to the permanent game tier, and can enable the LLM advisor for you: it asks for your Groq key and writes it into `<vscripts>/game/Customize/llm.lua` plus flips `Allow_LLM_Advisor = true` in the game-tier copy — the key never lands in the repo. The Linux/macOS scripts in that folder still target the Workshop copy; use the manual links below there.

---

## In-Game Commands

| Command      | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `!pos X`     | Swap your role with a bot (e.g., `!pos 2` for mid)             |
| `!Xpos Y`    | Reassign bot positions (e.g., `!3pos 5` = 3rd bot plays pos 5) |
| `!pick HERO` | Pick a hero (`!pick sniper`, or `/all !pick sniper` for enemy) |
| `!ban HERO`  | Ban a hero from being picked                                   |
| `!sp XX`     | Set bot language (`en`, `zh`, `ru`, `ja`)                      |

Use [internal hero names](https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions/71) if short names overlap (e.g., `!pick npc_dota_hero_keeper_of_the_light`). Batch commands work too: `!pick io; !ban sniper`.

---

## LLM Advisor (Experimental)

During All Pick hero selection the bots can ask Groq (an OpenAI-compatible API, default model `qwen/qwen3.8-27b`) which heroes to pick and ban. They spend at most two calls per game, and the first pick waits a bounded 6 seconds for an answer. Validated picks merge into the existing matchup scoring:

```
score = base x (1 - alpha) + weight x alpha
```

`alpha` is capped at 0.5, so the model re-ranks candidates but can never force an unpickable hero. Bans, the weak-hero cap, and your `!pick` / `!ban` chat commands always win.

At hero spawn the same directive supplies a skill order (`q`/`w`/`e`/`r`), talents, and an item build, applied as a prefix in front of each hero's default build. Everything runs async and fails safe: LLM off, slow, or malformed means exactly the previous bot behavior.

**Status:** verified offline only. `tstl` build clean, 36/36 Node tests, 13/13 LuaJIT adapter smoke tests, and a live Groq round-trip through [test/live_roundtrip.lua](test/live_roundtrip.lua) against `qwen/qwen3.8-27b`. Not yet verified inside an actual Dota lobby, and item suggestions are structurally validated only. Design notes: [LLM adaptive bots design doc](docs/superpowers/specs/2026-10-11-llm-adaptive-bots-design.md).

| Command                | Description                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `!llm status`          | Master switch, model, call budget used, and what's in flight                           |
| `!llm on` / `!llm off` | Enable or disable the advisor for this session only                                    |
| `!llm selftest`        | Run the offline validator self-test (canned responses, no network) and print pass/fail |

`!llm on` can't override the master switch in `general.lua`. It only undoes an `!llm off` from the same game.

### Verifying It Runs

-   At hero-selection load the console prints `[OHA-LLM] FORK ACTIVE - modified OHA script running (...)` (once per team VM). **No banner = the lobby is not running this fork** — stale clone or Workshop copy. `git pull`, then start a fresh lobby.
-   If the banner says `master gate OFF`, fix the two flags it names (`game/Customize/general.lua` and `game/Customize/llm.lua`).
-   With the gate on, watch for `[OHA-LLM]` ask/accept lines during hero selection — the draft asks only run there.
-   `!llm` commands answer in the **console** (not chat) and only **after the horn**: one bot per team installs the chat hook once the game is in progress. Team chat when you have bot teammates; all-chat (`Shift+Enter`) when playing solo against the bots. During the draft, `!llm` silence is normal — `!pick`/`!ban` work there through a different hook.
-   Any `!llm <anything>` input prints at least a usage line — so total silence while `!sp` works means an old copy without the LLM branch.
-   Hot reload after a `git pull`: `sv_cheats 1` then `dota_bot_reload_scripts` re-reads the Lua mid-game. Bot purchase/mode state resets, and draft asks don't re-run — use it for quick "is new code alive" checks only.

### Setup

1. **Get a free Groq API key** at [console.groq.com](https://console.groq.com).
2. **Add the key.** Copy `bots/Customize/llm.example.lua` to `<vscripts>/game/Customize/llm.lua` and set `APIKey`. Set `Model` too if you want a different one. For a keyless local run, point it at Ollama: `Endpoint = "http://127.0.0.1:11434/v1/chat/completions"` and leave `APIKey` empty.
3. **Flip the master switch** `Customize.Allow_LLM_Advisor = true`.
    - Quick way: change it in `bots/Customize/general.lua` (around line 87) in your local copy. Fine for testing, though a `git pull` will overwrite it.
    - For an install that survives updates: copy `bots/Customize/general.lua` to `<vscripts>/game/Customize/general.lua` and flip the flag there. The loader **replaces** the whole `Customize` table with `game/Customize/general.lua` when that file exists, so it has to be the full copy, not a one-line file. A one-liner wipes every other setting.
4. **Start a Custom Lobby** on a **Local Host** server. Open the console (`~`) and watch for `[OHA-LLM]` lines during hero selection and at hero spawn.

Other knobs in `llm.lua`: `Endpoint`, `Model`, `TimeoutMs` (8000), `MaxCalls` (12 policy / 30 chat), and `Phases` (draft and builds on; desire and chat reserved for later work).

---

## Bot Roles & Positioning

Lobby slot order = position assignment (1-5):

| Position                               | Lane      |
| -------------------------------------- | --------- |
| Pos 1 (Carry) + Pos 5 (Hard Support)   | Safe Lane |
| Pos 2 (Mid)                            | Mid Lane  |
| Pos 3 (Offlane) + Pos 4 (Soft Support) | Offlane   |

Customize picks, bans, and roles in [Customize/general.lua](bots/Customize/general.lua).

---

## Customization

| What                                         | Where                                                             |
| -------------------------------------------- | ----------------------------------------------------------------- |
| General settings (picks, bans, names, roles) | [Customize/general.lua](bots/Customize/general.lua)               |
| Per-hero settings (items, skills)            | [Customize/hero/viper.lua](bots/Customize/hero/viper.lua)         |
| FretBots difficulty tuning                   | [FretBots/SettingsDefault.lua](bots/FretBots/SettingsDefault.lua) |
| LLM advisor (key, model, timeouts)           | [Customize/llm.example.lua](bots/Customize/llm.example.lua)       |

**Permanent customization** (survives Workshop updates): Copy the `Customize` folder to `<Steam/steamapps/common/dota 2 beta/game/dota/scripts/vscripts/game/Customize>`.

---

## Game Modes

Supports most game modes (10+) . See [full compatibility discussion](https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions/72).

---

## Offline / LAN Play

You can start a bot game directly from the console without network or clicking UI buttons — useful for offline play, LAN parties, or quick testing. See [play offline setup guide](https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions/135).

---

## Developer Documentation

This project uses [Claude Code](https://claude.ai/claude-code) for AI-assisted development. The [CLAUDE.md](CLAUDE.md) file provides task-specific instructions for common operations like patch updates, hero fixes, and adding new heroes.

### Key Docs

| Document                                                 | Description                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             | Complete codebase architecture, file map, naming conventions, all systems explained |
| [docs/PATCH_UPDATE_GUIDE.md](docs/PATCH_UPDATE_GUIDE.md) | Step-by-step runbook for updating when a new Dota 2 patch drops                     |
| [docs/BOT_API_REFERENCE.md](docs/BOT_API_REFERENCE.md)   | Comprehensive Valve bot scripting API reference with examples                       |
| [CLAUDE.md](CLAUDE.md)                                   | AI coding assistant guide - common tasks, rules, and workflows                      |

### Internal Name References

Dota 2 bot scripts use internal code names for heroes, items, and abilities. These are different from the display names you see in-game. When updating builds or fixing bugs, always verify against authoritative sources:

| Resource                                                                                                                        | What It Contains                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Liquipedia Cheats Page (Item Names)](https://liquipedia.net/dota2/Cheats)                                                      | Authoritative list of `item_*` internal names for all items including neutral items |
| [d2vpkr npc_abilities.txt](https://raw.githubusercontent.com/dotabuff/d2vpk/master/dota_pak01/scripts/npc/npc_abilities.txt)    | All ability internal names and KV data                                              |
| [Dota 2 Patch Data API](https://www.dota2.com/datafeed/patchnoteslist?language=english)                                         | Official patch notes in machine-readable format                                     |
| [Modifier Names (Valve Wiki)](https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/Built-In_Modifier_Names) | `modifier_*` names for buff/debuff detection                                        |

### Project Structure

```
root: <Steam/steamapps/common/dota 2 beta/game/dota/scripts/vscripts>
|
+-- bots/                  All bot Lua scripts
|   +-- hero_selection.lua     Hero picking/banning
|   +-- bot_generic.lua        Per-bot entry point
|   +-- ability_item_usage_generic.lua   Ability/item usage for all heroes
|   +-- item_purchase_generic.lua        Item purchase state machine
|   +-- mode_*_generic.lua     Mode scripts (farm, push, defend, roam, etc.)
|   +-- mode_assemble_generic.lua        Human ping response
|   |
|   +-- BotLib/            Per-hero builds (items, skills, ability logic)
|   |   +-- hero_axe.lua, hero_crystal_maiden.lua, ...
|   |
|   +-- FunLib/            Core libraries and utilities
|   |   +-- jmz_func.lua      Main utility library
|   |   +-- aba_item.lua      Item system
|   |   +-- aba_skill.lua     Skill/ability system
|   |   +-- aba_push.lua      Push logic
|   |   +-- aba_defend.lua    Defend logic
|   |   +-- localization.lua  Chat translations (en/zh/ru/ja)
|   |
|   +-- FretBots/          Enhanced difficulty mode
|   |   +-- SettingsDefault.lua    Difficulty tuning
|   |   +-- SettingsNeutralItemTable.lua   Neutral items + enchantments
|   |
|   +-- Customize/         User-editable settings
|       +-- general.lua    Team-level settings
|       +-- hero/          Per-hero overrides
|
+-- typescript/            TypeScript source for TS-generated Lua files
|   +-- bots/              TS versions (compiled to bots/ via tstl)
|   +-- post-process/      Post-compilation scripts
|
+-- game/                  Valve defaults + permanent customization location
|   +-- Customize/         Copy your Customize/ here to survive updates
|
+-- docs/                  Developer documentation
    +-- ARCHITECTURE.md
    +-- PATCH_UPDATE_GUIDE.md
    +-- BOT_API_REFERENCE.md
```

---

## Contribute

-   Contributions welcome on [GitHub](https://github.com/forest0xia/dota2bot-OpenHyperAI)
-   Custom item/skill builds don't need PRs - just tweak locally
-   Future development is in **TypeScript** for better maintainability
-   [Open feature requests](https://github.com/forest0xia/dota2bot-OpenHyperAI/issues?q=is%3Aissue+is%3Aopen+%5BFeature+request%5D)

---

## What's Next

-   Current bot playstyle is limited by Valve's API. **We need ML/LLM bots like OpenAI Five!**
-   Planned improvements:
    -   Smarter laning, pushing, ganking
    -   Stronger spell casting (Invoker, Rubick, Morphling, etc.)
    -   Better support for bugged heroes (Dark Willow, IO, Lone Druid, Muerta, etc.)
    -   Full game mode support + ongoing patch fixes
-   [Feedback to Valve Dota2 bot team](https://www.reddit.com/r/DotA2/comments/1ezxpav/)

---

## Useful Resources

| Resource                                                                                                              | Description                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [Dota2 AI Development Tutorial](https://www.adamqqq.com/ai/dota2-ai-devlopment-tutorial.html)                         | Comprehensive guide by adamqqq |
| [Valve Bot Scripting Intro](https://developer.valvesoftware.com/wiki/Dota_Bot_Scripting)                              | Official Valve documentation   |
| [Lua Bot APIs (moddota)](https://docs.moddota.com/lua_bots/)                                                          | Community API docs             |
| [Liquipedia Cheats (Internal Names)](https://liquipedia.net/dota2/Cheats)                                             | Item/hero/ability code names   |
| [npc_abilities.txt](https://raw.githubusercontent.com/dotabuff/d2vpk/master/dota_pak01/scripts/npc/npc_abilities.txt) | Ability metadata               |
| [Enums & APIs (moddota)](https://moddota.com/api/#!/vscripts/dotaunitorder_t)                                         | Enum reference                 |
| [Modifier Names](https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/Built-In_Modifier_Names)    | Buff/debuff modifier names     |

---

## Support

-   Contribute on GitHub
-   Or [buy me a coffee](https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions/74)

---

## Credits

Built on top of Valve's default bots + contributions from many talented authors:

-   New Beginner AI ([dota2jmz@163.com](mailto:dota2jmz@163.com))
-   Tinkering About ([ryndrb](https://github.com/ryndrb/dota2bot))
-   Ranked Matchmaking AI ([adamqqq](https://github.com/adamqqqplay/dota2ai))
-   fretbots ([fretmute](https://github.com/fretmute/fretbots))
-   BOT Experiment (Furiospuppy)
-   ExtremePush ([insraq](https://github.com/insraq/dota2bots))
-   And all other contributors who made bot games better
