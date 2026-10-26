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

local function __TS__ArrayMap(self, callbackfn, thisArg)
    local result = {}
    for i = 1, #self do
        result[i] = callbackfn(thisArg, self[i], i - 1, self)
    end
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

local function __TS__StringCharAt(self, pos)
    if pos ~= pos then
        pos = 0
    end
    if pos < 0 then
        return ""
    end
    return string.sub(self, pos + 1, pos + 1)
end
-- End of Lua Library inline imports
local ____exports = {}
____exports.DIRECTIVE_SCHEMA_V1 = "oha.directive.v1"
____exports.STATE_BUDGET_BYTES = 4096
____exports.MEMORY_BUDGET_BYTES = 8192
local DRAFT_STAGES = {
    {},
    {locale = false},
    {slots = false},
    {bans = false},
    {candidateLimit = 8},
    {candidateLimit = 5},
    {scores = false}
}
local MATCH_STAGES = {
    {},
    {towers = false},
    {enemyItems = false},
    {enemyNetWorth = false},
    {enemyLevels = false}
}
local function RenderDraft(ctx, o)
    local out = {
        mode = ctx.mode,
        gameTimeSec = ctx.gameTimeSec,
        radiantPicks = ctx.radiantPicks,
        direPicks = ctx.direPicks,
        candidates = __TS__ArrayMap(
            __TS__ArraySlice(ctx.candidates, 0, o.candidateLimit),
            function(____, c) return o.scores and ({hero = c.hero, score = c.score}) or ({hero = c.hero}) end
        )
    }
    if o.locale then
        out.locale = ctx.locale
    end
    if o.slots then
        out.slots = ctx.slots
    end
    if o.bans then
        out.bans = ctx.bans
    end
    return out
end
local function RenderMatch(ctx, o)
    local enemies = __TS__ArrayMap(
        ctx.enemies,
        function(____, e)
            local item = {hero = e.hero}
            if o.enemyLevels then
                item.level = e.level
            end
            if o.enemyNetWorth then
                item.netWorth = e.netWorth
            end
            if o.enemyItems then
                item.items = e.items
            end
            return item
        end
    )
    local out = {
        gameTimeSec = ctx.gameTimeSec,
        hero = ctx.hero,
        level = ctx.level,
        netWorth = ctx.netWorth,
        gold = ctx.gold,
        kda = {ctx.kills, ctx.deaths, ctx.assists},
        items = ctx.items,
        enemies = enemies
    }
    if o.towers and ctx.towersRadiant >= 0 and ctx.towersDire >= 0 then
        out.towers = {radiant = ctx.towersRadiant, dire = ctx.towersDire}
    end
    return out
end
function ____exports.SerializeDraft(ctx, encode, budgetBytes)
    local opts = {
        locale = true,
        slots = true,
        bans = true,
        scores = true,
        candidateLimit = 12
    }
    local dropped = {}
    local json = ""
    for ____, stage in ipairs(DRAFT_STAGES) do
        if stage.locale == false then
            opts.locale = false
            dropped[#dropped + 1] = "locale"
        end
        if stage.slots == false then
            opts.slots = false
            dropped[#dropped + 1] = "slots"
        end
        if stage.bans == false then
            opts.bans = false
            dropped[#dropped + 1] = "bans"
        end
        if stage.candidateLimit ~= nil then
            opts.candidateLimit = stage.candidateLimit
            dropped[#dropped + 1] = "candidates<=" .. tostring(stage.candidateLimit)
        end
        if stage.scores == false then
            opts.scores = false
            dropped[#dropped + 1] = "scores"
        end
        json = encode(RenderDraft(ctx, opts))
        if #json <= budgetBytes then
            return {json = json, bytes = #json, dropped = dropped, overBudget = false}
        end
    end
    return {json = json, bytes = #json, dropped = dropped, overBudget = true}
end
function ____exports.SerializeMatch(ctx, encode, budgetBytes)
    local opts = {towers = true, enemyItems = true, enemyNetWorth = true, enemyLevels = true}
    local dropped = {}
    local json = ""
    for ____, stage in ipairs(MATCH_STAGES) do
        if stage.towers == false then
            opts.towers = false
            dropped[#dropped + 1] = "towers"
        end
        if stage.enemyItems == false then
            opts.enemyItems = false
            dropped[#dropped + 1] = "enemyItems"
        end
        if stage.enemyNetWorth == false then
            opts.enemyNetWorth = false
            dropped[#dropped + 1] = "enemyNetWorth"
        end
        if stage.enemyLevels == false then
            opts.enemyLevels = false
            dropped[#dropped + 1] = "enemyLevels"
        end
        json = encode(RenderMatch(ctx, opts))
        if #json <= budgetBytes then
            return {json = json, bytes = #json, dropped = dropped, overBudget = false}
        end
    end
    return {json = json, bytes = #json, dropped = dropped, overBudget = true}
end
--- Trim text to maxBytes at a whitespace boundary (string-level; re-encoded by caller).
function ____exports.ClampText(text, maxBytes)
    if #text <= maxBytes then
        return text
    end
    local cut = __TS__StringSlice(text, 0, maxBytes)
    do
        local i = #cut - 1
        while i > 0 do
            local ch = __TS__StringCharAt(cut, i)
            if ch == " " or ch == "\n" then
                return __TS__StringSlice(cut, 0, i)
            end
            i = i - 1
        end
    end
    return cut
end
function ____exports.DraftSystemPrompt()
    return ((((((((((((("You are the drafting brain of a Dota 2 bot team. " .. "Reply with STRICT JSON only - no prose, no markdown fences. ") .. "Schema ") .. ____exports.DIRECTIVE_SCHEMA_V1) .. ": ") .. "{\"schema\":\"") .. ____exports.DIRECTIVE_SCHEMA_V1) .. "\",\"phase\":\"draft\",") .. "\"picks\":[{\"hero\":\"npc_dota_hero_x\",\"weight\":0.9,\"reason\":\"short\"}],") .. "\"bans\":[{\"hero\":\"npc_dota_hero_y\",\"weight\":0.5}],") .. "\"builds\":{\"npc_dota_hero_x\":{\"pos\":3,\"items\":[\"item_blade_mail\"],\"ability_order\":[\"e\",\"q\",\"e\",\"w\",\"e\",\"r\"],\"talents\":[\"l\",\"r\",\"l\",\"r\"]}},") .. "\"meta\":{\"confidence\":0.8,\"summary\":\"one line\"}}. ") .. "Rules: hero names must be npc_dota_hero_* internal names; items must be item_* internal purchase names; ") .. "weights in [0,1]; at most 12 picks and 12 bans; ability_order letters from {q,w,e,r} only; ") .. "include builds for your recommended picks; prefer counter-picks against the enemy lineup shown."
end
function ____exports.MatchSystemPrompt()
    return (((((((((("You are the item and skill build brain of one Dota 2 bot. " .. "Reply with STRICT JSON only - no prose, no markdown fences. ") .. "Schema ") .. ____exports.DIRECTIVE_SCHEMA_V1) .. ": ") .. "{\"schema\":\"") .. ____exports.DIRECTIVE_SCHEMA_V1) .. "\",\"phase\":\"build\",") .. "\"builds\":{\"npc_dota_hero_x\":{\"pos\":1,\"items\":[\"item_bkb\"],\"ability_order\":[\"q\",\"w\",\"q\",\"e\",\"q\",\"r\"],\"talents\":[\"r\",\"l\",\"r\",\"l\"]}},") .. "\"meta\":{\"confidence\":0.7,\"summary\":\"one line\"}}. ") .. "Adapt items to the enemy lineup and current game state shown; ") .. "items must be item_* internal purchase names."
end
function ____exports.DraftPrompt(ctx, memoryNotes, encode, budgetBytes)
    local res = ____exports.SerializeDraft(ctx, encode, budgetBytes)
    local user = res.json
    if memoryNotes ~= "" then
        user = (user .. "\n\nMEMORY:\n") .. ____exports.ClampText(memoryNotes, ____exports.MEMORY_BUDGET_BYTES)
    end
    return {
        system = ____exports.DraftSystemPrompt(),
        user = user,
        dropped = res.dropped,
        overBudget = res.overBudget
    }
end
function ____exports.MatchPrompt(ctx, encode, budgetBytes)
    local res = ____exports.SerializeMatch(ctx, encode, budgetBytes)
    return {
        system = ____exports.MatchSystemPrompt(),
        user = res.json,
        dropped = res.dropped,
        overBudget = res.overBudget
    }
end
return ____exports
