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

local function __TS__StringCharCodeAt(self, index)
    if index ~= index then
        index = 0
    end
    if index < 0 then
        return 0 / 0
    end
    return string.byte(self, index + 1) or 0 / 0
end

local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
end
-- End of Lua Library inline imports
local ____exports = {}
local HERO_PREFIX = "npc_dota_hero_"
local ARCHETYPES = {"cocky", "chill", "whiny", "strategist"}
local HANDLE_SUFFIXES = {
    "enjoyer",
    "diff",
    "gap",
    "gg",
    "xp"
}
local HASH_MOD = 1000000007
local HASH_BASE = 131
local PHRASES = {cocky = {
    "ez mid",
    "you're not ready for this",
    "call it now, it's over",
    "watch the map, not me",
    "gap is gap",
    "too easy"
}, chill = {
    "all good, we scale",
    "one fight at a time",
    "no rush, take the farm",
    "we're fine, breathe",
    "play your game",
    "gg either way"
}, whiny = {
    "where is my team though",
    "another gank, no ward?",
    "this lane is cursed",
    "i'm dying out here",
    "can someone rotate please",
    "of course i die first"
}, strategist = {
    "push the lane, then rotate",
    "they group, we split",
    "ward their jungle first",
    "smoke now, they're split",
    "trade towers, don't fight blind",
    "buy back, we hold high ground"
}}
--- Hero id without its `npc_dota_hero_` prefix, lowercased; "bot" if empty.
function ____exports.ShortHeroName(hero)
    local trimmed = string.lower(__TS__StringTrim(hero))
    local stem = (string.find(trimmed, HERO_PREFIX, nil, true) or 0) - 1 == 0 and __TS__StringSlice(trimmed, #HERO_PREFIX) or trimmed
    return #stem > 0 and stem or "bot"
end
local function Fold(state, value)
    return (state * HASH_BASE + value) % HASH_MOD
end
--- Hand-rolled deterministic hash: no regex, no locale, no time.
local function HashString(text, seed)
    local h = 7
    do
        local i = 0
        while i < #text do
            h = Fold(
                h,
                __TS__StringCharCodeAt(text, i)
            )
            i = i + 1
        end
    end
    local rest = math.floor(seed < 0 and -seed or seed)
    repeat
        do
            h = Fold(h, rest % 1000)
            rest = math.floor(rest / 1000)
        end
    until not (rest > 0)
    return h
end
local function Round2(value)
    local scaled = math.floor(value * 100 + 0.5) / 100
    if scaled < 0 then
        return 0
    end
    return scaled > 1 and 1 or scaled
end
local function Fraction(hash, salt)
    return Round2(HashString(salt, hash) % 1000 / 1000)
end
local function PickPhrases(archetype, start, count)
    local pool = PHRASES[archetype]
    local picked = {}
    do
        local i = 0
        while i < count and i < #pool do
            picked[#picked + 1] = pool[(start + i) % #pool + 1]
            i = i + 1
        end
    end
    return picked
end
--- Fully deterministic identity card from (hero, seed).
function ____exports.SeededIdentity(hero, seed)
    local stem = ____exports.ShortHeroName(hero)
    local archetypeHash = HashString(stem .. "|archetype", seed)
    local archetype = ARCHETYPES[archetypeHash % #ARCHETYPES + 1]
    local suffix = HANDLE_SUFFIXES[HashString(stem .. "|suffix", seed) % #HANDLE_SUFFIXES + 1]
    local count = HashString(stem .. "|count", seed) % 2 == 0 and 2 or 3
    local start = HashString(stem .. "|phrases", seed) % #PHRASES[archetype]
    return {
        handle = (stem .. "_") .. suffix,
        archetype = archetype,
        chattiness = Fraction(archetypeHash, "chattiness"),
        tilt = Fraction(archetypeHash, "tilt"),
        timingJitter = Fraction(archetypeHash, "timingJitter"),
        catchphrases = PickPhrases(archetype, start, count)
    }
end
local function IsArchetype(value)
    do
        local i = 0
        while i < #ARCHETYPES do
            if ARCHETYPES[i + 1] == value then
                return true
            end
            i = i + 1
        end
    end
    return false
end
local function IsFraction(value)
    return type(value) == "number" and value >= 0 and value <= 1
end
--- Shape check for a card that came back from serialized state.
function ____exports.ValidateIdentityCard(card)
    if card == nil or card == nil or type(card) ~= "table" then
        return false
    end
    if type(card.handle) ~= "string" or card.handle.length == 0 then
        return false
    end
    if not IsArchetype(card.archetype) then
        return false
    end
    if not IsFraction(card.chattiness) or not IsFraction(card.tilt) or not IsFraction(card.timingJitter) then
        return false
    end
    if not __TS__ArrayIsArray(card.catchphrases) then
        return false
    end
    if card.catchphrases.length < 2 or card.catchphrases.length > 3 then
        return false
    end
    do
        local i = 0
        while i < card.catchphrases.length do
            local phrase = card.catchphrases[i]
            if type(phrase) ~= "string" or #phrase == 0 then
                return false
            end
            i = i + 1
        end
    end
    return true
end
--- Chat dice weights and prompt tone for this card (§7.1).
function ____exports.ChatWeighting(card)
    return {
        chanceMultiplier = math.floor((0.5 + card.chattiness) * 10000 + 0.5) / 10000,
        cooldownMultiplier = math.floor((1.5 - 0.75 * card.chattiness) * 10000 + 0.5) / 10000,
        toneHint = card.archetype
    }
end
return ____exports
