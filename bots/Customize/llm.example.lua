--[[
    LLM advisor configuration template (RFC-001).

    To use: copy this file to
        <Steam>/steamapps/common/dota 2 beta/game/dota/scripts/vscripts/game/Customize/llm.lua
    and edit it there. The game/Customize folder is permanent: it is never overwritten
    by workshop updates and is never committed to git, so your API key stays private.

    Get a Groq API key at https://console.groq.com (free tier is enough).
    Keyless offline option: run Ollama locally and use the localhost Endpoint below.
]]

return {
    -- Master switch for this file. The bot script ALSO requires Customize.Allow_LLM_Advisor = true
    -- in general.lua (or your permanent copy under game/Customize/general.lua).
    Enable = true,

    -- Groq (default provider, OpenAI-compatible API).
    -- Local keyless option (Ollama): "http://127.0.0.1:11434/v1/chat/completions"
    Endpoint = "https://api.groq.com/openai/v1/chat/completions",

    -- Any OpenAI-compatible model id. Verify the current Qwen id at https://console.groq.com/docs
    Model = "qwen/qwen3.8-27b",

    -- Your Groq API key. Leave empty ("") for local endpoints such as Ollama.
    APIKey = "",

    -- Hard timeout per request; on timeout the bots fall back to default behavior.
    TimeoutMs = 8000,

    -- Max requests in flight (keep at 1; the game side is single-threaded).
    MaxConcurrent = 1,

    -- Per-game call budgets, split so chat can never starve draft/build calls.
    MaxCalls = { policy = 12, chat = 30 },

    -- Phase toggles: which LLM-driven capabilities are active.
    Phases = {
        draft = true,   -- counter-picks/bans during hero selection
        builds = true,  -- adaptive item/skill builds
        desire = false, -- (Phase 2, not yet implemented) macro strategy bias
        chat = true,    -- human-like trash talk via Groq persona
    },
}
