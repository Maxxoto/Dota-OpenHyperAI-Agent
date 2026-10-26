--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
--- Tier table. Herald is late and sloppy, guardian sits in the middle, legend
-- reacts near current-bot speed but still misses a little (RFC-003 §9.2:
-- herald p50 420 ms / p90 700 ms, guardian 340 / 560, legend 270 / 420).
-- Every magnitude pair is ordered herald > guardian > legend.
function ____exports.ProfileFor(tier)
    if tier == "herald" then
        return {
            tier = "herald",
            reactionLatencySec = {0.6, 1.2},
            lastHitJitterSec = {0.25, 0.45},
            rotationDelaySec = {1.2, 2.4},
            tradeWindowChance = 0.35,
            mistakeChance = 0.1
        }
    end
    if tier == "legend" then
        return {
            tier = "legend",
            reactionLatencySec = {0.15, 0.35},
            lastHitJitterSec = {0.04, 0.14},
            rotationDelaySec = {0.2, 0.6},
            tradeWindowChance = 0.8,
            mistakeChance = 0.02
        }
    end
    return {
        tier = "guardian",
        reactionLatencySec = {0.34, 0.56},
        lastHitJitterSec = {0.12, 0.28},
        rotationDelaySec = {0.6, 1.4},
        tradeWindowChance = 0.55,
        mistakeChance = 0.05
    }
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
local function PairFor(profile, kind)
    if kind == "reaction" then
        return profile.reactionLatencySec
    end
    if kind == "lastHit" then
        return profile.lastHitJitterSec
    end
    return profile.rotationDelaySec
end
--- Deterministic linear interpolation inside the tier's pair: roll01 0 returns
-- the low bound, 1 the high bound, and the result is clamped to the pair so a
-- stray roll can never stretch a latency outside its design band.
function ____exports.SampleLatency(profile, kind, roll01)
    local pair = PairFor(profile, kind)
    local low = pair[1]
    local high = pair[2]
    return low + (high - low) * Clamp01(roll01)
end
function ____exports.RollEvent(profile, roll01)
    if Clamp01(roll01) < profile.mistakeChance then
        return "mistake"
    end
    return "normal"
end
function ____exports.HumanizeEnabled(flag)
    return flag == true
end
return ____exports
