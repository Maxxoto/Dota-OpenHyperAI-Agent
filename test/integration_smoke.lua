--[[
    Integration smoke: drives the REAL emitted Lua modules together under
    LuaJIT with stubbed Dota globals (RFC-002/RFC-003 join contracts).
    Run: luajit test/integration_smoke.lua  (from the repo root)
    Covers the cross-lane contracts the phase dags froze:
      1. llm_chat.MaybeReplyEnvelope: one ask -> sanitized reply + validated toolCalls
      2. llm_strategy: AskStrategy -> ParseStrategy -> announcement; MergeDesire math
      3. llm_humanize gate-off identities (jitter 0 / delay 0 / chance 1)
      4. llm_crossmatch reads game/Customize/memory.lua notes
      5. llm_identity determinism through the binding
]]

local nPass, nFail = 0, 0
local function check(name, cond)
    if cond then
        nPass = nPass + 1
        print("ok - " .. name)
    else
        nFail = nFail + 1
        print("FAIL - " .. name)
    end
end

-- Dota globals the modules touch at call time
GetScriptDirectory = function() return "bots" end
GameTime = function() return 900 end
DotaTime = function() return 900 end
RandomFloat = function(a, b) return a end -- deterministic lowest roll
RandomInt = function(a, b) return a end
package.path = "bots/?.lua;bots/FunLib/?.lua;game/?.lua;" .. package.path

-- Stub the gateway for synchronous, scripted replies (scripted is a GLOBAL
-- so the preload chunk sees it)
scripted = nil
package.preload["bots/FunLib/llm_gateway"] = assert(load([=[
    local M = {}
    local enabled = true
    function M.Enabled(phase) return enabled and phase ~= nil end
    function M.Ask(phase, system, user, ttl, cb)
        if scripted == nil then cb(false, "", "stub-off", "no script") return end
        cb(true, scripted)
    end
    return M
]=]))

-- 1) chat envelope join: model text -> reply + validated tool call
scripted = '{"reply":"ez mid, gap too big","tool_calls":[{"tool":"swap_lane","args":{"hero":"npc_dota_hero_axe","lane":"safe"}}]}'
local Chat = require("FunLib.llm_chat")
check("MaybeReplyEnvelope exported", type(Chat.MaybeReplyEnvelope) == "function")
local got = {}
local status = Chat.MaybeReplyEnvelope({
    botName = "axe", hero = "npc_dota_hero_axe", team = "Radiant",
    minute = 15, kills = 5, deaths = 1, assists = 3, netWorth = 9000,
    difficulty = "5", speakerName = "Tester", speakerHero = "npc_dota_hero_sniper",
    message = "mid diff or what",
    teamBotHeroes = { "npc_dota_hero_axe" }, humanHeroes = {},
}, 900, function(r) got = r end)
check("envelope asked", status == "asked")
check("envelope reply sanitized", got.reply == "ez mid, gap too big")
check("envelope toolCalls table", type(got.toolCalls) == "table" and #got.toolCalls >= 1)

-- tool validation join (hero must be a teammate bot, lane maps to pos)
local Tools = require("FunLib.llm_tools_core")
local v = Tools.ValidateToolCall(got.toolCalls[1], { teamBotHeroes = { "npc_dota_hero_axe" }, humanHeroes = {} })
check("swap_lane axe/safe -> pos 1", v.ok == true and v.pos == 1 and v.hero == "npc_dota_hero_axe")
local vBad = Tools.ValidateToolCall(got.toolCalls[1], { teamBotHeroes = {}, humanHeroes = { "npc_dota_hero_axe" } })
check("human hero rejected", vBad.ok == false)

-- 2) strategy join: ask -> parse -> merge
scripted = '{"schema":"oha-strategy-v1","push":{"top":0.0,"mid":0.6,"bot":0.3},"defend":{"top":0.2,"mid":0.5,"bot":0.2},"farm":{"top":0.3,"mid":0.3,"bot":0.4},"rosh":0.4,"stance":"split-push","note":"enemy groups at 20"}'
local Strat = require("FunLib.llm_strategy")
local directive = nil
check("StrategyEnabled", Strat.StrategyEnabled() == true)
Strat.AskStrategy("{}", function(d) directive = d end)
check("AskStrategy parsed directive", directive ~= nil and directive.stance == "split-push")
if directive ~= nil then
    check("StrategyAnnouncement carries stance",
        type(Strat.StrategyAnnouncement) == "function"
        and Strat.StrategyAnnouncement(directive, 15, 3, 8):find("split%-push") ~= nil)
else
    check("StrategyAnnouncement carries stance", false)
end
local Core = require("FunLib.llm_strategy_core")
local merged = Core.MergeDesire(0.7, 0.2, 0.4)
check("MergeDesire 0.7/0.2@0.4 = 0.5", math.abs(merged - 0.5) < 0.001)
check("MergeDesire alpha clamp at 0.5", math.abs(Core.MergeDesire(0.0, 1.0, 0.9) - 0.5) < 0.001)

-- 3) humanize gate-off identities (repo game/Customize/general.lua ships flag false)
local Hum = require("FunLib.llm_humanize")
check("LastHitDelayJitter gate-off 0", Hum.LastHitDelayJitter() == 0)
check("ReactionDelaySec gate-off 0", Hum.ReactionDelaySec() == 0)
check("RotationDelaySec gate-off 0", Hum.RotationDelaySec() == 0)
check("TradeChance gate-off 1", Hum.TradeChance() == 1)

-- 4) crossmatch notes read (game/Customize/memory.lua exists from npm run learn)
local XM = require("FunLib.llm_crossmatch")
local notes = XM.MemoryNotes()
check("MemoryNotes non-empty string", type(notes) == "string" and #notes > 0)

-- 5) identity determinism through the binding
local Id = require("FunLib.llm_identity")
local a1, a2 = Id.IdentityFor("npc_dota_hero_axe", 7), Id.IdentityFor("npc_dota_hero_axe", 7)
check("identity deterministic", a1.handle == a2.handle and a1.archetype == a2.archetype)
check("identity announcement", Id.IdentityAnnouncement("npc_dota_hero_axe", 7):find("identity") ~= nil)

print(("%s - %d passed, %d failed"):format(nFail == 0 and "ALL INTEGRATION SMOKES PASSED" or "INTEGRATION FAILURES", nPass, nFail))
os.exit(nFail == 0 and 0 or 1)
