--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
local RADIANT = 2
local DIRE = 3
local function LocaleCode()
    local ok, customize = pcall(
        require,
        GetScriptDirectory() .. "/FunLib/custom_loader"
    )
    if ok and type(customize) == "table" and type(customize.Localization) == "string" then
        return customize.Localization
    end
    return "en"
end
local function PicksForTeam(team)
    local picks = {}
    local count = PlayerResource:GetPlayerCount()
    do
        local pId = 0
        while pId < count do
            if PlayerResource:IsValidPlayerID(pId) and PlayerResource:GetTeam(pId) == team then
                local hero = GetSelectedHeroName(pId)
                if hero ~= "" then
                    picks[#picks + 1] = hero
                end
            end
            pId = pId + 1
        end
    end
    return picks
end
local function InventoryItems(bot)
    local items = {}
    do
        local i = 0
        while i <= 8 do
            local item = bot:GetItemInSlot(i)
            if item ~= nil then
                local ok, name = pcall(function() return item:GetName() end)
                if ok and type(name) == "string" then
                    items[#items + 1] = name
                end
            end
            i = i + 1
        end
    end
    return items
end
function ____exports.GatherDraft(facts)
    return {
        mode = "dota_mode_" .. tostring(GetGameMode()),
        gameTimeSec = GameTime(),
        locale = LocaleCode(),
        radiantPicks = PicksForTeam(RADIANT),
        direPicks = PicksForTeam(DIRE),
        bans = facts.bans ~= nil and facts.bans or ({}),
        slots = facts.slots ~= nil and facts.slots or ({}),
        candidates = facts.candidates
    }
end
function ____exports.GatherMatch(bot)
    local pId = bot:GetPlayerID()
    local team = PlayerResource:GetTeam(pId)
    local enemies = {}
    local count = PlayerResource:GetPlayerCount()
    do
        local eId = 0
        while eId < count do
            if eId ~= pId and PlayerResource:IsValidPlayerID(eId) and PlayerResource:GetTeam(eId) ~= team then
                local hero = GetSelectedHeroName(eId)
                if hero ~= "" then
                    enemies[#enemies + 1] = {
                        hero = hero,
                        level = PlayerResource:GetLevel(eId),
                        netWorth = PlayerResource:GetNetWorth(eId),
                        items = {}
                    }
                end
            end
            eId = eId + 1
        end
    end
    return {
        gameTimeSec = GameTime(),
        hero = bot:GetUnitName(),
        level = bot:GetLevel(),
        netWorth = PlayerResource:GetNetWorth(pId),
        gold = bot:GetGold(),
        kills = PlayerResource:GetKills(pId),
        deaths = PlayerResource:GetDeaths(pId),
        assists = PlayerResource:GetAssists(pId),
        items = InventoryItems(bot),
        enemies = enemies,
        towersRadiant = -1,
        towersDire = -1
    }
end
return ____exports
