# Infiniband Web

Browser version of Infiniband with matching gameplay and Spotify-reactive world generation.

## Local Run

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

## Deploy to GitHub Pages

This repo already includes a Pages workflow at `.github/workflows/pages.yml`.

1. Push to `main`.
2. In GitHub repo settings, set `Pages -> Source` to `GitHub Actions`.
3. Wait for the `Deploy web to Pages` workflow to finish.
4. Open the deployed URL shown by the workflow.

`web/server.js` is for local hosting only and is not used on GitHub Pages.

## Spotify Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard.
2. Set `SPOTIFY_CLIENT_ID` in `web/app.js` to your app's Client ID.
3. In Spotify Dashboard, add `http://localhost:4173/` as a Redirect URI for local play.
4. Add your exact GitHub Pages URL as another Redirect URI for deployment.
5. Open the game and approve Spotify scopes when prompted.
6. Make sure Spotify has an active playback device.

## Controls

- `A` / click / tap: short jump
- `F` / `Space` / `ArrowUp`: tall jump
- `P`: Spotify play/pause
- `R`: restart

## Notes

- Game runs without Spotify setup. Spotify is optional.
- Spotify browser auth is PKCE (no client secret in web code).
- Tokens are stored in `localStorage` and reused across sessions on the same browser.
- Spotify play/pause control requires an active device and may require Spotify Premium.
- If audio analysis is unavailable for a track, the game falls back to metadata-driven synthesis (same fallback behavior as the desktop build).
