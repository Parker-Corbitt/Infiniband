const PALETTE = {
  backgroundTop: "#14212d",
  backgroundBottom: "#060c14",
  accent: "#70f2e1",
  accentGlow: "#b7fff8",
  ground: "#223744",
  groundTrim: "#c9f6f2",
  band: "#ffbe68",
  skyline: "#2b4759",
  haze: "rgba(128, 214, 230, 0.18)"
};

const DISCONNECTED_BINS = [0.3, 0.42, 0.56, 0.48, 0.38, 0.34, 0.28, 0.2];
const SPOTIFY_CLIENT_ID = "1f8c8329e2c5447fa36a301307b49d59";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function nearestIndex(time, starts) {
  if (!starts.length) {
    return 0;
  }

  let lower = 0;
  let upper = starts.length - 1;
  let best = 0;

  while (lower <= upper) {
    const middle = (lower + upper) >> 1;
    if (starts[middle] <= time) {
      best = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  return best;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function disconnectedSnapshot(status, songsCleared) {
  let title = "Open Spotify";
  let artist = "Launch Spotify and start a track.";
  let source = "Spotify not connected";

  if (status === "stopped") {
    title = "Start Playback";
    artist = "Choose a track in Spotify to drive the run.";
    source = "Spotify open but stopped";
  } else if (status === "auth_required") {
    title = "Connect Spotify";
    artist = "Set Client ID, authorize, and ensure an active device.";
    source = "Spotify OAuth required";
  } else if (status === "api_error") {
    title = "Spotify Bridge Error";
    artist = "Spotify API request failed.";
    source = "Spotify API error";
  }

  return {
    trackKey: "offline",
    title,
    artist,
    tempo: 118,
    intensity: 0.34,
    pulse: 0.48,
    bins: DISCONNECTED_BINS.slice(),
    isPlaying: false,
    source,
    songsCleared
  };
}

function spotifyDerived(playback, analysis, position, songsCleared) {
  if (!analysis?.segments?.length) {
    return syntheticSnapshot(playback, position, songsCleared, true);
  }

  const trackDuration = Math.max(analysis.track?.duration ?? playback.duration ?? 0.1, 0.1);
  const clampedPosition = clamp(position, 0, trackDuration);
  const segmentStarts = analysis.segments.map((segment) => segment.start);
  const beatStarts = analysis.beats.map((beat) => beat.start);

  const segmentIndex = nearestIndex(clampedPosition, segmentStarts);
  const beatIndex = nearestIndex(clampedPosition, beatStarts);
  const segment = analysis.segments[clamp(segmentIndex, 0, analysis.segments.length - 1)];
  const beat = analysis.beats.length
    ? analysis.beats[clamp(beatIndex, 0, analysis.beats.length - 1)]
    : null;

  const rawBins = collapsedPitches(segment.pitches);
  const timbreBoost = normalizedTimbre(segment.timbre);
  let bins = rawBins.map((value, index) => clamp(value * 0.72 + timbreBoost[index] * 0.28, 0.05, 1));
  const maxBin = Math.max(...bins, 1);
  if (maxBin > 0) {
    bins = bins.map((value) => value / maxBin);
  }

  let beatPhase = 0.5;
  if (beat && beat.duration > 0.01) {
    beatPhase = (clampedPosition - beat.start) / beat.duration;
  }

  const beatPulse = 1 - Math.min(Math.abs(beatPhase - 0.1) / 0.4, 1);
  const loudness = ((segment.loudness_max ?? -26) + 60) / 60;
  const brightness = average(bins.slice(-3));
  const density = average(bins);
  const intensity = clamp(loudness * 0.4 + brightness * 0.32 + density * 0.28, 0.12, 0.98);

  return {
    trackKey: playback.trackID || playback.uri,
    title: playback.title,
    artist: playback.artist,
    tempo: analysis.track?.tempo ?? 118,
    intensity,
    pulse: clamp(0.42 + beatPulse * 0.48 + intensity * 0.1, 0.22, 1),
    bins,
    isPlaying: playback.isPlaying,
    source: "Spotify audio analysis",
    songsCleared
  };
}

function syntheticSnapshot(playback, position, songsCleared, usingSpotifyMetadataOnly) {
  const seedSource = `${playback.trackID || playback.uri}${playback.title}${playback.artist}`;
  const seed = hashString(seedSource);
  const baseTempo = 96 + (seed % 64);
  const normalizedPosition = position / Math.max(playback.duration, 1);
  const sweep = normalizedPosition * Math.PI * 6;

  const bins = [];
  for (let index = 0; index < 8; index += 1) {
    const harmonic = Math.sin(sweep * (index + 1) * 0.32 + ((seed >> index) & 7));
    const subharmonic = Math.cos(position * (0.55 + index * 0.11));
    const stableBias = ((seed >> (index + 3)) & 15) / 24;
    bins.push(clamp(0.34 + harmonic * 0.22 + subharmonic * 0.16 + stableBias, 0.08, 1));
  }

  const intensity = clamp(average(bins) * 0.58 + average(bins.slice(-3)) * 0.42, 0.18, 0.9);
  const pulse = clamp((0.46 + Math.sin(position * baseTempo / 120) * 0.2) + intensity * 0.18, 0.2, 0.96);

  return {
    trackKey: playback.trackID || playback.uri,
    title: playback.title,
    artist: playback.artist,
    tempo: baseTempo,
    intensity,
    pulse,
    bins,
    isPlaying: playback.isPlaying,
    source: usingSpotifyMetadataOnly ? "Metadata fallback" : "No audio-analysis fallback",
    songsCleared
  };
}

function collapsedPitches(pitches) {
  if (!Array.isArray(pitches) || !pitches.length) {
    return Array(8).fill(0.2);
  }

  const buckets = Array(8).fill(0);
  const counts = Array(8).fill(0);

  for (let index = 0; index < pitches.length; index += 1) {
    const bucket = Math.min(7, Math.floor(index * 8 / Math.max(pitches.length, 1)));
    buckets[bucket] += pitches[index];
    counts[bucket] += 1;
  }

  return buckets.map((total, index) => total / Math.max(counts[index], 1));
}

function normalizedTimbre(timbre) {
  if (!Array.isArray(timbre) || !timbre.length) {
    return Array(8).fill(0.2);
  }

  return Array.from({ length: 8 }, (_, index) => {
    const source = timbre[Math.min(index, timbre.length - 1)];
    return clamp(Math.abs(source) / 180, 0.04, 1);
  });
}

class SpotifyWebBridge {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.verifierKey = "infiniband.spotify.code_verifier";
    this.tokenKey = "infiniband.spotify.tokens";
    this.skipAutoConnectKey = "infiniband.spotify.skip_auto_connect";
    this.hardcodedClientId = (window.__INFINIBAND_SPOTIFY_CLIENT_ID__ || SPOTIFY_CLIENT_ID || "").trim();
    this.scopes = [
      "user-read-playback-state",
      "user-read-currently-playing",
      "user-modify-playback-state"
    ];
    this.token = this.readToken();
  }

  get clientId() {
    return this.hardcodedClientId;
  }

  clearSession() {
    this.token = null;
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.verifierKey);
    sessionStorage.setItem(this.skipAutoConnectKey, "1");
  }

  isConnected() {
    return Boolean(this.token?.accessToken);
  }

  async bootstrapFromRedirect() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      sessionStorage.setItem(this.skipAutoConnectKey, "1");
      this.onStatus(`Spotify authorize error: ${error}`);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search);
      return;
    }

    if (!code) {
      return;
    }

    const clientId = this.clientId;
    const verifier = localStorage.getItem(this.verifierKey) || "";
    if (!clientId || !verifier) {
      this.onStatus("Missing PKCE verifier or client ID. Reconnect Spotify.");
      return;
    }

    try {
      const token = await this.fetchToken({
        grantType: "authorization_code",
        clientId,
        code,
        verifier,
        redirectUri: this.redirectUri()
      });
      this.storeToken(token);
      this.onStatus("Spotify connected.");
    } catch (errorObj) {
      this.onStatus(`Token exchange failed: ${String(errorObj)}`);
    } finally {
      url.searchParams.delete("code");
      window.history.replaceState({}, "", url.pathname + url.search);
      localStorage.removeItem(this.verifierKey);
    }
  }

  async connectInteractive() {
    sessionStorage.removeItem(this.skipAutoConnectKey);
    const clientId = this.clientId;
    if (!clientId) {
      throw new Error("Missing Spotify Client ID. Set SPOTIFY_CLIENT_ID in web/app.js.");
    }

    const verifier = this.randomString(64);
    const challenge = await this.createPkceChallenge(verifier);
    localStorage.setItem(this.verifierKey, verifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: this.scopes.join(" "),
      code_challenge_method: "S256",
      code_challenge: challenge,
      redirect_uri: this.redirectUri()
    });

    window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
  }

  async playbackStatus() {
    const token = await this.ensureToken();
    if (!token) {
      return { kind: "auth_required" };
    }

    const response = await this.apiRequest("GET", "/me/player");
    if (response.status === 401) {
      this.clearSession();
      return { kind: "auth_required" };
    }

    if (response.status === 204) {
      return { kind: "not_running" };
    }

    if (response.status < 200 || response.status >= 300 || !response.data) {
      return { kind: "api_error" };
    }

    const data = response.data;
    if (!data.item) {
      return { kind: "stopped" };
    }

    const track = data.item;
    const artists = Array.isArray(track.artists)
      ? track.artists.map((artist) => artist.name).filter(Boolean).join(", ")
      : "Unknown Artist";

    return {
      kind: "playback",
      snapshot: {
        trackID: track.id || null,
        uri: track.uri || "",
        title: track.name || "Unknown Track",
        artist: artists || "Unknown Artist",
        album: track.album?.name || "",
        duration: Math.max((track.duration_ms || 0) / 1000, 0),
        position: Math.max((data.progress_ms || 0) / 1000, 0),
        isPlaying: Boolean(data.is_playing)
      }
    };
  }

  async fetchAudioAnalysis(trackID) {
    const token = await this.ensureToken();
    if (!token) {
      return null;
    }

    const response = await this.apiRequest("GET", `/audio-analysis/${encodeURIComponent(trackID)}`);
    if (response.status < 200 || response.status >= 300 || !response.data) {
      return null;
    }

    return response.data;
  }

  async togglePlayback() {
    const token = await this.ensureToken();
    if (!token) {
      this.onStatus("Spotify not connected.");
      return;
    }

    const state = await this.apiRequest("GET", "/me/player");
    if (state.status === 204) {
      this.onStatus("No active Spotify device.");
      return;
    }

    if (state.status < 200 || state.status >= 300 || !state.data) {
      this.onStatus("Cannot read Spotify playback state.");
      return;
    }

    const shouldPause = Boolean(state.data.is_playing);
    const actionPath = shouldPause ? "/me/player/pause" : "/me/player/play";
    const actionResponse = await this.apiRequest("PUT", actionPath);

    if (actionResponse.status >= 200 && actionResponse.status < 300) {
      this.onStatus(shouldPause ? "Paused Spotify." : "Resumed Spotify.");
    } else {
      this.onStatus("Spotify rejected play/pause request (check Premium + active device).");
    }
  }

  async ensureToken() {
    if (!this.clientId) {
      return null;
    }

    if (this.token?.accessToken && this.token.expiresAt > Date.now() + 45_000) {
      return this.token.accessToken;
    }

    if (!this.token?.refreshToken) {
      return null;
    }

    try {
      const refreshed = await this.fetchToken({
        grantType: "refresh_token",
        clientId: this.clientId,
        refreshToken: this.token.refreshToken
      });
      this.storeToken({ ...refreshed, refresh_token: refreshed.refresh_token || this.token.refreshToken });
      return this.token.accessToken;
    } catch (errorObj) {
      this.clearSession();
      this.onStatus(`Spotify token refresh failed: ${String(errorObj)}`);
      return null;
    }
  }

  async apiRequest(method, path, body) {
    const token = this.token?.accessToken;
    if (!token) {
      return { status: 401, data: null };
    }

    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (response.status === 204) {
      return { status: 204, data: null };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { status: response.status, data };
  }

  async fetchToken({ grantType, clientId, code, verifier, refreshToken, redirectUri }) {
    const body = new URLSearchParams();
    body.set("grant_type", grantType);
    body.set("client_id", clientId);

    if (grantType === "authorization_code") {
      body.set("code", code);
      body.set("redirect_uri", redirectUri);
      body.set("code_verifier", verifier);
    } else {
      body.set("refresh_token", refreshToken);
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Token request failed");
    }

    return payload;
  }

  storeToken(tokenPayload) {
    const normalized = {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      expiresAt: Date.now() + ((tokenPayload.expires_in || 3600) * 1000)
    };
    this.token = normalized;
    localStorage.setItem(this.tokenKey, JSON.stringify(normalized));
    sessionStorage.removeItem(this.skipAutoConnectKey);
  }

  readToken() {
    const raw = localStorage.getItem(this.tokenKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed.accessToken || !parsed.expiresAt) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  redirectUri() {
    return `${window.location.origin}${window.location.pathname}`;
  }

  shouldAutoConnect() {
    return Boolean(this.clientId) && !this.isConnected() && !sessionStorage.getItem(this.skipAutoConnectKey);
  }

  randomString(length) {
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    const values = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < values.length; i += 1) {
      result += charset[values[i] % charset.length];
    }
    return result;
  }

  async createPkceChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}

class SpotifyMusicCoordinator {
  constructor(bridge) {
    this.bridge = bridge;
    this.playback = null;
    this.bridgeStatus = "not_running";
    this.playbackCaptureMs = Date.now();
    this.analysisCache = new Map();
    this.failedTrackIDs = new Set();
    this.songsCleared = 0;
    this.activeTrackID = null;
  }

  async refresh() {
    const refreshStart = Date.now();
    const status = await this.bridge.playbackStatus();
    this.bridgeStatus = status.kind;

    let latestPlayback = null;
    if (status.kind === "playback") {
      latestPlayback = this.stabilizedPlayback(status.snapshot, refreshStart);
    }

    this.playback = latestPlayback;
    this.playbackCaptureMs = Date.now();

    if (!latestPlayback) {
      this.activeTrackID = null;
      return;
    }

    if (this.activeTrackID !== latestPlayback.trackID) {
      if (this.activeTrackID !== null) {
        this.songsCleared += 1;
      }
      this.activeTrackID = latestPlayback.trackID;
    }

    const trackID = latestPlayback.trackID;
    if (!trackID) {
      return;
    }

    if (!this.analysisCache.has(trackID) && !this.failedTrackIDs.has(trackID)) {
      const analysis = await this.bridge.fetchAudioAnalysis(trackID);
      if (analysis) {
        this.analysisCache.set(trackID, analysis);
      } else {
        this.failedTrackIDs.add(trackID);
      }
    }
  }

  stabilizedPlayback(snapshot, capturedAtMs) {
    const previousPlayback = this.playback;
    if (!previousPlayback || !previousPlayback.isPlaying || !snapshot.isPlaying) {
      return snapshot;
    }

    const previousTrackKey = previousPlayback.trackID || previousPlayback.uri;
    const incomingTrackKey = snapshot.trackID || snapshot.uri;
    if (previousTrackKey !== incomingTrackKey) {
      return snapshot;
    }

    const elapsed = Math.max(0, (capturedAtMs - this.playbackCaptureMs) / 1000);
    const projected = Math.min(previousPlayback.position + elapsed, Math.max(snapshot.duration, previousPlayback.duration, 1));

    const backwardDriftAllowance = 1.5;
    if (snapshot.position + backwardDriftAllowance >= projected) {
      return snapshot;
    }

    return { ...snapshot, position: projected };
  }

  snapshot(nowMs = Date.now()) {
    if (!this.playback) {
      return disconnectedSnapshot(this.bridgeStatus, this.songsCleared);
    }

    const elapsed = this.playback.isPlaying ? Math.max(0, (nowMs - this.playbackCaptureMs) / 1000) : 0;
    const clampedDuration = Math.max(this.playback.duration, 1);
    const position = Math.min(this.playback.position + elapsed, clampedDuration);

    if (this.playback.trackID && this.analysisCache.has(this.playback.trackID)) {
      return spotifyDerived(this.playback, this.analysisCache.get(this.playback.trackID), position, this.songsCleared);
    }

    return syntheticSnapshot(this.playback, position, this.songsCleared, true);
  }

  async togglePlayback() {
    await this.bridge.togglePlayback();
  }
}

class InfinibandGame {
  constructor(canvas, hud, musicCoordinator) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hud = hud;
    this.musicCoordinator = musicCoordinator;

    this.spectrumBars = [];
    this.skylineNodes = [];
    this.surfaces = [];
    this.obstacles = [];

    this.currentMusic = disconnectedSnapshot("not_running", 0);
    this.isGameOver = false;
    this.lastUpdateMs = 0;
    this.playerPosition = { x: 0, y: 0 };
    this.verticalVelocity = 0;
    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.distanceTravelled = 0;
    this.worldSpeed = 340;
    this.nextChunkX = 0;
    this.lastFloorTopY = 0;
    this.lastTrackKey = "";

    this.jumpTimingSpeed = 1.2;
    this.baseGravity = 2500;
    this.shortJumpVelocity = 870;
    this.tallJumpVelocity = 1120;
    this.gravity = this.baseGravity * this.jumpTimingSpeed * this.jumpTimingSpeed;
    this.playerHalfWidth = 17;
    this.playerHalfHeight = 22;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;

    this.musicPollTimer = null;
    this.musicPollInFlight = false;
    this.rafId = null;

    this.setupSpectrumBars();
    this.resize();
    this.installInputHandlers();

    window.addEventListener("resize", () => {
      this.resize();
      this.layoutBackdrop();
      this.resetRun();
    });
  }

  get playerX() {
    return this.width * 0.24;
  }

  get groundTop() {
    return Math.max(this.height * 0.2, 124);
  }

  start() {
    this.layoutBackdrop();
    this.resetRun();
    this.startMusicPolling();
    this.tick(performance.now());
  }

  setupSpectrumBars() {
    for (let index = 0; index < 8; index += 1) {
      const bar = document.createElement("div");
      bar.className = "bar";
      this.hud.spectrumBars.appendChild(bar);
      this.spectrumBars.push(bar);
    }
  }

  installInputHandlers() {
    this.canvas.addEventListener("pointerdown", () => {
      this.triggerJump("short");
    });

    window.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.code === "KeyA") {
        event.preventDefault();
        this.triggerJump("short");
        return;
      }

      if (event.code === "KeyF" || event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        this.triggerJump("tall");
        return;
      }

      if (event.code === "KeyP") {
        this.musicCoordinator.togglePlayback();
        return;
      }

      if (event.code === "KeyR") {
        this.resetRun();
      }
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(rect.width, 320);
    this.height = Math.max(rect.height, 320);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  startMusicPolling() {
    if (this.musicPollTimer) {
      clearInterval(this.musicPollTimer);
    }

    const poll = async () => {
      if (this.musicPollInFlight) {
        return;
      }
      this.musicPollInFlight = true;
      try {
        await this.musicCoordinator.refresh();
      } finally {
        this.musicPollInFlight = false;
      }
    };

    poll();
    this.musicPollTimer = setInterval(poll, 1100);
  }

  tick(nowMs) {
    if (!this.lastUpdateMs) {
      this.lastUpdateMs = nowMs;
      this.rafId = requestAnimationFrame((nextMs) => this.tick(nextMs));
      return;
    }

    const deltaSeconds = clamp((nowMs - this.lastUpdateMs) / 1000, 1 / 240, 1 / 30);
    this.lastUpdateMs = nowMs;
    this.currentMusic = this.musicCoordinator.snapshot(nowMs);

    this.updateMusicState(deltaSeconds);
    this.updateWorld(deltaSeconds);
    this.updatePlayer(deltaSeconds);
    this.resolveCollisions();
    this.updateHud();
    this.render();

    this.rafId = requestAnimationFrame((nextMs) => this.tick(nextMs));
  }

  resetRun() {
    this.surfaces = [];
    this.obstacles = [];

    this.isGameOver = false;
    this.distanceTravelled = 0;
    this.worldSpeed = this.speedForTempo(this.currentMusic.tempo);
    this.nextChunkX = -80;
    this.playerPosition = { x: this.playerX, y: this.groundTop + this.playerHalfHeight + 14 };
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.coyoteTimer = 0;
    this.lastUpdateMs = 0;

    this.hud.gameOverLabel.style.opacity = "0";
    this.hud.gameOverLabel.textContent = "";

    this.generateOpeningPlatform();
    this.generateWorldIfNeeded();
    this.updateHud();
  }

  layoutBackdrop() {
    this.skylineNodes = [];
    const spacing = Math.max(this.width / 8, 100);
    for (let index = 0; index < 9; index += 1) {
      const width = spacing * 0.62;
      const height = this.groundTop + (46 + (index % 4) * 36);
      this.skylineNodes.push({
        x: index * spacing + width * 0.6,
        y: this.groundTop - 10,
        width,
        height
      });
    }
  }

  generateOpeningPlatform() {
    const introWidth = this.width * 0.88;
    const openingSurface = { x: -20, y: this.groundTop - 36, width: introWidth, height: 42 };
    this.addSurface(openingSurface);
    this.nextChunkX = introWidth - 20;
    this.lastFloorTopY = openingSurface.y + openingSurface.height;
  }

  addSurface(rect) {
    this.surfaces.push({ ...rect });
  }

  addObstacle(kind, center, size) {
    this.obstacles.push({
      kind,
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
      width: size.width,
      height: size.height
    });
  }

  generateWorldIfNeeded() {
    while (this.nextChunkX < this.width * 1.8) {
      this.spawnChunk(this.nextChunkX);
    }
  }

  spawnChunk(startX) {
    const bins = this.currentMusic.bins;
    const low = average(bins.slice(0, 3));
    const mid = average(bins.slice(2, 5));
    const high = average(bins.slice(-3));
    const difficulty = clamp(this.currentMusic.intensity * 0.7 + high * 0.3, 0.18, 0.96);

    const topY = this.groundTop + low * 8;
    const heightDelta = topY - this.lastFloorTopY;
    const desiredGapMax = 120 + difficulty * 48;
    const safeJumpGapMax = this.maxReachableGap(heightDelta);
    const gapUpperBound = clamp(Math.min(desiredGapMax, safeJumpGapMax), 52, 168);
    const gapWidth = randomInRange(52, gapUpperBound);
    const segmentWidth = randomInRange(190, 340) - difficulty * 62;
    const height = 42 + low * 8;

    const floorRect = {
      x: startX + gapWidth,
      y: topY - height,
      width: Math.max(segmentWidth, 128),
      height
    };

    this.addSurface(floorRect);

    const obstacleDensity = Math.round(difficulty * 2.6 + high * 1.4);
    if (obstacleDensity > 0) {
      this.spawnObstacles(floorRect, obstacleDensity, high, mid);
    }

    if (difficulty > 0.44 && mid > 0.34 && Math.random() > 0.5) {
      const platformWidth = randomInRange(110, 170);
      const platformY = topY + randomInRange(82, 124);
      const platformX = floorRect.x + randomInRange(36, Math.max(floorRect.width - platformWidth - 36, 48));
      const platformRect = { x: platformX, y: platformY, width: platformWidth, height: 26 };
      this.addSurface(platformRect);

      if (high > 0.5 && Math.random() > 0.5) {
        const blockWidth = 26;
        const blockHeight = 38;
        this.addObstacle(
          "block",
          { x: platformRect.x + platformRect.width - 28, y: platformRect.y + platformRect.height + blockHeight / 2 },
          { width: blockWidth, height: blockHeight }
        );
      }
    }

    this.nextChunkX = floorRect.x + floorRect.width;
    this.lastFloorTopY = floorRect.y + floorRect.height;
  }

  spawnObstacles(surfaceRect, density, highEnergy, midEnergy) {
    if (surfaceRect.width <= 100) {
      return;
    }

    const landingClearWidth = 78;
    const takeoffClearWidth = 62;
    const placementStart = surfaceRect.x + landingClearWidth;
    const placementEnd = surfaceRect.x + surfaceRect.width - takeoffClearWidth;
    const usableWidth = placementEnd - placementStart;
    if (usableWidth < 56) {
      return;
    }

    const maxBlockWidth = 22 + midEnergy * 18;
    const maxSpikeWidth = 24 + highEnergy * 18;
    const maxObstacleWidth = Math.max(maxBlockWidth, maxSpikeWidth);
    const minHorizontalGap = 16;
    const maxCount = Math.floor((usableWidth + minHorizontalGap) / (maxObstacleWidth + minHorizontalGap));
    const obstacleCount = Math.min(density, Math.max(0, maxCount));
    if (obstacleCount <= 0) {
      return;
    }

    const slotWidth = usableWidth / obstacleCount;
    const slotJitter = Math.min(8, slotWidth * 0.16);
    const maxWidthForSlot = Math.max(16, slotWidth - minHorizontalGap);

    for (let index = 0; index < obstacleCount; index += 1) {
      const slotCenter = placementStart + slotWidth * (index + 0.5);
      const centerX = slotCenter + randomInRange(-slotJitter, slotJitter);
      if (highEnergy > 0.45 && Math.random() > 0.5) {
        const spikeHeight = 22 + highEnergy * 26;
        const spikeWidth = Math.min(24 + highEnergy * 18, maxWidthForSlot);
        this.addObstacle(
          "spike",
          { x: centerX, y: surfaceRect.y + surfaceRect.height + spikeHeight / 2 - 2 },
          { width: spikeWidth, height: spikeHeight }
        );
      } else {
        const blockHeight = 28 + midEnergy * 28;
        const blockWidth = Math.min(22 + midEnergy * 18, maxWidthForSlot);
        this.addObstacle(
          "block",
          { x: centerX, y: surfaceRect.y + surfaceRect.height + blockHeight / 2 },
          { width: blockWidth, height: blockHeight }
        );
      }
    }
  }

  updateMusicState(deltaTime) {
    const targetSpeed = this.speedForTempo(this.currentMusic.tempo);
    this.worldSpeed += (targetSpeed - this.worldSpeed) * Math.min(1, deltaTime * 2.6);

    if (this.currentMusic.trackKey !== this.lastTrackKey) {
      this.lastTrackKey = this.currentMusic.trackKey;
      this.hud.subtitleLabel.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 250, fill: "forwards" }
      );
    }
  }

  updateWorld(deltaTime) {
    if (this.isGameOver) {
      this.updateParallax(deltaTime, 0.32);
      return;
    }

    const scrollDelta = this.worldSpeed * deltaTime;
    this.distanceTravelled += scrollDelta * 0.01;
    this.nextChunkX -= scrollDelta;

    for (const surface of this.surfaces) {
      surface.x -= scrollDelta;
    }
    for (const obstacle of this.obstacles) {
      obstacle.x -= scrollDelta;
    }

    this.surfaces = this.surfaces.filter((surface) => (surface.x + surface.width) >= -140);
    this.obstacles = this.obstacles.filter((obstacle) => (obstacle.x + obstacle.width) >= -140);

    this.generateWorldIfNeeded();
    this.updateParallax(deltaTime, 1);
  }

  updateParallax(deltaTime, speedScale) {
    const skylineSpeed = this.worldSpeed * 0.16 * deltaTime * speedScale;
    const wrapWidth = this.width + 180;

    for (const tower of this.skylineNodes) {
      tower.x -= skylineSpeed;
      if (tower.x < -120) {
        tower.x += wrapWidth;
      }
    }
  }

  updatePlayer(deltaTime) {
    if (this.isGameOver) {
      this.verticalVelocity -= this.gravity * deltaTime * 0.45;
      this.playerPosition.y += this.verticalVelocity * deltaTime;
      return;
    }

    this.verticalVelocity -= this.gravity * deltaTime;
    const previousBottom = this.playerPosition.y - this.playerHalfHeight;
    this.playerPosition.y += this.verticalVelocity * deltaTime;
    this.isGrounded = false;

    if (this.coyoteTimer > 0) {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - deltaTime);
    }

    const candidate = this.playerFrame();
    for (const surface of this.surfaces) {
      const frame = surface;
      const horizontalOverlap = candidate.x + candidate.width > frame.x + 6 && candidate.x < frame.x + frame.width - 6;
      const surfaceTop = frame.y + frame.height;
      const landedFromAbove = previousBottom >= surfaceTop - 4 && candidate.y <= surfaceTop + 8 && this.verticalVelocity <= 0;

      if (horizontalOverlap && landedFromAbove) {
        this.playerPosition.y = surfaceTop + this.playerHalfHeight;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        this.coyoteTimer = 0.08;
      }
    }

    if (this.isGrounded) {
      this.coyoteTimer = 0.08;
    }

    if (this.playerPosition.y < -120) {
      this.endRun("Signal Lost");
    }
  }

  resolveCollisions() {
    if (this.isGameOver) {
      return;
    }

    const playerRect = this.insetRect(this.playerFrame(), 1.5, 1.5);
    for (const obstacle of this.obstacles) {
      if (this.intersects(playerRect, this.obstacleCollisionFrame(obstacle))) {
        this.endRun("Beat Drop");
        return;
      }
    }
  }

  triggerJump(mode = "short") {
    if (this.isGameOver) {
      this.resetRun();
      return;
    }

    if (!(this.isGrounded || this.coyoteTimer > 0)) {
      return;
    }

    this.verticalVelocity = mode === "tall" ? this.tallJumpVelocity : this.shortJumpVelocity;
    this.isGrounded = false;
    this.coyoteTimer = 0;
  }

  endRun(reason) {
    if (this.isGameOver) {
      return;
    }

    this.isGameOver = true;
    this.isGrounded = false;
    this.verticalVelocity = Math.max(this.verticalVelocity, 180);
    this.hud.gameOverLabel.textContent = `${reason}\nPress R or Jump to Restart`;
    this.hud.gameOverLabel.style.opacity = "1";
  }

  updateHud() {
    this.hud.titleLabel.textContent = this.currentMusic.title;
    this.hud.subtitleLabel.textContent = `${this.currentMusic.artist}  •  ${this.currentMusic.source}`;

    const tempoValue = Math.round(this.currentMusic.tempo);
    const difficultyValue = Math.round(this.currentMusic.intensity * 100);
    const distanceValue = Math.round(this.distanceTravelled);
    const playbackText = this.currentMusic.isPlaying ? "Live" : "Paused";

    this.hud.statsLabel.textContent = `Tempo ${tempoValue} BPM   Difficulty ${difficultyValue}%   Distance ${distanceValue}m   Songs ${this.currentMusic.songsCleared}   ${playbackText}`;

    for (let index = 0; index < this.spectrumBars.length; index += 1) {
      const value = this.currentMusic.bins[index] ?? 0;
      const bar = this.spectrumBars[index];
      bar.style.height = `${18 + value * 64}px`;
      bar.style.opacity = String(0.35 + value * 0.65);
      bar.style.backgroundColor = index < 4 ? PALETTE.accent : PALETTE.band;
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, PALETTE.backgroundTop);
    gradient.addColorStop(1, PALETTE.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawWorldRect(0, this.height * 0.32, this.width, this.height * 0.68, PALETTE.backgroundTop, 1, null);
    this.drawWorldRect(0, this.groundTop + 36, this.width, this.height * 0.24, "rgba(28, 46, 64, 0.88)", 1, null);

    for (const tower of this.skylineNodes) {
      this.drawWorldRect(
        tower.x - tower.width / 2,
        this.groundTop - 10,
        tower.width,
        tower.height,
        "rgba(43, 71, 89, 0.60)",
        1,
        null
      );
    }

    const pulseAlpha = 0.08 + this.currentMusic.intensity * 0.18 + this.currentMusic.pulse * 0.08;
    this.drawScreenOverlay(this.currentMusic.isPlaying ? PALETTE.haze : "rgba(230, 194, 148, 0.12)", pulseAlpha);

    for (const surface of this.surfaces) {
      this.drawWorldRect(surface.x, surface.y, surface.width, surface.height, PALETTE.ground, 1, PALETTE.groundTrim);
    }

    for (const obstacle of this.obstacles) {
      if (obstacle.kind === "block") {
        this.drawWorldRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, "#ea6b5a", 1, "#ffd9b8");
      } else {
        this.drawSpike(obstacle);
      }
    }

    const pulseScale = 1 + this.currentMusic.pulse * 0.16 + this.currentMusic.intensity * 0.08;
    const haloRadius = 32 * pulseScale;
    const haloAlpha = 0.18 + this.currentMusic.pulse * 0.18 + this.currentMusic.intensity * 0.12;

    this.drawCircle(this.playerPosition.x, this.playerPosition.y, haloRadius, `rgba(183, 255, 248, ${haloAlpha})`);
    this.drawEllipse(
      this.playerPosition.x - 18,
      this.playerPosition.y - 20,
      39 * (0.8 + this.currentMusic.pulse * 0.3),
      13 * (0.9 + this.currentMusic.intensity * 0.18),
      `rgba(128, 214, 230, ${0.16 + this.currentMusic.intensity * 0.26})`
    );

    this.drawPlayer();
  }

  drawPlayer() {
    const rect = this.playerFrame();
    const top = this.height - (rect.y + rect.height);

    this.ctx.save();
    this.ctx.beginPath();
    this.roundRect(this.ctx, rect.x, top, rect.width, rect.height, 11);
    this.ctx.fillStyle = PALETTE.accent;
    this.ctx.fill();
    this.ctx.strokeStyle = "#f8fff2";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawSpike(obstacle) {
    const centerX = obstacle.x + obstacle.width / 2;
    const baseY = obstacle.y;
    const topY = obstacle.y + obstacle.height;

    const p1 = this.worldPoint(centerX - obstacle.width / 2, baseY);
    const p2 = this.worldPoint(centerX, topY);
    const p3 = this.worldPoint(centerX + obstacle.width / 2, baseY);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.lineTo(p3.x, p3.y);
    this.ctx.closePath();
    this.ctx.fillStyle = "#f5944d";
    this.ctx.fill();
    this.ctx.strokeStyle = "#ffd8a8";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawWorldRect(x, y, width, height, fillStyle, alpha = 1, strokeStyle = null) {
    const top = this.height - (y + height);
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = fillStyle;
    this.ctx.fillRect(x, top, width, height);

    if (strokeStyle) {
      this.ctx.strokeStyle = strokeStyle;
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = alpha * 0.45;
      this.ctx.strokeRect(x + 1, top + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    }

    this.ctx.restore();
  }

  drawCircle(x, y, radius, fillStyle) {
    const point = this.worldPoint(x, y);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = fillStyle;
    this.ctx.fill();
    this.ctx.restore();
  }

  drawEllipse(x, y, rx, ry, fillStyle) {
    const point = this.worldPoint(x, y);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.ellipse(point.x, point.y, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fillStyle = fillStyle;
    this.ctx.fill();
    this.ctx.restore();
  }

  drawScreenOverlay(fillStyle, alpha) {
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = fillStyle;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
  }

  worldPoint(x, y) {
    return { x, y: this.height - y };
  }

  speedForTempo(tempo) {
    return clamp(190 + tempo * 1.55, 260, 560);
  }

  maxReachableGap(heightDelta) {
    const minJumpVelocity = this.tallJumpVelocity;
    const clampedHeightDelta = Math.max(0, heightDelta);
    const discriminant = (minJumpVelocity * minJumpVelocity) - (2 * this.gravity * clampedHeightDelta);
    if (discriminant <= 0) {
      return 52;
    }

    const descendingTime = (minJumpVelocity + Math.sqrt(discriminant)) / this.gravity;
    const conservativeAirTime = descendingTime * 0.76;
    const reachable = this.worldSpeed * conservativeAirTime;
    return Math.max(52, reachable - 12);
  }

  playerFrame() {
    return {
      x: this.playerPosition.x - this.playerHalfWidth,
      y: this.playerPosition.y - this.playerHalfHeight,
      width: this.playerHalfWidth * 2,
      height: this.playerHalfHeight * 2
    };
  }

  obstacleCollisionFrame(obstacle) {
    if (obstacle.kind === "block") {
      return this.insetRect(obstacle, 2, 2);
    }

    const base = this.insetRect(obstacle, obstacle.width * 0.16, 0);
    return {
      x: base.x,
      y: base.y + obstacle.height * 0.06,
      width: base.width,
      height: base.height * 0.88
    };
  }

  insetRect(rect, dx, dy) {
    return {
      x: rect.x + dx,
      y: rect.y + dy,
      width: Math.max(0, rect.width - dx * 2),
      height: Math.max(0, rect.height - dy * 2)
    };
  }

  intersects(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}

async function bootstrap() {
  const titleLabel = document.getElementById("titleLabel");
  const subtitleLabel = document.getElementById("subtitleLabel");
  const statsLabel = document.getElementById("statsLabel");
  const hintLabel = document.getElementById("hintLabel");
  const gameOverLabel = document.getElementById("gameOverLabel");
  const spectrumBars = document.getElementById("spectrumBars");

  const spotifyStatus = document.getElementById("spotifyStatus");
  const connectSpotifyButton = document.getElementById("connectSpotifyButton");
  const disconnectSpotifyButton = document.getElementById("disconnectSpotifyButton");
  const toggleSpotifyButton = document.getElementById("toggleSpotifyButton");

  const bridge = new SpotifyWebBridge((message) => {
    spotifyStatus.textContent = message;
  });

  await bridge.bootstrapFromRedirect();

  if (bridge.isConnected()) {
    spotifyStatus.textContent = "Spotify connected.";
  } else if (!bridge.clientId) {
    spotifyStatus.textContent = "Missing Spotify Client ID in app.js.";
  } else if (bridge.shouldAutoConnect()) {
    spotifyStatus.textContent = "Connecting to Spotify...";
    try {
      await bridge.connectInteractive();
    } catch (errorObj) {
      spotifyStatus.textContent = String(errorObj.message || errorObj);
    }
  }

  connectSpotifyButton.addEventListener("click", async () => {
    try {
      await bridge.connectInteractive();
    } catch (errorObj) {
      spotifyStatus.textContent = String(errorObj.message || errorObj);
    }
  });

  disconnectSpotifyButton.addEventListener("click", () => {
    bridge.clearSession();
    spotifyStatus.textContent = "Spotify session cleared.";
  });

  const coordinator = new SpotifyMusicCoordinator(bridge);

  toggleSpotifyButton.addEventListener("click", async () => {
    await coordinator.togglePlayback();
    await coordinator.refresh();
  });

  const game = new InfinibandGame(
    document.getElementById("gameCanvas"),
    {
      titleLabel,
      subtitleLabel,
      statsLabel,
      hintLabel,
      gameOverLabel,
      spectrumBars
    },
    coordinator
  );

  game.start();
}

bootstrap();
