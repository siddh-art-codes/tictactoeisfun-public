// Galactic Tic‑Tac‑Toe: Blaster Edition
// Tech: Three.js with Pointer Lock controls, raycasting, bloom-ish glow via emissive materials

import * as THREE from 'https://esm.sh/three@0.160.0';
import { PointerLockControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

// Basic mobile detection (coarse pointer or touch-capable)
const IS_MOBILE = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));

// ---------- Game state ----------
const STATE = {
    turn: 'X', // 'X' or 'O'
    board: Array(9).fill(null), // values: 'X', 'O', or null
    gameOver: false,
};

// Multiplayer session state (Two Player mode)
const MULTI = {
    mode: 'single', // 'single' | 'multi'
    player: null,   // 'X' | 'O' when in multi
    code: null,     // 5-digit room code (string)
    app: null,
    db: null,
    fs: null,       // firestore module namespace
    roomRef: null,
    unsub: null,
    shotUsed: false,
    clientId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random()),
};

const UI = {
    overlay: document.getElementById('overlay'),
    startButton: document.getElementById('startButton'),
    turn: document.getElementById('turn'),
    status: document.getElementById('status'),
    restartButton: document.getElementById('restartButton'),
    // Multiplayer controls
    singleBtn: document.getElementById('singleBtn'),
    multiBtn: document.getElementById('multiBtn'),
    mpControls: document.getElementById('mpControls'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    joinCodeInput: document.getElementById('joinCodeInput'),
    mpCode: document.getElementById('mpCode'),
    roomCode: document.getElementById('roomCode'),
    copyRoomBtn: document.getElementById('copyRoomBtn'),
    mpNote: document.getElementById('mpNote'),
    // New landing + top-right code UI
    landing: document.getElementById('landing'),
    landingCreate: document.getElementById('landingCreate'),
    landingJoin: document.getElementById('landingJoin'),
    landingJoinInput: document.getElementById('landingJoinInput'),
    landingNote: document.getElementById('landingNote'),
    codeTopRight: document.getElementById('codeTopRight'),
    roomCodeTop: document.getElementById('roomCodeTop'),
    copyTopBtn: document.getElementById('copyTopBtn'),
    // Inline code (mobile)
    codeInline: document.getElementById('codeInline'),
    roomCodeInline: document.getElementById('roomCodeInline'),
    copyInlineBtn: document.getElementById('copyInlineBtn'),
};

// Enable on-screen restart button interactions (useful on mobile)
if (UI.restartButton) {
    UI.restartButton.addEventListener('click', () => {
        restart();
    }, { passive: true });
    UI.restartButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        restart();
    }, { passive: false });
}

// ---------- Multiplayer helpers ----------
function updateTurnHUD() {
    const turnText = `Turn: ${STATE.turn}`;
    if (MULTI.mode === 'multi' && MULTI.player) {
        const suffix = (STATE.turn === MULTI.player) ? ' (You)' : ' (Opponent)';
        UI.turn.textContent = turnText + suffix;
    } else {
        UI.turn.textContent = turnText;
    }
}

function setMpNote(text) {
    if (UI.mpNote) UI.mpNote.textContent = text || '';
    if (UI.landingNote) UI.landingNote.textContent = text || '';
}

function hideLanding() { if (UI.landing) UI.landing.classList.add('hidden'); }
function showLanding() { if (UI.landing) UI.landing.classList.remove('hidden'); }
function showTopCode(code) {
    if (UI.roomCodeTop) UI.roomCodeTop.textContent = code || '';
    if (UI.codeTopRight) UI.codeTopRight.classList.toggle('hidden', !code);
    if (UI.roomCodeInline) UI.roomCodeInline.textContent = code || '';
    if (UI.codeInline) UI.codeInline.classList.toggle('hidden', !code);
}

function setModeSingle() {
    if (MULTI.unsub) { try { MULTI.unsub(); } catch(_){} MULTI.unsub = null; }
    MULTI.mode = 'single';
    MULTI.player = null;
    MULTI.code = null;
    MULTI.roomRef = null;
    if (UI.mpControls) UI.mpControls.classList.add('hidden');
    if (UI.mpCode) UI.mpCode.classList.add('hidden');
    if (UI.roomCode) UI.roomCode.textContent = '';
    if (UI.singleBtn) UI.singleBtn.setAttribute('aria-pressed', 'true');
    if (UI.multiBtn) UI.multiBtn.setAttribute('aria-pressed', 'false');
    setMpNote('');
    updateTurnHUD();
}

async function ensureFirebase() {
    if (MULTI.db) return MULTI.db;
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg) throw new Error('Two Player requires window.FIREBASE_CONFIG');
    const appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    MULTI.app = appMod.initializeApp(cfg);
    MULTI.db = fs.getFirestore(MULTI.app);
    MULTI.fs = fs;
    return MULTI.db;
}

async function setModeMulti() {
    if (UI.singleBtn) UI.singleBtn.setAttribute('aria-pressed', 'false');
    if (UI.multiBtn) UI.multiBtn.setAttribute('aria-pressed', 'true');
    if (UI.mpControls) UI.mpControls.classList.remove('hidden');
    MULTI.mode = 'multi';
    MULTI.player = null;
    MULTI.code = null;
    try {
        await ensureFirebase();
        setMpNote('Create or join with a 5-digit code.');
    } catch (e) {
        setMpNote('Two Player unavailable: missing Firebase config.');
    }
    // Mobile: focus join input for quick typing
    if (UI.joinCodeInput) {
        try { UI.joinCodeInput.focus({ preventScroll: true }); UI.joinCodeInput.select && UI.joinCodeInput.select(); } catch (_) {}
    }
    if (UI.landingJoinInput) {
        try { UI.landingJoinInput.focus({ preventScroll: true }); UI.landingJoinInput.select && UI.landingJoinInput.select(); } catch (_) {}
    }
    if (UI.landingNote) UI.landingNote.classList.remove('error');
    updateTurnHUD();
}

function randomCode5() {
    const n = Math.floor(10000 + Math.random()*90000);
    return String(n);
}

function applyRemoteState(remote) {
    if (!remote) return;
    const remoteBoard = Array.isArray(remote.board) ? remote.board.slice(0,9) : Array(9).fill(null);
    const wasEmptyLocal = !STATE.board.some(Boolean);
    const isEmptyRemote = !remoteBoard.some(Boolean);
    if (!wasEmptyLocal && isEmptyRemote) {
        localRestartVisualOnly();
    }
    for (let i=0;i<9;i++) {
        const localVal = STATE.board[i];
        const remoteVal = remoteBoard[i];
        if (localVal !== remoteVal) {
            if (localVal && !remoteVal) { continue; }
            if (!localVal && remoteVal) {
                placeMark(i, remoteVal);
            }
            STATE.board[i] = remoteVal;
        }
    }
    STATE.turn = remote.turn || 'X';
    STATE.gameOver = !!remote.gameOver;
    updateTurnHUD();
    const evalRes = evaluateBoard(STATE.board);
    if (STATE.gameOver) {
        if (evalRes.winner) {
            showBanner(`Player ${evalRes.winner} wins!`);
            UI.status.textContent = `Player ${evalRes.winner} wins!`;
        } else {
            showBanner('Draw game');
            UI.status.textContent = 'Draw game';
        }
        UI.restartButton.classList.remove('hidden');
        if (evalRes.winner && !boardGroup.userData.winLine) {
            highlightWin(evalRes.line);
        }
    } else {
        UI.status.textContent = '';
    }
    if (MULTI.mode === 'multi' && MULTI.player && STATE.turn === MULTI.player) {
        MULTI.shotUsed = false;
    }
}

async function createRoom() {
    try { await ensureFirebase(); } catch (e) { setMpNote('Add Firebase config to enable Two Player.'); return; }
    const fs = MULTI.fs;
    let code = randomCode5();
    let attempts = 0;
    while (attempts < 5) {
        const ref = fs.doc(MULTI.db, 'rooms', code);
        const snap = await fs.getDoc(ref);
        if (!snap.exists()) {
            const data = { board: Array(9).fill(null), turn: 'X', gameOver: false, createdAt: fs.serverTimestamp(), hostId: MULTI.clientId, version: 1 };
            await fs.setDoc(ref, data, { merge: false });
            MULTI.player = 'X';
            MULTI.mode = 'multi';
            MULTI.code = code;
            MULTI.roomRef = ref;
            if (UI.roomCode) UI.roomCode.textContent = code;
            showTopCode(code);
            setMpNote('Share the code with your friend. You are X.');
            subscribeRoom(ref);
            hideLanding();
            document.body.classList.add('mp');
            return true;
        }
        code = randomCode5();
        attempts++;
    }
    setMpNote('Failed to create room, try again.');
    return false;
}

async function joinRoomByCode(raw) {
    const code = (raw || '').trim();
    if (!/^\d{5}$/.test(code)) { setMpNote('Enter a valid 5-digit code.'); if (UI.landingNote) UI.landingNote.classList.add('error'); return false; }
    try { await ensureFirebase(); } catch (e) { setMpNote('Add Firebase config to enable Two Player.'); return; }
    const fs = MULTI.fs;
    const ref = fs.doc(MULTI.db, 'rooms', code);
    try {
        const snap = await fs.getDoc(ref);
        if (!snap.exists()) { setMpNote('Room not found.'); if (UI.landingNote) UI.landingNote.classList.add('error'); return false; }
    } catch (err) {
        setMpNote('Unable to reach server. Try again.');
        if (UI.landingNote) UI.landingNote.classList.add('error');
        return false;
    }
    MULTI.player = 'O';
    MULTI.mode = 'multi';
    MULTI.code = code;
    MULTI.roomRef = ref;
    if (UI.roomCode) UI.roomCode.textContent = code;
    showTopCode(code);
    setMpNote('Joined. You are O.');
    try { await fs.setDoc(ref, { guestJoinedAt: fs.serverTimestamp() }, { merge: true }); } catch(_){}
    subscribeRoom(ref);
    hideLanding();
    document.body.classList.add('mp');
    return true;
}

function subscribeRoom(ref) {
    if (MULTI.unsub) { try { MULTI.unsub(); } catch(_){} }
    const fs = MULTI.fs;
    MULTI.unsub = fs.onSnapshot(ref, (doc) => {
        if (!doc.exists()) return;
        const data = doc.data();
        applyRemoteState(data);
    }, (err) => {
        setMpNote('Connection lost.');
        console.error(err);
    });
}

// Score HUD removed

// Theme manager
const THEMES = { default: 'default', clouds: 'clouds', pastel: 'pastel', tron: 'tron', desert: 'desert', ocean: 'ocean', forest: 'forest', ice: 'ice', lava: 'lava', cyberpunk: 'cyberpunk', candy: 'candy', retro: 'retro', sunset: 'sunset', barbie: 'barbie', nature: 'nature', mountains: 'mountains', beach: 'beach', ancient: 'ancient', pyramid: 'pyramid', ai: 'ai' };
let currentTheme = THEMES.default;
function applyTheme(name) {
    currentTheme = name;
    document.body.classList.toggle('theme-default', name === THEMES.default);
    document.body.classList.toggle('theme-clouds', name === THEMES.clouds);
    document.body.classList.toggle('theme-pastel', name === THEMES.pastel);
    document.body.classList.toggle('theme-tron', name === THEMES.tron);
    document.body.classList.toggle('theme-desert', name === THEMES.desert);
    document.body.classList.toggle('theme-ocean', name === THEMES.ocean);
    document.body.classList.toggle('theme-forest', name === THEMES.forest);
    document.body.classList.toggle('theme-ice', name === THEMES.ice);
    document.body.classList.toggle('theme-lava', name === THEMES.lava);
    document.body.classList.toggle('theme-cyberpunk', name === THEMES.cyberpunk);
    document.body.classList.toggle('theme-candy', name === THEMES.candy);
    document.body.classList.toggle('theme-retro', name === THEMES.retro);
    document.body.classList.toggle('theme-sunset', name === THEMES.sunset);
    document.body.classList.toggle('theme-barbie', name === THEMES.barbie);
    document.body.classList.toggle('theme-nature', name === THEMES.nature);
    document.body.classList.toggle('theme-mountains', name === THEMES.mountains);
    document.body.classList.toggle('theme-beach', name === THEMES.beach);
    document.body.classList.toggle('theme-ancient', name === THEMES.ancient);
    document.body.classList.toggle('theme-pyramid', name === THEMES.pyramid);
    document.body.classList.toggle('theme-ai', name === THEMES.ai);
    // disable all themes first
    setDefaultTheme(false);
    setCloudsTheme(false);
    setPastelTheme(false);
    setTronTheme(false);
    setDesertTheme(false);
    setOceanTheme(false);
    setForestTheme(false);
    setIceTheme(false);
    setLavaTheme(false);
    setCyberpunkTheme(false);
    setCandyTheme(false);
    setRetroTheme(false);
    setSunsetTheme(false);
    setBarbieTheme(false);
    setNatureTheme(false);
    setMountainsTheme(false);
    setBeachTheme(false);
    setAncientTheme(false);
    setPyramidTheme(false);
    setAITheme(false);
    // enable selected
    if (name === THEMES.default) setDefaultTheme(true);
    if (name === THEMES.clouds) setCloudsTheme(true);
    if (name === THEMES.pastel) setPastelTheme(true);
    if (name === THEMES.tron) setTronTheme(true);
    if (name === THEMES.desert) setDesertTheme(true);
    if (name === THEMES.ocean) setOceanTheme(true);
    if (name === THEMES.forest) setForestTheme(true);
    if (name === THEMES.ice) setIceTheme(true);
    if (name === THEMES.lava) setLavaTheme(true);
    if (name === THEMES.cyberpunk) setCyberpunkTheme(true);
    if (name === THEMES.candy) setCandyTheme(true);
    if (name === THEMES.retro) setRetroTheme(true);
    if (name === THEMES.sunset) setSunsetTheme(true);
    if (name === THEMES.barbie) setBarbieTheme(true);
    if (name === THEMES.nature) setNatureTheme(true);
    if (name === THEMES.mountains) setMountainsTheme(true);
    if (name === THEMES.beach) setBeachTheme(true);
    if (name === THEMES.ancient) setAncientTheme(true);
    if (name === THEMES.pyramid) setPyramidTheme(true);
    if (name === THEMES.ai) setAITheme(true);
}

// Endgame banner helpers (created after scene init below)
function showBanner(message) {
    // Switch scene to grayscale when banner shows
    applyGrayscaleTheme(true);
    // Remove any prior win text on board
    if (boardGroup.userData && boardGroup.userData.winText) {
        const t = boardGroup.userData.winText;
        boardGroup.remove(t);
        if (t.material && t.material.map) t.material.map.dispose();
        if (t.material) t.material.dispose();
        boardGroup.userData.winText = undefined;
    }
    const textSprite = createTextSprite(message, '#ffe67a');
    // Attach below the board and always on top
    textSprite.position.set(0, -4.2, 0.5);
    textSprite.material.depthTest = false;
    textSprite.renderOrder = 20;
    boardGroup.add(textSprite);
    boardGroup.userData.winText = textSprite;
    // Hide banner mesh content if any
    if (window.__bannerGroup) {
        const bg = window.__bannerGroup;
        bg.visible = false;
        bg.userData = { t: 0, active: true, message };
    }
    UI.status.textContent = message;
}

function hideBanner() {
    // restore colorful theme when banner hides (on restart)
    applyGrayscaleTheme(false);
    if (boardGroup.userData && boardGroup.userData.winText) {
        const t = boardGroup.userData.winText;
        boardGroup.remove(t);
        if (t.material && t.material.map) t.material.map.dispose();
        if (t.material) t.material.dispose();
        boardGroup.userData.winText = undefined;
    }
    if (window.__bannerGroup) {
        const bg = window.__bannerGroup;
        bg.visible = false;
        bg.userData = { t: 0, active: false, message: '', textSprite: undefined };
    }
}

// Toggle grayscale theme for the whole scene (except restart button/top HUD)
function applyGrayscaleTheme(isGray) {
    // fog
    scene.fog.color.setHex(isGray ? 0x000000 : 0x030614);
    // lights
    hemiLight.color.setHex(isGray ? 0xffffff : 0x405cff);
    hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x001133);
    keyLight.color.setHex(isGray ? 0xffffff : 0x7aa8ff);
    // stars
    starMat.color.setHex(isGray ? 0xffffff : 0xa5c7ff);
    // nebula
    nebulaGroup.children.forEach((m) => {
        if (m.material) {
            if (isGray) {
                m.material.color.setHex(0x777777);
                m.material.emissive.setHex(0x444444);
                m.material.opacity = 0.12;
            } else {
                const color = new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.7, 0.5);
                m.material.color.copy(color);
                m.material.emissive.copy(color);
                m.material.opacity = 0.15;
            }
            m.material.needsUpdate = true;
        }
    });
    // grid
    if (grid.material && grid.material.color) {
        grid.material.color.setHex(isGray ? 0x666666 : 0x3f55ff);
        grid.material.opacity = isGray ? 0.25 : 0.25;
    }
    // platform
    platform.material.color.setHex(isGray ? 0x111111 : 0x0b1235);
    platform.material.emissive.setHex(isGray ? 0x000000 : 0x0b1235);
    platform.material.opacity = isGray ? 0.2 : 0.22;
    // grid lines
    [v1, v2, h1, h2].forEach((l) => {
        l.material.color.setHex(isGray ? 0xffffff : 0x3ea1ff);
        l.material.emissive.setHex(isGray ? 0xffffff : 0x3ea1ff);
        l.material.emissiveIntensity = isGray ? 0.7 : 0.85;
    });
    // tiles base
    tiles.forEach((t) => {
        t.material.color.setHex(isGray ? 0x1a1a1a : BASE_TILE_COLOR);
        t.material.metalness = isGray ? 0.2 : 0.6;
        t.material.roughness = isGray ? 0.8 : 0.3;
        if (!STATE.board[t.userData.index]) {
            // reset hover emissive off
            if (t.material.emissive) t.material.emissive.setHex(0x000000);
        }
    });
    // gun
    barrel.material.color.setHex(isGray ? 0xaaaaaa : 0x9ad0ff);
    barrel.material.emissive.setHex(isGray ? 0x222222 : 0x4aa0ff);
    body.material.color.setHex(isGray ? 0x222222 : 0x1a2a66);
    body.material.emissive.setHex(isGray ? 0x111111 : 0x111d44);
    // projectile color
    projectileMat.color.setHex(isGray ? 0xffffff : 0x9fffd1);
    projectileMat.emissive.setHex(isGray ? 0xffffff : 0x42ffb3);
}

function setCloudsTheme(enabled) {
    // preserve grayscale state on switch
    // toggle visibility of clouds vs stars/nebula/grid
    cloudsGroup.visible = enabled;
    stars.visible = !enabled;
    nebulaGroup.visible = !enabled;
    grid.visible = !enabled;
    platform.visible = !enabled;
    [v1, v2, h1, h2].forEach((l) => l.visible = !enabled);
    // push clouds and other background groups away from the board plane
    cloudsGroup.position.set(0, 0, -20);
    nebulaGroup.position.set(0, 0, -30);
    stars.position.set(0, 0, -50);
    // tiles and board still visible; restyle materials when clouds on
    tiles.forEach((tile) => {
        if (enabled) {
            tile.material.color.setHex(0xffffff);
            tile.material.opacity = 0.85;
            tile.material.metalness = 0.0;
            tile.material.roughness = 1.0;
        } else {
            tile.material.color.setHex(BASE_TILE_COLOR);
            tile.material.opacity = 0.42;
            tile.material.metalness = 0.6;
            tile.material.roughness = 0.3;
        }
    });
    // marks colors (X/O): clouds theme uses white puffs look
    if (enabled) {
        neonXMaterial.color.setHex(0xffffff); neonXMaterial.emissive.setHex(0xffffff); neonXMaterial.emissiveIntensity = 0.4;
        neonOMaterial.color.setHex(0xffffff); neonOMaterial.emissive.setHex(0xffffff); neonOMaterial.emissiveIntensity = 0.4;
    } else {
        neonXMaterial.color.setHex(0x88b6ff); neonXMaterial.emissive.setHex(0x3d84ff); neonXMaterial.emissiveIntensity = 0.9;
        neonOMaterial.color.setHex(0x9dffd6); neonOMaterial.emissive.setHex(0x1aff9a); neonOMaterial.emissiveIntensity = 0.9;
    }
    // sky light warmer for clouds
    const isGray = scene.fog.color.getHex() === 0x000000; // keep current bw if active
    if (enabled) {
        hemiLight.color.setHex(isGray ? 0xffffff : 0xffffff);
        hemiLight.groundColor.setHex(isGray ? 0xdde8ff : 0xcfdfff);
        keyLight.color.setHex(isGray ? 0xffffff : 0xffffff);
        scene.fog.color.setHex(isGray ? 0x000000 : 0xdde8ff);
    } else {
        hemiLight.color.setHex(isGray ? 0xffffff : 0x405cff);
        hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x001133);
        keyLight.color.setHex(isGray ? 0xffffff : 0x7aa8ff);
        scene.fog.color.setHex(isGray ? 0x000000 : 0x030614);
    }
}

function setDefaultTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = enabled;
    nebulaGroup.visible = enabled;
    grid.visible = enabled;
    platform.visible = enabled;
    [v1, v2, h1, h2].forEach((l) => l.visible = enabled);
    hemiLight.color.setHex(isGray ? 0xffffff : 0x405cff);
    hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x001133);
    keyLight.color.setHex(isGray ? 0xffffff : 0x7aa8ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x030614);
    tiles.forEach((t) => {
        t.material.color.setHex(isGray ? 0x1a1a1a : BASE_TILE_COLOR);
        t.material.opacity = 0.42;
    });
    neonXMaterial.color.setHex(isGray ? 0xffffff : 0x88b6ff); neonXMaterial.emissive.setHex(isGray ? 0xffffff : 0x3d84ff);
    neonOMaterial.color.setHex(isGray ? 0xffffff : 0x9dffd6); neonOMaterial.emissive.setHex(isGray ? 0xffffff : 0x1aff9a);
}

// A pastel marshmallow theme: soft gradient background via fog/colors and rounded board lines
function setPastelTheme(enabled) {
    // visibility adjustments
    cloudsGroup.visible = false;
    stars.visible = !enabled;
    nebulaGroup.visible = enabled; // keep soft glow
    grid.visible = !enabled;
    platform.visible = enabled;
    [v1, v2, h1, h2].forEach((l) => l.visible = enabled);
    const isGray = scene.fog.color.getHex() === 0x000000;
    if (enabled) {
        // soften colors unless grayscale
        hemiLight.color.setHex(isGray ? 0xffffff : 0xffd7f0);
        hemiLight.groundColor.setHex(isGray ? 0x222222 : 0xc4f6ff);
        keyLight.color.setHex(isGray ? 0xffffff : 0xffa3d6);
        scene.fog.color.setHex(isGray ? 0x000000 : 0x1a0e1a);
        platform.material.color.setHex(isGray ? 0x222222 : 0x2a1333);
        platform.material.emissive.setHex(isGray ? 0x111111 : 0x2a1333);
        [v1, v2, h1, h2].forEach((l) => {
            l.material.color.setHex(isGray ? 0xffffff : 0xff9ecb);
            l.material.emissive.setHex(isGray ? 0xffffff : 0xff9ecb);
            l.material.emissiveIntensity = isGray ? 0.7 : 0.9;
        });
        tiles.forEach((t) => {
            t.material.color.setHex(isGray ? 0x1a1a1a : 0x381a44);
            t.material.opacity = isGray ? 0.42 : 0.5;
        });
        neonXMaterial.color.setHex(isGray ? 0xffffff : 0xffb3da); neonXMaterial.emissive.setHex(isGray ? 0xffffff : 0xff8fc8);
        neonOMaterial.color.setHex(isGray ? 0xffffff : 0xb6f3ff); neonOMaterial.emissive.setHex(isGray ? 0xffffff : 0x99ebff);
    } else {
        // revert to default sci-fi (respect grayscale)
        setDefaultTheme(true);
    }
}

// Additional distinct themes (lightweight stylistic toggles)
function setTronTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = enabled;
    nebulaGroup.visible = false;
    grid.visible = enabled;
    platform.visible = enabled;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    [v1, v2, h1, h2].forEach((l) => {
        l.visible = enabled;
        l.material.color.setHex(isGray ? 0xffffff : 0x00f0ff);
        l.material.emissive.setHex(isGray ? 0xffffff : 0x00f0ff);
        l.material.emissiveIntensity = isGray ? 0.7 : 1.2;
    });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x000a14); t.material.opacity = 0.5; });
    setWeapon('cube'); setProjectileStyle('cube');
    hemiLight.color.setHex(isGray ? 0xffffff : 0x00e1ff); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x00131a);
    keyLight.color.setHex(isGray ? 0xffffff : 0x00e1ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x02121a);
}

function setDesertTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false;
    platform.visible = enabled; [v1, v2, h1, h2].forEach((l) => l.visible = enabled);
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = enabled; sandGroup.visible = enabled; retroGridGroup.visible = false; billboardsGroup.visible = false;
    sandGroup.position.set(0,0,-40); sparkGroup.position.set(0,0,-25);
    platform.material.color.setHex(isGray ? 0x222222 : 0xcaa66a);
    platform.material.emissive.setHex(isGray ? 0x111111 : 0x8a6e3e);
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xd9c39a); t.material.opacity = 0.6; });
    setWeapon('staff'); setProjectileStyle('ember');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xfff2cf); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0xb38e5a);
    keyLight.color.setHex(isGray ? 0xffffff : 0xffe1a8);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xf5e3c6);
}

function setOceanTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = true; grid.visible = false; platform.visible = false;
    [v1, v2, h1, h2].forEach((l) => l.visible = false);
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = enabled; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    bubbleGroup.position.set(0,0,-30); if (waterMesh) waterMesh.position.z = -25;
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x0b2a3a); t.material.opacity = 0.6; });
    setWeapon('trident'); setProjectileStyle('bubble');
    hemiLight.color.setHex(isGray ? 0xffffff : 0x9ee8ff); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x03202c);
    keyLight.color.setHex(isGray ? 0xffffff : 0x67d8ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x052b3a);
}

function setForestTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = true; grid.visible = false; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    treesGroup.visible = enabled; treesGroup.position.set(0,0,-18);
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0x6cff8a); l.material.emissive.setHex(isGray ? 0xffffff : 0x3cff65); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x0d2a1a); t.material.opacity = 0.5; });
    platform.material.color.setHex(isGray ? 0x222222 : 0x123a22); platform.material.emissive.setHex(isGray ? 0x111111 : 0x0d2a1a);
    setWeapon('staff'); setProjectileStyle();
    hemiLight.color.setHex(isGray ? 0xffffff : 0xa8ffbf); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x052012);
    keyLight.color.setHex(isGray ? 0xffffff : 0x6cff8a);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x082015);
}

function setIceTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = true; nebulaGroup.visible = false; grid.visible = true; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = enabled; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    snowGroup.position.set(0,0,-35);
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xb9e8ff); l.material.emissive.setHex(isGray ? 0xffffff : 0x8dd7ff); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x1a3344); t.material.opacity = 0.5; });
    setWeapon('staff'); setProjectileStyle('snow');
    platform.material.color.setHex(isGray ? 0x222222 : 0x163344); platform.material.emissive.setHex(isGray ? 0x111111 : 0x102a3a);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xc6ecff); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x0c1e28);
    keyLight.color.setHex(isGray ? 0xffffff : 0xa1e2ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x0a1b24);
}

function setLavaTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = true; grid.visible = false; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = enabled; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    sparkGroup.position.set(0,0,-28);
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xff7a3a); l.material.emissive.setHex(isGray ? 0xffffff : 0xff3b00); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x3a140a); t.material.opacity = 0.5; });
    setWeapon('blaster'); setProjectileStyle('ember');
    platform.material.color.setHex(isGray ? 0x222222 : 0x3a1a0f); platform.material.emissive.setHex(isGray ? 0x111111 : 0x2a1009);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xffd0b0); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x1a0b06);
    keyLight.color.setHex(isGray ? 0xffffff : 0xffa266);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x1a0b06);
}

function setCyberpunkTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = true; nebulaGroup.visible = true; grid.visible = true; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = enabled;
    billboardsGroup.position.set(0,0,-20);
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xff2a7a); l.material.emissive.setHex(isGray ? 0xffffff : 0x2af0ff); l.material.emissiveIntensity = 1.2; });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x120a22); t.material.opacity = 0.5; });
    setWeapon('cube'); setProjectileStyle('cube');
    platform.material.color.setHex(isGray ? 0x222222 : 0x0e0a22); platform.material.emissive.setHex(isGray ? 0x111111 : 0x0a0818);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xff60a6); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x003344);
    keyLight.color.setHex(isGray ? 0xffffff : 0x2af0ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x050314);
}

function setCandyTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xffb3da); l.material.emissive.setHex(isGray ? 0xffffff : 0xff8fc8); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xfff1f9); t.material.opacity = 0.85; });
    setWeapon('candy'); setProjectileStyle('heart');
    platform.material.color.setHex(isGray ? 0x222222 : 0xffe3f1); platform.material.emissive.setHex(isGray ? 0x111111 : 0xffd7f0);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xffd7f0); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0xffeaf8);
    keyLight.color.setHex(isGray ? 0xffffff : 0xffa3d6);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xffecf7);
}

function setRetroTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = true; nebulaGroup.visible = false; grid.visible = true; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = enabled; billboardsGroup.visible = false;
    retroGridGroup.position.set(0,0,-30);
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0x00ff88); l.material.emissive.setHex(isGray ? 0xffffff : 0xff00aa); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x0f0030); t.material.opacity = 0.5; });
    setWeapon('cube'); setProjectileStyle('cube');
    platform.material.color.setHex(isGray ? 0x222222 : 0x140044); platform.material.emissive.setHex(isGray ? 0x111111 : 0x0f0038);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xff00aa); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x001a12);
    keyLight.color.setHex(isGray ? 0xffffff : 0x00ff88);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x080018);
}

function setSunsetTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    stars.visible = false; nebulaGroup.visible = true; grid.visible = false; platform.visible = true;
    cloudsGroup.visible = false; snowGroup.visible = false; bubbleGroup.visible = false; sparkGroup.visible = false; sandGroup.visible = false; retroGridGroup.visible = false; billboardsGroup.visible = false;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xffb86b); l.material.emissive.setHex(isGray ? 0xffffff : 0xff6b6b); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x26120a); t.material.opacity = 0.5; });
    setWeapon('blaster'); setProjectileStyle();
    platform.material.color.setHex(isGray ? 0x222222 : 0x2a120a); platform.material.emissive.setHex(isGray ? 0x111111 : 0x1a0a06);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xffd1a6); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x1a0b06);
    keyLight.color.setHex(isGray ? 0xffffff : 0xff8a66);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x1a0b06);
}

function setBarbieTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    barbieGroup.visible = enabled; barbieGroup.position.set(0,0,-16);
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = true;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xff8fc8); l.material.emissive.setHex(isGray ? 0xffffff : 0xffc6e6); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xffe3f1); t.material.opacity = 0.85; });
    setWeapon('heart'); setProjectileStyle('heart');
    neonXMaterial.color.setHex(isGray ? 0xffffff : 0xff9ecb); neonOMaterial.color.setHex(isGray ? 0xffffff : 0xffd7f0);
    setBoardStyle('ring');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xffd7f0); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0xffeaf8);
    keyLight.color.setHex(isGray ? 0xffffff : 0xffa3d6);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xffecf7);
}

function setNatureTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    treesGroup.visible = enabled; treesGroup.position.set(0,0,-16);
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = true;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0x6cff8a); l.material.emissive.setHex(isGray ? 0xffffff : 0x3cff65); });
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x1b3a24); t.material.opacity = 0.55; });
    setWeapon('staff'); setProjectileStyle();
    platform.material.color.setHex(isGray ? 0x222222 : 0x1a3a26); platform.material.emissive.setHex(isGray ? 0x111111 : 0x0f2a1a);
    setBoardStyle('tri');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xbaf7cd); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x0b2817);
    keyLight.color.setHex(isGray ? 0xffffff : 0x72ff97);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x0a1f12);
}

function setMountainsTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    mountainsGroup.visible = enabled; mountainsGroup.position.set(0,0,-24);
    stars.visible = true; nebulaGroup.visible = false; grid.visible = false; platform.visible = false;
    [v1, v2, h1, h2].forEach((l) => l.visible = false);
    setBoardStyle('ring');
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x3a3a3a); t.material.opacity = 0.45; });
    setWeapon('blaster'); setProjectileStyle('snow');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xd6e4ff); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x0a0e1a);
    keyLight.color.setHex(isGray ? 0xffffff : 0xc1d7ff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x0e1220);
}

function setBeachTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    beachGroup.visible = enabled; beachGroup.position.set(0,0,-20);
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = false;
    [v1, v2, h1, h2].forEach((l) => l.visible = false);
    setBoardStyle('ring');
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xfce7b5); t.material.opacity = 0.65; });
    setWeapon('trident'); setProjectileStyle('bubble');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xfff3b3); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0xfad49a);
    keyLight.color.setHex(isGray ? 0xffffff : 0xfff3b3);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xaad8ff);
}

function setAncientTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    ancientGroup.visible = enabled; ancientGroup.position.set(0,0,-18);
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = true;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0xcac1af); l.material.emissive.setHex(isGray ? 0xffffff : 0xb9af99); });
    setBoardStyle('grid');
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xded7c9); t.material.opacity = 0.75; });
    setWeapon('staff'); setProjectileStyle();
    platform.material.color.setHex(isGray ? 0x222222 : 0xcac1af); platform.material.emissive.setHex(isGray ? 0x111111 : 0xb9af99);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xf3ecd7); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x3a2f1a);
    keyLight.color.setHex(isGray ? 0xffffff : 0xe5d7b9);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xeae2cf);
}

function setPyramidTheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    pyramidGroup.visible = enabled; pyramidGroup.position.set(0,0,-22);
    stars.visible = false; nebulaGroup.visible = false; grid.visible = false; platform.visible = false;
    [v1, v2, h1, h2].forEach((l) => l.visible = false);
    setBoardStyle('tri');
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0xd8c080); t.material.opacity = 0.7; });
    setWeapon('blaster'); setProjectileStyle('ember');
    hemiLight.color.setHex(isGray ? 0xffffff : 0xffe6b3); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x8a6e3e);
    keyLight.color.setHex(isGray ? 0xffffff : 0xffd78a);
    scene.fog.color.setHex(isGray ? 0x000000 : 0xffedc6);
}

function setAITheme(enabled) {
    const isGray = scene.fog.color.getHex() === 0x000000;
    aiGroup.visible = enabled; aiGroup.position.set(0,0,-16);
    stars.visible = false; nebulaGroup.visible = true; grid.visible = true; platform.visible = true;
    [v1, v2, h1, h2].forEach((l) => { l.visible = enabled; l.material.color.setHex(isGray ? 0xffffff : 0x66ccff); l.material.emissive.setHex(isGray ? 0xffffff : 0x66ccff); l.material.emissiveIntensity = 1.0; });
    setBoardStyle('grid');
    tiles.forEach((t) => { t.material.color.setHex(isGray ? 0x1a1a1a : 0x0a101a); t.material.opacity = 0.55; });
    setWeapon('cube'); setProjectileStyle('cube');
    platform.material.color.setHex(isGray ? 0x222222 : 0x0a101a); platform.material.emissive.setHex(isGray ? 0x111111 : 0x0a101a);
    hemiLight.color.setHex(isGray ? 0xffffff : 0xbfe6ff); hemiLight.groundColor.setHex(isGray ? 0x222222 : 0x00111a);
    keyLight.color.setHex(isGray ? 0xffffff : 0x66ccff);
    scene.fog.color.setHex(isGray ? 0x000000 : 0x060a14);
}

// ---------- Three setup ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030614, 0.015);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x000000, 0.0);
document.body.appendChild(renderer.domElement);
if (IS_MOBILE) {
    // Prevent scroll/zoom gestures interfering with aiming
    renderer.domElement.style.touchAction = 'none';
}

const controls = new PointerLockControls(camera, document.body);

// Player movement (WASD) for fun exploration
const keys = { w: false, a: false, s: false, d: false };
const lookKeys = { left: false, right: false, up: false, down: false };
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let canMove = false; // wait for click to start

// --- Audio (blaster sfx + voiceover via speechSynthesis) ---
let audioCtx;
function ensureAudio() {
    try {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {
        // ignore
    }
}

function playBlaster() {
    if (!audioCtx) ensureAudio();
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(12000, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + 0.12);

    osc.type = 'square';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);

    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

    osc.connect(filter).connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
}

// Background galactic music (looping MP3 after first click)
const bgMusic = { started: false };
function startBackgroundMusic() {
    if (bgMusic.started) return;
    const url = './Little-Wishes-chosic.com_.mp3';
    const audioEl = new Audio(url);
    audioEl.loop = true;
    audioEl.volume = 0.25;
    audioEl.playsInline = true;
    audioEl.addEventListener('ended', () => {
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
    });
    audioEl.play().catch(() => {
        // If play fails (autoplay policy), it will retry on next user click
    });
    bgMusic.audio = audioEl;
    bgMusic.started = true;
}

function speak(text) {
    try {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.95;
        utter.pitch = 1.05;
        utter.volume = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find(v => /en/i.test(v.lang) && v.name.toLowerCase().includes('female')) || voices.find(v => /en/i.test(v.lang));
        if (enVoice) utter.voice = enVoice;
        window.speechSynthesis.speak(utter);
    } catch (_) {
        // ignore
    }
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        const order = [THEMES.default, THEMES.clouds, THEMES.pastel, THEMES.tron, THEMES.desert, THEMES.ocean, THEMES.forest, THEMES.ice, THEMES.lava, THEMES.cyberpunk, THEMES.candy, THEMES.retro, THEMES.sunset, THEMES.barbie, THEMES.nature, THEMES.mountains, THEMES.beach, THEMES.ancient, THEMES.pyramid, THEMES.ai];
        const pick = order[Math.floor(Math.random() * order.length)];
        applyTheme(pick);
        return;
    }
    if (e.code === 'KeyW') keys.w = true;
    if (e.code === 'KeyA') keys.a = true;
    if (e.code === 'KeyS') keys.s = true;
    if (e.code === 'KeyD') keys.d = true;
    if (e.code === 'ArrowLeft') lookKeys.left = true;
    if (e.code === 'ArrowRight') lookKeys.right = true;
    if (e.code === 'ArrowUp') lookKeys.up = true;
    if (e.code === 'ArrowDown') lookKeys.down = true;
    if (e.code === 'KeyR') restart();
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.w = false;
    if (e.code === 'KeyA') keys.a = false;
    if (e.code === 'KeyS') keys.s = false;
    if (e.code === 'KeyD') keys.d = false;
    if (e.code === 'ArrowLeft') lookKeys.left = false;
    if (e.code === 'ArrowRight') lookKeys.right = false;
    if (e.code === 'ArrowUp') lookKeys.up = false;
    if (e.code === 'ArrowDown') lookKeys.down = false;
});

// Start on user click; show hint until locked
UI.overlay.style.display = 'none';
const startHintEl = document.getElementById('startHint');
function startGame() {
    ensureAudio();
    // Allow starting without pointer lock from landing; we lock on first canvas click
    if (IS_MOBILE) {
        if (!canMove) { canMove = true; document.body.classList.add('started'); }
    } else {
        if (!controls.isLocked) controls.lock();
    }
    startBackgroundMusic();
}
// Update hint copy for mobile vs desktop
if (startHintEl) {
    startHintEl.textContent = IS_MOBILE ? 'Tap to Start' : 'Click to Start';
}
window.addEventListener('click', () => {
    if (!canMove) startGame();
});
controls.addEventListener('lock', () => { canMove = true; document.body.classList.add('started'); });
controls.addEventListener('unlock', () => { canMove = false; document.body.classList.remove('started'); if (startHintEl) startHintEl.style.display = ''; });

// Wire up multiplayer UI
// New landing events
if (UI.landingCreate) UI.landingCreate.addEventListener('click', async () => { setModeMulti(); const ok = await createRoom(); if (ok) hideLanding(); });
if (UI.landingJoin) UI.landingJoin.addEventListener('click', async () => {
    await setModeMulti();
    const raw = UI.landingJoinInput && UI.landingJoinInput.value;
    const ok = await joinRoomByCode(raw);
    if (ok) hideLanding();
});
if (UI.landingJoinInput) UI.landingJoinInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        await setModeMulti();
        const ok = await joinRoomByCode(UI.landingJoinInput.value);
        if (ok) hideLanding();
    }
});
// Copy buttons
const copyCode = async (code) => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setMpNote('Code copied'); setTimeout(()=>setMpNote(''), 1200); } catch(_) { setMpNote('Copy failed'); setTimeout(()=>setMpNote(''), 1200); }
};
if (UI.copyRoomBtn) UI.copyRoomBtn.addEventListener('click', async () => copyCode(UI.roomCode && UI.roomCode.textContent));
if (UI.copyTopBtn) UI.copyTopBtn.addEventListener('click', async () => copyCode(UI.roomCodeTop && UI.roomCodeTop.textContent));
if (UI.copyInlineBtn) UI.copyInlineBtn.addEventListener('click', async () => copyCode(UI.roomCodeInline && UI.roomCodeInline.textContent));

// Lighting — neon sci‑fi
const hemiLight = new THREE.HemisphereLight(0x405cff, 0x001133, 1.0);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0x7aa8ff, 1.5);
keyLight.position.set(5, 10, 7);
keyLight.castShadow = true;
scene.add(keyLight);

// Starfield backdrop
const starGeo = new THREE.BufferGeometry();
const starCount = 2000;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    const r = 200;
    starPositions[i * 3 + 0] = (Math.random() - 0.5) * 2 * r;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 2 * r;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 2 * r;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xa5c7ff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.8 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// Clouds theme assets
const cloudsGroup = new THREE.Group();
cloudsGroup.visible = false;
scene.add(cloudsGroup);

const cloudParticles = [];
function createCloud(x, y, z, scale) {
    const geo = new THREE.SphereGeometry(1, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.9 });
    const puff = new THREE.Group();
    for (let i = 0; i < 5; i++) {
        const s = (0.8 + Math.random() * 0.6) * scale;
        const m = new THREE.Mesh(geo, mat.clone());
        m.position.set((Math.random()-0.5)*1.6*scale, (Math.random()-0.5)*0.8*scale, (Math.random()-0.5)*1.0*scale);
        m.scale.set(s, s, s*0.8);
        puff.add(m);
    }
    puff.position.set(x, y, z);
    cloudsGroup.add(puff);
    cloudParticles.push(puff);
}

for (let i = 0; i < 25; i++) {
    createCloud((Math.random()-0.5)*60, (Math.random()-0.2)*30, (Math.random()-0.5)*60, 2 + Math.random()*3);
}

// Additional environment groups for distinct themes
// Snow (ice theme)
const snowGroup = new THREE.Group();
snowGroup.visible = false;
scene.add(snowGroup);
let snowPoints;
{
    const count = 2500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i*3+0] = (Math.random()-0.5)*120;
        pos[i*3+1] = Math.random()*60;
        pos[i*3+2] = (Math.random()-0.5)*120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0.9 });
    snowPoints = new THREE.Points(geo, mat);
    snowGroup.add(snowPoints);
}

// Bubbles (ocean theme)
const bubbleGroup = new THREE.Group();
bubbleGroup.visible = false;
scene.add(bubbleGroup);
let bubblePoints;
{
    const count = 1200;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i*3+0] = (Math.random()-0.5)*80;
        pos[i*3+1] = Math.random()*40;
        pos[i*3+2] = (Math.random()-0.5)*80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9ee8ff, size: 0.8, transparent: true, opacity: 0.7 });
    bubblePoints = new THREE.Points(geo, mat);
    bubbleGroup.add(bubblePoints);
}

// Sparks (lava theme)
const sparkGroup = new THREE.Group();
sparkGroup.visible = false;
scene.add(sparkGroup);
let sparkPoints;
{
    const count = 1400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i*3+0] = (Math.random()-0.5)*80;
        pos[i*3+1] = Math.random()*30;
        pos[i*3+2] = (Math.random()-0.5)*80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xff6a2a, size: 0.9, transparent: true, opacity: 0.9 });
    sparkPoints = new THREE.Points(geo, mat);
    sparkGroup.add(sparkPoints);
}

// Sand dust (desert)
const sandGroup = new THREE.Group();
sandGroup.visible = false;
scene.add(sandGroup);
let sandPoints;
{
    const count = 2000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i*3+0] = (Math.random()-0.5)*120;
        pos[i*3+1] = Math.random()*30;
        pos[i*3+2] = (Math.random()-0.5)*120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xd9c39a, size: 0.7, transparent: true, opacity: 0.5 });
    sandPoints = new THREE.Points(geo, mat);
    sandGroup.add(sandPoints);
}

// Retro horizon grid
const retroGridGroup = new THREE.Group();
retroGridGroup.visible = false;
scene.add(retroGridGroup);
let retroGrid;
{
    retroGrid = new THREE.GridHelper(200, 50, 0xff00aa, 0x00ff88);
    retroGrid.material.transparent = true;
    retroGrid.material.opacity = 0.35;
    retroGrid.position.y = -5;
    retroGridGroup.add(retroGrid);
}

// Billboards (cyberpunk)
const billboardsGroup = new THREE.Group();
billboardsGroup.visible = false;
scene.add(billboardsGroup);
function createBillboard(x, y, z, w, h, color) {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    billboardsGroup.add(mesh);
}
createBillboard(-6, 3, -8, 4, 2, 0xff2a7a);
createBillboard(6, 4, -10, 5, 2.5, 0x2af0ff);

// Barbie world: giant hearts and ribbons
const barbieGroup = new THREE.Group();
barbieGroup.visible = false;
scene.add(barbieGroup);
function createHeart(x, y, z, s, color) {
    const grp = new THREE.Group();
    const sphGeo = new THREE.SphereGeometry(0.6*s, 16, 16);
    const coneGeo = new THREE.ConeGeometry(0.85*s, 1.3*s, 16);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.5 });
    const a = new THREE.Mesh(sphGeo, mat);
    const b = new THREE.Mesh(sphGeo, mat);
    const c = new THREE.Mesh(coneGeo, mat);
    a.position.set(-0.4*s, 0.2*s, 0);
    b.position.set(0.4*s, 0.2*s, 0);
    c.position.set(0, -0.3*s, 0);
    c.rotation.x = Math.PI;
    grp.add(a,b,c);
    grp.position.set(x,y,z);
    barbieGroup.add(grp);
}
for (let i=0;i<8;i++) createHeart((Math.random()-0.5)*20, (Math.random())*6+1, -8 - Math.random()*6, 2+Math.random()*1.5, 0xff8fc8);

// Nature: trees
const treesGroup = new THREE.Group();
treesGroup.visible = false;
scene.add(treesGroup);
function createTree(x,z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.3,2,8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.2,16,16), new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.8 }));
    const grp = new THREE.Group();
    trunk.position.y = 1;
    crown.position.y = 2.2;
    grp.add(trunk,crown);
    grp.position.set(x,0,z);
    treesGroup.add(grp);
}
for (let i=0;i<20;i++) createTree((Math.random()-0.5)*30, (Math.random()-0.5)*30-6);

// Mountains: cones
const mountainsGroup = new THREE.Group();
mountainsGroup.visible = false;
scene.add(mountainsGroup);
for (let i=0;i<18;i++) {
    const s = 2 + Math.random()*6;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(s*0.9, s*2.0, 4), new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 1 }));
    cone.position.set((Math.random()-0.5)*60, -2, -12 - Math.random()*20);
    mountainsGroup.add(cone);
}

// Beach: water + sun
const beachGroup = new THREE.Group();
beachGroup.visible = false;
scene.add(beachGroup);
let waterMesh;
{
    const geo = new THREE.PlaneGeometry(120, 120, 40, 40);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3ba7e6, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    waterMesh = new THREE.Mesh(geo, mat);
    waterMesh.rotation.x = -Math.PI/2;
    waterMesh.position.set(0,-2.2,-15);
    beachGroup.add(waterMesh);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
    sun.position.set(0,8,-30);
    beachGroup.add(sun);
}

// Ancient: columns
const ancientGroup = new THREE.Group();
ancientGroup.visible = false;
scene.add(ancientGroup);
function createColumn(x,z) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.35,5,16), new THREE.MeshStandardMaterial({ color: 0xded7c9, roughness: 0.8 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.2,16), new THREE.MeshStandardMaterial({ color: 0xcac1af }));
    shaft.position.y = 0.8;
    cap.position.y = 3.4;
    const grp = new THREE.Group();
    grp.add(shaft,cap);
    grp.position.set(x,0,z);
    ancientGroup.add(grp);
}
for (let i=0;i<6;i++) createColumn(-6 + i*2.4, -10);

// Pyramid: central pyramid
const pyramidGroup = new THREE.Group();
pyramidGroup.visible = false;
scene.add(pyramidGroup);
{
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(6, 8, 4), new THREE.MeshStandardMaterial({ color: 0xd8c080, roughness: 1 }));
    pyr.position.set(0,-2,-18);
    pyramidGroup.add(pyr);
}

// AI: floating cubes
const aiGroup = new THREE.Group();
aiGroup.visible = false;
scene.add(aiGroup);
const aiCubes = [];
for (let i=0;i<30;i++) {
    const size = 0.6 + Math.random()*0.8;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(size,size,size), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x66ccff, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.1 }));
    cube.position.set((Math.random()-0.5)*20, (Math.random())*8, -10 - Math.random()*8);
    aiCubes.push(cube);
    aiGroup.add(cube);
}

// Nebula-ish volumetric spheres
const nebulaGroup = new THREE.Group();
for (let i = 0; i < 12; i++) {
    const color = new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.7, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.15, emissive: color, emissiveIntensity: 0.4, roughness: 1, metalness: 0 });
    const geo = new THREE.SphereGeometry(6 + Math.random() * 4, 24, 24);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40);
    nebulaGroup.add(mesh);
}
scene.add(nebulaGroup);

// Floor — holographic grid
const gridSize = 20;
const gridDivisions = 20;
const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x2a8bff, 0x3f55ff);
grid.material.opacity = 0.25;
grid.material.transparent = true;
grid.position.y = -2;
scene.add(grid);

// Tic‑Tac‑Toe Board Group (vertical panel in front of the camera)
const boardGroup = new THREE.Group();
scene.add(boardGroup);

// Vertical neon panel as the game board background
const platformGeo = new THREE.BoxGeometry(8, 8, 0.2);
const platformMat = new THREE.MeshStandardMaterial({ color: 0x0b1235, metalness: 0.9, roughness: 0.25, emissive: 0x0b1235, emissiveIntensity: 0.25, transparent: true, opacity: 0.22 });
const platform = new THREE.Mesh(platformGeo, platformMat);
platform.position.set(0, 0, 0);
platform.castShadow = true;
platform.receiveShadow = true;
boardGroup.add(platform);

// Position the board vertically in front of the camera (parallel to the monitor)
boardGroup.position.set(0, 1.6, -4.0);
boardGroup.rotation.set(0, 0, 0);
// Scale the entire board down so the whole board is roughly the size of one tile
const BOARD_SCALE = 0.3;
boardGroup.scale.set(BOARD_SCALE, BOARD_SCALE, BOARD_SCALE);

// Board grid lines (glowing) aligned to the vertical panel
let lineMat = new THREE.MeshStandardMaterial({ color: 0x3ea1ff, emissive: 0x3ea1ff, emissiveIntensity: 0.85, metalness: 0.5, roughness: 0.2 });
// vertical bars
const vGeo = new THREE.BoxGeometry(0.08, 7.6, 0.04);
const v1 = new THREE.Mesh(vGeo, lineMat);
const v2 = new THREE.Mesh(vGeo, lineMat);
v1.position.set(-1.25, 0, 0.12);
v2.position.set(1.25, 0, 0.12);
boardGroup.add(v1, v2);
// horizontal bars
const hGeo = new THREE.BoxGeometry(7.6, 0.08, 0.04);
const h1 = new THREE.Mesh(hGeo, lineMat);
const h2 = new THREE.Mesh(hGeo, lineMat);
h1.position.set(0, -1.25, 0.12);
h2.position.set(0, 1.25, 0.12);
boardGroup.add(h1, h2);
// Alternative board lines container for theme-specific styling
const altLinesGroup = new THREE.Group();
boardGroup.add(altLinesGroup);

function clearAltLines() {
    while (altLinesGroup.children.length) {
        const child = altLinesGroup.children.pop();
        altLinesGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }
}

function setBoardStyle(style) {
    // grid: default v/h lines; ring: rings on each tile; tri: diagonals
    const isGrid = style === 'grid';
    [v1, v2, h1, h2].forEach((l) => (l.visible = isGrid));
    clearAltLines();
    if (style === 'ring') {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
        tiles.forEach((tile) => {
            const inner = 0.95; const outer = 1.08;
            const rim = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), mat);
            rim.position.copy(tile.position);
            rim.position.z = 0.03;
            altLinesGroup.add(rim);
            const rimGlow = new THREE.Mesh(new THREE.RingGeometry(outer, outer+0.04, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
            rimGlow.position.copy(tile.position);
            rimGlow.position.z = 0.02;
            altLinesGroup.add(rimGlow);
        });
    } else if (style === 'tri') {
        const barMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.08, 0.04), barMat);
        bar.position.set(0, 0, 0.12);
        bar.rotation.z = Math.PI / 4;
        altLinesGroup.add(bar);
        const bar2 = bar.clone();
        bar2.rotation.z = -Math.PI / 4;
        altLinesGroup.add(bar2);
    }
}

// Tiles for raycast interaction
const tiles = [];
const interactables = [];
const BASE_TILE_COLOR = 0x0f1a4a;
const tileSize = 2.5; // spacing reference
const tileGeo = new THREE.PlaneGeometry(2.3, 2.3);
let tileMat = new THREE.MeshStandardMaterial({ color: BASE_TILE_COLOR, transparent: true, opacity: 0.42, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
        const tile = new THREE.Mesh(tileGeo, tileMat.clone());
        // vertical, facing the camera (XY plane), slightly in front of panel
        tile.rotation.set(0, 0, 0);
        tile.position.set((c - 1) * tileSize, (1 - r) * tileSize, 0.11);
        tile.userData = { type: 'tile', index: r * 3 + c };
        tile.castShadow = false;
        tile.receiveShadow = true;
        tiles.push(tile);
        boardGroup.add(tile);
        interactables.push(tile);
    }
}

// Canvas-based 3D text sprite (used for labels and banner)
function createTextSprite(text, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 1024 * dpr; canvas.height = 256 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 160px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.fillText(text, (canvas.width / dpr) / 2, (canvas.height / dpr) / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    const aspect = (canvas.width / dpr) / (canvas.height / dpr);
    sprite.scale.set(6.5, 6.5 / aspect, 1);
    return sprite;
}

// (Removed 3D restart button and label in favor of 'R' key)

// Gun — simple sci‑fi blaster model (procedural)
const gun = new THREE.Group();
const barrelGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.8, 16);
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9ad0ff, metalness: 0.9, roughness: 0.25, emissive: 0x4aa0ff, emissiveIntensity: 0.2 });
const barrel = new THREE.Mesh(barrelGeo, barrelMat);
barrel.rotation.z = Math.PI / 2;
barrel.position.set(0.35, -0.05, -0.1);
barrel.castShadow = true;
gun.add(barrel);

const bodyGeo = new THREE.BoxGeometry(0.4, 0.2, 0.2);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2a66, metalness: 0.8, roughness: 0.3, emissive: 0x111d44, emissiveIntensity: 0.4 });
const body = new THREE.Mesh(bodyGeo, bodyMat);
body.position.set(0.1, -0.08, -0.1);
body.castShadow = true;
gun.add(body);

const finGeo = new THREE.BoxGeometry(0.2, 0.03, 0.3);
const fin = new THREE.Mesh(finGeo, bodyMat);
fin.position.set(-0.02, 0.06, -0.1);
gun.add(fin);

camera.add(gun);
scene.add(camera);

// Theme-specific weapon variants (attached to camera)
const wand = new THREE.Group();
{ const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,0.9,12), new THREE.MeshStandardMaterial({ color: 0xdeb887 }));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1,16,16), new THREE.MeshStandardMaterial({ color: 0xffe6f1, emissive: 0xff9ecb, emissiveIntensity: 0.9 }));
  stick.position.set(0.1,-0.1,-0.2); tip.position.set(0.4,-0.05,-0.2); wand.add(stick, tip); }
const trident = new THREE.Group();
{ const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.06,1.0,12), new THREE.MeshStandardMaterial({ color: 0x86d1ff, metalness: 0.6 }));
  const fork = new THREE.Group(); for (let i=-1;i<=1;i++){ const pr = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.3,16), new THREE.MeshStandardMaterial({ color: 0x9ee8ff, emissive: 0x67d8ff, emissiveIntensity: 0.6 })); pr.position.set(0.35, -0.05 + i*0.08, -0.2); pr.rotation.z = Math.PI; fork.add(pr);} pole.position.set(0.05,-0.1,-0.2); trident.add(pole, fork); }
const candyCane = new THREE.Group();
{ const cane = new THREE.Mesh(new THREE.TorusGeometry(0.18,0.04,16,32,Math.PI), new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xffb3da })); const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.6,12), new THREE.MeshStandardMaterial({ color: 0xffffff })); cane.position.set(0.3,-0.05,-0.2); stick.position.set(0.15,-0.35,-0.2); candyCane.add(cane, stick); }
const staff = new THREE.Group();
{ const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.07,1.1,12), new THREE.MeshStandardMaterial({ color: 0x6b4a2b })); const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: 0xb6f3ff, emissive: 0x99ebff, emissiveIntensity: 0.9 })); pole.position.set(0.0,-0.15,-0.25); crystal.position.set(0.35,-0.02,-0.22); staff.add(pole, crystal); }
const cubeEmitter = new THREE.Group();
{ const bx = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,0.22), new THREE.MeshStandardMaterial({ color: 0x0a101a, emissive: 0x66ccff, emissiveIntensity: 0.8 })); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18,0.02,12,48), new THREE.MeshStandardMaterial({ color: 0x66ccff })); bx.position.set(0.2,-0.1,-0.2); ring.position.set(0.2,-0.1,-0.2); cubeEmitter.add(bx, ring); }
const heartWand = new THREE.Group();
{ const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.04,0.8,12), new THREE.MeshStandardMaterial({ color: 0xffc1dd })); const a = new THREE.Mesh(new THREE.SphereGeometry(0.08,16,16), new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xffa3d6 })); const b = new THREE.Mesh(new THREE.SphereGeometry(0.08,16,16), new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xffa3d6 })); const c = new THREE.Mesh(new THREE.ConeGeometry(0.12,0.2,16), new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xffa3d6 })); a.position.set(0.36,-0.02,-0.2); b.position.set(0.44,-0.02,-0.2); c.position.set(0.4,-0.12,-0.2); c.rotation.z = Math.PI/6; c.rotation.x = Math.PI; stick.position.set(0.05,-0.15,-0.22); heartWand.add(stick,a,b,c); }
camera.add(wand, trident, candyCane, staff, cubeEmitter, heartWand);
const weaponVariants = { blaster: gun, wand, trident, candy: candyCane, staff, cube: cubeEmitter, heart: heartWand };
Object.values(weaponVariants).forEach(g => g.visible = false);
gun.visible = true;
let activeWeapon = 'blaster';
function setWeapon(name) { activeWeapon = name in weaponVariants ? name : 'blaster'; Object.entries(weaponVariants).forEach(([k,g]) => { g.visible = (k === activeWeapon); }); }

// Create endgame banner now that scene exists
{
    const bannerGroup = new THREE.Group();
    bannerGroup.visible = false;
    scene.add(bannerGroup);

    const bannerPanel = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 2.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x101a3e, metalness: 0.7, roughness: 0.35, emissive: 0x0a1642, emissiveIntensity: 1.1 })
    );
    bannerPanel.position.set(0, 1.6, -3.5);
    bannerGroup.add(bannerPanel);

    const bannerStripeMat = new THREE.MeshStandardMaterial({ color: 0x6fe6ff, emissive: 0x3de3ff, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.2 });
    const stripe1 = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 0.04), bannerStripeMat);
    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 0.04), bannerStripeMat);
    stripe1.position.set(0, 0.7, -0.06);
    stripe2.position.set(0, -0.7, -0.06);
    bannerGroup.add(stripe1, stripe2);

    // expose for helper functions and animation
    window.__bannerGroup = bannerGroup;
}

// Position gun relative to camera
function updateGunPosition() {
    gun.position.set(0.6, -0.42, -0.8);
    gun.rotation.set(0.05, -0.2, -0.05);
    [wand,trident,candyCane,staff,cubeEmitter,heartWand].forEach((g)=>{ g.position.set(0.2,-0.15,-0.2); g.rotation.set(0.0,-0.2,0.0); });
}
updateGunPosition();

// Projectile pool
const projectiles = [];
let projectileMat = new THREE.MeshStandardMaterial({ color: 0x9fffd1, emissive: 0x42ffb3, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.1 });
let projectileFactory = () => new THREE.Mesh(new THREE.SphereGeometry(0.06,12,12), projectileMat);
function setProjectileStyle(style) {
    if (style === 'bubble') { projectileMat = new THREE.MeshStandardMaterial({ color: 0x9ee8ff, transparent: true, opacity: 0.7, metalness: 0.1, roughness: 0.1, emissive: 0x67d8ff, emissiveIntensity: 0.6 }); projectileFactory = () => new THREE.Mesh(new THREE.SphereGeometry(0.08,16,16), projectileMat); }
    else if (style === 'ember') { projectileMat = new THREE.MeshStandardMaterial({ color: 0xffa266, emissive: 0xff3b00, emissiveIntensity: 1.0, metalness: 0.0, roughness: 0.3 }); projectileFactory = () => new THREE.Mesh(new THREE.SphereGeometry(0.06,12,12), projectileMat); }
    else if (style === 'cube') { projectileMat = new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x66ccff, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.1 }); projectileFactory = () => new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.08), projectileMat); }
    else if (style === 'snow') { projectileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }); projectileFactory = () => new THREE.Mesh(new THREE.SphereGeometry(0.06,10,10), projectileMat); }
    else if (style === 'heart') { const mat = new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xffb3da, emissiveIntensity: 0.8 }); projectileFactory = () => { const grp = new THREE.Group(); const a = new THREE.Mesh(new THREE.SphereGeometry(0.05,12,12), mat); const b = new THREE.Mesh(new THREE.SphereGeometry(0.05,12,12), mat); const c = new THREE.Mesh(new THREE.ConeGeometry(0.08,0.12,12), mat); a.position.set(-0.04,0.02,0); b.position.set(0.04,0.02,0); c.position.set(0,-0.04,0); c.rotation.x = Math.PI; grp.add(a,b,c); return grp; }; }
    else { projectileMat = new THREE.MeshStandardMaterial({ color: 0x9fffd1, emissive: 0x42ffb3, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.1 }); projectileFactory = () => new THREE.Mesh(new THREE.SphereGeometry(0.06,12,12), projectileMat); }
}

function spawnProjectile() {
    const mesh = projectileFactory();
    mesh.position.copy(camera.position);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    mesh.userData = {
        velocity: forward.multiplyScalar(25),
        life: 2.0,
    };
    scene.add(mesh);
    projectiles.push(mesh);
    // small recoil
    gun.rotation.z -= 0.06;
}

// Raycaster for hits
const raycaster = new THREE.Raycaster();

// Fire logic — place mark if hitting an empty tile
let firstShotAfterLock = false;
async function fireShot() {
    if (!canMove) return;
    if (MULTI.mode === 'multi') {
        if (STATE.gameOver) return;
        if (!MULTI.player || STATE.turn !== MULTI.player) return;
        if (MULTI.shotUsed) return;
        playBlaster();
        spawnProjectile();
        setTimeout(async () => {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            const intersects = raycaster.intersectObjects(interactables, false);
            let hitIdx = null;
            if (intersects.length) {
                const obj = intersects[0].object;
                if (obj.userData.type === 'tile') {
                    hitIdx = obj.userData.index;
                }
            }
            MULTI.shotUsed = true;
            try {
                const fs = MULTI.fs;
                if (!fs || !MULTI.roomRef) return;
                await fs.runTransaction(MULTI.db, async (tx) => {
                    const snap = await tx.get(MULTI.roomRef);
                    if (!snap.exists()) return;
                    const data = snap.data();
                    if (data.gameOver) return;
                    if (data.turn !== MULTI.player) return;
                    const board = Array.isArray(data.board) ? data.board.slice(0,9) : Array(9).fill(null);
                    let placed = false;
                    if (hitIdx != null && board[hitIdx] == null) {
                        board[hitIdx] = MULTI.player;
                        placed = true;
                    }
                    const res = evaluateBoard(board);
                    const over = !!(res.winner || res.draw);
                    const nextTurn = over ? data.turn : (data.turn === 'X' ? 'O' : 'X');
                    tx.set(MULTI.roomRef, {
                        board,
                        turn: nextTurn,
                        gameOver: over,
                        lastMove: { idx: placed ? hitIdx : null, by: MULTI.player, missed: !placed, at: fs.serverTimestamp() },
                    }, { merge: true });
                });
            } catch (err) {
                console.error(err);
                setMpNote('Shot not applied.');
            }
        }, 80);
        return;
    }
    // single player flow
    playBlaster();
    spawnProjectile();
    setTimeout(() => {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(interactables, false);
        if (intersects.length) {
            const obj = intersects[0].object;
            if (obj.userData.type === 'restart') {
                restart();
                return;
            }
            if (obj.userData.type === 'tile' && !STATE.gameOver) {
                const idx = obj.userData.index;
                if (!STATE.board[idx]) {
                    placeMark(idx, STATE.turn);
                    const result = evaluateBoard(STATE.board);
                    if (result.winner) {
                        STATE.gameOver = true;
                        highlightWin(result.line);
                        const msg = `Player ${result.winner} wins!`;
                        UI.status.textContent = msg;
                        showBanner(msg);
                        speak(msg);
                        UI.restartButton.classList.remove('hidden');
                    } else if (result.draw) {
                        STATE.gameOver = true;
                        const msg = 'Draw game';
                        UI.status.textContent = msg;
                        showBanner(msg);
                        speak(msg);
                        UI.restartButton.classList.remove('hidden');
                    } else {
                        STATE.turn = STATE.turn === 'X' ? 'O' : 'X';
                        updateTurnHUD();
                    }
                }
            }
        }
    }, 80);
}

window.addEventListener('mousedown', (e) => {
    if (IS_MOBILE) return; // mobile uses pointer/touch handlers
    // Allow shooting restart button even after gameOver
    if (!canMove) return;
    if (e.button !== 0) return; // left click only
    if (!controls.isLocked) {
        controls.lock();
        firstShotAfterLock = true;
        return; // don't fire when initiating lock
    }
    if (firstShotAfterLock) { firstShotAfterLock = false; return; }
    fireShot();
});

// Mouse look fallback (when not pointer-locked)
window.addEventListener('mousemove', (e) => {
    if (controls.isLocked || !canMove) return;
    const sensitivity = 0.0022;
    controls.getObject().rotation.y -= e.movementX * sensitivity;
    camera.rotation.x -= e.movementY * sensitivity;
    camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
});

// Touch controls: one finger aims, second finger taps shoots (mobile only)
let touchAimPointerId = null;
const pointerIdToLastPos = new Map();
if (IS_MOBILE) {
    window.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        if (!canMove) startGame();
        if (touchAimPointerId === null) {
            touchAimPointerId = e.pointerId;
            pointerIdToLastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        } else {
            // Second finger tap shoots immediately
            fireShot();
        }
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'touch') return;
        if (!canMove) return;
        if (e.pointerId !== touchAimPointerId) return;
        e.preventDefault();
        const prev = pointerIdToLastPos.get(e.pointerId);
        if (!prev) {
            pointerIdToLastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
            return;
        }
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointerIdToLastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const sensitivity = 0.0030; // slightly higher for touch
        controls.getObject().rotation.y -= dx * sensitivity;
        camera.rotation.x -= dy * sensitivity;
        camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    }, { passive: false });

    const clearTouchPointer = (e) => {
        if (e.pointerType !== 'touch') return;
        pointerIdToLastPos.delete(e.pointerId);
        if (e.pointerId === touchAimPointerId) {
            touchAimPointerId = null;
        }
    };
    window.addEventListener('pointerup', clearTouchPointer);
    window.addEventListener('pointercancel', clearTouchPointer);
}

// Hide top-right restart button on desktop (R key/3D flow), show via JS on mobile when needed
if (UI.restartButton && !IS_MOBILE) {
    UI.restartButton.style.display = 'none';
}

function localRestartVisualOnly() {
    STATE.board.fill(null);
    STATE.turn = 'X';
    STATE.gameOver = false;
    UI.status.textContent = '';
    UI.restartButton.classList.add('hidden');
    hideBanner();
    tiles.forEach((t) => {
        t.material.color.setHex(BASE_TILE_COLOR);
        t.material.opacity = 0.35;
        if (t.userData.markMesh) {
            t.remove(t.userData.markMesh);
            if (t.userData.markMesh.geometry) t.userData.markMesh.geometry.dispose();
            if (t.userData.markMesh.children && t.userData.markMesh.children.length) {
                t.userData.markMesh.children.forEach((child) => child.geometry && child.geometry.dispose());
            }
            t.userData.markMesh = undefined;
        }
        if (t.userData.glow) {
            t.remove(t.userData.glow);
            t.userData.glow.geometry.dispose();
            t.userData.glow = undefined;
        }
    });
    if (boardGroup.userData.winLine) {
        boardGroup.remove(boardGroup.userData.winLine);
        boardGroup.userData.winLine.geometry.dispose();
        boardGroup.userData.winLine = undefined;
    }
    updateTurnHUD();
}

async function restart() {
    if (MULTI.mode === 'multi' && MULTI.roomRef && MULTI.fs) {
        const fs = MULTI.fs;
        try {
            await fs.setDoc(MULTI.roomRef, {
                board: Array(9).fill(null),
                turn: 'X',
                gameOver: false,
                lastMove: null,
                resetAt: fs.serverTimestamp(),
            }, { merge: true });
            setMpNote('Game reset.');
        } catch (e) {
            console.error(e);
            setMpNote('Failed to reset.');
        }
        return;
    }
    localRestartVisualOnly();
}

// Create X/O meshes
const neonXMaterial = new THREE.MeshStandardMaterial({ color: 0x88b6ff, emissive: 0x3d84ff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.2 });
const neonOMaterial = new THREE.MeshStandardMaterial({ color: 0x9dffd6, emissive: 0x1aff9a, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.2 });

function createXMark() {
    const group = new THREE.Group();
    const armGeo = new THREE.BoxGeometry(1.6, 0.12, 0.25);
    const a = new THREE.Mesh(armGeo, neonXMaterial);
    const b = new THREE.Mesh(armGeo, neonXMaterial);
    a.rotation.z = Math.PI / 4;
    b.rotation.z = -Math.PI / 4;
    group.position.z = 0.06; // float slightly off the board plane
    group.add(a, b);
    return group;
}

function createOMark() {
    const torusGeo = new THREE.TorusGeometry(0.9, 0.14, 16, 64);
    const mesh = new THREE.Mesh(torusGeo, neonOMaterial);
    mesh.rotation.y = 0; // face the camera
    mesh.position.z = 0.06;
    return mesh;
}

function placeMark(index, mark) {
    STATE.board[index] = mark;
    const tile = tiles[index];
    let mesh;
    if (mark === 'X') mesh = createXMark(); else mesh = createOMark();
    tile.add(mesh);
    tile.userData.markMesh = mesh;
    pulseTile(tile, mark === 'X' ? 0x2460ff : 0x16ff9a);
}

function pulseTile(tile, colorHex) {
    tile.material.color.setHex(colorHex);
    tile.material.opacity = 0.6;
    const glowGeo = new THREE.RingGeometry(1.0, 1.2, 32);
    const glowMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = 0.02;
    tile.add(glow);
    tile.userData.glow = glow;
}

// Win detection
const LINES = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6],         // diags
];

function evaluateBoard(board) {
    for (const line of LINES) {
        const [a,b,c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], line };
        }
    }
    if (board.every(Boolean)) return { winner: null, draw: true };
    return { winner: null, draw: false };
}

function highlightWin(line) {
    // Compute positions in boardGroup local space
    const idxToLocal = (idx) => tiles[idx].position.clone();
    const a = idxToLocal(line[0]);
    const c = idxToLocal(line[2]);
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const length = a.distanceTo(c) + 1.6;
    const coreGeo = new THREE.CylinderGeometry(0.12, 0.12, length, 24);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3a6, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.98 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    const haloGeo = new THREE.CylinderGeometry(0.2, 0.2, length, 24);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff3a6, transparent: true, opacity: 0.45 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    const winMesh = new THREE.Group();
    winMesh.add(core, halo);
    winMesh.position.copy(mid);
    winMesh.position.y = 0.3;
    // Align along vector from a to c in board space
    const dir = c.clone().sub(a).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const axis = up.clone().cross(dir).normalize();
    const angle = Math.acos(up.clone().dot(dir));
    if (axis.lengthSq() > 0.0001) {
        winMesh.quaternion.setFromAxisAngle(axis, angle);
    }
    boardGroup.add(winMesh);
    boardGroup.userData.winLine = winMesh;
}

// Hover highlight (optional subtle glow under crosshair)
const hoverColor = new THREE.Color(0x2a9dff);

function updateHover() {
    if (STATE.gameOver) return;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(interactables, false);
    tiles.forEach((t) => t.material.emissive && t.material.emissive.setHex(0x000000));
    if (intersects.length) {
        const obj = intersects[0].object;
        if (obj.userData.type === 'tile') {
            if (!STATE.board[obj.userData.index]) {
                if (!obj.material.emissive) obj.material.emissive = new THREE.Color(hoverColor);
                obj.material.emissive.set(hoverColor);
                obj.material.emissiveIntensity = 0.3;
            }
        }
    }
}

// Animate
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // environment animations
    stars.rotation.y += 0.002 * delta * 60;
    nebulaGroup.rotation.y -= 0.001 * delta * 60;
    cloudParticles.forEach((p)=>{ p.position.x += Math.sin(clock.elapsedTime*0.1 + p.position.z)*0.002; });
    if (snowPoints) { snowPoints.rotation.y += 0.02*delta; }
    if (bubblePoints) { bubblePoints.position.y += Math.sin(clock.elapsedTime)*0.005; }
    if (sparkPoints) { sparkPoints.rotation.y -= 0.02*delta; }
    if (sandPoints) { sandPoints.rotation.y += 0.01*delta; }
    if (retroGrid) { retroGrid.rotation.y += 0.01*delta; }
    billboardsGroup.children.forEach((b)=>{ b.material.opacity = 0.6 + 0.4*Math.sin(clock.elapsedTime*2 + b.position.x); });
    if (waterMesh) { const pos = waterMesh.geometry.attributes.position; for (let i=0;i<pos.count;i++){ const x=pos.getX(i), y=pos.getY(i); pos.setZ(i, Math.sin((x+y)*0.2 + clock.elapsedTime*2.0)*0.2); } pos.needsUpdate = true; waterMesh.geometry.computeVertexNormals(); }
    aiCubes.forEach((c)=>{ c.rotation.x += 0.4*delta; c.rotation.y += 0.6*delta; });

    // board slow drift within plane
    // Smooth continuous sinusoidal drift in-plane with higher amplitude
    if (!boardGroup.userData.motion) {
        boardGroup.userData.motion = {
            base: new THREE.Vector3(0, 1.6, -4.0),
            ampX: 3.2,
            ampY: 1.8,
            freqX: 0.45,
            freqY: 0.36,
            ph1: Math.random() * Math.PI * 2,
            ph2: Math.random() * Math.PI * 2,
            ph3: Math.random() * Math.PI * 2,
            ph4: Math.random() * Math.PI * 2,
        };
    }
    const m = boardGroup.userData.motion;
    const t1 = clock.elapsedTime;
    const x = m.ampX * (Math.sin(m.freqX * t1 + m.ph1) + 0.45 * Math.sin(m.freqX * 1.7 * t1 + m.ph2));
    const yOff = m.ampY * (Math.cos(m.freqY * t1 + m.ph3) + 0.35 * Math.sin(m.freqY * 1.3 * t1 + m.ph4));
    boardGroup.position.x = m.base.x + x;
    boardGroup.position.y = m.base.y + yOff;

    // projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.position.addScaledVector(p.userData.velocity, delta);
        p.userData.life -= delta;
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.geometry.dispose();
            projectiles.splice(i, 1);
        }
    }

    // gun spring-back
    gun.rotation.z += (0 - gun.rotation.z) * 0.18;
    // subtle gun sway based on camera orientation for smoothness
    const sway = 0.02;
    const swayT = performance.now() * 0.001;
    gun.position.x = 0.6 + Math.sin(swayT * 1.6) * sway;
    gun.position.y = -0.42 + Math.cos(swayT * 1.8) * sway * 0.6;

    // movement
    if (canMove) {
        direction.set(Number(keys.d) - Number(keys.a), 0, Number(keys.s) - Number(keys.w));
        direction.normalize();
        const speed = 3.5;
        velocity.x += direction.x * speed * delta;
        velocity.z += direction.z * speed * delta;
        velocity.multiplyScalar(0.86);
        controls.moveRight(velocity.x * delta);
        controls.moveForward(velocity.z * delta);
        // keyboard look (arrow keys)
        const lookSpeed = 1.2;
        if (lookKeys.left) controls.getObject().rotation.y += lookSpeed * delta;
        if (lookKeys.right) controls.getObject().rotation.y -= lookSpeed * delta;
        if (lookKeys.up) camera.rotation.x += lookSpeed * 0.6 * delta;
        if (lookKeys.down) camera.rotation.x -= lookSpeed * 0.6 * delta;
        camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    }

    // Banner pulse animation (text only)
    const bg = window.__bannerGroup;
    if (bg && bg.visible && bg.userData && bg.userData.active) {
        const t2 = bg.userData.t + delta;
        bg.userData.t = t2;
        const s = 0.85 + 0.08 * Math.sin(t2 * 4.0);
        if (bg.userData.textSprite) bg.userData.textSprite.scale.set(6.5 * s, bg.userData.textSprite.scale.y * (s / (bg.userData.textSprite.scale.x/6.5)), 1);
    }

    updateHover();

    renderer.render(scene, camera);
}
animate();

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


