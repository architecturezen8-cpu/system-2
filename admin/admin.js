// ==========================================
// ADMIN.JS - V31.0 ALL BUGS FIXED
// 100% Firebase Realtime Database
// Zero Bandwidth Presence System
// All 19 bugs from analysis report fixed
// ==========================================

// ==========================================
// CONFIG
// ==========================================
const APP_VERSION = '31.0'; // ✅ Version bump after bug fixes

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
    STORAGE_KEY: 'adminMatchStateV30',
    CACHE: {
        TEAMS_KEY: 'stc_teams_cache_v2',
        VERSION_KEY: 'stc_data_version_v2',
        MAX_AGE_MS: 24 * 60 * 60 * 1000
    }
};

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = localStorage.getItem('matchId') || 'my_match_999';
let firebaseApp = null;
let database = null;
let isClearing = false;

let autoUpdateEnabled = true;
let autoAllOutEnabled = true;
let msgCount = 0;
let lastForceTrig = '';

let teams = [];
let allPlayers = [];
let selectedProfilePlayer = null;
let playerPickerTarget = '';
let teamSelectorTarget = 0;
let selectedNextBowler = null;
let selectedNextBatsman = null;
let pendingWicketSlot = null;
let pendingBowlerAfterWicket = false;

let isWicketFlowActive = false;
let lastLocalEditTime = 0;
const EDIT_LOCK_DURATION = 2000; // [SCORER FIX] Reduced from 5s — was blocking scorer updates too aggressively

// Firebase listeners references (for cleanup)
let connListener = null;
let presenceListener = null;
let scorerUpdateListener = null;
let commandListener = null;
let teamUpdateListener = null;
let updaterSettingsListener = null;
// ✅ BUG-008 FIX: Also store unsubscribe functions for Firebase v9 compat
let connUnsub = null;
let presenceUnsub = null;
let scorerUpdateUnsub = null;
let commandUnsub = null;

// Connection state
const connectedApps = {
    updater: {
        online: false, lastSeen: 0, version: '', pingMs: null, name: '',
        device: {
            battery: { supported: false, level: null, charging: null, low: false, critical: false },
            network: { online: false, rawType: 'unknown', effectiveType: 'unknown', label: 'Unknown', signalBars: 0, signalPct: 0, downlink: 0, rtt: 0, unstable: false },
            autoRealtimeEnabled: true, pendingManualPush: false
        }
    },
    scorebar: { online: false, lastSeen: 0, version: '', pingMs: null },
    monitor: { online: false, lastSeen: 0, version: '', pingMs: null }
};

let animSettings = {
    fourDuration: 2500, sixDuration: 2500, wicketDuration: 3000,
    profileDuration: 5000, milestoneDuration: 8000, carouselInterval: 20000,
    viewHoldDuration: 7000, newBatterDelay: 1600, resultDelay: 3000, queueGap: 500
};

let matchState = {
    runs: 0, wkts: 0, overs: '0.0', target: 0, totOvers: 20, oversPreset: 't20',
    crr: '0.00', batFlag: 'BAT', bowlFlag: 'BOWL', matchType: 'limited',
    status: 'LIVE MATCH', striker: '1', isFreeHit: false, thisOver: '',
    partRuns: 0, partBalls: 0, winProb: 50,
    bat1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bat2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    bowler: { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0 },
    t1Logo: '', t2Logo: '', team1: null, team2: null, team1Id: null, team2Id: null,
    battingSide: 1, testDay: 1, testSession: 1, testInnings: 1,
    isSpecial: false, specialText: '', dismissedPlayers: [],
    lastWicketType: '', showUpcomingBatter: false, upcomingBatterName: '',
    bowlingHistory: [],
    // [Fix #5] Per-over runs history for chart sync across devices via Firebase
    overRunsHistory: [],
    // [BUG-02 FIX] Snapshots of completed innings for Supabase dual-write
    innings1Snapshot: null,
    innings2Snapshot: null,
    // [BUG-03 FIX] Super Over state tracking
    isSuperOver: false,
    superOverRound: 0,
    _tiedScore: '',
    _tiedOvers: '',
    // [BUG-04 FIX] Partnership history tracking
    partnershipHistory: [],
    // [BUG-07 FIX] Team score at each ball for accurate Fall of Wickets
    _currentTeamScore: 0,
};

let currentOver = [];
let historyStack = [];
let realtimePingMs = null;
let pingInterval = null;
let presenceRefreshInterval = null;

const locks = { setup: false, teams: false, score: false, batsmen: false, bowler: false };

// ==========================================
// INIT - FIXED double initialization
// ==========================================
let adminInitialized = false; // ✅ Flag to prevent running twice

document.addEventListener('DOMContentLoaded', async () => {
    // ⚡ INIT AUTH SYSTEM - Admin role ekata check karanna
    if (typeof initPageAuth === 'function') {
        initPageAuth('admin');
    } else {
        console.error('Auth.js not loaded!');
    }

    // ⚡ WAIT FOR AUTH APPROVAL before loading Admin Panel
    document.addEventListener('auth-approved', async (e) => {
        if (adminInitialized) return; // ✅ Already initialized, skip!
        adminInitialized = true;
        // Show logged-in user profile at top
        injectUserProfileBadge(e.detail?.user);

        const { user, userData } = e.detail || {};
        console.log('✅ Auth approved for Admin Panel!', userData);

        // Auth approve una passe witharai meka run wenne
        loadFromLocalStorage();
        initUI();
        bindAllInputListeners();
        await initFirebase();
        updateStorageInfo();

        setInterval(updateConnectionStatusUI, 3000);
        setInterval(updateStorageInfo, 60000);
        setInterval(saveToLocalStorage, 30000);

        document.querySelectorAll('.modal-overlay, .popup-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('show');
            });
        });

        window.addEventListener('online', () => showToast('Internet restored'));
        window.addEventListener('offline', () => showToast('Internet disconnected', 'error'));

        console.log(`🏏 Admin Panel ${APP_VERSION} Firebase Ready (Auth Protected)`);
    });
});

document.addEventListener('auth-revoked', (e) => {
    const { reason, isRoleRevoke } = e.detail || {};

    if (!adminInitialized) {
        console.warn('🚫 Auth revoked but admin not initialized — ignoring');
        return;
    }

    console.warn('🚫 Admin access revoked:', reason, isRoleRevoke ? '(role)' : '(deny)');

    adminInitialized = false;
    stopPingMonitor();
    stopPresenceRefresh();

    if (database && matchId) {
        database.ref(`presence/${matchId}/admin`).set({
            online: false, lastSeen: Date.now()
        }).catch(() => { });
    }

    saveToLocalStorage();

    const badge = document.getElementById('userProfileBadge');
    if (badge) badge.remove();

    if (isRoleRevoke) {
        showToast('⚠️ Admin access removed. Contact owner.', 'error');
    } else {
        showToast('⚠️ Access revoked: ' + (reason || 'Contact owner'), 'error');
    }

    setTimeout(() => location.reload(true), 2000);
});

// ==========================================
// FIREBASE INIT (Auth.js eken already init, just grab the instance)
// ==========================================
async function initFirebase() {
    try {
        updateSupabaseStatus('connecting');
        if (!window.firebase) throw new Error('Firebase library not loaded');

        // Auth.js eken already initialize una neda balala, na nam api initialize karanawa
        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        } else {
            firebaseApp = firebase.apps[0];
        }

        database = firebase.database();
        updateSupabaseStatus('connected');
        await loadTeams();
        setupFirebaseRealtime();
    } catch (e) {
        console.error('Firebase init failed:', e);
        updateSupabaseStatus('error');
        showToast('Firebase init failed', 'error');
    }
}

// ==========================================
// FIREBASE REALTIME (with cleanup) - FIXED
// ==========================================
function setupFirebaseRealtime() {
    updateRealtimeStatus('connecting');

    // ✅ FIX: Properly detach old listeners using ref.off()
    if (connListener && database) { database.ref('.info/connected').off('value', connListener); }
    if (presenceListener && database) { database.ref(`presence/${matchId}`).off('value', presenceListener); }
    if (scorerUpdateListener && database) { database.ref(`matches/${matchId}/scorer_update`).off('value', scorerUpdateListener); }
    if (commandListener && database) { database.ref(`matches/${matchId}/command`).off('value', commandListener); }

    const amOnline = database.ref('.info/connected');
    const myPresenceRef = database.ref(`presence/${matchId}/admin`);

    connListener = (snapshot) => { // ✅ FIX: Define as function to store reference
        if (snapshot.val()) {
            myPresenceRef.onDisconnect().set({
                online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            myPresenceRef.set({
                online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP,
                version: APP_VERSION, pingMs: 0
            });
            updateRealtimeStatus('connected');
            updateBroadcastLabel('Live');
            showToast('Connected to Match Server');
            startPingMonitor();
            startPresenceRefresh();
            listenForTeamUpdates();
            loadUpdaterAutoSettings();
        } else {
            updateRealtimeStatus('error');
            updateBroadcastLabel('Offline');
            stopPingMonitor();
            stopPresenceRefresh();
            realtimePingMs = null;
            updatePingBars();
        }
    };
    amOnline.on('value', connListener);

    presenceListener = (snap) => {
        const data = snap.val() || {}; // ✅ snap undefined na anymore!
        if (data.updater) {
            const incomingDevice = data.updater.device || {};
            connectedApps.updater = {
                ...connectedApps.updater, ...data.updater,
                device: {
                    ...(connectedApps.updater.device || {}), ...incomingDevice,
                    battery: { ...((connectedApps.updater.device || {}).battery || {}), ...(incomingDevice.battery || {}) },
                    network: { ...((connectedApps.updater.device || {}).network || {}), ...(incomingDevice.network || {}) }
                }
            };
        }
        if (data.scorebar) connectedApps.scorebar = { ...connectedApps.scorebar, ...data.scorebar };
        if (data.monitor) connectedApps.monitor = { ...connectedApps.monitor, ...data.monitor };
        updateConnectionStatusUI();
        updatePingBars();
    };
    database.ref(`presence/${matchId}`).on('value', presenceListener);

    scorerUpdateListener = (snap) => {
        const payload = snap.val();
        if (payload && payload.timestamp) {
            console.log('🔄 Match state updated from Mobile Updater');
            handleScorerSync(payload);
        }
    };
    database.ref(`matches/${matchId}/scorer_update`).on('value', scorerUpdateListener);

    commandListener = (snap) => {
        const cmd = snap.val();
        if (!cmd || !cmd.event) return;
        if (cmd.event === 'show_admin_winner_popup') {
            showAdminWinnerPopup(cmd.payload);
        }
    };
    database.ref(`matches/${matchId}/command`).on('value', commandListener);
}

// Listeners already registered above with stored callback references

// ==========================================
// LIGHTWEIGHT PING SYSTEM (Fixed accumulation)
// ==========================================
async function measureRealtimePing() {
    if (!database || !navigator.onLine) { realtimePingMs = null; updatePingBars(); return; }
    try {
        const start = performance.now();
        // ✅ Fixed: Use update with a fixed path instead of creating new nodes
        await database.ref(`ping/${matchId}/admin_probe`).update({
            latest: { t: firebase.database.ServerValue.TIMESTAMP, ts: Date.now() }
        });
        realtimePingMs = Math.max(1, Math.round(performance.now() - start));
    } catch (e) { realtimePingMs = null; }
    updatePingBars();
}

function startPingMonitor() {
    stopPingMonitor();
    measureRealtimePing();
    pingInterval = setInterval(measureRealtimePing, 10000);
}

function stopPingMonitor() {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

// ==========================================
// PRESENCE REFRESH
// ==========================================
async function refreshAdminPresence() {
    if (!database || !navigator.onLine) return;
    try {
        await database.ref(`presence/${matchId}/admin`).update({
            online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP,
            version: APP_VERSION, pingMs: realtimePingMs ?? 0
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshAdminPresence();
    presenceRefreshInterval = setInterval(refreshAdminPresence, 10000);
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) { clearInterval(presenceRefreshInterval); presenceRefreshInterval = null; }
}

// ==========================================
// PING BAR UI
// ==========================================
function updatePingBars() {
    setPingBar('realtimePingValue', 'realtimePingFill', realtimePingMs);
    setPingBar('scorebarPingValue', 'scorebarPingFill',
        isAppCurrentlyOnline('scorebar') ? connectedApps.scorebar.pingMs : null);
}

function setPingBar(valueId, fillId, ms) {
    const valueEl = document.getElementById(valueId);
    const fillEl = document.getElementById(fillId);
    if (!valueEl || !fillEl) return;
    if (ms === null || ms === undefined || Number.isNaN(ms) || ms <= 0) {
        valueEl.textContent = '-- ms'; fillEl.style.width = '0%'; fillEl.style.background = 'var(--danger)'; return;
    }
    const safeMs = Math.min(Math.max(Math.round(ms), 0), 999);
    valueEl.textContent = `${safeMs} ms`;
    let width = 100, color = 'var(--success)';
    if (safeMs <= 60) { width = 100; color = 'var(--success)'; }
    else if (safeMs <= 120) { width = 80; color = 'var(--success)'; }
    else if (safeMs <= 220) { width = 60; color = 'var(--warning)'; }
    else if (safeMs <= 350) { width = 40; color = 'var(--warning)'; }
    else { width = 18; color = 'var(--danger)'; }
    fillEl.style.width = `${width}%`; fillEl.style.background = color;
}

function isAppCurrentlyOnline(appName) {
    const appState = connectedApps[appName];
    return appState ? appState.online === true : false;
}

// ==========================================
// CACHED TEAMS LOADER (unchanged, already fine)
// ==========================================
function loadTeamsFromCache() {
    try {
        const cached = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
        if (!cached || cached === "undefined") return null;
        const data = JSON.parse(cached);
        if (Date.now() - (data.timestamp || 0) > CONFIG.CACHE.MAX_AGE_MS) return null;
        return data;
    } catch (e) {
        localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
        return null;
    }
}

function saveTeamsToCache(teamsData, playersData, version) {
    try {
        localStorage.setItem(CONFIG.CACHE.TEAMS_KEY, JSON.stringify({
            teams: teamsData, players: playersData, version, timestamp: Date.now()
        }));
    } catch (e) { localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY); }
}

async function getTeamsServerVersion() {
    try { const snap = await database.ref('data_version/teams').once('value'); return snap.val() || 0; }
    catch (e) { return 0; }
}

async function isTeamsCacheValid(cachedData) {
    if (!cachedData || !cachedData.version) return false;
    const serverVersion = await getTeamsServerVersion();
    return !(serverVersion > cachedData.version);
}

function clearTeamsCache() { localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY); }

// ==========================================
// LOAD TEAMS (with Cache)
// ==========================================
async function loadTeams(forceRefresh = false) {
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
                database.ref('teams').orderByChild('name').once('value'),
                database.ref('players').orderByChild('name').once('value'),
                database.ref('data_version/teams').once('value')
            ]);
            teamsData = teamsSnap.val() || {};
            playersData = playersSnap.val() || {};
            currentVersion = versionSnap.val() || Date.now();
            saveTeamsToCache(teamsData, playersData, currentVersion);
        }
        allPlayers = Object.entries(playersData).map(([id, player]) => ({ id, ...player }));
        teams = Object.entries(teamsData).map(([id, team]) => ({
            id, ...team, players: allPlayers.filter(p => p.team_id === id)
        }));
        teams.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        reconcileSelectedTeamsFromIds();
        renderTeamSelectors();
        renderSquadPreview();
        updateActivePlayerCards();
    } catch (e) {
        console.error('Failed to load teams:', e);
        const cached = loadTeamsFromCache();
        if (cached && cached.teams) {
            allPlayers = Object.entries(cached.players || {}).map(([id, player]) => ({ id, ...player }));
            teams = Object.entries(cached.teams || {}).map(([id, team]) => ({
                id, ...team, players: allPlayers.filter(p => p.team_id === id)
            }));
            reconcileSelectedTeamsFromIds();
            renderTeamSelectors();
            renderSquadPreview();
            updateActivePlayerCards();
            showToast('Using offline team data', 'error');
        } else { showToast('Failed to load teams', 'error'); }
    }
}

async function forceRefreshTeams() {
    clearTeamsCache(); await loadTeams(true); showToast('Teams refreshed from server');
}
// ==========================================
// INNINGS SNAPSHOT — BUG-02 FIX
// Saves completed innings before reset so Supabase always
// receives BOTH innings_1 and innings_2 in every dual-write
// ==========================================
function saveInningsSnapshot() {
    const isTeam1Batting = matchState.battingSide === 1;
    const inningsNum = isTeam1Batting ? 1 : 2;
    const battingTeam = isTeam1Batting ? TEAM_INFO.team1 : TEAM_INFO.team2;
    const bowlingTeam = isTeam1Batting ? TEAM_INFO.team2 : TEAM_INFO.team1;

    const snapshot = {
        battingTeam: battingTeam.name,
        bowlingTeam: bowlingTeam.name,
        totalRuns: matchState.runs,
        totalWkts: matchState.wkts,
        totalOvers: String(matchState.overs),
        maxOvers: matchState.totOvers || 20,
        extras: { total: 0, wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
        batting: buildBattingCard(matchState.dismissedPlayers, matchState.bat1, matchState.bat2),
        bowling: buildBowlingCard(matchState.bowler),
        fallOfWickets: buildFallOfWickets(matchState.dismissedPlayers),
        overByOver: buildOverByOver(matchState.overRunsHistory),
        partnerships: buildPartnerships(matchState.partnershipHistory),
    };

    if (inningsNum === 1) {
        matchState.innings1Snapshot = snapshot;
    } else {
        matchState.innings2Snapshot = snapshot;
    }

    saveToLocalStorage();
    console.log('[BUG-02] Innings ' + inningsNum + ' snapshot saved: ' + matchState.runs + '/' + matchState.wkts + ' (' + matchState.overs + ')');
}


function listenForTeamUpdates() {
    if (!database) return;
    const ref = database.ref('data_version/teams');
    if (teamUpdateListener) ref.off('value', teamUpdateListener);
    teamUpdateListener = ref.on('value', (snap) => {
        const serverVersion = snap.val();
        const cached = loadTeamsFromCache();
        if (cached && serverVersion && serverVersion > cached.version) {
            loadTeams(true);
        }
    });
}

// ==========================================
// BROADCAST / SEND DATA (with error handling)
// ==========================================
function sendCommand(event, payload = {}) {
    if (!database) return;
    database.ref(`matches/${matchId}/command`).set({
        event, payload, ts: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
        msgCount++; updateMsgCount(); updateLastSync();
    }).catch(err => {
        console.error('sendCommand error:', err);
        showToast('Command send failed', 'error');
    });
}

function buildPayload(extra = {}) {
    calculateWinProbability();
    const battingTeam = getBattingTeam();
    const bat1Player = findPlayerByName(matchState.bat1.name, battingTeam);
    const bat2Player = findPlayerByName(matchState.bat2.name, battingTeam);

    return {
        timestamp: firebase.database.ServerValue.TIMESTAMP, matchId,
        runs: matchState.runs, wkts: matchState.wkts, overs: matchState.overs,
        target: matchState.target, totOvers: matchState.totOvers,
        oversPreset: matchState.oversPreset || 't20', crr: matchState.crr,
        batFlag: matchState.batFlag, bowlFlag: matchState.bowlFlag,
        battingSide: matchState.battingSide, // [Winner Fix] Send battingSide for correct logo resolution
        t1Logo: matchState.t1Logo, t2Logo: matchState.t2Logo,
        matchType: matchState.matchType, status: matchState.status,
        testMatch: matchState.matchType === 'test' ? {
            day: matchState.testDay, session: matchState.testSession, innings: matchState.testInnings
        } : null,
        bat1: {
            name: matchState.bat1.name ?? '', runs: matchState.bat1.runs ?? 0,
            balls: matchState.bat1.balls ?? 0, fours: matchState.bat1.fours ?? 0,
            sixes: matchState.bat1.sixes ?? 0, isOut: matchState.bat1.isOut ?? false,
            photo: bat1Player ? (bat1Player.photo_url || bat1Player.photo_base64 || '') : ''
        },
        bat2: {
            name: matchState.bat2.name ?? '', runs: matchState.bat2.runs ?? 0,
            balls: matchState.bat2.balls ?? 0, fours: matchState.bat2.fours ?? 0,
            sixes: matchState.bat2.sixes ?? 0, isOut: matchState.bat2.isOut ?? false,
            photo: bat2Player ? (bat2Player.photo_url || bat2Player.photo_base64 || '') : ''
        },
        striker: matchState.striker,
        bowler: {
            name: matchState.bowler.name ?? '', figs: matchState.bowler.figs ?? '0-0 0.0',
            wickets: matchState.bowler.wickets ?? 0, runs: matchState.bowler.runs ?? 0,
            balls: matchState.bowler.balls ?? 0
        },
        thisOver: currentOver.join(' '), isFreeHit: matchState.isFreeHit,
        partRuns: matchState.partRuns, partBalls: matchState.partBalls,
        winProb: matchState.winProb,
        autoCarousel: document.getElementById('autoCarousel')?.checked ?? true,
        enTarget: document.getElementById('enTarget')?.checked ?? true,
        enPart: document.getElementById('enPart')?.checked ?? true,
        enPred: document.getElementById('enPred')?.checked ?? true,
        enChase: document.getElementById('enChase')?.checked ?? true,
        autoAllOutEnabled: isAutoAllOutEnabled(),
        isSpecial: matchState.isSpecial, specialText: matchState.specialText,
        animSettings, forceView: lastForceTrig,
        dismissedPlayers: (matchState.dismissedPlayers || []).map(p => {
            if (typeof p === 'string') return { name: p, runs: 0, balls: 0, dismissal: 'OUT', bowler: '-', fielder: '-' };
            return { ...p };
        }),
        showUpcomingBatter: false, upcomingBatterName: '',
        showAllOutCard: false, allOutData: null, showMilestone: false, milestoneData: null,
        // [Fix #5] Send overRunsHistory to Firebase for cross-device chart sync
        overRunsHistory: matchState.overRunsHistory || [],
        ...extra
    };
}

function sendLiveData(extra = {}) {
    if (!database) { showToast('Database not connected', 'error'); return Promise.resolve(); }
    const payload = buildPayload(extra);
    return database.ref(`matches/${matchId}/live`).update(payload)
        .then(() => { 
            msgCount++; updateMsgCount(); updateLastSync();
            // ✅ SUPABASE DUAL-WRITE: Mirror to Supabase after Firebase success
            supabaseDualWrite(payload);
        })
        .catch(err => {
            console.error("Firebase Update Error:", err);
            showToast('Failed to update scoreboard', 'error');
        });
}

function forceSend() {
    updateMatchState(); sendLiveData(); showToast('Data pushed to scoreboard');
}

// ==========================================
// SCORER SYNC HANDLER - FIXED: Accept overRunsHistory + winProb, re-broadcast to Firebase
// ==========================================
function handleScorerSync(payload) {
    if (!payload) return;
    if (Date.now() - lastLocalEditTime < EDIT_LOCK_DURATION) {
        console.log('⏸️ Scorer sync delayed - admin is editing');
        showToast('Scorer update received (not applied - editing)', 'error');
        return;
    }
    matchState.runs = parseInt(payload.runs, 10) || 0;
    matchState.wkts = Math.min(parseInt(payload.wkts, 10) || 0, 10);
    matchState.overs = sanitizeOversInput(payload.overs || '0.0');
    if (payload.target !== undefined) matchState.target = parseInt(payload.target, 10) || 0;
    if (payload.totOvers !== undefined) matchState.totOvers = parseInt(payload.totOvers, 10) || matchState.totOvers || 20;
    if (payload.batFlag) matchState.batFlag = payload.batFlag;
    if (payload.bowlFlag) matchState.bowlFlag = payload.bowlFlag;
    matchState.striker = String(payload.striker || matchState.striker || '1');
    // [MISMATCH #3 FIX] Sync battingSide from scorer — critical for correct TEAM_INFO lookup in buildSupabasePayload
    if (payload.battingSide !== undefined && payload.battingSide !== null) {
        const newSide = parseInt(payload.battingSide, 10) || 1;
        if (newSide !== matchState.battingSide) {
            matchState.battingSide = newSide;
            updateTeamsHeader(); // re-sync batFlag/bowlFlag from new side
        }
    }
    matchState.isFreeHit = !!payload.isFreeHit;
    matchState.thisOver = payload.thisOver || '';
    currentOver = matchState.thisOver ? matchState.thisOver.split(' ').filter(Boolean) : [];
    if (payload.partRuns !== undefined) matchState.partRuns = parseInt(payload.partRuns, 10) || 0;
    if (payload.partBalls !== undefined) matchState.partBalls = parseInt(payload.partBalls, 10) || 0;

    // ✅ FIX: Accept overRunsHistory from scorer for chart sync across devices
    if (Array.isArray(payload.overRunsHistory) && payload.overRunsHistory.length > 0) {
        // Only update if scorer has more recent/complete data
        if (payload.overRunsHistory.length >= (matchState.overRunsHistory || []).length) {
            matchState.overRunsHistory = payload.overRunsHistory.map(o => ({
                runs: parseInt(o.runs) || 0,
                isWicket: !!o.isWicket
            }));
        }
    }

    // ✅ FIX: Accept winProb from scorer for WinViz chart sync
    if (payload.winProb !== undefined && payload.winProb !== null) {
        matchState.winProb = Math.max(0, Math.min(100, parseInt(payload.winProb, 10) || 50));
    }

    if (payload.bat1) {
        matchState.bat1 = {
            name: payload.bat1.name || '', runs: parseInt(payload.bat1.runs, 10) || 0,
            balls: parseInt(payload.bat1.balls, 10) || 0, fours: parseInt(payload.bat1.fours, 10) || 0,
            sixes: parseInt(payload.bat1.sixes, 10) || 0, isOut: !!payload.bat1.isOut
        };
    }
    if (payload.bat2) {
        matchState.bat2 = {
            name: payload.bat2.name || '', runs: parseInt(payload.bat2.runs, 10) || 0,
            balls: parseInt(payload.bat2.balls, 10) || 0, fours: parseInt(payload.bat2.fours, 10) || 0,
            sixes: parseInt(payload.bat2.sixes, 10) || 0, isOut: !!payload.bat2.isOut
        };
    }
    if (payload.bowler) {
        let bW = 0, bR = 0, bB = 0;
        if (payload.bowler.figs) {
            const pf = parseBowlerFigures(payload.bowler.figs);
            bW = pf.wickets; bR = pf.runs; bB = pf.balls;
        } else {
            bW = parseInt(payload.bowler.wickets, 10) || 0;
            bR = parseInt(payload.bowler.runs, 10) || 0;
            bB = parseInt(payload.bowler.balls, 10) || 0;
        }
        matchState.bowler = {
            name: payload.bowler.name || '',
            figs: formatBowlerFigures({ wickets: bW, runs: bR, balls: bB }),
            wickets: bW, runs: bR, balls: bB
        };
    }
    if (payload.dismissedPlayers && Array.isArray(payload.dismissedPlayers)) {
        matchState.dismissedPlayers = payload.dismissedPlayers.map(p => {
            if (typeof p === 'string') return { name: p, runs: 0, balls: 0, dismissal: 'OUT', bowler: '-', fielder: '-' };
            return { ...p };
        });
    }

    // [PARTNERSHIP FIX] Sync partnership history from scorer if provided
    if (Array.isArray(payload.partnershipHistory) && payload.partnershipHistory.length > 0) {
        if (payload.partnershipHistory.length >= (matchState.partnershipHistory || []).length) {
            matchState.partnershipHistory = payload.partnershipHistory;
        }
    }

    calculateWinProbability();
    restoreUIFromState();
    renderOverDisplay();
    updateFreeHitBadge();
    updateStrikerUI();
    updateCrrDisplay();
    updateActivePlayerCards();
    renderSquadPreview();
    saveToLocalStorage();
    updateStorageInfo();
    updateLastSync();

    // ✅ FIX: Re-broadcast to Firebase so scorebar gets updated overRunsHistory + winProb
    // This ensures charts on the scorebar update when the scorer records balls
    sendLiveData();
}

function getUpdaterMonitorSnapshot() {
    const d = connectedApps.updater?.device || {};
    return {
        online: connectedApps.updater?.online || false,
        name: connectedApps.updater?.name || '',
        pingMs: connectedApps.updater?.pingMs ?? null,
        batteryLevel: d.battery?.level ?? null,
        charging: d.battery?.charging ?? null,
        lowBattery: d.battery?.low ?? false,
        criticalBattery: d.battery?.critical ?? false,
        networkType: d.network?.label || 'Unknown',
        signalBars: d.network?.signalBars ?? 0,
        signalPct: d.network?.signalPct ?? 0,
        unstable: d.network?.unstable ?? false,
        autoRealtimeEnabled: d.autoRealtimeEnabled ?? true,
        pendingManualPush: d.pendingManualPush ?? false
    };
}
window.getUpdaterMonitorSnapshot = getUpdaterMonitorSnapshot;

// ==========================================
// CONNECTION UI (unchanged)
// ==========================================
function updateSupabaseStatus(status) {
    const dot = document.querySelector('#supabaseBadge .conn-dot');
    const text = document.getElementById('supabaseStatus');
    if (!dot || !text) return;
    dot.className = 'conn-dot';
    if (status === 'connected') { dot.classList.add('good'); text.textContent = 'Firebase: Connected'; }
    else if (status === 'connecting') { dot.classList.add('connecting'); text.textContent = 'Firebase: Connecting...'; }
    else { dot.classList.add('bad'); text.textContent = 'Firebase: Error'; }
}

function updateRealtimeStatus(status) {
    const dot = document.querySelector('#realtimeBadge .conn-dot');
    const text = document.getElementById('realtimeStatus');
    if (!dot || !text) return;
    dot.className = 'conn-dot';
    if (status === 'connected') { dot.classList.add('good'); text.textContent = 'Realtime: Connected'; }
    else if (status === 'connecting') { dot.classList.add('connecting'); text.textContent = 'Realtime: Connecting...'; }
    else { dot.classList.add('bad'); text.textContent = 'Realtime: Error'; }
}

function updateBroadcastLabel(text) {
    const el = document.getElementById('broadcastValue');
    if (el) el.textContent = text;
}

function updateConnectionStatusUI() {
    const updaterOnline = isAppCurrentlyOnline('updater');
    const scorebarOnline = isAppCurrentlyOnline('scorebar');
    const updaterPingEl = document.getElementById('updaterLastPing');
    if (updaterPingEl) {
        if (connectedApps.updater.lastSeen > 0) {
            const ago = Math.floor((Date.now() - connectedApps.updater.lastSeen) / 1000);
            updaterPingEl.textContent = updaterOnline ? (ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`) : 'Offline';
        } else updaterPingEl.textContent = '--';
    }
    const scorebarPingEl = document.getElementById('scorebarLastPing');
    if (scorebarPingEl) {
        if (connectedApps.scorebar.lastSeen > 0) {
            const ago = Math.floor((Date.now() - connectedApps.scorebar.lastSeen) / 1000);
            scorebarPingEl.textContent = scorebarOnline ? (ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`) : 'Offline';
        } else scorebarPingEl.textContent = '--';
    }
    updateAppStatusBadge('updaterBadge', 'updaterStatus', 'Updater', updaterOnline);
    updateAppStatusBadge('scorebarBadge', 'scorebarStatus', 'Scorebar', scorebarOnline);
    const networkEl = document.getElementById('networkStatus');
    if (networkEl) {
        networkEl.innerHTML = navigator.onLine
            ? '<span class="network-indicator good"></span>Online'
            : '<span class="network-indicator bad"></span>Offline';
    }
    updatePingBars();
}

function updateAppStatusBadge(badgeId, textId, label, isOnline) {
    const badge = document.getElementById(badgeId);
    const text = document.getElementById(textId);
    const dot = badge?.querySelector('.conn-dot');
    if (!badge || !text || !dot) return;
    dot.className = 'conn-dot';
    if (isOnline) { dot.classList.add('good'); text.textContent = `${label}: Online`; }
    else { dot.classList.add('offline'); text.textContent = `${label}: Offline`; }
}

function updateMsgCount() { const el = document.getElementById('msgSent'); if (el) el.textContent = msgCount; }
function updateLastSync() { const el = document.getElementById('lastSync'); if (el) el.textContent = new Date().toLocaleTimeString(); }

async function testConnection() {
    try { await loadTeams(true); showToast('Connection test passed'); }
    catch (e) { showToast('Connection test failed', 'error'); }
}

async function reconnect() { await loadTeams(true); showToast('Reconnected'); }

function copyMatchId() {
    navigator.clipboard.writeText(matchId)
        .then(() => showToast('Match ID copied'))
        .catch(() => showToast('Copy failed', 'error'));
}

// ==========================================
// UI INIT (unchanged)
// ==========================================
function initUI() {
    const matchIdDisplay = document.getElementById('matchIdDisplay');
    if (matchIdDisplay) matchIdDisplay.textContent = matchId;
    const autoAllOutToggle = document.getElementById('autoAllOutToggle');
    if (autoAllOutToggle) autoAllOutToggle.checked = autoAllOutEnabled;
    restoreUIFromState();
    renderOverDisplay();
    updateFreeHitBadge();
    updateStrikerUI();
    updateCrrDisplay();
    updateConnectionStatusUI();
    updateActivePlayerCards();
    updateOversPresetUI();
    injectScorebarCurtainControl();
    updateTeamCardsUI();
}

function bindAllInputListeners() {
    // ✅ BUG-010 FIX: Exclude animation range inputs from generic listener
    const inputs = document.querySelectorAll('input:not([type="file"]):not([type="range"]), select, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', checkAutoSend);
        input.addEventListener('input', () => {
            lastLocalEditTime = Date.now();
            debounce(checkAutoSend, 250)();
        });
    });
    document.querySelectorAll('[id^="set"]').forEach(input => {
        if (input.type === 'range') input.addEventListener('input', updateAnimationValueDisplays);
    });
}

function toggleAutoUpdate() {
    autoUpdateEnabled = document.getElementById('autoUpdateToggle')?.checked ?? true;
    document.getElementById('manualUpdateBtn')?.classList.toggle('show', !autoUpdateEnabled);
}

function postStateChange(send = true) {
    restoreUIFromState();
    saveToLocalStorage();
    updateStorageInfo();
    if (send) {
        if (autoUpdateEnabled) sendLiveData();
        else document.getElementById('manualUpdateBtn')?.classList.add('show');
    }
}

function checkAutoSend() { updateMatchState(); postStateChange(true); }

// ==========================================
// TEAMS (unchanged, already XSS fixed)
// ==========================================
function reconcileSelectedTeamsFromIds() {
    if (matchState.team1Id) matchState.team1 = teams.find(t => t.id === matchState.team1Id) || matchState.team1;
    if (matchState.team2Id) matchState.team2 = teams.find(t => t.id === matchState.team2Id) || matchState.team2;
    applySelectedTeamToUI(1);
    applySelectedTeamToUI(2);
    updateTeamsHeader();
    renderSquadPreview();
}

function openTeamSelector(target) {
    teamSelectorTarget = target;
    document.getElementById('teamModalTitle').textContent = `Select Team ${target}`;
    document.getElementById('teamSearch').value = '';
    renderTeamSelectors();
    document.getElementById('teamSelectorModal')?.classList.add('show');
}

function closeTeamSelector() { document.getElementById('teamSelectorModal')?.classList.remove('show'); }

function renderTeamSelectors() {
    const teamList = document.getElementById('teamList');
    if (!teamList) return;
    if (!teams.length) {
        teamList.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No teams found.</p>';
        return;
    }
    teamList.innerHTML = teams.map(team => {
        const logoSrc = team.logo_url || team.logo_base64 || '';
        return `<div class="team-option" onclick="selectTeam('${escapeAttr(team.id)}')">
            <div class="team-option-logo">${logoSrc ? `<img src="${logoSrc}" alt="">` : escapeHtml(team.short_name)}</div>
            <div class="team-option-info">
                <span class="team-option-name">${escapeHtml(team.name)}</span>
                <span class="team-option-meta">${team.players?.length || 0} players • ${escapeHtml(team.short_name)}</span>
            </div>
        </div>`;
    }).join('');
}

function filterTeams() {
    const search = document.getElementById('teamSearch')?.value?.toLowerCase() || '';
    document.querySelectorAll('#teamList .team-option').forEach(opt => {
        opt.style.display = opt.textContent.toLowerCase().includes(search) ? 'flex' : 'none';
    });
}

function selectTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const logoSrc = team.logo_url || team.logo_base64 || '';
    if (teamSelectorTarget === 1) {
        matchState.team1 = team; matchState.team1Id = team.id; matchState.t1Logo = logoSrc;
    } else {
        matchState.team2 = team; matchState.team2Id = team.id; matchState.t2Logo = logoSrc;
    }
    applySelectedTeamToUI(teamSelectorTarget);
    closeTeamSelector();
    updateTeamsHeader();
    renderSquadPreview();
    updateActivePlayerCards();
    postStateChange(true);
}

function applySelectedTeamToUI(slot) {
    const team = slot === 1 ? matchState.team1 : matchState.team2;
    if (!team) return;
    const logoEl = document.getElementById(`team${slot}Logo`);
    const nameEl = document.getElementById(`team${slot}Name`);
    const playersEl = document.getElementById(`team${slot}Players`);
    const batLabelEl = document.getElementById(`batLabel${slot}`);
    const logoSrc = team.logo_url || team.logo_base64 || '';
    if (logoEl) logoEl.innerHTML = logoSrc ? `<img src="${logoSrc}" alt="">` : escapeHtml(team.short_name);
    if (nameEl) nameEl.textContent = team.name;
    if (playersEl) playersEl.textContent = `${team.players?.length || 0} players`;
    if (batLabelEl) batLabelEl.textContent = team.short_name;
}

function setBattingSide(side, shouldSend = true) {
    // [BUG-02 FIX] Save current innings snapshot when switching batting sides
    if (side !== matchState.battingSide && matchState.runs > 0) {
        saveInningsSnapshot();
    }
    matchState.battingSide = side;
    document.getElementById('batBtn1')?.classList.toggle('active', side === 1);
    document.getElementById('batBtn2')?.classList.toggle('active', side === 2);
    const batStatus1 = document.querySelector('#batBtn1 .bat-status');
    const batStatus2 = document.querySelector('#batBtn2 .bat-status');
    if (batStatus1) batStatus1.textContent = side === 1 ? '🏏 Batting' : '⚾ Bowling';
    if (batStatus2) batStatus2.textContent = side === 2 ? '🏏 Batting' : '⚾ Bowling';
    updateTeamsHeader();
    renderSquadPreview();
    updateActivePlayerCards();
    if (shouldSend) postStateChange(true);
}

function updateTeamsHeader() {
    if (matchState.battingSide === 1) {
        matchState.batFlag = matchState.team1?.short_name || 'T1';
        matchState.bowlFlag = matchState.team2?.short_name || 'T2';
    } else {
        matchState.batFlag = matchState.team2?.short_name || 'T2';
        matchState.bowlFlag = matchState.team1?.short_name || 'T1';
    }
}

function renderSquadPreview() {
    const container = document.getElementById('squadTags');
    const countEl = document.getElementById('squadCount');
    const battingTeam = getBattingTeam();
    if (!container || !countEl) return;
    if (!battingTeam?.players?.length) {
        container.innerHTML = '<span style="color:var(--text-secondary)">No squad loaded</span>';
        countEl.textContent = '0 players';
        return;
    }
    container.innerHTML = battingTeam.players.map(p => {
        const badges = getPlayerStatusBadgeHTML(p.name, 'squad');
        return `<span class="squad-tag" onclick="quickSelectBatter('${escapeAttr(p.name)}')">${escapeHtml(p.name)}${badges}</span>`;
    }).join('');
    countEl.textContent = `${battingTeam.players.length} players`;
}

function quickSelectBatter(name) {
    if (isPlayerDismissed(name)) { showToast('This player is already out', 'error'); return; }
    if (!matchState.bat1.name) assignBatter('bat1', name);
    else if (!matchState.bat2.name) assignBatter('bat2', name);
    else { showToast('Both batter slots are already selected', 'error'); return; }
    postStateChange(true);
}

// ==========================================
// PLAYER HELPERS (unchanged)
// ==========================================
function getBattingTeam() { return matchState.battingSide === 1 ? matchState.team1 : matchState.team2; }
function getBowlingTeam() { return matchState.battingSide === 1 ? matchState.team2 : matchState.team1; }

function findPlayerByName(name, preferredTeam = null) {
    if (!name) return null;
    if (preferredTeam && preferredTeam.players && preferredTeam.players.length) {
        const found = preferredTeam.players.find(p => p.name === name);
        if (found) return found;
    }
    for (const team of teams) {
        const found = (team.players || []).find(p => p.name === name);
        if (found) return found;
    }
    return allPlayers.find(p => p.name === name) || null;
}

function getPlayerStatus(name, currentTarget = '') {
    if (!name) return 'none';
    const currentSlotName = currentTarget === 'bat1' ? matchState.bat1.name :
        currentTarget === 'bat2' ? matchState.bat2.name : '';
    if (isPlayerDismissed(name)) return 'out';
    if (name === matchState.bat1.name || name === matchState.bat2.name) {
        if (name === currentSlotName) return 'selected';
        return 'playing';
    }
    return 'normal';
}

function getPlayerStatusBadgeHTML(name, currentTarget = '') {
    const status = getPlayerStatus(name, currentTarget);
    if (status === 'out') return `<span class="player-status-badge out">OUT</span>`;
    if (status === 'playing') return `<span class="player-status-badge playing">PLAYING</span>`;
    if (status === 'selected') return `<span class="player-status-badge selected">SELECTED</span>`;
    return '';
}

function isPlayerDismissed(name) {
    if (!name) return false;
    return matchState.dismissedPlayers.some(p => (typeof p === 'string' ? p : p.name) === name);
}

function markPlayerOut(name, dismissalData = {}) {
    if (!name) return;
    const alreadyOut = matchState.dismissedPlayers.some(p => (typeof p === 'string' ? p : p.name) === name);
    if (!alreadyOut) {
        const batSlot = matchState.bat1.name === name ? 'bat1' : matchState.bat2.name === name ? 'bat2' : null;
        const batterStats = batSlot ? { ...matchState[batSlot] } : {};
        matchState.dismissedPlayers.push({
            name, runs: batterStats.runs || 0,
            balls: batterStats.balls || 0, // ✅ BUG-005 FIX: Removed incorrect +1
            fours: batterStats.fours || 0, sixes: batterStats.sixes || 0,
            dismissal: dismissalData.type || 'OUT',
            bowler: dismissalData.bowler || matchState.bowler.name || '-',
            fielder: dismissalData.fielder || '-', timestamp: Date.now()
        });
    }
}

function assignBatter(slotKey, name) {
    if (!name) return;
    const current = matchState[slotKey];
    const samePlayer = current.name === name;
    matchState[slotKey] = {
        name, runs: samePlayer ? current.runs : 0, balls: samePlayer ? current.balls : 0,
        fours: samePlayer ? current.fours : 0, sixes: samePlayer ? current.sixes : 0, isOut: false
    };
    if (slotKey === 'bat1') document.getElementById('b1Name').value = name;
    else document.getElementById('b2Name').value = name;
}

function assignBowler(name) {
    if (!name) return;
    matchState.bowler.name = name;
    matchState.bowler.runs = 0; matchState.bowler.wickets = 0;
    matchState.bowler.balls = 0; matchState.bowler.figs = '0-0 0.0';
    document.getElementById('bowlName').value = name;
    document.getElementById('bowlFigs').value = matchState.bowler.figs;
}

// ==========================================
// PLAYER PICKER (unchanged)
// ==========================================
function openPlayerPicker(target) {
    playerPickerTarget = target;
    document.getElementById('playerPickerTitle').textContent = getPickerTitle(target);
    document.getElementById('playerPickerSearch').value = '';
    renderPlayerPickerList();
    document.getElementById('playerPickerModal')?.classList.add('show');
}

function closePlayerPicker() { document.getElementById('playerPickerModal')?.classList.remove('show'); }

function getPickerTitle(target) {
    if (target === 'bat1') return 'Select Batter 1';
    if (target === 'bat2') return 'Select Batter 2';
    if (target === 'bowler') return 'Select Bowler';
    return 'Select Player';
}

function getSourcePlayersForPicker() {
    if (playerPickerTarget === 'bowler') return getBowlingTeam()?.players || [];
    return getBattingTeam()?.players || [];
}

function renderPlayerPickerList() {
    const list = document.getElementById('playerPickerList');
    if (!list) return;
    const players = getSourcePlayersForPicker();
    const search = (document.getElementById('playerPickerSearch')?.value || '').toLowerCase();
    const filtered = players.filter(p =>
        (p.name || '').toLowerCase().includes(search) || (p.role || '').toLowerCase().includes(search));
    if (!filtered.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No players loaded.</p>';
        return;
    }
    list.innerHTML = filtered.map(p => {
        const status = playerPickerTarget === 'bowler' ? 'normal' : getPlayerStatus(p.name, playerPickerTarget);
        const disabled = status === 'playing' || status === 'out';
        const extraClass = status === 'playing' ? 'is-playing' : status === 'out' ? 'is-out' : '';
        const badge = playerPickerTarget === 'bowler'
            ? (matchState.bowler.name === p.name ? `<span class="player-status-badge selected">CURRENT</span>` : '')
            : getPlayerStatusBadgeHTML(p.name, playerPickerTarget);
        const photoSrc = p.photo_url || p.photo_base64 || '';
        return `<div class="player-option ${disabled ? 'disabled' : ''} ${extraClass}" onclick="${disabled ? '' : `selectPickerPlayer('${escapeAttr(p.name)}')`}">
            <div class="player-option-photo">${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}</div>
            <div class="player-option-info">
                <span class="player-option-name">${escapeHtml(p.name)} ${badge}</span>
                <span class="player-option-meta">${escapeHtml(p.role || 'Player')}${p.jersey_number ? ' • #' + p.jersey_number : ''}</span>
            </div>
        </div>`;
    }).join('');
}

function filterPlayerPicker() { renderPlayerPickerList(); }

function selectPickerPlayer(name) {
    if (playerPickerTarget === 'bat1') {
        if (name === matchState.bat2.name) return showToast('Already playing as Batter 2', 'error');
        if (isPlayerDismissed(name) && name !== matchState.bat1.name) return showToast('This player is already out', 'error');
        assignBatter('bat1', name);
    } else if (playerPickerTarget === 'bat2') {
        if (name === matchState.bat1.name) return showToast('Already playing as Batter 1', 'error');
        if (isPlayerDismissed(name) && name !== matchState.bat2.name) return showToast('This player is already out', 'error');
        assignBatter('bat2', name);
    } else if (playerPickerTarget === 'bowler') {
        assignBowler(name);
    }
    closePlayerPicker();
    postStateChange(true);
}

// ==========================================
// WICKET POPUP + CUSTOM POPUPS (unchanged)
// ==========================================
function openWicketPopup() {
    if (!validateActivePlayers()) return;
    if (isWicketFlowActive) { showToast('Wicket already in progress', 'error'); return; }
    document.getElementById('wicketPopup')?.classList.add('show');
}
function closeWicketPopup() { document.getElementById('wicketPopup')?.classList.remove('show'); }

let pendingWicketType = null;
let pendingWicketResolve = null;
let pendingFielderResolve = null;

function showFielderInputPopup(title, description) {
    return new Promise((resolve) => {
        pendingFielderResolve = resolve;
        const popup = document.getElementById('fielderInputPopup');
        const titleEl = document.getElementById('fielderPopupTitle');
        const descEl = document.getElementById('fielderPopupDesc');
        const input = document.getElementById('fielderNameInput');
        const quickPicks = document.getElementById('fielderQuickPicks');
        if (titleEl) titleEl.textContent = title || 'FIELDER NAME';
        if (descEl) descEl.textContent = description || 'Who took the catch?';
        if (input) { input.value = ''; input.classList.remove('shake'); }
        if (quickPicks) {
            const bowlingPlayers = getBowlingTeam()?.players || [];
            if (bowlingPlayers.length > 0) {
                quickPicks.innerHTML = bowlingPlayers.slice(0, 8).map(p =>
                    `<button class="fielder-quick-btn" onclick="quickSelectFielder('${escapeAttr(p.name)}')">${escapeHtml(p.name)}</button>`
                ).join('');
                quickPicks.style.display = 'flex';
            } else { quickPicks.innerHTML = ''; quickPicks.style.display = 'none'; }
        }
        popup?.classList.add('show');
        setTimeout(() => input?.focus(), 100);
    });
}

function quickSelectFielder(name) {
    const input = document.getElementById('fielderNameInput');
    if (input) input.value = name;
    confirmFielderInput();
}

function confirmFielderInput() {
    const input = document.getElementById('fielderNameInput');
    const value = (input?.value || '').trim();
    if (!value) { input?.classList.add('shake'); setTimeout(() => input?.classList.remove('shake'), 400); return; }
    closeFielderInputPopup();
    if (pendingFielderResolve) { pendingFielderResolve(value); pendingFielderResolve = null; }
}

function cancelFielderInput() {
    closeFielderInputPopup();
    if (pendingFielderResolve) { pendingFielderResolve('-'); pendingFielderResolve = null; }
}

function closeFielderInputPopup() { document.getElementById('fielderInputPopup')?.classList.remove('show'); }

function showRunOutSelectPopup() {
    return new Promise((resolve) => {
        pendingWicketResolve = resolve;
        const popup = document.getElementById('runOutSelectPopup');
        const strikerName = document.getElementById('runoutStrikerName');
        const nonStrikerName = document.getElementById('runoutNonStrikerName');
        const striker = matchState.striker === '1' ? matchState.bat1 : matchState.bat2;
        const nonStriker = matchState.striker === '1' ? matchState.bat2 : matchState.bat1;
        if (strikerName) strikerName.textContent = striker.name || '--';
        if (nonStrikerName) nonStrikerName.textContent = nonStriker.name || '--';
        popup?.classList.add('show');
    });
}

function selectRunOutBatter(which) {
    closeRunOutSelectPopup();
    if (pendingWicketResolve) { pendingWicketResolve(which); pendingWicketResolve = null; }
}

function cancelRunOutSelect() {
    closeRunOutSelectPopup();
    if (pendingWicketResolve) { pendingWicketResolve(null); pendingWicketResolve = null; }
}

function closeRunOutSelectPopup() { document.getElementById('runOutSelectPopup')?.classList.remove('show'); }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fielderInputPopup')?.addEventListener('click', (e) => {
        if (e.target.id === 'fielderInputPopup') cancelFielderInput();
    });
    document.getElementById('runOutSelectPopup')?.addEventListener('click', (e) => {
        if (e.target.id === 'runOutSelectPopup') cancelRunOutSelect();
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const fielderPopup = document.getElementById('fielderInputPopup');
        if (fielderPopup?.classList.contains('show')) confirmFielderInput();
    }
});

// ==========================================
// WICKET FLOW (unchanged logic, already good)
// ==========================================
async function selectWicketType(type) {
    if (isWicketFlowActive) return;
    isWicketFlowActive = true;

    closeWicketPopup();
    if (!type) { isWicketFlowActive = false; return; }

    // ✅ BUG-014 FIX: Capture autoAllOutEnabled once at the start of the wicket flow
    const capturedAutoAllOut = autoAllOutEnabled;

    const capturedStriker = matchState.striker;
    let outSlot;
    let fielder = '-';

    try {
        if (type === 'Run Out') {
            const runOutChoice = await showRunOutSelectPopup();
            if (!runOutChoice) { isWicketFlowActive = false; return; }
            outSlot = runOutChoice === 'nonstriker'
                ? (capturedStriker === '1' ? 'bat2' : 'bat1')
                : (capturedStriker === '1' ? 'bat1' : 'bat2');
            fielder = await showFielderInputPopup('RUN OUT BY', 'Who did the run out?');
            matchState._lastFielder = fielder;
            matchState._lastBowlerForDismissal = matchState.bowler.name || '';
            matchState._wicketOutSlot = outSlot;
            matchState._wicketWasStriker = (capturedStriker === '1' && outSlot === 'bat1') ||
                (capturedStriker === '2' && outSlot === 'bat2');
        } else if (type === 'Caught') {
            outSlot = capturedStriker === '1' ? 'bat1' : 'bat2';
            fielder = await showFielderInputPopup('CAUGHT BY', 'Who took the catch?');
            matchState._lastFielder = fielder;
        } else if (type === 'Stumped') {
            outSlot = capturedStriker === '1' ? 'bat1' : 'bat2';
            fielder = await showFielderInputPopup('STUMPED BY', 'Who stumped the batter?');
            matchState._lastFielder = fielder;
        } else {
            outSlot = capturedStriker === '1' ? 'bat1' : 'bat2';
            matchState._lastFielder = '-';
        }

        pendingWicketSlot = outSlot;
        matchState.lastWicketType = type;

        const outName = matchState[outSlot]?.name;
        if (!outName) {
            showToast('No batsman at this position!', 'error');
            pendingWicketSlot = null;
            isWicketFlowActive = false;
            return;
        }

        updateMatchState();
        saveHistory();

        matchState[outSlot].isOut = true;

        const batterStats = { ...matchState[outSlot] };
        const dismissalRecord = {
            name: outName,
            runs: batterStats.runs || 0,
            balls: batterStats.balls || 0, // ✅ BUG-006 FIX: Removed incorrect +1
            fours: batterStats.fours || 0,
            sixes: batterStats.sixes || 0,
            dismissal: type,
            bowler: (type === 'Run Out') ? (matchState._lastBowlerForDismissal || matchState.bowler.name || '-')
                : (matchState.bowler.name || '-'),
            fielder: fielder || '-',
            timestamp: Date.now()
        };

        const alreadyOut = matchState.dismissedPlayers.some(p =>
            (typeof p === 'string' ? p : p.name) === outName
        );
        if (!alreadyOut) {
            matchState.dismissedPlayers.push(dismissalRecord);
        }

        matchState.wkts = Math.min((matchState.wkts || 0) + 1, 10);

        if (type !== 'Run Out') {
            matchState.bowler.wickets = (matchState.bowler.wickets || 0) + 1;
            matchState.bowler.runs = matchState.bowler.runs || 0;
            matchState.bowler.balls = matchState.bowler.balls || 0;
            matchState.bowler.figs = formatBowlerFigures({
                wickets: matchState.bowler.wickets,
                runs: matchState.bowler.runs,
                balls: matchState.bowler.balls
            });
        }

        addBallAfterWicket();

        // [BUG-04 FIX] Save partnership to history before reset
        if (matchState.partRuns > 0 || matchState.partBalls > 0) {
            const wicketStriker = matchState.striker === '1' ? matchState.bat1 : matchState.bat2;
            const wicketNonStriker = matchState.striker === '1' ? matchState.bat2 : matchState.bat1;
            if (!Array.isArray(matchState.partnershipHistory)) matchState.partnershipHistory = [];
            matchState.partnershipHistory.push({
                bat1: wicketStriker.name || '',
                bat2: wicketNonStriker.name || '',
                runs: matchState.partRuns || 0,
                balls: matchState.partBalls || 0,
                bat1Runs: wicketStriker.runs || 0,
                bat2Runs: wicketNonStriker.runs || 0,
                teamScoreAtEnd: matchState._currentTeamScore || matchState.runs,
            });
        }
        // [BUG-07 FIX] Save team score at dismissal into the last dismissal record
        if (matchState.dismissedPlayers.length > 0) {
            const lastD = matchState.dismissedPlayers[matchState.dismissedPlayers.length - 1];
            if (lastD && typeof lastD === 'object' && !lastD.teamScore) {
                lastD.teamScore = matchState._currentTeamScore || matchState.runs;
            }
        }

        resetPartnership(false);

        broadcastAllOutCardAfterWicket(capturedAutoAllOut);

        const legalBalls = currentOver.filter(b => !/wd|nb/i.test(String(b))).length;
        pendingBowlerAfterWicket = legalBalls >= 6;

        restoreUIFromState();
        updateActivePlayerCards();
        saveToLocalStorage();

        if (matchState.wkts >= 10 || getSelectableNextBatsmen().length === 0) {
            pendingWicketSlot = null;
            selectedNextBatsman = null;
            pendingBowlerAfterWicket = false;

            // ✅ BUG-012 FIX: Clear dismissed batter slot immediately for data consistency
            matchState[outSlot] = {
                name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false
            };
            const inputEl = document.getElementById(outSlot === 'bat1' ? 'b1Name' : 'b2Name');
            if (inputEl) inputEl.value = '';

            const strikerSlot = matchState.striker === '1' ? 'bat1' : 'bat2';
            if (outSlot === strikerSlot) {
                matchState.striker = outSlot === 'bat1' ? '2' : '1';
            }

            postStateChange(true);

            showToast('All Out! Innings Over', 'error');

            if (matchState.target > 0 && matchState.runs < matchState.target) {
                setTimeout(() => showWinnerCard(), 4000);
            } else if (matchState.target <= 0) {
                setTimeout(() => presetInningsOverCard(), 4000);
            }

            isWicketFlowActive = false;
            return;
        }

        setTimeout(() => {
            openNextBatsmanPopup();
        }, parseInt(animSettings.wicketDuration, 10) || 3000);

    } catch (err) {
        console.error('Wicket flow error:', err);
        showToast('Wicket flow error', 'error');
        isWicketFlowActive = false;
    }
}

function addBallAfterWicket() {
    currentOver.push('W');
    matchState.thisOver = currentOver.join(' ');

    matchState.bowler.balls = (matchState.bowler.balls || 0) + 1;

    matchState.bowler.figs = formatBowlerFigures({
        wickets: matchState.bowler.wickets || 0,
        runs: matchState.bowler.runs || 0,
        balls: matchState.bowler.balls
    });

    incrementOvers();

    const balls = oversToBalls(matchState.overs);
    // [Fix #1 & #2] Use ballsToExactOvers for CRR rate calc, already guarded by balls > 0
    matchState.crr = balls > 0 ? (matchState.runs / ballsToExactOvers(balls)).toFixed(2) : '0.00';

    renderOverDisplay();
    updateFreeHitBadge();
    updateStrikerUI();
    updateCrrDisplay();

    postStateChange(true);

    const outSlot = pendingWicketSlot || (matchState.striker === '1' ? 'bat1' : 'bat2');
    const outBatterName = matchState[outSlot]?.name || '';

    sendCommand('trigger_hype', {
        type: 'WICKET',
        outSlot: outSlot,
        outBatterName: outBatterName,
        dismissalType: matchState.lastWicketType || 'OUT',
        fielder: matchState._lastFielder || '-',
        bowler: matchState.lastWicketType !== 'Run Out'
            ? (matchState.bowler.name || '-')
            : (matchState._lastBowlerForDismissal || matchState.bowler.name || '-')
    });

    msgCount++;
    updateMsgCount();
    updateLastSync();
}

// ==========================================
// NEXT BATSMAN POPUP (unchanged)
// ==========================================
function openNextBatsmanPopup() {
    selectedNextBatsman = null;
    document.getElementById('nextBatsmanSearch').value = '';
    renderNextBatsmanList();
    document.getElementById('nextBatsmanPopup')?.classList.add('show');
}

function closeNextBatsmanPopup() { document.getElementById('nextBatsmanPopup')?.classList.remove('show'); }
function filterNextBatsmanList() { renderNextBatsmanList(); }

function renderNextBatsmanList() {
    const list = document.getElementById('nextBatsmanList');
    if (!list) return;
    const battingPlayers = getBattingTeam()?.players || [];
    const search = (document.getElementById('nextBatsmanSearch')?.value || '').toLowerCase();
    const otherPlayingName = pendingWicketSlot === 'bat1' ? matchState.bat2.name : matchState.bat1.name;
    const filtered = battingPlayers.filter(p => (p.name || '').toLowerCase().includes(search));
    if (!filtered.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No available players.</p>';
        return;
    }
    list.innerHTML = filtered.map(p => {
        const isOut = isPlayerDismissed(p.name);
        const isPlaying = p.name === otherPlayingName;
        const disabled = isOut || isPlaying;
        let badge = '';
        if (isOut) badge = `<span class="player-status-badge out">OUT</span>`;
        else if (isPlaying) badge = `<span class="player-status-badge playing">PLAYING</span>`;
        else if (selectedNextBatsman === p.name) badge = `<span class="player-status-badge selected">SELECTED</span>`;
        const photoSrc = p.photo_url || p.photo_base64 || '';
        return `<div class="player-option ${disabled ? 'disabled is-out' : ''} ${selectedNextBatsman === p.name ? 'selected' : ''}" onclick="${disabled ? '' : `selectNextBatsman('${escapeAttr(p.name)}')`}">
            <div class="player-option-photo">${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}</div>
            <div class="player-option-info">
                <span class="player-option-name">${escapeHtml(p.name)} ${badge}</span>
                <span class="player-option-meta">${escapeHtml(p.role || 'Player')}</span>
            </div>
        </div>`;
    }).join('');
}

function selectNextBatsman(name) { selectedNextBatsman = name; renderNextBatsmanList(); }

function confirmNextBatsman() {
    if (!selectedNextBatsman || !pendingWicketSlot) {
        showToast('Please select next batsman', 'error');
        return;
    }
    const newBatterName = selectedNextBatsman;

    assignBatter(pendingWicketSlot, newBatterName);

    if (matchState._wicketWasStriker !== undefined) {
        if (matchState._wicketWasStriker) {
            matchState.striker = (pendingWicketSlot === 'bat1') ? '1' : '2';
        }
        delete matchState._wicketOutSlot;
        delete matchState._wicketWasStriker;
    }

    closeNextBatsmanPopup();
    pendingWicketSlot = null;
    selectedNextBatsman = null;
    isWicketFlowActive = false;

    restoreUIFromState();
    updateActivePlayerCards();
    saveToLocalStorage();

    const tempPlayer = findPlayerByName(newBatterName, getBattingTeam());
    sendCommand('show_profile', {
        name: newBatterName,
        photo: tempPlayer ? (tempPlayer.photo_url || tempPlayer.photo_base64 || '') : '',
        role: tempPlayer ? (tempPlayer.role || 'BATSMAN') : 'BATSMAN',
        school: tempPlayer ? (tempPlayer.school || '') : '',
        age: tempPlayer ? (tempPlayer.age || '') : ''
    });
    sendLiveData();

    if (pendingBowlerAfterWicket) {
        pendingBowlerAfterWicket = false;
        const profileDelay = (parseInt(animSettings.profileDuration, 10) || 5000) + 500;
        setTimeout(() => openBowlerPopup(), profileDelay);
    }
    showToast(`${newBatterName} - Profile shown on scorebar`);
}

// ==========================================
// BOWLER POPUP (unchanged)
// ==========================================
function openBowlerPopup() {
    selectedNextBowler = null;
    renderBowlerList();
    document.getElementById('bowlerPopup')?.classList.add('show');
}

function closeBowlerPopup() { document.getElementById('bowlerPopup')?.classList.remove('show'); }

function renderBowlerList() {
    const list = document.getElementById('bowlerSelectList');
    if (!list) return;
    const bowlingPlayers = getBowlingTeam()?.players || [];
    if (!bowlingPlayers.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No bowling team players loaded</p>';
        return;
    }
    list.innerHTML = bowlingPlayers.map(p => `
        <div class="bowler-option ${selectedNextBowler === p.name ? 'selected' : ''}" onclick="selectNextBowler(this, '${escapeAttr(p.name)}')">
            <div class="bowler-option-icon">🎯</div>
            <div class="bowler-option-info">
                <span class="bowler-option-name">${escapeHtml(p.name)} ${matchState.bowler.name === p.name ? '<span class="player-status-badge selected">CURRENT</span>' : ''}</span>
                <span class="bowler-option-meta">${escapeHtml(p.role || 'Player')}</span>
            </div>
        </div>`).join('');
}

function selectNextBowler(el, name) {
    document.querySelectorAll('.bowler-option').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    selectedNextBowler = name;
}

function confirmNextBowler() {
    if (!selectedNextBowler) { showToast('Please select a bowler', 'error'); return; }

    if (matchState.bowler.name) {
        if (!matchState.bowlingHistory) matchState.bowlingHistory = [];

        const figs = parseBowlerFigures(matchState.bowler.figs);
        const bowlerRecord = {
            name: matchState.bowler.name,
            wickets: figs.wickets,
            runs: figs.runs,
            balls: figs.balls,
            overs: ballsToOversString(figs.balls)
        };

        const existing = matchState.bowlingHistory.findIndex(b => b.name === matchState.bowler.name);
        if (existing >= 0) {
            matchState.bowlingHistory[existing] = bowlerRecord;
        } else {
            matchState.bowlingHistory.push(bowlerRecord);
        }
    }

    const prevRecord = (matchState.bowlingHistory || []).find(b => b.name === selectedNextBowler);
    if (prevRecord) {
        matchState.bowler = {
            name: selectedNextBowler,
            wickets: prevRecord.wickets,
            runs: prevRecord.runs,
            balls: prevRecord.balls,
            figs: formatBowlerFigures(prevRecord)
        };
        document.getElementById('bowlName').value = selectedNextBowler;
        document.getElementById('bowlFigs').value = matchState.bowler.figs;
    } else {
        assignBowler(selectedNextBowler);
    }

    closeBowlerPopup();
    endOver();
    showToast(`Next bowler: ${selectedNextBowler}`);
}

function endOver() { swapStriker(false); clearOver(false); postStateChange(true); }

// ==========================================
// BALL BY BALL + HISTORY (unchanged)
// ==========================================
function saveHistory() {
    const snapshot = {
        matchState: {
            ...matchState,
            team1: matchState.team1 ? { id: matchState.team1.id, short_name: matchState.team1.short_name } : null,
            team2: matchState.team2 ? { id: matchState.team2.id, short_name: matchState.team2.short_name } : null,
        },
        currentOver: [...currentOver]
    };
    historyStack.push(JSON.parse(JSON.stringify(snapshot)));
    if (historyStack.length > 30) historyStack.shift();
}

function applySnapshot(snapshot) {
    if (!snapshot) return;
    const restored = JSON.parse(JSON.stringify(snapshot.matchState));
    if (restored.team1Id) restored.team1 = teams.find(t => t.id === restored.team1Id) || restored.team1;
    if (restored.team2Id) restored.team2 = teams.find(t => t.id === restored.team2Id) || restored.team2;
    matchState = restored;
    currentOver = JSON.parse(JSON.stringify(snapshot.currentOver || []));
}

function addCustomBall() {
    const input = document.getElementById('customBall');
    if (!input || !input.value.trim()) return;
    addBall(input.value.trim());
    input.value = '';
}

// ==========================================
// BALL BY BALL - addBall() (FIXED: removed 'W' from validBalls)
// ==========================================
function addBall(value, options = {}) {
    if (!validateActivePlayers()) return;

    if (isWicketFlowActive) {
        showToast('Wicket in progress...', 'error');
        return;
    }

    const v = String(value).toUpperCase().trim();

    // ✅ FIXED: Removed 'W' from validBalls to prevent double-counting wickets
    const validBalls = ['0', '.', '•', '1', '2', '3', '4', '5', '6'];
    const isExtra = /^(WD\d*|NB\d*|LB\d*|B\d+)$/i.test(v);
    if (!validBalls.includes(v) && !isExtra) {
        showToast(`Invalid ball value: ${v}`, 'error');
        return;
    }

    if (matchState.target > 0 && matchState.runs >= matchState.target && v !== 'UNDO') {
        showToast('Match is already won!', 'error');
        return;
    }

    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;

    if (ballsBowled >= maxBalls && v !== 'UNDO') {
        if (!/WD|NB/i.test(v)) {
            showToast('Overs completed! Innings is over.', 'error');
            return;
        }
    }

    if (matchState.wkts >= 10 && v !== 'UNDO') {
        showToast('Innings is over! All Out.', 'error');
        return;
    }

    updateMatchState();
    if (!options.skipHistory) saveHistory();

    currentOver.push(value);
    matchState.thisOver = currentOver.join(' ');

    processBallScore(value);
    matchState._currentTeamScore = matchState.runs; // [BUG-07 FIX] Track for accurate Fall of Wickets

    restoreUIFromState();
    renderOverDisplay();
    updateFreeHitBadge();
    updateCrrDisplay();
    updateActivePlayerCards();

    if (v === '4') triggerHype('FOUR');
    if (v === '6') triggerHype('SIX');

    const legalBalls = currentOver.filter(b => !/wd|nb/i.test(String(b))).length;
    const newBallsBowled = oversToBalls(matchState.overs);

    // [Fix #5] When an over is completed (6 legal balls), save per-over data to history
    if (legalBalls === 6) {
        const overRuns = currentOver.reduce((sum, ball) => {
            const b = String(ball).toUpperCase();
            if (b.includes('WD')) return sum + (1 + (parseInt(b.replace(/WD/ig, ''), 10) || 0));
            if (b.includes('NB')) return sum + (1 + (parseInt(b.replace(/NB/ig, ''), 10) || 0));
            if (b === 'W' || b.startsWith('W')) return sum; // wicket adds 0 runs by itself
            return sum + (parseInt(b) || 0);
        }, 0);
        const overHasWicket = currentOver.some(b => {
            const bv = String(b).toUpperCase();
            return bv === 'W' || bv.startsWith('W');
        });
        if (!Array.isArray(matchState.overRunsHistory)) matchState.overRunsHistory = [];
        matchState.overRunsHistory.push({ runs: overRuns, isWicket: overHasWicket });
    }

    let matchEnded = false;
    if (matchState.target > 0 && matchState.runs >= matchState.target) {
        matchEnded = true;
        checkMatchEndAndShowWinner();
    }

    if (newBallsBowled >= maxBalls) {
        if (matchState.target > 0 && matchState.runs < matchState.target) {
            matchEnded = true;
            checkMatchEndAndShowWinner();
        } else if (matchState.target <= 0) {
            setTimeout(() => presetInningsOverCard(), 2500);
        }
    }

    // ✅ FIXED: Don't send live data if match ended to avoid duplicate winner commands
    if (!matchEnded) {
        if (autoUpdateEnabled) {
            sendLiveData();
        } else {
            document.getElementById('manualUpdateBtn')?.classList.add('show');
        }
    }

    if (legalBalls >= 6 && !options.deferOverPopup && v !== 'W') {
        setTimeout(() => openBowlerPopup(), 500);
    }

    saveToLocalStorage();
    updateStorageInfo();
}

function processBallScore(value) {
    const v = String(value).toUpperCase();
    let totalRuns = 0, batterRuns = 0, strikeSwapRuns = 0;
    let isLegal = true, isWicket = false;

    let figures = parseBowlerFigures(matchState.bowler.figs);

    if (v === '0' || v === '.' || v === '•') {
        totalRuns = 0; batterRuns = 0; strikeSwapRuns = 0;
    } else if (/^[1-6]$/.test(v)) {
        totalRuns = parseInt(v, 10); batterRuns = totalRuns; strikeSwapRuns = batterRuns;
    } else if (v === 'W') {
        // ✅ BUG-004 FIX: This path should never execute since 'W' was removed from addBall.
        // Throw an explicit error to catch any future regressions.
        console.error('BUG: processBallScore received "W" - this should never happen. Use selectWicketType instead.');
        return;
    } else if (v.includes('WD')) {
        const extra = parseInt(v.replace(/WD/ig, ''), 10) || 0;
        totalRuns = 1 + extra; batterRuns = 0; strikeSwapRuns = 0; isLegal = false;
    } else if (v.includes('NB')) {
        const extraBatRuns = parseInt(v.replace(/NB/ig, ''), 10) || 0;
        totalRuns = 1 + extraBatRuns; batterRuns = extraBatRuns;
        strikeSwapRuns = extraBatRuns; isLegal = false;
        matchState.isFreeHit = true;
    } else if (v.includes('LB')) {
        const lbRuns = parseInt(v.replace(/LB/ig, ''), 10) || 0;
        totalRuns = lbRuns; batterRuns = 0; strikeSwapRuns = lbRuns;
    } else if (/^B\d+$/i.test(v)) {
        const byeRuns = parseInt(v.replace(/B/ig, ''), 10) || 0;
        totalRuns = byeRuns; batterRuns = 0; strikeSwapRuns = byeRuns;
    }

    matchState.runs += totalRuns;

    const strikerKey = matchState.striker === '1' ? 'bat1' : 'bat2';
    const striker = matchState[strikerKey];

    if (isLegal) {
        striker.balls += 1;
    }

    if (!isWicket) {
        striker.runs += batterRuns;
        if (batterRuns === 4) striker.fours += 1;
        if (batterRuns === 6) striker.sixes += 1;
    }

    matchState.partRuns += totalRuns;
    matchState.partBalls += 1;

    figures.runs += totalRuns;
    if (isLegal) figures.balls += 1;

    matchState.bowler.wickets = figures.wickets;
    matchState.bowler.runs = figures.runs;
    matchState.bowler.balls = figures.balls;
    matchState.bowler.figs = formatBowlerFigures(figures);

    if (isLegal) {
        incrementOvers();
        if (matchState.isFreeHit && !v.includes('NB')) matchState.isFreeHit = false;
    }

    if (!isWicket && strikeSwapRuns % 2 === 1) {
        matchState.striker = matchState.striker === '1' ? '2' : '1';
    }
}

function incrementOvers() {
    const balls = oversToBalls(matchState.overs) + 1;
    matchState.overs = ballsToOversString(balls);
}

function undoBall() {
    if (!historyStack.length) { showToast('Nothing to undo', 'error'); return; }
    const snapshot = historyStack.pop();
    applySnapshot(snapshot);
    matchState.isSpecial = false; matchState.specialText = '';
    const specialToggle = document.getElementById('specialToggle');
    if (specialToggle) specialToggle.checked = false;
    sendCommand('hide_graphics');
    // ✅ FIXED: Reset wicket flow locks
    isWicketFlowActive = false;
    pendingWicketSlot = null;
    selectedNextBatsman = null;
    pendingBowlerAfterWicket = false;
    postStateChange(true);
    showToast('Last ball undone');
}

function clearOver(send = true) {
    currentOver = []; matchState.thisOver = '';
    restoreUIFromState();
    if (send) postStateChange(true);
}

function renderOverDisplay() {
    const container = document.getElementById('overDisplay');
    if (!container) return;
    container.innerHTML = '';
    const balls = currentOver.slice();
    const legalCount = balls.filter(b => !/wd|nb/i.test(String(b))).length;
    balls.forEach((ball, idx) => {
        const div = document.createElement('div');
        div.className = 'ball-slot';
        const v = String(ball).toUpperCase();
        div.textContent = (v === '0' || v === '.') ? '•' : v;
        if (v === '0' || v === '.') div.classList.add('dot');
        else if (v === '4' || v === '6') div.classList.add('boundary');
        else if (v === 'W') div.classList.add('wicket');
        else if (/WD|NB/i.test(v)) div.classList.add('extra');
        if (idx === balls.length - 1) div.classList.add('last');
        container.appendChild(div);
    });
    for (let i = legalCount; i < 6; i++) {
        const empty = document.createElement('div');
        empty.className = 'ball-slot empty';
        container.appendChild(empty);
    }
}

function updateFreeHitBadge() {
    document.getElementById('freeHitBadge')?.classList.toggle('show', matchState.isFreeHit);
}

// ✅ BUG-009 FIX: Separated getter from setter
function isAutoAllOutEnabled() {
    return autoAllOutEnabled;
}

function syncAutoAllOutEnabled() {
    const toggle = document.getElementById('autoAllOutToggle');
    if (toggle) autoAllOutEnabled = toggle.checked;
    return autoAllOutEnabled;
}

function getSelectableNextBatsmen() {
    const battingPlayers = getBattingTeam()?.players || [];
    const outSlot = pendingWicketSlot || (matchState.striker === '1' ? 'bat1' : 'bat2');
    const otherPlayingName = outSlot === 'bat1' ? matchState.bat2.name : matchState.bat1.name;
    return battingPlayers.filter(p => {
        const name = p.name || '';
        if (!name) return false;
        if (isPlayerDismissed(name)) return false;
        if (name === otherPlayingName) return false;
        return true;
    });
}

function buildAllOutCardPayload(capturedAutoAllOut) {
    return {
        showAllOutCard: true, autoAllOutEnabled: capturedAutoAllOut ?? isAutoAllOutEnabled(),
        allOutData: {
            teamName: matchState.batFlag || 'TEAM',
            score: `${matchState.runs}/${matchState.wkts}`,
            overs: matchState.overs || '0.0'
        }
    };
}

function broadcastAllOutCardAfterWicket(capturedAutoAllOut) {
    if (!(capturedAutoAllOut ?? autoAllOutEnabled) || matchState.wkts < 10) return;
    const delay = (parseInt(animSettings.wicketDuration, 10) || 3000) + (parseInt(animSettings.queueGap, 10) || 500);
    setTimeout(() => sendLiveData(buildAllOutCardPayload(capturedAutoAllOut)), delay);
}

// ==========================================
// STRIKER (unchanged)
// ==========================================
function setStriker(num, shouldSend = true) {
    matchState.striker = String(num);
    updateStrikerUI(); updateActivePlayerCards();
    if (shouldSend) postStateChange(true);
}

function updateStrikerUI() {
    document.getElementById('strikerBtn1')?.classList.toggle('active', matchState.striker === '1');
    document.getElementById('strikerBtn2')?.classList.toggle('active', matchState.striker === '2');
    document.getElementById('striker1Badge')?.classList.toggle('hidden', matchState.striker !== '1');
    document.getElementById('striker2Badge')?.classList.toggle('hidden', matchState.striker !== '2');
}

function swapStriker(shouldSend = true) {
    matchState.striker = matchState.striker === '1' ? '2' : '1';
    updateStrikerUI(); updateActivePlayerCards();
    if (shouldSend) postStateChange(true);
}

// ==========================================
// MATCH STATE UI SYNC (unchanged)
// ==========================================
function updateMatchState() {
    // ✅ BUG-017 FIX: Skip locked sections
    if (!locks.score) {
        matchState.runs = parseInt(document.getElementById('runs')?.value, 10) || matchState.runs;
        let currentWkts = parseInt(document.getElementById('wkts')?.value, 10) || matchState.wkts;
        matchState.wkts = Math.min(currentWkts, 10);

        matchState.overs = sanitizeOversInput(document.getElementById('overs')?.value || matchState.overs);
        matchState.target = parseInt(document.getElementById('target')?.value || matchState.target, 10) || 0;
    }

    const presetMap = { t10: 10, t20: 20, odi: 50 };
    if (matchState.matchType === 'limited') {
        if (matchState.oversPreset === 'custom') {
            matchState.totOvers = parseInt(document.getElementById('customTotalOvers')?.value, 10) || 20;
        } else {
            matchState.totOvers = presetMap[matchState.oversPreset] || 20;
        }
    } else {
        matchState.totOvers = parseInt(document.getElementById('totOvers')?.value, 10) || matchState.totOvers;
    }

    matchState.status = document.getElementById('statusText')?.value || matchState.status;

    if (!locks.batsmen) {
        matchState.bat1 = {
            ...matchState.bat1,
            name: document.getElementById('b1Name')?.value || '',
            runs: parseInt(document.getElementById('b1Runs')?.value, 10) || 0,
            balls: parseInt(document.getElementById('b1Balls')?.value, 10) || 0,
            fours: parseInt(document.getElementById('b1Fours')?.value, 10) || 0,
            sixes: parseInt(document.getElementById('b1Sixes')?.value, 10) || 0
        };

        matchState.bat2 = {
            ...matchState.bat2,
            name: document.getElementById('b2Name')?.value || '',
            runs: parseInt(document.getElementById('b2Runs')?.value, 10) || 0,
            balls: parseInt(document.getElementById('b2Balls')?.value, 10) || 0,
            fours: parseInt(document.getElementById('b2Fours')?.value, 10) || 0,
            sixes: parseInt(document.getElementById('b2Sixes')?.value, 10) || 0
        };
    }

    if (!locks.bowler) {
        // ✅ BUG-011 FIX: Validate bowler figures input before parsing
        const bowlFigsRaw = document.getElementById('bowlFigs')?.value || '';
        const bowlFigsPattern = /^\d+-\d+\s+\d+\.[0-5]$/;
        let parsedFigs;
        if (bowlFigsRaw && bowlFigsPattern.test(bowlFigsRaw.trim())) {
            parsedFigs = parseBowlerFigures(bowlFigsRaw);
        } else if (bowlFigsRaw) {
            // Input is malformed (user is mid-edit); keep internal state instead of overwriting
            parsedFigs = parseBowlerFigures(matchState.bowler.figs);
        } else {
            parsedFigs = parseBowlerFigures(matchState.bowler.figs);
        }
        matchState.bowler = {
            ...matchState.bowler,
            name: document.getElementById('bowlName')?.value || '',
            figs: formatBowlerFigures(parsedFigs),
            wickets: parsedFigs.wickets, runs: parsedFigs.runs, balls: parsedFigs.balls
        };
    }

    matchState.partRuns = parseInt(document.getElementById('partRuns')?.value, 10) || 0;
    matchState.partBalls = parseInt(document.getElementById('partBalls')?.value, 10) || 0;
    matchState.isFreeHit = document.getElementById('freeHitToggle')?.checked ?? matchState.isFreeHit;
    matchState.isSpecial = document.getElementById('specialToggle')?.checked ?? matchState.isSpecial;
    matchState.specialText = document.getElementById('specialText')?.value || matchState.specialText;

    const balls = oversToBalls(matchState.overs);
    // [Fix #1 & #2] Use ballsToExactOvers for CRR rate calc, already guarded by balls > 0
    matchState.crr = balls > 0 ? (matchState.runs / ballsToExactOvers(balls)).toFixed(2) : '0.00';

    updateTeamsHeader();
    calculateWinProbability();
    updateActivePlayerCards();
}

function restoreUIFromState() {
    document.getElementById('runs').value = matchState.runs;
    document.getElementById('wkts').value = matchState.wkts;
    document.getElementById('overs').value = matchState.overs;
    document.getElementById('target').value = matchState.target;
    document.getElementById('totOvers').value = matchState.totOvers;
    document.getElementById('statusText').value = matchState.status;
    document.getElementById('b1Name').value = matchState.bat1.name;
    document.getElementById('b1Runs').value = matchState.bat1.runs;
    document.getElementById('b1Balls').value = matchState.bat1.balls;
    document.getElementById('b1Fours').value = matchState.bat1.fours;
    document.getElementById('b1Sixes').value = matchState.bat1.sixes;
    document.getElementById('b2Name').value = matchState.bat2.name;
    document.getElementById('b2Runs').value = matchState.bat2.runs;
    document.getElementById('b2Balls').value = matchState.bat2.balls;
    document.getElementById('b2Fours').value = matchState.bat2.fours;
    document.getElementById('b2Sixes').value = matchState.bat2.sixes;
    document.getElementById('bowlName').value = matchState.bowler.name;
    document.getElementById('bowlFigs').value = matchState.bowler.figs;
    document.getElementById('partRuns').value = matchState.partRuns;
    document.getElementById('partBalls').value = matchState.partBalls;
    document.getElementById('freeHitToggle').checked = matchState.isFreeHit;
    document.getElementById('specialToggle').checked = matchState.isSpecial;
    document.getElementById('specialText').value = matchState.specialText;
    document.getElementById('testDay').value = matchState.testDay;
    document.getElementById('testSession').value = matchState.testSession;
    document.getElementById('testInnings').value = matchState.testInnings;

    setMatchType(matchState.matchType, false);
    updateStrikerUI(); renderOverDisplay(); updateFreeHitBadge();
    updateCrrDisplay(); updateActivePlayerCards(); updateOversPresetUI();
    if (matchState.team1) applySelectedTeamToUI(1);
    if (matchState.team2) applySelectedTeamToUI(2);
    setBattingSide(matchState.battingSide, false);
}

function updateCrrDisplay() {
    calculateWinProbability();
    const crrEl = document.getElementById('crrValue');
    const winProbEl = document.getElementById('winProbValue');
    if (crrEl) crrEl.textContent = matchState.crr;
    if (winProbEl) winProbEl.textContent = `${matchState.winProb}%`;
}

function calculateWinProbability() {
    if (matchState.target <= 0) { matchState.winProb = 50; return; }
    const runsNeeded = matchState.target - matchState.runs;
    const ballsRemaining = Math.max(0, (matchState.totOvers * 6) - oversToBalls(matchState.overs));
    const wicketsRemaining = 10 - matchState.wkts;
    if (runsNeeded <= 0) { matchState.winProb = 100; }
    else if (wicketsRemaining <= 0 || ballsRemaining <= 0) { matchState.winProb = 0; }
    else {
        // [Fix #1] Use ballsToExactOvers for rate calc
        const oversRemaining = ballsToExactOvers(ballsRemaining);
        // [Fix #4] Guard division by zero - ballsRemaining > 0 guaranteed by else block
        const rrr = ballsRemaining > 0 ? runsNeeded / oversRemaining : 0;
        const crr = parseFloat(matchState.crr) || 0;
        // Base probability from rate comparison
        let prob = 50;
        if (crr > rrr) {
            // Batting team is ahead of required rate
            prob += Math.min(35, (crr - rrr) * 8);
        } else {
            // Batting team is behind required rate
            prob -= Math.min(35, (rrr - crr) * 6);
        }
        // Wickets bonus/penalty: more wickets = more likely to chase
        prob += (wicketsRemaining - 5) * 4;
        // Balls remaining factor: more balls = more chance (slight)
        prob += Math.min(5, ballsRemaining / 36);
        // Close to target bonus: if within 20 runs, boost probability slightly
        if (runsNeeded <= 20 && runsNeeded > 0) {
            prob += (20 - runsNeeded) * 0.5;
        }
        matchState.winProb = Math.max(5, Math.min(95, Math.round(prob)));
    }
}

// ==========================================
// ACTIVE PLAYER CARDS (unchanged)
// ==========================================
function updateActivePlayerCards() {
    const strikerPlayer = matchState.striker === '1' ? matchState.bat1 : matchState.bat2;
    const nonStrikerPlayer = matchState.striker === '1' ? matchState.bat2 : matchState.bat1;
    renderActiveBatterCard('activeStriker', strikerPlayer, getBattingTeam(), true);
    renderActiveBatterCard('activeNonStriker', nonStrikerPlayer, getBattingTeam(), false);
    renderActiveBowlerCard();
}

function renderActiveBatterCard(prefix, batter, team, isStriker) {
    const nameEl = document.getElementById(`${prefix}Name`);
    const photoEl = document.getElementById(`${prefix}Photo`);
    const runsEl = document.getElementById(`${prefix}Runs`);
    const ballsEl = document.getElementById(`${prefix}Balls`);
    const foursEl = document.getElementById(`${prefix}Fours`);
    const sixesEl = document.getElementById(`${prefix}Sixes`);
    const srEl = document.getElementById(`${prefix}SR`);
    if (!nameEl) return;
    nameEl.textContent = batter.name || 'Select Batsman';
    runsEl.textContent = batter.runs || 0; ballsEl.textContent = batter.balls || 0;
    foursEl.textContent = batter.fours || 0; sixesEl.textContent = batter.sixes || 0;
    srEl.textContent = (batter.balls > 0) ? ((batter.runs / batter.balls) * 100).toFixed(2) : '0.00';
    const player = findPlayerByName(batter.name, team);
    const photoSrc = player?.photo_url || player?.photo_base64 || '';
    if (photoEl) photoEl.innerHTML = photoSrc ? `<img src="${photoSrc}" alt="">` : `<span>${getInitial(batter.name)}</span>`;
}

function renderActiveBowlerCard() {
    const prefix = 'activeBowler';
    const nameEl = document.getElementById(`${prefix}Name`);
    const photoEl = document.getElementById(`${prefix}Photo`);
    const wicketsEl = document.getElementById(`${prefix}Wickets`);
    const runsEl = document.getElementById(`${prefix}Runs`);
    const oversEl = document.getElementById(`${prefix}Overs`);
    const econEl = document.getElementById(`${prefix}Econ`);
    const figsEl = document.getElementById(`${prefix}Figs`);
    if (!nameEl) return;
    const figs = parseBowlerFigures(matchState.bowler.figs);
    nameEl.textContent = matchState.bowler.name || 'Select Bowler';
    wicketsEl.textContent = figs.wickets; runsEl.textContent = figs.runs;
    oversEl.textContent = ballsToOversString(figs.balls);
    econEl.textContent = figs.balls > 0 ? (figs.runs / ballsToExactOvers(figs.balls)).toFixed(2) : '0.00';
    figsEl.textContent = `${figs.wickets}-${figs.runs}`;
    const player = findPlayerByName(matchState.bowler.name, getBowlingTeam());
    const photoSrc = player?.photo_url || player?.photo_base64 || '';
    if (photoEl) photoEl.innerHTML = photoSrc ? `<img src="${photoSrc}" alt="">` : `<span>${getInitial(matchState.bowler.name)}</span>`;
}

// ==========================================
// HYPE / GRAPHICS (unchanged)
// ==========================================
function triggerHype(type) { sendCommand('trigger_hype', { type }); }
function triggerHypeManual(type) { triggerHype(type); showToast(`${type} animation triggered`); }

function openProfileControl() {
    document.getElementById('playerProfileModal')?.classList.add('show');
    renderPlayerSelectList();
}

function closePlayerProfileModal() { document.getElementById('playerProfileModal')?.classList.remove('show'); }

function renderPlayerSelectList() {
    const list = document.getElementById('playerSelectList');
    if (!list) return;
    const players = allPlayers.map((p, idx) => ({ ...p, __idx: idx }));
    selectedProfilePlayer = null;
    if (!players.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No players loaded</p>';
        return;
    }
    list.innerHTML = players.map((p, idx) => {
        const photoSrc = p.photo_url || p.photo_base64 || '';
        return `<div class="player-option" onclick="selectPlayerForProfile(${idx})">
            <div class="player-option-photo">${photoSrc ? `<img src="${photoSrc}" alt="">` : getInitial(p.name)}</div>
            <div class="player-option-info">
                <span class="player-option-name">${escapeHtml(p.name)}</span>
                <span class="player-option-meta">${escapeHtml(p.role || 'Player')} ${p.school ? '• ' + escapeHtml(p.school) : ''}</span>
            </div>
        </div>`;
    }).join('');
    window.__profilePlayers = players;
}

function selectPlayerForProfile(index) {
    const player = window.__profilePlayers?.[index];
    if (!player) return;
    selectedProfilePlayer = player;
    document.getElementById('profileRole').value = player.role || 'PLAYER';
    document.getElementById('profileName').value = player.name || '';
    document.getElementById('profileSchool').value = player.school || '';
    document.getElementById('profileAge').value = player.age || '';
    const photo = document.getElementById('profilePreviewPhoto');
    photo.src = player.photo_url || player.photo_base64 || '';
}

function confirmShowProfile() {
    const profile = {
        role: document.getElementById('profileRole')?.value || 'PLAYER',
        name: document.getElementById('profileName')?.value || '',
        school: document.getElementById('profileSchool')?.value || '',
        age: document.getElementById('profileAge')?.value || '',
        photo: document.getElementById('profilePreviewPhoto')?.src || ''
    };
    if (!profile.name) { showToast('Please select a player', 'error'); return; }
    sendCommand('show_profile', profile);
    closePlayerProfileModal();
    showToast('Profile shown on scoreboard');
}

function showMilestone(batterNum) {
    updateMatchState();
    const bat = batterNum === 1 ? matchState.bat1 : matchState.bat2;
    if (!bat.name) { showToast('No batter selected', 'error'); return; }
    const player = findPlayerByName(bat.name, getBattingTeam());
    sendLiveData({
        showMilestone: true,
        milestoneData: {
            name: bat.name, runs: bat.runs, balls: bat.balls,
            fours: bat.fours, sixes: bat.sixes,
            photo: player ? (player.photo_url || player.photo_base64 || '') : ''
        }
    });
    showToast(`${bat.name} milestone shown`);
}

function showInningsSummary() {
    updateMatchState();
    sendCommand('show_summary', {
        type: 'innings', title: 'INNINGS SUMMARY',
        teamName: matchState.batFlag, runs: `${matchState.runs}/${matchState.wkts}`,
        overs: matchState.overs, target: matchState.target > 0 ? String(matchState.target) : '---',
        batsmen: [
            { name: matchState.bat1.name || '--', runs: matchState.bat1.runs, balls: matchState.bat1.balls },
            { name: matchState.bat2.name || '--', runs: matchState.bat2.runs, balls: matchState.bat2.balls }
        ],
        bowlers: [{ name: matchState.bowler.name || '--', figs: matchState.bowler.figs }]
    });
    showToast('Innings summary shown');
}

function showMatchSummary() {
    updateMatchState();
    sendCommand('show_summary', {
        type: 'match', title: 'MATCH SUMMARY',
        team1Name: matchState.team1?.short_name || 'T1',
        team1FullName: matchState.team1?.name || 'Team 1',
        team1Score: `${matchState.runs}/${matchState.wkts}`, team1Overs: matchState.overs,
        team2Name: matchState.team2?.short_name || 'T2',
        team2FullName: matchState.team2?.name || 'Team 2',
        team2Score: matchState.target > 0 ? `${Math.max(matchState.target - 1, 0)}/10` : '0/0',
        team2Overs: `${matchState.totOvers}.0`,
        result: getMatchResult(),
        batsmen: [
            { name: matchState.bat1.name || '--', runs: matchState.bat1.runs, balls: matchState.bat1.balls },
            { name: matchState.bat2.name || '--', runs: matchState.bat2.runs, balls: matchState.bat2.balls }
        ],
        bowlers: [{ name: matchState.bowler.name || '--', figs: matchState.bowler.figs }]
    });
    showToast('Match summary shown');
}

function getMatchResult() {
    if (matchState.target <= 0) return 'MATCH IN PROGRESS';
    if (matchState.runs >= matchState.target) return `${matchState.batFlag} WON BY ${10 - matchState.wkts} WICKETS`;
    return 'MATCH IN PROGRESS';
}

function hideAllGraphics() {
    document.getElementById('specialToggle').checked = false;
    matchState.isSpecial = false; matchState.specialText = '';
    sendCommand('hide_graphics');
    sendCommand('hide_charts', {});
    sendLiveData({ isSpecial: false, specialText: '' });
    showToast('All graphics hidden');
}

function presetInningsBreak() {
    document.getElementById('specialText').value = 'INNINGS BREAK';
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true; matchState.specialText = 'INNINGS BREAK';
    postStateChange(true);
}

function presetDrinkBreak() {
    document.getElementById('specialText').value = '🥤 DRINKS BREAK';
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true; matchState.specialText = '🥤 DRINKS BREAK';
    postStateChange(true);
}

function presetInningsOverCard() {
    saveInningsSnapshot(); // [BUG-02 FIX] Save current innings before showing innings over card
    const teamName = matchState.batFlag || 'TEAM';
    const score = `${matchState.runs}/${matchState.wkts}`;
    const target = (parseInt(matchState.runs, 10) || 0) + 1;
    const resultHtml = `<div class="result-card-wrap">
        <div class="result-card-kicker">END OF INNINGS</div>
        <div class="result-card-winner"><span class="result-card-team">${teamName}</span><span class="result-card-team">${score}</span></div>
        <div class="result-card-line">TARGET ${target}</div>
        <div class="result-card-sub">${matchState.overs} OVERS</div>
    </div>`;
    document.getElementById('specialText').value = resultHtml;
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true; matchState.specialText = resultHtml;
    postStateChange(true);
    showToast('Innings Over Card Shown');
}

function presetResultCard() {
    let winnerName = '', marginText = '', detailsText = '';
    const defendedScore = Math.max((parseInt(matchState.target, 10) || 1) - 1, 0);
    if (matchState.target > 0) {
        if (matchState.runs >= matchState.target) {
            winnerName = matchState.batFlag;
            const wktsLeft = Math.max(0, 10 - matchState.wkts);
            marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
            detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
        } else {
            winnerName = matchState.bowlFlag;
            const runsShort = Math.max(1, defendedScore - matchState.runs);
            marginText = `WON BY ${runsShort} RUN${runsShort === 1 ? '' : 'S'}`;
            detailsText = `DEFENDED ${defendedScore} • ${matchState.batFlag} ${matchState.runs}/${matchState.wkts}`;
        }
    } else {
        winnerName = matchState.batFlag; marginText = 'MATCH FINISHED';
        detailsText = `${matchState.runs}/${matchState.wkts} • ${matchState.overs} OVERS`;
    }
    const resultHtml = `<div class="result-card-wrap">
        <div class="result-card-kicker">MATCH RESULT</div>
        <div class="result-card-winner"><span class="result-card-team">${winnerName}</span></div>
        <div class="result-card-line">${marginText}</div>
        <div class="result-card-sub">${detailsText}</div>
    </div>`;
    document.getElementById('specialText').value = resultHtml;
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true; matchState.specialText = resultHtml;
    postStateChange(true);
}

function forceView(viewId) {
    lastForceTrig = `${viewId}_${Date.now()}`;
    sendLiveData();
    showToast(`Showing ${viewId.replace('view-', '')}`);
}

// ==========================================
// ANIMATION SETTINGS (unchanged)
// ==========================================
function openAnimationSettings() {
    document.getElementById('animationSettingsModal')?.classList.add('show');
    loadAnimationSettingsUI();
}

function closeAnimationSettings() { document.getElementById('animationSettingsModal')?.classList.remove('show'); }

function loadAnimationSettingsUI() {
    const settings = [
        ['fourDuration', 'setFourDuration'], ['sixDuration', 'setSixDuration'],
        ['wicketDuration', 'setWicketDuration'], ['profileDuration', 'setProfileDuration'],
        ['milestoneDuration', 'setMilestoneDuration'], ['carouselInterval', 'setCarouselInterval'],
        ['viewHoldDuration', 'setViewHoldDuration'], ['newBatterDelay', 'setNewBatterDelay'],
        ['resultDelay', 'setResultDelay'], ['queueGap', 'setQueueGap']
    ];
    settings.forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.value = animSettings[key];
    });
    updateAnimationValueDisplays();
}

function updateAnimationValueDisplays() {
    const map = [
        ['setFourDuration', 'valFourDuration'], ['setSixDuration', 'valSixDuration'],
        ['setWicketDuration', 'valWicketDuration'], ['setProfileDuration', 'valProfileDuration'],
        ['setMilestoneDuration', 'valMilestoneDuration'], ['setCarouselInterval', 'valCarouselInterval'],
        ['setViewHoldDuration', 'valViewHoldDuration'], ['setNewBatterDelay', 'valNewBatterDelay'],
        ['setResultDelay', 'valResultDelay'], ['setQueueGap', 'valQueueGap']
    ];
    map.forEach(([inputId, valueId]) => {
        const input = document.getElementById(inputId);
        const value = document.getElementById(valueId);
        if (input && value) value.textContent = `${(parseInt(input.value, 10) / 1000).toFixed(1)}s`;
    });
}

function saveAnimationSettings() {
    animSettings = {
        fourDuration: parseInt(document.getElementById('setFourDuration')?.value, 10) || 2500,
        sixDuration: parseInt(document.getElementById('setSixDuration')?.value, 10) || 2500,
        wicketDuration: parseInt(document.getElementById('setWicketDuration')?.value, 10) || 3000,
        profileDuration: parseInt(document.getElementById('setProfileDuration')?.value, 10) || 5000,
        milestoneDuration: parseInt(document.getElementById('setMilestoneDuration')?.value, 10) || 8000,
        carouselInterval: parseInt(document.getElementById('setCarouselInterval')?.value, 10) || 20000,
        viewHoldDuration: parseInt(document.getElementById('setViewHoldDuration')?.value, 10) || 7000,
        newBatterDelay: parseInt(document.getElementById('setNewBatterDelay')?.value, 10) || 1600,
        resultDelay: parseInt(document.getElementById('setResultDelay')?.value, 10) || 3000,
        queueGap: parseInt(document.getElementById('setQueueGap')?.value, 10) || 500
    };
    saveToLocalStorage(); closeAnimationSettings(); postStateChange(true);
    showToast('Animation settings saved');
}

function resetAnimationSettings() {
    animSettings = {
        fourDuration: 2500, sixDuration: 2500, wicketDuration: 3000,
        profileDuration: 5000, milestoneDuration: 8000, carouselInterval: 20000,
        viewHoldDuration: 7000, newBatterDelay: 1600, resultDelay: 3000, queueGap: 500
    };
    loadAnimationSettingsUI(); showToast('Settings reset');
}

// ==========================================
// MATCH TYPE (unchanged)
// ==========================================
function setMatchType(type, shouldSend = true) {
    matchState.matchType = type;
    document.getElementById('typeLimit')?.classList.toggle('active', type === 'limited');
    document.getElementById('typeTest')?.classList.toggle('active', type === 'test');
    document.getElementById('testOptions')?.classList.toggle('show', type === 'test');
    document.getElementById('leadDisplay')?.classList.toggle('show', type === 'test');
    if (type === 'limited' && !matchState.oversPreset) matchState.oversPreset = 't20';
    updateOversPresetUI();
    if (shouldSend) postStateChange(true);
}

// ==========================================
// SUPER OVER SYSTEM (unchanged)
// ==========================================
async function initSuperOver() {
    const confirmed = await showConfirm({
        title: 'Start Super Over?',
        message: 'This will reset scoring data and begin a 1-over shootout.',
        icon: '⚡',
        theme: 'warning',
        confirmText: '⚡ Start Super Over',
        cancelText: 'Cancel',
        details: [
            'Show "SUPER OVER" announcement on scoreboard',
            'Reset: Runs, Wickets, Overs',
            'Reset: Batsmen, Bowler, Partnership',
            'Reset: Over tracker & dismissed players',
            'Keep: Teams & team selection',
            'Format: 1 Over per side'
        ]
    });
    if (!confirmed) return;

    updateMatchState();

    const prevRuns = matchState.runs;
    const prevWkts = matchState.wkts;
    const prevOvers = matchState.overs;

    // [BUG-03 FIX] Save tied score context before reset
    matchState._tiedScore = matchState.runs + '/' + matchState.wkts;
    matchState._tiedOvers = matchState.overs;
    // [BUG-02 FIX] Save current innings snapshot before reset
    saveInningsSnapshot();
    // [BUG-03 FIX] Set super over state flags
    matchState.isSuperOver = true;
    matchState.superOverRound = (matchState.superOverRound || 0) + 1;

    matchState.runs = 0;
    matchState.wkts = 0;
    matchState.overs = '0.0';
    matchState.target = 0;
    matchState.partRuns = 0;
    matchState.partBalls = 0;
    matchState.isFreeHit = false;
    matchState._currentTeamScore = 0;

    matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.striker = '1';
    matchState.dismissedPlayers = [];
    matchState.bowlingHistory = [];
    matchState.overRunsHistory = [];
    matchState.partnershipHistory = []; // [BUG-04 FIX] Reset partnership history for super over

    matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0 };

    currentOver = [];
    matchState.thisOver = '';
    historyStack = [];

    matchState.totOvers = 1;
    matchState.oversPreset = 'custom';
    matchState.status = 'SUPER OVER';
    matchState.isSpecial = false;
    matchState.specialText = '';

    const b1El = document.getElementById('b1Name');
    const b2El = document.getElementById('b2Name');
    const bowlEl = document.getElementById('bowlName');
    if (b1El) b1El.value = '';
    if (b2El) b2El.value = '';
    if (bowlEl) bowlEl.value = '';

    restoreUIFromState();
    renderSquadPreview();
    updateActivePlayerCards();
    renderOverDisplay();

    saveToLocalStorage();

    sendCommand('show_super_over', {
        team1: matchState.team1?.short_name || matchState.batFlag,
        team2: matchState.team2?.short_name || matchState.bowlFlag,
        t1Logo: matchState.t1Logo,
        t2Logo: matchState.t2Logo,
        prevScore1: `${prevRuns}/${prevWkts} (${prevOvers})`,
        duration: 8000
    });

    setTimeout(() => {
        sendLiveData({
            isSpecial: false,
            showAllOutCard: false,
            showMilestone: false,
            status: 'SUPER OVER'
        });
    }, 2000);

    showToast('⚡ Super Over Started!');

    const customInput = document.getElementById('customTotalOvers');
    if (customInput) customInput.value = 1;
    updateOversPresetUI();
}

function showSuperOverWinner() {
    updateMatchState();

    const target = parseInt(matchState.target) || 0;
    const runs = matchState.runs;
    const wkts = matchState.wkts;

    let winnerMsg = '';
    let winnerTeam = '';
    let loserTeam = '';

    if (target > 0) {
        if (runs >= target) {
            winnerTeam = matchState.batFlag;
            loserTeam = matchState.bowlFlag;
            const wktsLeft = Math.max(0, 10 - wkts);
            winnerMsg = `${winnerTeam} WON SUPER OVER BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
        } else {
            winnerTeam = matchState.bowlFlag;
            loserTeam = matchState.batFlag;
            const runsDiff = Math.max(1, (target - 1) - runs);
            winnerMsg = `${winnerTeam} WON SUPER OVER BY ${runsDiff} RUN${runsDiff === 1 ? '' : 'S'}`;
        }
    } else {
        winnerMsg = 'SUPER OVER COMPLETE';
        winnerTeam = matchState.batFlag;
    }

    const resultHtml = `<div class="result-card-wrap">
        <div class="result-card-kicker">⚡ SUPER OVER RESULT</div>
        <div class="result-card-winner"><span class="result-card-team">${winnerTeam}</span></div>
        <div class="result-card-line">${winnerMsg}</div>
        <div class="result-card-sub">Super Over: ${runs}/${wkts} (${matchState.overs} ov)</div>
    </div>`;

    document.getElementById('specialText').value = resultHtml;
    document.getElementById('specialToggle').checked = true;
    matchState.isSpecial = true;
    matchState.specialText = resultHtml;
    postStateChange(true);
    showToast('⚡ Super Over Result shown!');
}

// ==========================================
// LOCKS (unchanged)
// ==========================================
function toggleLock(section) {
    locks[section] = document.getElementById(`lock${capitalizeFirst(section)}`)?.checked ?? false;
    const sectionEl = document.getElementById(`${section}Section`);
    const icon = document.querySelector(`#lock${capitalizeFirst(section)} + .lock-icon`) ||
        document.getElementById(`lock${capitalizeFirst(section)}`)?.closest('.lock-toggle')?.querySelector('.lock-icon');
    if (sectionEl) sectionEl.classList.toggle('is-locked', locks[section]);
    if (icon) icon.textContent = locks[section] ? '🔒' : '🔓';
}

// ==========================================
// QUICK ACTIONS (unchanged)
// ==========================================
async function presetStartMatch() {
    const confirmed = await showConfirm({
        title: 'Start New Match',
        message: 'This will reset all score data and start fresh.',
        icon: '🎬',
        theme: 'warning',
        confirmText: '🏏 Start Match',
        cancelText: 'Cancel',
        details: [
            'Score will be reset to 0/0',
            'Batsmen & bowler will be cleared',
            'Partnership will be reset',
            'Over tracker will be cleared',
            'Dismissed players list will be cleared'
        ]
    });
    if (!confirmed) return;

    resetScore(false); resetBatsmen(false); resetBowler(false); resetPartnership(false);
    currentOver = []; matchState.dismissedPlayers = []; matchState.bowlingHistory = [];
    matchState.overRunsHistory = []; // [Fix #5] Reset over runs history
    matchState.showUpcomingBatter = false; matchState.upcomingBatterName = '';
    matchState.status = 'LIVE MATCH';
    sendCommand('reset_charts', {});
    restoreUIFromState(); renderSquadPreview(); postStateChange(true);
    showToast('Match started!');
}

async function presetChaseStart() {
    updateMatchState();
    const firstInningsScore = matchState.runs;

    if (firstInningsScore <= 0) {
        await showAlert({
            title: 'No First Innings Score',
            message: 'Cannot start chase without a first innings score. Score some runs first!',
            icon: '❌',
            theme: 'danger',
            confirmText: 'OK'
        });
        return;
    }

    const confirmed = await showConfirm({
        title: 'Start Chase?',
        message: `${matchState.batFlag} scored ${matchState.runs}/${matchState.wkts} in ${matchState.overs} overs.`,
        icon: '🏁',
        theme: 'accent',
        confirmText: '🎯 Start Chase',
        cancelText: 'Cancel',
        details: [
            `First Innings: ${matchState.batFlag} ${matchState.runs}/${matchState.wkts} (${matchState.overs} ov)`,
            `Target: ${firstInningsScore + 1} runs`,
            'Score, batsmen, bowler will be reset',
            'Batting/bowling sides will swap',
            'First innings data will be saved'
        ]
    });
    if (!confirmed) return;

    const newBattingSide = matchState.battingSide === 1 ? 2 : 1;
    saveFirstInningsData();
    saveInningsSnapshot(); // [CHART FIX] Save Supabase innings_1 snapshot at chase start
    setBattingSide(newBattingSide, false);

    resetScore(false);
    resetBatsmen(false);
    resetBowler(false);
    resetPartnership(false);

    currentOver = [];
    matchState.dismissedPlayers = [];
    matchState.bowlingHistory = [];
    matchState.overRunsHistory = []; // [Fix #5] Reset over runs history on chase start
    matchState.partnershipHistory = []; // [PARTNERSHIP FIX] Reset for 2nd innings — must be AFTER saveInningsSnapshot
    matchState._currentTeamScore = 0;
    matchState.target = firstInningsScore + 1;
    matchState.status = `TARGET: ${matchState.target}`;
    matchState.showUpcomingBatter = false;
    matchState.upcomingBatterName = '';

    sendCommand('reset_charts', {});

    const enChaseToggle = document.getElementById('enChase');
    if (enChaseToggle) enChaseToggle.checked = true;

    calculateWinProbability();
    restoreUIFromState();
    renderSquadPreview();

    lastForceTrig = `view-chase_${Date.now()}`;

    const chasingTeam = newBattingSide === 1 ? matchState.team1 : matchState.team2;
    const chasingLogoSrc = newBattingSide === 1
        ? (matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '')
        : (matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '');

    const bowlingTeam = newBattingSide === 1 ? matchState.team2 : matchState.team1;
    const bowlingLogoSrc = newBattingSide === 1
        ? (matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '')
        : (matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '');

    sendLiveData();
    saveToLocalStorage();

    showAdminChasePopup({
        target: matchState.target,
        battingTeam: chasingTeam?.short_name || matchState.batFlag || 'TEAM',
        battingTeamFull: chasingTeam?.name || '',
        battingTeamLogo: chasingLogoSrc,
        bowlingTeam: bowlingTeam?.short_name || matchState.bowlFlag || 'TEAM',
        bowlingTeamFull: bowlingTeam?.name || '',
        bowlingTeamLogo: bowlingLogoSrc,
        firstInningsScore: `${firstInningsScore}/${matchState.wkts}`,
        firstInningsOvers: matchState.overs,
        totOvers: matchState.totOvers
    });

    showToast(`Chase started! Target ${matchState.target}`);
}

function saveFirstInningsData() {
    if (!database || !matchId) return;
    updateMatchState();

    const battingRows = [];
    const dismissedNamesForSave = new Set();

    (matchState.dismissedPlayers || []).forEach(p => {
        if (typeof p === 'object' && p.name) {
            battingRows.push({
                name: p.name,
                dismissal: p.dismissal || 'OUT',
                bowler: p.bowler || '-',
                fielder: p.fielder || '-',
                runs: p.runs ?? 0,
                balls: p.balls ?? 0,
                fours: p.fours ?? 0,
                sixes: p.sixes ?? 0,
                isOut: true
            });
            dismissedNamesForSave.add(p.name);
        } else if (typeof p === 'string') {
            battingRows.push({
                name: p,
                dismissal: 'OUT',
                bowler: '-',
                fielder: '-',
                runs: 0,
                balls: 0,
                fours: 0,
                sixes: 0,
                isOut: true
            });
            dismissedNamesForSave.add(p);
        }
    });

    if (matchState.bat1.name && !matchState.bat1.isOut && !dismissedNamesForSave.has(matchState.bat1.name)) {
        battingRows.push({
            name: matchState.bat1.name,
            dismissal: 'NOT OUT',
            bowler: matchState.bowler.name || '-',
            fielder: '-',
            runs: matchState.bat1.runs || 0,
            balls: matchState.bat1.balls || 0,
            fours: matchState.bat1.fours || 0,
            sixes: matchState.bat1.sixes || 0,
            isOut: false
        });
    }

    if (matchState.bat2.name && !matchState.bat2.isOut && !dismissedNamesForSave.has(matchState.bat2.name)) {
        battingRows.push({
            name: matchState.bat2.name,
            dismissal: 'NOT OUT',
            bowler: matchState.bowler.name || '-',
            fielder: '-',
            runs: matchState.bat2.runs || 0,
            balls: matchState.bat2.balls || 0,
            fours: matchState.bat2.fours || 0,
            sixes: matchState.bat2.sixes || 0,
            isOut: false
        });
    }

    let batsmenTotal = 0;
    battingRows.forEach(r => { batsmenTotal += (parseInt(r.runs) || 0); });
    const extras = Math.max(0, matchState.runs - batsmenTotal);

    const bowlingData = [];
    const bowlerNamesForSave = new Set();

    (matchState.bowlingHistory || []).forEach(b => {
        if (b.name && !bowlerNamesForSave.has(b.name)) {
            bowlerNamesForSave.add(b.name);
            bowlingData.push({
                name: b.name,
                overs: b.overs || ballsToOversString(b.balls || 0),
                runs: b.runs || 0,
                wickets: b.wickets || 0,
                balls: b.balls || 0
            });
        }
    });

    if (matchState.bowler.name) {
        const figs = parseBowlerFigures(matchState.bowler.figs);
        const currentBowlerRecord = {
            name: matchState.bowler.name,
            overs: ballsToOversString(figs.balls),
            runs: figs.runs,
            wickets: figs.wickets,
            balls: figs.balls
        };
        if (bowlerNamesForSave.has(matchState.bowler.name)) {
            const idx = bowlingData.findIndex(b => b.name === matchState.bowler.name);
            if (idx >= 0) bowlingData[idx] = currentBowlerRecord;
        } else {
            bowlingData.push(currentBowlerRecord);
        }
    }

    database.ref(`matches/${matchId}/first_innings`).set({
        batting: battingRows,
        bowling: bowlingData,
        score: `${matchState.runs}/${matchState.wkts}`,
        overs: matchState.overs,
        extras,
        teamShortName: matchState.batFlag,
        teamFullName: getBattingTeam()?.name || matchState.batFlag,
        teamLogo: matchState.battingSide === 1
            ? (matchState.t1Logo || matchState.team1?.logo_url || '')
            : (matchState.t2Logo || matchState.team2?.logo_url || ''),
        // [Worm Fix] Save 1st innings over-by-over data for cross-device worm chart comparison
        // Very low bandwidth: just {runs, isWicket} per over (~20 small objects for T20)
        overRunsHistory: (matchState.overRunsHistory || []).map(o => ({ r: o.runs || 0, w: !!o.isWicket })),
        savedAt: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => console.error('Error saving first innings:', err));
}

async function resetScore(send = true) {
    if (send) {
        const confirmed = await showConfirm({
            title: 'Reset Score',
            message: 'Reset runs, wickets and overs to zero?',
            icon: '🔄',
            theme: 'warning',
            confirmText: '🔄 Reset Score',
            cancelText: 'Cancel',
            details: [
                `Current: ${matchState.runs}/${matchState.wkts} (${matchState.overs} ov)`,
                'Will be reset to 0/0 (0.0 ov)',
                'Over tracker will be cleared',
                'Chart data will be reset'
            ]
        });
        if (!confirmed) return;
    }
    matchState.runs = 0; matchState.wkts = 0; matchState.overs = '0.0'; currentOver = [];
    sendCommand('reset_charts', {});
    if (send) postStateChange(true);
}

function resetBatsmen(send = true) {
    matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false };
    matchState.striker = '1'; matchState.dismissedPlayers = [];
    matchState.bowlingHistory = []; // ✅ BUG-018 FIX: Clear bowling history on batsmen reset
    matchState.overRunsHistory = []; // [Fix #5] Reset over runs history
    const b1 = document.getElementById('b1Name'); const b2 = document.getElementById('b2Name');
    if (b1) b1.value = ''; if (b2) b2.value = '';
    if (send) postStateChange(true);
    renderSquadPreview();
}

function resetBowler(send = true) {
    matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0 };
    if (send) postStateChange(true);
}

function resetPartnership(send = true) {
    matchState.partRuns = 0; matchState.partBalls = 0;
    if (send) postStateChange(true);
}

async function clearAllData() {
    const savedRaw = localStorage.getItem(CONFIG.STORAGE_KEY);
    const currentSize = savedRaw ? (savedRaw.length / 1024).toFixed(1) : '0';
    const teamsCache = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
    const teamsCacheSize = teamsCache ? (teamsCache.length / 1024).toFixed(1) : '0';
    const totalSize = (parseFloat(currentSize) + parseFloat(teamsCacheSize)).toFixed(1);

    const firstConfirm = await showConfirm({
        title: 'Clear All Match Data',
        message: 'This will permanently delete ALL match data from both server and browser.',
        icon: '⚠️',
        theme: 'danger',
        confirmText: '🗑️ Yes, Clear All',
        cancelText: 'Cancel',
        details: [
            'Match state & score data',
            'Firebase server data',
            'Teams cache & local storage',
            'All settings & history'
        ],
        bodyHtml: `
            <div style="display:flex;gap:8px;margin-top:8px;">
                <div class="confirm-size-badge">
                    💾 Match Data: ${currentSize} KB
                </div>
                <div class="confirm-size-badge">
                    👥 Teams Cache: ${teamsCacheSize} KB
                </div>
            </div>
            <div class="confirm-size-badge" style="margin-top:6px;">
                📦 Total: ${totalSize} KB will be deleted
            </div>
        `
    });
    if (!firstConfirm) return;

    const finalConfirm = await showConfirm({
        title: 'FINAL WARNING',
        message: 'This action CANNOT be undone. All data will be permanently destroyed.',
        icon: '🔴',
        theme: 'critical',
        confirmText: '💀 DELETE EVERYTHING',
        cancelText: 'Cancel',
        details: [
            'There is NO way to recover this data',
            'Page will reload after clearing',
            'You will need to set up the match again'
        ]
    });
    if (!finalConfirm) return;

    isClearing = true;
    try {
        // 1. Clear Firebase
        if (database) await database.ref(`matches/${matchId}`).set(null);

        // 2. Clear Supabase match_live row — reset all columns to empty/null state
        const supabaseClearPayload = {
            live_state: {},
            match_info: {},
            innings_1: {},
            innings_2: {},
            community: { votes: { STC: 0, GSC: 0 }, totalVotes: 0 },
            momentum: [],
            updated_at: new Date().toISOString(),
        };
        try {
            await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/match_live?match_id=eq.${SUPABASE_CONFIG.MATCH_ID}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_CONFIG.SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${SUPABASE_CONFIG.SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                },
                body: JSON.stringify(supabaseClearPayload),
            });
            console.log('📡 Supabase match_live cleared ✅');
        } catch (sbErr) {
            console.warn('⚠️ Supabase clear failed (non-critical):', sbErr?.message || sbErr);
        }

        // 3. Clear localStorage
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        localStorage.removeItem('matchId');
        localStorage.removeItem(CONFIG.CACHE.TEAMS_KEY);
        localStorage.removeItem(CONFIG.CACHE.VERSION_KEY);

        const sizeEl = document.getElementById('storageSize');
        const timeEl = document.getElementById('lastSaveTime');
        if (sizeEl) sizeEl.textContent = '0 KB';
        if (timeEl) timeEl.textContent = '--';

        showToast('All data cleared (Firebase + Supabase)! Reloading...');
        setTimeout(() => location.reload(true), 1000);
    } catch (e) {
        console.error('Clear failed:', e);
        isClearing = false;
        await showAlert({
            title: 'Clear Failed',
            message: 'Failed to clear server data. Check your connection and try again.',
            icon: '❌',
            theme: 'danger',
            confirmText: 'OK'
        });
    }
}

// ==========================================
// STORAGE (unchanged)
// ==========================================
function saveToLocalStorage() {
    if (isClearing) return;
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        matchId, matchState: {
            ...matchState,
            team1: matchState.team1 ? { id: matchState.team1.id, short_name: matchState.team1.short_name, name: matchState.team1.name } : null,
            team2: matchState.team2 ? { id: matchState.team2.id, short_name: matchState.team2.short_name, name: matchState.team2.name } : null,
        },
        animSettings, currentOver, msgCount, autoAllOutEnabled, timestamp: Date.now()
    }));
    localStorage.setItem('matchId', matchId);
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.timestamp && (Date.now() - data.timestamp) < 86400000 * 7) {
            if (data.matchId) matchId = data.matchId;
            if (data.matchState) {
                // ✅ BUG-013 FIX: Deep merge for nested objects instead of shallow spread
                const incoming = data.matchState;
                matchState = { ...matchState, ...incoming };
                // Preserve defaults for nested objects that might be missing properties
                if (incoming.bat1) matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...incoming.bat1 };
                if (incoming.bat2) matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...incoming.bat2 };
                if (incoming.bowler) matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0, ...incoming.bowler };
                if (!Array.isArray(incoming.dismissedPlayers)) matchState.dismissedPlayers = [];
                if (!Array.isArray(incoming.bowlingHistory)) matchState.bowlingHistory = [];
                if (!Array.isArray(incoming.overRunsHistory)) matchState.overRunsHistory = []; // [Fix #5]
            }
            if (data.animSettings) animSettings = { ...animSettings, ...data.animSettings };
            if (Array.isArray(data.currentOver)) currentOver = data.currentOver;
            if (data.msgCount) msgCount = data.msgCount;
            if (typeof data.autoAllOutEnabled === 'boolean') autoAllOutEnabled = data.autoAllOutEnabled;
            if (Array.isArray(matchState.dismissedPlayers)) {
                matchState.dismissedPlayers = matchState.dismissedPlayers.map(p => {
                    if (typeof p === 'string') return { name: p, runs: 0, balls: 0, dismissal: 'OUT', bowler: '-', fielder: '-' };
                    return p;
                });
            } else matchState.dismissedPlayers = [];
            if (!Array.isArray(matchState.bowlingHistory)) matchState.bowlingHistory = [];
            if (!Array.isArray(matchState.overRunsHistory)) matchState.overRunsHistory = []; // [Fix #5]
            matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat1 };
            matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat2 };
            matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0, ...matchState.bowler };
            if (!matchState.oversPreset) {
                if (matchState.totOvers === 10) matchState.oversPreset = 't10';
                else if (matchState.totOvers === 20) matchState.oversPreset = 't20';
                else if (matchState.totOvers === 50) matchState.oversPreset = 'odi';
                else matchState.oversPreset = 'custom';
            }
        }
    } catch (e) { console.error('Load local state failed', e); }
}

function updateStorageInfo() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
    const size = saved ? (saved.length / 1024).toFixed(1) : '0';
    const sizeEl = document.getElementById('storageSize');
    const timeEl = document.getElementById('lastSaveTime');
    if (sizeEl) sizeEl.textContent = `${size} KB`;
    if (timeEl && saved) {
        try { const data = JSON.parse(saved); timeEl.textContent = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--'; }
        catch { timeEl.textContent = '--'; }
    }
}

function exportData() {
    const data = { exported: new Date().toISOString(), version: APP_VERSION, matchId, matchState, animSettings, currentOver };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `admin-match-${matchId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast('Data exported');
}

function importData() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
            const text = await file.text(); const data = JSON.parse(text);
            if (!data.matchState) { showToast('Invalid file', 'error'); return; }
            const oldMatchId = matchId;
            if (data.matchId) matchId = data.matchId;
            matchState = { ...matchState, ...data.matchState };
            currentOver = data.currentOver || [];
            animSettings = { ...animSettings, ...(data.animSettings || {}) };
            // ✅ BUG-013 FIX: Deep merge nested objects to preserve new properties
            if (data.matchState.bat1) matchState.bat1 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat1 };
            if (data.matchState.bat2) matchState.bat2 = { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, ...matchState.bat2 };
            if (data.matchState.bowler) matchState.bowler = { name: '', figs: '0-0 0.0', wickets: 0, runs: 0, balls: 0, ...matchState.bowler };
            restoreUIFromState(); saveToLocalStorage(); updateActivePlayerCards(); postStateChange(true);
            document.getElementById('matchIdDisplay').textContent = matchId;
            localStorage.setItem('matchId', matchId);
            // ✅ BUG-003 FIX: Re-initialize Firebase listeners if matchId changed
            if (matchId !== oldMatchId && database) {
                setupFirebaseRealtime();
                showToast('Data imported & Firebase listeners re-initialized');
            } else {
                showToast('Data imported');
            }
        } catch (e) { showToast('Import failed', 'error'); }
    };
    input.click();
}

async function clearSavedData() {
    const savedRaw = localStorage.getItem(CONFIG.STORAGE_KEY);
    const currentSize = savedRaw ? (savedRaw.length / 1024).toFixed(1) : '0';
    const teamsCache = localStorage.getItem(CONFIG.CACHE.TEAMS_KEY);
    const teamsCacheSize = teamsCache ? (teamsCache.length / 1024).toFixed(1) : '0';
    const totalSize = (parseFloat(currentSize) + parseFloat(teamsCacheSize)).toFixed(1);

    if (parseFloat(totalSize) === 0) {
        await showAlert({
            title: 'No Data to Clear',
            message: 'There is no saved data in the browser to clear.',
            icon: 'ℹ️',
            theme: 'info',
            confirmText: 'OK'
        });
        return;
    }

    const confirmed = await showConfirm({
        title: 'Clear Browser Data',
        message: 'Clear ALL saved admin state from this browser?',
        icon: '🧹',
        theme: 'warning',
        confirmText: '🗑️ Clear Data',
        cancelText: 'Keep Data',
        details: [
            'Admin match state will be removed',
            'Teams cache will be cleared',
            'Match ID will be reset',
            'Server data will NOT be affected'
        ],
        bodyHtml: `
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                <div class="confirm-size-badge">
                    💾 Match: ${currentSize} KB
                </div>
                <div class="confirm-size-badge">
                    👥 Cache: ${teamsCacheSize} KB
                </div>
                <div class="confirm-size-badge">
                    📦 Total: ${totalSize} KB
                </div>
            </div>
        `
    });
    if (!confirmed) return;

    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem('matchId');
    clearTeamsCache();

    const sizeEl = document.getElementById('storageSize');
    const timeEl = document.getElementById('lastSaveTime');
    if (sizeEl) sizeEl.textContent = '0 KB';
    if (timeEl) timeEl.textContent = '--';

    showToast('All saved data cleared. Refresh to start fresh.');
}

// ==========================================
// BOWLER FIGURES HELPERS (unchanged)
// ==========================================
function parseBowlerFigures(text) {
    const str = String(text || '0-0 0.0').trim();
    const parts = str.split(' ');
    const wr = (parts[0] || '0-0').split('-');
    const ob = (parts[1] || '0.0').split('.');
    return {
        wickets: parseInt(wr[0], 10) || 0, runs: parseInt(wr[1], 10) || 0,
        balls: ((parseInt(ob[0], 10) || 0) * 6) + Math.min(parseInt(ob[1], 10) || 0, 5)
    };
}

function formatBowlerFigures(figs) {
    return `${figs.wickets}-${figs.runs} ${ballsToOversString(figs.balls)}`;
}

function updateOversPresetUI() {
    const limitedSection = document.getElementById('limitedOversSection');
    const customRow = document.getElementById('customOversRow');
    const summary = document.getElementById('oversPresetSummary');
    const customInput = document.getElementById('customTotalOvers');
    const totalOversInput = document.getElementById('totOvers');
    if (limitedSection) limitedSection.style.display = matchState.matchType === 'limited' ? 'block' : 'none';
    ['t10', 't20', 'odi', 'custom'].forEach(key => {
        const btn = document.getElementById(`oversPreset_${key}`);
        if (btn) btn.classList.toggle('active', matchState.oversPreset === key);
    });
    if (customRow) customRow.classList.toggle('show', matchState.oversPreset === 'custom');
    if (customInput && document.activeElement !== customInput) customInput.value = matchState.totOvers;
    if (totalOversInput) totalOversInput.value = matchState.totOvers;
    if (summary) {
        summary.textContent = matchState.matchType === 'test' ? 'Multi-day match format' : `${matchState.totOvers} overs per innings`;
    }
}

function setOversPreset(preset, shouldSend = true) {
    if (matchState.matchType === 'test') return;
    matchState.oversPreset = preset;
    const presetMap = { t10: 10, t20: 20, odi: 50 };
    if (preset !== 'custom') matchState.totOvers = presetMap[preset] || 20;
    else matchState.totOvers = parseInt(document.getElementById('customTotalOvers')?.value, 10) || 20;
    updateOversPresetUI();
    if (shouldSend) postStateChange(true);
}

function syncCustomOvers() {
    matchState.oversPreset = 'custom';
    matchState.totOvers = parseInt(document.getElementById('customTotalOvers')?.value, 10) || 20;
    updateOversPresetUI(); postStateChange(true);
}

// ==========================================
// UTILS (unchanged)
// ==========================================
function oversToBalls(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    const o = parseInt(parts[0] || '0', 10);
    let b = parseInt(parts[1] || '0', 10);
    if (b > 5) b = 5;
    if (b < 0) b = 0;
    return Math.max(0, o * 6 + b);
}

function ballsToOversString(totalBalls) {
    const ovs = Math.floor((totalBalls || 0) / 6);
    const balls = (totalBalls || 0) % 6;
    return `${ovs}.${balls}`;
}

// [Fix #1] Convert total balls to exact decimal overs for RATE calculations (e.g. 8 balls → 1.333...)
// Use this for CRR/Economy/RRR calculations, NOT for display (use ballsToOversString for display)
function ballsToExactOvers(totalBalls) {
    return (totalBalls || 0) / 6;
}

function sanitizeOversInput(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    const o = Math.max(0, parseInt(parts[0] || '0', 10));
    let b = parseInt(parts[1] || '0', 10);
    if (b > 5) b = 5;
    if (b < 0) b = 0;
    return `${o}.${b}`;
}

function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function getInitial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function debounce(fn, delay) {
    let timeout;
    return function (...args) { clearTimeout(timeout); timeout = setTimeout(() => fn.apply(this, args), delay); };
}

// ==========================================
// CUSTOM CONFIRM / ALERT SYSTEM (unchanged)
// ==========================================
let _confirmResolve = null;

function showConfirm(options = {}) {
    return new Promise((resolve) => {
        if (_confirmResolve) {
            _confirmResolve(false);
            _confirmResolve = null;
        }
        _confirmResolve = resolve;
        const {
            title = 'Confirm',
            message = 'Are you sure?',
            icon = '⚠️',
            theme = 'warning',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            details = [],
            bodyHtml = '',
            alertOnly = false
        } = options;

        const popup = document.getElementById('customConfirmPopup');
        const card = popup?.querySelector('.popup-card');
        if (!popup || !card) { resolve(false); return; }

        card.className = 'popup-card popup-sm';
        card.classList.add(`confirm-theme-${theme}`);
        popup.classList.toggle('alert-mode', alertOnly);

        document.getElementById('confirmPopupIcon').textContent = icon;
        document.getElementById('confirmPopupTitle').textContent = title;
        document.getElementById('confirmPopupMessage').textContent = message;

        const bodyEl = document.getElementById('confirmPopupBody');
        let bodyContent = '';
        if (details.length > 0) {
            bodyContent += '<div class="confirm-detail-list">';
            details.forEach(d => {
                bodyContent += `<div class="confirm-detail-item">${escapeHtml(d)}</div>`;
            });
            bodyContent += '</div>';
        }
        if (bodyHtml) bodyContent += bodyHtml;
        bodyEl.innerHTML = bodyContent;
        bodyEl.style.display = bodyContent ? 'block' : 'none';

        const okBtn = document.getElementById('confirmPopupOk');
        const cancelBtn = document.getElementById('confirmPopupCancel');
        okBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        const newOk = okBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        newOk.addEventListener('click', () => {
            _closeConfirmPopup();
            if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
        });
        newCancel.addEventListener('click', () => {
            _closeConfirmPopup();
            if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
        });
        popup.classList.add('show');
        popup.onclick = (e) => {
            if (e.target === popup) {
                _closeConfirmPopup();
                if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
            }
        };
    });
}

function showAlert(options = {}) {
    return showConfirm({
        confirmText: 'OK',
        alertOnly: true,
        ...options
    });
}

function _closeConfirmPopup() {
    const popup = document.getElementById('customConfirmPopup');
    if (popup) popup.classList.remove('show');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const popup = document.getElementById('customConfirmPopup');
        if (popup?.classList.contains('show')) {
            _closeConfirmPopup();
            if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
        }
    }
});

// ==========================================
// TOAST (unchanged)
// ==========================================
function showToast(message, type = 'success') {
    const toastId = type === 'error' ? 'toastError' : 'toastSuccess';
    const textId = type === 'error' ? 'toastErrorText' : 'toastSuccessText';
    const toast = document.getElementById(toastId);
    const text = document.getElementById(textId);
    if (!toast || !text) return;
    text.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==========================================
// PRESENT DETAILS (unchanged)
// ==========================================
function openPresentDetailsModal() {
    if (!database || !matchId) { showToast('Database not connected', 'error'); return; }
    updateMatchState();
    const rows = [];
    const dismissedNames = new Set();

    (matchState.dismissedPlayers || []).forEach(p => {
        if (typeof p === 'string') {
            rows.push({
                name: p,
                dismissal: 'OUT',
                bowler: '-',
                fielder: '-',
                runs: '-',
                balls: '-',
                isOut: true
            });
            dismissedNames.add(p);
        } else {
            rows.push({
                name: p.name || '--',
                dismissal: p.dismissal || 'OUT',
                bowler: p.bowler || '-',
                fielder: p.fielder || '-',
                runs: p.runs ?? '-',
                balls: p.balls ?? '-',
                fours: p.fours ?? 0,
                sixes: p.sixes ?? 0,
                isOut: true
            });
            dismissedNames.add(p.name);
        }
    });

    if (matchState.bat1.name && !matchState.bat1.isOut && !dismissedNames.has(matchState.bat1.name)) {
        rows.push({
            name: matchState.bat1.name,
            dismissal: 'NOT OUT',
            bowler: matchState.bowler.name || '-',
            fielder: '-',
            runs: matchState.bat1.runs || 0,
            balls: matchState.bat1.balls || 0,
            fours: matchState.bat1.fours || 0,
            sixes: matchState.bat1.sixes || 0,
            isOut: false
        });
    }
    if (matchState.bat2.name && !matchState.bat2.isOut && !dismissedNames.has(matchState.bat2.name)) {
        rows.push({
            name: matchState.bat2.name,
            dismissal: 'NOT OUT',
            bowler: matchState.bowler.name || '-',
            fielder: '-',
            runs: matchState.bat2.runs || 0,
            balls: matchState.bat2.balls || 0,
            fours: matchState.bat2.fours || 0,
            sixes: matchState.bat2.sixes || 0,
            isOut: false
        });
    }

    let allBatsmenRuns = 0;
    rows.forEach(r => { const runs = parseInt(r.runs); if (!isNaN(runs)) allBatsmenRuns += runs; });
    const extras = Math.max(0, matchState.runs - allBatsmenRuns);

    const bowlingRows = [];
    const bowlerNames = new Set();

    (matchState.bowlingHistory || []).forEach(b => {
        if (b.name && !bowlerNames.has(b.name)) {
            bowlerNames.add(b.name);
            bowlingRows.push({
                name: b.name,
                overs: b.overs || ballsToOversString(b.balls || 0),
                runs: b.runs || 0,
                wickets: b.wickets || 0,
                balls: b.balls || 0
            });
        }
    });

    if (matchState.bowler.name) {
        const figs = parseBowlerFigures(matchState.bowler.figs);
        const existingIdx = bowlingRows.findIndex(b => b.name === matchState.bowler.name);
        const currentBowlerRecord = {
            name: matchState.bowler.name,
            overs: ballsToOversString(figs.balls),
            runs: figs.runs,
            wickets: figs.wickets,
            balls: figs.balls
        };
        if (existingIdx >= 0) {
            bowlingRows[existingIdx] = currentBowlerRecord;
        } else {
            bowlingRows.push(currentBowlerRecord);
        }
    }

    const cmd = {
        event: 'show_present_details',
        payload: {
            team1Name: matchState.team1?.short_name || 'STC',
            team2Name: matchState.team2?.short_name || 'GSC',
            team1FullName: matchState.team1?.name || 'ST.THOMAS COLLEGE MATALE',
            team2FullName: matchState.team2?.name || 'GOVT.SCIENCE COLLEGE MATALE',
            team1Logo: matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '',
            team2Logo: matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '',
            totalScore: `${matchState.runs}/${matchState.wkts}`,
            overs: matchState.overs,
            extras,
            rows,
            bowlingRows,
            duration: 20000,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        },
        ts: firebase.database.ServerValue.TIMESTAMP
    };
    database.ref(`matches/${matchId}/command`).set(cmd);
    showToast('📋 Battle of Gold Table shown on Scorebar!');
}

// ==========================================
// MATCH END / WINNER CARD (unchanged logic, but tied condition fixed)
// ==========================================
function checkMatchEndAndShowWinner() {
    const target = parseInt(matchState.target) || 0;
    if (target <= 0) return false;
    let matchEnded = false;
    if (matchState.runs >= target) matchEnded = true;
    if (!matchEnded && (matchState.wkts >= 10 || oversToBalls(matchState.overs) >= matchState.totOvers * 6)) {
        if (matchState.runs < target) matchEnded = true;
    }
    if (matchEnded) {
        const delay = (parseInt(animSettings.fourDuration, 10) || 2500) + 1000;
        setTimeout(() => showWinnerCard(), delay);
        return true;
    }
    return false;
}

// ==========================================
// WINDOW EVENTS (with listener cleanup)
// ==========================================
window.addEventListener('beforeunload', () => {
    if (isClearing) return;
    stopPingMonitor(); stopPresenceRefresh();

    // ✅ BUG-008 FIX: Cleanup Firebase listeners using unsubscribe functions
    if (typeof connUnsub === 'function') { connUnsub(); } else if (connListener && database) { database.ref('.info/connected').off('value', connListener); }
    if (typeof presenceUnsub === 'function') { presenceUnsub(); } else if (presenceListener && database) { database.ref(`presence/${matchId}`).off('value', presenceListener); }
    if (typeof scorerUpdateUnsub === 'function') { scorerUpdateUnsub(); } else if (scorerUpdateListener && database) { database.ref(`matches/${matchId}/scorer_update`).off('value', scorerUpdateListener); }
    if (typeof commandUnsub === 'function') { commandUnsub(); } else if (commandListener && database) { database.ref(`matches/${matchId}/command`).off('value', commandListener); }
    if (teamUpdateListener && database) database.ref('data_version/teams').off('value', teamUpdateListener);
    if (updaterSettingsListener && database) database.ref(`matches/${matchId}/updater_settings`).off('value', updaterSettingsListener);

    saveToLocalStorage();
});

// ==========================================
// KEYBOARD SHORTCUTS (unchanged)
// ==========================================
document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const anyModalOpen = document.querySelector('.modal-overlay.show, .popup-overlay.show');
    if (anyModalOpen && e.key !== 'Escape') return;
    // ✅ BUG-015 FIX: Also block shortcuts when custom popups are open
    const fielderPopup = document.getElementById('fielderInputPopup');
    const runOutPopup = document.getElementById('runOutSelectPopup');
    const confirmPopup = document.getElementById('customConfirmPopup');
    const isCustomPopupOpen = (fielderPopup?.classList.contains('show')) ||
        (runOutPopup?.classList.contains('show')) || (confirmPopup?.classList.contains('show'));
    if (isCustomPopupOpen && e.key !== 'Escape') return;
    if (isWicketFlowActive && e.key !== 'Escape') return;

    switch (e.key) {
        case '0': case '.': addBall('0'); break;
        case '1': case '2': case '3': case '4': case '5': case '6': addBall(e.key); break;
        case 'w': case 'W': openWicketPopup(); break;
        case 's': case 'S': swapStriker(); break;
        case 'u': case 'U': undoBall(); break;
        case 'Escape':
            closeTeamSelector(); closePlayerPicker(); closeBowlerPopup();
            closeWicketPopup(); closeNextBatsmanPopup(); closePlayerProfileModal();
            closeAnimationSettings();
            break;
    }
});

// ==========================================
// UPDATER AUTO SETTINGS (unchanged)
// ==========================================
async function syncUpdaterAutoSettings() {
    if (!database || !matchId) return;
    const settings = {
        autoHype: document.getElementById('updaterAutoHypeToggle')?.checked ?? true,
        autoProfile: document.getElementById('updaterAutoProfileToggle')?.checked ?? true,
        autoResult: document.getElementById('updaterAutoResultToggle')?.checked ?? true,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    try {
        await database.ref(`matches/${matchId}/updater_settings`).set(settings);
        showToast('Updater display settings updated');
    } catch (err) { showToast('Failed to save updater settings', 'error'); }
}

function loadUpdaterAutoSettings() {
    if (!database || !matchId) return;
    const ref = database.ref(`matches/${matchId}/updater_settings`);
    if (updaterSettingsListener) ref.off('value', updaterSettingsListener);
    updaterSettingsListener = ref.on('value', (snap) => {
        const settings = snap.val();
        if (!settings) return;
        const hypeToggle = document.getElementById('updaterAutoHypeToggle');
        const profileToggle = document.getElementById('updaterAutoProfileToggle');
        const resultToggle = document.getElementById('updaterAutoResultToggle');
        if (hypeToggle && settings.autoHype !== undefined) hypeToggle.checked = settings.autoHype;
        if (profileToggle && settings.autoProfile !== undefined) profileToggle.checked = settings.autoProfile;
        if (resultToggle && settings.autoResult !== undefined) resultToggle.checked = settings.autoResult;
    });
}

// ==========================================
// INJECT ADMIN POPUP CSS (unchanged - already safe)
// ==========================================
function injectAdminPopupStyles() {
    if (document.getElementById('adminCelebStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminCelebStyle';
    style.textContent = `
/* ===== ADMIN POPUP OVERLAY ===== */
.admin-popup-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    z-index: 99999; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0); backdrop-filter: blur(0px);
    opacity: 0; visibility: hidden;
    transition: all 0.45s cubic-bezier(0.4,0,0.2,1);
}
.admin-popup-overlay.show {
    opacity: 1; visibility: visible;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(12px);
}

/* ===== CARD BASE ===== */
.apc-card {
    background: linear-gradient(165deg, #0f172a 0%, #1e1b2e 50%, #0f172a 100%);
    border: 1px solid rgba(248,180,0,0.15);
    border-radius: 28px; padding: 36px 28px 28px; width: 420px; max-width: 94vw;
    max-height: 92vh; overflow-y: auto; text-align: center;
    box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 120px rgba(248,180,0,0.06);
    transform: scale(0.7) translateY(40px); opacity: 0;
    transition: all 0.5s cubic-bezier(0.34,1.56,0.64,1);
}
.apc-card.pop-in {
    transform: scale(1) translateY(0); opacity: 1;
}
.apc-card.apc-chase {
    border-color: rgba(16,185,129,0.2);
    box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 120px rgba(16,185,129,0.06);
}

/* ===== ICON ===== */
.apc-icon-wrap {
    width: 64px; height: 64px; margin: 0 auto 16px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: rgba(248,180,0,0.08); border: 2px solid rgba(248,180,0,0.15);
    transform: scale(0); opacity: 0;
    transition: all 0.5s cubic-bezier(0.34,1.56,0.64,1);
}
.apc-icon-wrap .apc-icon {
    font-size: 28px; line-height: 1;
}
.apc-icon.pop-in {
    transform: scale(1); opacity: 1;
}
.apc-chase .apc-icon-wrap {
    background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.2);
}

/* ===== TEXT ELEMENTS ===== */
.apc-label {
    font-size: 0.68rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
    color: rgba(255,255,255,0.35); margin-bottom: 8px; opacity: 0; transform: translateY(8px);
    transition: all 0.5s ease;
}
.apc-label.fade-in { opacity: 1; transform: translateY(0); }

.apc-main-text {
    font-size: 1.55rem; font-weight: 900; color: #F8B400; margin-bottom: 6px;
    text-transform: uppercase; letter-spacing: 0.5px;
    opacity: 0; transform: translateY(16px); transition: all 0.55s cubic-bezier(0.34,1.56,0.64,1);
}
.apc-main-text.slide-in { opacity: 1; transform: translateY(0); }

.apc-sub-text {
    font-size: 0.88rem; font-weight: 700; color: rgba(255,255,255,0.55);
    letter-spacing: 1px; margin-bottom: 4px; opacity: 0; transform: translateY(8px);
    transition: all 0.45s ease;
}
.apc-sub-text.fade-in { opacity: 1; transform: translateY(0); }

/* ===== BIG NUMBER (chase) ===== */
.apc-big-number {
    font-size: 4rem; font-weight: 900; color: #10b981; line-height: 1;
    margin: 8px 0; opacity: 0; transform: scale(0.5);
    transition: all 0.55s cubic-bezier(0.34,1.56,0.64,1);
}
.apc-big-number.pop-in { opacity: 1; transform: scale(1); }

/* ===== TEAM LOGOS ===== */
.apc-team-logo {
    width: 60px; height: 60px; border-radius: 50%; overflow: hidden;
    border: 2px solid #F8B400; background: #111; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0;
}
.apc-team-logo img { width: 90%; height: 90%; object-fit: contain; }
.apc-team-logo .apc-team-logo-text {
    font-size: 13px; font-weight: 900; color: #F8B400; display: flex;
    align-items: center; justify-content: center; width: 100%; height: 100%;
}
.apc-team-logo.loser-logo { border-color: rgba(255,255,255,0.2); }
.apc-team-logo.loser-logo .apc-team-logo-text { color: rgba(255,255,255,0.3); }

/* ===== SCORE PILL ===== */
.apc-score-pill {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px; padding: 14px 20px; margin: 0 auto;
    opacity: 0; transform: scale(0.7); transition: all 0.5s cubic-bezier(0.34,1.56,0.64,1);
    max-width: 280px;
}
.apc-score-pill.pop-in { opacity: 1; transform: scale(1); }
.apc-score-inner { display: flex; align-items: center; justify-content: center; gap: 14px; }
.apc-score-num { font-size: 1.6rem; font-weight: 900; color: #F8B400; }
.apc-score-detail { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.apc-score-meta { font-size: 0.62rem; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 1px; }
.apc-score-crr { font-size: 0.58rem; font-weight: 700; color: rgba(248,180,0,0.5); }

/* ===== DIVIDER ===== */
.apc-divider {
    width: 50px; height: 2px; margin: 18px auto;
    background: linear-gradient(90deg, transparent, rgba(248,180,0,0.3), transparent);
    opacity: 0; transition: opacity 0.5s ease;
}
.apc-divider.fade-in { opacity: 1; }

/* ===== STATS ===== */
.apc-stats {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    margin: 0 4px; opacity: 0; transform: translateY(16px);
    transition: all 0.55s ease;
}
.apc-stats.slide-in { opacity: 1; transform: translateY(0); }
.apc-stat-card {
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
    border-radius: 14px; padding: 12px; text-align: left;
}
.apc-stat-title {
    font-size: 0.6rem; font-weight: 800; color: rgba(255,255,255,0.3);
    letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;
}
.apc-stat-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.03);
}
.apc-stat-row:last-child { border-bottom: none; }
.apc-stat-player {
    font-size: 0.72rem; font-weight: 600; color: rgba(255,255,255,0.65);
    display: flex; align-items: center; gap: 4px;
}
.apc-stat-val { font-size: 0.82rem; font-weight: 900; color: #F8B400; }
.apc-stat-sub { font-size: 0.58rem; color: rgba(255,255,255,0.3); margin-left: 3px; }
.apc-not-out {
    font-size: 0.55rem; color: #10b981; font-weight: 900;
}

/* ===== CHASE INFO ===== */
.apc-chase-info {
    background: rgba(16,185,129,0.03); border: 1px solid rgba(16,185,129,0.1);
    border-radius: 14px; padding: 12px 16px; margin-top: 14px;
    opacity: 0; transform: translateY(16px); transition: all 0.55s ease;
}
.apc-chase-info.slide-in { opacity: 1; transform: translateY(0); }
.apc-chase-info-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 5px 0; border-bottom: 1px solid rgba(16,185,129,0.06);
}
.apc-chase-info-row:last-child { border-bottom: none; }
.apc-chase-info-label { font-size: 0.68rem; font-weight: 600; color: rgba(255,255,255,0.4); }
.apc-chase-info-val { font-size: 0.72rem; font-weight: 800; color: #10b981; }

/* ===== ACTIONS ===== */
.apc-actions {
    display: flex; gap: 10px; justify-content: center; margin-top: 22px;
    opacity: 0; transform: translateY(8px); transition: all 0.45s ease;
}
.apc-actions.fade-in { opacity: 1; transform: translateY(0); }
.apc-btn-close {
    padding: 10px 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5);
    font-size: 0.75rem; font-weight: 700; cursor: pointer;
    transition: all 0.25s ease;
}
.apc-btn-close:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
.apc-btn-action {
    padding: 10px 22px; border-radius: 12px; border: none;
    background: linear-gradient(135deg, #F8B400, #e6a200); color: #0f172a;
    font-size: 0.78rem; font-weight: 900; cursor: pointer;
    transition: all 0.25s ease; letter-spacing: 0.5px;
}
.apc-btn-action:hover { transform: scale(1.04); box-shadow: 0 4px 20px rgba(248,180,0,0.3); }
.apc-btn-action.chase-action {
    background: linear-gradient(135deg, #10b981, #059669); color: #fff;
}
.apc-btn-action.chase-action:hover { box-shadow: 0 4px 20px rgba(16,185,129,0.3); }

/* ===== CONFETTI PARTICLES ===== */
.apc-particle {
    position: fixed; top: -20px; z-index: 100000; pointer-events: none;
    animation: apc-fall linear forwards;
}
@keyframes apc-fall {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
}

/* ===== CONFETTI RINGS ===== */
.apc-ring {
    position: fixed; z-index: 99998; pointer-events: none;
    border-radius: 50%; border: 3px solid;
    animation: apc-ring-expand 1.2s ease-out forwards;
}
@keyframes apc-ring-expand {
    0% { transform: scale(0); opacity: 0.8; }
    100% { transform: scale(3.5); opacity: 0; }
}

/* ===== ANIMATION KEYFRAMES ===== */
@keyframes apcPopIn {
    0% { transform: scale(0); opacity: 0; }
    70% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
}
@keyframes apcFadeIn {
    0% { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: translateY(0); }
}
@keyframes apcSlideIn {
    0% { opacity: 0; transform: translateY(16px); }
    100% { opacity: 1; transform: translateY(0); }
}

/* ===== SCROLLBAR ===== */
.apc-card::-webkit-scrollbar { width: 4px; }
.apc-card::-webkit-scrollbar-track { background: transparent; }
.apc-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
`;
    document.head.appendChild(style);
}

// ==========================================
// ESCAPE HTML (SAFE)
// ==========================================
function escapeAdminPopupHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// CONFETTI LAUNCHER (unchanged)
// ==========================================
function adminLaunchConfetti(count = 50, colors = null) {
    const defaultColors = ['#F8B400', '#FFD700', '#fff', '#86efac', '#fca5a5', '#93c5fd'];
    const cols = colors || defaultColors;
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const p = document.createElement('div');
            p.className = 'apc-particle';
            const color = cols[Math.floor(Math.random() * cols.length)];
            const size = Math.random() * 10 + 5;
            const startX = Math.random() * window.innerWidth;
            const duration = Math.random() * 2 + 1.5;
            const delay = Math.random() * 0.8;
            const isCircle = Math.random() > 0.6;
            p.style.cssText = `
                left:${startX}px; top:-20px;
                width:${isCircle ? size : size * 1.8}px;
                height:${size}px;
                background:${color};
                border-radius:${isCircle ? '50%' : '2px'};
                animation-duration:${duration}s;
                animation-delay:${delay}s;
            `;
            document.body.appendChild(p);
            setTimeout(() => p.remove(), (duration + delay + 0.5) * 1000);
        }, i * 28);
    }
}

function adminLaunchRings(count = 4, color = null) {
    const cols = color ? [color] : ['#F8B400', '#fff', '#86efac'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const ring = document.createElement('div');
            ring.className = 'apc-ring' + (color === '#10b981' ? ' chase-ring' : '');
            const size = Math.random() * 40 + 20;
            const x = Math.random() * window.innerWidth;
            const y = Math.random() * (window.innerHeight * 0.65);
            const c = cols[Math.floor(Math.random() * cols.length)];
            ring.style.cssText = `
                left:${x}px; top:${y}px;
                width:${size}px; height:${size}px;
                margin-left:-${size / 2}px; margin-top:-${size / 2}px;
                border-color:${c};
                animation-duration:${0.65 + Math.random() * 0.45}s;
            `;
            document.body.appendChild(ring);
            setTimeout(() => ring.remove(), 1400);
        }, i * 180);
    }
}

// ==========================================
// 🏆 SHOW ADMIN WINNER POPUP (unchanged - already XSS safe)
// ==========================================
function showAdminWinnerPopup(winnerData) {
    injectAdminPopupStyles();
    const old = document.getElementById('adminWinnerPopup');
    if (old) old.remove();

    const {
        winnerTeamName = '', winnerShortName = '', winnerLogo = '',
        loserTeamName = '', loserShortName = '', loserLogo = '',
        marginText = '', resultLine = '', score = '0/0',
        overs = '0.0', crr = '0.00',
        topBatsmen = [], topBowlers = [], isTied = false
    } = winnerData;

    const mainColor = isTied ? '#93c5fd' : '#F8B400';
    const trophyEmoji = isTied ? '🤝' : '🏆';

    function buildLogoHtml(logoSrc, shortName, size = 60, color = '#F8B400') {
        const isWinner = color === '#F8B400' || color === '#F8B400';
        const logoClass = isWinner ? 'apc-team-logo' : 'apc-team-logo loser-logo';
        const safeShort = escapeAdminPopupHtml(shortName.slice(0, 3));
        if (logoSrc && logoSrc.length > 10) {
            return `<div class="${logoClass}">
                <img src="${escapeAdminPopupHtml(logoSrc)}" alt="${safeShort}" data-fallback-text="${safeShort}">
                <span class="apc-team-logo-text" style="display:none;">${safeShort}</span>
            </div>`;
        }
        return `<div class="${logoClass}">
            <span class="apc-team-logo-text">${safeShort}</span>
        </div>`;
    }

    function buildBatsmenRows(list) {
        if (!list || list.length === 0) return `<div class="apc-stat-row"><span class="apc-stat-player" style="color:rgba(255,255,255,0.3)">No data</span></div>`;
        return list.map(b => `
            <div class="apc-stat-row">
                <span class="apc-stat-player">
                   ${escapeAdminPopupHtml(b.name)}
                   ${!b.isOut ? '<span class="apc-not-out">★</span>' : ''}
                </span>
                <div>
                    <span class="apc-stat-val" style="color:${mainColor}">${b.runs}</span>
                    <span class="apc-stat-sub">(${b.balls}b)</span>
                </div>
            </div>`).join('');
    }

    function buildBowlersRows(list) {
        if (!list || list.length === 0) return `<div class="apc-stat-row"><span class="apc-stat-player" style="color:rgba(255,255,255,0.3)">No data</span></div>`;
        return list.map(b => `
            <div class="apc-stat-row">
                <span class="apc-stat-player">${escapeAdminPopupHtml(b.name)}</span>
                <div>
                    <span class="apc-stat-val" style="color:${mainColor}">${b.wickets}/${b.runs}</span>
                    <span class="apc-stat-sub">(${b.overs})</span>
                </div>
            </div>`).join('');
    }

    const vsSection = !isTied ? `
        <div style="display:flex; align-items:center; justify-content:center; gap:20px; margin:0 24px 0; padding:16px 20px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:18px; opacity:0; transform:translateY(12px); transition:all 0.5s ease 0.72s;" id="adminWinVsSection">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
               ${buildLogoHtml(winnerLogo, winnerShortName, 60, mainColor)}
                <span style="font-size:0.78rem;font-weight:900;color:${mainColor};text-align:center;text-transform:uppercase;letter-spacing:0.5px;">${escapeAdminPopupHtml(winnerShortName)}</span>
                <span style="font-size:0.6rem;font-weight:800;color:rgba(248,180,0,0.7);background:rgba(248,180,0,0.1);padding:3px 8px;border-radius:6px;letter-spacing:1px;">WINNER</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:1rem;font-weight:900;color:rgba(255,255,255,0.25);">VS</span></div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
               ${buildLogoHtml(loserLogo, loserShortName, 60, 'rgba(255,255,255,0.3)')}
                <span style="font-size:0.78rem;font-weight:900;color:rgba(255,255,255,0.45);text-align:center;text-transform:uppercase;letter-spacing:0.5px;">${escapeAdminPopupHtml(loserShortName)}</span>
                <span style="font-size:0.6rem;font-weight:800;color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:6px;letter-spacing:1px;">RUNNER UP</span>
            </div>
        </div>
    ` : `
        <div style="display:flex; align-items:center; justify-content:center; gap:20px; margin:0 24px 0; padding:16px 20px; background:rgba(147,197,253,0.04); border:1px solid rgba(147,197,253,0.15); border-radius:18px; opacity:0; transform:translateY(12px); transition:all 0.5s ease 0.72s;" id="adminWinVsSection">
            <span style="font-size:1rem;font-weight:900;color:rgba(147,197,253,0.7);text-align:center;">🤝 Both teams gave their best!</span>
        </div>
    `;

    const popup = document.createElement('div');
    popup.id = 'adminWinnerPopup';
    popup.className = 'admin-popup-overlay';
    popup.innerHTML = `
        <div class="apc-card apc-winner">
            <div class="apc-icon-wrap"><span class="apc-icon" id="adminWinIcon">${trophyEmoji}</span></div>
            <div class="apc-label" id="adminWinLabel">Match Result</div>
            <div class="apc-main-text" id="adminWinName" style="color:${mainColor};">${escapeAdminPopupHtml(winnerTeamName)}</div>
            <div class="apc-sub-text" id="adminWinMargin">${escapeAdminPopupHtml(marginText)}</div>
            ${vsSection}
            <div class="apc-score-pill" id="adminWinPill" style="margin-top:16px;">
                <div class="apc-score-inner"><div class="apc-score-num" style="color:${mainColor}">${escapeAdminPopupHtml(score)}</div><div class="apc-score-detail"><span class="apc-score-meta">${escapeAdminPopupHtml(overs)} OVERS</span><span class="apc-score-crr" style="color:${isTied ? 'rgba(147,197,253,0.7)' : 'rgba(248,180,0,0.7)'}">CRR ${escapeAdminPopupHtml(String(crr))}</span></div></div>
            </div>
            <div class="apc-divider" id="adminWinDivider"></div>
            <div class="apc-stats" id="adminWinStats">
                <div class="apc-stat-card"><div class="apc-stat-title">🏏 Top Batsmen</div>${buildBatsmenRows(topBatsmen)}</div>
                <div class="apc-stat-card"><div class="apc-stat-title">🎯 Top Bowlers</div>${buildBowlersRows(topBowlers)}</div>
            </div>
            <div class="apc-actions" id="adminWinActions"><button class="apc-btn-close" onclick="closeAdminWinnerPopup()">✕ Close</button><button class="apc-btn-action" onclick="adminWinCelebrate()">${isTied ? '🤝 It\'s a Tie!' : '🎉 Celebrate!'}</button></div>
        </div>
    `;
    document.body.appendChild(popup);

    popup.querySelectorAll('img[data-fallback-text]').forEach(img => {
        img.addEventListener('error', function () {
            this.style.display = 'none';
            const fallbackSpan = this.nextElementSibling;
            if (fallbackSpan && fallbackSpan.classList.contains('apc-team-logo-text')) {
                fallbackSpan.style.display = 'flex';
            }
        }, { once: true });
    });

    requestAnimationFrame(() => {
        popup.classList.add('show');
        setTimeout(() => popup.querySelector('.apc-card')?.classList.add('pop-in'), 50);
        setTimeout(() => popup.querySelector('.apc-icon')?.classList.add('pop-in'), 300);
        setTimeout(() => { popup.querySelector('.apc-label')?.classList.add('fade-in'); popup.querySelector('.apc-main-text')?.classList.add('slide-in'); }, 450);
        setTimeout(() => popup.querySelector('.apc-sub-text')?.classList.add('fade-in'), 640);
        setTimeout(() => { const vs = document.getElementById('adminWinVsSection'); if (vs) { vs.style.opacity = '1'; vs.style.transform = 'translateY(0)'; } }, 720);
        setTimeout(() => popup.querySelector('.apc-score-pill')?.classList.add('pop-in'), 900);
        setTimeout(() => { popup.querySelector('.apc-divider')?.classList.add('fade-in'); popup.querySelector('.apc-stats')?.classList.add('slide-in'); }, 1050);
        setTimeout(() => popup.querySelector('.apc-actions')?.classList.add('fade-in'), 1300);
        setTimeout(() => { adminLaunchConfetti(55, isTied ? ['#93c5fd', '#fff', '#F8B400'] : null); adminLaunchRings(4); }, 350);
        if (adminWinnerPopupTimer) clearTimeout(adminWinnerPopupTimer);
        adminWinnerPopupTimer = setTimeout(() => closeAdminWinnerPopup(), 35000);
    });
    showToast('🏆 Winner Card shown!');
}

let adminWinnerPopupTimer = null;
let adminChasePopupTimer = null;

function closeAdminWinnerPopup() {
    if (adminWinnerPopupTimer) { clearTimeout(adminWinnerPopupTimer); adminWinnerPopupTimer = null; }
    const popup = document.getElementById('adminWinnerPopup');
    if (!popup) return;
    popup.querySelector('.apc-card')?.classList.remove('pop-in');
    setTimeout(() => { popup.classList.remove('show'); setTimeout(() => popup.remove(), 400); }, 350);
}

function adminWinCelebrate() {
    adminLaunchConfetti(90);
    adminLaunchRings(7);
    showToast('🎉 Celebrating!');
}

// ==========================================
// 🎯 SHOW ADMIN CHASE START POPUP (FIXED XSS)
// ==========================================
function showAdminChasePopup(chaseData) {
    injectAdminPopupStyles();

    const old = document.getElementById('adminChasePopup');
    if (old) old.remove();

    const {
        target = 0,
        battingTeam = '',
        battingTeamFull = '',
        battingTeamLogo = '',
        bowlingTeam = '',
        bowlingTeamFull = '',
        bowlingTeamLogo = '',
        firstInningsScore = '',
        firstInningsOvers = '',
        totOvers = 20
    } = chaseData;

    const rrr = totOvers > 0 ? (target / totOvers).toFixed(2) : '0.00';

    // ✅ FIXED: No inline onerror - using data-fallback-text and event listener
    function buildChaseLogoHtml(logoSrc, shortName, isChasing = false) {
        const color = isChasing ? '#10b981' : 'rgba(255,255,255,0.3)';
        const size = 56;
        const safeShort = escapeAdminPopupHtml(shortName.slice(0, 3));
        if (logoSrc && logoSrc.length > 10) {
            return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;border:2px solid ${color};background:#111;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <img src="${escapeAdminPopupHtml(logoSrc)}" style="width:90%;height:90%;object-fit:contain;" data-fallback-text="${safeShort}">
                <span class="apc-team-logo-text" style="display:none;">${safeShort}</span>
            </div>`;
        }
        return `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${color};background:rgba(${isChasing ? '16,185,129' : '255,255,255'},0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:900;color:${color};">${safeShort}</div>`;
    }

    const popup = document.createElement('div');
    popup.id = 'adminChasePopup';
    popup.className = 'admin-popup-overlay';
    popup.innerHTML = `
        <div class="apc-card apc-chase">
            <div class="apc-icon-wrap"><span class="apc-icon chase-icon" id="adminChaseIcon">🎯</span></div>
            <div class="apc-label" id="adminChaseLabel">Chase Started</div>
            <div class="apc-big-number" id="adminChaseTarget">${escapeAdminPopupHtml(String(target))}</div>
            <div style="text-align:center;font-size:0.7rem;font-weight:800;color:rgba(16,185,129,0.6);letter-spacing:3px;margin-top:4px;opacity:0;transition:opacity 0.4s ease 0.75s;" id="adminChaseToWin">RUNS TO WIN</div>
            <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin:18px 24px 0; padding:16px 20px; background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:18px; opacity:0; transform:translateY(12px); transition:all 0.5s ease 0.85s;" id="adminChaseTeamsSection">
                <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;">
                    ${buildChaseLogoHtml(bowlingTeamLogo, bowlingTeam, false)}
                    <span style="font-size:0.75rem;font-weight:900;color:rgba(255,255,255,0.45);text-transform:uppercase;text-align:center;">${escapeAdminPopupHtml(bowlingTeam)}</span>
                    <span style="font-size:0.85rem;font-weight:900;color:rgba(255,255,255,0.6);">${escapeAdminPopupHtml(firstInningsScore)}</span>
                    <span style="font-size:0.58rem;color:rgba(255,255,255,0.3);font-weight:700;">1ST INNINGS</span>
                </div>
                <div style="font-size:1.4rem;color:rgba(16,185,129,0.5);">→</div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;">
                    ${buildChaseLogoHtml(battingTeamLogo, battingTeam, true)}
                    <span style="font-size:0.75rem;font-weight:900;color:#10b981;text-transform:uppercase;text-align:center;">${escapeAdminPopupHtml(battingTeam)}</span>
                    <span style="font-size:0.85rem;font-weight:900;color:#10b981;">${escapeAdminPopupHtml(String(target))} needed</span>
                    <span style="font-size:0.58rem;color:rgba(16,185,129,0.6);font-weight:800;background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:6px;">CHASING</span>
                </div>
            </div>
            <div class="apc-chase-info" id="adminChaseInfo" style="margin-top:14px;">
                <div class="apc-chase-info-row"><span class="apc-chase-info-label">🎯 Target</span><span class="apc-chase-info-val">${escapeAdminPopupHtml(String(target))} runs</span></div>
                <div class="apc-chase-info-row"><span class="apc-chase-info-label">⏱️ Overs</span><span class="apc-chase-info-val">${escapeAdminPopupHtml(String(totOvers))} overs</span></div>
                <div class="apc-chase-info-row"><span class="apc-chase-info-label">📈 Required RR</span><span class="apc-chase-info-val">${escapeAdminPopupHtml(rrr)} per over</span></div>
                <div class="apc-chase-info-row"><span class="apc-chase-info-label">🏏 1st Innings</span><span class="apc-chase-info-val">${escapeAdminPopupHtml(firstInningsScore)} (${escapeAdminPopupHtml(firstInningsOvers)} ov)</span></div>
            </div>
            <div class="apc-actions" id="adminChaseActions">
                <button class="apc-btn-close" onclick="closeAdminChasePopup()">✕ Close</button>
                <button class="apc-btn-action chase-action" onclick="closeAdminChasePopup(); sendLiveData();">🏏 Start Scoring!</button>
            </div>
        </div>
    `;
    document.body.appendChild(popup);

    // ✅ Add fallback for images
    popup.querySelectorAll('img[data-fallback-text]').forEach(img => {
        img.addEventListener('error', function () {
            this.style.display = 'none';
            const fallbackSpan = this.nextElementSibling;
            if (fallbackSpan && fallbackSpan.classList.contains('apc-team-logo-text')) {
                fallbackSpan.style.display = 'flex';
            }
        }, { once: true });
    });

    requestAnimationFrame(() => {
        popup.classList.add('show');
        setTimeout(() => popup.querySelector('.apc-card')?.classList.add('pop-in'), 50);
        setTimeout(() => popup.querySelector('.apc-icon')?.classList.add('pop-in'), 300);
        setTimeout(() => { popup.querySelector('.apc-label')?.classList.add('fade-in'); popup.querySelector('.apc-big-number')?.classList.add('pop-in'); }, 440);
        setTimeout(() => { const toWin = document.getElementById('adminChaseToWin'); if (toWin) toWin.style.opacity = '1'; }, 640);
        setTimeout(() => { const teams = document.getElementById('adminChaseTeamsSection'); if (teams) { teams.style.opacity = '1'; teams.style.transform = 'translateY(0)'; } }, 850);
        setTimeout(() => popup.querySelector('.apc-chase-info')?.classList.add('slide-in'), 1000);
        setTimeout(() => popup.querySelector('.apc-actions')?.classList.add('fade-in'), 1200);
        setTimeout(() => { adminLaunchConfetti(40, ['#10b981', '#34d399', '#fff', '#F8B400', '#86efac']); adminLaunchRings(3, '#10b981'); }, 380);
        if (adminChasePopupTimer) clearTimeout(adminChasePopupTimer);
        adminChasePopupTimer = setTimeout(() => closeAdminChasePopup(), 25000);
    });
    showToast('🎯 Chase Started!');
}

function closeAdminChasePopup() {
    if (adminChasePopupTimer) { clearTimeout(adminChasePopupTimer); adminChasePopupTimer = null; }
    const popup = document.getElementById('adminChasePopup');
    if (!popup) return;
    popup.querySelector('.apc-card')?.classList.remove('pop-in');
    setTimeout(() => { popup.classList.remove('show'); setTimeout(() => popup.remove(), 400); }, 350);
}

// ==========================================
// showWinnerCard (with tied condition fix)
// ==========================================
function showWinnerCard() {
    if (!database || !matchId) {
        showToast('Database not connected', 'error');
        return;
    }

    updateMatchState();

    let winnerTeamName = '';
    let winnerShortName = '';
    let winnerLogo = '';
    let loserTeamName = '';
    let loserShortName = '';
    let loserLogo = '';
    let marginText = '';
    let resultLine = '';
    let isTied = false;

    const target = parseInt(matchState.target) || 0;
    const runs = matchState.runs;
    const wkts = matchState.wkts;
    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;

    if (target > 0 && runs >= target) {
        // Chasing team won
        winnerShortName = matchState.batFlag;
        loserShortName = matchState.bowlFlag;
        if (matchState.battingSide === 1) {
            winnerTeamName = matchState.team1?.name || winnerShortName;
            winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
            loserTeamName = matchState.team2?.name || loserShortName;
            loserLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
        } else {
            winnerTeamName = matchState.team2?.name || winnerShortName;
            winnerLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
            loserTeamName = matchState.team1?.name || loserShortName;
            loserLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
        }
        const wktsLeft = Math.max(0, 10 - wkts);
        marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
        resultLine = `${runs}/${wkts} in ${matchState.overs} overs`;
    } else if (target > 1 && runs === target - 1 && (wkts >= 10 || ballsBowled >= maxBalls)) {
        // ✅ Fixed: Tied match only if target > 1 (target=1 can't be tied)
        isTied = true;
        winnerTeamName = 'MATCH TIED';
        winnerShortName = '';
        winnerLogo = '';
        loserTeamName = '';
        loserShortName = '';
        loserLogo = '';
        marginText = 'MATCH TIED';
        resultLine = `Both teams scored ${runs} runs`;
    } else if (target > 0 && (wkts >= 10 || ballsBowled >= maxBalls)) {
        // Bowling/defending team won
        winnerShortName = matchState.bowlFlag;
        loserShortName = matchState.batFlag;
        if (matchState.battingSide === 1) {
            winnerTeamName = matchState.team2?.name || winnerShortName;
            winnerLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
            loserTeamName = matchState.team1?.name || loserShortName;
            loserLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
        } else {
            winnerTeamName = matchState.team1?.name || winnerShortName;
            winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
            loserTeamName = matchState.team2?.name || loserShortName;
            loserLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
        }
        const runsMargin = Math.max(1, (target - 1) - runs);
        marginText = `WON BY ${runsMargin} RUN${runsMargin === 1 ? '' : 'S'}`;
        resultLine = `Defended ${target - 1} • ${loserShortName} ${runs}/${wkts}`;
    } else {
        showToast('Match is still in progress', 'error');
        return;
    }

    const balls = oversToBalls(matchState.overs);
    // [Fix #1 & #2] Use ballsToExactOvers for CRR rate calc
    const crr = balls > 0 ? (runs / ballsToExactOvers(balls)).toFixed(2) : '0.00';

    const allBatsmen = [];
    const dismissedNames = new Set();
    (matchState.dismissedPlayers || []).forEach(p => {
        if (typeof p === 'object' && p.name) {
            dismissedNames.add(p.name);
            allBatsmen.push({
                name: p.name, runs: p.runs || 0, balls: p.balls || 0,
                fours: p.fours || 0, sixes: p.sixes || 0, isOut: true
            });
        }
    });
    if (matchState.bat1.name && !matchState.bat1.isOut && !dismissedNames.has(matchState.bat1.name)) {
        allBatsmen.push({ ...matchState.bat1, isOut: false });
    }
    if (matchState.bat2.name && !matchState.bat2.isOut && !dismissedNames.has(matchState.bat2.name)) {
        allBatsmen.push({ ...matchState.bat2, isOut: false });
    }
    const topBatsmen = allBatsmen.sort((a, b) => (b.runs || 0) - (a.runs || 0)).slice(0, 3);

    const allBowlers = [...(matchState.bowlingHistory || [])];
    if (matchState.bowler.name) {
        const figs = parseBowlerFigures(matchState.bowler.figs);
        const currentRecord = {
            name: matchState.bowler.name, wickets: figs.wickets, runs: figs.runs,
            overs: ballsToOversString(figs.balls), balls: figs.balls
        };
        const existingIdx = allBowlers.findIndex(b => b.name === matchState.bowler.name);
        if (existingIdx >= 0) allBowlers[existingIdx] = currentRecord;
        else allBowlers.push(currentRecord);
    }
    const sortedBowlers = allBowlers.sort((a, b) => (b.wickets || 0) - (a.wickets || 0)).slice(0, 3).map(b => ({
        name: b.name, wickets: b.wickets || 0, runs: b.runs || 0, overs: b.overs || ballsToOversString(b.balls || 0)
    }));

    const cmd = {
        event: 'show_winner_card',
        payload: {
            winnerTeamName, winnerShortName, winnerLogo, loserTeamName, loserShortName, loserLogo,
            marginText, resultLine, score: `${runs}/${wkts}`, overs: matchState.overs, crr,
            topBatsmen, topBowlers: sortedBowlers, duration: 18000,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        },
        ts: firebase.database.ServerValue.TIMESTAMP
    };
    database.ref(`matches/${matchId}/command`).set(cmd);

    const scorerPopupData = {
        winnerTeamName, winnerShortName, winnerLogo, loserTeamName, loserShortName, loserLogo,
        marginText, resultLine, score: `${runs}/${wkts}`, overs: matchState.overs, crr,
        topBatsmen, topBowlers: sortedBowlers, isTied
    };
    sendCommand('show_scorer_winner_popup', scorerPopupData);
    showAdminWinnerPopup(scorerPopupData);

    // ✅ SUPABASE WIN DUAL-WRITE: Update matchState.status with result text and push to Supabase
    // This ensures the Spector site receives the win result via Supabase
    const resultText = isTied
        ? 'Match Tied'
        : `${winnerTeamName} won by ${marginText.replace('WON BY ', '')}`;
    matchState.status = 'MATCH ENDED';
    // Store the result text in a special field that buildSupabasePayload can read
    matchState._resultText = resultText;
    sendLiveData();
    showToast('🏆 Winner Card shown on Scorebar!');
}

// ==========================================
// 🏏 MATCH SCORECARD (unchanged)
// ==========================================
let isScorecardLoading = false;
async function showMatchScorecardCard() {
    if (isScorecardLoading) { showToast('Loading scorecard...', 'error'); return; }
    if (!database || !matchId) { showToast('Database not connected', 'error'); return; }
    isScorecardLoading = true;
    showToast('Loading match scorecard...');
    try {
        updateMatchState();
        const firstBatTeam = matchState.battingSide === 2 ? matchState.team1 : matchState.team2;
        const secondBatTeam = matchState.battingSide === 2 ? matchState.team2 : matchState.team1;
        const firstBatFlag = matchState.battingSide === 2 ? (matchState.team1?.short_name || 'T1') : (matchState.team2?.short_name || 'T2');
        const secondBatFlag = matchState.batFlag;
        const firstBatLogo = matchState.battingSide === 2 ? (matchState.t1Logo || matchState.team1?.logo_url || '') : (matchState.t2Logo || matchState.team2?.logo_url || '');
        const secondBatLogo = matchState.battingSide === 2 ? (matchState.t2Logo || matchState.team2?.logo_url || '') : (matchState.t1Logo || matchState.team1?.logo_url || '');

        const secondInningsBatting = [];
        const dismissed2ndNames = new Set();
        (matchState.dismissedPlayers || []).forEach(p => {
            if (typeof p === 'object' && p.name) {
                secondInningsBatting.push({ name: p.name, dismissal: p.dismissal || 'OUT', bowler: p.bowler || '-', fielder: p.fielder || '-', runs: p.runs ?? 0, balls: p.balls ?? 0, fours: p.fours ?? 0, sixes: p.sixes ?? 0, isOut: true });
                dismissed2ndNames.add(p.name);
            } else if (typeof p === 'string') {
                secondInningsBatting.push({ name: p, dismissal: 'OUT', bowler: '-', fielder: '-', runs: 0, balls: 0, fours: 0, sixes: 0, isOut: true });
                dismissed2ndNames.add(p);
            }
        });
        if (matchState.bat1.name && !matchState.bat1.isOut && !dismissed2ndNames.has(matchState.bat1.name)) {
            secondInningsBatting.push({ name: matchState.bat1.name, dismissal: 'NOT OUT', bowler: matchState.bowler.name || '-', fielder: '-', runs: matchState.bat1.runs || 0, balls: matchState.bat1.balls || 0, fours: matchState.bat1.fours || 0, sixes: matchState.bat1.sixes || 0, isOut: false });
        }
        if (matchState.bat2.name && !matchState.bat2.isOut && !dismissed2ndNames.has(matchState.bat2.name)) {
            secondInningsBatting.push({ name: matchState.bat2.name, dismissal: 'NOT OUT', bowler: matchState.bowler.name || '-', fielder: '-', runs: matchState.bat2.runs || 0, balls: matchState.bat2.balls || 0, fours: matchState.bat2.fours || 0, sixes: matchState.bat2.sixes || 0, isOut: false });
        }
        let secondBatsmenRuns = 0;
        secondInningsBatting.forEach(r => { secondBatsmenRuns += (parseInt(r.runs) || 0); });
        const secondExtras = Math.max(0, matchState.runs - secondBatsmenRuns);

        const snap = await database.ref(`matches/${matchId}/first_innings`).once('value');
        const firstInningsData = snap.val();
        let firstInningsBatting = [], firstInningsBowling = [], firstExtras = 0, actualFirstScore = '---', actualFirstOvers = '---';
        if (firstInningsData && firstInningsData.batting) {
            firstInningsBatting = firstInningsData.batting;
            firstInningsBowling = firstInningsData.bowling || [];
            firstExtras = firstInningsData.extras || 0;
            actualFirstScore = firstInningsData.score || `${(matchState.target || 1) - 1}/?`;
            actualFirstOvers = firstInningsData.overs || '?';
        } else {
            actualFirstScore = matchState.target > 0 ? `${matchState.target - 1}/?` : '---';
            actualFirstOvers = '---';
            console.warn('⚠️ First innings data not found');
        }

        const secondInningsBowling = [];
        const bowlerNamesUsed = new Set();
        (matchState.bowlingHistory || []).forEach(b => {
            if (b.name && !bowlerNamesUsed.has(b.name)) {
                bowlerNamesUsed.add(b.name);
                secondInningsBowling.push({ name: b.name, overs: b.overs || ballsToOversString(b.balls || 0), runs: b.runs || 0, wickets: b.wickets || 0, balls: b.balls || 0 });
            }
        });
        if (matchState.bowler.name) {
            const figs = parseBowlerFigures(matchState.bowler.figs);
            const currentBowlerRecord = { name: matchState.bowler.name, overs: ballsToOversString(figs.balls), runs: figs.runs, wickets: figs.wickets, balls: figs.balls };
            const idx = secondInningsBowling.findIndex(b => b.name === matchState.bowler.name);
            if (idx >= 0) secondInningsBowling[idx] = currentBowlerRecord;
            else secondInningsBowling.push(currentBowlerRecord);
        }

        let resultText = 'MATCH IN PROGRESS';
        const target = parseInt(matchState.target) || 0;
        if (target > 0 && matchState.runs >= target) {
            const wktsLeft = Math.max(0, 10 - matchState.wkts);
            resultText = `${secondBatFlag} WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
        } else if (target > 0 && matchState.runs === target - 1 && (matchState.wkts >= 10 || oversToBalls(matchState.overs) >= matchState.totOvers * 6)) {
            resultText = 'MATCH TIED';
        } else if (target > 0 && (matchState.wkts >= 10 || oversToBalls(matchState.overs) >= matchState.totOvers * 6)) {
            const runsMargin = Math.max(1, target - 1 - matchState.runs);
            resultText = `${firstBatFlag} WON BY ${runsMargin} RUN${runsMargin === 1 ? '' : 'S'}`;
        }

        const allBatsmenForTop = [];
        firstInningsBatting.forEach(b => { allBatsmenForTop.push({ name: b.name, team: firstBatFlag, runs: parseInt(b.runs) || 0, balls: parseInt(b.balls) || 0, fours: parseInt(b.fours) || 0, sixes: parseInt(b.sixes) || 0, isOut: b.isOut }); });
        secondInningsBatting.forEach(b => { allBatsmenForTop.push({ name: b.name, team: secondBatFlag, runs: parseInt(b.runs) || 0, balls: parseInt(b.balls) || 0, fours: parseInt(b.fours) || 0, sixes: parseInt(b.sixes) || 0, isOut: b.isOut }); });
        const topBatsmen = allBatsmenForTop.filter(b => (parseInt(b.runs) || 0) > 0).sort((a, b) => (b.runs || 0) - (a.runs || 0)).slice(0, 3);

        const allBowlersForTop = [];
        const topBowlerNames = new Set();
        firstInningsBowling.forEach(b => {
            if (b.name && !topBowlerNames.has(b.name)) {
                topBowlerNames.add(b.name);
                allBowlersForTop.push({ name: b.name, team: matchState.battingSide === 2 ? (matchState.team2?.short_name || 'T2') : (matchState.team1?.short_name || 'T1'), wickets: b.wickets || 0, runs: b.runs || 0, overs: b.overs || ballsToOversString(b.balls || 0) });
            }
        });
        secondInningsBowling.forEach(b => {
            if (b.name && !topBowlerNames.has(b.name)) {
                topBowlerNames.add(b.name);
                allBowlersForTop.push({ name: b.name, team: matchState.bowlFlag, wickets: b.wickets || 0, runs: b.runs || 0, overs: b.overs || ballsToOversString(b.balls || 0) });
            }
        });
        const topBowlers = allBowlersForTop.sort((a, b) => (b.wickets || 0) - (a.wickets || 0)).slice(0, 3);

        const cmd = {
            event: 'show_match_scorecard',
            payload: {
                resultText,
                team1: { shortName: firstBatFlag, fullName: firstBatTeam?.name || firstBatFlag, logo: firstBatLogo, score: actualFirstScore, overs: actualFirstOvers, extras: firstExtras, batting: firstInningsBatting, bowling: firstInningsBowling },
                team2: { shortName: secondBatFlag, fullName: secondBatTeam?.name || secondBatFlag, logo: secondBatLogo, score: `${matchState.runs}/${matchState.wkts}`, overs: matchState.overs, extras: secondExtras, batting: secondInningsBatting, bowling: secondInningsBowling },
                topBatsmen, topBowlers, duration: 25000, timestamp: firebase.database.ServerValue.TIMESTAMP
            },
            ts: firebase.database.ServerValue.TIMESTAMP
        };
        await database.ref(`matches/${matchId}/command`).set(cmd);
        showToast('🏏 Match Scorecard shown on Scorebar!');
    } catch (err) {
        console.error('Scorecard error:', err);
        showToast('Error showing scorecard', 'error');
    } finally {
        isScorecardLoading = false;
    }
}

// ==========================================
// VALIDATION: Active Players Check (Enhanced)
// ==========================================
function validateActivePlayers() {
    const missing = [];
    if (!matchState.bat1.name) missing.push('Batsman 1');
    if (!matchState.bat2.name) missing.push('Batsman 2');
    if (!matchState.bowler.name) missing.push('Bowler');
    // ✅ Additional check: Bowler must belong to bowling team
    if (matchState.bowler.name) {
        const bowlingTeam = getBowlingTeam();
        const isBowlerValid = bowlingTeam && bowlingTeam.players && bowlingTeam.players.some(p => p.name === matchState.bowler.name);
        if (!isBowlerValid) {
            showToast('⚠️ Selected bowler is not in the bowling team!', 'error');
            highlightMissingSlots();
            return false;
        }
    }
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
    if (!matchState.bat1.name) shakeValidationSlot('activeStrikerName');
    if (!matchState.bat2.name) shakeValidationSlot('activeNonStrikerName');
    if (!matchState.bowler.name) shakeValidationSlot('activeBowlerName');
}

function shakeValidationSlot(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('validation-shake');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.classList.remove('validation-shake'), 900);
}

// ==========================================
// SAVE MATCH REPORT TO FIREBASE
// ==========================================
async function saveMatchReport() {
    if (!database) {
        showToast('Database not connected', 'error');
        return;
    }

    // Update current match state first
    updateMatchState();

    // Confirm with user
    const confirmed = await showConfirm({
        title: 'Save Match Report',
        message: 'Do you want to save the current match report to the database?',
        icon: '💾',
        theme: 'info',
        confirmText: 'Yes, Save Report',
        cancelText: 'Cancel',
        details: [
            `Match: ${matchState.batFlag} vs ${matchState.bowlFlag}`,
            `Score: ${matchState.runs}/${matchState.wkts} (${matchState.overs})`,
            `Target: ${matchState.target > 0 ? matchState.target : 'N/A'}`,
            `This will create a permanent record in Firebase.`
        ]
    });
    if (!confirmed) return;

    // Show loading
    showToast('Saving match report...', 'success');

    try {
        // Compute extras
        let totalBatsmenRuns = 0;
        const allBatsmen = [];

        // Add dismissed players
        (matchState.dismissedPlayers || []).forEach(p => {
            if (typeof p === 'object' && p.name) {
                totalBatsmenRuns += (p.runs || 0);
                allBatsmen.push({
                    name: p.name,
                    runs: p.runs || 0,
                    balls: p.balls || 0,
                    fours: p.fours || 0,
                    sixes: p.sixes || 0,
                    dismissal: p.dismissal || 'OUT',
                    bowler: p.bowler || '-',
                    fielder: p.fielder || '-',
                    isOut: true
                });
            } else if (typeof p === 'string') {
                allBatsmen.push({
                    name: p,
                    runs: 0,
                    balls: 0,
                    fours: 0,
                    sixes: 0,
                    dismissal: 'OUT',
                    bowler: '-',
                    fielder: '-',
                    isOut: true
                });
            }
        });

        // Add current batsmen if not out
        if (matchState.bat1.name && !matchState.bat1.isOut) {
            totalBatsmenRuns += (matchState.bat1.runs || 0);
            allBatsmen.push({
                name: matchState.bat1.name,
                runs: matchState.bat1.runs || 0,
                balls: matchState.bat1.balls || 0,
                fours: matchState.bat1.fours || 0,
                sixes: matchState.bat1.sixes || 0,
                dismissal: 'NOT OUT',
                bowler: '-',
                fielder: '-',
                isOut: false
            });
        }
        if (matchState.bat2.name && !matchState.bat2.isOut) {
            totalBatsmenRuns += (matchState.bat2.runs || 0);
            allBatsmen.push({
                name: matchState.bat2.name,
                runs: matchState.bat2.runs || 0,
                balls: matchState.bat2.balls || 0,
                fours: matchState.bat2.fours || 0,
                sixes: matchState.bat2.sixes || 0,
                dismissal: 'NOT OUT',
                bowler: '-',
                fielder: '-',
                isOut: false
            });
        }

        const extras = Math.max(0, matchState.runs - totalBatsmenRuns);

        // Build bowling figures from history + current bowler
        const bowlingHistoryMap = new Map();
        (matchState.bowlingHistory || []).forEach(b => {
            if (b.name) {
                bowlingHistoryMap.set(b.name, {
                    name: b.name,
                    overs: b.overs || ballsToOversString(b.balls || 0),
                    runs: b.runs || 0,
                    wickets: b.wickets || 0,
                    balls: b.balls || 0
                });
            }
        });
        // Add current bowler if not already in history
        if (matchState.bowler.name) {
            const figs = parseBowlerFigures(matchState.bowler.figs);
            if (!bowlingHistoryMap.has(matchState.bowler.name)) {
                bowlingHistoryMap.set(matchState.bowler.name, {
                    name: matchState.bowler.name,
                    overs: ballsToOversString(figs.balls),
                    runs: figs.runs,
                    wickets: figs.wickets,
                    balls: figs.balls
                });
            } else {
                // Update existing with latest figures
                bowlingHistoryMap.set(matchState.bowler.name, {
                    name: matchState.bowler.name,
                    overs: ballsToOversString(figs.balls),
                    runs: figs.runs,
                    wickets: figs.wickets,
                    balls: figs.balls
                });
            }
        }
        const bowlers = Array.from(bowlingHistoryMap.values());

        // Determine result
        let resultText = '';
        let winner = '';
        let margin = '';
        const target = matchState.target;
        const runs = matchState.runs;
        const wkts = matchState.wkts;
        const overs = matchState.overs;
        const totOvers = matchState.totOvers;
        const ballsBowled = oversToBalls(overs);
        const maxBalls = totOvers * 6;

        // ✅ BUG-007 FIX: Check tied match BEFORE bowling team won
        if (target > 0 && runs >= target) {
            winner = matchState.batFlag;
            const wktsLeft = Math.max(0, 10 - wkts);
            margin = `Won by ${wktsLeft} wicket${wktsLeft === 1 ? '' : 's'}`;
            resultText = `${winner} ${margin}`;
        } else if (target > 0 && runs === target - 1 && (wkts >= 10 || ballsBowled >= maxBalls)) {
            resultText = 'Match Tied';
            winner = 'Tie';
            margin = '';
        } else if (target > 0 && (wkts >= 10 || ballsBowled >= maxBalls)) {
            winner = matchState.bowlFlag;
            const runsMargin = Math.max(1, (target - 1) - runs);
            margin = `Won by ${runsMargin} run${runsMargin === 1 ? '' : 's'}`;
            resultText = `${winner} ${margin}`;
        } else {
            resultText = 'Match In Progress';
            winner = '';
            margin = '';
        }

        // Create report object
        const report = {
            matchId: matchId,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            date: new Date().toISOString(),
            battingTeam: {
                name: matchState.batFlag,
                fullName: matchState.battingSide === 1 ? (matchState.team1?.name || '') : (matchState.team2?.name || ''),
                logo: matchState.battingSide === 1 ? (matchState.t1Logo || '') : (matchState.t2Logo || '')
            },
            bowlingTeam: {
                name: matchState.bowlFlag,
                fullName: matchState.battingSide === 1 ? (matchState.team2?.name || '') : (matchState.team1?.name || ''),
                logo: matchState.battingSide === 1 ? (matchState.t2Logo || '') : (matchState.t1Logo || '')
            },
            innings: {
                runs: matchState.runs,
                wickets: matchState.wkts,
                overs: matchState.overs,
                target: matchState.target > 0 ? matchState.target : null,
                extras: extras,
                crr: matchState.crr,
                winProb: matchState.winProb
            },
            batsmen: allBatsmen,
            bowlers: bowlers,
            partnership: {
                runs: matchState.partRuns,
                balls: matchState.partBalls
            },
            result: {
                text: resultText,
                winner: winner,
                margin: margin
            },
            matchType: matchState.matchType,
            totOvers: matchState.totOvers,
            status: matchState.status,
            isSpecial: matchState.isSpecial,
            specialText: matchState.specialText,
            version: APP_VERSION
        };

        // Save to Firebase under match_reports/{matchId}/{reportId}
        const reportsRef = database.ref(`match_reports/${matchId}`).push();
        await reportsRef.set(report);

        showToast('✅ Match report saved successfully!', 'success');

        // Optional: Show the report ID
        console.log('Report saved with key:', reportsRef.key);

    } catch (error) {
        console.error('Error saving match report:', error);
        showToast('Failed to save match report: ' + error.message, 'error');
    }
}

// ==========================================
// EXPORT MATCH REPORTS TO EXCEL (CSV)
// ==========================================
async function exportMatchReportsToExcel() {
    if (!database) {
        showToast('Database not connected', 'error');
        return;
    }

    showToast('Fetching match reports...', 'success');

    try {
        // Fetch all reports for current matchId
        const reportsSnap = await database.ref(`match_reports/${matchId}`).once('value');
        const reports = reportsSnap.val();

        if (!reports || Object.keys(reports).length === 0) {
            showToast('No saved reports found for this match', 'error');
            return;
        }

        // Convert to array
        const reportsArray = Object.entries(reports).map(([key, report]) => ({
            reportId: key,
            ...report
        }));

        // Sort by timestamp (oldest first)
        reportsArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Prepare CSV data
        const csvRows = [];

        // CSV Header
        csvRows.push([
            'Report ID',
            'Date & Time',
            'Batting Team',
            'Bowling Team',
            'Score',
            'Overs',
            'Target',
            'Extras',
            'CRR',
            'Result',
            'Winner',
            'Margin',
            'Match Type',
            'Total Overs',
            'Status'
        ].join(','));

        // Add each report as a row
        for (const report of reportsArray) {
            const date = report.date ? new Date(report.date).toLocaleString() : '';
            const battingTeam = report.battingTeam?.name || '';
            const bowlingTeam = report.bowlingTeam?.name || '';
            const score = `${report.innings?.runs || 0}/${report.innings?.wickets || 0}`;
            const overs = report.innings?.overs || '0.0';
            const target = report.innings?.target || '';
            const extras = report.innings?.extras || 0;
            const crr = report.innings?.crr || '0.00';
            const result = report.result?.text || '';
            const winner = report.result?.winner || '';
            const margin = report.result?.margin || '';
            const matchType = report.matchType || '';
            const totOvers = report.totOvers || '';
            const status = report.status || '';

            const row = [
                `"${report.reportId}"`,
                `"${date}"`,
                `"${battingTeam}"`,
                `"${bowlingTeam}"`,
                `"${score}"`,
                `"${overs}"`,
                `"${target}"`,
                extras,
                `"${crr}"`,
                `"${result}"`,
                `"${winner}"`,
                `"${margin}"`,
                `"${matchType}"`,
                totOvers,
                `"${status}"`
            ];
            csvRows.push(row.join(','));
        }

        // Create CSV file and download
        const csvContent = csvRows.join('\n');
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Unicode
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `match_reports_${matchId}_${new Date().toISOString().slice(0, 19)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Exported ${reportsArray.length} report(s) to CSV`, 'success');

    } catch (error) {
        console.error('Export failed:', error);
        showToast('Export failed: ' + error.message, 'error');
    }
}

// Export detailed batting card as CSV
async function exportBattingDetailsToExcel() {
    if (!database) {
        showToast('Database not connected', 'error');
        return;
    }

    showToast('Fetching batting details...', 'success');

    try {
        const reportsSnap = await database.ref(`match_reports/${matchId}`).once('value');
        const reports = reportsSnap.val();

        if (!reports || Object.keys(reports).length === 0) {
            showToast('No saved reports found', 'error');
            return;
        }

        const reportsArray = Object.entries(reports).map(([key, report]) => ({ reportId: key, ...report }));
        reportsArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const csvRows = [];

        // Header for batting details
        csvRows.push([
            'Report ID', 'Date', 'Batting Team', 'Batsman Name', 'Runs', 'Balls',
            'Fours', 'Sixes', 'Dismissal', 'Bowler', 'Fielder', 'Status'
        ].join(','));

        for (const report of reportsArray) {
            const date = report.date ? new Date(report.date).toLocaleString() : '';
            const battingTeam = report.battingTeam?.name || '';
            const batsmen = report.batsmen || [];

            for (const batsman of batsmen) {
                const row = [
                    `"${report.reportId}"`,
                    `"${date}"`,
                    `"${battingTeam}"`,
                    `"${batsman.name || ''}"`,
                    batsman.runs || 0,
                    batsman.balls || 0,
                    batsman.fours || 0,
                    batsman.sixes || 0,
                    `"${batsman.dismissal || ''}"`,
                    `"${batsman.bowler || ''}"`,
                    `"${batsman.fielder || ''}"`,
                    batsman.isOut ? 'OUT' : 'NOT OUT'
                ];
                csvRows.push(row.join(','));
            }
        }

        const csvContent = csvRows.join('\n');
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `batting_details_${matchId}_${new Date().toISOString().slice(0, 19)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Batting details exported to CSV', 'success');

    } catch (error) {
        console.error(error);
        showToast('Export failed', 'error');
    }
}

// Feature 3: Export Match Report as PDF (Client‑side, 0 bandwidth)
async function exportMatchReportPDF() {
    updateMatchState(); // ensure latest data

    const reportHTML = `
        <html>
        <head><title>Match Report - ${matchId}</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; }
            .header { background: #F8B400; color: #000; padding: 15px; text-align: center; border-radius: 10px; }
            .team-names { font-size: 24px; font-weight: bold; margin: 20px 0; text-align: center; }
            .score-card { background: #f5f5f5; padding: 15px; border-radius: 10px; margin: 20px 0; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #F8B400; color: #000; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: gray; }
        </style>
        </head>
        <body>
        <div class="header"><h1>Cricket Match Report</h1></div>
        <div class="team-names">${matchState.batFlag} vs ${matchState.bowlFlag}</div>
        <div class="score-card">
            <p><strong>Score:</strong> ${matchState.runs}/${matchState.wkts} (${matchState.overs} overs)</p>
            <p><strong>Target:</strong> ${matchState.target > 0 ? matchState.target : 'N/A'}</p>
            <p><strong>CRR:</strong> ${matchState.crr}</p>
            <p><strong>Win Probability:</strong> ${matchState.winProb}%</p>
        </div>
        <h3>🏏 Batting Card</h3>
        <table>
            <tr><th>Batsman</th><th>Runs</th><th>Balls</th><th>4s</th><th>6s</th><th>Dismissal</th></tr>
            ${buildBattingTableRows()}
        </table>
        <h3>🎯 Bowling Card</h3>
        <table>
            <tr><th>Bowler</th><th>Overs</th><th>Runs</th><th>Wickets</th><th>Econ</th></tr>
            ${buildBowlingTableRows()}
        </table>
        <div class="footer">Generated by STC Score System | ${new Date().toLocaleString()}</div>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(reportHTML);
    printWindow.document.close();
    printWindow.print();
}

function buildBattingTableRows() {
    let rows = '';
    const dismissed = new Set();
    (matchState.dismissedPlayers || []).forEach(p => {
        const name = typeof p === 'string' ? p : p.name;
        if (!name) return;
        dismissed.add(name);
        rows += `<tr><td>${escapeHtml(name)}</td><td>${p.runs || 0}</td><td>${p.balls || 0}</td><td>${p.fours || 0}</td><td>${p.sixes || 0}</td><td>${p.dismissal || 'OUT'}</td></tr>`;
    });
    if (matchState.bat1.name && !dismissed.has(matchState.bat1.name)) {
        rows += `<tr><td>${escapeHtml(matchState.bat1.name)}*</td><td>${matchState.bat1.runs}</td><td>${matchState.bat1.balls}</td><td>${matchState.bat1.fours}</td><td>${matchState.bat1.sixes}</td><td>Not Out</td></tr>`;
    }
    if (matchState.bat2.name && !dismissed.has(matchState.bat2.name)) {
        rows += `<tr><td>${escapeHtml(matchState.bat2.name)}*</td><td>${matchState.bat2.runs}</td><td>${matchState.bat2.balls}</td><td>${matchState.bat2.fours}</td><td>${matchState.bat2.sixes}</td><td>Not Out</td></tr>`;
    }
    return rows;
}

function buildBowlingTableRows() {
    let rows = '';
    const bowlersMap = new Map();
    (matchState.bowlingHistory || []).forEach(b => {
        if (b.name) bowlersMap.set(b.name, b);
    });
    if (matchState.bowler.name) {
        const figs = parseBowlerFigures(matchState.bowler.figs);
        bowlersMap.set(matchState.bowler.name, {
            name: matchState.bowler.name,
            overs: ballsToOversString(figs.balls),
            runs: figs.runs,
            wickets: figs.wickets
        });
    }
    for (const b of bowlersMap.values()) {
        // ✅ BUG-019 FIX: Calculate economy using balls instead of overs string
        const bowlBalls = b.balls || oversToBalls(b.overs);
        // [Fix #1 & #2] Use ballsToExactOvers for economy rate calc
        const econ = bowlBalls > 0 ? (b.runs / ballsToExactOvers(bowlBalls)).toFixed(2) : '0.00';
        rows += `<tr><td>${escapeHtml(b.name)}</td><td>${b.overs}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${econ}</td></tr>`;
    }
    return rows;
}


// Feature 15: Share Match Card (html2canvas + Web Share API)
// Beautiful shareable winner card with team logo, score, performers, QR code
async function shareMatchCard() {
    const shareCard = document.getElementById('shareCard');
    if (!shareCard) { showToast('Share card template not found', 'error'); return; }

    updateMatchState();

    const target = parseInt(matchState.target) || 0;
    const runs = matchState.runs;
    const wkts = matchState.wkts;
    const ballsBowled = oversToBalls(matchState.overs);
    const maxBalls = matchState.totOvers * 6;

    // Determine winner info
    let winnerTeamName = '', winnerShortName = '', winnerLogo = '';
    let loserTeamName = '', loserShortName = '', loserLogo = '';
    let marginText = '', resultLine = '', isTied = false;

    if (target > 0 && runs >= target) {
        winnerShortName = matchState.batFlag;
        loserShortName = matchState.bowlFlag;
        if (matchState.battingSide === 1) {
            winnerTeamName = matchState.team1?.name || winnerShortName;
            winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
            loserTeamName = matchState.team2?.name || loserShortName;
            loserLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
        } else {
            winnerTeamName = matchState.team2?.name || winnerShortName;
            winnerLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
            loserTeamName = matchState.team1?.name || loserShortName;
            loserLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
        }
        const wktsLeft = Math.max(0, 10 - wkts);
        marginText = `WON BY ${wktsLeft} WICKET${wktsLeft === 1 ? '' : 'S'}`;
        resultLine = `${runs}/${wkts} in ${matchState.overs} overs`;
    } else if (target > 1 && runs === target - 1 && (wkts >= 10 || ballsBowled >= maxBalls)) {
        isTied = true;
        winnerTeamName = 'MATCH TIED';
        marginText = 'MATCH TIED';
        resultLine = `Both scored ${runs} runs`;
        winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || '';
        loserLogo = matchState.t2Logo || matchState.team2?.logo_url || '';
        winnerShortName = matchState.team1?.short_name || 'T1';
        loserShortName = matchState.team2?.short_name || 'T2';
    } else if (target > 0 && (wkts >= 10 || ballsBowled >= maxBalls)) {
        winnerShortName = matchState.bowlFlag;
        loserShortName = matchState.batFlag;
        if (matchState.battingSide === 1) {
            winnerTeamName = matchState.team2?.name || winnerShortName;
            winnerLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
            loserTeamName = matchState.team1?.name || loserShortName;
            loserLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
        } else {
            winnerTeamName = matchState.team1?.name || winnerShortName;
            winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
            loserTeamName = matchState.team2?.name || loserShortName;
            loserLogo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
        }
        const runsMargin = Math.max(1, (target - 1) - runs);
        marginText = `WON BY ${runsMargin} RUN${runsMargin === 1 ? '' : 'S'}`;
        resultLine = `Defended ${target - 1}`;
    } else {
        // Match in progress - still make a card with current score
        winnerTeamName = matchState.batFlag || 'LIVE MATCH';
        winnerShortName = matchState.batFlag || 'LIVE';
        loserShortName = matchState.bowlFlag || 'VS';
        winnerLogo = matchState.t1Logo || matchState.team1?.logo_url || '';
        loserLogo = matchState.t2Logo || matchState.team2?.logo_url || '';
        marginText = 'LIVE SCORE';
        resultLine = `${runs}/${wkts} in ${matchState.overs} overs`;
    }

    const balls = oversToBalls(matchState.overs);
    // [Fix #1 & #2] Use ballsToExactOvers for CRR rate calc
    const crr = balls > 0 ? (runs / ballsToExactOvers(balls)).toFixed(2) : '0.00';

    // Gather top performers
    const allBatsmen = [];
    const dismissedNames = new Set();
    (matchState.dismissedPlayers || []).forEach(p => {
        if (typeof p === 'object' && p.name) {
            dismissedNames.add(p.name);
            allBatsmen.push({ name: p.name, runs: p.runs || 0, balls: p.balls || 0, isOut: true });
        }
    });
    if (matchState.bat1.name && !matchState.bat1.isOut && !dismissedNames.has(matchState.bat1.name)) {
        allBatsmen.push({ ...matchState.bat1, isOut: false });
    }
    if (matchState.bat2.name && !matchState.bat2.isOut && !dismissedNames.has(matchState.bat2.name)) {
        allBatsmen.push({ ...matchState.bat2, isOut: false });
    }
    const topBatsmen = allBatsmen.sort((a, b) => (b.runs || 0) - (a.runs || 0)).slice(0, 3);

    const allBowlers = [...(matchState.bowlingHistory || [])];
    if (matchState.bowler.name) {
        const figs = parseBowlerFigures(matchState.bowler.figs);
        const rec = { name: matchState.bowler.name, wickets: figs.wickets, runs: figs.runs, overs: ballsToOversString(figs.balls) };
        const idx = allBowlers.findIndex(b => b.name === matchState.bowler.name);
        if (idx >= 0) allBowlers[idx] = rec; else allBowlers.push(rec);
    }
    const topBowlers = allBowlers.sort((a, b) => (b.wickets || 0) - (a.wickets || 0)).slice(0, 3);

    // ---- Fill share card template ----
    // Winner logo
    const winnerLogoImg = document.getElementById('scWinnerLogoImg');
    const winnerLogoText = document.getElementById('scWinnerLogoText');
    if (winnerLogo && winnerLogo.length > 10) {
        winnerLogoImg.src = winnerLogo;
        winnerLogoImg.style.display = 'block';
        winnerLogoText.style.display = 'none';
    } else {
        winnerLogoImg.style.display = 'none';
        winnerLogoText.style.display = 'flex';
        winnerLogoText.textContent = (winnerShortName || '??').slice(0, 3);
    }

    document.getElementById('scWinnerName').textContent = winnerTeamName;
    document.getElementById('scMarginText').textContent = marginText;
    document.getElementById('scScore').textContent = `${runs}/${wkts}`;
    document.getElementById('scOvers').textContent = `${matchState.overs} OVERS`;
    document.getElementById('scCRR').textContent = `CRR ${crr}`;

    // Team 1 & 2 logos + scores
    const t1Logo = matchState.t1Logo || matchState.team1?.logo_url || matchState.team1?.logo_base64 || '';
    const t2Logo = matchState.t2Logo || matchState.team2?.logo_url || matchState.team2?.logo_base64 || '';
    const t1Short = matchState.team1?.short_name || 'T1';
    const t2Short = matchState.team2?.short_name || 'T2';

    setScTeamLogo('scTeam1LogoImg', 'scTeam1LogoText', t1Logo, t1Short);
    setScTeamLogo('scTeam2LogoImg', 'scTeam2LogoText', t2Logo, t2Short);

    document.getElementById('scTeam1Short').textContent = t1Short;
    document.getElementById('scTeam2Short').textContent = t2Short;

    // Determine scores for each team
    if (matchState.battingSide === 1) {
        document.getElementById('scTeam1Score').textContent = `${runs}/${wkts} (${matchState.overs})`;
        document.getElementById('scTeam2Score').textContent = target > 0 ? `${target - 1}/?` : '--';
    } else {
        document.getElementById('scTeam2Score').textContent = `${runs}/${wkts} (${matchState.overs})`;
        document.getElementById('scTeam1Score').textContent = target > 0 ? `${target - 1}/?` : '--';
    }

    // Highlight winner team
    if (!isTied) {
        const winnerIsTeam1 = matchState.battingSide === 1 ? (runs >= target) : (runs < target || wkts >= 10 || ballsBowled >= maxBalls);
        const t1Wrap = document.getElementById('scTeam1LogoWrap');
        const t2Wrap = document.getElementById('scTeam2LogoWrap');
        if (winnerIsTeam1 && matchState.battingSide === 1) {
            t1Wrap.style.borderColor = 'rgba(248,180,0,0.5)';
            t2Wrap.style.borderColor = 'rgba(255,255,255,0.15)';
        } else {
            t2Wrap.style.borderColor = 'rgba(248,180,0,0.5)';
            t1Wrap.style.borderColor = 'rgba(255,255,255,0.15)';
        }
    }

    // Top performers
    const batsmenHTML = topBatsmen.map(b => {
        const notOut = !b.isOut ? ' ★' : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.7rem;">
            <span style="color:rgba(255,255,255,0.6);font-weight:600;">${escapeAdminPopupHtml(b.name)}${notOut}</span>
            <span><span style="color:#F8B400;font-weight:900;">${b.runs}</span><span style="color:rgba(255,255,255,0.3);font-size:0.6rem;"> (${b.balls}b)</span></span>
        </div>`;
    }).join('') || '<div style="color:rgba(255,255,255,0.2);font-size:0.7rem;">No data</div>';

    const bowlersHTML = topBowlers.map(b => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.7rem;">
            <span style="color:rgba(255,255,255,0.6);font-weight:600;">${escapeAdminPopupHtml(b.name)}</span>
            <span><span style="color:#F8B400;font-weight:900;">${b.wickets}/${b.runs}</span><span style="color:rgba(255,255,255,0.3);font-size:0.6rem;"> (${b.overs || '-'})</span></span>
        </div>`;
    }).join('') || '<div style="color:rgba(255,255,255,0.2);font-size:0.7rem;">No data</div>';

    document.getElementById('scTopBatsmen').innerHTML = batsmenHTML;
    document.getElementById('scTopBowlers').innerHTML = bowlersHTML;

    // Match title
    const matchTitle = `${t1Short} vs ${t2Short} • ${matchState.totOvers} Overs`;
    document.getElementById('scMatchTitle').textContent = matchTitle;

    // Load Thomians Media logo as data URL for html2canvas compatibility
    try {
        const thomiansLogoEl = document.getElementById('scThomiansMediaLogo');
        if (thomiansLogoEl) {
            const logoResponse = await fetch('thomians-media-logo.png');
            const logoBlob = await logoResponse.blob();
            const logoDataURL = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(logoBlob);
            });
            thomiansLogoEl.src = logoDataURL;
        }
    } catch (e) {
        console.warn('Thomians Media logo load failed, using fallback', e);
        const thomiansLogoEl = document.getElementById('scThomiansMediaLogo');
        if (thomiansLogoEl) thomiansLogoEl.style.display = 'none';
    }

    // Also convert winner/team logos to data URLs for html2canvas
    try {
        const logoIds = ['scWinnerLogoImg', 'scTeam1LogoImg', 'scTeam2LogoImg'];
        for (const logoId of logoIds) {
            const imgEl = document.getElementById(logoId);
            if (imgEl && imgEl.src && imgEl.src.length > 10 && !imgEl.src.startsWith('data:')) {
                try {
                    const resp = await fetch(imgEl.src);
                    const blob = await resp.blob();
                    const dataURL = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    imgEl.src = dataURL;
                } catch (e) { /* skip if CORS fails */ }
            }
        }
    } catch (e) { /* non-critical */ }

    // QR Code
    const qrDiv = document.getElementById('scQRCode');
    qrDiv.innerHTML = '';
    try {
        const spectatorUrl = `${window.location.origin}/spectator.html?match=${matchId}`;
        new QRCode(qrDiv, { text: spectatorUrl, width: 60, height: 60, colorDark: '#0a0e1a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
        qrDiv.innerHTML = '<div style="font-size:8px;color:#999;text-align:center;padding:4px;">QR</div>';
    }

    // Make container visible temporarily for html2canvas
    const container = document.getElementById('shareCardContainer');
    container.style.left = '0';
    container.style.zIndex = '99999';
    container.style.position = 'fixed';

    try {
        // Delay for QR code + images to render
        await new Promise(r => setTimeout(r, 800));

        const canvas = await html2canvas(shareCard, {
            scale: 2,
            backgroundColor: '#0a0e1a',
            useCORS: true,
            allowTaint: true,
            logging: false
        });

        const imageData = canvas.toDataURL('image/png');

        // Restore hidden position
        container.style.left = '-9999px';
        container.style.zIndex = '-1';

        // Share or download
        if (navigator.share && navigator.canShare) {
            try {
                const blob = await (await fetch(imageData)).blob();
                const file = new File([blob], 'match-result.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title: `${winnerTeamName} ${marginText}`,
                        text: `${t1Short} vs ${t2Short} - ${runs}/${wkts}`,
                        files: [file]
                    });
                    showToast('Card shared!');
                    return;
                }
            } catch (shareErr) {
                if (shareErr.name === 'AbortError') { showToast('Share cancelled'); return; }
            }
        }

        // Fallback: download image
        const a = document.createElement('a');
        a.href = imageData;
        a.download = `match-card-${t1Short}-vs-${t2Short}.png`;
        a.click();
        showToast('Match card downloaded!');

    } catch (err) {
        container.style.left = '-9999px';
        container.style.zIndex = '-1';
        console.error('Share card error:', err);
        showToast('Failed to generate card', 'error');
    }
}

// Helper: set team logo in share card
function setScTeamLogo(imgId, textId, logoSrc, shortName) {
    const img = document.getElementById(imgId);
    const txt = document.getElementById(textId);
    if (logoSrc && logoSrc.length > 10) {
        img.src = logoSrc;
        img.style.display = 'block';
        txt.style.display = 'none';
    } else {
        img.style.display = 'none';
        txt.style.display = 'flex';
        txt.textContent = (shortName || '??').slice(0, 3);
    }
}

// Send command to scorebar to show chart group
function sendChartCommand(group) {
    if (!database) {
        showToast('Database not connected', 'error');
        return;
    }
    sendCommand('show_charts', { group: group });
    showToast(`📊 Charts command sent: ${group}`, 'success');
}
function sendHideChartsCommand() {
    if (!database) { showToast('Database not connected', 'error'); return; }
    sendCommand('hide_charts', {});
    showToast('❌ Charts hidden from broadcast', 'success');
}

// ==========================================
// SCOREBAR CURTAIN - Hide / Show Broadcast
// ==========================================
let scorebarVisible = true; // Track visibility state

function injectScorebarCurtainControl() {
    // Check if already injected (avoid duplicates)
    if (document.getElementById('scorebarCurtainSection')) return;

    // Find the graphics grid or present-details section to insert after
    const graphicsGrid = document.querySelector('.graphics-grid');
    const presentDetails = document.querySelector('.present-details-section');
    const insertAfter = presentDetails || graphicsGrid;

    if (!insertAfter) {
        // Fallback: try finding any card-body that contains graphic buttons
        const graphicCards = document.querySelectorAll('.card-body');
        for (const card of graphicCards) {
            if (card.querySelector('.btn-graphic') || card.querySelector('.graphics-grid')) {
                // Found the graphics card - append at the end of its body
                const section = createCurtainSection();
                card.appendChild(section);
                return;
            }
        }
        // Last resort: try to find the card that contains graphics
        const allCards = document.querySelectorAll('.card-body');
        if (allCards.length > 0) {
            // Insert after the first card that has graphics-related content
            const section = createCurtainSection();
            allCards[0].appendChild(section);
        }
        return;
    }

    // Insert after the found element
    const section = createCurtainSection();
    insertAfter.parentNode.insertBefore(section, insertAfter.nextSibling);
}

function createCurtainSection() {
    const section = document.createElement('div');
    section.id = 'scorebarCurtainSection';
    section.className = 'scorebar-curtain-section';
    section.innerHTML = `
        <div class="scorebar-curtain-info">
            <div class="scorebar-curtain-title">
                <span class="curtain-icon">&#127916;</span>
                Scorebar Curtain
            </div>
            <div class="scorebar-curtain-desc">
                Broadcast scoreboard එක hide/show කරන්න smooth curtain animation එකකින්. Breaks සහ transitions වලට perfect.
            </div>
            <div class="scorebar-curtain-status visible" id="curtainStatus">
                <span class="curtain-status-dot" id="curtainStatusDot"></span>
                <span class="curtain-status-text">VISIBLE</span>
            </div>
        </div>
        <button class="btn-curtain-toggle" id="curtainToggleBtn" onclick="toggleScorebarVisibility()">
            <span class="curtain-toggle-icon">&#128261;</span>
            Hide Scorebar
        </button>
    `;
    return section;
}

function toggleScorebarVisibility() {
    if (!database) { showToast('Database not connected', 'error'); return; }

    if (scorebarVisible) {
        // Hide the scorebar
        sendCommand('hide_scorebar', {});
        scorebarVisible = false;
        updateCurtainUI();
        showToast('🎬 Scorebar hidden from broadcast', 'success');
    } else {
        // Show the scorebar
        sendCommand('show_scorebar', {});
        scorebarVisible = true;
        updateCurtainUI();
        showToast('📺 Scorebar visible on broadcast', 'success');
    }
}

function updateCurtainUI() {
    const btn = document.getElementById('curtainToggleBtn');
    const statusEl = document.getElementById('curtainStatus');

    if (btn) {
        if (scorebarVisible) {
            btn.classList.remove('is-hidden');
            btn.innerHTML = '<span class="curtain-toggle-icon">&#128261;</span> Hide Scorebar';
        } else {
            btn.classList.add('is-hidden');
            btn.innerHTML = '<span class="curtain-toggle-icon">&#128262;</span> Show Scorebar';
        }
    }

    if (statusEl) {
        if (scorebarVisible) {
            statusEl.className = 'scorebar-curtain-status visible';
            statusEl.querySelector('.curtain-status-text').textContent = 'VISIBLE';
        } else {
            statusEl.className = 'scorebar-curtain-status hidden-status';
            statusEl.querySelector('.curtain-status-text').textContent = 'HIDDEN';
        }
    }
}

// Feature 19: QR Code for Spectator Page
function generateQRCode() {
    const url = `${window.location.origin}/spectator.html?match=${matchId}`;
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = '';
    new QRCode(qrDiv, { text: url, width: 200, height: 200 });
    showToast('QR Code generated', 'success');
}

// ==========================================
// TEAM CARDS - OBS Overlay Control
// ==========================================
let cardsVisibleTeam = 0; // 0 = hidden, 1 = team1 showing, 2 = team2 showing

function showTeamCards(teamNumber) {
    if (!database) { showToast('Database not connected', 'error'); return; }

    const team = teamNumber === 1 ? matchState.team1 : matchState.team2;
    if (!team || !team.id) {
        showToast(`Team ${teamNumber} not selected yet`, 'error');
        return;
    }

    // Build players array from team data
    const players = (team.players || []).map((p, idx) => ({
        name: p.name || 'Unknown',
        role: p.role || '',
        photo: p.photo_url || p.photo_base64 || '',
        jerseyNumber: p.jersey_number || (idx + 1)
    }));

    // Build payload with team and player data
    const payload = {
        teamNumber,
        teamId: team.id,
        teamName: team.name || `Team ${teamNumber}`,
        teamShortName: team.short_name || (team.name || '').substring(0, 3).toUpperCase(),
        teamLogo: team.logo_url || team.logo_base64 || (teamNumber === 1 ? matchState.t1Logo : matchState.t2Logo) || '',
        players
    };

    // Send command to cards page
    sendCommand(`show_cards_team${teamNumber}`, payload);

    cardsVisibleTeam = teamNumber;
    updateTeamCardsUI();
    showToast(`🃏 Team ${teamNumber} cards showing on broadcast`, 'success');
}

function hideTeamCards() {
    if (!database) { showToast('Database not connected', 'error'); return; }
    if (cardsVisibleTeam === 0) { showToast('No cards currently showing', 'error'); return; }

    sendCommand('hide_cards', {});

    cardsVisibleTeam = 0;
    updateTeamCardsUI();
    showToast('🃏 Team cards hidden from broadcast', 'success');
}

function updateTeamCardsUI() {
    const btnTeam1 = document.getElementById('btnShowTeam1Cards');
    const btnTeam2 = document.getElementById('btnShowTeam2Cards');
    const btnHide = document.getElementById('btnHideCards');
    const statusDot = document.getElementById('tcStatusDot');
    const statusText = document.getElementById('tcStatusText');

    // Update team names and logos in buttons
    const team1 = matchState.team1;
    const team2 = matchState.team2;

    if (team1) {
        const nameEl = document.getElementById('tcTeam1Name');
        const logoEl = document.getElementById('tcTeam1Logo');
        if (nameEl) nameEl.textContent = team1.name || 'Select Team';
        if (logoEl) {
            const logoSrc = team1.logo_url || team1.logo_base64 || '';
            if (logoSrc) {
                logoEl.innerHTML = `<img src="${logoSrc}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
            } else {
                logoEl.textContent = team1.short_name || 'T1';
            }
        }
    }

    if (team2) {
        const nameEl = document.getElementById('tcTeam2Name');
        const logoEl = document.getElementById('tcTeam2Logo');
        if (nameEl) nameEl.textContent = team2.name || 'Select Team';
        if (logoEl) {
            const logoSrc = team2.logo_url || team2.logo_base64 || '';
            if (logoSrc) {
                logoEl.innerHTML = `<img src="${logoSrc}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
            } else {
                logoEl.textContent = team2.short_name || 'T2';
            }
        }
    }

    // Update active states
    if (btnTeam1) {
        btnTeam1.classList.toggle('is-showing', cardsVisibleTeam === 1);
        const icon = btnTeam1.querySelector('.tc-btn-icon');
        if (icon) icon.textContent = cardsVisibleTeam === 1 ? '👁️' : '👁️';
    }
    if (btnTeam2) {
        btnTeam2.classList.toggle('is-showing', cardsVisibleTeam === 2);
        const icon = btnTeam2.querySelector('.tc-btn-icon');
        if (icon) icon.textContent = cardsVisibleTeam === 2 ? '👁️' : '👁️';
    }

    // Enable/disable hide button
    if (btnHide) {
        btnHide.disabled = cardsVisibleTeam === 0;
    }

    // Update status
    if (statusDot && statusText) {
        if (cardsVisibleTeam === 0) {
            statusDot.className = 'tc-status-dot idle';
            statusText.textContent = 'No cards showing';
        } else {
            const showingTeam = cardsVisibleTeam === 1 ? matchState.team1 : matchState.team2;
            const showingName = showingTeam ? showingTeam.name : `Team ${cardsVisibleTeam}`;
            statusDot.className = 'tc-status-dot active';
            statusText.textContent = `${showingName} cards showing`;
        }
    }
}

// Call updateTeamCardsUI when teams change
const _origSelectTeam = typeof selectTeam === 'function' ? selectTeam : null;
const _origApplySelectedTeamToUI = typeof applySelectedTeamToUI === 'function' ? applySelectedTeamToUI : null;

// Patch applySelectedTeamToUI to also update cards UI
const _patchedApplySelectedTeamToUI = applySelectedTeamToUI;
applySelectedTeamToUI = function (slot) {
    if (_patchedApplySelectedTeamToUI) _patchedApplySelectedTeamToUI(slot);
    updateTeamCardsUI();
};

// ==========================================
// USER PROFILE BADGE (Simple - top of panel)
// ==========================================
function injectUserProfileBadge(user) {
    if (!user) return;
    const existing = document.getElementById('userProfileBadge');
    if (existing) {
        const img = existing.querySelector('.upb-avatar img');
        const fallback = existing.querySelector('.upb-avatar span');
        const emailEl = existing.querySelector('.upb-email');
        if (user.photoURL) {
            if (img) img.src = user.photoURL;
        }
        if (emailEl) emailEl.textContent = user.email || '';
        return;
    }
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;
    const badge = document.createElement('div');
    badge.id = 'userProfileBadge';
    badge.className = 'user-profile-badge';
    const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
    badge.innerHTML = `
        <div class="upb-avatar">
            ${user.photoURL ? `<img src="${user.photoURL}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span style="display:none;">${initial}</span>` : `<span>${initial}</span>`}
        </div>
        <span class="upb-email">${escapeHtml(user.email || '')}</span>
    `;
    headerRight.insertBefore(badge, headerRight.firstChild);
}

console.log(`🏏 Admin.js ${APP_VERSION} - All 19 Bugs Fixed - Ready for Production`);

// ==========================================
// SUPABASE DUAL-WRITE MODULE V1.0
// Admin Panel → Firebase (internal) + Supabase (public mirror for Spector)
// This runs AFTER Firebase write succeeds — silently fails if error
// ==========================================

const SUPABASE_CONFIG = {
    URL: 'https://rxdfdjyupdlofgbpkvfr.supabase.co',
    SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4ZGZkanl1cGRsb2ZnYnBrdmZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI1NjY0NSwiZXhwIjoyMDkzODMyNjQ1fQ.yknijt91_S2QAKTbdUY_tB6AAWiFSodTKnx6Wi8yt4c',
    MATCH_ID: 'match_001'
};

const TEAM_INFO = {
    team1: {
        name: "St.Thomas' College Matale", shortName: 'STC', flagEmoji: '🦁', color: '#FFC300',
        logo: 'https://cdn.jsdelivr.net/gh/architecturezen8-cpu/web-assets/battle-of-the-golds/1778142922724-St.Thomas__College_Matale.png'
    },
    team2: {
        name: 'Govt. Science College Matale', shortName: 'GSC', flagEmoji: '🔬', color: '#8f1018',
        logo: 'https://cdn.jsdelivr.net/gh/architecturezen8-cpu/web-assets/battle-of-the-golds/1778142905872-Govt.Science_college_matale.png'
    }
};

const MATCH_META = { matchTitle: 'Battle of the Golds', series: '24th Big Match', venue: 'Bernard Aluwihare Ground Matale' };

// Image URL mapping: ImgBB → GitHub jsDelivr CDN (NO ImgBB fallback on public site!)
function getPlayerCdnUrl(imgbbUrl) {
    if (!imgbbUrl || !allPlayers) return '/images/player-placeholder.png';
    const player = allPlayers.find(p => p.photo_url === imgbbUrl);
    if (player?.photo_cdn_url) return player.photo_cdn_url;
    if (player?.photo_base64) return player.photo_base64;
    return '/images/player-placeholder.png';
}

function buildSupabasePayload(fp) {
    const { runs, wkts, overs, target, totOvers, crr, batFlag, bowlFlag,
            battingSide, bat1, bat2, striker, bowler, thisOver, isFreeHit,
            partRuns, partBalls, winProb, overRunsHistory, dismissedPlayers, status } = fp;

    const [overWhole = 0, ballDecimal = 0] = String(overs).split('.').map(Number);
    const totalBallsBowled = overWhole * 6 + ballDecimal;
    const maxBalls = (totOvers || 20) * 6;
    const ballsLeft = Math.max(maxBalls - totalBallsBowled, 0);
    let need = 0, rrr = 0;
    if (target > 0) { need = Math.max(target - runs, 0); rrr = ballsLeft > 0 ? parseFloat(((need / ballsLeft) * 6).toFixed(2)) : 0; }

    function shortName(n) { if (!n) return ''; const p = n.trim().split(/\s+/); return p.length < 2 ? n : `${p[0][0]}. ${p.slice(1).join(' ')}`; }
    function initials(n) { if (!n) return ''; return n.trim().split(/\s+/).map(p=>p[0]).join('').toUpperCase(); }

    const isTeam1Batting = battingSide === 1;
    const battingTeam = isTeam1Batting ? TEAM_INFO.team1 : TEAM_INFO.team2;
    const bowlingTeam = isTeam1Batting ? TEAM_INFO.team2 : TEAM_INFO.team1;

    const liveState = {
        currentOver: overWhole, currentBall: ballDecimal, overDisplay: String(overs),
        score: `${runs}/${wkts}`, battingTeam: battingTeam.name, target, need, ballsLeft,
        currentBatsmen: [
            { name: bat1?.name||'', shortName: shortName(bat1?.name), initials: initials(bat1?.name), runs: bat1?.runs||0, balls: bat1?.balls||0, fours: bat1?.fours||0, sixes: bat1?.sixes||0, sr: (bat1?.balls||0)>0?parseFloat(((bat1.runs/bat1.balls)*100).toFixed(2)):0, isStriking: String(striker)==='1', photoUrl: getPlayerCdnUrl(bat1?.photo) },
            { name: bat2?.name||'', shortName: shortName(bat2?.name), initials: initials(bat2?.name), runs: bat2?.runs||0, balls: bat2?.balls||0, fours: bat2?.fours||0, sixes: bat2?.sixes||0, sr: (bat2?.balls||0)>0?parseFloat(((bat2.runs/bat2.balls)*100).toFixed(2)):0, isStriking: String(striker)==='2', photoUrl: getPlayerCdnUrl(bat2?.photo) }
        ],
        currentBowler: bowler?.name||'',
        currentOverBalls: parseCurrentOverBalls(thisOver, overs),
        partnership: { runs: partRuns||0, balls: partBalls||0, bat1Runs: bat1?.runs||0, bat2Runs: bat2?.runs||0, bat1Name: bat1?.name||'', bat2Name: bat2?.name||'' },
        isLive: status !== 'MATCH ENDED' && status !== 'MATCH NOT STARTED',
        isFreeHit: !!isFreeHit, crr: parseFloat(crr)||0, rrr
    };

    // ✅ WIN RESULT: Extract actual result text from matchState._resultText (set by showWinnerCard)
    // Falls back to generic "Match Completed" if no specific result text is available
    const resultText = (matchState._resultText && status === 'MATCH ENDED')
        ? matchState._resultText
        : (status === 'MATCH ENDED' ? 'Match Completed' : '');

    const matchInfo = {
        id: SUPABASE_CONFIG.MATCH_ID,
        team1: { ...TEAM_INFO.team1 }, team2: { ...TEAM_INFO.team2 },
        venue: MATCH_META.venue, date: new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }),
        result: resultText, toss: '', playerOfMatch: '', umpires: [],
        matchReferee: '', matchTitle: MATCH_META.matchTitle, series: MATCH_META.series
    };

    const inningsNumber = isTeam1Batting ? 1 : 2;
    const inningsKey = `innings_${inningsNumber}`;
    const inningsData = {
        battingTeam: battingTeam.name, bowlingTeam: bowlingTeam.name, totalRuns: runs, totalWkts: wkts,
        totalOvers: String(overs), maxOvers: totOvers||20,
        extras: { total: 0, wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
        batting: buildBattingCard(dismissedPlayers, bat1, bat2),
        bowling: buildBowlingCard(bowler),
        fallOfWickets: buildFallOfWickets(dismissedPlayers),
        overByOver: buildOverByOver(overRunsHistory),
        partnerships: buildPartnerships(matchState.partnershipHistory), // [BUG-04 FIX]
    };

    const community = { votes: { STC: 0, GSC: 0 }, totalVotes: 0 };

    // Build momentum for current innings only (sent to Supabase `momentum` column)
    const momentum = buildMomentum(overRunsHistory);

    // [BUG-03 FIX] Add Super Over context to liveState
    liveState.isSuperOver = matchState.isSuperOver || false;
    liveState.superOverRound = matchState.superOverRound || 0;
    liveState.tiedScore = matchState._tiedScore || '';
    liveState.tiedOvers = matchState._tiedOvers || '';

    // [BUG-02 FIX] Always send BOTH innings so Supabase PATCH never nullifies previous innings
    const oppositeInningsNum = inningsNumber === 1 ? 2 : 1;
    const oppositeKey = 'innings_' + oppositeInningsNum;
    const oppositeSnapshot = oppositeInningsNum === 1 ? matchState.innings1Snapshot : matchState.innings2Snapshot;
    const emptyOppositeInnings = {
        battingTeam: isTeam1Batting ? TEAM_INFO.team2.name : TEAM_INFO.team1.name,
        bowlingTeam: isTeam1Batting ? TEAM_INFO.team1.name : TEAM_INFO.team2.name,
        totalRuns: 0, totalWkts: 0, totalOvers: '0.0', maxOvers: totOvers || 20,
        extras: { total: 0, wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
        batting: [], bowling: [], fallOfWickets: [], overByOver: [], partnerships: [],
    };

    // [SCHEMA FIX] Do NOT send momentum_1/momentum_2 as separate columns —
    // those columns don't exist in Supabase match_live table.
    // Instead, CMS derives per-innings momentum from innings_1.overByOver & innings_2.overByOver.
    const finalPayload = {
        match_id: SUPABASE_CONFIG.MATCH_ID,
        live_state: liveState,
        match_info: matchInfo,
        [inningsKey]: inningsData,
        [oppositeKey]: oppositeSnapshot || emptyOppositeInnings,
        community,
        momentum,        // current innings momentum (for backward compat)
        updated_at: new Date().toISOString(),
    };

    return finalPayload;
}

function parseCurrentOverBalls(thisOverStr, oversStr) {
    if (!thisOverStr||typeof thisOverStr!=='string') return [];
    const tokens = thisOverStr.trim().split(/\s+/);
    const [ow=0] = String(oversStr).split('.').map(Number);
    return tokens.map((t,i) => {
        const ol = `${ow-1}.${i+1}`; const u = t.toUpperCase();
        let o,d; if(u==='W'){o='W';d='WICKET!';}else if(u==='WD'){o='Wd';d='Wide';}else if(u==='NB'){o='Nb';d='No ball';}else if(['0','1','2','3','4','6'].includes(t)){o=t;d=t==='4'?'FOUR!':t==='6'?'SIX!':`${t} run${t!=='1'?'s':''}`;}else{o='0';d=t;}
        return {over:ol,outcome:o,description:d};
    });
}

function buildBattingCard(dismissedPlayers, bat1, bat2) {
    const card = [];
    if (bat1?.name) card.push({name:bat1.name,shortName:bat1.name.trim().split(/\s+/).map((p,i)=>i===0?p[0]+'.':p).join(' '),initials:bat1.name.trim().split(/\s+/).map(p=>p[0]).join('').toUpperCase(),runs:bat1.runs||0,balls:bat1.balls||0,fours:bat1.fours||0,sixes:bat1.sixes||0,sr:(bat1.balls||0)>0?parseFloat(((bat1.runs/bat1.balls)*100).toFixed(2)):0,dismissal:bat1.isOut?'out':'not out',isOut:!!bat1.isOut,photoUrl:getPlayerCdnUrl(bat1.photo)});
    if (bat2?.name) card.push({name:bat2.name,shortName:bat2.name.trim().split(/\s+/).map((p,i)=>i===0?p[0]+'.':p).join(' '),initials:bat2.name.trim().split(/\s+/).map(p=>p[0]).join('').toUpperCase(),runs:bat2.runs||0,balls:bat2.balls||0,fours:bat2.fours||0,sixes:bat2.sixes||0,sr:(bat2.balls||0)>0?parseFloat(((bat2.runs/bat2.balls)*100).toFixed(2)):0,dismissal:bat2.isOut?'out':'not out',isOut:!!bat2.isOut,photoUrl:getPlayerCdnUrl(bat2.photo)});
    if (dismissedPlayers&&Array.isArray(dismissedPlayers)) { dismissedPlayers.forEach(p => { const n=typeof p==='string'?p:p.name; if(n&&!card.find(c=>c.name===n)) card.push({name:n,shortName:n.trim().split(/\s+/).map((x,i)=>i===0?x[0]+'.':x).join(' '),initials:n.trim().split(/\s+/).map(x=>x[0]).join('').toUpperCase(),runs:(typeof p==='object'?p.runs:0)||0,balls:(typeof p==='object'?p.balls:0)||0,fours:0,sixes:0,sr:0,dismissal:(typeof p==='object'?p.dismissal:'OUT')||'OUT',isOut:true,photoUrl:getPlayerCdnUrl(typeof p==='object'?p.photo:'')}); }); }
    return card;
}

function buildBowlingCard(bowler) {
    // ✅ FIX: Include ALL bowlers from bowlingHistory, not just the current bowler
    const bowlers = [];
    const historyMap = new Map();
    
    // Add all bowlers from bowling history first
    if (matchState.bowlingHistory && Array.isArray(matchState.bowlingHistory)) {
        for (const b of matchState.bowlingHistory) {
            if (b.name) {
                historyMap.set(b.name, {
                    name: b.name,
                    overs: b.overs || ballsToOversString(b.balls || 0),
                    maidens: b.maidens || 0,
                    runs: b.runs || 0,
                    wickets: b.wickets || 0,
                    econ: (b.balls || 0) > 0 ? parseFloat(((b.runs || 0) / b.balls * 6).toFixed(2)) : 0,
                    dots: b.dots || 0,
                    dotPercent: (b.balls || 0) > 0 ? parseFloat(((b.dots || 0) / b.balls * 100).toFixed(1)) : 0,
                    fours: b.fours || 0,
                    sixes: b.sixes || 0
                });
            }
        }
    }
    
    // Add/update current bowler with latest figures
    if (bowler?.name) {
        const figs = parseBowlerFigures(bowler.figs);
        const bowlerBalls = figs.balls || bowler.balls || 0;
        historyMap.set(bowler.name, {
            name: bowler.name,
            overs: ballsToOversString(bowlerBalls), // [BUG-06 FIX] Always derive from balls — avoids figs split edge case
            maidens: 0,
            runs: figs.runs || bowler.runs || 0,
            wickets: figs.wickets || bowler.wickets || 0,
            econ: bowlerBalls > 0 ? parseFloat(((figs.runs || bowler.runs || 0) / bowlerBalls * 6).toFixed(2)) : 0,
            dots: 0,
            dotPercent: 0,
            fours: 0,
            sixes: 0
        });
    }
    
    return Array.from(historyMap.values());
}

// [BUG-07 FIX] Use teamScore (team runs at dismissal time) not batsman individual runs
function buildFallOfWickets(dismissedPlayers) {
    if (!dismissedPlayers || !Array.isArray(dismissedPlayers)) return [];
    return dismissedPlayers.filter(function(p) { return typeof p === 'object' && p.name; }).map(function(p, i) {
        return {
            score: p.teamScore || p.runs || 0,
            wkt: i + 1,
            overs: p.overs || '0.0',
            batsman: p.name,
        };
    });
}

// [BUG-04 FIX] Build real partnerships array from tracked history
function buildPartnerships(partnershipHistory) {
    if (!partnershipHistory || !Array.isArray(partnershipHistory)) return [];
    return partnershipHistory.map(function(p) {
        return {
            bat1: p.bat1 || '',
            bat2: p.bat2 || '',
            runs: p.runs || 0,
            balls: p.balls || 0,
            bat1Runs: p.bat1Runs || 0,
            bat2Runs: p.bat2Runs || 0,
        };
    });
}

function buildOverByOver(overRunsHistory) {
    if (!overRunsHistory || !Array.isArray(overRunsHistory)) return [];
    let cum = 0;
    const result = overRunsHistory.map((e, i) => {
        cum += e.runs || 0;
        return { over: i + 1, runs: e.runs || 0, isWicket: !!e.isWicket, cumulative: cum, crr: parseFloat((cum / (i + 1)).toFixed(2)), keyBatter: '', balls: [] };
    });

    // [MISMATCH #4 FIX] Add current partial (incomplete) over data from matchState
    // so charts show live in-progress over runs instead of stopping at last complete over
    const currentOverBalls = matchState.thisOver || '';
    const currentOvers = matchState.overs || '0.0';
    const legalBallsInCurrentOver = currentOverBalls ? currentOverBalls.split(' ').filter(b => {
        const u = String(b).toUpperCase();
        return b && !u.includes('WD') && !u.includes('NB');
    }).length : 0;

    // Only add partial over if there are balls bowled in current over (< 6 legal balls = incomplete)
    if (legalBallsInCurrentOver > 0 && legalBallsInCurrentOver < 6) {
        const partialRuns = currentOverBalls.split(' ').filter(Boolean).reduce((sum, b) => {
            const u = String(b).toUpperCase();
            if (u.includes('WD')) return sum + (1 + (parseInt(u.replace(/WD/ig, ''), 10) || 0));
            if (u.includes('NB')) return sum + (1 + (parseInt(u.replace(/NB/ig, ''), 10) || 0));
            if (u === 'W' || u.startsWith('W')) return sum;
            return sum + (parseInt(b, 10) || 0);
        }, 0);
        const partialHasWicket = currentOverBalls.split(' ').some(b => {
            const u = String(b).toUpperCase();
            return u === 'W' || u.startsWith('W');
        });
        const overNum = result.length + 1;
        const partialCum = cum + partialRuns;
        const completedOversDecimal = parseFloat(currentOvers) || overNum;
        result.push({
            over: overNum,
            runs: partialRuns,
            isWicket: partialHasWicket,
            cumulative: partialCum,
            crr: completedOversDecimal > 0 ? parseFloat((partialCum / completedOversDecimal).toFixed(2)) : 0,
            keyBatter: '',
            balls: [],
            isPartial: true, // flag for UI to show differently if needed
        });
    }

    return result;
}

function buildMomentum(overRunsHistory) {
    if (!overRunsHistory||!Array.isArray(overRunsHistory)) return [];
    return overRunsHistory.map((e,i)=>{let v=(e.runs||0)-4;if(e.isWicket)v-=3;return{over:i+1,value:parseFloat(v.toFixed(1))};});
}

async function supabaseDualWrite(firebasePayload) {
    try {
        const sp = buildSupabasePayload(firebasePayload);
        const baseUrl = `${SUPABASE_CONFIG.URL}/rest/v1/match_live`;
        const headers = {
            'apikey': SUPABASE_CONFIG.SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_CONFIG.SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        };

        // [SCORE UPDATE FIX] Try PATCH first (row already exists — most common case)
        // If row missing (first run), fall back to POST (INSERT)
        const patchRes = await fetch(`${baseUrl}?match_id=eq.${SUPABASE_CONFIG.MATCH_ID}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(sp),
        });

        if (patchRes.ok) {
            updateSupabaseMirrorStatus('connected');
            console.log('📡 Supabase PATCH OK → CMS will update within ~8s');
            return;
        }

        // PATCH failed — if 404/406 try INSERT (first time setup)
        if (patchRes.status === 404 || patchRes.status === 406) {
            const postRes = await fetch(baseUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(sp),
            });
            if (postRes.ok) {
                updateSupabaseMirrorStatus('connected');
                console.log('📡 Supabase INSERT OK (first write)');
                return;
            }
            const errText = await postRes.text().catch(() => '');
            console.error(`❌ Supabase INSERT failed: ${postRes.status}`, errText);
            updateSupabaseMirrorStatus('error');
            showToast(`⚠️ CMS sync failed (${postRes.status}) — score may not update`, 'error');
            return;
        }

        // Other PATCH error
        const errText = await patchRes.text().catch(() => '');
        console.error(`❌ Supabase PATCH failed: ${patchRes.status} ${patchRes.statusText}`, errText);
        updateSupabaseMirrorStatus('error');
        showToast(`⚠️ CMS sync failed (${patchRes.status}) — score may not update`, 'error');

    } catch (e) {
        console.warn('⚠️ Supabase sync failed (network):', e?.message || e);
        updateSupabaseMirrorStatus('error');
        showToast('⚠️ CMS sync failed (network) — check internet connection', 'error');
    }
}

function updateSupabaseMirrorStatus(status) {
    // Reuse existing supabaseBadge - rename text to show mirror status
    const dot = document.querySelector('#supabaseBadge .conn-dot');
    const text = document.getElementById('supabaseStatus');
    if (!dot||!text) return;
    // Keep Firebase status as primary, append mirror status
    const fbStatus = text.textContent.replace(/ • Mirror:.*/, '');
    dot.className = 'conn-dot';
    if (status==='connected') { text.textContent = fbStatus + ' • Mirror: ✓'; dot.classList.add('good'); }
    else { text.textContent = fbStatus + ' • Mirror: ✗'; }
}

console.log('📡 Supabase Dual-Write Module V1.0 Loaded');