--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
end

local function __TS__StringSlice(self, start, ____end)
    if start == nil or start ~= start then
        start = 0
    end
    if ____end ~= ____end then
        ____end = 0
    end
    if start >= 0 then
        start = start + 1
    end
    if ____end ~= nil and ____end < 0 then
        ____end = ____end - 1
    end
    return string.sub(self, start, ____end)
end
-- End of Lua Library inline imports
local ____exports = {}
local ____llm_gateway = require(GetScriptDirectory().."/FunLib/llm_gateway")
local Ask = ____llm_gateway.Ask
local Enabled = ____llm_gateway.Enabled
local ____llm_strategy_core = require(GetScriptDirectory().."/FunLib/llm_strategy_core")
local ParseStrategy = ____llm_strategy_core.ParseStrategy
local jsonlib = require(GetScriptDirectory().."/ts_libs/utils/json")
local STRATEGY_TTL_SEC = 60
local SYSTEM_PROMPT = table.concat({
    "You are the team strategist for a Dota 2 bot team.",
    "Read the match state and return ONE JSON object, nothing else.",
    ("Shape: {\"schema\":\"oha-strategy-v1\",\"push\":{\"top\":0,\"mid\":0,\"bot\":0}," .. "\"defend\":{\"top\":0,\"mid\":0,\"bot\":0},\"farm\":{\"top\":0,\"mid\":0,\"bot\":0},") .. "\"rosh\":0,\"stance\":\"group\",\"note\":\"short reason\"}",
    "Every lane weight and rosh is a number in 0..1; stance is one of \"group\", \"split-push\", \"defend\", \"aggro\".",
    "`note` is one short line, at most 120 characters.",
    "No prose, no markdown, no code fences outside the JSON."
}, " ")
local function TrimFences(text)
    local t = __TS__StringTrim(text)
    if string.sub(t, 1, 3) == "```" then
        local nl = (string.find(t, "\n", nil, true) or 0) - 1
        t = nl >= 0 and __TS__StringSlice(t, nl + 1) or string.sub(t, 4)
    end
    if #t >= 3 and __TS__StringSlice(t, #t - 3) == "```" then
        t = __TS__StringSlice(t, 0, #t - 3)
    end
    return __TS__StringTrim(t)
end
--- Whether a strategy ask could dispatch right now (master gate + phase toggle).
function ____exports.StrategyEnabled()
    return Enabled("desire")
end
--- Match JSON plus the rendered event tail (RFC-002 §8) when one is supplied.
local function UserPayload(matchJson, memoryTail)
    if memoryTail == nil then
        return matchJson
    end
    local tail = __TS__StringTrim(memoryTail)
    if tail == "" then
        return matchJson
    end
    return (matchJson .. "\n\nRecent match events:\n") .. tail
end
--- One non-blocking checkpoint ask; onDone always fires exactly once.
function ____exports.AskStrategy(matchJson, onDone, memoryTail)
    Ask(
        "desire",
        SYSTEM_PROMPT,
        UserPayload(matchJson, memoryTail),
        STRATEGY_TTL_SEC,
        function(ok, text)
            if not ok then
                onDone(nil)
                return
            end
            local raw
            do
                local function ____catch()
                    onDone(nil)
                    return true
                end
                local ____try, ____hasReturned, ____returnValue = pcall(function()
                    raw = jsonlib.decode(TrimFences(text))
                end)
                if not ____try then
                    ____hasReturned, ____returnValue = ____catch()
                end
                if ____hasReturned then
                    return ____returnValue
                end
            end
            onDone(ParseStrategy(raw))
        end
    )
end
local function OneDecimal(value)
    local scaled = math.floor(value * 10 + 0.5)
    local whole = math.floor(scaled / 10)
    return (tostring(whole) .. ".") .. tostring(scaled - whole * 10)
end
local function LaneSummary(label, weights)
    local parts = {}
    if weights.top > 0 then
        parts[#parts + 1] = "top " .. OneDecimal(weights.top)
    end
    if weights.mid > 0 then
        parts[#parts + 1] = "mid " .. OneDecimal(weights.mid)
    end
    if weights.bot > 0 then
        parts[#parts + 1] = "bot " .. OneDecimal(weights.bot)
    end
    if #parts == 0 then
        return label .. " none"
    end
    return (label .. " ") .. table.concat(parts, " / ")
end
--- Audit line for the visible strategy channels: stance, non-zero push lanes, ask index.
function ____exports.StrategyAnnouncement(d, minute, askIndex, maxAsks)
    return ((((((((("[OHA-LLM] strategy @" .. tostring(math.floor(minute))) .. "m: ") .. d.stance) .. ", ") .. LaneSummary("push", d.push)) .. " (ask ") .. tostring(askIndex)) .. "/") .. tostring(maxAsks)) .. ")"
end
return ____exports
