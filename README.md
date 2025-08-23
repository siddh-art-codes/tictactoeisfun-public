# Galactic Tic‑Tac‑Toe: Blaster Edition

### Shoot your mark onto a moving 3×3 board in vibrant (and switchable) worlds.

## ✨ Highlights
- **First‑person blaster**: Fire projectiles to place `X`/`O` by hitting tiles
- **Smooth moving board**: The entire board glides around for aiming challenge
- **Sci‑fi + cute themes**: Switch instantly via Spacebar (clouds, pastel, tron, desert, ocean, forest, ice, lava, cyberpunk, candy, retro, sunset, barbie, nature, mountains, beach, ancient, pyramid, AI…)
- **Win effects**: Thick glowing win line + readable win text
- **Looping BG music**: Starts on first click

## 🎮 Controls
- **Click**: Lock mouse + shoot (left‑click)
- **R**: Restart game (always available)
- **Space**: Switch to a random theme

### Two Player (Online)
- Click **Two Player** → **Create** to host. Share the 5‑digit code.
- Friend clicks **Two Player**, enters the code, and joins.
- Host is **X**, joiner is **O**. Turns alternate.
- **One shot per turn**: each player gets exactly one projectile per turn; a miss still passes the turn.
- Both players see the same moving board and synced moves.

## 🚀 Quick Start
```bash
# from the project root
python3 -m http.server 5173
# visit http://localhost:5173
```

- Click the screen to start (pointer lock + music), then shoot tiles to place marks.
- Press R to reset at any time.

### Enable Two Player (Firebase)
Add your Firebase config in an inline script in `index.html` (before `main.js`) or via DevTools at runtime:

```html
<script>
  window.FIREBASE_CONFIG = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
  };
</script>
```

Notes:
- Firestore is used for realtime sync under collection `rooms/{code}`.
- Codes are 5‑digit numeric; host creates, friend joins.
- If `window.FIREBASE_CONFIG` is not set, Two Player UI will show but won’t connect.

## 🧩 How It Works
- Built with **Three.js** (ESM) for 3D rendering
- **PointerLockControls** for FPS‑style camera
- **Raycasting** to detect tile hits and place `X`/`O`
- **Board motion** via smooth sinusoidal path in the board plane

## 🛠 Tech Stack
- Three.js (module CDN)
- Modern ES modules (no bundler required)
- Vanilla CSS for HUD and 2D theme backgrounds

## 📁 Project Structure
```
first/
├─ index.html        # Entry (module script)
├─ style.css         # HUD + 2D theme backgrounds
├─ main.js           # Three.js scene, game logic, themes, music
└─ Little-Wishes-chosic.com_.mp3  # Background music (loops after first click)
```

## 🧪 Tips
- If audio doesn’t start, click once inside the canvas (browser autoplay policy).
- If you see module errors, hard refresh (Cmd/Ctrl+Shift+R) to clear cache.

## 🙌 Credits
- Background music: `Little-Wishes-chosic.com_.mp3` (user‑provided file).
- Built with ❤️ using Three.js.

---
