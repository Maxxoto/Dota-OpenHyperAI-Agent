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

local function __TS__ArraySetLength(self, length)
    if length < 0 or length ~= length or length == math.huge or math.floor(length) ~= length then
        error(
            "invalid array length: " .. tostring(length),
            0
        )
    end
    for i = length + 1, #self do
        self[i] = nil
    end
    return length
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
local ShortHero, SignatureOf, AskOnce, MAX_DRAFT_ASKS, FIRST_PICK_WAIT_SEC, MAX_CANDIDATES, pickEvents
local ____llm_directive = require(GetScriptDirectory().."/FunLib/llm_directive")
local AskDraftDirective = ____llm_directive.AskDraftDirective
local CachedDraftDirective = ____llm_directive.CachedDraftDirective
local DraftAskEnabled = ____llm_directive.DraftAskEnabled
local ____llm_directive_core = require(GetScriptDirectory().."/FunLib/llm_directive_core")
local MergeDraftScore = ____llm_directive_core.MergeDraftScore
local ____fork_log = require(GetScriptDirectory().."/FunLib/fork_log")
local ForkLog = ____fork_log.ForkLog
function ShortHero(name)
    return __TS__StringReplace(name, "npc_dota_hero_", "")
end
function SignatureOf(enemyNames)
    local counts = {}
    for ____, name in ipairs(enemyNames) do
        local current = counts[name]
        counts[name] = current == nil and 1 or current + 1
    end
    local parts = {}
    for name in pairs(counts) do
        parts[#parts + 1] = (name .. ":") .. tostring(counts[name])
    end
    return table.concat(parts, "|")
end
function AskOnce(sig, candidates, bans, now, scheduleInitialized, s)
    s.askedSig = sig
    s.askedCount = s.askedCount + 1
    s.inFlight = true
    if not scheduleInitialized then
        s.waitUntil = now + FIRST_PICK_WAIT_SEC
    end
    local trimmed = #candidates > MAX_CANDIDATES and __TS__ArraySlice(candidates, 0, MAX_CANDIDATES) or candidates
    ForkLog(((("[OHA-LLM] draft ask #" .. tostring(s.askedCount)) .. " (") .. tostring(#trimmed)) .. " candidates)")
    pickEvents[#pickEvents + 1] = ((((("[OHA-LLM] draft ask #" .. tostring(s.askedCount)) .. "/") .. tostring(MAX_DRAFT_ASKS)) .. " sent (") .. tostring(#trimmed)) .. " candidates)"
    AskDraftDirective(
        {candidates = trimmed, bans = bans},
        "",
        function(directive)
            s.inFlight = false
            if directive ~= nil then
                local pickNames = table.concat(
                    __TS__ArrayMap(
                        directive.picks,
                        function(____, p) return ShortHero(p.hero) end
                    ),
                    ","
                )
                local ev = "[OHA-LLM] draft reply OK: picks " .. pickNames
                if #directive.bans > 0 then
                    ev = ev .. " | bans " .. table.concat(
                        __TS__ArrayMap(
                            directive.bans,
                            function(____, b) return ShortHero(b.hero) end
                        ),
                        ","
                    )
                end
                pickEvents[#pickEvents + 1] = ev
                ForkLog(((("[OHA-LLM] draft directive active: " .. tostring(#directive.picks)) .. " picks, ") .. tostring(#directive.bans)) .. " bans")
            else
                pickEvents[#pickEvents + 1] = "[OHA-LLM] draft reply rejected/empty - default picks"
            end
        end
    )
end
MAX_DRAFT_ASKS = 2
FIRST_PICK_WAIT_SEC = 6
MAX_CANDIDATES = 25
local state
local function State()
    if state == nil then
        state = {
            askedSig = nil,
            inFlight = false,
            waitUntil = 0,
            askedCount = 0,
            graceReported = false
        }
    end
    return state
end
pickEvents = {}
--- Returns and clears pending pick-phase events (ask sent / reply / fallback).
function ____exports.DrainPickEvents()
    local out = __TS__ArraySlice(pickEvents)
    __TS__ArraySetLength(pickEvents, 0)
    return out
end
--- One-line draft state for the on-screen overlay and the post-horn summary.
function ____exports.PickStatus()
    local s = State()
    local directive = CachedDraftDirective()
    local gate = DraftAskEnabled() and "on" or "off"
    local asks = (tostring(s.askedCount) .. "/") .. tostring(MAX_DRAFT_ASKS)
    if directive ~= nil then
        local picks = table.concat(
            __TS__ArrayMap(
                directive.picks,
                function(____, p) return ShortHero(p.hero) end
            ),
            ","
        )
        local line = (((("gate=" .. gate) .. " asks=") .. asks) .. " picks=") .. picks
        if #directive.bans > 0 then
            line = line .. " bans=" .. table.concat(
                __TS__ArrayMap(
                    directive.bans,
                    function(____, b) return ShortHero(b.hero) end
                ),
                ","
            )
        end
        return line
    end
    return ((((("gate=" .. gate) .. " asks=") .. asks) .. " inflight=") .. tostring(s.inFlight and 1 or 0)) .. " no-directive"
end
--- Score-merge hook: re-ranks one candidate via the cached directive (alpha <= 0.5).
function ____exports.AdjustScore(hero, base)
    local directive = CachedDraftDirective()
    if directive == nil then
        return base
    end
    for ____, pick in ipairs(directive.picks) do
        if pick.hero == hero then
            return MergeDraftScore(base, pick.weight)
        end
    end
    return base
end
--- Per-tick draft driver: fire-and-observe, never blocks. May start one async
-- LLM ask (see policy above). Returns "wait" only inside the bounded
-- first-pick grace window with no directive cached yet; "go" otherwise.
function ____exports.DraftStep(enemyNames, candidates, bans, now, scheduleInitialized)
    local s = State()
    if DraftAskEnabled() and not s.inFlight and s.askedCount < MAX_DRAFT_ASKS then
        if CachedDraftDirective() == nil then
            local sig = SignatureOf(enemyNames)
            if sig ~= s.askedSig and #candidates > 0 then
                AskOnce(
                    sig,
                    candidates,
                    bans,
                    now,
                    scheduleInitialized,
                    s
                )
            end
        end
    end
    if now < s.waitUntil and CachedDraftDirective() == nil then
        return "wait"
    end
    if s.waitUntil > 0 and s.askedCount > 0 and not s.graceReported and CachedDraftDirective() == nil then
        s.graceReported = true
        pickEvents[#pickEvents + 1] = "[OHA-LLM] grace expired - first pick on defaults"
    end
    return "go"
end
return ____exports
