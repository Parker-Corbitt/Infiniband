# Infiniband Web

Browser version of Infiniband with matching gameplay and Spotify-reactive world generation.

## Quick Start (Anyone)

From this folder (`web`), run:

```bash
npm start
```

Then open:

- `http://localhost:4173`

The server prints a local network URL too (for other devices on the same network).

## If Node Is Not Installed

You can still run it with Python:

```bash
cd web
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Spotify Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard.
2. In that app, add your exact game URL as a Redirect URI.
3. Set `SPOTIFY_CLIENT_ID` in `web/app.js` to your app's Client ID.
4. Open the game and approve Spotify scopes when prompted.
5. Make sure Spotify has an active playback device.

## Controls

- `A` / click / tap: short jump
- `F` (or `Space`): tall jump
- `P`: Spotify play/pause
- `R`: restart

## Notes

- Game runs without Spotify setup. Spotify is optional.
- Spotify play/pause control requires an active device and may require Spotify Premium.
- If audio analysis is unavailable for a track, the game falls back to metadata-driven synthesis (same fallback behavior as the desktop build).
