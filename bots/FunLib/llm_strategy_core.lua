--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
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
--- Pure core for the adaptive team strategy layer (RFC-002 §5).
-- 
-- Validates the `oha-strategy-v1` directive the LLM returns at match
-- checkpoints, merges its weights into Valve's desire seam under a hard alpha
-- cap, and gates checkpoint asks by spacing and per-game budget. No engine or
-- HTTP calls here - the binding (llm_strategy.ts) supplies those - so every
-- rule is unit-testable.
-- 
-- Dual-runtime: this module runs under Node in tests and inside the Dota Lua
-- VM in game. Therefore it uses ONLY constructs that compile cleanly through
-- typescript-to-lua AND run natively in Node: `typeof` comparisons. Whole
-- payloads are discarded on any structural violation (schema, stance, lane
-- keys, rosh); present numerics are clamped to [0,1] rather than discarded.
____exports.STRATEGY_SCHEMA = "oha-strategy-v1"
____exports.STRATEGY_MAX_ASKS = 8
____exports.STRATEGY_SPACING_SEC = 300
____exports.STRATEGY_NOTE_MAX = 120
____exports.STRATEGY_ALPHA_MAX = 0.5
local function IsDict(v)
    return type(v) == "table" and v ~= nil and not __TS__ArrayIsArray(v)
end
local function Clamp01(value)
    if value < 0 then
        return 0
    end
    if value > 1 then
        return 1
    end
    return value
end
--- Lane weights are structural: a missing or non-numeric lane discards the payload.
local function ParseLane(raw)
    if not IsDict(raw) then
        return nil
    end
    if type(raw.top) ~= "number" or type(raw.mid) ~= "number" or type(raw.bot) ~= "number" then
        return nil
    end
    return {
        top = Clamp01(raw.top),
        mid = Clamp01(raw.mid),
        bot = Clamp01(raw.bot)
    }
end
local function IsStance(v)
    return v == "group" or v == "split-push" or v == "defend" or v == "aggro"
end
--- Validates one `oha-strategy-v1` payload; undefined means discard the whole directive.
function ____exports.ParseStrategy(raw)
    if not IsDict(raw) then
        return nil
    end
    if raw.schema ~= ____exports.STRATEGY_SCHEMA then
        return nil
    end
    if not IsStance(raw.stance) then
        return nil
    end
    local push = ParseLane(raw.push)
    local defend = ParseLane(raw.defend)
    local farm = ParseLane(raw.farm)
    if push == nil or defend == nil or farm == nil then
        return nil
    end
    if type(raw.rosh) ~= "number" then
        return nil
    end
    local directive = {
        schema = ____exports.STRATEGY_SCHEMA,
        push = push,
        defend = defend,
        farm = farm,
        rosh = Clamp01(raw.rosh),
        stance = raw.stance
    }
    if type(raw.note) == "string" then
        local note = raw.note
        directive.note = __TS__StringSlice(note, 0, ____exports.STRATEGY_NOTE_MAX)
    end
    return directive
end
--- Desire-seam merge (RFC-002 §5.3): the directive biases Valve's desire, it
-- never replaces it - alpha caps at 0.5 and the result stays in [0,1].
function ____exports.MergeDesire(base, directiveValue, alpha)
    local a = alpha > ____exports.STRATEGY_ALPHA_MAX and ____exports.STRATEGY_ALPHA_MAX or alpha
    return Clamp01(base * (1 - a) + directiveValue * a)
end
--- Whether a checkpoint ask fits the per-game cap and the spacing window.
function ____exports.ShouldAskStrategy(now, lastAskAt, askedCount, maxAsks, spacingSec)
    if maxAsks == nil then
        maxAsks = ____exports.STRATEGY_MAX_ASKS
    end
    if spacingSec == nil then
        spacingSec = ____exports.STRATEGY_SPACING_SEC
    end
    if askedCount >= maxAsks then
        return false
    end
    return now - lastAskAt >= spacingSec
end
--- Neutral directive for the layer-off / nothing-cached path (RFC-002 G5).
function ____exports.IdentityDirectives()
    return {
        schema = ____exports.STRATEGY_SCHEMA,
        push = {top = 0.5, mid = 0.5, bot = 0.5},
        defend = {top = 0.5, mid = 0.5, bot = 0.5},
        farm = {top = 0.5, mid = 0.5, bot = 0.5},
        rosh = 0.5,
        stance = "group"
    }
end
return ____exports
