--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
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
-- End of Lua Library inline imports
local ____exports = {}
local SignatureOf, AskOnce, FIRST_PICK_WAIT_SEC, MAX_CANDIDATES
local ____llm_directive = require(GetScriptDirectory().."/FunLib/llm_directive")
local AskDraftDirective = ____llm_directive.AskDraftDirective
local CachedDraftDirective = ____llm_directive.CachedDraftDirective
local DraftAskEnabled = ____llm_directive.DraftAskEnabled
local ____llm_directive_core = require(GetScriptDirectory().."/FunLib/llm_directive_core")
local MergeDraftScore = ____llm_directive_core.MergeDraftScore
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
    print(((("[OHA-LLM] draft ask #" .. tostring(s.askedCount)) .. " (") .. tostring(#trimmed)) .. " candidates)")
    AskDraftDirective(
        {candidates = trimmed, bans = bans},
        "",
        function(directive)
            s.inFlight = false
            if directive ~= nil then
                print(((("[OHA-LLM] draft directive active: " .. tostring(#directive.picks)) .. " picks, ") .. tostring(#directive.bans)) .. " bans")
            end
        end
    )
end
local MAX_DRAFT_ASKS = 2
FIRST_PICK_WAIT_SEC = 6
MAX_CANDIDATES = 25
local state
local function State()
    if state == nil then
        state = {askedSig = nil, inFlight = false, waitUntil = 0, askedCount = 0}
    end
    return state
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
    return "go"
end
return ____exports
