-- Fork: answer !oha and !llm in the ADDON VM.
--
-- Why here and not only in the bot-script VM:
--   * the bot-script VM's InstallChatCallback reply path depends on a bot hero
--     existing (ActionImmediate_Chat) and on GameRules, which the bot VM lacks;
--   * the addon VM receives the same player_chat event and owns
--     GameRules:SendCustomMessage, the channel the fork's other notices use.
--
-- The bot-VM handlers stay in place; this is the reply path that works from the
-- lobby and hero selection onward, for every phase, with no bot hero required.
--
-- Event payload (same as FretBots' Settings:GetChatEventData):
--   event.playerid, event.text, event.teamonly

local MODULE = {}

local RealPrint = print
local BUILD = "2026-10-27-f"

local GOLD = "#FFD700"

local function Msg(sText)
	pcall(RealPrint, sText)
	pcall(function()
		GameRules:SendCustomMessage("<font color='" .. GOLD .. "'>" .. sText .. "</font>", 0, 0)
	end)
end

local function LoadConfig()
	local ok, cfg = pcall(require, "game/Customize/llm")
	if ok and type(cfg) == "table" then return cfg, "game/Customize/llm.lua" end
	ok, cfg = pcall(require, "bots/Customize/llm")
	if ok and type(cfg) == "table" then return cfg, "bots/Customize/llm.lua" end
	return nil, "llm.lua not found"
end

local function ConfigSummary()
	local cfg, where = LoadConfig()
	if cfg == nil then
		where = "defaults (no Customize/llm.lua)"
	end
	local okLoader, loader = pcall(require, "bots/FunLib/llm_config")
	if okLoader and type(loader) == "table" and type(loader.GetLlmConfig) == "function" then
		local okEffective, effective = pcall(loader.GetLlmConfig)
		if okEffective and type(effective) == "table" then
			cfg = effective
		end
	end
	if cfg == nil then
		return "config unavailable"
	end
	local key = cfg.APIKey
	local keyState
	if type(key) == "string" and #key > 8 and key ~= "PASTE_KEY_HERE" then
		keyState = "key=" .. tostring(#key) .. "chars"
	else
		keyState = "key=MISSING"
	end
	local phases = cfg.Phases or {}
	local master = false
	local okGeneral, customize = pcall(require, "game/Customize/general")
	if okGeneral and type(customize) == "table" and customize.Allow_LLM_Advisor == true then
		master = true
	end
	return (where or "defaults") .. " master=" .. tostring(master)
		.. " Enable=" .. tostring(cfg.Enable ~= false)
		.. " " .. keyState
		.. " model=" .. tostring(cfg.Model)
		.. " draft=" .. tostring(phases.draft ~= false)
		.. " builds=" .. tostring(phases.builds ~= false)
		.. " desire=" .. tostring(phases.desire ~= false)
		.. " chat=" .. tostring(phases.chat ~= false)
end

function MODULE.OnPlayerChat(event)
	if type(event) ~= "table" then return end
	local text = event.text
	if type(text) ~= "string" or string.sub(text, 1, 1) ~= "!" then return end
	local low = string.lower(text)

	if string.find(low, "!oha", 1, true) then
		local state = "?"
		pcall(function() state = tostring(GameRules:State_Get()) end)
		Msg("[OHA] alive build=" .. BUILD .. " vm=addon state=" .. state)
		return
	end
	if string.find(low, "!llm", 1, true) then
		Msg("[OHA-LLM] build=" .. BUILD .. " " .. ConfigSummary())
		return
	end
end

local registered = false

function MODULE.Register()
	if registered then
		return true
	end
	if ListenToGameEvent == nil then
		pcall(RealPrint, "[OHA] addon chat listener unavailable (no ListenToGameEvent)")
		return false
	end
	registered = true
	ListenToGameEvent("player_chat", function(event) pcall(MODULE.OnPlayerChat, event) end, nil)
	Msg("[OHA] addon chat listener ready build=" .. BUILD .. " (!oha, !llm)")
	return true
end

pcall(MODULE.Register)

return MODULE
