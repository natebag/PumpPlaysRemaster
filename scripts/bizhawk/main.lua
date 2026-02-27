-- =============================================
-- PUMP PLAYS REMASTER - BizHawk Lua Script
-- Polls Node.js backend for commands via HTTP
-- Executes inputs via joypad.set()
-- =============================================

local SERVER_URL = "http://localhost:4000"
local POLL_INTERVAL = 5       -- poll every N frames (~12 polls/sec at 60fps)
local HOLD_DEFAULT = 30       -- default hold duration in frames (0.5 sec)

-- Load memory reader module (optional, for game state reporting)
-- debug.getinfo source may vary depending on how BizHawk loads the script
local scriptSource = debug.getinfo(1, "S").source or ""
local scriptDir = scriptSource:match("@?(.*[\\/])")
if not scriptDir or scriptDir == "" then
    -- When loaded via --lua= arg, source may lack path info.
    -- Try the full absolute path from the --lua argument.
    scriptDir = scriptSource:match("@?(.+)main%.lua$")
    if not scriptDir or scriptDir == "" then
        -- Last resort: hardcoded project path
        scriptDir = "F:\\coding\\PUMPPLAYSREMASTER\\scripts\\bizhawk\\"
    end
end
local memReader = dofile(scriptDir .. "memory-reader.lua")

-- State tracking
local lastAckId = 0
local frameCount = 0
local activeHolds = {}        -- { button = framesRemaining }
local connected = false

-- Simple JSON parsing (BizHawk Lua doesn't have json library)
-- Handles the specific format we send: [{id:N, command:{type,button,duration,raw}}]
local function parseCommands(text)
    local commands = {}
    if not text or text == "" or text == "[]" then return commands end

    -- Match each command object in the array
    for obj in text:gmatch("{(.-)}") do
        local cmd = {}
        cmd.id = tonumber(obj:match('"id"%s*:%s*(%d+)'))

        -- Parse nested command object
        local cmdStr = obj:match('"command"%s*:%s*{(.-)}')
        if cmdStr then
            cmd.type = cmdStr:match('"type"%s*:%s*"(.-)"')
            cmd.button = cmdStr:match('"button"%s*:%s*"(.-)"')
            cmd.raw = cmdStr:match('"raw"%s*:%s*"(.-)"')
            local dur = cmdStr:match('"duration"%s*:%s*(%d+)')
            cmd.duration = dur and tonumber(dur) or nil
        else
            -- Flat command format: command is a string
            cmd.raw = obj:match('"command"%s*:%s*"(.-)"')
            cmd.type = "press"
            cmd.button = cmd.raw
        end

        if cmd.id and cmd.button then
            table.insert(commands, cmd)
        end
    end
    return commands
end

-- GBA button mapping (BizHawk joypad names)
local BUTTON_MAP = {
    a = "A", b = "B", l = "L", r = "R",
    start = "Start", select = "Select",
    up = "Up", down = "Down", left = "Left", right = "Right"
}

local function executeCommand(cmd)
    local bizButton = BUTTON_MAP[cmd.button]
    if not bizButton then
        console.log("Unknown button: " .. tostring(cmd.button))
        return
    end

    if cmd.type == "hold" then
        -- Convert ms to frames (60fps)
        local durationMs = cmd.duration or 1500
        local frames = math.max(6, math.floor(durationMs / 16.67))
        activeHolds[bizButton] = frames
        console.log("HOLD " .. bizButton .. " for " .. frames .. " frames")
    else
        -- Standard press: hold for ~8 frames (~133ms)
        activeHolds[bizButton] = 8
        console.log("PRESS " .. bizButton)
    end
end

local function pollServer()
    local url = SERVER_URL .. "/api/emulator/pending?after=" .. lastAckId
    local response = comm.httpGet(url)

    if not response or response == "" then
        if connected then
            console.log("[PPR] Lost connection to server")
            connected = false
        end
        return
    end

    if not connected then
        console.log("[PPR] Connected to server!")
        connected = true
    end

    local commands = parseCommands(response)
    if #commands == 0 then return end

    local maxId = lastAckId
    for _, cmd in ipairs(commands) do
        executeCommand(cmd)
        if cmd.id > maxId then maxId = cmd.id end
    end

    -- ACK the commands
    if maxId > lastAckId then
        lastAckId = maxId
        local ackUrl = SERVER_URL .. "/api/emulator/ack"
        comm.httpPost(ackUrl, '{"last_id":' .. maxId .. '}')
    end
end

-- Check if server wants us to save state (before game switch)
local function checkSaveState()
    local ok, response = pcall(function()
        return comm.httpGet(SERVER_URL .. "/api/emulator/savestate")
    end)
    if not ok or not response or response == "" then return end

    local wantsSave = response:match('"save"%s*:%s*true')
    if not wantsSave then return end

    local savePath = response:match('"path"%s*:%s*"(.-)"')
    if not savePath then return end

    -- Unescape backslashes from JSON
    savePath = savePath:gsub("\\\\", "\\")

    console.log("[PPR] Saving state: " .. savePath)
    savestate.save(savePath)
    console.log("[PPR] State saved!")

    -- Tell server save is done
    pcall(function()
        comm.httpPost(SERVER_URL .. "/api/emulator/savestate/done", "{}")
    end)
end

local function processHolds()
    local buttons = {}
    local anyActive = false

    for button, frames in pairs(activeHolds) do
        if frames > 0 then
            buttons[button] = true
            activeHolds[button] = frames - 1
            anyActive = true
        else
            activeHolds[button] = nil
        end
    end

    if anyActive then
        joypad.set(buttons)
    end
end

-- =============================================
-- GAME DETECTION
-- =============================================
-- Try to detect the active game from the server config
local function detectGame()
    local ok, response = pcall(function()
        return comm.httpGet(SERVER_URL .. "/api/status")
    end)
    if ok and response and response ~= "" then
        local gameId = response:match('"id"%s*:%s*"(.-)"')
        if gameId then
            memReader.setGame(gameId)
            return gameId
        end
    end
    -- Fallback: try to detect from ROM name
    local romName = gameinfo.getromname()
    if romName then
        local lower = romName:lower()
        if lower:find("firered") then memReader.setGame("pokemon-firered")
        elseif lower:find("emerald") then memReader.setGame("pokemon-emerald")
        elseif lower:find("red") then memReader.setGame("pokemon-red")
        end
    end
end

-- =============================================
-- MAIN LOOP
-- =============================================
console.log("===========================================")
console.log("  PUMP PLAYS REMASTER - BizHawk Script")
console.log("  Polling: " .. SERVER_URL)
console.log("===========================================")

-- Initial game detection (will retry if server isn't ready)
local gameDetected = false

while true do
    frameCount = frameCount + 1

    -- Poll server for new commands periodically
    if frameCount % POLL_INTERVAL == 0 then
        local ok, err = pcall(pollServer)
        if not ok then
            -- HTTP errors are expected when server isn't running
            if frameCount % 300 == 0 then
                console.log("[PPR] Waiting for server... (" .. tostring(err) .. ")")
            end
        elseif not gameDetected then
            -- Try to detect game once connected
            pcall(detectGame)
            gameDetected = true
        end
    end

    -- Check for save state requests (less frequent - every 30 frames / 2x per sec)
    if frameCount % 30 == 0 then
        pcall(checkSaveState)
    end

    -- Process active button holds every frame
    processHolds()

    -- Read and report game state (handled internally at its own interval)
    memReader.tick()

    emu.frameadvance()
end
