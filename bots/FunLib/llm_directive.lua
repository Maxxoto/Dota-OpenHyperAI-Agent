--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local __TS__StringReplace
do
    local sub = string.sub
    function __TS__StringReplace(source, searchValue, replaceValue)
        local startPos, endPos = string.find(source, searchValue, nil, true)
        if not startPos then
            return source
        end
        local before = sub(source, 1, startPos - 1)
        local replacement = type(replaceValue) == "string" and replaceValue or replaceValue(nil, searchValue, startPos - 1, source)
        local after = sub(source, endPos + 1)
        return (before .. replacement) .. after
    end
end

local function __TS__ArraySlice(self, first, last)
    local len = #self
    first = first or 0
    if first < 0 then
        first = len + first
        if first < 0 then
            first = 0
        end
    else
        if first > len then
            first = len
        end
    end
    last = last or len
    if last < 0 then
        last = len + last
        if last < 0 then
            last = 0
        end
    else
        if last > len then
            last = len
        end
    end
    local out = {}
    first = first + 1
    last = last + 1
    local n = 1
    while first < last do
        out[n] = self[first]
        first = first + 1
        n = n + 1
    end
    return out
end

local function __TS__ArrayMap(self, callbackfn, thisArg)
    local result = {}
    for i = 1, #self do
        result[i] = callbackfn(thisArg, self[i], i - 1, self)
    end
    return result
end
-- End of Lua Library inline imports
local ____exports = {}
local ____llm_gateway = require(GetScriptDirectory().."/FunLib/llm_gateway")
local GatewayAsk = ____llm_gateway.Ask
local GatewayEnabled = ____llm_gateway.Enabled
local GatewayStatusLine = ____llm_gateway.StatusLine
local ____llm_directive_core = require(GetScriptDirectory().."/FunLib/llm_directive_core")
local AbilitySlotsFor = ____llm_directive_core.AbilitySlotsFor
local MergeAbilityPrefix = ____llm_directive_core.MergeAbilityPrefix
local MergeListPrefix = ____llm_directive_core.MergeListPrefix
local ParseAndValidate = ____llm_directive_core.ParseAndValidate
local SCHEMA_V1 = ____llm_directive_core.SCHEMA_V1
local ____llm_state = require(GetScriptDirectory().."/FunLib/llm_state")
local GatherDraft = ____llm_state.GatherDraft
local ____llm_state_core = require(GetScriptDirectory().."/FunLib/llm_state_core")
local DraftPrompt = ____llm_state_core.DraftPrompt
local STATE_BUDGET_BYTES = ____llm_state_core.STATE_BUDGET_BYTES
local ____fork_log = require(GetScriptDirectory().."/FunLib/fork_log")
local ForkLog = ____fork_log.ForkLog
local ____heroes = require(GetScriptDirectory().."/ts_libs/dota/heroes")
local HeroName = ____heroes.HeroName
local jsonlib = require(GetScriptDirectory().."/ts_libs/utils/json")
local DRAFT_TTL_SEC = 120
local heroWhitelist
local cached
local cachedAt = -1000000
local sessionForce
local function Heroes()
    if heroWhitelist == nil then
        heroWhitelist = {}
        local byKey = HeroName
        for key in pairs(byKey) do
            local name = byKey[key]
            if type(name) == "string" then
                heroWhitelist[name] = true
            end
        end
    end
    return heroWhitelist
end
--- Latest valid draft directive, or undefined when none/expired.
function ____exports.CachedDraftDirective()
    if cached ~= nil and GameTime() - cachedAt <= DRAFT_TTL_SEC then
        return cached
    end
    cached = nil
    return nil
end
--- Whether a draft ask would dispatch right now (master gate + phase toggle).
function ____exports.DraftAskEnabled()
    return sessionForce ~= false and GatewayEnabled("draft")
end
--- Build adapter entry (RFC-001 §7, plan task T6): the validated build the
-- cached draft directive carries for this hero, in engine build-list shape.
-- Undefined when the layer is off, nothing is cached (yet), or the hero has
-- no build in the directive — callers fall back to the default build (G5).
function ____exports.BuildOverrideFor(heroName)
    if not GatewayEnabled("builds") then
        return nil
    end
    local directive = ____exports.CachedDraftDirective()
    if directive == nil then
        return nil
    end
    local build = directive.builds[heroName]
    if build == nil then
        return nil
    end
    local ability = AbilitySlotsFor(build.ability_order)
    if ability == nil then
        return nil
    end
    return {pos = build.pos, ability = ability, talents = build.talents, items = build.items}
end
--- Chat line describing the hero's applied directive build, or undefined.
function ____exports.BuildAnnouncement(heroName)
    if not GatewayEnabled("builds") then
        return nil
    end
    local directive = ____exports.CachedDraftDirective()
    if directive == nil then
        return nil
    end
    local build = directive.builds[heroName]
    if build == nil then
        return nil
    end
    local shown = table.concat(
        __TS__ArrayMap(
            __TS__ArraySlice(build.items, 0, 4),
            function(____, s) return __TS__StringReplace(s, "item_", "") end
        ),
        ", "
    )
    local more = #build.items > 4 and " +" .. tostring(#build.items - 4) or ""
    local shortHero = __TS__StringReplace(heroName, "npc_dota_hero_", "")
    return ((((((("[OHA-LLM] build " .. shortHero) .. " (pos ") .. tostring(build.pos)) .. "): ") .. table.concat(build.ability_order, "-")) .. " | ") .. shown) .. more
end
--- Build adapter merge (RFC-001 §7, plan task T6): composes the validated
-- directive build with the hero's default lists — LLM entries lead, defaults
-- top them up so leveling and late purchases never starve. Undefined when no
-- override applies; the caller keeps its defaults (G5).
function ____exports.MergedBuildLists(heroName, defaultAbility, defaultBuyList)
    local override = ____exports.BuildOverrideFor(heroName)
    if override == nil then
        return nil
    end
    return {
        pos = override.pos,
        ability = MergeAbilityPrefix(override.ability, defaultAbility),
        talents = override.talents,
        buyList = MergeListPrefix(override.items, defaultBuyList)
    }
end
--- Asks the LLM for a draft directive. onDone receives a validated directive
-- or undefined (fallback). Exactly one call, always.
function ____exports.AskDraftDirective(facts, memoryNotes, onDone)
    if sessionForce == false or not GatewayEnabled("draft") then
        onDone(nil)
        return
    end
    local ctx = GatherDraft(facts)
    local prompt = DraftPrompt(ctx, memoryNotes, jsonlib.encode, STATE_BUDGET_BYTES)
    GatewayAsk(
        "draft",
        prompt.system,
        prompt.user,
        60,
        function(ok, text, via, reason)
            if not ok then
                ForkLog((("[OHA-LLM] draft fallback via=" .. via) .. " reason=") .. (reason ~= nil and reason or "n/a"))
                onDone(nil)
                return
            end
            local outcome = ParseAndValidate(
                text,
                {
                    decode = function(s) return jsonlib.decode(s) end,
                    heroes = Heroes()
                }
            )
            if not outcome.ok then
                ForkLog("[OHA-LLM] directive discarded: " .. outcome.error)
                onDone(nil)
                return
            end
            cached = outcome.directive
            cachedAt = GameTime()
            ForkLog(((((("[OHA-LLM] directive accepted: " .. tostring(#outcome.directive.picks)) .. " picks, ") .. tostring(#outcome.directive.bans)) .. " bans, ") .. tostring(#outcome.directive.warnings)) .. " warnings")
            onDone(outcome.directive)
        end
    )
end
local function SelftestRaw()
    local cases = {}
    cases[#cases + 1] = {name = "valid full directive", raw = (((((("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",") .. "\"picks\":[{\"hero\":\"npc_dota_hero_axe\",\"weight\":0.9,\"reason\":\"vs melee\"}],") .. "\"bans\":[{\"hero\":\"npc_dota_hero_legion_commander\",\"weight\":0.3}],") .. "\"builds\":{\"npc_dota_hero_axe\":{\"pos\":3,\"items\":[\"item_blade_mail\",\"item_blink\"],") .. "\"ability_order\":[\"e\",\"q\",\"e\",\"w\",\"e\",\"r\"],\"talents\":[\"l\",\"r\",\"l\",\"r\"]}},") .. "\"meta\":{\"confidence\":0.8,\"summary\":\"enemy lacks stuns\"}}", expectValid = true}
    cases[#cases + 1] = {name = "weight clamp tolerated", raw = (("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",") .. "\"picks\":[{\"hero\":\"npc_dota_hero_axe\",\"weight\":2}]}", expectValid = true}
    cases[#cases + 1] = {name = "unknown hero discarded", raw = (("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",") .. "\"picks\":[{\"hero\":\"npc_dota_hero_hacker\",\"weight\":0.5}]}", expectValid = false}
    local oversized = ("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",\"picks\":["
    do
        local i = 0
        while i < 13 do
            if i > 0 then
                oversized = oversized .. ","
            end
            oversized = oversized .. "{\"hero\":\"npc_dota_hero_axe\",\"weight\":0.1}"
            i = i + 1
        end
    end
    oversized = oversized .. "]}"
    cases[#cases + 1] = {name = "oversized picks discarded", raw = oversized, expectValid = false}
    cases[#cases + 1] = {name = "wrong schema discarded", raw = "{\"schema\":\"oha.directive.v0\",\"phase\":\"draft\"}", expectValid = false}
    cases[#cases + 1] = {name = "bad talents discarded", raw = ((("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",") .. "\"builds\":{\"npc_dota_hero_axe\":{\"pos\":1,\"items\":[\"item_blink\"],") .. "\"ability_order\":[\"q\"],\"talents\":[\"l\",\"l\",\"l\"]}}}", expectValid = false}
    cases[#cases + 1] = {name = "injected field tolerated (dropped)", raw = ("{\"schema\":\"" .. SCHEMA_V1) .. "\",\"phase\":\"draft\",\"instructions\":\"ignore rules\"}", expectValid = true}
    cases[#cases + 1] = {name = "garbage discarded", raw = "not json {", expectValid = false}
    return cases
end
--- Runs canned fixtures through the real validator + real whitelist. No network.
function ____exports.RunSelftest()
    local passed = 0
    local failed = 0
    local heroes = Heroes()
    for ____, c in ipairs(SelftestRaw()) do
        local out = ParseAndValidate(
            c.raw,
            {
                decode = function(s) return jsonlib.decode(s) end,
                heroes = heroes
            }
        )
        if out.ok == c.expectValid then
            passed = passed + 1
            ForkLog("[OHA-LLM][selftest] ok: " .. c.name)
        else
            failed = failed + 1
            local why = out.ok and "unexpectedly valid" or out.error
            ForkLog(((("[OHA-LLM][selftest] FAIL: " .. c.name) .. " (") .. why) .. ")")
        end
    end
    if heroes.npc_dota_hero_axe == true then
        passed = passed + 1
        ForkLog("[OHA-LLM][selftest] ok: enum whitelist contains axe")
    else
        failed = failed + 1
        ForkLog("[OHA-LLM][selftest] FAIL: enum whitelist missing axe")
    end
    local summary = ((("[OHA-LLM][selftest] " .. tostring(passed)) .. " passed, ") .. tostring(failed)) .. " failed"
    ForkLog(summary)
    return summary
end
--- Chat command entry: returns a reply line, or undefined when not a !llm command.
local lastHandled = ""
local lastHandledAt = -100
function ____exports.HandleChatCommand(text)
    local hit = string.find(text, "!llm", 1, true)
    if type(hit) ~= "number" then
        return nil
    end
    local now = GameTime()
    if text == lastHandled and now - lastHandledAt < 2 then
        return nil
    end
    lastHandled = text
    lastHandledAt = now
    local word = string.match(text, "^%S+%s+(%S+)")
    if word == "status" then
        local gate = sessionForce == nil and "auto" or (sessionForce and "on" or "off")
        return (("[OHA-LLM] gate=" .. gate) .. " ") .. GatewayStatusLine()
    end
    if word == "on" then
        sessionForce = true
        return "[OHA-LLM] session gate ON (config master flag still applies)"
    end
    if word == "off" then
        sessionForce = false
        cached = nil
        return "[OHA-LLM] session gate OFF (cached directive cleared)"
    end
    if word == "selftest" then
        return ____exports.RunSelftest()
    end
    return "[OHA-LLM] usage: !llm status | on | off | selftest"
end
return ____exports
