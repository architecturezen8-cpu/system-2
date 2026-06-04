// ==========================================
// SCORER.JS - V33.1 FULLY FIXED
// ==========================================

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    FIREBASE: {
        apiKey: "AIzaSyA3SPSsNTwK6doYq-lpKTozGgRha9HObFI",
        authDomain: "stc-score-v3.firebaseapp.com",
        databaseURL: "https://stc-score-v3-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "stc-score-v3",
        storageBucket: "stc-score-v3.firebasestorage.app",
        messagingSenderId: "626214005830",
        appId: "1:626214005830:web:bd50292e589b0d34896e47"
    },
    CACHE: {
        TEAMS_KEY: 'stc_teams_cache_v2',
        VERSION_KEY: 'stc_data_version_v2',
        MAX_AGE_MS: 24 * 60 * 60 * 1000
    },
    TIMING: {
        HYPE_FOUR: 2500,
        HYPE_SIX: 2500,
        HYPE_WICKET: 3000,
        PROFILE_DURATION: 5000,
        RESULT_DELAY: 3000,
        ALL_OUT_DELAY: 4000,
        AUTO_BOWLER_POPUP_DELAY: 800
    }
};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = '';
let scorerName = '';

let autoRealtimeEnabled = localStorage.getItem('scorer_auto_realtime') !== '0';
let hasPendingManualPush = false;
let pendingCommandQueue = [];

let batteryManager = null;
let deviceWatchInterval = null;
let lastScorebarPingMs = null;

let batteryState = {
    supported: false, level: null, charging: null, low: false, critical: false
};

let networkState = {
    online: navigator.onLine, rawType: 'unknown', effectiveType: 'unknown',
    label: 'Unknown', signalBars: 0, signalPct: 0, downlink: 0, rtt: 0, unstable: false
};

let deviceAlertFlags = { lowShown: false, criticalShown: false, unstableShown: false };

// Run Out popup state
let pendingRunOutResolve = null;
let previousTarget = 0;

let firebaseApp = null;
let database = null;
let isConnected = false;
let adminOnline = false;
let scorebarOnline = false;
let messagesSent = 0;

let selfPingMs = null;
let presenceRefreshInterval = null;
let currentTeamsVersion = 0;
let activeMatchListeners = [];

// Command replay protection
let lastProcessedCommandTs = 0;
let commandListenerInitialized = false;

let matchState = {
    runs: 0, wkts: 0, overs: '0.0', balls: 0, thisOver: [],
    target: 0, totOvers: 20, crr: '0.00', striker: 1, isFreeHit: false,
    partRuns: 0, partBalls: 0,
    bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bowler: { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 },
    battingTeam: '', bowlingTeam: '',
    prevInnings: null, isMatchEnded: false,
    dismissedPlayers: [],
    winProb: 50, // ✅ FIX: Win probability for WinViz chart sync
    overRunsHistory: [], // ✅ FIX: Per-over runs history for chart sync across devices
    partnershipHistory: [], // [PARTNERSHIP FIX] Historical partnerships for chart sync
    _wicketOutSlot: null // ✅ එකතු කරන්න
};

let lockStates = { score: false, batsmen: false, bowler: false, full: false };

let battingPlayers = [];
let bowlingPlayers = [];
let bowlerHistory = [];
let allTeams = [];
let allPlayersData = [];

let currentExtrasType = '';
let currentPickerSlot = 0;
let selectedNextBowler = null;
let pendingBowlerPopup = false;
let pendingWicketOutSlot = null; // ✅ FIX: Run Out correct slot tracker

let updaterAutoSettings = { autoHype: true, autoProfile: true, autoResult: true };
let winnerPopupTimer = null;

// ==========================================
// TOAST
// ==========================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const icon = document.getElementById('toastIcon');
    const text = document.getElementById('toastText');
    if (icon) icon.innerText = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    if (text) text.innerText = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==========================================
// SAFE HTML ESCAPE
// ==========================================
function escapeWcHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// CACHE HELPERS
// ==========================================
function loadTeamsFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached) return null;
        const data = JSON.parse(cached);
        if (Date.now() - (data.timestamp || 0) > CONFIG.CACHE.MAX_AGE_MS) return null;
        return data;
    } catch (e) { return null; }
}

function saveTeamsToCache(teamsData, playersData, version) {
    try {
        localStorage.setItem(CONFIG.CACHE.TEAMS_KEY, JSON.stringify({
            teams: teamsData, players: playersData, version, timestamp: Date.now()
        }));
    } catch (e) { console.warn('Cache save failed:', e); }
}

async function getTeamsServerVersion() {
    try {
        const snap = await database.ref('data_version/teams').once('value');
        return snap.val() || 0;
    } catch (e) { return 0; }
}

async function isTeamsCacheValid(cachedData) {
    if (!cachedData || !cachedData.version) return false;
    const serverVersion = await getTeamsServerVersion();
    return !(serverVersion > cachedData.version);
}

function clearTeamsCache() {
    localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏏 Scorer V33.1 Initializing...');

    // ⚡ INIT AUTH SYSTEM - Score Updater role ekata check karanna
    if (typeof initPageAuth === 'function') {
        initPageAuth('scorer');
    } else {
        console.error('Auth.js not loaded!');
    }

    // ⚡ WAIT FOR AUTH APPROVAL before loading match data
    document.addEventListener('auth-approved', (e) => {
        const { user, userData } = e.detail || {};
        console.log('✅ Auth approved for scorer!', userData);

        // Auto-fill scorer name from Google Account
        if (user) {
            const nameInput = document.getElementById('inputScorerName');
            if (nameInput && !nameInput.value) {
                nameInput.value = user.displayName || '';
            }

            // 👤 Show logged-in user profile at top of scorer header
            injectScorerProfileBadge(user);
        }
    });

    // ✅ LISTEN FOR ACCESS REVOCATION
    document.addEventListener('auth-revoked', (e) => {
        const { reason, isRoleRevoke } = e.detail || {};

        // ✅ FIX: Check if scorer screen is active
        const scorerScreen = document.getElementById('scorerScreen');
        const isInsideApp = scorerScreen && scorerScreen.classList.contains('active');

        if (!isInsideApp) {
            console.warn('🚫 Auth revoked but not inside scorer — ignoring');
            return;
        }

        console.warn('🚫 Access revoked:', reason, isRoleRevoke ? '(role revoke)' : '(status deny)');

        // Stop all real-time connections
        stopPresenceRefresh();
        clearMatchListeners();

        // Set offline presence
        if (database && matchId) {
            database.ref(`presence/${matchId}/updater`).set({
                online: false, lastSeen: Date.now(),
                name: scorerName || '', version: '33.1', pingMs: 0
            }).catch(() => { });
        }

        // Clear connection state
        isConnected = false;
        selfPingMs = null;

        // Remove profile badge
        const badge = document.getElementById('scorerProfileBadge');
        if (badge) badge.remove();

        // ✅ Show login screen (auth.js handles showing No Access popup)
        showLoginScreen();

        // ✅ If role revoke, show helpful message
        if (isRoleRevoke) {
            showToast('⚠️ Scorer access removed. You can request it again.', 'error');
        } else {
            showToast('⚠️ Access revoked: ' + (reason || 'Contact admin'), 'error');
        }
        safeVibrate([300, 100, 300, 100, 500]);
    });

    initFirebase();
    loadRecentMatches();

    const savedMatchId = localStorage.getItem('scorer_matchId');
    const savedScorerName = localStorage.getItem('scorer_name');
    if (savedMatchId) document.getElementById('inputMatchId').value = savedMatchId;
    if (savedScorerName) document.getElementById('inputScorerName').value = savedScorerName;

    setupRealtimeModeUI();
    bindDeviceAlertEvents();
    await initDeviceMonitoring();
    updatePingDisplay();
    updateDeviceStatusUI();
});

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
function initFirebase() {
    try {
        if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
        if (!firebase.apps.length) firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        else firebaseApp = firebase.apps[0];
        database = firebase.database();
        setupLoginConnectionStatus();
        console.log('✅ Firebase initialized');
        return true;
    } catch (e) {
        console.error('❌ Firebase init failed:', e);
        updateLoginDbStatus('error', 'Firebase failed to load');
        return false;
    }
}

function setupLoginConnectionStatus() {
    if (!database) return;
    database.ref('.info/connected').on('value', (snap) => {
        updateLoginDbStatus(
            snap.val() === true ? 'connected' : 'connecting',
            snap.val() === true ? 'Connected to Database' : 'Connecting...'
        );
    });
}

function updateLoginDbStatus(status, text) {
    const dot = document.getElementById('loginDbDot');
    const textEl = document.getElementById('loginDbText');
    if (dot) dot.className = 'db-dot ' + status;
    if (textEl) textEl.innerText = text;
}

// ==========================================
// LISTENER HELPERS
// ==========================================
function addMatchValueListener(path, callback) {
    if (!database) return null;
    const ref = database.ref(path);
    const handler = (snap) => callback(snap);
    ref.on('value', handler);
    activeMatchListeners.push({ ref, handler });
    return ref;
}

function clearMatchListeners() {
    activeMatchListeners.forEach(({ ref, handler }) => ref.off('value', handler));
    activeMatchListeners = [];
}

// ==========================================
// PING DISPLAY UI
// ==========================================
function renderPingBar(textId, fillId, ms, isOnline = true) {
    const pingText = document.getElementById(textId);
    const pingFill = document.getElementById(fillId);
    if (!pingText || !pingFill) return;

    if (!isOnline || ms === null || ms === undefined || Number.isNaN(ms) || ms <= 0) {
        pingText.innerText = '-- ms';
        pingFill.style.width = '0%';
        pingFill.style.background = 'var(--danger)';
        return;
    }

    pingText.innerText = `${ms} ms`;
    let pct = 100, color = 'var(--success)';
    if (ms <= 60) { pct = 100; color = 'var(--success)'; }
    else if (ms <= 120) { pct = 80; color = 'var(--success)'; }
    else if (ms <= 220) { pct = 60; color = 'var(--warning)'; }
    else if (ms <= 350) { pct = 40; color = 'var(--warning)'; }
    else { pct = 18; color = 'var(--danger)'; }
    pingFill.style.width = `${pct}%`;
    pingFill.style.background = color;
}

function updatePingDisplay() {
    renderPingBar('realtimePingMsText', 'realtimePingFill', selfPingMs, isConnected && navigator.onLine);
    renderPingBar('scorebarPingMsText', 'scorebarPingFill', lastScorebarPingMs, scorebarOnline);
}

// ==========================================
// DEVICE MONITORING
// ==========================================
function bindDeviceAlertEvents() {
    const overlay = document.getElementById('deviceAlertOverlay');
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDeviceAlert();
    });
}

function setupRealtimeModeUI() {
    const toggle = document.getElementById('realtimeToggle');
    if (toggle) toggle.checked = autoRealtimeEnabled;
    updateRealtimeModeUI();
}

function toggleRealtimeMode(forceValue = null) {
    const toggle = document.getElementById('realtimeToggle');
    autoRealtimeEnabled = typeof forceValue === 'boolean' ? forceValue : !!toggle?.checked;
    localStorage.setItem('scorer_auto_realtime', autoRealtimeEnabled ? '1' : '0');
    updateRealtimeModeUI();
    refreshUpdaterPresence();
    if (autoRealtimeEnabled) {
        showToast('Realtime ON', 'success');
        if (hasPendingManualPush) manualPushNow();
    } else {
        showToast('Realtime OFF - use Manual Push', 'success');
    }
}

function updateRealtimeModeUI() {
    const fab = document.getElementById('manualPushFab');
    const fabText = document.getElementById('manualPushFabText');
    const modeLabel = document.getElementById('deviceRealtimeLabel');
    if (modeLabel) modeLabel.innerText = autoRealtimeEnabled ? 'AUTO' : (hasPendingManualPush ? 'MANUAL • PENDING' : 'MANUAL');
    if (fab) {
        fab.classList.toggle('show', !autoRealtimeEnabled);
        fab.classList.toggle('pending', hasPendingManualPush);
    }
    if (fabText) fabText.innerText = hasPendingManualPush ? 'Manual Push • Pending' : 'Manual Push';
}

function setPendingManualPush(flag = true) {
    hasPendingManualPush = !!flag;
    updateRealtimeModeUI();
    refreshUpdaterPresence();
}

async function pushPayloadNow(payload) {
    await Promise.all([
        database.ref(`matches/${matchId}/scorer_update`).set(payload),
        database.ref(`matches/${matchId}/live`).update(payload)
    ]);
    messagesSent++;
    updateTechPanel();
}

async function flushQueuedCommands() {
    if (!pendingCommandQueue.length || !database || !isConnected) return;
    const queue = [...pendingCommandQueue];
    pendingCommandQueue = [];
    for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        await database.ref(`matches/${matchId}/command`).set({
            event: item.event, payload: item.payload,
            ts: firebase.database.ServerValue.TIMESTAMP
        });
        messagesSent++;
        updateTechPanel();
        await new Promise(resolve => setTimeout(resolve, 120));
    }
}

async function manualPushNow() {
    if (!database || !isConnected) { showToast('Not connected', 'error'); return; }
    const fab = document.getElementById('manualPushFab');
    if (fab) fab.classList.add('loading');
    try {
        const payload = buildUpdatePayload();
        await pushPayloadNow(payload);
        await flushQueuedCommands();
        setPendingManualPush(false);
        showToast('Manual push sent', 'success');
    } catch (e) {
        console.error('Manual push failed:', e);
        showToast('Manual push failed', 'error');
    } finally {
        if (fab) fab.classList.remove('loading');
        refreshUpdaterPresence();
    }
}

async function initDeviceMonitoring() {
    await setupBatteryMonitoring();
    readNetworkInfo();
    updateDeviceStatusUI();
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
        conn.addEventListener('change', handleConnectionInfoChange);
    }
    if (deviceWatchInterval) clearInterval(deviceWatchInterval);
    deviceWatchInterval = setInterval(() => {
        readNetworkInfo();
        refreshUpdaterPresence();
    }, 15000);
}

async function setupBatteryMonitoring() {
    if (!('getBattery' in navigator)) {
        batteryState.supported = false;
        updateDeviceStatusUI();
        return;
    }
    try {
        batteryManager = await navigator.getBattery();
        batteryState.supported = true;
        syncBatteryState();
        batteryManager.addEventListener('levelchange', syncBatteryState);
        batteryManager.addEventListener('chargingchange', syncBatteryState);
    } catch (e) {
        batteryState.supported = false;
        updateDeviceStatusUI();
    }
}

function syncBatteryState() {
    if (!batteryManager) return;
    const level = Math.round((batteryManager.level || 0) * 100);
    const charging = !!batteryManager.charging;
    batteryState = {
        supported: true, level, charging,
        low: !charging && level <= 30,
        critical: !charging && level <= 15
    };
    updateDeviceStatusUI();
    evaluateDeviceAlerts();
    refreshUpdaterPresence();
}

function handleConnectionInfoChange() {
    readNetworkInfo();
    refreshUpdaterPresence();
}

function normalizeConnectionLabel(rawType, effectiveType, downlink, rtt) {
    if (!navigator.onLine) return 'OFFLINE';
    const type = String(rawType || '').toLowerCase();
    const eff = String(effectiveType || '').toLowerCase();
    if (type.includes('wifi')) return 'WIFI';
    if (type.includes('ethernet')) return 'LAN';
    if (type.includes('cellular')) {
        if (eff === 'slow-2g' || eff === '2g') return '2G';
        if (eff === '3g') return '3G';
        if (eff === '4g') return ((downlink || 0) >= 20 && (rtt || 999) <= 80) ? '5G' : '4G';
        return 'CELLULAR';
    }
    if (eff === 'slow-2g' || eff === '2g') return '2G';
    if (eff === '3g') return '3G';
    if (eff === '4g') return ((downlink || 0) >= 20 && (rtt || 999) <= 80) ? '5G' : '4G';
    return 'ONLINE';
}

function calculateSignalBars(rawType, effectiveType, downlink, rtt, pingMs) {
    if (!navigator.onLine) return 0;
    let score = 2;
    const type = String(rawType || '').toLowerCase();
    const eff = String(effectiveType || '').toLowerCase();
    if (type.includes('wifi') || type.includes('ethernet')) score = 4;
    else if (eff === 'slow-2g' || eff === '2g') score = 1;
    else if (eff === '3g') score = 2;
    else if (eff === '4g') score = 3;
    if ((downlink || 0) >= 15) score += 1;
    if ((rtt || 0) > 250) score -= 1;
    if (pingMs !== null && pingMs > 300) score -= 1;
    if (pingMs !== null && pingMs > 500) score -= 1;
    return Math.max(0, Math.min(4, score));
}

function readNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const rawType = conn?.type || (navigator.onLine ? 'unknown' : 'offline');
    const effectiveType = conn?.effectiveType || 'unknown';
    const downlink = Number(conn?.downlink || 0);
    const rtt = Number(conn?.rtt || 0);
    const label = normalizeConnectionLabel(rawType, effectiveType, downlink, rtt);
    const signalBars = calculateSignalBars(rawType, effectiveType, downlink, rtt, selfPingMs);
    const signalPct = Math.round((signalBars / 4) * 100);
    const unstable = navigator.onLine && (
        signalBars <= 1 ||
        (selfPingMs !== null && selfPingMs > 450) ||
        rtt > 700 ||
        String(effectiveType || '').toLowerCase() === 'slow-2g'
    );
    networkState = { online: navigator.onLine, rawType, effectiveType, label, signalBars, signalPct, downlink, rtt, unstable };
    updateDeviceStatusUI();
    evaluateDeviceAlerts();
    return networkState;
}

function signalBarsText(bars) {
    return ['○○○○', '●○○○', '●●○○', '●●●○', '●●●●'][bars] || '○○○○';
}

function updateDeviceStatusUI() {
    const batteryEl = document.getElementById('deviceBatteryText');
    const networkEl = document.getElementById('deviceNetworkText');
    const signalEl = document.getElementById('deviceSignalText');
    const visualBat = document.getElementById('visualBatteryFill');

    if (batteryEl) {
        batteryEl.innerText = batteryState.supported
            ? `${batteryState.level ?? 0}%${batteryState.charging ? ' ⚡' : ''}` : 'Unsupported';
        if (visualBat && batteryState.supported) {
            visualBat.style.width = `${batteryState.level ?? 0}%`;
            visualBat.style.background = (batteryState.level <= 20 && !batteryState.charging) ? '#ff3366' : '#00ffcc';
        }
    }
    if (networkEl) networkEl.innerText = networkState.online ? networkState.label : 'OFFLINE';
    if (signalEl) signalEl.innerText = networkState.online
        ? `${signalBarsText(networkState.signalBars)} (${networkState.signalPct}%)${networkState.unstable ? ' • unstable' : ''}` : 'No signal';
}

function safeVibrate(pattern = [180, 100, 220]) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

function showDeviceAlert(type, title, message, meta = '') {
    const overlay = document.getElementById('deviceAlertOverlay');
    const card = document.getElementById('deviceAlertCard');
    const titleEl = document.getElementById('deviceAlertTitle');
    const msgEl = document.getElementById('deviceAlertMessage');
    const metaEl = document.getElementById('deviceAlertMeta');
    if (!overlay || !card) return;
    card.classList.remove('alert-low', 'alert-critical', 'alert-network');
    if (type === 'critical') card.classList.add('alert-critical');
    else if (type === 'low') card.classList.add('alert-low');
    else card.classList.add('alert-network');
    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    if (metaEl) metaEl.innerText = meta;
    overlay.classList.add('show');
    safeVibrate([120, 80, 120, 80, 260]);
}

function closeDeviceAlert() {
    const overlay = document.getElementById('deviceAlertOverlay');
    if (overlay) overlay.classList.remove('show');
}

function openDeviceAlertPanel() {
    closeDeviceAlert();
    const connDetails = document.getElementById('connDetails');
    if (connDetails && !connDetails.classList.contains('show')) toggleConnPanel();
    document.getElementById('connPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function evaluateDeviceAlerts() {
    const level = batteryState.level;
    const isCriticalBattery = batteryState.supported && level !== null && !batteryState.charging && level <= 15;
    const isLowBattery = batteryState.supported && level !== null && !batteryState.charging && level <= 30;
    const isUnstableNet = networkState.online && networkState.unstable;

    if (!batteryState.supported || batteryState.charging || level === null || level > 18) deviceAlertFlags.criticalShown = false;
    if (!batteryState.supported || batteryState.charging || level === null || level > 35) deviceAlertFlags.lowShown = false;
    if (!isUnstableNet) deviceAlertFlags.unstableShown = false;

    if (isCriticalBattery && !deviceAlertFlags.criticalShown) {
        showDeviceAlert('critical', 'Critical Battery', `Battery level is only ${level}%. Please connect charger now.`, `Battery ${level}% • Realtime may become unstable`);
        deviceAlertFlags.criticalShown = true; return;
    }
    if (isLowBattery && !deviceAlertFlags.lowShown) {
        showDeviceAlert('low', 'Low Battery', `Battery level dropped to ${level}%. Please prepare a charger.`, `Battery ${level}% • Low power warning`);
        deviceAlertFlags.lowShown = true; return;
    }
    if (isUnstableNet && !deviceAlertFlags.unstableShown) {
        showDeviceAlert('network', 'Internet Unstable', 'Signal is weak or latency is high. Switch network or use Manual Push mode.', `${networkState.label} • ${signalBarsText(networkState.signalBars)} • ${selfPingMs ?? '--'} ms`);
        deviceAlertFlags.unstableShown = true;
    }
}

// ==========================================
// PING
// ==========================================
async function measureOwnFirebasePing() {
    if (!database || !navigator.onLine || !matchId) {
        selfPingMs = null; updatePingDisplay(); return null;
    }
    try {
        const start = performance.now();
        await database.ref(`ping/${matchId}/updater_probe`).set({ t: firebase.database.ServerValue.TIMESTAMP });
        selfPingMs = Math.max(1, Math.round(performance.now() - start));
        updatePingDisplay();
        return selfPingMs;
    } catch (e) {
        selfPingMs = null; updatePingDisplay(); return null;
    }
}

// ==========================================
// PRESENCE REFRESH
// ==========================================
async function refreshUpdaterPresence() {
    if (!database || !matchId || !navigator.onLine) return;
    const ping = await measureOwnFirebasePing();
    readNetworkInfo();
    try {
        await database.ref(`presence/${matchId}/updater`).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            name: scorerName || '',
            version: '33.1',
            pingMs: ping ?? 0,
            device: {
                battery: {
                    supported: batteryState.supported,
                    level: batteryState.level,
                    charging: batteryState.charging,
                    low: batteryState.low,
                    critical: batteryState.critical
                },
                network: {
                    online: networkState.online,
                    rawType: networkState.rawType,
                    effectiveType: networkState.effectiveType,
                    label: networkState.label,
                    signalBars: networkState.signalBars,
                    signalPct: networkState.signalPct,
                    downlink: networkState.downlink,
                    rtt: networkState.rtt,
                    unstable: networkState.unstable
                },
                autoRealtimeEnabled,
                pendingManualPush: hasPendingManualPush
            }
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshUpdaterPresence();
    presenceRefreshInterval = setInterval(refreshUpdaterPresence, 10000);
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) {
        clearInterval(presenceRefreshInterval);
        presenceRefreshInterval = null;
    }
}

// ==========================================
// JOIN MATCH
// ==========================================
function joinMatch() {
    // ⚡ AUTH CHECK - Score Updater role ekata access thiyeda balanawa
    if (typeof hasRole === 'function' && !hasRole('scorer') && !hasRole('admin') && !hasRole('owner')) {
        showToast('⚠️ You do not have Scorer access!', 'error');
        return;
    }

    const inputMatchId = document.getElementById('inputMatchId').value.trim();
    let inputScorerName = document.getElementById('inputScorerName').value.trim();

    // If name is empty, try to get from current logged in user
    if (!inputScorerName && typeof getCurrentUser === 'function') {
        const user = getCurrentUser();
        inputScorerName = user?.displayName || 'Scorer';
        document.getElementById('inputScorerName').value = inputScorerName;
    }

    if (!inputMatchId) { showToast('Please enter Match ID', 'error'); return; }
    if (!inputScorerName) { showToast('Please enter your name', 'error'); return; }

    matchId = inputMatchId;
    scorerName = inputScorerName;
    localStorage.setItem('scorer_matchId', matchId);
    localStorage.setItem('scorer_name', scorerName);
    addToRecentMatches(matchId);
    connectToMatch();
}

// ==========================================
// LOAD TEAMS FROM FIREBASE
// ==========================================
async function loadTeamsFromFirebase(forceRefresh = false) {
    if (!database) return;
    try {
        let teamsData = {}, playersData = {}, usedCache = false, currentVersion = Date.now();
        if (!forceRefresh) {
            const cached = loadTeamsFromCache();
            if (cached && cached.teams && await isTeamsCacheValid(cached)) {
                teamsData = cached.teams || {};
                playersData = cached.players || {};
                currentVersion = cached.version;
                usedCache = true;
            }
        }
        if (!usedCache) {
            const [teamsSnap, playersSnap, versionSnap] = await Promise.all([
                database.ref('teams').once('value'),
                database.ref('players').once('value'),
                database.ref('data_version/teams').once('value')
            ]);
            teamsData = teamsSnap.val() || {};
            playersData = playersSnap.val() || {};
            currentVersion = versionSnap.val() || Date.now();
            saveTeamsToCache(teamsData, playersData, currentVersion);
        }
        allPlayersData = Object.entries(playersData).map(([id, player]) => ({ id, ...player }));
        allTeams = Object.entries(teamsData).map(([id, team]) => ({
            id, ...team,
            players: allPlayersData.filter(p => p.team_id === id)
        }));
        const teamsEl = document.getElementById('teamsLoadedCount');
        const playersEl = document.getElementById('playersLoadedCount');
        if (teamsEl) teamsEl.innerText = allTeams.length > 0 ? '✓' : '0';
        if (playersEl) playersEl.innerText = allPlayersData.length;
    } catch (e) {
        const cached = loadTeamsFromCache();
        if (cached && cached.teams) {
            allPlayersData = Object.entries(cached.players || {}).map(([id, player]) => ({ id, ...player }));
            allTeams = Object.entries(cached.teams).map(([id, team]) => ({
                id, ...team,
                players: allPlayersData.filter(p => p.team_id === id)
            }));
            showToast('Using offline team data', 'error');
        } else showToast('Failed to load teams', 'error');
    }
}

async function forceRefreshTeams() {
    clearTeamsCache();
    await loadTeamsFromFirebase(true);
    showToast('Teams refreshed', 'success');
}

function updateTeamPlayers(batFlag, bowlFlag) {
    if (!batFlag || !bowlFlag) return;
    const battingTeam = allTeams.find(t => t.short_name === batFlag || t.name === batFlag);
    const bowlingTeam = allTeams.find(t => t.short_name === bowlFlag || t.name === bowlFlag);

    if (battingTeam && battingTeam.players) {
        battingPlayers = battingTeam.players.map(p => ({
            name: p.name || '', role: p.role || 'Batsman',
            isOut: matchState.dismissedPlayers.some(d => (typeof d === 'string' ? d : d.name) === p.name),
            isPlaying: false
        }));
        if (matchState.bat1.name) {
            const b1 = battingPlayers.find(p => p.name === matchState.bat1.name);
            if (b1) b1.isPlaying = true;
        }
        if (matchState.bat2.name) {
            const b2 = battingPlayers.find(p => p.name === matchState.bat2.name);
            if (b2) b2.isPlaying = true;
        }
    } else battingPlayers = [];

    if (bowlingTeam && bowlingTeam.players) {
        bowlingPlayers = bowlingTeam.players.map(p => ({ name: p.name || '', role: p.role || 'Bowler' }));
    } else bowlingPlayers = [];

    matchState.battingTeam = batFlag;
    matchState.bowlingTeam = bowlFlag;
    const playersEl = document.getElementById('playersLoadedCount');
    if (playersEl) playersEl.innerText = battingPlayers.length;
}

// ==========================================
// TEAM VERSION LISTENER
// ==========================================
function setupTeamsVersionListener() {
    if (!database) return;
    addMatchValueListener('data_version/teams', async (snap) => {
        const serverVersion = snap.val() || 0;
        if (!serverVersion) return;
        if (currentTeamsVersion === 0) { currentTeamsVersion = serverVersion; return; }
        if (serverVersion !== currentTeamsVersion) {
            currentTeamsVersion = serverVersion;
            clearTeamsCache();
            await loadTeamsFromFirebase(true);
            if (matchState.battingTeam && matchState.bowlingTeam) {
                updateTeamPlayers(matchState.battingTeam, matchState.bowlingTeam);
            }
            showToast('Teams auto-updated!', 'success');
        }
    });
}

// ==========================================
// CONNECT TO MATCH
// ==========================================
async function connectToMatch() {
    try {
        if (!database) { showToast('Firebase not ready', 'error'); return; }

        clearMatchListeners();
        stopPresenceRefresh();
        commandListenerInitialized = false;
        lastProcessedCommandTs = 0;

        await loadTeamsFromFirebase();
        setupTeamsVersionListener();

        const myPresenceRef = database.ref(`presence/${matchId}/updater`);

        // Connection status listener
        addMatchValueListener('.info/connected', (snapshot) => {
            if (snapshot.val()) {
                const wasConnected = isConnected;
                isConnected = true;

                myPresenceRef.onDisconnect().set({
                    online: false,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
                myPresenceRef.set({
                    online: true,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP,
                    name: scorerName,
                    version: '33.1',
                    pingMs: 0
                });

                showScorerScreen();
                startPresenceRefresh();
                updatePingDisplay();
                if (!wasConnected) showToast('Connected to match!', 'success');

                const realtimeDot = document.getElementById('realtimeDot');
                if (realtimeDot) realtimeDot.className = 'modern-dot connected';
            } else {
                isConnected = false;
                stopPresenceRefresh();
                selfPingMs = null;
                updatePingDisplay();
                const realtimeDot = document.getElementById('realtimeDot');
                if (realtimeDot) realtimeDot.className = 'modern-dot offline';
            }
        });

        // Admin presence
        addMatchValueListener(`presence/${matchId}/admin`, (snap) => {
            const data = snap.val();
            adminOnline = data?.online || false;
            updateAdminStatus();
        });

        // Scorebar presence
        addMatchValueListener(`presence/${matchId}/scorebar`, (snap) => {
            const data = snap.val();
            scorebarOnline = data?.online || false;
            lastScorebarPingMs = data?.pingMs ?? null;
            updateScorebarStatus();
            updatePingDisplay();
        });

        // Live match data
        addMatchValueListener(`matches/${matchId}/live`, (snap) => {
            const data = snap.val();
            if (data && data.timestamp) {
                if (data.batFlag) updateTeamPlayers(data.batFlag, data.bowlFlag);
                loadMatchState(data);
                rerenderOpenPopupLists();
                const lastAdminSync = document.getElementById('lastAdminSync');
                if (lastAdminSync) lastAdminSync.innerText = new Date().toLocaleTimeString();
            }
        });

        // ✅ Command listener - FIXED with replay protection
        const cmdRef = database.ref(`matches/${matchId}/command`);
        const cmdHandler = (snap) => {
            const cmd = snap.val();
            if (!cmd || !cmd.ts) return;

            // Skip initial load
            if (!commandListenerInitialized) {
                commandListenerInitialized = true;
                lastProcessedCommandTs = cmd.ts || Date.now();
                return;
            }

            // Skip old commands
            if (cmd.ts <= lastProcessedCommandTs) return;
            lastProcessedCommandTs = cmd.ts;

            // Skip stale commands (>10s old)
            if (Date.now() - cmd.ts > 10000) return;

            // Handle commands
            if (cmd.event === 'force_reload') {
                if (cmd.payload?.target === 'updater' ||
                    cmd.payload?.target === 'scorer' ||
                    cmd.payload?.target === 'all') {
                    location.reload(true);
                }
            }

            if (cmd.event === 'show_super_over') {
                showSuperOverPopup(cmd.payload);
            }

            // ✅ GOD MODE ALERT - FIXED HANDLER
            if (cmd.event === 'alert_message' && cmd.payload) {
                const msg = cmd.payload.message || '';
                const from = cmd.payload.from || 'GOD MODE';
                if (msg) showGodModeAlert(msg, from);
            }
        };

        cmdRef.on('value', cmdHandler);
        activeMatchListeners.push({ ref: cmdRef, handler: cmdHandler });

        // Updater settings
        addMatchValueListener(`matches/${matchId}/updater_settings`, (snap) => {
            const settings = snap.val();
            if (settings) {
                updaterAutoSettings = {
                    autoHype: settings.autoHype !== false,
                    autoProfile: settings.autoProfile !== false,
                    autoResult: settings.autoResult !== false
                };
            }
        });

    } catch (error) {
        console.error('❌ Failed to connect:', error);
        showToast('Failed to connect: ' + error.message, 'error');
    }
}

function showScorerScreen() {
    const loginScreen = document.getElementById('loginScreen');
    const scorerScreen = document.getElementById('scorerScreen');
    if (loginScreen) loginScreen.style.display = 'none';
    if (scorerScreen) scorerScreen.classList.add('active');
    const displayMatchId = document.getElementById('displayMatchId');
    const displayScorerName = document.getElementById('displayScorerName');
    const connMatchId = document.getElementById('connMatchId');
    if (displayMatchId) displayMatchId.innerText = matchId;
    if (displayScorerName) displayScorerName.innerText = scorerName;
    if (connMatchId) connMatchId.innerText = matchId;
    updateConnectionStatus();
}

function showLoginScreen() {
    const loginScreen = document.getElementById('loginScreen');
    const scorerScreen = document.getElementById('scorerScreen');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (scorerScreen) scorerScreen.classList.remove('active');
    isConnected = false;
}

// ==========================================
// CONNECTION STATUS UI
// ==========================================
function updateConnectionStatus() {
    const realtimeDot = document.getElementById('realtimeDot');
    if (realtimeDot) realtimeDot.className = isConnected ? 'modern-dot connected' : 'modern-dot connecting';
    const dbDot = document.getElementById('dbDot');
    if (dbDot) dbDot.className = database ? 'modern-dot connected' : 'modern-dot error';
    updateAdminStatus();
    updateScorebarStatus();
    updatePingDisplay();
}

function updateAdminStatus() {
    const adminDot = document.getElementById('adminDot');
    if (adminDot) adminDot.className = adminOnline ? 'modern-dot connected' : 'modern-dot offline';
}

function updateScorebarStatus() {
    const sbDot = document.getElementById('scorebarDot');
    if (sbDot) sbDot.className = scorebarOnline ? 'modern-dot connected' : 'modern-dot offline';
}

// ==========================================
// CHASE START POPUP
// ==========================================
function showChaseStartPopup(target, battingTeam) {
    const targetEl = document.getElementById('chasePopupTarget');
    const teamEl = document.getElementById('chasePopupBatTeam');
    const popup = document.getElementById('chaseStartPopup');
    if (targetEl) targetEl.innerText = target;
    if (teamEl) teamEl.innerText = `${battingTeam || 'BATTING TEAM'} NEEDS TO CHASE`;
    if (popup) { popup.classList.add('show'); safeVibrate([200, 100, 200]); }
    showToast(`🎯 Chase Started! Target: ${target}`, 'success');
}

function closeChaseStartPopup() {
    document.getElementById('chaseStartPopup')?.classList.remove('show');
}

// ==========================================
// SUPER OVER POPUP
// ==========================================
function showSuperOverPopup(payload) {
    if (!payload) return;
    const team1 = payload.team1 || 'T1';
    const team2 = payload.team2 || 'T2';

    let popup = document.getElementById('superOverPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'superOverPopup';
        popup.className = 'popup-overlay';
        popup.innerHTML = `
            <div class="popup-card" style="border-radius:20px 20px 0 0;text-align:center;">
                <div style="padding:30px 20px;">
                    <div style="font-size:64px;margin-bottom:16px;display:block;animation:superOverPulse 0.8s infinite ease-in-out;">⚡</div>
                    <h2 style="color:var(--accent);font-size:2rem;font-weight:900;margin:0 0 8px;letter-spacing:2px;">SUPER OVER</h2>
                    <p style="color:rgba(255,255,255,0.7);font-size:1rem;margin:0 0 20px;">Match is TIED! One over to decide the winner.</p>
                    <div style="display:flex;justify-content:center;align-items:center;gap:20px;margin-bottom:24px;">
                        <div style="text-align:center;">
                            <div id="superOverTeam1" style="font-size:1.5rem;font-weight:900;color:var(--accent);">${escapeWcHtml(team1)}</div>
                            <div style="font-size:0.7rem;color:rgba(255,255,255,0.5);margin-top:4px;">TEAM 1</div>
                        </div>
                        <div style="font-size:1.2rem;color:rgba(255,255,255,0.3);font-weight:900;">VS</div>
                        <div style="text-align:center;">
                            <div id="superOverTeam2" style="font-size:1.5rem;font-weight:900;color:#86efac;">${escapeWcHtml(team2)}</div>
                            <div style="font-size:0.7rem;color:rgba(255,255,255,0.5);margin-top:4px;">TEAM 2</div>
                        </div>
                    </div>
                    <div style="background:rgba(248,180,0,0.1);border:1px solid rgba(248,180,0,0.3);border-radius:12px;padding:14px;margin-bottom:24px;">
                        <p style="color:rgba(255,255,255,0.8);font-size:0.85rem;margin:0;line-height:1.5;">
                            ⚡ Score has been reset<br>🏏 Select new batsmen & bowler<br>🎯 1 over per team
                        </p>
                    </div>
                    <button onclick="closeSuperOverPopup()" style="width:100%;padding:16px;background:linear-gradient(135deg,var(--accent),#d97706);color:#111;border:none;border-radius:14px;font-size:1rem;font-weight:900;cursor:pointer;letter-spacing:1px;">⚡ START SCORING NOW</button>
                </div>
            </div>`;
        document.body.appendChild(popup);

        if (!document.getElementById('superOverStyle')) {
            const style = document.createElement('style');
            style.id = 'superOverStyle';
            style.textContent = `
                @keyframes superOverPulse {
                    0%,100%{transform:scale(1);filter:drop-shadow(0 0 10px rgba(248,180,0,0.5));}
                    50%{transform:scale(1.2);filter:drop-shadow(0 0 30px rgba(248,180,0,1));}
                }`;
            document.head.appendChild(style);
        }
    } else {
        const t1El = document.getElementById('superOverTeam1');
        const t2El = document.getElementById('superOverTeam2');
        if (t1El) t1El.innerText = team1;
        if (t2El) t2El.innerText = team2;
    }

    popup.classList.add('show');
    safeVibrate([200, 100, 200, 100, 400]);
    showToast('⚡ SUPER OVER STARTED!', 'success');
}

function closeSuperOverPopup() {
    document.getElementById('superOverPopup')?.classList.remove('show');
}

// ==========================================
// LOAD MATCH STATE
// ==========================================
function loadMatchState(data) {
    if (!data) return;

    const newTarget = parseInt(data.target) || 0;
    if (previousTarget === 0 && newTarget > 0) {
        showChaseStartPopup(newTarget, data.batFlag);
        // [PARTNERSHIP FIX] Reset partnership history for 2nd innings
        matchState.partnershipHistory = [];
        // [BUG-01 FIX] Do NOT reset overRunsHistory here.
        // 1st innings data must be preserved for Worm/Momentum/Manhattan charts.
        // Admin handles innings resets via initSuperOver() or manual reset.
    }
    previousTarget = newTarget;

    matchState.runs = parseInt(data.runs) || 0;
    matchState.wkts = parseInt(data.wkts) || 0;
    matchState.overs = data.overs || '0.0';
    matchState.target = newTarget;
    matchState.totOvers = parseInt(data.totOvers) || 20;
    matchState.crr = data.crr || '0.00';
    matchState.striker = data.striker === '2' ? 2 : 1;
    matchState.isFreeHit = data.isFreeHit === true;
    matchState.partRuns = parseInt(data.partRuns) || 0;
    matchState.partBalls = parseInt(data.partBalls) || 0;

    if (data.t1Logo) matchState.t1Logo = data.t1Logo;
    if (data.t2Logo) matchState.t2Logo = data.t2Logo;
    // [Winner Fix] Store battingSide for correct logo resolution in winner popup
    if (data.battingSide) matchState.battingSide = data.battingSide;
    if (data.batFlag) matchState.battingTeamLogo = (matchState.battingSide || data.battingSide) === 1 ? data.t1Logo : data.t2Logo;
    if (data.bowlFlag) matchState.bowlingTeamLogo = (matchState.battingSide || data.battingSide) === 1 ? data.t2Logo : data.t1Logo;

    if (data.dismissedPlayers && Array.isArray(data.dismissedPlayers)) {
        matchState.dismissedPlayers = data.dismissedPlayers.map(p => {
            if (typeof p === 'string') return { name: p, runs: 0, balls: 0, dismissal: 'OUT', bowler: '-', fielder: '-' };
            return { ...p };
        });
    } else matchState.dismissedPlayers = [];

    if (data.bat1) {
        matchState.bat1 = {
            name: data.bat1.name || '', runs: parseInt(data.bat1.runs) || 0,
            balls: parseInt(data.bat1.balls) || 0, fours: parseInt(data.bat1.fours) || 0,
            sixes: parseInt(data.bat1.sixes) || 0, isOut: !!data.bat1.isOut
        };
    } else matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };

    if (data.bat2) {
        matchState.bat2 = {
            name: data.bat2.name || '', runs: parseInt(data.bat2.runs) || 0,
            balls: parseInt(data.bat2.balls) || 0, fours: parseInt(data.bat2.fours) || 0,
            sixes: parseInt(data.bat2.sixes) || 0, isOut: !!data.bat2.isOut
        };
    } else matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };

    if (data.bowler) {
        let bowlerOvers = '0.0', bowlerRuns = 0, bowlerWickets = 0, bowlerBalls = 0;
        if (data.bowler.figs) {
            const figs = String(data.bowler.figs).trim().split(' ');
            const wr = (figs[0] || '0-0').split('-');
            bowlerWickets = parseInt(wr[0], 10) || 0;
            bowlerRuns = parseInt(wr[1], 10) || 0;
            bowlerOvers = figs[1] || '0.0';
            const ovParts = bowlerOvers.split('.');
            bowlerBalls = ((parseInt(ovParts[0], 10) || 0) * 6) + (parseInt(ovParts[1], 10) || 0);
        } else {
            bowlerOvers = data.bowler.overs || '0.0';
            bowlerRuns = parseInt(data.bowler.runs) || 0;
            bowlerWickets = parseInt(data.bowler.wickets) || 0;
            bowlerBalls = parseInt(data.bowler.balls) || 0;
        }
        matchState.bowler = { name: data.bowler.name || '', overs: bowlerOvers, runs: bowlerRuns, wickets: bowlerWickets, balls: bowlerBalls };
    } else matchState.bowler = { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 };

    matchState.battingTeam = data.batFlag || '';
    matchState.bowlingTeam = data.bowlFlag || '';

    if (data.thisOver) {
        const overStr = String(data.thisOver).trim();
        matchState.thisOver = overStr ? overStr.split(' ').filter(Boolean) : [];
    } else matchState.thisOver = [];

    matchState.prevInnings = data.prevInnings || null;
    matchState.balls = oversToBalls(matchState.overs);

    // ✅ FIX: Accept overRunsHistory from admin/Firebase for chart sync
    if (Array.isArray(data.overRunsHistory)) {
        matchState.overRunsHistory = data.overRunsHistory.map(o => ({
            runs: parseInt(o.runs) || 0,
            isWicket: !!o.isWicket
        }));
        // Sync the duplicate prevention counter with loaded data
        lastRecordedOverCount = matchState.overRunsHistory.length;
    }

    // ✅ FIX: Accept winProb from admin/Firebase for WinViz chart sync
    if (data.winProb !== undefined && data.winProb !== null) {
        matchState.winProb = Math.max(0, Math.min(100, parseInt(data.winProb, 10) || 50));
    }

    syncDismissedPlayers();
    updateDisplay();
}

function syncDismissedPlayers() {
    battingPlayers.forEach(player => {
        player.isOut = matchState.dismissedPlayers.some(d =>
            (typeof d === 'string' ? d : d.name) === player.name);
        player.isPlaying = (player.name === matchState.bat1.name || player.name === matchState.bat2.name) && !player.isOut;
    });
}

function rerenderOpenPopupLists() {
    if (document.getElementById('playerPickerPopup')?.classList.contains('show')) renderPlayerList();
    if (document.getElementById('newBatterPopup')?.classList.contains('show')) renderNewBatterList();
    if (document.getElementById('bowlerPickerPopup')?.classList.contains('show')) renderBowlerPickerList();
    if (document.getElementById('nextBowlerPopup')?.classList.contains('show')) renderNextBowlerList();
}

// ==========================================
// UPDATE DISPLAY
// ==========================================
function updateDisplay() {
    const displayRuns = document.getElementById('displayRuns');
    const displayWkts = document.getElementById('displayWkts');
    const displayOvers = document.getElementById('displayOvers');
    const displayCrr = document.getElementById('displayCrr');
    const battingTeamBadge = document.getElementById('battingTeamBadge');
    if (displayRuns) displayRuns.innerText = matchState.runs;
    if (displayWkts) displayWkts.innerText = matchState.wkts;
    if (displayOvers) displayOvers.innerText = matchState.overs;
    if (displayCrr) displayCrr.innerText = matchState.crr;
    if (battingTeamBadge) battingTeamBadge.innerText = matchState.battingTeam || 'BAT';

    const targetDisplay = document.getElementById('targetDisplay');
    const targetValueMini = document.getElementById('targetValueMini');
    if (matchState.target > 0) {
        const need = matchState.target - matchState.runs;
        if (targetDisplay) targetDisplay.innerText = need > 0 ? `Need ${need} runs` : 'TARGET ACHIEVED!';
        if (targetValueMini) targetValueMini.innerText = matchState.target;
    } else {
        if (targetDisplay) targetDisplay.innerText = '';
        if (targetValueMini) targetValueMini.innerText = '--';
    }

    const partnershipValue = document.getElementById('partnershipValue');
    if (partnershipValue) partnershipValue.innerText = `${matchState.partRuns} (${matchState.partBalls})`;

    const lastBallValue = document.getElementById('lastBallValue');
    const lastBall = matchState.thisOver.length > 0 ? matchState.thisOver[matchState.thisOver.length - 1] : '--';
    if (lastBallValue) lastBallValue.innerText = lastBall;

    const freeHitBanner = document.getElementById('freeHitBanner');
    const freeHitChip = document.getElementById('freeHitChip');
    if (matchState.isFreeHit) {
        freeHitBanner?.classList.add('show');
        freeHitChip?.classList.add('show');
    } else {
        freeHitBanner?.classList.remove('show');
        freeHitChip?.classList.remove('show');
    }

    if (matchState.prevInnings) {
        const prevBox = document.getElementById('prevInningsBox');
        const prevInningsTeam = document.getElementById('prevInningsTeam');
        const prevInningsScore = document.getElementById('prevInningsScore');
        if (prevInningsTeam) prevInningsTeam.innerText = matchState.prevInnings.team || 'TEAM 1';
        if (prevInningsScore) prevInningsScore.innerHTML = `${matchState.prevInnings.runs}/${matchState.prevInnings.wkts} <span>(${matchState.prevInnings.overs})</span>`;
        if (prevBox) prevBox.classList.add('show');
    }

    renderOverBalls();
    updateBatsmenDisplay();
    updateBowlerDisplay();
    updateStrikerIndicator();
    updateTechPanel();
}

function renderOverBalls() {
    const container = document.getElementById('overBalls');
    if (!container) return;
    container.innerHTML = '';
    let legalBalls = 0;
    matchState.thisOver.forEach((ball, idx) => {
        const div = document.createElement('div');
        div.className = 'ball-slot';
        const ballUpper = ball.toUpperCase();
        if (ballUpper === '0' || ballUpper === '.') { div.classList.add('dot'); div.innerText = '•'; }
        else if (ballUpper === '4') { div.classList.add('four'); div.innerText = '4'; }
        else if (ballUpper === '6') { div.classList.add('six'); div.innerText = '6'; }
        else if (ballUpper.includes('W') && !ballUpper.includes('WD')) { div.classList.add('wicket'); div.innerText = 'W'; }
        else if (ballUpper.includes('WD')) { div.classList.add('wide'); div.innerText = ballUpper; }
        else if (ballUpper.includes('NB')) { div.classList.add('noball'); div.innerText = ballUpper; }
        else { div.classList.add('runs'); div.innerText = ball; }
        if (idx === matchState.thisOver.length - 1) div.classList.add('last');
        if (!ballUpper.includes('WD') && !ballUpper.includes('NB')) legalBalls++;
        container.appendChild(div);
    });
    for (let i = legalBalls; i < 6; i++) {
        const div = document.createElement('div');
        div.className = 'ball-slot empty';
        container.appendChild(div);
    }
}

function updateBatsmenDisplay() {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setVal('b1Name', matchState.bat1.name || '');
    setEl('b1Runs', matchState.bat1.runs);
    setEl('b1Balls', matchState.bat1.balls);
    setEl('b1Fours', matchState.bat1.fours);
    setEl('b1Sixes', matchState.bat1.sixes);
    setEl('b1SR', matchState.bat1.balls > 0 ? ((matchState.bat1.runs / matchState.bat1.balls) * 100).toFixed(2) : '0.00');
    const b1Av = document.getElementById('b1Avatar');
    if (b1Av) b1Av.innerText = matchState.bat1.name ? matchState.bat1.name.charAt(0).toUpperCase() : '?';

    setVal('b2Name', matchState.bat2.name || '');
    setEl('b2Runs', matchState.bat2.runs);
    setEl('b2Balls', matchState.bat2.balls);
    setEl('b2Fours', matchState.bat2.fours);
    setEl('b2Sixes', matchState.bat2.sixes);
    setEl('b2SR', matchState.bat2.balls > 0 ? ((matchState.bat2.runs / matchState.bat2.balls) * 100).toFixed(2) : '0.00');
    const b2Av = document.getElementById('b2Avatar');
    if (b2Av) b2Av.innerText = matchState.bat2.name ? matchState.bat2.name.charAt(0).toUpperCase() : '?';
}

function updateBowlerDisplay() {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('bowlName', matchState.bowler.name || '');
    setEl('bowlOvers', matchState.bowler.overs || '0.0');
    setEl('bowlRuns', matchState.bowler.runs);
    setEl('bowlWickets', matchState.bowler.wickets);
    const overs = parseFloat(matchState.bowler.overs) || 0;
    setEl('bowlEcon', overs > 0 ? (matchState.bowler.runs / overs).toFixed(2) : '0.00');
    const bowlAv = document.getElementById('bowlAvatar');
    if (bowlAv) bowlAv.innerText = matchState.bowler.name ? matchState.bowler.name.charAt(0).toUpperCase() : '?';
}

function updateStrikerIndicator() {
    const btn1 = document.getElementById('strikerBtn1');
    const btn2 = document.getElementById('strikerBtn2');
    const badge1 = document.getElementById('strikeBadge1');
    const badge2 = document.getElementById('strikeBadge2');
    if (matchState.striker === 1) {
        btn1?.classList.add('active'); btn2?.classList.remove('active');
        badge1?.classList.remove('hidden'); badge2?.classList.add('hidden');
    } else {
        btn1?.classList.remove('active'); btn2?.classList.add('active');
        badge1?.classList.add('hidden'); badge2?.classList.remove('hidden');
    }
}

function updateTechPanel() {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setEl('techLocalScore', `${matchState.runs}/${matchState.wkts} (${matchState.overs})`);
    setEl('techChannel', matchId);
    setEl('techMsgCount', messagesSent);
    const techPreviewJson = document.getElementById('techPreviewJson');
    if (techPreviewJson) techPreviewJson.innerText = JSON.stringify(matchState, null, 2);
}

// ==========================================
// OVERS / BALLS HELPERS
// ==========================================
function oversToBalls(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    const o = parseInt(parts[0] || '0', 10);
    let b = parseInt(parts[1] || '0', 10);
    if (b > 5) b = 5;
    return Math.max(0, o * 6 + b);
}

function ballsToOversString(totalBalls) {
    const ovs = Math.floor((totalBalls || 0) / 6);
    const balls = (totalBalls || 0) % 6;
    return `${ovs}.${balls}`;
}

function countLegalBallsInOver() {
    return matchState.thisOver.filter(ball => {
        const b = String(ball).toUpperCase();
        return !b.includes('WD') && !b.includes('NB');
    }).length;
}

function isOverComplete() { return countLegalBallsInOver() >= 6; }

function getAvailableBatsmen() {
    const currentB1 = matchState.bat1.name;
    const currentB2 = matchState.bat2.name;
    return battingPlayers.filter(p => {
        if (!p.name) return false;
        if (p.isOut) return false;
        if (matchState.dismissedPlayers.some(d => (typeof d === 'string' ? d : d.name) === p.name)) return false;
        if (p.name === currentB1 || p.name === currentB2) return false;
        return true;
    });
}

function shouldInningsEnd() {
    if (matchState.wkts >= 10) return 'allout';
    if (getAvailableBatsmen().length === 0 && matchState.wkts > 0) return 'allout';
    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;
    if (ballsBowled >= maxBalls) return 'overs_complete';
    if (matchState.target > 0 && matchState.runs >= matchState.target) return 'target_achieved';
    return false;
}

function buildInningsOverCardHtml() {
    return `<div class="result-card-wrap"><div class="result-card-kicker">END OF INNINGS</div><div class="result-card-winner"><span class="result-card-team">${matchState.battingTeam || 'TEAM'}</span><span class="result-card-team">${matchState.runs}/${matchState.wkts}</span></div><div class="result-card-line">TARGET ${matchState.runs + 1}</div><div class="result-card-sub">${matchState.overs} OVERS</div></div>`;
}

function sendSpecialOverlay(htmlContent, duration = 5000) {
    if (!database || !isConnected) return;
    const payload = buildUpdatePayload();
    payload.isSpecial = true;
    payload.specialText = htmlContent;
    database.ref(`matches/${matchId}/live`).update(payload);
    setTimeout(() => hideSpecialOverlay(), duration);
    messagesSent++;
    updateTechPanel();
}

function hideSpecialOverlay() {
    if (!database || !isConnected) return;
    const payload = buildUpdatePayload();
    payload.isSpecial = false;
    payload.specialText = '';
    database.ref(`matches/${matchId}/live`).update(payload);
}

function handleMatchEndConditions(afterHypeDelay = 0) {
    if (matchState.isMatchEnded) return;
    const endReason = shouldInningsEnd();
    if (!endReason) return;
    const delay = afterHypeDelay + CONFIG.TIMING.RESULT_DELAY;

    if (endReason === 'target_achieved') {
        matchState.isMatchEnded = true;
        setTimeout(() => { if (updaterAutoSettings.autoResult) sendWinnerCard(); showToast('🏆 Match Won!', 'success'); }, delay);
    } else if (endReason === 'allout') {
        if (matchState.target > 0) {
            matchState.isMatchEnded = true;
            setTimeout(() => { if (updaterAutoSettings.autoResult) sendWinnerCard(); showToast('Match Over - Defended!', 'success'); }, delay);
        } else {
            setTimeout(() => { if (updaterAutoSettings.autoResult) sendSpecialOverlay(buildInningsOverCardHtml(), 6000); showToast('Innings Over - All Out!', 'success'); }, delay);
        }
    } else if (endReason === 'overs_complete') {
        if (matchState.target > 0 && matchState.runs < matchState.target) {
            matchState.isMatchEnded = true;
            setTimeout(() => { if (updaterAutoSettings.autoResult) sendWinnerCard(); showToast('Match Over - Target Defended!', 'success'); }, delay);
        } else if (matchState.target <= 0) {
            setTimeout(() => { if (updaterAutoSettings.autoResult) sendSpecialOverlay(buildInningsOverCardHtml(), 6000); showToast('Innings Over!', 'success'); }, delay);
        }
    }
}

function markPlayerAsOut(playerName) {
    if (!playerName) return;
    if (!matchState.dismissedPlayers.some(d => (typeof d === 'string' ? d : d.name) === playerName)) {
        const bat = (matchState.bat1.name === playerName) ? matchState.bat1 :
            (matchState.bat2.name === playerName) ? matchState.bat2 : null;
        matchState.dismissedPlayers.push({
            name: playerName,
            runs: bat?.runs || 0, balls: bat?.balls || 0,
            fours: bat?.fours || 0, sixes: bat?.sixes || 0,
            dismissal: 'OUT', bowler: matchState.bowler.name || '-',
            fielder: '-', timestamp: Date.now()
        });
    }
    const player = battingPlayers.find(p => p.name === playerName);
    if (player) { player.isOut = true; player.isPlaying = false; }
}

// ==========================================
// SCORING ACTIONS
// ==========================================
function addBall(value) {
    // ✅ Validate batsmen and bowler selection before scoring
    if (!validateActivePlayers()) return;

    if (lockStates.score || lockStates.full) { showToast('Scoring is locked', 'error'); return; }
    if (matchState.isMatchEnded) { showToast('Match has ended!', 'error'); return; }
    if (matchState.target > 0 && matchState.runs >= matchState.target) { showToast('Target already achieved!', 'error'); return; }
    if (matchState.wkts >= 10) { showToast('Innings over - All Out!', 'error'); return; }

    const currentBalls = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;
    if (currentBalls >= maxBalls) { showToast('Overs completed!', 'error'); return; }

    const val = String(value).toUpperCase().trim();
    const isWide = val.includes('WD');
    const isNoBall = val.includes('NB');
    const isLegal = !isWide && !isNoBall;

    matchState.thisOver.push(val);

    let ballRunsValue = 0;

    if (isWide) {
        const wideExtra = parseInt(val.replace(/WD/ig, ''), 10) || 0;
        ballRunsValue = wideExtra;
        matchState.runs += 1 + wideExtra;
        matchState.partRuns += 1 + wideExtra;
        matchState.bowler.runs += 1 + wideExtra;

    } else if (isNoBall) {
        const nbBatRuns = parseInt(val.replace(/NB/ig, ''), 10) || 0;
        ballRunsValue = nbBatRuns;
        matchState.runs += 1 + nbBatRuns;
        matchState.partRuns += 1 + nbBatRuns;
        matchState.bowler.runs += 1 + nbBatRuns;
        matchState.isFreeHit = true;
        if (nbBatRuns > 0) {
            const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
            striker.runs += nbBatRuns;
            if (nbBatRuns === 4) striker.fours++;
            if (nbBatRuns === 6) striker.sixes++;
            if (nbBatRuns % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;
        }

    } else {
        ballRunsValue = parseInt(val, 10) || 0;
        matchState.runs += ballRunsValue;
        matchState.partRuns += ballRunsValue;
        matchState.partBalls++;
        matchState.balls++;
        matchState.bowler.balls++;
        matchState.bowler.runs += ballRunsValue;

        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.balls++;
        striker.runs += ballRunsValue;
        if (ballRunsValue === 4) striker.fours++;
        if (ballRunsValue === 6) striker.sixes++;
        if (ballRunsValue % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;

        matchState.isFreeHit = false;
        updateOvers();
        updateBowlerOvers();
    }

    calculateCRR();
    trackOverRunsHistory(); // ✅ FIX: Track per-over runs for chart sync
    calculateWinProbability(); // ✅ FIX: Calculate win prob for WinViz chart sync
    updateDisplay();

    if (autoRealtimeEnabled && database && isConnected) {
        const payload = buildUpdatePayload();
        Promise.all([
            database.ref(`matches/${matchId}/scorer_update`).set(payload),
            database.ref(`matches/${matchId}/live`).update(payload)
        ]).then(() => {
            setPendingManualPush(false);
        }).catch(err => {
            console.error('Send failed:', err);
            setPendingManualPush(true);
        });
        messagesSent++;
        updateTechPanel();
    } else if (!autoRealtimeEnabled) {
        setPendingManualPush(true);
    }

    let hypeDelay = 0;
    if (updaterAutoSettings.autoHype && isLegal) {
        if (ballRunsValue === 4) { sendHype('FOUR'); hypeDelay = CONFIG.TIMING.HYPE_FOUR; }
        else if (ballRunsValue === 6) { sendHype('SIX'); hypeDelay = CONFIG.TIMING.HYPE_SIX; }
    }

    handleMatchEndConditions(hypeDelay);

    if (isOverComplete() && !matchState.isMatchEnded) {
        setTimeout(() => openNextBowlerPopup(), CONFIG.TIMING.AUTO_BOWLER_POPUP_DELAY);
    }
}

function addCustomBall() {
    const input = document.getElementById('customBallInput');
    const value = input.value.trim();
    if (!value) return;
    addBall(value);
    input.value = '';
}

function undoBall() {
    if (lockStates.score || lockStates.full) { showToast('Scoring is locked', 'error'); return; }
    if (matchState.thisOver.length === 0) { showToast('No balls to undo', 'error'); return; }

    matchState.isMatchEnded = false;
    hideSpecialOverlay();
    pendingWicketOutSlot = null; // ✅ FIX: Clear pending slot on undo

    const lastBall = matchState.thisOver.pop();
    const val = lastBall.toUpperCase();

    if (val === 'W') {
        matchState.wkts--;
        matchState.balls--;
        const lastDismissed = matchState.dismissedPlayers.pop();
        const lastDismissedName = typeof lastDismissed === 'string' ? lastDismissed : lastDismissed?.name;
        if (lastDismissedName) {
            if (matchState.bat1.name === lastDismissedName) matchState.bat1.isOut = false;
            if (matchState.bat2.name === lastDismissedName) matchState.bat2.isOut = false;
            const p = battingPlayers.find(bp => bp.name === lastDismissedName);
            if (p) { p.isOut = false; p.isPlaying = false; }
        }
        if (matchState.bowler.wickets > 0) matchState.bowler.wickets--;
        matchState.bowler.balls--;
        updateBowlerOvers();
        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.balls--;
        updateOvers();
        calculateCRR();
        updateDisplay();
        sendUpdate();
        showToast('Wicket undone', 'success');
        return;
    }

    const isWide = val.includes('WD');
    const isNoBall = val.includes('NB');
    const isLegal = !isWide && !isNoBall;

    let runs = 0, batRuns = 0;
    if (isWide) {
        const wideExtra = parseInt(val.replace(/WD/ig, ''), 10) || 0;
        runs = 1 + wideExtra; batRuns = 0;
    } else if (isNoBall) {
        const nbBatRuns = parseInt(val.replace(/NB/ig, ''), 10) || 0;
        runs = 1 + nbBatRuns; batRuns = nbBatRuns;
    } else {
        runs = parseInt(val, 10) || 0; batRuns = runs;
    }

    matchState.runs -= runs;
    matchState.partRuns -= runs;

    if (isLegal) {
        matchState.balls--;
        matchState.partBalls--;
        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.balls--;
        striker.runs -= batRuns;
        if (batRuns === 4) striker.fours--;
        if (batRuns === 6) striker.sixes--;
        if (runs % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;
        matchState.bowler.balls--;
        matchState.bowler.runs -= batRuns;
        updateBowlerOvers();
        updateOvers();
    } else if (isNoBall) {
        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        striker.runs -= batRuns;
        if (batRuns === 4) striker.fours--;
        if (batRuns === 6) striker.sixes--;
        if (batRuns % 2 === 1) matchState.striker = matchState.striker === 1 ? 2 : 1;
        matchState.bowler.runs -= (1 + batRuns);
    } else if (isWide) {
        matchState.bowler.runs -= runs;
    }

    calculateCRR();
    updateDisplay();
    sendUpdate();
    showToast('Ball undone', 'success');
}

function clearOver() {
    if (lockStates.score || lockStates.full) { showToast('Scoring is locked', 'error'); return; }
    if (matchState.thisOver.length === 0) { showToast('Over is empty', 'error'); return; }
    while (matchState.thisOver.length > 0) undoBall();
    showToast('Over cleared', 'success');
}

function swapStriker() {
    if (lockStates.batsmen || lockStates.full) { showToast('Batsmen locked', 'error'); return; }
    matchState.striker = matchState.striker === 1 ? 2 : 1;
    updateDisplay();
    sendUpdate();
    showToast('Striker swapped', 'success');
}

function endOver() {
    if (lockStates.score || lockStates.full) { showToast('Scoring is locked', 'error'); return; }
    if (countLegalBallsInOver() < 6) { showToast(`Only ${countLegalBallsInOver()} legal balls bowled`, 'error'); return; }
    openNextBowlerPopup();
}

function updateOvers() {
    const fullOvers = Math.floor(matchState.balls / 6);
    const ballsInOver = matchState.balls % 6;
    matchState.overs = `${fullOvers}.${ballsInOver}`;
}

function updateBowlerOvers() {
    const bowlerBalls = matchState.bowler.balls || 0;
    matchState.bowler.overs = `${Math.floor(bowlerBalls / 6)}.${bowlerBalls % 6}`;
}

function calculateCRR() {
    const parts = String(matchState.overs || '0.0').split('.');
    const fullOvers = parseInt(parts[0] || '0', 10);
    let balls = parseInt(parts[1] || '0', 10);
    if (balls > 5) balls = 5;
    const totalOversDecimal = fullOvers + (balls / 6);
    matchState.crr = totalOversDecimal > 0 ? (matchState.runs / totalOversDecimal).toFixed(2) : '0.00';
}

// ✅ FIX: Calculate win probability for WinViz chart sync across devices
function calculateWinProbability() {
    if (matchState.target <= 0) { matchState.winProb = 50; return; }
    const runsNeeded = matchState.target - matchState.runs;
    const totalBallsBowled = oversToBalls(matchState.overs);
    const ballsRemaining = Math.max(0, (matchState.totOvers * 6) - totalBallsBowled);
    const wicketsRemaining = 10 - matchState.wkts;
    if (runsNeeded <= 0) { matchState.winProb = 100; }
    else if (wicketsRemaining <= 0 || ballsRemaining <= 0) { matchState.winProb = 0; }
    else {
        const oversRemaining = ballsRemaining / 6;
        const rrr = oversRemaining > 0 ? runsNeeded / oversRemaining : 0;
        const crr = parseFloat(matchState.crr) || 0;
        let prob = 50;
        if (crr > rrr) {
            prob = 50 + Math.min(45, ((crr - rrr) / Math.max(rrr, 0.1)) * 30);
        } else if (rrr > crr) {
            prob = 50 - Math.min(45, ((rrr - crr) / Math.max(crr, 0.1)) * 30);
        }
        // Adjust for wickets remaining
        if (wicketsRemaining <= 3) prob -= (4 - wicketsRemaining) * 5;
        matchState.winProb = Math.max(5, Math.min(95, Math.round(prob)));
    }
}

// [BUG-05 FIX] Track per-over runs when an over completes (for chart sync across devices)
// Dedup now uses completed over count (balls/6), not array length — prevents race conditions
let lastRecordedOverCount = 0;
function trackOverRunsHistory() {
    const legalBalls = countLegalBallsInOver();
    if (legalBalls < 6) return; // Over not complete yet

    // Use completed over count as source of truth — not overRunsHistory.length
    // This prevents skips when admin syncs and array length changes mid-game
    const completedOvers = Math.floor(matchState.balls / 6);
    if (completedOvers <= lastRecordedOverCount) return; // Already recorded this over

    const overRuns = matchState.thisOver.reduce((sum, ball) => {
        const b = String(ball).toUpperCase();
        if (b.includes('WD')) return sum + (1 + (parseInt(b.replace(/WD/ig, ''), 10) || 0));
        if (b.includes('NB')) return sum + (1 + (parseInt(b.replace(/NB/ig, ''), 10) || 0));
        if (b === 'W' || b.startsWith('W')) return sum;
        return sum + (parseInt(b) || 0);
    }, 0);
    const overHasWicket = matchState.thisOver.some(b => {
        const bv = String(b).toUpperCase();
        return bv === 'W' || bv.startsWith('W');
    });
    if (!Array.isArray(matchState.overRunsHistory)) matchState.overRunsHistory = [];
    matchState.overRunsHistory.push({ runs: overRuns, isWicket: overHasWicket });
    lastRecordedOverCount = completedOvers; // [BUG-05 FIX] Track by over number, not array index
}

// ==========================================
// EXTRAS POPUP
// ==========================================
function openExtrasPopup(type) {
    currentExtrasType = type;
    document.getElementById('extrasTitle').innerText = type === 'Wd' ? 'Wide' : 'No Ball';
    document.getElementById('extrasType').innerText = type === 'Wd' ? 'Wide' : 'No Ball';
    document.getElementById('extrasPopup').classList.add('show');
}

function closeExtrasPopup() {
    document.getElementById('extrasPopup').classList.remove('show');
    currentExtrasType = '';
}

function confirmExtras(extraRuns) {
    addBall(currentExtrasType + (extraRuns > 0 ? extraRuns : ''));
    closeExtrasPopup();
}

// ==========================================
// WICKET POPUP
// ==========================================
function openWicketPopup() {
    // ✅ Validate batsmen and bowler selection before wicket
    if (!validateActivePlayers()) return;

    if (lockStates.score || lockStates.full) { showToast('Scoring is locked', 'error'); return; }
    if (matchState.isMatchEnded) { showToast('Match has ended!', 'error'); return; }
    document.getElementById('wicketPopup').classList.add('show');
}

function closeWicketPopup() {
    document.getElementById('wicketPopup').classList.remove('show');
}

// ==========================================
// RUN OUT POPUP (No prompt())
// ==========================================
function showRunOutSelectPopup() {
    return new Promise((resolve) => {
        pendingRunOutResolve = resolve;

        let popup = document.getElementById('runOutScorerPopup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'runOutScorerPopup';
            popup.className = 'popup-overlay';
            popup.innerHTML = `
                <div class="popup-card" style="border-radius:20px 20px 0 0;">
                    <div class="popup-header">
                        <h3>🏃 RUN OUT - Who is out?</h3>
                        <button class="popup-close" onclick="cancelRunOutScorerPopup()">✕</button>
                    </div>
                    <div class="popup-body no-scroll">
                        <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0;">
                            <button onclick="selectRunOutScorerBatter('striker')" style="width:100%;padding:20px;border-radius:14px;background:rgba(248,180,0,0.12);border:2px solid rgba(248,180,0,0.4);color:var(--accent);font-size:1.1rem;font-weight:900;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:6px;">
                                <span style="font-size:0.7rem;letter-spacing:1px;opacity:0.7;">▶ STRIKER</span>
                                <span id="runOutScorerStrikerName" style="font-size:1.4rem;">--</span>
                            </button>
                            <button onclick="selectRunOutScorerBatter('nonstriker')" style="width:100%;padding:20px;border-radius:14px;background:rgba(59,130,246,0.12);border:2px solid rgba(59,130,246,0.4);color:#93c5fd;font-size:1.1rem;font-weight:900;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:6px;">
                                <span style="font-size:0.7rem;letter-spacing:1px;opacity:0.7;">NON-STRIKER</span>
                                <span id="runOutScorerNonStrikerName" style="font-size:1.4rem;">--</span>
                            </button>
                        </div>
                    </div>
                    <div class="popup-footer">
                        <button class="btn btn-secondary" onclick="cancelRunOutScorerPopup()">Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(popup);
        }

        const striker = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        const nonStriker = matchState.striker === 1 ? matchState.bat2 : matchState.bat1;
        const strikerNameEl = document.getElementById('runOutScorerStrikerName');
        const nonStrikerNameEl = document.getElementById('runOutScorerNonStrikerName');
        if (strikerNameEl) strikerNameEl.innerText = striker.name || '--';
        if (nonStrikerNameEl) nonStrikerNameEl.innerText = nonStriker.name || '--';

        popup.classList.add('show');
    });
}

function selectRunOutScorerBatter(which) {
    const popup = document.getElementById('runOutScorerPopup');
    if (popup) popup.classList.remove('show');
    if (pendingRunOutResolve) { pendingRunOutResolve(which); pendingRunOutResolve = null; }
}

function cancelRunOutScorerPopup() {
    const popup = document.getElementById('runOutScorerPopup');
    if (popup) popup.classList.remove('show');
    if (pendingRunOutResolve) { pendingRunOutResolve(null); pendingRunOutResolve = null; }
}

// ==========================================
// CONFIRM WICKET
// ==========================================
// ==========================================
// CONFIRM WICKET — FIXED with Fielder Input + Correct Run Out fade
// ==========================================
async function confirmWicket(type) {
    closeWicketPopup();

    let outSlot;
    let fielder = '-';
    let outBatterName = '';

    if (type === 'Run Out') {
        const choice = await showRunOutSelectPopup();
        if (!choice) return;
        outSlot = choice === 'nonstriker'
            ? (matchState.striker === 1 ? 'bat2' : 'bat1')
            : (matchState.striker === 1 ? 'bat1' : 'bat2');
        fielder = await showScorerFielderInput('RUN OUT BY', 'Who did the run out?');
        if (!fielder) fielder = '-';
    } else if (type === 'Caught') {
        outSlot = matchState.striker === 1 ? 'bat1' : 'bat2';
        fielder = await showScorerFielderInput('CAUGHT BY', 'Who took the catch?');
        if (!fielder) fielder = '-';
    } else if (type === 'Stumped') {
        outSlot = matchState.striker === 1 ? 'bat1' : 'bat2';
        fielder = await showScorerFielderInput('STUMPED BY', 'Who stumped the batter?');
        if (!fielder) fielder = '-';
    } else {
        outSlot = matchState.striker === 1 ? 'bat1' : 'bat2';
    }

    // ✅ FIX: Use global variable instead of matchState property to prevent Firebase echo race condition
    pendingWicketOutSlot = outSlot;

    matchState.thisOver.push('W');
    matchState.wkts++;
    matchState.balls++;

    const outBatter = matchState[outSlot];
    outBatter.balls++;
    outBatter.isOut = true;
    outBatterName = outBatter.name;

    if (!matchState.dismissedPlayers.some(d => (typeof d === 'string' ? d : d.name) === outBatterName)) {
        matchState.dismissedPlayers.push({
            name: outBatterName,
            runs: outBatter.runs || 0,
            balls: outBatter.balls || 0,
            fours: outBatter.fours || 0,
            sixes: outBatter.sixes || 0,
            dismissal: type,
            bowler: matchState.bowler.name || '-',
            fielder: fielder,
            timestamp: Date.now()
        });
    }

    const bp = battingPlayers.find(p => p.name === outBatterName);
    if (bp) { bp.isOut = true; bp.isPlaying = false; }

    if (type !== 'Run Out') {
        matchState.bowler.wickets++;
    }
    matchState.bowler.balls++;
    updateBowlerOvers();

    // [PARTNERSHIP FIX] Save partnership to history before reset
    if (matchState.partRuns > 0 || matchState.partBalls > 0) {
        const bat = matchState.striker === 1 ? matchState.bat1 : matchState.bat2;
        const nonBat = matchState.striker === 1 ? matchState.bat2 : matchState.bat1;
        if (!Array.isArray(matchState.partnershipHistory)) matchState.partnershipHistory = [];
        matchState.partnershipHistory.push({
            bat1: bat.name || '',
            bat2: nonBat.name || '',
            runs: matchState.partRuns || 0,
            balls: matchState.partBalls || 0,
            bat1Runs: bat.runs || 0,
            bat2Runs: nonBat.runs || 0,
        });
    }

    matchState.partRuns = 0;
    matchState.partBalls = 0;

    updateOvers();
    calculateCRR();
    updateDisplay();
    sendUpdate();

    sendCommand('trigger_hype', {
        type: 'WICKET',
        outSlot: outSlot,
        outBatterName: outBatterName,
        dismissalType: type,
        fielder: fielder,
        bowler: matchState.bowler.name || '-'
    });

    const legalBallsAfterWicket = countLegalBallsInOver();
    pendingBowlerPopup = legalBallsAfterWicket >= 6;

    const availableBatsmen = getAvailableBatsmen();

    if (matchState.wkts >= 10 || availableBatsmen.length === 0) {
        matchState[outSlot] = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
        if (outSlot === 'bat1') matchState.striker = 2;
        else matchState.striker = 1;
        pendingWicketOutSlot = null; // ✅ Clear
        updateDisplay();
        sendUpdate();
        setTimeout(() => handleMatchEndConditions(0), CONFIG.TIMING.HYPE_WICKET);
        showToast('All Out! Innings Over', 'error');
        return;
    }

    setTimeout(() => openNewBatterPopup(), CONFIG.TIMING.HYPE_WICKET);
}

// ==========================================
// SCORER FIELDER INPUT POPUP
// ==========================================
let pendingScorerFielderResolve = null;

function showScorerFielderInput(title, description) {
    return new Promise((resolve) => {
        pendingScorerFielderResolve = resolve;

        let popup = document.getElementById('scorerFielderPopup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'scorerFielderPopup';
            popup.className = 'popup-overlay';
            popup.innerHTML = `
                <div class="popup-card" style="border-radius:20px 20px 0 0;">
                    <div class="popup-header">
                        <h3 id="scorerFielderTitle">FIELDER</h3>
                        <button class="popup-close" onclick="cancelScorerFielderInput()">✕</button>
                    </div>
                    <div class="popup-body no-scroll">
                        <p id="scorerFielderDesc" style="color:var(--text-secondary);margin:0 0 16px;text-align:center;font-size:0.9rem;"></p>
                        <input type="text" id="scorerFielderNameInput" 
                            style="width:100%;padding:16px 20px;font-size:1.1rem;font-weight:700;
                            text-align:center;text-transform:uppercase;letter-spacing:1px;
                            background:rgba(0,0,0,0.4);border:2px solid rgba(248,180,0,0.3);
                            border-radius:14px;color:var(--text-primary);"
                            placeholder="Enter fielder name..." autocomplete="off">
                        <div id="scorerFielderQuickPicks" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;justify-content:center;"></div>
                    </div>
                    <div class="popup-footer">
                        <button class="btn btn-secondary" onclick="skipScorerFielderInput()">Skip</button>
                        <button class="btn btn-primary" onclick="confirmScorerFielderInput()">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(popup);
        }

        const titleEl = document.getElementById('scorerFielderTitle');
        const descEl = document.getElementById('scorerFielderDesc');
        const input = document.getElementById('scorerFielderNameInput');
        const quickPicks = document.getElementById('scorerFielderQuickPicks');

        if (titleEl) titleEl.textContent = title || 'FIELDER';
        if (descEl) descEl.textContent = description || 'Who?';
        if (input) input.value = '';

        // Build quick pick buttons from bowling team players
        if (quickPicks) {
            if (bowlingPlayers.length > 0) {
                quickPicks.innerHTML = bowlingPlayers.slice(0, 8).map(p =>
                    `<button onclick="quickPickScorerFielder('${escapeWcHtml(p.name)}')" 
                        style="padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);
                        background:rgba(255,255,255,0.06);color:var(--text-secondary);font-size:0.82rem;
                        font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.25s ease;">
                        ${escapeWcHtml(p.name)}
                    </button>`
                ).join('');
                quickPicks.style.display = 'flex';
            } else {
                quickPicks.innerHTML = '';
                quickPicks.style.display = 'none';
            }
        }

        popup.classList.add('show');
        setTimeout(() => input?.focus(), 150);
    });
}

function quickPickScorerFielder(name) {
    const input = document.getElementById('scorerFielderNameInput');
    if (input) input.value = name;
    confirmScorerFielderInput();
}

function confirmScorerFielderInput() {
    const input = document.getElementById('scorerFielderNameInput');
    const value = (input?.value || '').trim();
    closeScorerFielderPopup();
    if (pendingScorerFielderResolve) {
        pendingScorerFielderResolve(value || '-');
        pendingScorerFielderResolve = null;
    }
}

function skipScorerFielderInput() {
    closeScorerFielderPopup();
    if (pendingScorerFielderResolve) {
        pendingScorerFielderResolve('-');
        pendingScorerFielderResolve = null;
    }
}

function cancelScorerFielderInput() {
    closeScorerFielderPopup();
    if (pendingScorerFielderResolve) {
        pendingScorerFielderResolve('-');
        pendingScorerFielderResolve = null;
    }
}

function closeScorerFielderPopup() {
    const popup = document.getElementById('scorerFielderPopup');
    if (popup) popup.classList.remove('show');
}

// ==========================================
// PLAYER PICKERS
// ==========================================
function openPlayerPicker(slot) {
    if (lockStates.batsmen || lockStates.full) { showToast('Batsmen locked', 'error'); return; }
    currentPickerSlot = slot;
    document.getElementById('playerPickerTitle').innerText = `Select Batter ${slot}`;
    renderPlayerList();
    document.getElementById('playerPickerPopup').classList.add('show');
}

function closePlayerPicker() {
    document.getElementById('playerPickerPopup').classList.remove('show');
    currentPickerSlot = 0;
}

function renderPlayerList() {
    const container = document.getElementById('playerPickerList');
    document.getElementById('playerSearchInput').value = '';
    container.innerHTML = '';

    if (battingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No players loaded. Sync from admin.</div>';
        return;
    }

    battingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isOut = player.isOut || matchState.dismissedPlayers.some(d =>
            (typeof d === 'string' ? d : d.name) === player.name);
        const isCurrentB1 = matchState.bat1.name === player.name;
        const isCurrentB2 = matchState.bat2.name === player.name;
        const isPlaying = (isCurrentB1 || isCurrentB2) && !isOut;

        if (isOut || isPlaying) div.classList.add('disabled');

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;margin-left:12px;">
                <div class="player-name-row">
                    <span class="player-name">${escapeWcHtml(player.name)}</span>
                    ${isOut ? '<span class="out-badge">OUT</span>' : ''}
                    ${isCurrentB1 && !isOut ? '<span class="out-badge playing">B1</span>' : ''}
                    ${isCurrentB2 && !isOut ? '<span class="out-badge playing">B2</span>' : ''}
                </div>
                <div class="player-role">${escapeWcHtml(player.role)}</div>
            </div>`;

        if (!isOut && !isPlaying) div.onclick = () => selectBatter(player);
        container.appendChild(div);
    });
}

function filterPlayerList() {
    const search = document.getElementById('playerSearchInput').value.toLowerCase();
    document.querySelectorAll('#playerPickerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectBatter(player) {
    const slotKey = currentPickerSlot === 1 ? 'bat1' : 'bat2';
    matchState[slotKey] = { name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    const p = battingPlayers.find(bp => bp.name === player.name);
    if (p) p.isPlaying = true;
    closePlayerPicker();
    updateDisplay();
    sendUpdate();
    showToast(`${player.name} selected`, 'success');
}

// ==========================================
// NEW BATTER POPUP
// ==========================================
function openNewBatterPopup() {
    renderNewBatterList();
    document.getElementById('newBatterPopup').classList.add('show');
}

function closeNewBatterPopup() {
    document.getElementById('newBatterPopup').classList.remove('show');
}

function renderNewBatterList() {
    const container = document.getElementById('newBatterList');
    document.getElementById('newBatterSearchInput').value = '';
    container.innerHTML = '';

    if (battingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No players loaded.</div>';
        return;
    }

    battingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isOut = player.isOut || matchState.dismissedPlayers.some(d =>
            (typeof d === 'string' ? d : d.name) === player.name);
        const isCurrentB1 = matchState.bat1.name === player.name && !matchState.bat1.isOut;
        const isCurrentB2 = matchState.bat2.name === player.name && !matchState.bat2.isOut;

        if (isOut || isCurrentB1 || isCurrentB2) div.classList.add('disabled');

        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;margin-left:12px;">
                <div class="player-name-row">
                    <span class="player-name">${escapeWcHtml(player.name)}</span>
                    ${isOut ? '<span class="out-badge">OUT</span>' : ''}
                    ${isCurrentB1 ? '<span class="out-badge playing">B1</span>' : ''}
                    ${isCurrentB2 ? '<span class="out-badge playing">B2</span>' : ''}
                </div>
                <div class="player-role">${escapeWcHtml(player.role)}</div>
            </div>`;

        if (!isOut && !isCurrentB1 && !isCurrentB2) div.onclick = () => selectNewBatter(player);
        container.appendChild(div);
    });
}

function filterNewBatterList() {
    const search = document.getElementById('newBatterSearchInput').value.toLowerCase();
    document.querySelectorAll('#newBatterList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectNewBatter(player) {
    if (!player || !player.name) { showToast('Invalid player', 'error'); return; }

    const newBatterData = { name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };

    // ✅ FIX: Use global pendingWicketOutSlot to ensure correct batter is replaced
    if (pendingWicketOutSlot) {
        matchState[pendingWicketOutSlot] = newBatterData;
        pendingWicketOutSlot = null; // Clear after use
    } else {
        // Fallback to striker
        if (matchState.striker === 1) matchState.bat1 = newBatterData;
        else matchState.bat2 = newBatterData;
    }

    const newPlayer = battingPlayers.find(p => p.name === player.name);
    if (newPlayer) newPlayer.isPlaying = true;

    closeNewBatterPopup();
    updateDisplay();
    sendUpdate();

    if (updaterAutoSettings.autoProfile) sendNewBatterProfile(player.name);
    showToast(`${player.name} - Profile sent`, 'success');

    if (pendingBowlerPopup) {
        pendingBowlerPopup = false;
        setTimeout(() => openNextBowlerPopup(), CONFIG.TIMING.PROFILE_DURATION + 500);
    }
}

// ==========================================
// BOWLER PICKER
// ==========================================
function openBowlerPicker() {
    if (lockStates.bowler || lockStates.full) { showToast('Bowler locked', 'error'); return; }
    renderBowlerPickerList();
    document.getElementById('bowlerPickerPopup').classList.add('show');
}

function closeBowlerPicker() {
    document.getElementById('bowlerPickerPopup').classList.remove('show');
}

function renderBowlerPickerList() {
    const container = document.getElementById('bowlerPickerList');
    document.getElementById('bowlerPickerSearchInput').value = '';
    container.innerHTML = '';

    if (bowlingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No bowlers loaded.</div>';
        return;
    }

    bowlingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isCurrent = matchState.bowler.name === player.name;
        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;margin-left:12px;">
                <div class="player-name-row">
                    <span class="player-name">${escapeWcHtml(player.name)}</span>
                    ${isCurrent ? '<span class="out-badge playing">BOWLING</span>' : ''}
                </div>
                <div class="player-role">${escapeWcHtml(player.role)}</div>
            </div>`;
        div.onclick = () => selectBowler(player);
        container.appendChild(div);
    });
}

function filterBowlerPickerList() {
    const search = document.getElementById('bowlerPickerSearchInput').value.toLowerCase();
    document.querySelectorAll('#bowlerPickerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectBowler(player) {
    if (matchState.bowler.name) { bowlerHistory.push({ ...matchState.bowler }); updateBowlerHistoryDisplay(); }
    matchState.bowler = { name: player.name, overs: '0.0', runs: 0, wickets: 0, balls: 0 };
    closeBowlerPicker();
    updateDisplay();
    sendUpdate();
    showToast(`${player.name} is bowling`, 'success');
}

// ==========================================
// NEXT BOWLER POPUP
// ==========================================
function openNextBowlerPopup() {
    selectedNextBowler = null;
    renderNextBowlerList();
    document.getElementById('nextBowlerPopup').classList.add('show');
}

function closeNextBowlerPopup() {
    document.getElementById('nextBowlerPopup').classList.remove('show');
    selectedNextBowler = null;
}

function renderNextBowlerList() {
    const container = document.getElementById('nextBowlerList');
    document.getElementById('bowlerSearchInput').value = '';
    container.innerHTML = '';

    if (bowlingPlayers.length === 0) {
        container.innerHTML = '<div class="empty-text">No bowlers loaded.</div>';
        return;
    }

    bowlingPlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        const isCurrent = matchState.bowler.name === player.name;
        div.innerHTML = `
            <div class="picker-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;margin-left:12px;">
                <div class="player-name-row">
                    <span class="player-name">${escapeWcHtml(player.name)}</span>
                    ${isCurrent ? '<span class="out-badge">JUST BOWLED</span>' : ''}
                </div>
                <div class="player-role">${escapeWcHtml(player.role)}</div>
            </div>`;
        div.onclick = () => {
            container.querySelectorAll('.player-item').forEach(i => i.classList.remove('selecting'));
            div.classList.add('selecting');
            selectedNextBowler = player;
        };
        container.appendChild(div);
    });
}

function filterNextBowlerList() {
    const search = document.getElementById('bowlerSearchInput').value.toLowerCase();
    document.querySelectorAll('#nextBowlerList .player-item').forEach(item => {
        item.style.display = item.querySelector('.player-name').innerText.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function confirmNextBowler() {
    if (!selectedNextBowler) { showToast('Please select a bowler', 'error'); return; }
    if (matchState.bowler.name) { bowlerHistory.push({ ...matchState.bowler }); updateBowlerHistoryDisplay(); }
    matchState.thisOver = [];
    matchState.striker = matchState.striker === 1 ? 2 : 1;
    matchState.bowler = { name: selectedNextBowler.name, overs: '0.0', runs: 0, wickets: 0, balls: 0 };
    closeNextBowlerPopup();
    updateDisplay();
    sendUpdate();
    showToast('New over started', 'success');
}

function updateBowlerHistoryDisplay() {
    const container = document.getElementById('bowlerHistoryList');
    if (!container) return;
    if (bowlerHistory.length === 0) {
        container.innerHTML = '<div class="empty-text">No previous bowlers</div>';
        return;
    }
    container.innerHTML = bowlerHistory.map(b => `
        <div class="player-item" style="cursor:default;">
            <div class="picker-avatar">${b.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;margin-left:12px;">
                <span class="player-name">${escapeWcHtml(b.name)}</span>
                <span class="player-role">${b.wickets}-${b.runs} (${b.overs})</span>
            </div>
        </div>`).join('');
}

// ==========================================
// STRIKER / LOCK CONTROLS
// ==========================================
function setStriker(num) {
    if (lockStates.batsmen || lockStates.full) { showToast('Batsmen locked', 'error'); return; }
    matchState.striker = num;
    updateDisplay();
    sendUpdate();
}

function toggleLockState(type) {
    lockStates[type] = !lockStates[type];
    const btn = document.getElementById(`lock${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);
    if (lockStates[type]) {
        btn?.classList.add('active');
        if (btn) btn.innerHTML = btn.innerHTML.replace('🔓', '🔒');
        if (type === 'score' || type === 'full') {
            document.getElementById('scoreSectionLite')?.classList.add('section-locked');
            document.getElementById('actionsSectionLite')?.classList.add('section-locked');
        }
        if (type === 'batsmen' || type === 'full') document.getElementById('batsmenSectionLite')?.classList.add('section-locked');
        if (type === 'bowler' || type === 'full') document.getElementById('bowlerSectionLite')?.classList.add('section-locked');
    } else {
        btn?.classList.remove('active');
        if (btn) btn.innerHTML = btn.innerHTML.replace('🔒', '🔓');
        if (type === 'score') {
            document.getElementById('scoreSectionLite')?.classList.remove('section-locked');
            document.getElementById('actionsSectionLite')?.classList.remove('section-locked');
        }
        if (type === 'batsmen') document.getElementById('batsmenSectionLite')?.classList.remove('section-locked');
        if (type === 'bowler') document.getElementById('bowlerSectionLite')?.classList.remove('section-locked');
        if (type === 'full') document.querySelectorAll('.section-locked').forEach(el => el.classList.remove('section-locked'));
    }
    showToast(`${type} ${lockStates[type] ? 'locked' : 'unlocked'}`, 'success');
}

// ==========================================
// SEND COMMANDS
// ==========================================
function sendCommand(event, payload = {}, force = false) {
    if (!database || !isConnected) { console.warn('Cannot send command - not connected'); return; }
    if (!autoRealtimeEnabled && !force) {
        pendingCommandQueue.push({ event, payload });
        setPendingManualPush(true);
        return;
    }
    database.ref(`matches/${matchId}/command`).set({
        event, payload, ts: firebase.database.ServerValue.TIMESTAMP
    });
    messagesSent++;
    updateTechPanel();
}

function sendNewBatterProfile(playerName) {
    if (!database || !isConnected || !playerName) return;
    const fullPlayerData = allPlayersData.find(p => p.name === playerName);
    const battingPlayer = battingPlayers.find(p => p.name === playerName);
    sendCommand('show_profile', {
        name: playerName,
        photo: fullPlayerData?.photo_url || fullPlayerData?.photo_base64 || '',
        role: fullPlayerData?.role || battingPlayer?.role || 'NEW BATSMAN',
        school: fullPlayerData?.school || '',
        age: fullPlayerData?.age || ''
    });
}

function sendUpcomingBatter(name) { sendNewBatterProfile(name); }

// ==========================================
// BUILD UPDATE PAYLOAD
// ==========================================
function buildUpdatePayload() {
    calculateCRR();
    calculateWinProbability(); // ✅ FIX: Ensure winProb is calculated before building payload
    return {
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        runs: matchState.runs, wkts: matchState.wkts,
        overs: matchState.overs, crr: matchState.crr,
        target: matchState.target, totOvers: matchState.totOvers,
        striker: String(matchState.striker), isFreeHit: matchState.isFreeHit,
        thisOver: matchState.thisOver.join(' '),
        partRuns: matchState.partRuns, partBalls: matchState.partBalls,
        batFlag: matchState.battingTeam, bowlFlag: matchState.bowlingTeam,
        battingSide: parseInt(matchState.battingSide, 10) || 1, // [MISMATCH #1 FIX] Ensure number type for admin sync
        winProb: matchState.winProb, // ✅ FIX: Include winProb for WinViz chart sync
        overRunsHistory: matchState.overRunsHistory || [], // ✅ FIX: Include overRunsHistory for Worm/Manhattan chart sync
        partnershipHistory: matchState.partnershipHistory || [], // [PARTNERSHIP FIX] Send to admin for Supabase sync
        bat1: {
            name: matchState.bat1.name || '', runs: matchState.bat1.runs || 0,
            balls: matchState.bat1.balls || 0, fours: matchState.bat1.fours || 0,
            sixes: matchState.bat1.sixes || 0, isOut: matchState.bat1.isOut || false
        },
        bat2: {
            name: matchState.bat2.name || '', runs: matchState.bat2.runs || 0,
            balls: matchState.bat2.balls || 0, fours: matchState.bat2.fours || 0,
            sixes: matchState.bat2.sixes || 0, isOut: matchState.bat2.isOut || false
        },
        bowler: {
            name: matchState.bowler.name || '',
            figs: `${matchState.bowler.wickets}-${matchState.bowler.runs} ${matchState.bowler.overs}`,
            overs: matchState.bowler.overs || '0.0',
            runs: matchState.bowler.runs || 0,
            wickets: matchState.bowler.wickets || 0,
            balls: matchState.bowler.balls || 0
        },
        dismissedPlayers: matchState.dismissedPlayers.map(p =>
            typeof p === 'string'
                ? { name: p, runs: 0, balls: 0, dismissal: 'OUT', bowler: '-', fielder: '-' }
                : p
        )
    };
}

// ==========================================
// SEND UPDATE
// ==========================================
function sendUpdate(force = false) {
    if (!database || !isConnected) return;
    const payload = buildUpdatePayload();
    if (!autoRealtimeEnabled && !force) { setPendingManualPush(true); return; }
    Promise.all([
        database.ref(`matches/${matchId}/scorer_update`).set(payload),
        database.ref(`matches/${matchId}/live`).update(payload)
    ])
        .then(() => { setPendingManualPush(false); refreshUpdaterPresence(); })
        .catch((err) => { console.error('Send failed:', err); showToast('Push failed', 'error'); });
    messagesSent++;
    updateTechPanel();
}

// ==========================================
// SEND HYPE — Updated to pass wicket details
// ==========================================
function sendHype(type, extraData = {}) {
    sendCommand('trigger_hype', { type, ...extraData });
}

// ==========================================
// SCORER.JS - PART 2/2 (CLEANED)
// ==========================================

// ==========================================
// WINNER CARD CSS INJECTION
// ==========================================
function injectWinnerCelebStyles() {
    if (document.getElementById('winnerCelebStyle')) return;
    const style = document.createElement('style');
    style.id = 'winnerCelebStyle';
    style.textContent = `
#winnerCelebrationPopup {
    position:fixed;inset:0;z-index:9000;
    display:flex;align-items:flex-end;justify-content:center;
    padding:0;background:rgba(0,0,0,0);
    transition:background 0.4s ease;
    font-family:'Plus Jakarta Sans',sans-serif;
}
#winnerCelebrationPopup.show { background:rgba(0,0,0,0.85); backdrop-filter:blur(12px); }
.wc-card {
    position:relative;width:100%;max-width:95vw;max-height:92vh;
    background:linear-gradient(160deg,#0f0f14 0%,#1a1410 50%,#0f0f14 100%);
    border:1px solid rgba(248,180,0,0.3);border-radius:20px 20px 0 0;
    padding:0 0 20px 0;transform:translateY(100%);
    transition:transform 0.45s cubic-bezier(0.34,1.56,0.64,1);overflow:hidden;
}
.wc-card::before {
    content:'';position:absolute;top:0;left:-100%;width:100%;height:2px;
    background:linear-gradient(90deg,transparent,#F8B400,#fff,#F8B400,transparent);
    animation:wcShimmer 2.5s ease-in-out infinite;
}
@keyframes wcShimmer { 0%{left:-100%} 100%{left:100%} }
.wc-card.slide-up { transform:translateY(0); }
.wc-trophy-wrap { padding:16px 8px 0;display:flex;justify-content:center; }
.wc-trophy {
    font-size:42px;display:block;
    filter:drop-shadow(0 0 18px rgba(248,180,0,0.8));
    opacity:0;transform:scale(0.4) rotate(-15deg);
    transition:all 0.5s ease 0.2s;
}
.wc-trophy.pop-in { opacity:1;transform:scale(1) rotate(0); }
.wc-label {
    text-align:center;font-size:0.55rem;font-weight:900;
    color:rgba(255,255,255,0.35);letter-spacing:4px;text-transform:uppercase;
    margin:4px 0 2px;opacity:0;transition:opacity 0.3s ease 0.35s;
}
.wc-label.fade-in { opacity:1; }
.wc-winner-name {
    text-align:center;font-size:1.25rem;font-weight:900;
    color:#F8B400;letter-spacing:0.5px;text-transform:uppercase;
    padding:0 12px;line-height:1.2;opacity:0;transform:translateY(12px);
    transition:all 0.4s ease 0.45s;
}
.wc-winner-name.slide-in { opacity:1;transform:translateY(0); }
.wc-margin {
    text-align:center;font-size:0.85rem;font-weight:900;
    color:#fff;letter-spacing:1.5px;text-transform:uppercase;
    margin:4px 12px 0;opacity:0;transition:opacity 0.3s ease 0.6s;
}
.wc-margin.fade-in { opacity:1; }
.wc-vs-section {
    display:flex;align-items:center;justify-content:center;
    gap:8px;margin:10px 12px 0;padding:8px 10px;
    background:rgba(255,255,255,0.03);
    border:1px solid rgba(255,255,255,0.06);border-radius:12px;
    opacity:0;transform:translateY(8px);transition:all 0.4s ease 0.7s;
}
.wc-vs-section.slide-in { opacity:1;transform:translateY(0); }
.wc-team-col { display:flex;flex-direction:column;align-items:center;gap:4px;flex:1; }
.wc-team-logo {
    width:48px;height:48px;border-radius:50%;overflow:hidden;
    display:flex;align-items:center;justify-content:center;
    border:3px solid rgba(248,180,0,0.6);background:rgba(248,180,0,0.1);
}
.wc-team-logo.loser-logo {
    border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.06);
}
.wc-team-logo img { width:80%;height:80%;object-fit:contain; }
.wc-team-logo-text { font-size:12px;font-weight:900;color:#F8B400;text-align:center; }
.wc-team-logo.loser-logo .wc-team-logo-text { color:rgba(255,255,255,0.4); }
.wc-team-short { font-size:0.62rem;font-weight:900;color:#F8B400;text-transform:uppercase;text-align:center; }
.wc-team-short.loser { color:rgba(255,255,255,0.4); }
.wc-team-tag {
    font-size:0.48rem;font-weight:900;padding:2px 6px;border-radius:4px;letter-spacing:0.5px;
    background:rgba(248,180,0,0.12);color:rgba(248,180,0,0.85);
}
.wc-team-tag.loser-tag { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.3); }
.wc-vs-mid { font-size:0.7rem;font-weight:900;color:rgba(255,255,255,0.2);flex-shrink:0; }
.wc-score-pill {
    display:flex;justify-content:center;margin:10px 12px 0;
    opacity:0;transform:scale(0.92);transition:all 0.4s ease 0.8s;
}
.wc-score-pill.pop-in { opacity:1;transform:scale(1); }
.wc-score-inner {
    background:rgba(248,180,0,0.09);border:2px solid rgba(248,180,0,0.38);
    border-radius:999px;padding:6px 16px;display:flex;align-items:center;gap:10px;
}
.wc-score-inner.tied-pill { background:rgba(147,197,253,0.08);border-color:rgba(147,197,253,0.35); }
.wc-score-num { font-size:1.4rem;font-weight:900;color:#F8B400;letter-spacing:-0.5px;line-height:1; }
.wc-score-num.tied-num { color:#93c5fd; }
.wc-score-detail { display:flex;flex-direction:column;gap:2px;text-align:left; }
.wc-score-overs { font-size:0.62rem;font-weight:700;color:rgba(255,255,255,0.5); }
.wc-score-crr { font-size:0.58rem;font-weight:800;color:rgba(248,180,0,0.7);letter-spacing:0.3px; }
.wc-score-crr.tied-crr { color:rgba(147,197,253,0.7); }
.wc-divider {
    height:1px;background:linear-gradient(90deg,transparent,rgba(248,180,0,0.25),transparent);
    margin:14px 16px;opacity:0;transition:opacity 0.3s ease 0.9s;
}
.wc-divider.fade-in { opacity:1; }
.wc-stats {
    display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px;
    opacity:0;transform:translateY(10px);transition:all 0.4s ease 0.95s;
}
.wc-stats.slide-in { opacity:1;transform:translateY(0); }
.wc-stat-card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:10px; }
.wc-stat-title {
    font-size:0.55rem;font-weight:900;color:#F8B400;letter-spacing:1.5px;
    text-transform:uppercase;margin-bottom:7px;display:flex;align-items:center;gap:4px;
}
.wc-stat-title::after { content:'';flex:1;height:1px;background:rgba(248,180,0,0.18); }
.wc-stat-row {
    display:flex;justify-content:space-between;align-items:center;
    padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);
}
.wc-stat-row:last-child { border-bottom:none; }
.wc-stat-player {
    font-size:0.68rem;font-weight:700;color:#fff;flex:1;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:4px;
}
.wc-stat-val { font-size:0.8rem;font-weight:900;color:#F8B400;white-space:nowrap; }
.wc-stat-sub { font-size:0.55rem;font-weight:600;color:rgba(255,255,255,0.35);margin-left:3px; }
.wc-not-out {
    font-size:0.48rem;font-weight:900;color:#F8B400;
    background:rgba(248,180,0,0.12);padding:1px 4px;border-radius:3px;margin-left:3px;
}
.wc-actions {
    display:flex;gap:8px;padding:14px 12px 0;
    opacity:0;transition:opacity 0.3s ease 1.1s;
}
.wc-actions.fade-in { opacity:1; }
.wc-btn-dismiss,.wc-btn-share {
    padding:12px;border-radius:12px;font-size:0.8rem;
    font-weight:800;cursor:pointer;font-family:inherit;border:none;
}
.wc-btn-dismiss {
    flex:1;background:rgba(255,255,255,0.05);
    color:rgba(255,255,255,0.65);border:1px solid rgba(255,255,255,0.1);
}
.wc-btn-share { flex:2;background:linear-gradient(135deg,#F8B400,#d97706);color:#111;letter-spacing:0.3px; }
.wc-btn-share.tied-share { background:linear-gradient(135deg,#93c5fd,#3b82f6);color:#fff; }
.wc-particle {
    position:fixed;border-radius:2px;opacity:0;pointer-events:none;
    z-index:9001;animation:wcParticleFall linear forwards;
}
@keyframes wcParticleFall {
    0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1);}
    80%{opacity:0.8;}
    100%{opacity:0;transform:translateY(100vh) rotate(720deg) scale(0.4);}
}
.wc-ring {
    position:fixed;border-radius:50%;border:2px solid #F8B400;
    pointer-events:none;z-index:9001;animation:wcRingExpand 0.75s ease-out forwards;
}
@keyframes wcRingExpand { 0%{transform:scale(0);opacity:0.9;} 100%{transform:scale(4);opacity:0;} }

/* ==========================================
   GOD MODE ALERT - SCORER
   ========================================== */
.god-mode-alert {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0);
    backdrop-filter: blur(0px);
    transition: background 0.35s ease, backdrop-filter 0.35s ease;
    pointer-events: none;
}
.god-mode-alert.show {
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(14px);
    pointer-events: all;
}
.god-mode-alert-content {
    position: relative;
    width: 100%;
    max-width: 380px;
    background: linear-gradient(160deg, #1a0505 0%, #2d0a0a 50%, #1a0505 100%);
    border: 2px solid rgba(239, 68, 68, 0.5);
    border-radius: 24px;
    padding: 32px 24px 24px;
    text-align: center;
    box-shadow: 0 0 60px rgba(239, 68, 68, 0.3), 0 0 120px rgba(239, 68, 68, 0.1);
    transform: scale(0.8) translateY(20px);
    opacity: 0;
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease;
    animation: gmBorderPulse 2s ease-in-out infinite;
}
.god-mode-alert.show .god-mode-alert-content {
    transform: scale(1) translateY(0);
    opacity: 1;
}
@keyframes gmBorderPulse {
    0%, 100% { box-shadow: 0 0 40px rgba(239,68,68,0.3), 0 0 80px rgba(239,68,68,0.1); }
    50% { box-shadow: 0 0 70px rgba(239,68,68,0.6), 0 0 140px rgba(239,68,68,0.2); }
}
.god-mode-alert-close {
    position: absolute;
    top: 12px; right: 14px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.6);
    border-radius: 50%;
    width: 30px; height: 30px;
    font-size: 0.8rem; font-weight: 900;
    cursor: pointer; display: flex;
    align-items: center; justify-content: center;
    transition: all 0.2s ease;
}
.god-mode-alert-close:hover { background: rgba(239,68,68,0.3); color: #fff; }
.god-mode-alert-icon {
    font-size: 52px;
    margin-bottom: 8px;
    display: block;
    filter: drop-shadow(0 0 20px rgba(239,68,68,0.8));
    animation: gmIconBounce 1s ease-in-out infinite alternate;
}
@keyframes gmIconBounce {
    0% { transform: scale(1); }
    100% { transform: scale(1.12); }
}
.god-mode-alert-from {
    font-size: 0.6rem;
    font-weight: 900;
    color: rgba(239,68,68,0.8);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 12px;
}
.god-mode-alert-message {
    font-size: 1.05rem;
    font-weight: 700;
    color: #fff;
    line-height: 1.5;
    margin-bottom: 24px;
    padding: 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    word-break: break-word;
}
.god-mode-alert-actions {
    display: flex;
    gap: 10px;
}
.god-mode-btn {
    flex: 1; padding: 13px;
    border-radius: 12px;
    font-size: 0.85rem; font-weight: 900;
    cursor: pointer; border: none;
    font-family: inherit;
    transition: transform 0.15s ease, opacity 0.15s ease;
}
.god-mode-btn:active { transform: scale(0.96); opacity: 0.9; }
.god-mode-btn-dismiss {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.65);
    border: 1px solid rgba(255,255,255,0.12);
}
.god-mode-btn-ok {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #fff;
    box-shadow: 0 4px 20px rgba(239,68,68,0.4);
}
`;
    document.head.appendChild(style);
}

// ==========================================
// GOD MODE ALERT - FULLY FIXED
// ==========================================
function showGodModeAlert(message, from = 'GOD MODE') {
    // Inject styles first
    injectWinnerCelebStyles();

    // Remove existing
    const existing = document.getElementById('godModeScorerAlert');
    if (existing) existing.remove();

    const alertDiv = document.createElement('div');
    alertDiv.id = 'godModeScorerAlert';
    alertDiv.className = 'god-mode-alert';

    alertDiv.innerHTML = `
        <div class="god-mode-alert-content">
            <button class="god-mode-alert-close" id="gmAlertCloseBtn">✕</button>
            <div class="god-mode-alert-icon">🎮</div>
            <div class="god-mode-alert-from">${escapeWcHtml(from)}</div>
            <div class="god-mode-alert-message">${escapeWcHtml(message)}</div>
            <div class="god-mode-alert-actions">
                <button class="god-mode-btn god-mode-btn-dismiss" id="gmAlertDismissBtn">Dismiss</button>
                <button class="god-mode-btn god-mode-btn-ok" id="gmAlertOkBtn">OK ✓</button>
            </div>
        </div>
    `;

    document.body.appendChild(alertDiv);

    // ✅ FIX: Attach event listeners safely (no inline onclick issues)
    alertDiv.querySelector('#gmAlertCloseBtn').addEventListener('click', closeGodModeAlert);
    alertDiv.querySelector('#gmAlertDismissBtn').addEventListener('click', closeGodModeAlert);
    alertDiv.querySelector('#gmAlertOkBtn').addEventListener('click', closeGodModeAlert);

    // ✅ FIX: Use requestAnimationFrame for CSS transition to work
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            alertDiv.classList.add('show');
        });
    });

    // Haptic feedback
    safeVibrate([200, 100, 200, 100, 300]);

    console.log('🎮 God Mode Alert shown:', message);
}

function closeGodModeAlert() {
    const alertEl = document.getElementById('godModeScorerAlert');
    if (!alertEl) return;
    alertEl.classList.remove('show');
    setTimeout(() => {
        if (alertEl.parentNode) alertEl.remove();
    }, 400);
}

// ==========================================
// WINNER CELEBRATION POPUP
// ==========================================
function showWinnerCelebrationPopup(winnerData) {
    injectWinnerCelebStyles();

    const old = document.getElementById('winnerCelebrationPopup');
    if (old) old.remove();

    const {
        winnerTeamName = '', winnerShortName = '', winnerLogo = '',
        loserTeamName = '', loserShortName = '', loserLogo = '',
        marginText = '', score = '0/0', overs = '0.0', crr = '0.00',
        topBatsmen = [], topBowlers = [], isTied = false
    } = winnerData;

    const mainColor = isTied ? '#93c5fd' : '#F8B400';
    const trophyEmoji = isTied ? '🤝' : '🏆';

    const buildLogoEl = (logoSrc, shortName, isWinner) => {
        const cls = isWinner ? 'wc-team-logo' : 'wc-team-logo loser-logo';
        const safe = escapeWcHtml((shortName || '').slice(0, 3));
        if (logoSrc && logoSrc.length > 10) {
            return `<div class="${cls}"><img src="${escapeWcHtml(logoSrc)}" alt="${safe}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span class="wc-team-logo-text" style="display:none;">${safe}</span></div>`;
        }
        return `<div class="${cls}"><span class="wc-team-logo-text">${safe}</span></div>`;
    };

    const vsSection = isTied
        ? `<div class="wc-vs-section slide-in" style="justify-content:center;"><span style="font-size:0.9rem;font-weight:900;color:rgba(147,197,253,0.7);">🤝 Both teams gave their best!</span></div>`
        : `<div class="wc-vs-section" id="wcVsSection">
            <div class="wc-team-col">${buildLogoEl(winnerLogo, winnerShortName, true)}<span class="wc-team-short">${escapeWcHtml(winnerShortName)}</span><span class="wc-team-tag">WINNER</span></div>
            <div class="wc-vs-mid">VS</div>
            <div class="wc-team-col">${buildLogoEl(loserLogo, loserShortName, false)}<span class="wc-team-short loser">${escapeWcHtml(loserShortName)}</span><span class="wc-team-tag loser-tag">RUNNER UP</span></div>
           </div>`;

    const batsmenRows = topBatsmen.length > 0
        ? topBatsmen.map(b => `<div class="wc-stat-row"><span class="wc-stat-player">${escapeWcHtml(b.name)}${!b.isOut ? '<span class="wc-not-out">★</span>' : ''}</span><div><span class="wc-stat-val">${b.runs || 0}</span><span class="wc-stat-sub">(${b.balls || 0}b)</span></div></div>`).join('')
        : '<div class="wc-stat-row"><span class="wc-stat-player" style="color:rgba(255,255,255,0.3);">No data</span></div>';

    const bowlersRows = topBowlers.length > 0
        ? topBowlers.map(b => `<div class="wc-stat-row"><span class="wc-stat-player">${escapeWcHtml(b.name)}</span><div><span class="wc-stat-val">${b.wickets || 0}/${b.runs || 0}</span><span class="wc-stat-sub">(${b.overs || '0.0'})</span></div></div>`).join('')
        : '<div class="wc-stat-row"><span class="wc-stat-player" style="color:rgba(255,255,255,0.3);">No data</span></div>';

    const popup = document.createElement('div');
    popup.id = 'winnerCelebrationPopup';
    popup.innerHTML = `
        <div class="wc-card">
            <div class="wc-trophy-wrap"><span class="wc-trophy">${trophyEmoji}</span></div>
            <div class="wc-label">Match Result</div>
            <div class="wc-winner-name" style="color:${mainColor};">${escapeWcHtml(winnerTeamName)}</div>
            <div class="wc-margin">${escapeWcHtml(marginText)}</div>
            ${vsSection}
            <div class="wc-score-pill">
                <div class="wc-score-inner ${isTied ? 'tied-pill' : ''}">
                    <div class="wc-score-num ${isTied ? 'tied-num' : ''}">${escapeWcHtml(score)}</div>
                    <div class="wc-score-detail">
                        <span class="wc-score-overs">${escapeWcHtml(overs)} OVERS</span>
                        <span class="wc-score-crr ${isTied ? 'tied-crr' : ''}">${isTied ? 'Both teams scored equal' : 'CRR ' + escapeWcHtml(String(crr))}</span>
                    </div>
                </div>
            </div>
            <div class="wc-divider"></div>
            <div class="wc-stats">
                <div class="wc-stat-card"><div class="wc-stat-title">🏏 Top Batsmen</div>${batsmenRows}</div>
                <div class="wc-stat-card"><div class="wc-stat-title">🎯 Top Bowlers</div>${bowlersRows}</div>
            </div>
            <div class="wc-actions">
                <button class="wc-btn-dismiss" id="wcDismissBtn">✕ Close</button>
                <button class="wc-btn-share ${isTied ? 'tied-share' : ''}" id="wcShareBtn">${isTied ? '🤝 Share Tie!' : '🎉 Celebrate!'}</button>
            </div>
        </div>`;

    document.body.appendChild(popup);

    // ✅ Safe event listeners (no inline onclick)
    popup.querySelector('#wcDismissBtn').addEventListener('click', closeWinnerCelebrationPopup);
    popup.querySelector('#wcShareBtn').addEventListener('click', shareWinnerResult);

    // Animate
    requestAnimationFrame(() => {
        popup.classList.add('show');
        setTimeout(() => popup.querySelector('.wc-card')?.classList.add('slide-up'), 50);
        setTimeout(() => popup.querySelector('.wc-trophy')?.classList.add('pop-in'), 250);
        setTimeout(() => { popup.querySelector('.wc-label')?.classList.add('fade-in'); popup.querySelector('.wc-winner-name')?.classList.add('slide-in'); }, 400);
        setTimeout(() => popup.querySelector('.wc-margin')?.classList.add('fade-in'), 580);
        setTimeout(() => popup.querySelector('.wc-vs-section')?.classList.add('slide-in'), 700);
        setTimeout(() => popup.querySelector('.wc-score-pill')?.classList.add('pop-in'), 850);
        setTimeout(() => { popup.querySelector('.wc-divider')?.classList.add('fade-in'); popup.querySelector('.wc-stats')?.classList.add('slide-in'); }, 950);
        setTimeout(() => popup.querySelector('.wc-actions')?.classList.add('fade-in'), 1100);
        setTimeout(() => { launchConfetti(45); launchFireworkRings(3); }, 320);

        if (winnerPopupTimer) clearTimeout(winnerPopupTimer);
        winnerPopupTimer = setTimeout(() => closeWinnerCelebrationPopup(), 25000);
    });
}

// ==========================================
// CONFETTI
// ==========================================
function launchConfetti(count = 40) {
    const colors = ['#F8B400', '#FFD700', '#fff', '#86efac', '#fca5a5', '#93c5fd'];
    const shapes = ['square', 'circle', 'rect'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const p = document.createElement('div');
            p.className = 'wc-particle';
            const color = colors[Math.floor(Math.random() * colors.length)];
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            const size = Math.random() * 10 + 5;
            const duration = Math.random() * 2 + 1.5;
            const delay = Math.random() * 0.8;
            p.style.cssText = `left:${Math.random() * window.innerWidth}px;top:-20px;width:${shape === 'rect' ? size * 1.8 : size}px;height:${shape === 'circle' ? size : size * 0.6}px;background:${color};border-radius:${shape === 'circle' ? '50%' : '2px'};animation-duration:${duration}s;animation-delay:${delay}s;`;
            document.body.appendChild(p);
            setTimeout(() => p.remove(), (duration + delay + 0.5) * 1000);
        }, i * 30);
    }
}

// ==========================================
// FIREWORK RINGS
// ==========================================
function launchFireworkRings(count = 3) {
    const colors = ['#F8B400', '#fff', '#86efac', '#fca5a5'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const ring = document.createElement('div');
            ring.className = 'wc-ring';
            const size = Math.random() * 30 + 20;
            const color = colors[Math.floor(Math.random() * colors.length)];
            ring.style.cssText = `left:${Math.random() * window.innerWidth}px;top:${Math.random() * (window.innerHeight * 0.6)}px;width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;border-color:${color};animation-duration:${0.6 + Math.random() * 0.4}s;`;
            document.body.appendChild(ring);
            setTimeout(() => ring.remove(), 1200);
        }, i * 200);
    }
}

// ==========================================
// CLOSE WINNER POPUP
// ==========================================
function closeWinnerCelebrationPopup() {
    if (winnerPopupTimer) { clearTimeout(winnerPopupTimer); winnerPopupTimer = null; }
    const popup = document.getElementById('winnerCelebrationPopup');
    if (!popup) return;
    popup.querySelector('.wc-card')?.classList.remove('slide-up');
    setTimeout(() => {
        popup.classList.remove('show');
        setTimeout(() => { if (popup.parentNode) popup.remove(); }, 300);
    }, 400);
}

// ==========================================
// SHARE / CELEBRATE
// ==========================================
function shareWinnerResult() {
    launchConfetti(80);
    launchFireworkRings(6);
    safeVibrate([100, 50, 100, 50, 100, 50, 300]);
    showToast('🎉 Celebrating!', 'success');
    if (navigator.share) {
        const popup = document.getElementById('winnerCelebrationPopup');
        const winnerName = popup?.querySelector('.wc-winner-name')?.innerText || '';
        const margin = popup?.querySelector('.wc-margin')?.innerText || '';
        const score = popup?.querySelector('.wc-score-num')?.innerText || '';
        navigator.share({
            title: '🏆 Match Result',
            text: `🏏 ${winnerName}\n${margin}\nScore: ${score}\n\n#Cricket #STC`,
        }).catch(() => { });
    }
}

// ==========================================
// SEND WINNER CARD (Fixed - single command)
// ==========================================
function sendWinnerCard() {
    const target = matchState.target || 0;
    const runs = matchState.runs;
    const wkts = matchState.wkts;
    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;

    let winnerTeamName = '', winnerShortName = '', loserTeamName = '',
        loserShortName = '', marginText = '', resultLine = '';

    // TIED
    if (target > 0 && runs === target - 1 && (wkts >= 10 || ballsBowled >= maxBalls)) {
        const tiedData = {
            winnerTeamName: 'MATCH TIED', marginText: 'MATCH TIED',
            resultLine: `Both teams scored ${runs} runs`,
            score: `${runs}/${wkts}`, overs: matchState.overs,
            crr: matchState.crr, topBatsmen: [], topBowlers: [], isTied: true
        };
        sendCommand('show_winner_card', { ...tiedData, duration: 20000 });
        sendCommand('show_admin_winner_popup', tiedData);
        showWinnerCelebrationPopup(tiedData);
        return;
    }

    // CHASING TEAM WON
    if (target > 0 && runs >= target) {
        winnerShortName = matchState.battingTeam || 'BAT';
        loserShortName = matchState.bowlingTeam || 'BOWL';
        winnerTeamName = winnerShortName; loserTeamName = loserShortName;
        const wktsLeft = Math.max(0, 10 - wkts);
        marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
        resultLine = `${runs}/${wkts} in ${matchState.overs} overs`;
    }
    // DEFENDING TEAM WON
    else if (target > 0 && runs < target) {
        winnerShortName = matchState.bowlingTeam || 'BOWL';
        loserShortName = matchState.battingTeam || 'BAT';
        winnerTeamName = winnerShortName; loserTeamName = loserShortName;
        const defendedScore = target - 1;
        const runsMargin = Math.max(1, defendedScore - runs);
        marginText = `WON BY ${runsMargin} RUN${runsMargin === 1 ? '' : 'S'}`;
        resultLine = `Defended ${defendedScore} • ${loserShortName} ${runs}/${wkts}`;
    }
    // NO TARGET
    else {
        winnerShortName = matchState.battingTeam || 'TEAM';
        winnerTeamName = winnerShortName; loserTeamName = ''; loserShortName = '';
        marginText = 'MATCH FINISHED';
        resultLine = `${runs}/${wkts} in ${matchState.overs} overs`;
    }

    // Stats
    const allBatsmen = [];
    const dismissedNames = new Set();
    matchState.dismissedPlayers.forEach(p => {
        const name = typeof p === 'string' ? p : p.name;
        if (!name) return;
        dismissedNames.add(name);
        allBatsmen.push({ name, runs: typeof p === 'object' ? (p.runs || 0) : 0, balls: typeof p === 'object' ? (p.balls || 0) : 0, isOut: true });
    });
    if (matchState.bat1.name && !matchState.bat1.isOut && !dismissedNames.has(matchState.bat1.name)) allBatsmen.push({ ...matchState.bat1, isOut: false });
    if (matchState.bat2.name && !matchState.bat2.isOut && !dismissedNames.has(matchState.bat2.name)) allBatsmen.push({ ...matchState.bat2, isOut: false });

    const topBatsmen = allBatsmen.sort((a, b) => (b.runs || 0) - (a.runs || 0)).slice(0, 3);
    const topBowlers = matchState.bowler.name
        ? [{ name: matchState.bowler.name, wickets: matchState.bowler.wickets || 0, runs: matchState.bowler.runs || 0, overs: matchState.bowler.overs || '0.0' }]
        : [];

    const balls = oversToBalls(matchState.overs);
    const crr = balls > 0 ? (runs / (balls / 6)).toFixed(2) : '0.00';

    // ✅ Single command send
    // [Winner Fix] Correctly determine winner/loser logos based on who actually won
    // Uses t1Logo/t2Logo + battingSide for accurate resolution (same logic as admin)
    let winnerLogo, loserLogo;
    const bs = matchState.battingSide || 1;
    const t1L = matchState.t1Logo || '';
    const t2L = matchState.t2Logo || '';

    if (target > 0 && runs >= target) {
        // Chasing team won - winner is batting team
        winnerLogo = bs === 1 ? t1L : t2L;
        loserLogo = bs === 1 ? t2L : t1L;
    } else if (target > 0 && runs < target) {
        // Defending team won - winner is bowling team
        winnerLogo = bs === 1 ? t2L : t1L;
        loserLogo = bs === 1 ? t1L : t2L;
    } else {
        // No target / other - default to batting team as winner
        winnerLogo = bs === 1 ? t1L : t2L;
        loserLogo = bs === 1 ? t2L : t1L;
    }

    const winnerPopupData = {
        winnerTeamName, winnerShortName,
        winnerLogo,
        loserTeamName, loserShortName,
        loserLogo,
        marginText, resultLine,
        score: `${runs}/${wkts}`, overs: matchState.overs, crr,
        topBatsmen, topBowlers: topBowlers.slice(0, 3), isTied: false
    };

    sendCommand('show_winner_card', { ...winnerPopupData, duration: 20000 });
    sendCommand('show_admin_winner_popup', winnerPopupData);
    showWinnerCelebrationPopup(winnerPopupData);
    console.log('🏆 Winner card sent:', winnerTeamName, marginText);
}

// ==========================================
// SYNC FROM ADMIN
// ==========================================
function syncFromAdmin() {
    if (!database || !isConnected) { showToast('Not connected', 'error'); return; }
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.classList.add('syncing');
    Promise.all([database.ref(`matches/${matchId}/live`).once('value'), loadTeamsFromFirebase(true)])
        .then(([liveSnap]) => {
            const data = liveSnap.val();
            if (data) {
                if (data.batFlag) updateTeamPlayers(data.batFlag, data.bowlFlag);
                loadMatchState(data);
                rerenderOpenPopupLists();
                showToast('Synced from admin', 'success');
            }
            if (syncBtn) syncBtn.classList.remove('syncing');
        })
        .catch(() => {
            if (syncBtn) syncBtn.classList.remove('syncing');
            showToast('Sync failed', 'error');
        });
}

function reconnectAll() { showToast('Reconnecting...', 'success'); connectToMatch(); }

// ==========================================
// UI TOGGLES
// ==========================================
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) btn.classList.add('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById('tab-' + tabName)?.classList.add('active');
}

function toggleConnPanel() {
    const details = document.getElementById('connDetails');
    if (!details) return;
    details.classList.toggle('show');
    const icon = document.getElementById('connExpandIcon');
    if (icon) icon.innerText = details.classList.contains('show') ? '▲' : '▼';
}

function toggleTechPanel() {
    const content = document.getElementById('techContent');
    if (!content) return;
    content.classList.toggle('show');
    const icon = document.getElementById('techExpandIcon');
    if (icon) icon.innerText = content.classList.contains('show') ? '▲' : '▼';
}

// ==========================================
// DISCONNECT & RESET
// ==========================================
function showDisconnectConfirm() { document.getElementById('disconnectPopup').classList.add('show'); }
function closeDisconnectPopup() { document.getElementById('disconnectPopup').classList.remove('show'); }

function disconnectMatch() {
    closeDisconnectPopup();
    stopPresenceRefresh();
    clearMatchListeners();
    if (database && matchId) {
        database.ref(`presence/${matchId}/updater`).set({
            online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP,
            name: scorerName || '', version: '33.1', pingMs: 0
        });
    }
    selfPingMs = null; lastScorebarPingMs = null;
    updatePingDisplay(); isConnected = false;
    showLoginScreen();
    showToast('Disconnected', 'success');
}

function openResetPopup() {
    if (lockStates.full) { showToast('Safe mode is on', 'error'); return; }
    document.getElementById('resetConfirmPopup').classList.add('show');
}

function resetScorerMatch() { openResetPopup(); }

function closeResetPopup() {
    document.getElementById('resetConfirmPopup').classList.remove('show');
}

function executeResetMatch() {
    closeResetPopup();
    const oldTotOvers = matchState.totOvers;
    const oldBattingTeam = matchState.battingTeam;
    const oldBowlingTeam = matchState.bowlingTeam;

    matchState = {
        runs: 0, wkts: 0, overs: '0.0', balls: 0, thisOver: [], target: 0,
        totOvers: oldTotOvers || 20, crr: '0.00', striker: 1, isFreeHit: false,
        partRuns: 0, partBalls: 0,
        bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
        bowler: { name: '', overs: '0.0', runs: 0, wickets: 0, balls: 0 },
        battingTeam: oldBattingTeam, bowlingTeam: oldBowlingTeam,
        prevInnings: null, isMatchEnded: false, dismissedPlayers: []
    };

    bowlerHistory = [];
    pendingBowlerPopup = false;
    pendingWicketOutSlot = null; // ✅ FIX: Clear on reset
    previousTarget = 0;
    battingPlayers.forEach(p => { p.isOut = false; p.isPlaying = false; });

    updateDisplay();
    rerenderOpenPopupLists();

    if (database && isConnected) {
        database.ref(`matches/${matchId}/command`).set({
            event: 'hide_graphics', payload: {}, ts: firebase.database.ServerValue.TIMESTAMP
        });
    }

    sendUpdate(true);
    showToast('Match reset for all screens', 'success');
}

// ==========================================
// RECENT MATCHES
// ==========================================
function loadRecentMatches() {
    const recent = JSON.parse(localStorage.getItem('scorer_recent') || '[]');
    const container = document.getElementById('recentList');
    if (!container) return;
    if (recent.length === 0) {
        container.innerHTML = '<div class="empty-text">No recent matches</div>';
        return;
    }
    container.innerHTML = recent.slice(0, 5).map(item => {
        const safeId = escapeWcHtml(String(item.id || ''));
        return `<div class="recent-item" data-matchid="${safeId}">
            <div class="recent-item-id">${safeId}</div>
            <div class="recent-item-date">${escapeWcHtml(item.date)}</div>
        </div>`;
    }).join('');

    // ✅ Safe event listeners (no inline onclick)
    container.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => selectRecentMatch(item.dataset.matchid));
    });
}

function addToRecentMatches(id) {
    let recent = JSON.parse(localStorage.getItem('scorer_recent') || '[]');
    recent = recent.filter(item => item.id !== id);
    recent.unshift({ id, date: new Date().toLocaleString() });
    localStorage.setItem('scorer_recent', JSON.stringify(recent.slice(0, 10)));
}

function selectRecentMatch(id) {
    const input = document.getElementById('inputMatchId');
    if (input) input.value = id;
}

function clearLocalOnly() {
    localStorage.removeItem('scorer_matchId');
    localStorage.removeItem('scorer_name');
    clearTeamsCache();
    showToast('Local storage cleared', 'success');
}

function forceSaveNow() { manualPushNow(); }

// ==========================================
// WINDOW EVENTS
// ==========================================
window.addEventListener('beforeunload', () => {
    stopPresenceRefresh();
    if (database && matchId && isConnected) {
        database.ref(`presence/${matchId}/updater`).set({
            online: false, lastSeen: Date.now(),
            name: scorerName || '', version: '33.1', pingMs: 0
        });
    }
});

window.addEventListener('offline', () => {
    isConnected = false;
    stopPresenceRefresh();
    selfPingMs = null; lastScorebarPingMs = null;
    updatePingDisplay(); updateConnectionStatus();
    showToast('Connection lost', 'error');
});

window.addEventListener('online', () => {
    showToast('Internet restored', 'success');
    if (matchId && scorerName) connectToMatch();
});

// ==========================================
// VALIDATION: Active Players Check
// ==========================================
function validateActivePlayers() {
    const missing = [];
    if (!matchState.bat1.name) missing.push('Batsman 1');
    if (!matchState.bat2.name) missing.push('Batsman 2');
    if (!matchState.bowler.name) missing.push('Bowler');
    if (missing.length > 0) {
        showToast(`⚠️ Please select ${missing.join(', ')}`, 'error');
        highlightMissingSlots();
        return false;
    }
    return true;
}

function highlightMissingSlots() {
    if (!matchState.bat1.name) shakeValidationSlot('b1Name');
    if (!matchState.bat2.name) shakeValidationSlot('b2Name');
    if (!matchState.bowler.name) shakeValidationSlot('bowlName');
}

function shakeValidationSlot(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('validation-shake');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.classList.remove('validation-shake'), 900);
}

// ==========================================
// GLOBAL EXPORTS
// ==========================================
Object.assign(window, {
    // Core
    joinMatch, addBall, addCustomBall, undoBall, clearOver, swapStriker, endOver,
    // Extras
    openExtrasPopup, closeExtrasPopup, confirmExtras,
    // Wicket
    openWicketPopup, closeWicketPopup, confirmWicket,
    selectRunOutScorerBatter, cancelRunOutScorerPopup,
    // Pickers
    openPlayerPicker, closePlayerPicker, filterPlayerList,
    openBowlerPicker, closeBowlerPicker, filterBowlerPickerList,
    openNextBowlerPopup, closeNextBowlerPopup, filterNextBowlerList, confirmNextBowler,
    openNewBatterPopup, closeNewBatterPopup, filterNewBatterList,
    // Controls
    setStriker, toggleLockState,
    // Sync
    syncFromAdmin, reconnectAll,
    // UI
    switchTab, toggleConnPanel, toggleTechPanel,
    // Disconnect/Reset
    showDisconnectConfirm, closeDisconnectPopup, disconnectMatch,
    openResetPopup, resetScorerMatch, closeResetPopup, executeResetMatch,
    // Misc
    clearLocalOnly, forceSaveNow, selectRecentMatch,
    showChaseStartPopup, closeChaseStartPopup,
    showSuperOverPopup, closeSuperOverPopup,
    toggleRealtimeMode, manualPushNow,
    closeDeviceAlert, openDeviceAlertPanel,
    sendCommand, sendNewBatterProfile, sendUpcomingBatter,
    forceRefreshTeams, clearTeamsCache,
    sendSpecialOverlay, hideSpecialOverlay,
    // Winner
    showWinnerCelebrationPopup, closeWinnerCelebrationPopup, shareWinnerResult,
    launchConfetti, launchFireworkRings,
    // God Mode
    showGodModeAlert, closeGodModeAlert,
    // Utils
    escapeWcHtml,

    validateActivePlayers, highlightMissingSlots, shakeValidationSlot,

    // Fielder input
    quickPickScorerFielder, confirmScorerFielderInput,
    skipScorerFielderInput, cancelScorerFielderInput
});

// ==========================================
// USER PROFILE BADGE + LOGOUT (Scorer Header)
// ==========================================
function injectScorerProfileBadge(user) {
    if (!user) return;
    const headerRight = document.querySelector('.scorer-header .header-right');
    if (!headerRight) return;

    const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
    const avatarHTML = user.photoURL
        ? `<img src="${user.photoURL}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span style="display:none;">${initial}</span>`
        : `<span>${initial}</span>`;

    // --- Conn-panel profile section (always, top of dashboard) ---
    const connAvatar = document.getElementById('connProfileAvatar');
    const connName   = document.getElementById('connProfileName');
    const connEmail  = document.getElementById('connProfileEmail');
    if (connAvatar) {
        if (user.photoURL) {
            connAvatar.innerHTML = `<img src="${user.photoURL}" alt="" onerror="this.parentElement.textContent='${initial}'">`;
        } else {
            connAvatar.textContent = initial;
        }
    }
    if (connName)  connName.textContent  = user.displayName || user.email?.split('@')[0] || 'Scorer';
    if (connEmail) connEmail.textContent = user.email || '';

    // --- Header badge (desktop) ---
    const existing = document.getElementById('scorerProfileBadge');
    if (existing) {
        const img = existing.querySelector('.upb-avatar img');
        const emailEl = existing.querySelector('.upb-email');
        if (user.photoURL && img) img.src = user.photoURL;
        if (emailEl) emailEl.textContent = user.email || '';
    } else {
        const badge = document.createElement('div');
        badge.id = 'scorerProfileBadge';
        badge.className = 'user-profile-badge';
        badge.innerHTML = `
            <div class="upb-avatar">${avatarHTML}</div>
            <span class="upb-email">${escapeWcHtml(user.email || '')}</span>
            <button class="upb-logout-btn" onclick="scorerLogout()" title="Sign Out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
        `;
        headerRight.insertBefore(badge, headerRight.firstChild);
    }
}

async function scorerLogout() {
    console.log('🚪 Scorer logging out...');
    stopPresenceRefresh();
    clearMatchListeners();

    if (database && matchId && isConnected) {
        try {
            await database.ref(`presence/${matchId}/updater`).set({
                online: false, lastSeen: Date.now(),
                name: scorerName || '', version: '33.1', pingMs: 0
            });
        } catch (e) { }
    }

    isConnected = false;
    matchId = '';
    scorerName = '';
    showLoginScreen();

    // Remove profile badge
    const badge = document.getElementById('scorerProfileBadge');
    if (badge) badge.remove();

    // ✅ Show auth-card overlay again (Google Sign In)
    if (typeof signOutAuth === 'function') {
        await signOutAuth();
    }
}

console.log('🏏 Scorer V33.1 Fully Fixed Loaded');
console.log('✅ God Mode Alert - Fixed (CSS transitions + event listeners)');
console.log('✅ Duplicate functions removed');
console.log('✅ Winner card - single command send');
console.log('✅ All bugs fixed');