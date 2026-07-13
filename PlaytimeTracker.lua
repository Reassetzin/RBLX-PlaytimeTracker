-- PlaytimeTracker.lua — Place in ServerScriptService
local Players          = game:GetService("Players")
local HttpService      = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")

-- Game is identified automatically by Place ID — rename it on the dashboard
local GAME_NAME  = tostring(game.PlaceId)
local BASE_URL   = "https://rblx-playtimetracker-production.up.railway.app"
local JOIN_URL   = BASE_URL .. "/player-joined"
local LEAVE_URL  = BASE_URL .. "/session-end"

-- V2 DataStore: stores {totalTime, sessionCount}
local PlaytimeStore     = DataStoreService:GetDataStore("PlayerPlaytime_v2")
local sessionStartTimes = {}

local function getPlayerData(userId)
	local ok, result = pcall(function()
		return PlaytimeStore:GetAsync(tostring(userId))
	end)
	if ok and type(result) == "table" then return result end
	return { totalTime = 0, sessionCount = 0 }
end

local function savePlayerData(userId, data)
	local ok, err = pcall(function()
		PlaytimeStore:SetAsync(tostring(userId), data)
	end)
	if not ok then warn("[PlaytimeTracker] Save failed:", err) end
end

local function post(url, payload)
	pcall(function()
		HttpService:PostAsync(url, HttpService:JSONEncode(payload), Enum.HttpContentType.ApplicationJson)
	end)
end

local function handlePlayerLeave(player)
	local userId    = player.UserId
	local startTime = sessionStartTimes[userId]
	if not startTime then return end

	local sessionSeconds  = math.max(0, os.time() - startTime)
	sessionStartTimes[userId] = nil

	local data = getPlayerData(userId)
	data.totalTime    = (data.totalTime    or 0) + sessionSeconds
	data.sessionCount = (data.sessionCount or 0) + 1

	savePlayerData(userId, data)
	post(LEAVE_URL, {
		username     = player.Name,
		userId       = player.UserId,
		gameName     = GAME_NAME,
		sessionTime  = sessionSeconds,
		totalTime    = data.totalTime,
		sessionCount = data.sessionCount,
	})
end

Players.PlayerAdded:Connect(function(player)
	sessionStartTimes[player.UserId] = os.time()
	print("[PlaytimeTracker] Tracking:", player.Name)

	-- Notify dashboard that player is now live
	post(JOIN_URL, {
		username = player.Name,
		userId   = player.UserId,
		gameName = GAME_NAME,
	})
end)

Players.PlayerRemoving:Connect(handlePlayerLeave)

game:BindToClose(function()
	for _, player in ipairs(Players:GetPlayers()) do
		handlePlayerLeave(player)
	end
	task.wait(2)
end)
