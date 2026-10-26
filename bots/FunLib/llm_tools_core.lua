--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
end

local __TS__StringSplit
do
    local sub = string.sub
    local find = string.find
    function __TS__StringSplit(source, separator, limit)
        if limit == nil then
            limit = 4294967295
        end
        if limit == 0 then
            return {}
        end
        local result = {}
        local resultIndex = 1
        if separator == nil or separator == "" then
            for i = 1, #source do
                result[resultIndex] = sub(source, i, i)
                resultIndex = resultIndex + 1
            end
        else
            local currentPos = 1
            while resultIndex <= limit do
                local startPos, endPos = find(source, separator, currentPos, true)
                if not startPos then
                    break
                end
                result[resultIndex] = sub(source, currentPos, startPos - 1)
                resultIndex = resultIndex + 1
                currentPos = endPos + 1
            end
            if resultIndex <= limit then
                result[resultIndex] = sub(source, currentPos)
            end
        end
        return result
    end
end

local function __TS__ArrayIncludes(self, searchElement, fromIndex)
    if fromIndex == nil then
        fromIndex = 0
    end
    local len = #self
    local k = fromIndex
    if fromIndex < 0 then
        k = len + fromIndex
    end
    if k < 0 then
        k = 0
    end
    for i = k + 1, len do
        if self[i] == searchElement then
            return true
        end
    end
    return false
end

local function __TS__StringIncludes(self, searchString, position)
    if not position then
        position = 1
    else
        position = position + 1
    end
    local index = string.find(self, searchString, position, true)
    return index ~= nil
end
-- End of Lua Library inline imports
local ____exports = {}
____exports.TOOLS = {"swap_lane", "swap_position"}
local COMMAND_WORDS = {
    "go",
    "come",
    "swap",
    "move",
    "lane",
    "mid",
    "safe",
    "off",
    "top",
    "bot",
    "push"
}
local function IsTable(v)
    return type(v) == "table" and v ~= nil
end
--- A real JS array has a length; a decoded Lua object table does not, which
-- keeps an empty `{}` from being mistaken for `[]` after tstl compilation.
local function IsRealArray(v)
    return __TS__ArrayIsArray(v) and v.length ~= nil
end
local function IsKnownTool(tool)
    do
        local i = 0
        while i < #____exports.TOOLS do
            if ____exports.TOOLS[i + 1] == tool then
                return true
            end
            i = i + 1
        end
    end
    return false
end
--- Maps a lane word to its position number; 0 means the lane is unknown.
local function LaneToPos(lane)
    if lane == "safe" then
        return 1
    end
    if lane == "mid" then
        return 2
    end
    if lane == "off" then
        return 3
    end
    return 0
end
local function IsPosition(pos)
    return type(pos) == "number" and pos == math.floor(pos) and pos >= 1 and pos <= 5
end
--- Parses a model-emitted envelope. Anything malformed discards the whole
-- envelope (no partial tool runs); `reply` keeps only its first line.
function ____exports.EnvelopeParse(raw)
    if not IsTable(raw) or IsRealArray(raw) then
        return nil
    end
    local reply = nil
    if raw.reply ~= nil then
        if type(raw.reply) ~= "string" then
            return nil
        end
        local replyText = raw.reply
        reply = __TS__StringSplit(replyText, "\n")[1] or ""
    end
    local calls = {}
    if raw.tool_calls ~= nil then
        if not __TS__ArrayIsArray(raw.tool_calls) then
            return nil
        end
        local rawCalls = raw.tool_calls
        do
            local i = 0
            while i < #rawCalls do
                local rawCall = rawCalls[i + 1]
                if not IsTable(rawCall) or type(rawCall.tool) ~= "string" or rawCall.tool == "" then
                    return nil
                end
                local args = {}
                local rawArgs = rawCall.args
                if rawArgs ~= nil and rawArgs ~= nil then
                    if not IsTable(rawArgs) or IsRealArray(rawArgs) then
                        return nil
                    end
                    if rawArgs.hero ~= nil then
                        if type(rawArgs.hero) ~= "string" then
                            return nil
                        end
                        args.hero = rawArgs.hero
                    end
                    if rawArgs.lane ~= nil then
                        if type(rawArgs.lane) ~= "string" then
                            return nil
                        end
                        args.lane = rawArgs.lane
                    end
                    if rawArgs.pos ~= nil then
                        if type(rawArgs.pos) ~= "number" then
                            return nil
                        end
                        args.pos = rawArgs.pos
                    end
                end
                calls[#calls + 1] = {tool = rawCall.tool, args = args}
                i = i + 1
            end
        end
    end
    local out = {}
    if reply ~= nil then
        out.reply = reply
    end
    if raw.tool_calls ~= nil then
        out.tool_calls = calls
    end
    return out
end
--- Validates one call against the roster: the hero must be a teammate bot
-- (never a human, never an enemy) and the lane/position must be in range.
-- The returned pos is the resolved position number (1 safe, 2 mid, 3 off).
function ____exports.ValidateToolCall(call, opts)
    local raw = call
    if not IsTable(raw) or type(raw.tool) ~= "string" or raw.tool == "" then
        return {ok = false, reason = "missing-tool"}
    end
    local tool = raw.tool
    if not IsKnownTool(tool) then
        return {ok = false, reason = "unknown-tool"}
    end
    local rawArgs = raw.args
    local hero = ""
    local lane = ""
    local pos = 0
    if IsTable(rawArgs) then
        if type(rawArgs.hero) == "string" then
            hero = rawArgs.hero
        end
        if type(rawArgs.lane) == "string" then
            lane = rawArgs.lane
        end
        if type(rawArgs.pos) == "number" then
            pos = rawArgs.pos
        end
    end
    if hero == "" then
        return {ok = false, reason = "hero-missing"}
    end
    if __TS__ArrayIncludes(opts.humanHeroes, hero) then
        return {ok = false, reason = "hero-is-human"}
    end
    if not __TS__ArrayIncludes(opts.teamBotHeroes, hero) then
        return {ok = false, reason = "hero-not-teammate"}
    end
    if tool == ____exports.TOOLS[1] then
        local lanePos = LaneToPos(lane)
        if lanePos ~= 0 then
            return {ok = true, tool = tool, hero = hero, pos = lanePos}
        end
        if IsPosition(pos) then
            return {ok = true, tool = tool, hero = hero, pos = pos}
        end
        return {ok = false, reason = "lane-invalid"}
    end
    if not IsPosition(pos) then
        return {ok = false, reason = "pos-invalid"}
    end
    return {ok = true, tool = tool, hero = hero, pos = pos}
end
--- Cheap, LLM-free gate: true only when the message names a hero hint AND
-- carries a command word, so ordinary banter never costs a gateway call.
function ____exports.Prefilter(text, heroHints)
    if type(text) ~= "string" or text == "" then
        return false
    end
    local lower = string.lower(text)
    local hasHero = false
    do
        local i = 0
        while i < #heroHints do
            do
                local __continue46
                repeat
                    local hint = heroHints[i + 1]
                    if type(hint) ~= "string" or hint == "" then
                        __continue46 = true
                        break
                    end
                    if __TS__StringIncludes(
                        lower,
                        string.lower(hint)
                    ) then
                        hasHero = true
                        break
                    end
                    __continue46 = true
                until true
                if not __continue46 then
                    break
                end
            end
            i = i + 1
        end
    end
    if not hasHero then
        return false
    end
    do
        local i = 0
        while i < #COMMAND_WORDS do
            if __TS__StringIncludes(lower, COMMAND_WORDS[i + 1]) then
                return true
            end
            i = i + 1
        end
    end
    return false
end
--- Per-game tool budget plus a cooldown between executed calls.
function ____exports.CanExecuteTool(now, state, max, cooldownSec)
    if max == nil then
        max = 4
    end
    if cooldownSec == nil then
        cooldownSec = 30
    end
    if state.executed >= max then
        return false
    end
    if now - state.lastAt < cooldownSec then
        return false
    end
    return true
end
return ____exports
