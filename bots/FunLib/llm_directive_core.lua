--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
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

local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
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
____exports.SCHEMA_V1 = "oha.directive.v1"
____exports.MAX_LIST = 12
____exports.MAX_ABILITY_ORDER = 30
____exports.REASON_MAX = 150
____exports.SUMMARY_MAX = 200
--- Ability-slot indices used by hero build lists (J.Skill.GetAbilityList
-- convention: sAbilityList[1]=Q, [2]=W, [3]=E, [6]=ultimate). Consumed by the
-- build adapter (RFC-001 §7, plan task T6).
____exports.ABILITY_SLOTS = {q = 1, w = 2, e = 3, r = 6}
--- Maps validated ability letters to ability-slot indices; undefined on any gap.
function ____exports.AbilitySlotsFor(letters)
    local out = {}
    for ____, letter in ipairs(letters) do
        local slot = ____exports.ABILITY_SLOTS[letter]
        if slot == nil then
            return nil
        end
        out[#out + 1] = slot
    end
    return out
end
--- Draft score merge (RFC-001 §6): the LLM re-ranks, never forces — its weight
-- caps at 0.5 so an unpickable-by-base-score hero can never be forced up.
function ____exports.MergeDraftScore(base, llmWeight)
    local alpha = math.min(llmWeight, 0.5)
    return base * (1 - alpha) + llmWeight * alpha
end
--- Build merge (RFC-001 §7): LLM slots override the default list's prefix.
function ____exports.MergeAbilityPrefix(llmSlots, defaultSlots)
    local merged = {}
    do
        local i = 0
        while i < #defaultSlots do
            merged[#merged + 1] = defaultSlots[i + 1]
            i = i + 1
        end
    end
    do
        local i = 0
        while i < #llmSlots do
            merged[i + 1] = llmSlots[i + 1]
            i = i + 1
        end
    end
    return merged
end
--- Purchase-list merge (RFC-001 §7): the LLM list leads; the default list tops
-- it up (deduped) so late-game purchases never starve on a short LLM list.
function ____exports.MergeListPrefix(prefix, base)
    local merged = {}
    local seen = {}
    do
        local i = 0
        while i < #prefix do
            merged[#merged + 1] = prefix[i + 1]
            seen[prefix[i + 1]] = true
            i = i + 1
        end
    end
    do
        local i = 0
        while i < #base do
            if seen[base[i + 1]] ~= true then
                merged[#merged + 1] = base[i + 1]
                seen[base[i + 1]] = true
            end
            i = i + 1
        end
    end
    return merged
end
function ____exports.BuildHeroWhitelist(names)
    local whitelist = {}
    for ____, name in ipairs(names) do
        whitelist[name] = true
    end
    return whitelist
end
local function TrimTo(text, max)
    if #text <= max then
        return text
    end
    return __TS__StringSlice(text, 0, max)
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
local function IsDict(v)
    return type(v) == "table" and v ~= nil and not __TS__ArrayIsArray(v)
end
local function DefaultItemCheck(name)
    if #name < 6 or #name > 60 then
        return false
    end
    if string.sub(name, 1, 5) ~= "item_" then
        return false
    end
    do
        local i = 5
        while i < #name do
            local c = __TS__StringCharAt(name, i)
            local ok = c >= "a" and c <= "z" or c >= "0" and c <= "9" or c == "_"
            if not ok then
                return false
            end
            i = i + 1
        end
    end
    return true
end
local function IsAbilityLetter(v)
    return v == "q" or v == "w" or v == "e" or v == "r"
end
local function IsTalentLetter(v)
    return v == "l" or v == "r"
end
local function TrimSpace(s)
    local a = 0
    local b = #s
    local function ws(c)
        return c == " " or c == "\n" or c == "\r" or c == "\t"
    end
    while a < b and ws(__TS__StringCharAt(s, a)) do
        a = a + 1
    end
    while b > a and ws(__TS__StringCharAt(s, b - 1)) do
        b = b - 1
    end
    return __TS__StringSlice(s, a, b)
end
--- Real models wrap "strict JSON" in markdown fences despite instructions.
local function StripFences(text)
    local t = text
    if string.sub(t, 1, 3) == "```" then
        local nl = (string.find(t, "\n", nil, true) or 0) - 1
        if nl >= 0 then
            t = __TS__StringSlice(t, nl + 1)
        end
    end
    if #t >= 3 and __TS__StringSlice(t, #t - 3) == "```" then
        t = __TS__StringSlice(t, 0, #t - 3)
    end
    return t
end
function ____exports.ParseAndValidate(rawText, opts)
    local root
    do
        local function ____catch()
            return true, {ok = false, error = "parse"}
        end
        local ____try, ____hasReturned, ____returnValue = pcall(function()
            root = opts.decode(TrimSpace(StripFences(TrimSpace(rawText))))
        end)
        if not ____try then
            ____hasReturned, ____returnValue = ____catch()
        end
        if ____hasReturned then
            return ____returnValue
        end
    end
    if not IsDict(root) then
        return {ok = false, error = "not-table"}
    end
    if root.schema ~= ____exports.SCHEMA_V1 then
        return {ok = false, error = "schema"}
    end
    if root.phase ~= "draft" and root.phase ~= "build" then
        return {ok = false, error = "phase"}
    end
    local warnings = {}
    local itemCheck = opts.itemCheck ~= nil and opts.itemCheck or DefaultItemCheck
    local picks = {}
    if root.picks ~= nil and root.picks ~= nil then
        local picksArr = root.picks
        if not __TS__ArrayIsArray(picksArr) then
            return {ok = false, error = "picks"}
        end
        if #picksArr > ____exports.MAX_LIST then
            return {ok = false, error = "picks-size"}
        end
        local seen = {}
        for ____, entry in ipairs(picksArr) do
            do
                local __continue47
                repeat
                    if not IsDict(entry) then
                        return {ok = false, error = "pick"}
                    end
                    if type(entry.hero) ~= "string" or opts.heroes[entry.hero] ~= true then
                        return {ok = false, error = "pick-hero"}
                    end
                    if type(entry.weight) ~= "number" then
                        return {ok = false, error = "pick-weight"}
                    end
                    if seen[entry.hero] == true then
                        warnings[#warnings + 1] = "dup-pick:" .. tostring(entry.hero)
                        __continue47 = true
                        break
                    end
                    seen[entry.hero] = true
                    local pick = {
                        hero = entry.hero,
                        weight = Clamp01(entry.weight)
                    }
                    if type(entry.reason) == "string" then
                        pick.reason = TrimTo(entry.reason, ____exports.REASON_MAX)
                    end
                    if entry.weight < 0 or entry.weight > 1 then
                        warnings[#warnings + 1] = "clamp-pick:" .. tostring(entry.hero)
                    end
                    picks[#picks + 1] = pick
                    __continue47 = true
                until true
                if not __continue47 then
                    break
                end
            end
        end
    elseif root.picks == nil then
        warnings[#warnings + 1] = "null:picks"
    end
    local bans = {}
    if root.bans ~= nil and root.bans ~= nil then
        local bansArr = root.bans
        if not __TS__ArrayIsArray(bansArr) then
            return {ok = false, error = "bans"}
        end
        if #bansArr > ____exports.MAX_LIST then
            return {ok = false, error = "bans-size"}
        end
        for ____, entry in ipairs(bansArr) do
            if not IsDict(entry) then
                return {ok = false, error = "ban"}
            end
            if type(entry.hero) ~= "string" or opts.heroes[entry.hero] ~= true then
                return {ok = false, error = "ban-hero"}
            end
            if type(entry.weight) ~= "number" then
                return {ok = false, error = "ban-weight"}
            end
            if entry.weight < 0 or entry.weight > 1 then
                warnings[#warnings + 1] = "clamp-ban:" .. tostring(entry.hero)
            end
            bans[#bans + 1] = {
                hero = entry.hero,
                weight = Clamp01(entry.weight)
            }
        end
    elseif root.bans == nil then
        warnings[#warnings + 1] = "null:bans"
    end
    local builds = {}
    if root.builds ~= nil and root.builds ~= nil then
        if not IsDict(root.builds) then
            return {ok = false, error = "builds"}
        end
        for hero in pairs(root.builds) do
            if opts.heroes[hero] ~= true then
                return {ok = false, error = "builds-hero"}
            end
            local entry = root.builds[hero]
            if not IsDict(entry) then
                return {ok = false, error = "builds-entry"}
            end
            if type(entry.pos) ~= "number" or math.floor(entry.pos) ~= entry.pos or entry.pos < 1 or entry.pos > 5 then
                return {ok = false, error = "builds-pos"}
            end
            local itemsArr = entry.items
            if not __TS__ArrayIsArray(itemsArr) or #itemsArr > ____exports.MAX_LIST then
                return {ok = false, error = "builds-items"}
            end
            local items = {}
            for ____, item in ipairs(itemsArr) do
                if type(item) ~= "string" or not itemCheck(item) then
                    return {ok = false, error = "builds-items"}
                end
                items[#items + 1] = item
            end
            local orderArr = entry.ability_order
            if not __TS__ArrayIsArray(orderArr) or #orderArr > ____exports.MAX_ABILITY_ORDER then
                return {ok = false, error = "builds-abilities"}
            end
            local order = {}
            for ____, letter in ipairs(orderArr) do
                if not IsAbilityLetter(letter) then
                    return {ok = false, error = "builds-abilities"}
                end
                order[#order + 1] = letter
            end
            local talentsArr = entry.talents
            if not __TS__ArrayIsArray(talentsArr) or #talentsArr ~= 4 then
                return {ok = false, error = "builds-talents"}
            end
            local talents = {}
            for ____, t in ipairs(talentsArr) do
                if not IsTalentLetter(t) then
                    return {ok = false, error = "builds-talents"}
                end
                talents[#talents + 1] = t
            end
            builds[hero] = {pos = entry.pos, items = items, ability_order = order, talents = talents}
        end
    elseif root.builds == nil then
        warnings[#warnings + 1] = "null:builds"
    end
    local meta = nil
    if root.meta ~= nil and root.meta ~= nil then
        if IsDict(root.meta) and type(root.meta.confidence) == "number" then
            meta = {
                confidence = Clamp01(root.meta.confidence),
                summary = type(root.meta.summary) == "string" and TrimTo(root.meta.summary, ____exports.SUMMARY_MAX) or ""
            }
        else
            warnings[#warnings + 1] = "meta-dropped"
        end
    end
    for key in pairs(root) do
        if key ~= "schema" and key ~= "phase" and key ~= "picks" and key ~= "bans" and key ~= "builds" and key ~= "meta" then
            warnings[#warnings + 1] = "unknown:" .. key
        end
    end
    return {ok = true, directive = {
        schema = ____exports.SCHEMA_V1,
        phase = root.phase,
        picks = picks,
        bans = bans,
        builds = builds,
        meta = meta,
        warnings = warnings
    }}
end
return ____exports
