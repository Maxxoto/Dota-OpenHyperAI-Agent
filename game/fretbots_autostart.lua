-- Fork: start FretBots mode once hero selection begins.
--
-- FretBots is an ADDON-VM script: it reads GameRules and registers
-- ListenToGameEvent listeners, neither of which exists in the bot-script VM
-- (see the Lua Bots API global list). That is why upstream loads it from the
-- server console (script_reload_code bots/fretbots) - this module automates
-- the same load from game/gameinit.lua.
--
-- Opt out with Customize.Enable_FretBots_By_Default = false in
-- game/Customize/general.lua (or bots/Customize/general.lua).

local MODULE = {}

local RealPrint = print
local started = false
local tries = 0
local MAX_TRIES = 5

-- Console (captured print survives FretBots' override) plus the message feed,
-- so the status is visible even when console output is unavailable.
local function Log(msg)
	pcall(RealPrint, msg)
	pcall(MsgN, msg)
	pcall(function()
		if Utilities ~= nil and Utilities.Print ~= nil then
			Utilities:Print(msg)
		elseif GameRules ~= nil and GameRules.SendCustomMessage ~= nil then
			GameRules:SendCustomMessage(msg, 0, 0)
		end
	end)
end

local function Enabled()
	local ok, cfg = pcall(require, "game/Customize/general")
	if ok and type(cfg) == "table" and cfg.Enable_FretBots_By_Default == false then
		return false
	end
	return true
end

function MODULE.Try()
	if started then return end
	if not Enabled() then
		started = true
		Log("[OHA] FretBots auto-start disabled by Customize.Enable_FretBots_By_Default = false")
		return
	end
	if GameRules == nil or GameRules:State_Get() < DOTA_GAMERULES_STATE_HERO_SELECTION then
		return
	end
	tries = tries + 1
	Log("[OHA] FretBots addon-VM load attempt " .. tries .. "/" .. MAX_TRIES)
	local ok, err = pcall(require, "bots/FretBots")
	if ok and Debug ~= nil then
		started = true
		Log("[OHA] FretBots mode initialized (addon VM)")
		-- Verify the vote pipeline actually came up; the difficulty vote only
		-- opens from Settings' timers, so report each pillar visibly.
		pcall(function()
			local hasSettings = type(Settings) == "table"
			local hasTimers = type(Timers) == "table"
			local ticking = hasTimers and type(Timers.timers) == "table"
			Log("[OHA] FretBots verify: Settings=" .. tostring(hasSettings)
				.. " Timers=" .. tostring(hasTimers) .. " ticking=" .. tostring(ticking))
			if hasTimers and not ticking then
				Timers:start()
				Log("[OHA] FretBots timer engine started explicitly")
			end
		end)
		return
	end
	package.loaded["bots/FretBots"] = nil
	package.loaded["bots.FretBots"] = nil
	if not ok then
		started = true
		Log("[OHA] FretBots auto-start failed: " .. tostring(err)
			.. " | fallback: sv_cheats 1; script_reload_code bots/fretbots")
	elseif tries >= MAX_TRIES then
		started = true
		Log("[OHA] FretBots did not initialize after " .. MAX_TRIES
			.. " tries | fallback: sv_cheats 1; script_reload_code bots/fretbots")
	end
end

-- The state event fires on every game-rule transition; Try() is a no-op until
-- hero selection. One immediate call covers a late module load.
if ListenToGameEvent ~= nil then
	ListenToGameEvent("game_rules_state_change", function() MODULE.Try() end, nil)
end
pcall(MODULE.Try)

return MODULE
