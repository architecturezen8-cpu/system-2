// ==========================================
// SCOREBAR.JS - V35.0 BUG-FIXED + MODERN CHARTS
// [Bug 51] XSS sanitization added
// [Bug 52] Command replay protection
// [Bug 53] Safe onerror handlers
// [Bug 54] Data validation layer
// [Bug 55] Timer race condition fixed
// [Bug 56] Ball classification fixed
// [Bug 57] Milestone false positive fixed
// [Bug 58] Debug shortcuts gated
// [Bug 59] Profile retry improved
// [Bug 60] Floating point overs fixed
// [Bug 61] Photo cleanup delayed
// [Bug 62] Summary auto-hide added
// [Bug 63] beforeunload cleaned up
// [Bug 64] Console logs gated
// [Bug 65] Division by zero in loadFirstInningsData
// [Bug 66] overlayManager.processQueue never called after clearActive
// [Bug 67] Missing payload in triggerHype from live data
// [Bug 68] Transform on inline span (winviz percent) doesn't work
// [Bug 69] Math.max(0, NaN) returns NaN in ballsRem calc
// [Bug 70] Milestone avatar fallback has no onerror handler
// [Bug 71] Wicket on WD/NB balls not detected
// [Bug 72] Bye boundary runs not highlighted
// [Bug 73] Worm/Manhattan chart not reset on new match
// [Bug 74] Worm chart comparison uses localStorage instead of Firebase
// [Bug 75] Chase start saves 1st innings data to localStorage for comparison
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
    }
};

// ==========================================
// OVERLAY MANAGER - First Come First Serve
// ==========================================
const overlayManager = {
    current: null,
    queue: [],

    canShow(name) {
        if (!this.current) return true;
        if (this.current === name) return true;
        return false;
    },

    setActive(name) {
        this.current = name;
    },

    clearActive(name) {
        if (this.current === name) {
            this.current = null;
            // [Bug 66] Process queued overlays after clearing
            this.processQueue();
        }
    },

    addToQueue(name, fn) {
        this.queue = this.queue.filter(q => q.name !== name);
        this.queue.push({
            name,
            fn
        });
    },

    processQueue() {
        if (this.current || this.queue.length === 0) return;
        const next = this.queue.shift();
        if (next) next.fn();
    },

    forceClose() {
        this.current = null;
        this.queue = [];
    }
};

// ==========================================
// ANIMATION QUEUE SYSTEM
// ==========================================
const animQueue = {
    items: [],
    isRunning: false,

    add(fn, priority = 0) {
        this.items.push({
            fn,
            priority
        });
        this.items.sort((a, b) => b.priority - a.priority);
        this.run();
    },

    // [Fix #7] Added try/catch around fn() so rejected promises don't freeze the queue.
    // Also added timeout safety: if a queued item's promise never resolves,
    // the queue won't get permanently stuck.
    async run() {
        if (this.isRunning || this.items.length === 0) return;
        this.isRunning = true;
        const item = this.items.shift();
        try {
            // Race the animation against a generous timeout (30s) to prevent permanent freeze
            await Promise.race([
                item.fn(),
                new Promise(resolve => setTimeout(resolve, 30000))
            ]);
        } catch (err) {
            log('animQueue: item threw error, continuing queue:', err);
        }
        this.isRunning = false;
        this.run();
    },

    clear() {
        this.items = [];
    }
};

const IS_DEBUG = new URLSearchParams(window.location.search).has('debug');

function log(...args) {
    if (IS_DEBUG) console.log(...args);
}

// ==========================================
// GLOBAL STATE
// ==========================================
let matchId = localStorage.getItem('matchId') || 'my_match_999';
let firebaseApp = null;
let database = null;
let lastDataReceived = 0;
let selfPingMs = null;
let presenceRefreshInterval = null;

let lastProcessedCommandTs = 0;
let commandListenerInitialized = false;

let presentDetailsGeneration = 0;
let winnerGeneration = 0;
let scorecardGeneration = 0;
let summaryAutoHideTimer = null;

let currentMatchData = {
    batTeam: '',
    bowlTeam: '',
    batFlag: '',
    bowlFlag: '',
    overs: '0.0',
    runs: 0,
    wkts: 0,
    target: 0,
    totOvers: 20,
    winProb: 50,
    bat1: {
        name: '',
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        isOut: false,
        photo: ''
    },
    bat2: {
        name: '',
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        isOut: false,
        photo: ''
    },
    bowler: {
        name: ''
    },
    dismissedPlayers: [],
    partRuns: 0,
    partBalls: 0
};

let animSettings = {
    fourDuration: 2500,
    sixDuration: 2500,
    wicketDuration: 3000,
    profileDuration: 5000,
    milestoneDuration: 8000,
    carouselInterval: 20000,
    viewHoldDuration: 7000,
    newBatterDelay: 1600,
    resultDelay: 3000,
    queueGap: 500
};

let currentView = 'view-bowler';
let carouselTimer = null;
let carouselLoop = null;
let lastForceTrig = '';
let autoCarouselEnabled = true;
let rotateViews = [];
let viewIndex = 0;

let prevStrikerId = null;
let prevB1Name = null;
let prevB2Name = null;
let prevBowlerName = null;
let prevBat1 = {
    name: '',
    runs: -1
};
let prevBat2 = {
    name: '',
    runs: -1
};

let autoMilestoneActive = false;
let autoMilestoneTimer = null;
let hypeTimeout = null;
let isPlayerProfileVisible = false;
let profileTimeout = null;
let newBatterTimeout = null;
let pendingUpcomingBatter = null;
let pendingUpcomingTimer = null;

let presentDetailsTimer = null;
let winnerTimer = null;
let matchScorecardTimer = null;

// ==========================================
// MODERN CHARTS GLOBALS
// ==========================================
let scorebarWormChart = null,
    scorebarManhattanChart = null,
    scorebarRunRateChart = null,
    scorebarWinVizChart = null,
    scorebarPartnershipChart = null,
    scorebarBoundariesChart = null;
let scorebarOverHistory = []; // { runs: number, isWicket: boolean }
let lastRecordedOverBalls = -1;
let lastRecordedScore = 0;
let lastRecordedWkts = 0;
let firstInningsRunsPerOver = [];
let firstInningsCumulative = [];
let chaseStarted = false; // [Bug 74] Track whether chase has started in current match
let firstInningsSavedToLocal = false; // [Bug 74] Track if 1st innings data saved to localStorage

// Track boundary/dot data for Boundaries vs Dots pie chart
let scorebarBoundaryStats = { fours: 0, sixes: 0, singles: 0, doubles: 0, triples: 0, dots: 0, extras: 0 };

// Track wides, no-balls and dot balls for Scoring Breakdown chart
// Track wides, no-balls and dot balls for Scoring Breakdown chart
let scorebarWideCount = 0;
let scorebarNoBallCount = 0;
let scorebarDotBallCount = 0;
let scorebarPrevThisOver = ''; // Track last processed thisOver to avoid double-counting
let scorebarPrevOverNumber = -1; // [FIX] Track over number for transition detection
let scorebarByeFourCount = 0;    // [FIX] Boundary bye fours (4B, 4LB)
let scorebarByeSixCount = 0;     // [FIX] Boundary bye sixes (6B, 6LB)

// ==========================================
// THOMIANS' MEDIA ANIMATED BRANDING HTML
// Reusable ms-footer component placed OUTSIDE and BELOW every table/chart
// Bottom center, outside the graphic/table structure
// ==========================================
function buildMsFooter() {
    return `<div class="ms-footer" style="background:none;"><div class="ms-footer-text"><div class="ms-footer-text-th">Thomians' </div><div class="ms-footer-text-me">Media</div><div class="ms-tm-logo"><span class="b"><span class="y"></span></span></div></div><div class="ms-footer-line"></div></div>`;
}

// ==========================================
// HELPER FUNCTIONS (Overs, Balls, HTML)
// ==========================================
function oversToBallsScorebar(oversStr) {
    const parts = String(oversStr || '0.0').split('.');
    const o = parseInt(parts[0] || '0', 10);
    let b = parseInt(parts[1] || '0', 10);
    if (b > 5) b = 5;
    return o * 6 + b;
}

// [Fix #1] Convert total balls to cricket overs notation string (e.g. 8 balls → "1.2", NOT 1.33)
// Always use this for DISPLAY, never use (balls/6).toFixed() which gives wrong cricket notation
function ballsToOversString(totalBalls) {
    const ovs = Math.floor((totalBalls || 0) / 6);
    const rem = (totalBalls || 0) % 6;
    return `${ovs}.${rem}`;
}

// [Fix #1] Convert total balls to exact decimal overs for RATE calculations (e.g. 8 balls → 1.333...)
// Use this for CRR/Economy/RRR calculations, NOT for display
function ballsToExactOvers(totalBalls) {
    return (totalBalls || 0) / 6;
}

function updateScorebarOverHistory() {
    if (!currentMatchData || !currentMatchData.overs) return;
    const currentBalls = oversToBallsScorebar(currentMatchData.overs);
    const currentOverInt = Math.floor(currentBalls / 6);
    const currentRuns = currentMatchData.runs;
    const currentWkts = currentMatchData.wkts || 0;
    const totOvers = currentMatchData.totOvers || 20;

    // --- BUG FIX: Reconcile chart total with actual score every update ---
    // If overHistory entries exist, fix cumulative drift so Manhattan/Worm always show correct totals
    if (scorebarOverHistory.length > 0 && lastRecordedOverBalls >= 0) {
        const chartTotal = scorebarOverHistory.reduce((s, o) => s + o.runs, 0);
        const drift = currentRuns - chartTotal;
        if (drift !== 0 && scorebarOverHistory.length > 0) {
            // Spread the correction across the last few overs to avoid a single huge bar
            const absDrift = Math.abs(drift);
            const oversToFix = Math.min(scorebarOverHistory.length, Math.max(1, absDrift));
            const perOver = Math.floor(drift / oversToFix);
            let remainder = drift - perOver * oversToFix;
            for (let i = scorebarOverHistory.length - oversToFix; i < scorebarOverHistory.length; i++) {
                scorebarOverHistory[i].runs = Math.max(0, scorebarOverHistory[i].runs + perOver + (remainder > 0 ? 1 : remainder < 0 ? -1 : 0));
                if (remainder > 0) remainder--;
                else if (remainder < 0) remainder++;
            }
        }
    }

    // First time loading or mid-match join - build baseline
    if (lastRecordedOverBalls === -1 && currentBalls > 0) {
        lastRecordedOverBalls = currentBalls;
        lastRecordedScore = currentRuns;
        lastRecordedWkts = currentWkts;

        // [Bug 74] If chase just started, skip mid-match estimation to avoid
        // using stale 1st innings overs/runs for 2nd innings chart population.
        // Wait for actual ball-by-ball data instead.
        if (chaseStarted && currentOverInt > 3) {
            log('[Bug 74] Skipping mid-match join estimation after chase start (overs=' + currentOverInt + ')');
            return;
        }

        // If we joined mid-match, populate over history
        // [Fix #5] Prefer Firebase overRunsHistory if available (accurate, cross-device synced)
        // Fall back to even distribution estimation if no Firebase data
        if (currentOverInt > 0 && scorebarOverHistory.length === 0) {
            const fbOverHistory = currentMatchData.overRunsHistory;
            if (Array.isArray(fbOverHistory) && fbOverHistory.length >= currentOverInt) {
                // Firebase data is available - use it directly (most accurate)
                scorebarOverHistory = fbOverHistory.slice(0, currentOverInt).map(o => ({
                    runs: parseInt(o.runs) || 0,
                    isWicket: !!o.isWicket
                }));
                log('[Fix #5] Loaded overRunsHistory from Firebase:', scorebarOverHistory.length, 'overs');
            } else {
                // No Firebase data - estimate evenly (legacy fallback)
                const avgPerOver = currentRuns / currentOverInt;
                scorebarOverHistory = [];
                for (let i = 0; i < currentOverInt; i++) {
                    scorebarOverHistory.push({
                        runs: Math.round(avgPerOver),
                        isWicket: false
                    });
                }
                // Adjust last over to make total exactly match actual runs
                const estimatedTotal = scorebarOverHistory.reduce((s, o) => s + o.runs, 0);
                if (estimatedTotal !== currentRuns && scorebarOverHistory.length > 0) {
                    scorebarOverHistory[scorebarOverHistory.length - 1].runs += (currentRuns - estimatedTotal);
                    scorebarOverHistory[scorebarOverHistory.length - 1].runs = Math.max(0, scorebarOverHistory[scorebarOverHistory.length - 1].runs);
                }
                // Spread wickets evenly across overs
                if (currentWkts > 0 && scorebarOverHistory.length > 0) {
                    const step = Math.max(1, Math.floor(scorebarOverHistory.length / currentWkts));
                    for (let w = 0; w < currentWkts; w++) {
                        const idx = Math.min(scorebarOverHistory.length - 1 - w * step, scorebarOverHistory.length - 1);
                        if (idx >= 0) scorebarOverHistory[idx].isWicket = true;
                    }
                }
            }
        }
        return;
    }

    // Handle overs advancing
    const lastOverInt = Math.floor(lastRecordedOverBalls / 6);
    // [Bug 75] Detect overs going backwards = match was reset, clear over history
    // BUT skip this if chaseStarted (already handled in processLiveData)
    if (currentOverInt < lastOverInt && currentBalls <= 6 && currentRuns <= 1 && !chaseStarted) {
        scorebarOverHistory = [];
        lastRecordedOverBalls = -1;
        lastRecordedScore = 0;
        lastRecordedWkts = 0;
        return;
    }
    if (currentOverInt > lastOverInt) {
        const oversAdvanced = currentOverInt - lastOverInt;
        if (oversAdvanced === 1) {
            // Normal case: exactly one over completed
            const runsInOver = currentRuns - lastRecordedScore;
            const wicketInOver = currentWkts > lastRecordedWkts;
            scorebarOverHistory.push({
                runs: Math.max(0, runsInOver),
                isWicket: wicketInOver
            });
        } else {
            // Multiple overs advanced - distribute runs evenly (no random)
            const totalNewRuns = currentRuns - lastRecordedScore;
            const totalNewWkts = currentWkts - lastRecordedWkts;
            const basePerOver = Math.floor(totalNewRuns / oversAdvanced);
            let extraRuns = totalNewRuns - basePerOver * oversAdvanced;

            // Determine which overs have wickets - space them evenly
            const wicketOvers = new Set();
            if (totalNewWkts > 0) {
                const wicketStep = Math.max(1, Math.floor(oversAdvanced / totalNewWkts));
                for (let w = 0; w < totalNewWkts; w++) {
                    const overIdx = Math.min(oversAdvanced - 1 - w * wicketStep, oversAdvanced - 1);
                    wicketOvers.add(Math.max(0, overIdx));
                }
            }

            for (let i = 0; i < oversAdvanced; i++) {
                // Distribute runs: base + 1 extra for the first 'extraRuns' overs
                let overRuns = basePerOver + (i < extraRuns ? 1 : 0);
                scorebarOverHistory.push({
                    runs: Math.max(0, overRuns),
                    isWicket: wicketOvers.has(i)
                });
            }
        }
        // Cap history at total overs (not hardcoded 20)
        while (scorebarOverHistory.length > totOvers) scorebarOverHistory.shift();
        lastRecordedOverBalls = currentBalls;
        lastRecordedScore = currentRuns;
        lastRecordedWkts = currentWkts;
    }
}

// [Worm Fix] Cache for 1st innings data loaded from Firebase (avoids repeated reads)
let firstInningsFirebaseCache = null; // { overRunsHistory: [{r,w}], teamShortName, teamFullName }

// [Worm Fix] Load 1st innings overRunsHistory from Firebase (cross-device, low bandwidth)
// Reads from matches/{matchId}/first_innings - only fetched once then cached
async function loadFirstInningsDataFromFirebase() {
    if (!database || !matchId) return false;
    // Return cached data if already loaded
    if (firstInningsFirebaseCache && firstInningsFirebaseCache.overRunsHistory) {
        const hist = firstInningsFirebaseCache.overRunsHistory;
        if (Array.isArray(hist) && hist.length > 0) {
            firstInningsRunsPerOver = hist.map(o => o.r || o.runs || 0);
            let cum = 0;
            firstInningsCumulative = [];
            for (let runs of firstInningsRunsPerOver) {
                cum += runs;
                firstInningsCumulative.push(cum);
            }
            log('[Worm Fix] Using cached Firebase 1st innings data:', firstInningsRunsPerOver.length, 'overs');
            return true;
        }
    }
    try {
        const snap = await database.ref(`matches/${matchId}/first_innings`).once('value');
        const data = snap.val();
        if (!data) {
            log('[Worm Fix] No first_innings data in Firebase');
            return false;
        }
        // Cache the entire first_innings object for team name lookups too
        firstInningsFirebaseCache = data;
        const hist = data.overRunsHistory;
        if (!Array.isArray(hist) || hist.length === 0) {
            log('[Worm Fix] Firebase first_innings has no overRunsHistory');
            return false;
        }
        // Use short keys {r, w} to save Firebase bandwidth
        firstInningsRunsPerOver = hist.map(o => o.r || o.runs || 0);
        let cum = 0;
        firstInningsCumulative = [];
        for (let runs of firstInningsRunsPerOver) {
            cum += runs;
            firstInningsCumulative.push(cum);
        }
        log('[Worm Fix] Loaded 1st innings data from Firebase:', firstInningsRunsPerOver.length, 'overs, total:', cum, 'runs');
        return true;
    } catch (e) {
        log('[Worm Fix] Error loading 1st innings from Firebase:', e);
        return false;
    }
}

// [Bug 74] Load first innings data from localStorage (saved when chase started)
// This avoids stale Firebase data from previous matches
function loadFirstInningsDataFromLocal() {
    try {
        const key = `firstInningsData_${matchId}`;
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.overHistory)) return false;
        firstInningsRunsPerOver = parsed.overHistory.map(o => o.runs || 0);
        let cum = 0;
        firstInningsCumulative = [];
        for (let runs of firstInningsRunsPerOver) {
            cum += runs;
            firstInningsCumulative.push(cum);
        }
        log('[Bug 74] Loaded 1st innings data from localStorage:', firstInningsRunsPerOver.length, 'overs');
        return true;
    } catch (e) {
        log('[Bug 74] Error loading 1st innings from localStorage:', e);
        return false;
    }
}

// [Bug 74] Save current overHistory to localStorage as 1st innings data
function saveFirstInningsDataToLocal() {
    try {
        const key = `firstInningsData_${matchId}`;
        const data = {
            overHistory: scorebarOverHistory.map(o => ({ runs: o.runs, isWicket: o.isWicket })),
            batTeam: currentMatchData.batFlag || '',
            bowlTeam: currentMatchData.bowlFlag || '',
            timestamp: Date.now()
        };
        localStorage.setItem(key, JSON.stringify(data));
        firstInningsSavedToLocal = true;
        log('[Bug 74] Saved 1st innings data to localStorage:', scorebarOverHistory.length, 'overs');
    } catch (e) {
        log('[Bug 74] Error saving 1st innings to localStorage:', e);
    }
}

// [Bug 74] Clear 1st innings data from localStorage
function clearFirstInningsDataFromLocal() {
    try {
        const key = `firstInningsData_${matchId}`;
        localStorage.removeItem(key);
        log('[Bug 74] Cleared 1st innings data from localStorage');
    } catch (e) {
        log('[Bug 74] Error clearing 1st innings from localStorage:', e);
    }
}

// [Bug 74] Get saved 1st innings team name - tries localStorage then Firebase cache
function getFirstInningsTeamName() {
    // Try localStorage first
    try {
        const key = `firstInningsData_${matchId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.batTeam) return parsed.batTeam;
        }
    } catch (e) { }
    // [Worm Fix] Try Firebase cache (cross-device)
    if (firstInningsFirebaseCache) {
        return firstInningsFirebaseCache.teamShortName || currentMatchData.bowlFlag || 'Team 1';
    }
    return currentMatchData.bowlFlag || 'Team 1';
}

async function loadFirstInningsData(forceRefresh = false) {
    if (!forceRefresh && firstInningsRunsPerOver.length > 0) return true;

    // [Bug 74] During 1st innings (no target), don't load any comparison data
    const target = currentMatchData?.target || 0;
    if (target <= 0 && !forceRefresh) {
        firstInningsRunsPerOver = [];
        firstInningsCumulative = [];
        return true;
    }

    // [Worm Fix] Priority 1: Try localStorage first (instant, no Firebase read)
    if (loadFirstInningsDataFromLocal()) return true;

    // [Worm Fix] Priority 2: Try Firebase (cross-device - works when scorer scores 2nd inning)
    // This is the KEY fix: Firebase has 1st innings data saved by admin when chase started
    const fbLoaded = await loadFirstInningsDataFromFirebase();
    if (fbLoaded) return true;

    // [Bug 74] Fallback: if no localStorage data and we have current overHistory
    // (e.g., chase just started but save hasn't happened yet), use it directly
    if (scorebarOverHistory.length > 0 && target > 0) {
        firstInningsRunsPerOver = scorebarOverHistory.map(o => o.runs || 0);
        let cum = 0;
        firstInningsCumulative = [];
        for (let runs of firstInningsRunsPerOver) {
            cum += runs;
            firstInningsCumulative.push(cum);
        }
        return true;
    }

    // [Bug 74] Last resort: if target exists but no data available, estimate from target
    if (target > 0) {
        const overs = parseFloat(currentMatchData?.totOvers || 20);
        const firstTotal = target - 1;
        const oversInt = Math.max(1, Math.floor(overs));
        const basePerOver = Math.floor(firstTotal / oversInt);
        let extraRuns = firstTotal - basePerOver * oversInt;
        firstInningsRunsPerOver = [];
        for (let i = 0; i < oversInt; i++) {
            let runs = basePerOver + (i < extraRuns ? 1 : 0);
            firstInningsRunsPerOver.push(Math.max(0, runs));
        }
        let cum = 0;
        firstInningsCumulative = [];
        for (let runs of firstInningsRunsPerOver) {
            cum += runs;
            firstInningsCumulative.push(cum);
        }
        return true;
    }

    firstInningsRunsPerOver = [];
    firstInningsCumulative = [];
    return true;
}

function buildWormDataScorebar() {
    const target = currentMatchData.target || 0;
    const currentOvers = Math.floor(oversToBallsScorebar(currentMatchData.overs) / 6);
    const isChase = target > 0; // 2nd innings (chase) is active

    // Build the current batting team's cumulative data (from over history)
    let battingCumulative = [];
    let cum = 0;
    for (let i = 0; i < scorebarOverHistory.length; i++) {
        cum += scorebarOverHistory[i].runs;
        battingCumulative.push(cum);
    }

    // Build the other team's line (1st innings data for comparison)
    let firstInningsCumulativeData = [];
    if (isChase) {
        // 2nd innings: Show 1st innings team's data for comparison
        if (firstInningsCumulative.length > 0) {
            firstInningsCumulativeData = [...firstInningsCumulative];
        } else if (target > 0) {
            // No 1st innings data loaded yet - estimate from target
            for (let i = 1; i <= currentOvers; i++) {
                firstInningsCumulativeData.push(Math.floor((target - 1) * (i / currentOvers)));
            }
        }
    } else {
        // 1st innings: No comparison needed - bowling team hasn't batted yet
        // Show a flat 0 line (or empty) so only batting team's line is visible
        firstInningsCumulativeData = [];
    }

    const maxOvers = Math.max(firstInningsCumulativeData.length, battingCumulative.length, 1);
    const labels = Array.from({
        length: maxOvers
    }, (_, i) => `Over ${i + 1}`);

    return {
        labels,
        firstInningsRuns: firstInningsCumulativeData,
        secondInningsRuns: battingCumulative,
        isChase
    };
}

async function renderWormGraphScorebar() {
    const canvas = document.getElementById('wormChartCanvas');
    if (!canvas) return;
    // [Bug 74 + Worm Fix] Load 1st innings data - tries localStorage then Firebase
    await loadFirstInningsData();
    // [Fix #3] Safe destroy with try/catch to prevent memory leak on corrupted chart state
    try { if (scorebarWormChart) scorebarWormChart.destroy(); } catch (e) { log('Chart destroy error:', e); }
    const {
        labels,
        firstInningsRuns,
        secondInningsRuns,
        isChase
    } = buildWormDataScorebar();
    if (labels.length === 0 || secondInningsRuns.length === 0) return;
    const ctx = canvas.getContext('2d');
    const gradient1 = ctx.createLinearGradient(0, 0, 0, 200);
    gradient1.addColorStop(0, 'rgba(59,130,246,0.4)');
    gradient1.addColorStop(1, 'rgba(59,130,246,0)');
    const gradient2 = ctx.createLinearGradient(0, 0, 0, 200);
    gradient2.addColorStop(0, 'rgba(248,180,0,0.4)');
    gradient2.addColorStop(1, 'rgba(248,180,0,0)');

    const datasets = [];

    if (isChase) {
        // 2nd innings (chase): Show both team lines for comparison
        // [Bug 74] Use saved 1st innings team name from localStorage
        const firstInnTeam = getFirstInningsTeamName();
        datasets.push({
            label: `${firstInnTeam} (1st Inn)`,
            data: firstInningsRuns,
            borderColor: '#3b82f6',
            backgroundColor: gradient1,
            borderWidth: 3,
            fill: true,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6
        });
        datasets.push({
            label: `${currentMatchData.batFlag || 'Team 2'} (2nd Inn)`,
            data: secondInningsRuns,
            borderColor: '#F8B400',
            backgroundColor: gradient2,
            borderWidth: 3,
            fill: true,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    } else {
        // 1st innings: Show only batting team's line building up
        // Bowling team line is hidden (they haven't batted yet)
        datasets.push({
            label: `${currentMatchData.batFlag || 'Batting'} (1st Inn)`,
            data: secondInningsRuns,
            borderColor: '#F8B400',
            backgroundColor: gradient2,
            borderWidth: 3,
            fill: true,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    }

    scorebarWormChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1200,
                easing: 'easeOutQuart',
                delay: (ctx) => ctx.dataIndex * 50
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top',
                    labels: {
                        color: '#fff',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Cumulative Runs',
                        color: '#aaa'
                    },
                    grid: {
                        color: 'rgba(255,255,255,0.05)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Overs',
                        color: '#aaa'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderManhattanGraphScorebar() {
    const canvas = document.getElementById('manhattanChartCanvas');
    if (!canvas) return;
    // [Fix #3] Safe destroy with try/catch to prevent memory leak on corrupted chart state
    try { if (scorebarManhattanChart) scorebarManhattanChart.destroy(); } catch (e) { log('Chart destroy error:', e); }
    const labels = scorebarOverHistory.map((_, i) => `Over ${i + 1}`);
    const runs = scorebarOverHistory.map(o => o.runs);
    // Color-code: gold for normal overs, red for wicket overs
    const bgColors = scorebarOverHistory.map(o => o.isWicket ? 'rgba(239, 68, 68, 0.85)' : 'rgba(248, 180, 0, 0.75)');
    const borderColors = scorebarOverHistory.map(o => o.isWicket ? '#ef4444' : '#F8B400');
    if (labels.length === 0) return;
    scorebarManhattanChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Runs Scored',
                data: runs,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 6,
                barPercentage: 0.7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1000,
                easing: 'easeOutBounce',
                delay: (ctx) => ctx.dataIndex * 80
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const isW = scorebarOverHistory[ctx.dataIndex]?.isWicket;
                            return `${ctx.raw} runs${isW ? ' 🔴 WICKET' : ''}`;
                        }
                    }
                },
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Runs',
                        color: '#aaa'
                    },
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255,255,255,0.05)'
                    }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        autoSkip: true
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function calculateRunRateHistoryScorebar() {
    let cum = 0;
    const totalBallsBowled = oversToBallsScorebar(currentMatchData.overs);
    const completedOvers = Math.floor(totalBallsBowled / 6); // full overs completed
    // [Fix #1] Use ballsToExactOvers for rate calculation, not balls/6 inline
    const totalExactOvers = ballsToExactOvers(totalBallsBowled);

    return scorebarOverHistory.map((over, idx) => {
        cum += over.runs;
        const overNum = idx + 1;
        let runRate;
        if (overNum <= completedOvers) {
            // This over is fully completed - CRR at end of that over
            runRate = cum / overNum;
        } else {
            // Last (incomplete) over - include partial over balls for accuracy
            // This matches the scorebar's CRR calculation: runs / (balls/6)
            runRate = totalExactOvers > 0 ? cum / totalExactOvers : 0;
        }
        return {
            over: overNum,
            runRate: parseFloat(runRate.toFixed(2))
        };
    });
}

function renderRunRateGraphScorebar() {
    const canvas = document.getElementById('runRateChartCanvas');
    if (!canvas) return;
    // [Fix #3] Safe destroy with try/catch to prevent memory leak on corrupted chart state
    try { if (scorebarRunRateChart) scorebarRunRateChart.destroy(); } catch (e) { log('Chart destroy error:', e); }
    const rrHistory = calculateRunRateHistoryScorebar();
    if (rrHistory.length === 0) return;
    const labels = rrHistory.map(r => `Over ${r.over}`);
    const rates = rrHistory.map(r => r.runRate);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(16,185,129,0.4)');
    gradient.addColorStop(1, 'rgba(16,185,129,0)');

    const datasets = [{
        label: 'Run Rate (CRR)',
        data: rates,
        borderColor: '#10b981',
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#10b981'
    }];

    // Add Required Run Rate line if in chase mode
    const target = currentMatchData.target || 0;
    if (target > 0) {
        const totOvers = currentMatchData.totOvers || 20;
        const balls = oversToBallsScorebar(currentMatchData.overs);
        const remainingBalls = Math.max(0, (totOvers * 6) - balls);
        // [Fix #1 & #4] Use ballsToExactOvers for rate calc, guard division by zero
        const remainingOvers = ballsToExactOvers(remainingBalls);
        const runsNeeded = target - currentMatchData.runs;
        // [Fix #4] RRR: never divide by zero, cap at reasonable max to avoid Infinity
        const rrr = (remainingBalls > 0 && runsNeeded > 0) ? runsNeeded / remainingOvers : 0;

        if (rrr > 0) {
            // RRR line - horizontal reference line showing what rate is needed from THIS point onward
            const rrrData = rrHistory.map(() => parseFloat(rrr.toFixed(2)));
            datasets.push({
                label: `Req. Rate (${rrr.toFixed(1)})`,
                data: rrrData,
                borderColor: 'rgba(239, 68, 68, 0.7)',
                borderWidth: 2,
                borderDash: [8, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 0
            });
        }
    }

    scorebarRunRateChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1100,
                easing: 'easeOutQuart',
                delay: (ctx) => ctx.dataIndex * 60
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top',
                    labels: {
                        color: '#fff',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Run Rate',
                        color: '#aaa'
                    },
                    grid: {
                        color: 'rgba(255,255,255,0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderWinVizScorebar() {
    const canvas = document.getElementById('winVizCanvas');
    if (!canvas) return;
    try { if (scorebarWinVizChart) scorebarWinVizChart.destroy(); } catch (e) { log('Chart destroy error:', e); }

    const winProb = currentMatchData.winProb || 50;
    const batTeam = currentMatchData.batFlag || 'BAT';
    const bowlTeam = currentMatchData.bowlFlag || 'BOWL';
    const bowlProb = 100 - winProb;

    // Clean up old overlays
    const container = canvas.parentNode;
    container.querySelectorAll('.winviz-center-stat, .winviz-label-group, .winviz-line-svg, .winviz-ring-pulse, .winviz-progress-bar').forEach(el => el.remove());

    // --- Create the Chart.js donut ---
    scorebarWinVizChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: [`${batTeam} (${winProb}%)`, `${bowlTeam} (${bowlProb}%)`],
            datasets: [{
                data: [winProb, bowlProb],
                backgroundColor: ['rgba(248, 180, 0, 0.25)', 'rgba(59, 130, 246, 0.18)'],
                borderColor: ['#F8B400', '#3b82f6'],
                borderWidth: 2.5,
                cutout: '70%',
                borderRadius: 8,
                spacing: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1500,
                easing: 'easeOutQuart'
            },
            plugins: {
                tooltip: { enabled: false },
                legend: { display: false }
            },
            layout: { padding: 6 }
        }
    });

    // --- Center glassmorphism stat inside donut ---
    const centerDiv = document.createElement('div');
    centerDiv.className = 'winviz-center-stat';
    centerDiv.innerHTML = `
        <span class="winviz-desc">WIN</span>
        <span class="winviz-percent" id="winvizPercentValue">0%</span>
        <span class="winviz-sub-label">${batTeam}</span>
    `;
    centerDiv.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        text-align: center;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(12px);
        width: 62%;
        height: 62%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        border-radius: 50%;
        border: 1px solid rgba(248,180,0,0.4);
        box-shadow: 0 0 25px rgba(248,180,0,0.2);
        z-index: 10;
        pointer-events: none;
        font-family: 'Montserrat', sans-serif;
        opacity: 0;
        transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease;
    `;
    container.style.position = 'relative';
    container.appendChild(centerDiv);

    requestAnimationFrame(() => {
        setTimeout(() => {
            centerDiv.style.opacity = '1';
            centerDiv.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 300);
    });

    // Ring pulse
    for (let i = 0; i < 2; i++) {
        const ring = document.createElement('div');
        ring.className = 'winviz-ring-pulse';
        ring.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 62%;
            aspect-ratio: 1;
            border-radius: 50%;
            border: 2px solid rgba(248, 180, 0, 0.4);
            transform: translate(-50%, -50%) scale(1);
            opacity: 0;
            z-index: 9;
            pointer-events: none;
            animation: winvizRingPulse 2s ease-out infinite;
            animation-delay: ${1.5 + i * 0.8}s;
        `;
        container.appendChild(ring);
    }

    // --- Counting animation for center percent ---
    const percentEl = centerDiv.querySelector('.winviz-percent');
    if (percentEl) percentEl.style.display = 'inline-block';
    const animDuration = 1500;
    const animStart = performance.now();

    function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function animateCount(now) {
        const elapsed = now - animStart;
        const progress = Math.min(elapsed / animDuration, 1);
        const easedProgress = easeOutExpo(progress);
        const currentValue = Math.round(easedProgress * winProb);
        percentEl.innerText = `${currentValue}%`;
        const glowIntensity = 10 + (easedProgress * 15);
        percentEl.style.textShadow = `0 0 ${glowIntensity}px #F8B400, 0 0 ${glowIntensity * 2}px rgba(248,180,0,0.3)`;
        if (progress < 1) {
            requestAnimationFrame(animateCount);
        } else {
            percentEl.innerText = `${winProb}%`;
            animFinished = true;
            percentEl.style.transform = 'scale(1.15)';
            setTimeout(() => {
                percentEl.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
                percentEl.style.transform = 'scale(1)';
            }, 100);
            percentEl.style.animation = 'winvizPercentPulse 2s ease-in-out infinite';
        }
    }
    setTimeout(() => requestAnimationFrame(animateCount), 500);

    // --- Update side panel team names and percentages ---
    const batTeamEl = document.getElementById('winvizBatTeam');
    const batPctEl = document.getElementById('winvizBatPct');
    const bowlTeamEl = document.getElementById('winvizBowlTeam');
    const bowlPctEl = document.getElementById('winvizBowlPct');
    if (batTeamEl) batTeamEl.textContent = batTeam;
    if (bowlTeamEl) bowlTeamEl.textContent = bowlTeam;

    // Animate side panel percentages
    const sideAnimStart = performance.now() + 300;
    function animateSide(now) {
        const elapsed = now - sideAnimStart;
        if (elapsed < 0) { requestAnimationFrame(animateSide); return; }
        const progress = Math.min(elapsed / animDuration, 1);
        const ep = easeOutExpo(progress);
        if (batPctEl) batPctEl.textContent = `${Math.round(ep * winProb)}%`;
        if (bowlPctEl) bowlPctEl.textContent = `${Math.round(ep * bowlProb)}%`;
        if (progress < 1) {
            requestAnimationFrame(animateSide);
        } else {
            if (batPctEl) batPctEl.textContent = `${winProb}%`;
            if (bowlPctEl) bowlPctEl.textContent = `${bowlProb}%`;
        }
    }
    requestAnimationFrame(animateSide);

    // --- Animated prediction bar ---
    const batFill = document.getElementById('winvizBatFill');
    const bowlFill = document.getElementById('winvizBowlFill');
    setTimeout(() => {
        if (batFill) batFill.style.width = `${winProb}%`;
        if (bowlFill) bowlFill.style.width = `${bowlProb}%`;
    }, 600);
}

function calculateProjectedScoreScorebar() {
    const balls = oversToBallsScorebar(currentMatchData.overs);
    const runs = currentMatchData.runs;
    const totOvers = currentMatchData.totOvers || 20;
    if (balls === 0) return 0;
    // [Fix #1] Use ballsToExactOvers for rate calculations
    const oversBowled = ballsToExactOvers(balls);
    // [Fix #2] Guard division by zero - balls > 0 ensures oversBowled > 0
    const crr = oversBowled > 0 ? runs / oversBowled : 0;
    const remainingBalls = Math.max(0, (totOvers * 6) - balls);
    if (remainingBalls <= 0) return runs; // All overs bowled
    // [Fix #1] Use ballsToExactOvers instead of remainingBalls / 6
    const remainingOvers = ballsToExactOvers(remainingBalls);
    // If chasing and behind, factor in required acceleration slightly
    const target = currentMatchData.target || 0;
    let projectedCrr = crr;
    if (target > 0 && runs < target) {
        const runsNeeded = target - runs;
        // [Fix #2 & #4] Guard division by zero for RRR
        const reqRate = remainingBalls > 0 ? runsNeeded / remainingOvers : crr;
        // Blend: weight toward CRR if CRR > RRR, weight toward RRR if behind
        projectedCrr = crr >= reqRate ? crr : (crr * 0.6 + reqRate * 0.4);
    }
    return Math.floor(runs + projectedCrr * remainingOvers);
}

function updateProjectedScoreScorebar() {
    const proj = calculateProjectedScoreScorebar();
    const el = document.getElementById('projectedScoreValue');
    if (el) {
        el.innerText = proj;
        el.classList.remove('pop-update');
        void el.offsetWidth;
        el.classList.add('pop-update');
    }
}

// ==========================================
// PARTNERSHIP CHART
// Shows current partnership + past partnerships with player photos
// ==========================================
function renderPartnershipChartScorebar() {
    const canvas = document.getElementById('partnershipChartCanvas');
    if (!canvas) return;
    try { if (scorebarPartnershipChart) scorebarPartnershipChart.destroy(); } catch (e) { log('Chart destroy error:', e); }

    // Force parent container to have computed height before Chart.js reads it
    const chartArea = canvas.closest('.partnership-chart-area');
    if (chartArea) {
        void chartArea.offsetHeight;
    }

    const bat1 = currentMatchData.bat1 || {};
    const bat2 = currentMatchData.bat2 || {};
    const partRuns = currentMatchData.partRuns || 0;
    const partBalls = currentMatchData.partBalls || 0;
    const dismissed = currentMatchData.dismissedPlayers || [];

    // Build partnership data: past partnerships from dismissed players + current
    const partnerships = [];

    // Estimate past partnerships from dismissed players
    // Group consecutive dismissed players as partnerships
    let cumRuns = 0;
    const totalRuns = currentMatchData.runs || 0;

    if (dismissed.length > 0) {
        // Distribute runs across partnerships proportionally
        let runsAccounted = 0;
        for (let i = 0; i < dismissed.length; i++) {
            const p = dismissed[i];
            const pRuns = p.runs || 0;
            const pName = typeof p === 'string' ? p : (p.name || 'Batter');
            // Each wicket represents end of a partnership
            const partnershipRuns = i === 0 ? pRuns : Math.max(0, pRuns - (dismissed[i - 1]?.runs || 0));
            partnerships.push({
                label: `${pName}`,
                runs: pRuns,
                balls: p.balls || 0,
                isCurrent: false
            });
            runsAccounted += pRuns;
        }
    }

    // Current partnership
    const currentPartRuns = partRuns > 0 ? partRuns : (bat1.runs || 0) + (bat2.runs || 0);
    const currentPartBalls = partBalls > 0 ? partBalls : (bat1.balls || 0) + (bat2.balls || 0);
    const currentPartStrikeRate = currentPartBalls > 0 ? ((currentPartRuns / currentPartBalls) * 100).toFixed(1) : '0.0';

    if (bat1.name || bat2.name) {
        partnerships.push({
            label: `${bat1.name || 'B1'} & ${bat2.name || 'B2'}`,
            runs: currentPartRuns,
            balls: currentPartBalls,
            isCurrent: true
        });
    }

    if (partnerships.length === 0) {
        partnerships.push({ label: 'No Data', runs: 0, balls: 0, isCurrent: true });
    }

    const labels = partnerships.map(p => p.label);
    const runsData = partnerships.map(p => p.runs);
    const bgColors = partnerships.map(p => p.isCurrent ? 'rgba(248, 180, 0, 0.85)' : 'rgba(59, 130, 246, 0.65)');
    const borderColors = partnerships.map(p => p.isCurrent ? '#F8B400' : '#3b82f6');

    scorebarPartnershipChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Partnership Runs',
                data: runsData,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.65
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 1200,
                easing: 'easeOutBounce',
                delay: (ctx) => ctx.dataIndex * 150
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const p = partnerships[ctx.dataIndex];
                            const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : '0.0';
                            return `${ctx.raw} runs (${p.balls} balls, SR: ${sr})`;
                        }
                    }
                },
                legend: { display: false }
            },
            scales: {
                y: {
                    title: { display: true, text: 'Runs', color: '#aaa' },
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: { maxRotation: 30, font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });

    // Update partnership info cards
    const partRunsEl = document.getElementById('partChartRuns');
    const partBallsEl = document.getElementById('partChartBalls');
    const partSREl = document.getElementById('partChartSR');
    const bat1NameEl = document.getElementById('partChartBat1Name');
    const bat2NameEl = document.getElementById('partChartBat2Name');
    const bat1PhotoEl = document.getElementById('partChartBat1Photo');
    const bat2PhotoEl = document.getElementById('partChartBat2Photo');

    if (partRunsEl) partRunsEl.textContent = currentPartRuns;
    if (partBallsEl) partBallsEl.textContent = currentPartBalls;
    if (partSREl) partSREl.textContent = currentPartStrikeRate;
    if (bat1NameEl) bat1NameEl.textContent = (bat1.name || 'Batter 1').toUpperCase();
    if (bat2NameEl) bat2NameEl.textContent = (bat2.name || 'Batter 2').toUpperCase();

    // Player photos
    if (bat1PhotoEl) {
        const src1 = normalizeProfilePhotoSrc(bat1.photo || '');
        if (src1) {
            bat1PhotoEl.innerHTML = `<img src="${src1}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;color:#F8B400;">${(bat1.name || 'B1').substring(0, 2).toUpperCase()}</span>`;
        } else {
            bat1PhotoEl.innerHTML = `<span style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;color:#F8B400;">${(bat1.name || 'B1').substring(0, 2).toUpperCase()}</span>`;
        }
    }
    if (bat2PhotoEl) {
        const src2 = normalizeProfilePhotoSrc(bat2.photo || '');
        if (src2) {
            bat2PhotoEl.innerHTML = `<img src="${src2}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;color:#3b82f6;">${(bat2.name || 'B2').substring(0, 2).toUpperCase()}</span>`;
        } else {
            bat2PhotoEl.innerHTML = `<span style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;color:#3b82f6;">${(bat2.name || 'B2').substring(0, 2).toUpperCase()}</span>`;
        }
    }
}

// ==========================================
// SCORING BREAKDOWN PIE CHART
// Shows ball count distribution: Sixes, Fours, Dot Balls, Runs (1,2,3)
// ==========================================
function updateBoundaryStatsScorebar() {
    const bat1 = currentMatchData.bat1 || {};
    const bat2 = currentMatchData.bat2 || {};
    const dismissed = currentMatchData.dismissedPlayers || [];
    const totalRuns = currentMatchData.runs || 0;
    const totalBalls = oversToBallsScorebar(currentMatchData.overs);

    // සියලුම පිතිකරුවන්ගෙන් (current + dismissed) boundary ගණන් කරනවා
    let totalFours = 0, totalSixes = 0;
    totalFours += (bat1.fours || 0) + (bat2.fours || 0);
    totalSixes += (bat1.sixes || 0) + (bat2.sixes || 0);
    for (const p of dismissed) {
        if (typeof p === 'object') {
            totalFours += (p.fours || 0);
            totalSixes += (p.sixes || 0);
        }
    }

    // [FIX] Boundary byes (4B, 4LB, 6B, 6LB) thisOver එකෙන් track කරපු ඒවා එකතු කරනවා
    totalFours += scorebarByeFourCount || 0;
    totalSixes += scorebarByeSixCount || 0;

    const boundaryRuns = (totalFours * 4) + (totalSixes * 6);
    const otherRuns = Math.max(0, totalRuns - boundaryRuns);

    // [FIX] Dot balls වලට දැන් Wickets (W) deliveries ඇතුළත් වෙනවා
    const dotBalls = scorebarDotBallCount || 0;
    const wideCount = scorebarWideCount || 0;
    const noBallCount = scorebarNoBallCount || 0;

    // [FIX] අනිකුත් scoring balls (1,2,3,5) = legal balls - fours - sixes - dots
    const otherScoringBalls = Math.max(0, totalBalls - totalFours - totalSixes - dotBalls);

    scorebarBoundaryStats = {
        fours: totalFours,
        sixes: totalSixes,
        boundaryRuns,
        otherRuns,
        dotBalls,
        otherScoringBalls,
        wideCount,
        noBallCount,
        totalFoursCount: totalFours,
        totalSixesCount: totalSixes,
        totalBalls
    };
}

function renderBoundariesPieChartScorebar() {
    const canvas = document.getElementById('boundariesChartCanvas');
    if (!canvas) return;
    try { if (scorebarBoundariesChart) scorebarBoundariesChart.destroy(); } catch (e) { log('Chart destroy error:', e); }

    updateBoundaryStatsScorebar();
    const stats = scorebarBoundaryStats;

    // [FIX] Total deliveries = ලොට් එකේ සියලුම categories වල එකතුව (double-count නැතුව)
    const sixesCount = stats.totalSixesCount || 0;
    const foursCount = stats.totalFoursCount || 0;
    const dotBallsCount = stats.dotBalls || 0;
    const otherScoringCount = stats.otherScoringBalls || 0;
    const wideCount = stats.wideCount || 0;
    const noBallCount = stats.noBallCount || 0;

    const totalDeliveries = (sixesCount + foursCount + dotBallsCount + otherScoringCount + wideCount + noBallCount) || 1;

    // Percentages 
    const sixesPct = ((sixesCount / totalDeliveries) * 100).toFixed(1);
    const foursPct = ((foursCount / totalDeliveries) * 100).toFixed(1);
    const dotPct = ((dotBallsCount / totalDeliveries) * 100).toFixed(1);
    const otherPct = ((otherScoringCount / totalDeliveries) * 100).toFixed(1);
    const widePct = ((wideCount / totalDeliveries) * 100).toFixed(1);
    const noBallPct = ((noBallCount / totalDeliveries) * 100).toFixed(1);

    const chartLabels = [];
    const chartData = [];
    const chartBg = [];
    const chartBorder = [];

    if (sixesCount > 0) {
        chartLabels.push(`Sixes (${sixesPct}%)`);
        chartData.push(sixesCount);
        chartBg.push('rgba(59, 130, 246, 0.85)');
        chartBorder.push('#3b82f6');
    }
    if (foursCount > 0) {
        chartLabels.push(`Fours (${foursPct}%)`);
        chartData.push(foursCount);
        chartBg.push('rgba(248, 180, 0, 0.85)');
        chartBorder.push('#F8B400');
    }
    if (dotBallsCount > 0) {
        chartLabels.push(`Dot Balls (${dotPct}%)`);
        chartData.push(dotBallsCount);
        chartBg.push('rgba(239, 68, 68, 0.65)');
        chartBorder.push('#ef4444');
    }
    if (otherScoringCount > 0) {
        chartLabels.push(`Runs 1,2,3 (${otherPct}%)`);
        chartData.push(otherScoringCount);
        chartBg.push('rgba(16, 185, 129, 0.75)');
        chartBorder.push('#10b981');
    }
    if (wideCount > 0) {
        chartLabels.push(`Wides (${widePct}%)`);
        chartData.push(wideCount);
        chartBg.push('rgba(168, 85, 247, 0.75)');
        chartBorder.push('#a855f7');
    }
    if (noBallCount > 0) {
        chartLabels.push(`No Balls (${noBallPct}%)`);
        chartData.push(noBallCount);
        chartBg.push('rgba(251, 146, 60, 0.75)');
        chartBorder.push('#fb923c');
    }

    if (chartData.length === 0) {
        chartLabels.push('No Data');
        chartData.push(1);
        chartBg.push('rgba(255,255,255,0.1)');
        chartBorder.push('rgba(255,255,255,0.2)');
    }

    scorebarBoundariesChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: chartBg,
                borderColor: chartBorder,
                borderWidth: 2.5,
                cutout: '55%',
                borderRadius: 6,
                spacing: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1500,
                easing: 'easeOutQuart'
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.label.split(' (')[0];
                            return `${label}: ${ctx.raw} deliveries`;
                        }
                    }
                },
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#fff',
                        font: { weight: 'bold', size: 11 },
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            },
            layout: { padding: 8 }
        }
    });

    // Stat cards update කරනවා
    const sixesEl = document.getElementById('boundarySixesCount');
    const foursEl = document.getElementById('boundaryFoursCount');
    const dotBallsEl = document.getElementById('boundaryDotBalls');
    const otherRunsEl = document.getElementById('boundaryOtherRunsCount');
    const widesEl = document.getElementById('boundaryWidesCount');
    const noBallsEl = document.getElementById('boundaryNoBallsCount');

    if (sixesEl) sixesEl.textContent = sixesCount;
    if (foursEl) foursEl.textContent = foursCount;
    if (dotBallsEl) dotBallsEl.textContent = dotBallsCount;
    if (otherRunsEl) otherRunsEl.textContent = otherScoringCount;
    if (widesEl) widesEl.textContent = wideCount;
    if (noBallsEl) noBallsEl.textContent = noBallCount;
}

function showChartGroup(groupName) {
    const overlay = document.getElementById('chartsOverlay');
    const grid = document.getElementById('chartsGrid');
    if (!overlay || !grid) return;
    updateScorebarOverHistory();
    grid.innerHTML = '';
    let title = '';

    // ── Individual chart display (1 chart per window, full size) ──
    // Each chart has its own UNIQUE root class — NO shared .chart-card/.chart-card-single
    if (groupName === 'worm') {
        title = '🐛 Worm Graph';
        grid.innerHTML = `
        <div class="worm-panel">
            <div class="worm-panel-title"><span>🐛 WORM GRAPH</span></div>
            <div class="worm-panel-body"><canvas id="wormChartCanvas"></canvas></div>
        </div>`;
    } else if (groupName === 'manhattan') {
        title = '🏙️ Manhattan Graph';
        grid.innerHTML = `
        <div class="manhattan-panel">
            <div class="manhattan-panel-title"><span>📊 MANHATTAN GRAPH</span></div>
            <div class="manhattan-panel-body"><canvas id="manhattanChartCanvas"></canvas></div>
        </div>`;
    } else if (groupName === 'winviz') {
        title = '🏆 WinViz';
        grid.innerHTML = `
        <div class="winviz-panel">
            <div class="winviz-panel-title"><span>🏆 WIN VIZ</span></div>
            <div class="winviz-panel-body">
                <div class="winviz-layout">
                    <div id="winVizContainer" class="winviz-wheel-wrap">
                        <canvas id="winVizCanvas"></canvas>
                    </div>
                    <div class="winviz-side-info">
                        <div class="winviz-team-row bat-team-row">
                            <span class="winviz-team-name bat-color" id="winvizBatTeam">BAT</span>
                            <span class="winviz-team-pct bat-color" id="winvizBatPct">0%</span>
                        </div>
                        <div class="winviz-pred-bar-wrap">
                            <div class="winviz-pred-bar">
                                <div class="winviz-pred-fill bat-fill" id="winvizBatFill" style="width:0%"></div>
                                <div class="winviz-pred-fill bowl-fill" id="winvizBowlFill" style="width:0%"></div>
                            </div>
                        </div>
                        <div class="winviz-team-row bowl-team-row">
                            <span class="winviz-team-name bowl-color" id="winvizBowlTeam">BOWL</span>
                            <span class="winviz-team-pct bowl-color" id="winvizBowlPct">0%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    } else if (groupName === 'projected') {
        title = '🎯 Projected Score';
        grid.innerHTML = `
        <div class="projected-panel">
            <div class="projected-panel-title"><span>🎯 PROJECTED SCORE</span></div>
            <div class="projected-panel-body">
                <div class="projected-score-box projected-score-box-large">
                    <div class="projected-score-value projected-score-value-large" id="projectedScoreValue">0</div>
                    <div class="projected-score-label">Projected Final Score</div>
                </div>
            </div>
        </div>`;
    } else if (groupName === 'runrate') {
        title = '⚡ Run Rate Graph';
        grid.innerHTML = `
        <div class="runrate-panel">
            <div class="runrate-panel-title"><span>📈 RUN RATE TREND</span></div>
            <div class="runrate-panel-body"><canvas id="runRateChartCanvas"></canvas></div>
        </div>`;
    } else if (groupName === 'partnership') {
        title = '🤝 Partnership Chart';
        grid.innerHTML = `
        <div class="partnership-panel">
            <div class="partnership-panel-title"><span>🤝 PARTNERSHIP BREAKDOWN</span></div>
            <div class="partnership-panel-body">
                <div class="partnership-player-col">
                    <div class="partnership-player-card" id="partChartBat1Photo"></div>
                    <div class="partnership-player-name" id="partChartBat1Name">BATTER 1</div>
                </div>
                <div class="partnership-chart-area">
                    <div class="partnership-stats-bar">
                        <div class="partnership-stat">
                            <span class="partnership-stat-value" id="partChartRuns">0</span>
                            <span class="partnership-stat-label">RUNS</span>
                        </div>
                        <div class="partnership-stat-divider"></div>
                        <div class="partnership-stat">
                            <span class="partnership-stat-value" id="partChartBalls">0</span>
                            <span class="partnership-stat-label">BALLS</span>
                        </div>
                        <div class="partnership-stat-divider"></div>
                        <div class="partnership-stat">
                            <span class="partnership-stat-value" id="partChartSR">0.0</span>
                            <span class="partnership-stat-label">SR</span>
                        </div>
                    </div>
                    <canvas id="partnershipChartCanvas"></canvas>
                </div>
                <div class="partnership-player-col">
                    <div class="partnership-player-card" id="partChartBat2Photo"></div>
                    <div class="partnership-player-name" id="partChartBat2Name">BATTER 2</div>
                </div>
            </div>
        </div>`;
    } else if (groupName === 'boundaries') {
        title = 'Scoring Breakdown';
        grid.innerHTML = `
        <div class="boundaries-panel">
            <div class="boundaries-panel-title"><span>SCORING BREAKDOWN</span></div>
            <div class="boundaries-panel-body">
                <div class="boundaries-chart-area">
                    <canvas id="boundariesChartCanvas"></canvas>
                </div>
                <div class="boundaries-stats-panel boundaries-stats-panel-6col">
                    <div class="boundary-stat-item boundary-sixes">
                        <span class="boundary-stat-num" id="boundarySixesCount">0</span>
                        <span class="boundary-stat-label">SIXES</span>
                    </div>
                    <div class="boundary-stat-item boundary-fours">
                        <span class="boundary-stat-num" id="boundaryFoursCount">0</span>
                        <span class="boundary-stat-label">FOURS</span>
                    </div>
                    <div class="boundary-stat-item boundary-dots">
                        <span class="boundary-stat-num" id="boundaryDotBalls">0</span>
                        <span class="boundary-stat-label">DOT BALLS</span>
                    </div>
                    <div class="boundary-stat-item boundary-other-runs">
                        <span class="boundary-stat-num" id="boundaryOtherRunsCount">0</span>
                        <span class="boundary-stat-label">RUNS (1,2,3)</span>
                    </div>
                    <div class="boundary-stat-item boundary-wides">
                        <span class="boundary-stat-num" id="boundaryWidesCount">0</span>
                        <span class="boundary-stat-label">WIDES</span>
                    </div>
                    <div class="boundary-stat-item boundary-noballs">
                        <span class="boundary-stat-num" id="boundaryNoBallsCount">0</span>
                        <span class="boundary-stat-label">NO BALLS</span>
                    </div>
                </div>
            </div>
        </div>`;
    }
    // Legacy group1/group2/group3 removed — each chart now displays in its own single-chart window

    /* ── Render charts ── */
    if (groupName === 'worm') {
        renderWormGraphScorebar();
    } else if (groupName === 'manhattan') {
        renderManhattanGraphScorebar();
    } else if (groupName === 'winviz') {
        renderWinVizScorebar();
    } else if (groupName === 'projected') {
        updateProjectedScoreScorebar();
    } else if (groupName === 'runrate') {
        renderRunRateGraphScorebar();
    } else if (groupName === 'partnership') {
        // Defer render by 1 frame so flex layout is computed before Chart.js reads canvas size
        requestAnimationFrame(() => renderPartnershipChartScorebar());
    } else if (groupName === 'boundaries') {
        requestAnimationFrame(() => renderBoundariesPieChartScorebar());
    }
    // Legacy group1/group2/group3 render removed

    document.getElementById('chartsTitle').innerHTML = title;
    // Place ms-footer OUTSIDE and BELOW the charts-container, centered at bottom
    const existingFooter = overlay.querySelector('.ms-footer');
    if (existingFooter) existingFooter.remove();
    const footerEl = document.createElement('div');
    footerEl.innerHTML = buildMsFooter();
    const footerNode = footerEl.firstElementChild;
    // Insert after charts-container (outside it), directly in the overlay
    const chartsContainer = overlay.querySelector('.charts-container');
    if (footerNode && chartsContainer && chartsContainer.parentNode === overlay) {
        chartsContainer.parentNode.insertBefore(footerNode, chartsContainer.nextSibling);
    } else if (footerNode) {
        overlay.appendChild(footerNode);
    }
    overlay.classList.add('show');
}

function hideAllCharts() {
    const overlay = document.getElementById('chartsOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        // Remove ms-footer that was placed outside the grid
        const footer = overlay.querySelector('.ms-footer');
        if (footer) footer.remove();
    }
    // [Fix #3] Safe chart destroy with try/catch
    try { if (scorebarWormChart) { scorebarWormChart.destroy(); scorebarWormChart = null; } } catch (e) { scorebarWormChart = null; }
    try { if (scorebarManhattanChart) { scorebarManhattanChart.destroy(); scorebarManhattanChart = null; } } catch (e) { scorebarManhattanChart = null; }
    try { if (scorebarRunRateChart) { scorebarRunRateChart.destroy(); scorebarRunRateChart = null; } } catch (e) { scorebarRunRateChart = null; }
    try { if (scorebarWinVizChart) { scorebarWinVizChart.destroy(); scorebarWinVizChart = null; } } catch (e) { scorebarWinVizChart = null; }
    try { if (scorebarPartnershipChart) { scorebarPartnershipChart.destroy(); scorebarPartnershipChart = null; } } catch (e) { scorebarPartnershipChart = null; }
    try { if (scorebarBoundariesChart) { scorebarBoundariesChart.destroy(); scorebarBoundariesChart = null; } } catch (e) { scorebarBoundariesChart = null; }
    // Clean up all WinViz overlay elements (including ring-pulse and progress-bar)
    document.querySelectorAll('.winviz-center-stat, .winviz-label-group, .winviz-line-svg, .winviz-ring-pulse, .winviz-progress-bar').forEach(el => el.remove());
}

// ==========================================
// SCOREBAR CURTAIN - Hide / Show with creative animation
// ==========================================
function hideScorebar() {
    const wrapper = document.getElementById('scoreboardWrapper');
    if (!wrapper) return;
    // Add curtain-close animation class
    wrapper.classList.add('curtain-closing');
    wrapper.classList.remove('curtain-opening');
    // After animation completes, fully hide
    setTimeout(() => {
        wrapper.classList.add('scorebar-hidden');
        wrapper.classList.remove('curtain-closing');
    }, 600);
}

function showScorebar() {
    const wrapper = document.getElementById('scoreboardWrapper');
    if (!wrapper) return;
    // Remove hidden state and add opening animation
    wrapper.classList.remove('scorebar-hidden');
    wrapper.classList.add('curtain-opening');
    // After animation completes, remove animation class
    setTimeout(() => {
        wrapper.classList.remove('curtain-opening');
    }, 600);
}

function refreshActiveChartsScorebar() {
    const overlay = document.getElementById('chartsOverlay');
    if (!overlay || !overlay.classList.contains('show')) return;
    const title = document.getElementById('chartsTitle')?.innerText || '';
    updateScorebarOverHistory();
    // Individual chart refresh (1 chart per window)
    if (title.includes('Worm')) {
        renderWormGraphScorebar();
    } else if (title.includes('Manhattan')) {
        renderManhattanGraphScorebar();
    } else if (title.includes('WinViz') || title.includes('WIN VIZ')) {
        renderWinVizScorebar();
    } else if (title.includes('Projected')) {
        updateProjectedScoreScorebar();
    } else if (title.includes('Run Rate')) {
        renderRunRateGraphScorebar();
    } else if (title.includes('Partnership')) {
        renderPartnershipChartScorebar();
    } else if (title.includes('Scoring') || title.includes('SCORING') || title.includes('Breakdown') || title.includes('BREAKDOWN')) {
        renderBoundariesPieChartScorebar();
    }
}

// ==========================================
// [Bug 51] HTML SANITIZER
// ==========================================
const ALLOWED_TAGS = new Set(['DIV', 'SPAN', 'B', 'STRONG', 'BR', 'EM', 'I']);
const ALLOWED_CLASSES = new Set(['result-card-wrap', 'result-card-kicker', 'result-card-winner', 'result-card-team', 'result-card-line', 'result-card-sub', 'result-card-2col', 'result-left', 'result-right', 'result-divider', 'result-score-big', 'result-duration', 'boundary-other-runs', 'boundary-wides', 'boundary-noballs', 'boundary-fours', 'boundary-sixes', 'boundary-dots', 'boundary-stat-item', 'boundary-stat-num', 'boundary-stat-label', 'boundaries-stats-panel', 'boundaries-stats-panel-6col']);

function sanitizeHtml(html) {
    if (!html) return '';
    if (!html.includes('<')) return escapeHtml(html);
    const temp = document.createElement('div');
    temp.innerHTML = html;

    function clean(node) {
        [...node.childNodes].forEach(child => {
            if (child.nodeType === 3) return;
            if (child.nodeType !== 1) {
                child.remove();
                return;
            }
            if (!ALLOWED_TAGS.has(child.tagName)) {
                const text = document.createTextNode(child.textContent);
                child.parentNode.replaceChild(text, child);
                return;
            }
            [...child.attributes].forEach(attr => {
                if (attr.name === 'class') {
                    const safeClasses = attr.value.split(/\s+/).filter(c => ALLOWED_CLASSES.has(c));
                    child.className = safeClasses.join(' ');
                } else if (attr.name === 'style') {
                    if (/url\s*\(|expression\s*\(|javascript:/i.test(attr.value)) child.removeAttribute('style');
                } else {
                    child.removeAttribute(attr.name);
                }
            });
            clean(child);
        });
    }
    clean(temp);
    return temp.innerHTML;
}

// ==========================================
// [Bug 54] DATA VALIDATION
// ==========================================
function validateLiveData(data) {
    if (!data || typeof data !== 'object') return null;
    return {
        ...data,
        runs: Math.max(0, Math.min(9999, parseInt(data.runs) || 0)),
        wkts: Math.max(0, Math.min(10, parseInt(data.wkts) || 0)),
        overs: sanitizeOvers(data.overs),
        target: Math.max(0, Math.min(9999, parseInt(data.target) || 0)),
        totOvers: Math.max(1, Math.min(100, parseInt(data.totOvers) || 20)),
        crr: String(Math.max(0, parseFloat(data.crr) || 0).toFixed(2)),
        winProb: Math.max(0, Math.min(100, parseInt(data.winProb) || 50)),
        striker: data.striker === '2' ? '2' : '1',
        batFlag: String(data.batFlag || '').slice(0, 15),
        bowlFlag: String(data.bowlFlag || '').slice(0, 15),
        thisOver: String(data.thisOver || '').slice(0, 120),
        status: String(data.status || '').slice(0, 100),
        bat1: validateBatsman(data.bat1),
        bat2: validateBatsman(data.bat2),
        bowler: validateBowler(data.bowler),
        partRuns: Math.max(0, Math.min(999, parseInt(data.partRuns) || 0)),
        partBalls: Math.max(0, Math.min(999, parseInt(data.partBalls) || 0)),
        partnershipRuns: Math.max(0, parseInt(data.partRuns) || 0),
    };
}

function validateBatsman(bat) {
    if (!bat) return {
        name: '',
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        isOut: false
    };
    return {
        name: String(bat.name || '').slice(0, 50),
        runs: Math.max(0, Math.min(999, parseInt(bat.runs) || 0)),
        balls: Math.max(0, Math.min(999, parseInt(bat.balls) || 0)),
        fours: Math.max(0, Math.min(99, parseInt(bat.fours) || 0)),
        sixes: Math.max(0, Math.min(99, parseInt(bat.sixes) || 0)),
        isOut: !!bat.isOut,
        photo: String(bat.photo || '').slice(0, 500000)
    };
}

function validateBowler(bowler) {
    if (!bowler) return {
        name: '',
        figs: '0-0 0.0',
        wickets: 0,
        runs: 0,
        balls: 0
    };
    return {
        name: String(bowler.name || '').slice(0, 50),
        figs: String(bowler.figs || '0-0 0.0').slice(0, 20),
        wickets: Math.max(0, Math.min(10, parseInt(bowler.wickets) || 0)),
        runs: Math.max(0, Math.min(999, parseInt(bowler.runs) || 0)),
        balls: Math.max(0, Math.min(999, parseInt(bowler.balls) || 0))
    };
}

function sanitizeOvers(overs) {
    const str = String(overs || '0.0');
    const parts = str.split('.');
    const o = Math.max(0, parseInt(parts[0] || '0', 10));
    let b = parseInt(parts[1] || '0', 10);
    b = Math.min(Math.max(b, 0), 5);
    return `${o}.${b}`;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getTwoInitials(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return 'PL';
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || '').slice(0, 2).toUpperCase() || 'PL';
}

function normalizeProfilePhotoSrc(photo) {
    const src = String(photo || '').trim();
    if (!src) return '';
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(src)) return src;
    const cleaned = src.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(cleaned)) return `data:image/jpeg;base64,${cleaned}`;
    return src;
}

function updateCounter(elId, newV) {
    const el = document.getElementById(elId);
    if (!el) return;
    const curV = parseInt(el.innerText) || 0;
    const tarV = parseInt(newV) || 0;
    if (curV !== tarV) {
        el.classList.remove('pop-update');
        void el.offsetWidth;
        el.classList.add('pop-update');
        let start = null;
        const duration = 400;
        const step = (ts) => {
            if (!start) start = ts;
            const progress = Math.min((ts - start) / duration, 1);
            const easeOut = progress * (2 - progress);
            el.innerText = Math.floor(curV + (tarV - curV) * easeOut);
            if (progress < 1) window.requestAnimationFrame(step);
            else el.innerText = tarV;
        };
        window.requestAnimationFrame(step);
    }
}

function updateText(elId, newV) {
    const el = document.getElementById(elId);
    if (el && el.innerText !== String(newV)) {
        el.innerText = newV;
        el.classList.remove('pop-update');
        void el.offsetWidth;
        el.classList.add('pop-update');
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text || '';
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    log('🏏 Scorebar V33.0 Initializing...');
    const urlParams = new URLSearchParams(window.location.search);
    const urlMatchId = urlParams.get('match');
    if (urlMatchId) {
        matchId = urlMatchId;
        localStorage.setItem('matchId', matchId);
    }
    initFirebase();
    startAutoCarousel();
});

function initFirebase() {
    try {
        if (!window.firebase) throw new Error('Firebase library not loaded');
        if (!firebase.apps.length) firebaseApp = firebase.initializeApp(CONFIG.FIREBASE);
        else firebaseApp = firebase.apps[0];
        database = firebase.database();
        setupFirebaseRealtime();
        log('✅ Scorebar Firebase Ready');
    } catch (e) {
        console.error('Firebase init failed:', e);
    }
}

// ==========================================
// PING & PRESENCE
// ==========================================
async function measureOwnFirebasePing() {
    if (!database || !navigator.onLine) {
        selfPingMs = null;
        return null;
    }
    try {
        const start = performance.now();
        await database.ref(`ping/${matchId}/scorebar_probe`).set({
            t: firebase.database.ServerValue.TIMESTAMP
        });
        selfPingMs = Math.max(1, Math.round(performance.now() - start));
        return selfPingMs;
    } catch (e) {
        selfPingMs = null;
        return null;
    }
}
async function refreshScorebarPresence() {
    if (!database || !navigator.onLine) return;
    const ping = await measureOwnFirebasePing();
    try {
        await database.ref(`presence/${matchId}/scorebar`).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            version: '33.0',
            pingMs: ping ?? 0
        });
    } catch (e) { }
}

function startPresenceRefresh() {
    stopPresenceRefresh();
    refreshScorebarPresence();
    presenceRefreshInterval = setInterval(refreshScorebarPresence, 10000);
}

function stopPresenceRefresh() {
    if (presenceRefreshInterval) {
        clearInterval(presenceRefreshInterval);
        presenceRefreshInterval = null;
    }
}

// ==========================================
// FIREBASE REALTIME
// ==========================================
function setupFirebaseRealtime() {
    const amOnline = database.ref('.info/connected');
    const myPresenceRef = database.ref(`presence/${matchId}/scorebar`);
    amOnline.on('value', (snapshot) => {
        if (snapshot.val()) {
            myPresenceRef.onDisconnect().set({
                online: false,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            myPresenceRef.set({
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                version: '33.0',
                pingMs: 0
            });
            startPresenceRefresh();
            showConnectionPopup();
        } else {
            stopPresenceRefresh();
        }
    });
    database.ref(`matches/${matchId}/live`).on('value', (snap) => {
        const data = snap.val();
        if (data) processLiveData(data);
    });
    database.ref(`matches/${matchId}/command`).on('value', (snap) => {
        const cmd = snap.val();
        if (!cmd || !cmd.ts) return;
        if (!commandListenerInitialized) {
            commandListenerInitialized = true;
            lastProcessedCommandTs = cmd.ts || Date.now();
            return;
        }
        if (cmd.ts <= lastProcessedCommandTs) return;
        lastProcessedCommandTs = cmd.ts;
        if (Date.now() - cmd.ts > 10000) return;
        processCommand(cmd);
    });
}

function processCommand(cmd) {
    if (!cmd || !cmd.event) return;
    switch (cmd.event) {
        case 'show_profile':
            showPlayerProfile(cmd.payload, animSettings.profileDuration);
            break;
        case 'hide_graphics':
            hidePlayerProfile();
            hideSummary();
            hidePresentDetails();
            hideWinnerOverlay();
            hideMatchScorecard();
            hideAllCharts();
            restoreFromSpecial();
            overlayManager.forceClose();
            break;
        case 'show_summary':
            showSummary(cmd.payload);
            break;
        case 'force_reload':
            if (cmd.payload?.target === 'scorebar' || cmd.payload?.target === 'all') location.reload();
            break;
        case 'show_present_details':
            showPresentDetails(cmd.payload);
            break;
        case 'show_winner_card':
            showWinnerOverlay(cmd.payload);
            break;
        case 'show_match_scorecard':
            showMatchScorecard(cmd.payload);
            break;
        case 'show_super_over':
            showSuperOverAnnouncement(cmd.payload);
            break;
        case 'show_charts':
            if (cmd.payload && cmd.payload.group) {
                showChartGroup(cmd.payload.group);
            }
            break;
        case 'hide_charts':
            hideAllCharts();
            break;
        case 'hide_scorebar':
            hideScorebar();
            break;
        case 'show_scorebar':
            showScorebar();
            break;

        case 'reset_charts':
            // Admin එකෙන් reset_charts command එක ආවාම charts clear කරනවා
            resetScorebarCharts(!!cmd.payload?.isChase);
            break;
        case 'trigger_hype': {
            let duration = animSettings.fourDuration;
            if (cmd.payload?.type === 'SIX') duration = animSettings.sixDuration;
            if (cmd.payload?.type === 'WICKET') duration = animSettings.wicketDuration;
            triggerHype(cmd.payload?.type, duration, cmd.payload);
            break;

        }

    }
}

function showConnectionPopup() {
    const popup = document.getElementById('connPopup');
    if (popup) {
        popup.classList.add('show');
        setTimeout(() => popup.classList.remove('show'), 3000);
    }
}

let superOverTimer = null;

function showSuperOverAnnouncement(payload) {
    if (!payload) return;
    hidePlayerProfile();
    hideSummary();
    const scoreboard = document.getElementById('scoreboard');
    const normalContent = document.getElementById('normalContent');
    const overlay = document.getElementById('specialOverlay');
    const overlayContent = document.getElementById('specialOverlayContent');
    if (!scoreboard || !normalContent || !overlay || !overlayContent) return;
    const team1 = payload.team1 || 'T1',
        team2 = payload.team2 || 'T2';
    const html = `<div class="result-card-wrap"><div class="result-card-kicker">⚡ SUPER OVER</div><div class="result-card-winner"><span class="result-card-team">${escapeHtml(team1)}</span><span style="font-size:20px;color:rgba(255,255,255,0.5);">VS</span><span class="result-card-team">${escapeHtml(team2)}</span></div><div class="result-card-line">MATCH IS TIED!</div><div class="result-card-sub">One over to decide the winner</div></div>`;
    normalContent.classList.add('hide');
    scoreboard.classList.add('is-special');
    overlay.classList.remove('plain-text');
    overlayContent.innerHTML = sanitizeHtml(html);
    scheduleFitSpecialOverlay();
    if (superOverTimer) clearTimeout(superOverTimer);
    superOverTimer = setTimeout(() => {
        restoreFromSpecial();
        superOverTimer = null;
    }, payload.duration || 8000);
}

function updateCurrentMatchData(data) {
    if (!data) return;
    currentMatchData = {
        batTeam: data.batFlag || '',
        bowlTeam: data.bowlFlag || '',
        batFlag: data.batFlag || '',
        bowlFlag: data.bowlFlag || '',
        overs: data.overs || '0.0',
        runs: parseInt(data.runs) || 0,
        wkts: parseInt(data.wkts) || 0,
        target: parseInt(data.target) || 0,
        totOvers: parseInt(data.totOvers) || 20,
        winProb: Math.max(0, Math.min(100, parseInt(data.winProb) || 50)),
        bat1: {
            name: data.bat1?.name || '',
            runs: parseInt(data.bat1?.runs) || 0,
            balls: parseInt(data.bat1?.balls) || 0,
            fours: parseInt(data.bat1?.fours) || 0,
            sixes: parseInt(data.bat1?.sixes) || 0,
            isOut: !!data.bat1?.isOut,
            photo: data.bat1?.photo || ''
        },
        bat2: {
            name: data.bat2?.name || '',
            runs: parseInt(data.bat2?.runs) || 0,
            balls: parseInt(data.bat2?.balls) || 0,
            fours: parseInt(data.bat2?.fours) || 0,
            sixes: parseInt(data.bat2?.sixes) || 0,
            isOut: !!data.bat2?.isOut,
            photo: data.bat2?.photo || ''
        },
        bowler: {
            name: data.bowler?.name || ''
        },
        dismissedPlayers: Array.isArray(data.dismissedPlayers) ? [...data.dismissedPlayers] : [],
        // [Fix #5] Load overRunsHistory from Firebase for cross-device chart sync
        overRunsHistory: Array.isArray(data.overRunsHistory) ? data.overRunsHistory : [],
        partRuns: parseInt(data.partRuns) || 0,
        partBalls: parseInt(data.partBalls) || 0
    };
}

function getUpcomingBatterHoldTime() {
    return Math.max(3500, (parseInt(animSettings.newBatterDelay, 10) || 1600) + 1500);
}

function showUpcomingBatterView(name, photoSrc = '', holdTime = null, playerData = null) {
    if (!name) return;
    const profileData = {
        name,
        photo: normalizeProfilePhotoSrc(photoSrc),
        role: playerData?.role || 'NEW BATSMAN',
        school: playerData?.school || '',
        age: playerData?.age || ''
    };
    showPlayerProfile(profileData, holdTime || getUpcomingBatterHoldTime());
}

function queueUpcomingBatter(name, photoSrc = '', holdTime = null, playerData = null) {
    if (!name) return;
    pendingUpcomingBatter = {
        name,
        photoSrc,
        holdTime: holdTime || getUpcomingBatterHoldTime(),
        playerData
    };
}

function flushQueuedUpcomingBatter(delay = 150) {
    if (!pendingUpcomingBatter) return;
    const queued = {
        ...pendingUpcomingBatter
    };
    pendingUpcomingBatter = null;
    if (pendingUpcomingTimer) {
        clearTimeout(pendingUpcomingTimer);
        pendingUpcomingTimer = null;
    }
    pendingUpcomingTimer = setTimeout(() => {
        showUpcomingBatterView(queued.name, queued.photoSrc, queued.holdTime, queued.playerData);
        pendingUpcomingTimer = null;
    }, delay);
}

function handleIncomingNewBatter(data) {
    if (!data.upcomingBatterName) return;
    const name = data.upcomingBatterName,
        photo = data.upcomingBatterPhoto || '',
        holdTime = getUpcomingBatterHoldTime();
    const playerData = {
        role: data.upcomingBatterRole || 'NEW BATSMAN',
        school: data.upcomingBatterSchool || '',
        age: data.upcomingBatterAge || ''
    };
    const hypeOverlay = document.getElementById('hypeOverlay');
    const isHypeShowing = hypeOverlay && hypeOverlay.classList.contains('show');
    if (isHypeShowing || isPlayerProfileVisible) queueUpcomingBatter(name, photo, holdTime, playerData);
    else showUpcomingBatterView(name, photo, holdTime, playerData);
}

// ==========================================
// [Bug 73] RESET CHARTS ON NEW MATCH
// Detect new match by: overs/runs resetting to 0 while we had data before
// Works even when same teams are selected for the new match
// ==========================================
let lastKnownOverBalls = 0; // Track highest overs seen in current match
let lastKnownRuns = 0;      // Track highest runs seen in current match

// [Bug 75] Soft reset for chase start: clears chart tracking but KEEPS localStorage 1st innings data
// preserveChaseData=true = chase start (keep localStorage for comparison)
// preserveChaseData=false = new match/reset (clear everything)
function resetScorebarCharts(preserveChaseData = false) {
    if (preserveChaseData) {
        log('🔄 [Bug 75] Chase start soft reset - preserving 1st innings data');
    } else {
        log('🔄 [Bug 74/75] Full reset - clearing all chart data and localStorage');
    }
    scorebarOverHistory = [];
    lastRecordedOverBalls = -1;
    lastRecordedScore = 0;
    lastRecordedWkts = 0;
    lastKnownOverBalls = 0;
    lastKnownRuns = 0;
    scorebarWideCount = 0;
    scorebarNoBallCount = 0;
    scorebarDotBallCount = 0;
    scorebarPrevThisOver = '';
    scorebarPrevOverNumber = -1;  // [FIX] Over transition tracking එකත් reset කරනවා
    scorebarByeFourCount = 0;     // [FIX] Boundary bye tracking reset කරනවා
    scorebarByeSixCount = 0;

    if (preserveChaseData) {
        firstInningsRunsPerOver = [];
        firstInningsCumulative = [];
        // [Worm Fix] Try localStorage first, then Firebase for cross-device 1st innings data
        if (!loadFirstInningsDataFromLocal()) {
            // No localStorage data - load from Firebase async (will populate on next render)
            loadFirstInningsDataFromFirebase();
        }
    } else {
        firstInningsRunsPerOver = [];
        firstInningsCumulative = [];
        chaseStarted = false;
        firstInningsSavedToLocal = false;
        firstInningsFirebaseCache = null; // [Worm Fix] Clear Firebase cache on full reset
        clearFirstInningsDataFromLocal();
    }

    try { if (scorebarWormChart) { scorebarWormChart.destroy(); scorebarWormChart = null; } } catch (e) { scorebarWormChart = null; }
    try { if (scorebarManhattanChart) { scorebarManhattanChart.destroy(); scorebarManhattanChart = null; } } catch (e) { scorebarManhattanChart = null; }
    try { if (scorebarRunRateChart) { scorebarRunRateChart.destroy(); scorebarRunRateChart = null; } } catch (e) { scorebarRunRateChart = null; }
    try { if (scorebarWinVizChart) { scorebarWinVizChart.destroy(); scorebarWinVizChart = null; } } catch (e) { scorebarWinVizChart = null; }
    prevBat1 = { name: '', runs: -1 };
    prevBat2 = { name: '', runs: -1 };
    prevStrikerId = null;
    prevB1Name = null;
    prevB2Name = null;
    prevBowlerName = null;
}

function processLiveData(rawData) {
    const data = validateLiveData(rawData);
    if (!data) return;
    lastDataReceived = Date.now();

    // [Bug 73] Detect new match: overs/runs dropped back to near 0 while we had significant data
    const newOvers = data.overs || '0.0';
    const newOversBalls = oversToBallsScorebar(newOvers);
    const newRuns = parseInt(data.runs) || 0;
    const newWkts = parseInt(data.wkts) || 0;
    if (newOversBalls > lastKnownOverBalls) lastKnownOverBalls = newOversBalls;
    if (newRuns > lastKnownRuns) lastKnownRuns = newRuns;

    let justReset = false;
    const hasTarget = parseInt(data.target) > 0;
    if (lastKnownOverBalls > 6 && newOversBalls <= 1 && newRuns <= 1 && newWkts <= 1) {
        if (hasTarget) {
            if (scorebarOverHistory.length > 0 && !chaseStarted) {
                saveFirstInningsDataToLocal();
                chaseStarted = true;
            }
            resetScorebarCharts(true);
        } else {
            resetScorebarCharts(false);
        }
        lastKnownOverBalls = newOversBalls;
        lastKnownRuns = newRuns;
        justReset = true;
    }
    if (!justReset && hasTarget && !chaseStarted) {
        if (scorebarOverHistory.length > 0) {
            saveFirstInningsDataToLocal();
            chaseStarted = true;
            scorebarOverHistory = [];
            lastRecordedOverBalls = -1;
            lastRecordedScore = 0;
            lastRecordedWkts = 0;
            firstInningsRunsPerOver = [];
            firstInningsCumulative = [];
            if (!loadFirstInningsDataFromLocal()) {
                // [Worm Fix] No localStorage - try Firebase for 1st innings data
                loadFirstInningsDataFromFirebase();
            }
        } else {
            chaseStarted = true;
            if (!loadFirstInningsDataFromLocal()) {
                // [Worm Fix] No localStorage - try Firebase for 1st innings data
                loadFirstInningsDataFromFirebase();
            }
        }
    }
    // [Worm Fix] If chase is active but we still don't have 1st innings data, try Firebase
    if (hasTarget && chaseStarted && firstInningsCumulative.length === 0) {
        if (!loadFirstInningsDataFromLocal()) {
            loadFirstInningsDataFromFirebase();
        }
    }

    updateCurrentMatchData(data);

    // Track wides, no-balls, dot balls and boundary byes from thisOver
    // [FIX] Over transition එකේදී balls miss නොවන සේ + W deliveries dot balls ලෙස + Boundary byes (4B, 6B) count කිරීම
    const currentThisOver = String(data.thisOver || '').trim();
    const currentOverNum = Math.floor(oversToBallsScorebar(data.overs) / 6);

    if (currentThisOver && currentThisOver !== scorebarPrevThisOver) {
        const currentBalls = currentThisOver.split(' ').filter(Boolean);
        const prevBalls = scorebarPrevThisOver ? scorebarPrevThisOver.split(' ').filter(Boolean) : [];

        let newBalls;
        // [FIX] Over transition එක හරියටම detect කරනවා:
        if (currentOverNum !== scorebarPrevOverNumber) {
            // Over number එක මාරු වෙලා -> අලුත් over එක, සියලුම current balls process කරනවා
            newBalls = currentBalls;
            scorebarPrevOverNumber = currentOverNum;
        } else if (scorebarPrevThisOver && currentBalls.length <= prevBalls.length) {
            // String එක කෙටි වෙලා ඇවිත් over number එක තාම අප්ඩේට් නැත්නම් -> සියලුම balls process කරනවා
            newBalls = currentBalls;
        } else {
            // එකම over එකේ අලුතින් එකතු වුණු balls විතරයි process කරන්නේ
            newBalls = currentBalls.slice(prevBalls.length);
        }

        for (const ball of newBalls) {
            const vUp = ball.toUpperCase();
            const isWide = vUp.includes('WD');
            const isNoBall = vUp.includes('NB');

            if (isWide) {
                scorebarWideCount++;
            } else if (isNoBall) {
                scorebarNoBallCount++;
            } else {
                // Legal delivery එකක් - run value එක හොයනවා
                const isWicket = vUp === 'W' || (vUp.startsWith('W') && !isWide && !isNoBall);

                let runVal = 0;
                if (isWicket) {
                    // W කියන්නේ 0 runs (dot ball), ౠවුට් වෙලා රන් ගියොත් W1, W2 වගේම තියෙයි
                    const wRunMatch = vUp.match(/^W(\d)/);
                    runVal = wRunMatch ? parseInt(wRunMatch[1]) : 0;
                } else if (/^\d(B|LB)/i.test(vUp)) {
                    // Bye/Leg-bye: 1B, 2B, 4B, 6B, 1LB වගේ ඒවා
                    runVal = parseInt(vUp.charAt(0)) || 0;
                    // [FIX] Boundary byes වලට fours සහ sixes count කරනවා
                    if (runVal === 4) scorebarByeFourCount++;
                    if (runVal === 6) scorebarByeSixCount++;
                } else {
                    runVal = parseInt(vUp) || 0;
                }

                // [FIX] 0 runs ඇති සියලුම legal deliveries (Wickets ඇතුළුව) dot balls ලෙස ගණන් කරනවා
                if (runVal === 0) {
                    scorebarDotBallCount++;
                }
            }
        }
        scorebarPrevThisOver = currentThisOver;
    } else if (!currentThisOver && scorebarPrevThisOver) {
        // thisOver හිස් වුණා = අලුත් over එකක් පටන් ගත්තා
        scorebarPrevThisOver = '';
        scorebarPrevOverNumber = currentOverNum;
    }

    const prevCarouselInterval = animSettings.carouselInterval;
    if (data.animSettings) animSettings = {
        ...animSettings,
        ...data.animSettings
    };
    if (prevCarouselInterval !== animSettings.carouselInterval) startAutoCarousel();
    autoCarouselEnabled = data.autoCarousel !== false;
    const fhOverlay = document.getElementById('fhOverlay');
    if (fhOverlay) fhOverlay.style.display = data.isFreeHit ? 'inline-block' : 'none';
    if (data.triggerHype) {
        let duration = animSettings.fourDuration;
        if (data.triggerHype === 'SIX') duration = animSettings.sixDuration;
        if (data.triggerHype === 'WICKET') duration = animSettings.wicketDuration;
        triggerHype(data.triggerHype, duration, data.triggerHypePayload || null);
    }
    if (data.showPlayerProfile && data.playerProfile) showPlayerProfile(data.playerProfile, animSettings.profileDuration);
    else if (data.hidePlayerProfile) hidePlayerProfile();
    if (data.showSummary && data.summary) showSummary(data.summary);
    else if (data.hideSummary) hideSummary();
    rotateViews = [];
    if (data.enTarget) rotateViews.push('view-target');
    if (data.enPart) rotateViews.push('view-partner');
    if (data.enPred) rotateViews.push('view-predictor');
    if (data.enChase && (parseInt(data.target) || 0) > 0) rotateViews.push('view-chase');
    if (data.matchType === 'test' && data.testMatch) {
        rotateViews.push('view-lead');
        updateLeadTrail(data.testMatch);
    }
    if (viewIndex >= rotateViews.length) viewIndex = 0;
    if (currentView !== 'view-bowler' && (!autoCarouselEnabled || !rotateViews.includes(currentView))) switchView('view-bowler');
    if (data.forceView && data.forceView !== lastForceTrig) {
        lastForceTrig = data.forceView;
        switchView(data.forceView.split('_')[0], animSettings.viewHoldDuration);
    }
    if (data.showAllOutCard && data.allOutData) triggerAutoMilestone(generateAllOutCard(data.allOutData), Math.max(parseInt(animSettings.resultDelay, 10) || 3000, 3000));
    if (data.showMilestone && data.milestoneData) triggerAutoMilestone(generateMilestoneCard(data.milestoneData), animSettings.milestoneDuration);
    if (data.showUpcomingBatter && data.upcomingBatterName) handleIncomingNewBatter(data);
    detectMilestones(data);
    handleSpecialMode(data);
    updateDisplay(data);
    updateChaseCarousel(data);
    refreshActiveChartsScorebar();
}

function detectMilestones(data) {
    const b1Name = data.bat1?.name || '',
        b1R = parseInt(data.bat1?.runs) || 0,
        b2Name = data.bat2?.name || '',
        b2R = parseInt(data.bat2?.runs) || 0;
    if (b1Name && b1Name === prevBat1.name && prevBat1.runs >= 0) {
        const jump = b1R - prevBat1.runs;
        if (jump > 0 && jump <= 10) {
            if (b1R >= 100 && prevBat1.runs < 100) {
                const milestoneData = {
                    ...data.bat1
                };
                setTimeout(() => {
                    triggerAutoMilestone(generateMilestoneCard(milestoneData), animSettings.milestoneDuration);
                }, animQueue.isRunning ? animSettings.queueGap || 500 : 0);
            } else if (b1R >= 50 && prevBat1.runs < 50) {
                const milestoneData = {
                    ...data.bat1
                };
                setTimeout(() => {
                    triggerAutoMilestone(generateMilestoneCard(milestoneData), animSettings.milestoneDuration);
                }, animQueue.isRunning ? animSettings.queueGap || 500 : 0);
            }
        }
    }
    if (b2Name && b2Name === prevBat2.name && prevBat2.runs >= 0) {
        const jump = b2R - prevBat2.runs;
        if (jump > 0 && jump <= 10) {
            if (b2R >= 100 && prevBat2.runs < 100) {
                const milestoneData = {
                    ...data.bat2
                };
                setTimeout(() => {
                    triggerAutoMilestone(generateMilestoneCard(milestoneData), animSettings.milestoneDuration);
                }, animQueue.isRunning ? animSettings.queueGap || 500 : 0);
            } else if (b2R >= 50 && prevBat2.runs < 50) {
                const milestoneData = {
                    ...data.bat2
                };
                setTimeout(() => {
                    triggerAutoMilestone(generateMilestoneCard(milestoneData), animSettings.milestoneDuration);
                }, animQueue.isRunning ? animSettings.queueGap || 500 : 0);
            }
        }
    }
    prevBat1 = {
        name: b1Name,
        runs: b1R
    };
    prevBat2 = {
        name: b2Name,
        runs: b2R
    };
}

function generateMilestoneCard(playerData) {
    const b = parseInt(playerData?.balls) || 0,
        r = parseInt(playerData?.runs) || 0,
        sr = b > 0 ? ((r / b) * 100).toFixed(2) : "0.00";
    const title = r >= 100 ? 'CENTURY' : 'HALF CENTURY';
    return `<div style="display:flex;align-items:center;justify-content:center;gap:22px;width:100%;padding:8px 16px;">${generateMilestoneAvatar(playerData)}<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;justify-content:center;"><div style="font-size:16px;font-weight:900;color:var(--gold);letter-spacing:2px;text-transform:uppercase;">${escapeHtml(title)}</div><div style="display:flex;align-items:baseline;gap:14px;text-shadow:2px 2px 10px rgba(0,0,0,0.9);white-space:nowrap;flex-wrap:wrap;"><span style="font-size:34px;font-weight:900;color:#fff;text-transform:uppercase;">${escapeHtml(playerData?.name || 'PLAYER')}</span><span style="font-size:52px;font-weight:900;color:var(--gold);line-height:0.8;">${r}<span style="font-size:26px;color:#fff;">*</span></span><span style="font-size:22px;font-weight:800;color:#ddd;">(${b})</span></div><div style="display:flex;align-items:center;gap:18px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(90deg,transparent,rgba(0,0,0,0.78),transparent);padding:6px 28px;letter-spacing:1px;border-top:1px solid rgba(248,180,0,0.3);border-bottom:1px solid rgba(248,180,0,0.3);"><div>SIXES: <span style="color:var(--gold);font-size:22px;margin-left:4px;">${playerData?.sixes || 0}</span></div><div style="color:rgba(255,255,255,0.3);">|</div><div>FOURS: <span style="color:var(--gold);font-size:22px;margin-left:4px;">${playerData?.fours || 0}</span></div><div style="color:rgba(255,255,255,0.3);">|</div><div>STRIKE RATE: <span style="color:var(--gold);font-size:22px;margin-left:4px;">${sr}</span></div></div></div></div>`;
}

function generateMilestoneAvatar(playerData) {
    const photoSrc = normalizeProfilePhotoSrc(playerData?.photo || playerData?.photo_url || playerData?.photo_base64 || '');
    const initials = getTwoInitials(playerData?.name || 'PL');
    const safeInitials = escapeHtml(initials);
    if (photoSrc) {
        // [Bug 70] Add onerror handler to show fallback when image fails to load
        return `<div style="position:relative;width:94px;height:94px;border-radius:50%;overflow:hidden;border:3px solid rgba(248,180,0,0.45);box-shadow:0 8px 20px rgba(0,0,0,0.35);flex-shrink:0;background:rgba(255,255,255,0.08);"><img src="${escapeAttr(photoSrc)}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="ms-avatar-fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#fff;background:linear-gradient(135deg,#1f2937,#111827);">${safeInitials}</div></div>`;
    }
    return `<div style="width:94px;height:94px;border-radius:50%;border:3px solid rgba(248,180,0,0.45);box-shadow:0 8px 20px rgba(0,0,0,0.35);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#fff;background:linear-gradient(135deg,#1f2937,#111827);">${safeInitials}</div>`;
}

function generateAllOutCard(data) {
    return `<div class="result-card-wrap"><div class="result-card-kicker">INNINGS OVER</div><div class="result-card-winner"><span class="result-card-team">${escapeHtml(data?.teamName || 'TEAM')}</span><span class="result-card-team">${escapeHtml(data?.score || '0/0')}</span></div><div class="result-card-line">ALL OUT</div><div class="result-card-sub">${escapeHtml(data?.overs || '0.0')} OVERS</div></div>`;
}

function triggerAutoMilestone(htmlContent, duration) {
    animQueue.add(() => new Promise((done) => {
        autoMilestoneActive = true;
        const scoreboard = document.getElementById('scoreboard'),
            normalContent = document.getElementById('normalContent'),
            overlay = document.getElementById('specialOverlay'),
            overlayContent = document.getElementById('specialOverlayContent');
        if (!scoreboard || !normalContent || !overlay || !overlayContent) {
            autoMilestoneActive = false;
            done();
            return;
        }
        normalContent.classList.add('hide');
        setTimeout(() => {
            scoreboard.classList.add('is-special');
            overlay.classList.remove('plain-text');
            if (!htmlContent.includes('<div')) overlay.classList.add('plain-text');
            overlayContent.innerHTML = sanitizeHtml(htmlContent);
            scheduleFitSpecialOverlay();
        }, 100);
        clearTimeout(autoMilestoneTimer);
        autoMilestoneTimer = setTimeout(() => {
            restoreFromSpecial();
            setTimeout(done, 500);
        }, duration || animSettings.milestoneDuration);
    }), 5);
}

function restoreFromSpecial() {
    const scoreboard = document.getElementById('scoreboard'),
        normalContent = document.getElementById('normalContent');
    if (!scoreboard || !normalContent) return;
    scoreboard.classList.remove('is-special');
    setTimeout(() => {
        normalContent.classList.remove('hide');
        autoMilestoneActive = false;
    }, 400);
}

function handleSpecialMode(data) {
    if (data.isSpecial && !autoMilestoneActive) {
        const normalContent = document.getElementById('normalContent'),
            scoreboard = document.getElementById('scoreboard'),
            overlay = document.getElementById('specialOverlay'),
            overlayContent = document.getElementById('specialOverlayContent');
        if (normalContent && scoreboard && overlay && overlayContent) {
            normalContent.classList.add('hide');
            scoreboard.classList.add('is-special');
            const specialText = data.specialText || '';
            overlay.classList.toggle('plain-text', !specialText.includes('<div'));
            overlayContent.innerHTML = sanitizeHtml(specialText);
            scheduleFitSpecialOverlay();
        }
    } else if (!data.isSpecial && !autoMilestoneActive) {
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard && scoreboard.classList.contains('is-special')) restoreFromSpecial();
    }
}

function fitSpecialOverlay() {
    const overlay = document.getElementById('specialOverlay'),
        content = document.getElementById('specialOverlayContent');
    if (!overlay || !content) return;
    content.style.transform = 'scale(1)';
    requestAnimationFrame(() => {
        const availW = overlay.clientWidth - 16,
            availH = overlay.clientHeight - 16,
            rect = content.getBoundingClientRect();
        let scale = Math.min(availW / Math.max(rect.width, 1), availH / Math.max(rect.height, 1), 1);
        if (!isFinite(scale) || scale <= 0) scale = 1;
        content.style.transform = `scale(${scale})`;
    });
}

function scheduleFitSpecialOverlay() {
    fitSpecialOverlay();
    setTimeout(fitSpecialOverlay, 50);
    setTimeout(fitSpecialOverlay, 300);
    setTimeout(fitSpecialOverlay, 850);
}

function updateDisplay(data) {
    if (!data) return;
    setText('teamsHeader', `${data.batFlag} VS ${data.bowlFlag}`);
    setText('playSchool', data.batFlag);
    let statusStr = `CRR: ${data.crr}`;
    if (data.status) statusStr += ` • ${data.status}`;
    if (data.matchType === 'test' && data.testMatch) statusStr = `DAY ${data.testMatch.day} • SESSION ${data.testMatch.session} • ${statusStr}`;
    setText('statusText', statusStr);
    let target = parseInt(data.target) || 0;
    if (target > 0) {
        let runsNeeded = target - (parseInt(data.runs) || 0);
        let bowled = oversToBallsScorebar(data.overs);
        // [Bug 69] parseFloat can return NaN; use parseInt with fallback to avoid NaN in ballsRem
        let totOversNum = parseInt(data.totOvers) || 20;
        let ballsRem = Math.max(0, (totOversNum * 6) - bowled);
        // [Fix #1 & #4] Use ballsToExactOvers for RRR rate calc, guard division by zero
        let rrr = (runsNeeded > 0 && ballsRem > 0) ? (runsNeeded / ballsToExactOvers(ballsRem)).toFixed(2) : "0.00";
        const tarTextMain = document.getElementById('tarTextMain');
        const tarTextSub = document.getElementById('tarTextSub');
        if (tarTextMain && tarTextSub) {
            if (runsNeeded > 0) {
                tarTextMain.innerHTML = `${escapeHtml(data.batFlag)} NEEDS <span class="g-text">${runsNeeded}</span> RUNS IN <span class="g-text">${ballsRem}</span> BALLS`;
                tarTextSub.innerHTML = `RRR: <span class="g-text">${rrr}</span> • CRR: <span class="g-text">${parseFloat(data.crr || 0).toFixed(2)}</span>`;
            } else {
                tarTextMain.innerHTML = `${escapeHtml(data.batFlag)} WON THE MATCH`;
                tarTextSub.innerHTML = `TARGET WAS: <span class="g-text">${target}</span>`;
            }
        }
    }
    updateCounter('partRuns', data.partRuns || 0);
    updateCounter('partBalls', data.partBalls || 0);
    let t1p = parseInt(data.winProb) || 50;
    const predT1Name = document.getElementById('predT1Name'),
        predT2Name = document.getElementById('predT2Name'),
        predBarFill = document.getElementById('predBarFill');
    if (predT1Name) predT1Name.innerHTML = `${escapeHtml(data.batFlag)} <span class="g-text">${t1p}%</span>`;
    if (predT2Name) predT2Name.innerHTML = `<span style="color:#ccc;">${100 - t1p}%</span> ${escapeHtml(data.bowlFlag)}`;
    if (predBarFill) predBarFill.style.width = `${t1p}%`;
    const b1Valid = data.bat1 && data.bat1.name && data.bat1.name.trim() !== '';
    const b2Valid = data.bat2 && data.bat2.name && data.bat2.name.trim() !== '';
    prevB1Name = processBatterName('b1Name', 'rowB1', b1Valid ? data.bat1.name : '--', data.bat1?.isOut, prevB1Name);
    prevB2Name = processBatterName('b2Name', 'rowB2', b2Valid ? data.bat2.name : '--', data.bat2?.isOut, prevB2Name);
    const p1 = document.getElementById('p1'),
        p2 = document.getElementById('p2');
    if (p1 && p2) {
        p1.classList.remove('active');
        p2.classList.remove('active');
        if (data.striker === '1' && b1Valid) p1.classList.add('active');
        if (data.striker === '2' && b2Valid) p2.classList.add('active');
    }
    if (prevStrikerId !== null && data.striker !== prevStrikerId) {
        let row = document.getElementById(data.striker === "1" ? "rowB1" : "rowB2");
        if (row) {
            row.classList.remove('strike-changed');
            void row.offsetWidth;
            row.classList.add('strike-changed');
        }
    }
    prevStrikerId = data.striker;
    processBowlerName(data.bowler?.name || '--');
    renderLogo('logo1Box', 'batFlagLogo', data.batFlag, data.t1Logo);
    renderLogo('logo2Box', 'bowlFlagLogo', data.bowlFlag, data.t2Logo);
    updateText('oversText', data.overs);
    updateText('bowlFigs', data.bowler?.figs || '0-0 0.0');
    updateCounter('mainRuns', data.runs);
    updateCounter('mainWkts', data.wkts);
    if (b1Valid) {
        updateCounter('b1Runs', data.bat1?.runs || 0);
        updateCounter('b1Balls', data.bat1?.balls || 0);
    } else {
        const r1 = document.getElementById('b1Runs'),
            bl1 = document.getElementById('b1Balls');
        if (r1) r1.innerText = '';
        if (bl1) bl1.innerText = '';
    }
    if (b2Valid) {
        updateCounter('b2Runs', data.bat2?.runs || 0);
        updateCounter('b2Balls', data.bat2?.balls || 0);
    } else {
        const r2 = document.getElementById('b2Runs'),
            bl2 = document.getElementById('b2Balls');
        if (r2) r2.innerText = '';
        if (bl2) bl2.innerText = '';
    }
    renderOverBalls(data.thisOver || '');
}

function processBatterName(id, rowId, currentNameData, isOutData, prevNameVar) {
    const el = document.getElementById(id),
        row = document.getElementById(rowId);
    if (!el) return prevNameVar;
    if (isOutData) el.classList.add('out-text');
    else el.classList.remove('out-text');
    if (prevNameVar !== currentNameData) {
        if (prevNameVar === null) {
            el.innerText = currentNameData;
            return currentNameData;
        }
        if (row) {
            row.classList.remove('swipe-in');
            row.classList.add('swipe-out');
        }
        setTimeout(() => {
            el.innerText = currentNameData;
            if (!isOutData) el.classList.remove('out-text');
            if (row) {
                row.classList.remove('swipe-out');
                row.classList.add('swipe-in');
            }
        }, 300);
        return currentNameData;
    }
    return prevNameVar;
}

function processBowlerName(currentName) {
    const el = document.getElementById('bowlName');
    if (!el) return;
    if (prevBowlerName !== currentName && prevBowlerName !== null) {
        el.classList.remove('swipe-in');
        el.classList.add('swipe-out');
        setTimeout(() => {
            el.innerText = currentName;
            el.classList.remove('swipe-out');
            el.classList.add('swipe-in');
        }, 300);
    } else {
        el.innerText = currentName;
    }
    prevBowlerName = currentName;
}

function renderLogo(bId, fId, fTxt, src) {
    const box = document.getElementById(bId);
    if (!box) return;
    if (src && src.length > 5) {
        const img = document.createElement('img');
        img.alt = escapeAttr(fTxt);
        box.innerHTML = '';
        box.appendChild(img);
        img.addEventListener('error', () => {
            box.innerHTML = `<div class="crest-placeholder" id="${escapeAttr(fId)}">${escapeHtml(fTxt)}</div>`;
        }, {
            once: true
        });
        img.src = src;
    } else {
        box.innerHTML = `<div class="crest-placeholder" id="${escapeAttr(fId)}">${escapeHtml(fTxt)}</div>`;
    }
}

function renderOverBalls(thisOverStr) {
    const ballsArray = (thisOverStr || "").trim().split(" ").filter(Boolean);
    const container = document.getElementById('ballsRowContainer');
    if (!container) return;
    container.innerHTML = "";
    let legalCount = 0;
    const lastBallIndex = ballsArray.length - 1;
    ballsArray.forEach((val, idx) => {
        let div = document.createElement('div');
        div.className = 'ball pop-update';
        let vUp = val.toUpperCase();
        const isWide = vUp.includes('WD'),
            isNoBall = vUp.includes('NB'),
            isLegBye = vUp.includes('LB'),
            isBye = /^B\d+$/i.test(vUp),
            // [Bug 71] Detect wicket on extras too (e.g. WWD, WNB)
            // Fix: Exclude WD/NB from wicket detection so wide/no-ball get their own styles
            isWicket = vUp === 'W' || (vUp.startsWith('W') && !isWide && !isNoBall);
        let display = vUp;
        if (display === '0') display = '•';
        div.innerText = display;
        // Apply extra classes independently so wicket+extra combos get both styles
        if (isWide) div.classList.add('wd');
        if (isNoBall) div.classList.add('nb');
        if (isWicket) div.classList.add('w');
        // [Bug 72] Detect boundary runs on byes/leg-byes too (4B, 6B, 4LB, 6LB)
        if (!isWicket && !isWide && !isNoBall && (vUp === '4' || vUp === '4B' || vUp === '4LB')) div.classList.add('b4');
        if (!isWicket && !isWide && !isNoBall && (vUp === '6' || vUp === '6B' || vUp === '6LB')) div.classList.add('b6');
        if (!isWicket && !isWide && !isNoBall && display === '•') div.classList.add('dot');
        if (idx === lastBallIndex) div.classList.add('last-ball');
        if (!isWide && !isNoBall) legalCount++;
        container.appendChild(div);
    });
    const emptySlots = Math.max(0, 6 - legalCount);
    for (let i = 0; i < emptySlots; i++) {
        let d = document.createElement('div');
        d.className = 'ball empty';
        container.appendChild(d);
    }
}

function triggerHype(type, duration, payload) {
    return new Promise((resolve) => {
        animQueue.add(() => new Promise((done) => {
            if (hypeTimeout) clearTimeout(hypeTimeout);
            const overlay = document.getElementById('hypeOverlay'),
                text = document.getElementById('hypeText'),
                content = document.getElementById('normalContent');
            if (!overlay || !text || !content) {
                done();
                resolve();
                return;
            }
            overlay.className = 'hype-overlay';
            overlay.querySelectorAll('.tech-grid, .hype-flash, .hype-streak, .hype-ring, .hype-particle').forEach(el => el.remove());
            const typeClass = type === 'WICKET' ? 'wicket' : type === 'SIX' ? 'six' : 'four';
            overlay.classList.add(typeClass);
            text.textContent = type;
            text.style.cssText = '';
            if (type === 'WICKET' && payload) {
                let outRow = null;
                if (payload.outSlot) outRow = document.getElementById(payload.outSlot === 'bat1' ? 'rowB1' : 'rowB2');
                if (!outRow && payload.outBatterName) {
                    const b1Name = document.getElementById('b1Name')?.innerText,
                        b2Name = document.getElementById('b2Name')?.innerText;
                    if (b1Name === payload.outBatterName) outRow = document.getElementById('rowB1');
                    else if (b2Name === payload.outBatterName) outRow = document.getElementById('rowB2');
                }
                if (outRow) {
                    outRow.classList.add('wicket-fade-out');
                    setTimeout(() => outRow.classList.remove('wicket-fade-out'), (duration || 3000) + 500);
                }
            }
            const grid = document.createElement('div');
            grid.className = 'tech-grid';
            overlay.appendChild(grid);
            const flash = document.createElement('div');
            flash.className = 'hype-flash';
            overlay.appendChild(flash);
            const streakL = document.createElement('div');
            streakL.className = 'hype-streak left';
            overlay.appendChild(streakL);
            const streakR = document.createElement('div');
            streakR.className = 'hype-streak right';
            overlay.appendChild(streakR);
            for (let i = 0; i < 3; i++) {
                const ring = document.createElement('div');
                ring.className = `hype-ring ${['one', 'two', 'three'][i]}`;
                overlay.appendChild(ring);
            }
            burstParticles(overlay, typeClass);
            content.classList.add('hide-for-hype');
            overlay.classList.add('show');
            hypeTimeout = setTimeout(() => {
                overlay.classList.remove('show');
                setTimeout(() => {
                    const nbo = document.getElementById('newBatterOverlay');
                    if (!nbo || !nbo.classList.contains('show')) content.classList.remove('hide-for-hype');
                    overlay.querySelectorAll('.tech-grid, .hype-flash, .hype-streak, .hype-ring, .hype-particle').forEach(el => el.remove());
                    overlay.className = 'hype-overlay';
                    done();
                    resolve();
                }, 300);
            }, duration || 2500);
        }), 10);
    });
}

function burstParticles(overlay, typeClass) {
    const colors = {
        four: ['#35f2ff', '#9ef8ff', '#8a7dff'],
        six: ['#49ff88', '#b8ffd0', '#f7ff8f'],
        wicket: ['#ff4d6d', '#ff9aab', '#ffd6de']
    };
    const c = colors[typeClass] || colors.four;
    const count = window.innerWidth < 640 ? 22 : 34;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'hype-particle';
        const angle = Math.random() * Math.PI * 2;
        const distance = 60 + Math.random() * 180;
        const x = Math.cos(angle) * distance + 'px';
        const y = Math.sin(angle) * distance + 'px';
        const size = 4 + Math.random() * 10;
        const color = c[Math.floor(Math.random() * c.length)];
        p.style.cssText = `left: 50%; top: 50%; width: ${size}px; height: ${size}px; --x: ${x}; --y: ${y}; background: ${color}; box-shadow: 0 0 16px ${color}; animation-delay: ${Math.random() * 0.08}s;`;
        overlay.appendChild(p);
    }
}

function setProfilePhoto(photo, playerName) {
    const wrap = document.getElementById('ppPhotoWrap'),
        img = document.getElementById('ppPhoto'),
        fallback = document.getElementById('ppPhotoFallback');
    if (!wrap || !img || !fallback) return;
    const normalizedSrc = normalizeProfilePhotoSrc(photo);
    fallback.innerText = getTwoInitials(playerName);
    wrap.classList.remove('has-image');
    img.removeAttribute('src');
    if (!normalizedSrc) return;
    const tempImg = new Image();
    tempImg.onload = () => {
        img.src = normalizedSrc;
        wrap.classList.add('has-image');
    };
    tempImg.onerror = () => {
        wrap.classList.remove('has-image');
        img.removeAttribute('src');
    };
    tempImg.src = normalizedSrc;
}

function showPlayerProfile(data, duration) {
    const hypeOverlay = document.getElementById('hypeOverlay');
    if (hypeOverlay && hypeOverlay.classList.contains('show')) {
        if (window.profileRetry) clearTimeout(window.profileRetry);
        let retryCount = 0;
        const maxRetries = 20;

        function retryProfile() {
            retryCount++;
            const hype = document.getElementById('hypeOverlay');
            if (hype && hype.classList.contains('show') && retryCount < maxRetries) {
                window.profileRetry = setTimeout(retryProfile, 300);
            } else {
                showPlayerProfileImmediate(data, duration);
            }
        }
        window.profileRetry = setTimeout(retryProfile, 300);
        return;
    }
    showPlayerProfileImmediate(data, duration);
}

function showPlayerProfileImmediate(data, duration) {
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) return;
    setProfilePhoto(data?.photo || '', data?.name || 'PLAYER NAME');
    setText('ppRole', data?.role || 'PLAYER');
    setText('ppName', data?.name || 'PLAYER NAME');
    setText('ppSchool', data?.school || 'School Name');
    const ppAge = document.getElementById('ppAge');
    if (ppAge) ppAge.innerText = data?.age ? 'Age ' + data.age : '';
    scoreboard.classList.add('profile-mode');
    isPlayerProfileVisible = true;
    const normalContent = document.getElementById('normalContent'),
        newBatterOverlay = document.getElementById('newBatterOverlay'),
        hypeOverlay = document.getElementById('hypeOverlay');
    if (normalContent && newBatterOverlay) {
        normalContent.classList.add('hide-for-hype');
        newBatterOverlay.classList.add('show');
        if (newBatterTimeout) clearTimeout(newBatterTimeout);
        newBatterTimeout = setTimeout(() => {
            newBatterOverlay.classList.remove('show');
            setTimeout(() => {
                if ((!hypeOverlay || !hypeOverlay.classList.contains('show')) && !scoreboard.classList.contains('is-special')) normalContent.classList.remove('hide-for-hype');
            }, 300);
        }, Math.max(2500, animSettings.newBatterDelay + 900));
    }
    if (profileTimeout) clearTimeout(profileTimeout);
    profileTimeout = setTimeout(() => hidePlayerProfile(), duration || animSettings.profileDuration);
}

function hidePlayerProfile() {
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) return;
    scoreboard.classList.remove('profile-mode');
    isPlayerProfileVisible = false;
    const newBatterOverlay = document.getElementById('newBatterOverlay'),
        normalContent = document.getElementById('normalContent'),
        hypeOverlay = document.getElementById('hypeOverlay');
    if (newBatterOverlay && newBatterOverlay.classList.contains('show')) {
        newBatterOverlay.classList.remove('show');
        if (newBatterTimeout) {
            clearTimeout(newBatterTimeout);
            newBatterTimeout = null;
        }
        setTimeout(() => {
            if ((!hypeOverlay || !hypeOverlay.classList.contains('show')) && !scoreboard.classList.contains('is-special'))
                if (normalContent) normalContent.classList.remove('hide-for-hype');
            flushQueuedUpcomingBatter(120);
        }, 300);
    } else {
        flushQueuedUpcomingBatter(120);
    }
    if (profileTimeout) {
        clearTimeout(profileTimeout);
        profileTimeout = null;
    }
    setTimeout(() => {
        const wrap = document.getElementById('ppPhotoWrap'),
            img = document.getElementById('ppPhoto'),
            fallback = document.getElementById('ppPhotoFallback');
        if (wrap) wrap.classList.remove('has-image');
        if (img) img.removeAttribute('src');
        if (fallback) fallback.innerText = 'PL';
    }, 700);
}

function showSummary(data) {
    if (overlayManager.current === 'winner' || overlayManager.current === 'scorecard' || overlayManager.current === 'presentDetails') {
        log('⏭️ Summary skipped - major overlay active:', overlayManager.current);
        return;
    }
    const overlay = document.getElementById('summaryOverlay'),
        scoreboard = document.getElementById('scoreboard'),
        inningsView = document.getElementById('sumInningsView'),
        matchView = document.getElementById('sumMatchView');
    if (!overlay || !scoreboard) return;
    if (data.title) setText('sumTitle', data.title);
    if (data.type === 'match') {
        if (inningsView) inningsView.style.display = 'none';
        if (matchView) matchView.style.display = 'block';
        setText('sumTeam1Badge', data.team1Name || 'T1');
        setText('sumTeam1Name', data.team1FullName || data.team1Name || 'Team 1');
        setText('sumTeam1Score', data.team1Score || '0/0');
        setText('sumTeam1Overs', `(${data.team1Overs || '0.0'})`);
        setText('sumTeam2Badge', data.team2Name || 'T2');
        setText('sumTeam2Name', data.team2FullName || data.team2Name || 'Team 2');
        setText('sumTeam2Score', data.team2Score || '0/0');
        setText('sumTeam2Overs', `(${data.team2Overs || '0.0'})`);
        setText('sumResultText', data.result || 'MATCH RESULT');
        renderPerformers('sumMatchBatsmen', data.batsmen, 'bat');
        renderPerformers('sumMatchBowlers', data.bowlers, 'bowl');
    } else {
        if (inningsView) inningsView.style.display = 'block';
        if (matchView) matchView.style.display = 'none';
        setText('sumTeamName', data.teamName);
        setText('sumRuns', data.runs);
        setText('sumOvers', '(' + data.overs + ' Overs)');
        setText('sumTarget', data.target);
        const batsmenEl = document.getElementById('sumBatsmen');
        if (batsmenEl && data.batsmen?.length > 0) {
            batsmenEl.innerHTML = data.batsmen.map(b => `<div class="sum-row"><span class="sum-name">${escapeHtml(b.name)}</span><span class="sum-stat">${b.runs} (${b.balls})</span></div>`).join('');
        }
        const bowlersEl = document.getElementById('sumBowlers');
        if (bowlersEl && data.bowlers?.length > 0) {
            bowlersEl.innerHTML = data.bowlers.map(b => `<div class="sum-row"><span class="sum-name">${escapeHtml(b.name)}</span><span class="sum-stat">${escapeHtml(b.figs)}</span></div>`).join('');
        }
    }
    overlay.classList.add('show');
    // Add ms-footer at the bottom of the summary overlay, outside any tables
    const existingFooter = overlay.querySelector('.ms-footer');
    if (!existingFooter) {
        const footerEl = document.createElement('div');
        footerEl.innerHTML = buildMsFooter();
        const footerNode = footerEl.firstElementChild;
        if (footerNode) overlay.appendChild(footerNode);
    }
    scoreboard.style.opacity = '0';
    scoreboard.style.transform = 'translateY(30px)';
    if (summaryAutoHideTimer) clearTimeout(summaryAutoHideTimer);
    summaryAutoHideTimer = setTimeout(() => hideSummary(), 20000);
}

function hideSummary() {
    const overlay = document.getElementById('summaryOverlay'),
        scoreboard = document.getElementById('scoreboard');
    if (!overlay || !scoreboard) return;
    overlay.classList.remove('show');
    // Remove ms-footer from summary overlay
    const footer = overlay.querySelector('.ms-footer');
    if (footer) footer.remove();
    scoreboard.style.opacity = '1';
    scoreboard.style.transform = 'translateY(0)';
    if (summaryAutoHideTimer) {
        clearTimeout(summaryAutoHideTimer);
        summaryAutoHideTimer = null;
    }
}

function renderPerformers(containerId, players, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!players || players.length === 0) {
        container.innerHTML = '<div class="sum-performer-item"><span class="sum-performer-name">--</span></div>';
        return;
    }
    container.innerHTML = players.map(p => `<div class="sum-performer-item"><span class="sum-performer-name">${escapeHtml(p.name)}</span><span class="sum-performer-stat">${type === 'bat' ? `${p.runs} (${p.balls})` : escapeHtml(p.figs)}</span></div>`).join('');
}

function switchView(targetViewId, holdTime) {
    if (currentView === targetViewId) return;
    const outEl = document.getElementById(currentView),
        inEl = document.getElementById(targetViewId);
    if (outEl) {
        outEl.classList.remove('active');
        outEl.classList.add('exit-left');
    }
    if (inEl) {
        inEl.classList.remove('exit-left');
        inEl.classList.add('active');
    }
    setTimeout(() => {
        if (outEl) outEl.classList.remove('exit-left');
    }, 600);
    currentView = targetViewId;
    if (targetViewId !== 'view-bowler') {
        clearTimeout(carouselTimer);
        carouselTimer = setTimeout(() => switchView('view-bowler'), holdTime || animSettings.viewHoldDuration);
    }
}

function startAutoCarousel() {
    if (carouselLoop) clearInterval(carouselLoop);
    carouselLoop = setInterval(() => {
        if (autoCarouselEnabled && currentView === 'view-bowler' && !autoMilestoneActive && rotateViews.length > 0) {
            switchView(rotateViews[viewIndex], animSettings.viewHoldDuration);
            viewIndex = (viewIndex + 1) % rotateViews.length;
        }
    }, animSettings.carouselInterval);
}

function updateChaseCarousel(data) {
    const target = parseInt(data.target) || 0,
        runs = parseInt(data.runs) || 0,
        totalOvers = parseInt(data.totOvers) || 20,
        crr = parseFloat(data.crr) || 0;
    const fill = document.getElementById('chaseViewFill'),
        crrEl = document.getElementById('chaseCrr'),
        rrrEl = document.getElementById('chaseRrr'),
        title = document.getElementById('chaseViewTitle'),
        scoreLabel = document.getElementById('chaseScoreLabel');
    if (!fill || !crrEl || !rrrEl || !title || !scoreLabel) return;
    if (target <= 0) return;
    const need = Math.max(0, target - runs);
    const bowledBalls = oversToBallsScorebar(data.overs);
    const totalBalls = totalOvers * 6;
    const ballsRem = Math.max(0, totalBalls - bowledBalls);
    // [Fix #1 & #4] Use ballsToExactOvers for RRR calc, guard division by zero
    const rrr = (need > 0 && ballsRem > 0) ? (need / ballsToExactOvers(ballsRem)) : 0;
    const progressPct = Math.min((runs / Math.max(1, target - 1)) * 100, 100);
    fill.style.width = `${progressPct}%`;
    if (runs >= target) {
        fill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
        title.innerText = 'TARGET CHASED ✅';
    } else if (progressPct > 70) {
        fill.style.background = 'linear-gradient(90deg, #10b981, #6ee7b7)';
        title.innerText = 'TARGET PROGRESS';
    } else if (progressPct > 40) {
        fill.style.background = 'linear-gradient(90deg, var(--gold), #fde047)';
        title.innerText = 'TARGET PROGRESS';
    } else {
        fill.style.background = 'linear-gradient(90deg, #ef4444, #fca5a5)';
        title.innerText = 'TARGET PROGRESS';
    }
    scoreLabel.innerText = `${runs} / ${target - 1}`;
    crrEl.innerText = crr.toFixed(2);
    rrrEl.innerText = rrr.toFixed(2);
    crrEl.className = '';
    rrrEl.className = '';
    if (crr > rrr) {
        crrEl.classList.add('chase-rate-good');
        rrrEl.classList.add('chase-rate-bad');
    } else if (rrr > crr) {
        crrEl.classList.add('chase-rate-bad');
        rrrEl.classList.add('chase-rate-good');
    } else {
        crrEl.classList.add('chase-rate-even');
        rrrEl.classList.add('chase-rate-even');
    }
}

function updateLeadTrail(testData) {
    if (!testData) return;
    const title = document.getElementById('leadViewTitle'),
        value = document.getElementById('leadViewValue');
    if (!title || !value) return;
    if (testData.isLead) {
        title.innerText = 'LEAD';
        title.style.color = '#86efac';
    } else {
        title.innerText = 'TRAIL';
        title.style.color = '#fca5a5';
    }
    value.innerText = testData.lead || 0;
}

function buildSafeCrest(name, logoSrc, className) {
    const wrapper = document.createElement('div');
    wrapper.className = className || 'pd-crest';
    if (logoSrc && logoSrc.length > 10) {
        wrapper.classList.add(className ? `${className.split(' ')[0]}-has-logo` : 'pd-has-logo');
        const img = document.createElement('img');
        img.alt = name;
        img.addEventListener('error', () => {
            wrapper.classList.remove('pd-has-logo', 'ms-has-logo', 'ms-crest-has-logo');
            wrapper.innerHTML = escapeHtml(name);
        }, {
            once: true
        });
        img.src = logoSrc;
        wrapper.appendChild(img);
    } else {
        wrapper.textContent = name;
    }
    return wrapper.outerHTML;
}

function showPresentDetails(payload) {
    if (!payload) return;
    if (!overlayManager.canShow('presentDetails')) {
        log('⏭️ Present Details queued - active overlay:', overlayManager.current);
        overlayManager.addToQueue('presentDetails', () => showPresentDetails(payload));
        return;
    }
    overlayManager.setActive('presentDetails');
    const overlay = document.getElementById('presentDetailsOverlay');
    if (!overlay) {
        overlayManager.clearActive('presentDetails');
        return;
    }
    hidePlayerProfile();
    hideSummary();
    if (presentDetailsTimer) {
        clearTimeout(presentDetailsTimer);
        presentDetailsTimer = null;
    }
    const gen = ++presentDetailsGeneration;
    const team1Name = payload.team1Name || currentMatchData.batTeam || 'T1';
    const team2Name = payload.team2Name || currentMatchData.bowlTeam || 'T2';
    const team1FullName = payload.team1FullName || team1Name;
    const team2FullName = payload.team2FullName || team2Name;
    const team1Logo = payload.team1Logo || '';
    const team2Logo = payload.team2Logo || '';
    const totalScore = payload.totalScore || `${currentMatchData.runs}/${currentMatchData.wkts}`;
    const overs = payload.overs || currentMatchData.overs || '0.0';
    const extras = payload.extras || 0;
    const rows = payload.rows || [];

    function buildSafeCrestHtml(name, logoSrc, cssClass) {
        const safeClass = cssClass || 'pd-crest';
        if (logoSrc && logoSrc.length > 10) {
            return `<div class="${safeClass} pd-has-logo" data-fallback="${escapeAttr(name)}"><img alt="${escapeAttr(name)}"></div>`;
        }
        return `<div class="${safeClass}">${escapeHtml(name)}</div>`;
    }

    function formatTeamName(fullName) {
        const parts = (fullName || '').trim().split(/\s+/);
        if (parts.length <= 2) return escapeHtml(fullName);
        const mid = Math.ceil(parts.length / 2);
        return escapeHtml(parts.slice(0, mid).join(' ')) + '<br>' + escapeHtml(parts.slice(mid).join(' '));
    }
    let rowsHTML = '';
    rows.forEach((row, i) => {
        const isNotOut = !row.isOut;
        const isLastNotOut = isNotOut && !rows.slice(i + 1).some(r => !r.isOut);
        rowsHTML += `<tr class="${isLastNotOut ? 'pd-last-row-active' : ''}"><td class="pd-batsman-name">${escapeHtml(row.name || '--')}</td><td class="pd-dismissal ${row.isOut ? 'pd-out' : 'pd-not-out'}">${escapeHtml(row.dismissal || '--')}</td><td>${escapeHtml(row.bowler || '-')}</td><td>${escapeHtml(row.fielder || '-')}</td><td class="pd-runs">${parseInt(row.runs) >= 0 ? row.runs : '-'}</td><td class="pd-balls">${parseInt(row.balls) >= 0 ? row.balls : '-'}</td></tr>`;
    });
    if (!rowsHTML) {
        rowsHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#888;">No batting data available</td></tr>';
    }
    overlay.innerHTML = `<div class="pd-wrapper"><div class="pd-main-header"><div class="pd-panel pd-panel-left"><div class="pd-panel-content">${buildSafeCrestHtml(team1Name, team1Logo, 'pd-crest')}</div></div><div class="pd-panel pd-panel-center"><div class="pd-panel-content"><h1 class="pd-title-text">#BATTLE OF THE GOLD</h1></div></div><div class="pd-panel pd-panel-right"><div class="pd-panel-content">${buildSafeCrestHtml(team2Name, team2Logo, 'pd-crest')}</div></div></div><div class="pd-scoreboard-container"><div class="pd-table-header-section"><div class="pd-top-row"><div class="pd-shape pd-shape-left"><div class="pd-shape-content">${formatTeamName(team1FullName)}</div></div><div class="pd-shape pd-shape-center"><div class="pd-shape-content" style="font-size:1.5rem;text-transform:uppercase;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;">Thomians'<div style='font-weight:200;'> Media </div><span class="pd-tm-logo"><span></span></span></div></div><div class="pd-shape pd-shape-right"><div class="pd-shape-content">${formatTeamName(team2FullName)}</div></div></div><div class="pd-bottom-bar"><div class="pd-bottom-text">LIVE FROM BURNARD ALUWIHARE GROUND MATALE</div></div></div><div class="pd-scorecard"><table class="pd-table"><thead><tr><th>Batsman</th><th>Dismissal</th><th>Bowler</th><th>Fielder</th><th>Runs</th><th>Balls</th></tr></thead><tbody id="pdTableBody">${rowsHTML}</tbody></table></div><div class="pd-total-bar"><div class="pd-bar-content"><span class="pd-bar-item">#BATTLE OF THE GOLD</span><div class="pd-divider"></div><span class="pd-bar-item">${extras} EXTRAS</span><div class="pd-divider"></div><span class="pd-bar-item">${escapeHtml(overs)} OVERS</span></div><div class="pd-score-section"><span class="pd-total-score">${escapeHtml(totalScore)}</span></div></div></div></div>${buildMsFooter()}`;
    overlay.querySelectorAll('.pd-crest.pd-has-logo').forEach(el => {
        const fallback = el.getAttribute('data-fallback') || '?';
        const img = el.querySelector('img');
        if (img) {
            img.addEventListener('error', () => {
                el.classList.remove('pd-has-logo');
                el.textContent = fallback;
            }, {
                once: true
            });
            const logoSrc = el === overlay.querySelector('.pd-panel-left .pd-crest') ? team1Logo : team2Logo;
            img.src = logoSrc;
        }
    });
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    const rowCount = Math.min(rows.length || 1, 11);
    const lastRowFinishTime = 800 + (150 * rowCount) + 400 + 500;
    setTimeout(() => {
        const tbody = document.getElementById('pdTableBody');
        if (tbody) tbody.classList.add('pd-tr-interactive');
    }, lastRowFinishTime);
    const duration = payload.duration || 20000;
    presentDetailsTimer = setTimeout(() => {
        if (gen === presentDetailsGeneration) hidePresentDetails();
    }, duration);
}

function hidePresentDetails() {
    const overlay = document.getElementById('presentDetailsOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            if (overlay) overlay.innerHTML = '';
        }, 400);
    }
    if (presentDetailsTimer) {
        clearTimeout(presentDetailsTimer);
        presentDetailsTimer = null;
    }
    overlayManager.clearActive('presentDetails');
}

function showWinnerOverlay(payload) {
    if (!payload) return;
    if (!overlayManager.canShow('winner')) {
        log('⏭️ Winner overlay queued - active overlay:', overlayManager.current);
        overlayManager.addToQueue('winner', () => showWinnerOverlay(payload));
        return;
    }
    overlayManager.setActive('winner');
    const overlay = document.getElementById('winnerOverlay');
    if (!overlay) {
        overlayManager.clearActive('winner');
        return;
    }
    hidePlayerProfile();
    hideSummary();
    hidePresentDetails();
    const scoreboard = document.getElementById('scoreboard');
    if (scoreboard) {
        scoreboard.style.opacity = '0';
        scoreboard.style.transform = 'translateY(30px)';
    }
    if (winnerTimer) {
        clearTimeout(winnerTimer);
        winnerTimer = null;
    }
    const gen = ++winnerGeneration;
    let batsmenHTML = '';
    if (payload.topBatsmen && payload.topBatsmen.length > 0) {
        batsmenHTML = payload.topBatsmen.map(b => `<div class="win-stat-row"><div><span class="win-player-name">${escapeHtml(b.name)}</span>${!b.isOut ? '<span class="win-not-out-badge">NOT OUT</span>' : ''}</div><div><span class="win-player-stat">${b.runs}</span><span class="win-player-detail">(${b.balls}b, ${b.fours || 0}×4, ${b.sixes || 0}×6)</span></div></div>`).join('');
    } else {
        batsmenHTML = '<div class="win-stat-row"><span class="win-player-name" style="color:rgba(255,255,255,0.4);">No data</span></div>';
    }
    let bowlersHTML = '';
    if (payload.topBowlers && payload.topBowlers.length > 0) {
        bowlersHTML = payload.topBowlers.map(b => `<div class="win-stat-row"><span class="win-player-name">${escapeHtml(b.name)}</span><div><span class="win-player-stat">${b.wickets}/${b.runs}</span><span class="win-player-detail">(${escapeHtml(b.overs)} ov)</span></div></div>`).join('');
    } else {
        bowlersHTML = '<div class="win-stat-row"><span class="win-player-name" style="color:rgba(255,255,255,0.4);">No data</span></div>';
    }
    overlay.innerHTML = `<div class="win-wrapper"><div class="win-trophy-section"><span class="win-trophy-icon">🏆</span><span class="win-match-label">MATCH RESULT</span></div><div class="win-team-card"><div class="win-logo" id="winnerLogoEl" data-logo="${escapeAttr(payload.winnerLogo || '')}" data-name="${escapeAttr(payload.winnerShortName || '')}"><span class="win-logo-text">${escapeHtml(payload.winnerShortName || '?')}</span></div><div class="win-team-info"><div class="win-team-name">${escapeHtml(payload.winnerTeamName)}</div><div class="win-margin">${escapeHtml(payload.marginText)}</div><div class="win-result-line">${escapeHtml(payload.resultLine)}</div></div><div class="win-score-section"><div class="win-score-big">${escapeHtml(payload.score)}</div><div class="win-score-overs">${escapeHtml(payload.overs)} OVERS</div><div class="win-crr">CRR ${escapeHtml(String(payload.crr || '0.00'))}</div></div></div><div class="win-stats-section"><div class="win-stat-card"><div class="win-stat-title">🏏 TOP BATSMEN</div><div class="win-stat-list">${batsmenHTML}</div></div><div class="win-stat-card"><div class="win-stat-title">🎯 TOP BOWLERS</div><div class="win-stat-list">${bowlersHTML}</div></div></div></div>${buildMsFooter()}`;
    if (payload.winnerLogo && payload.winnerLogo.length > 10) {
        const logoEl = overlay.querySelector('#winnerLogoEl');
        if (logoEl) {
            logoEl.innerHTML = '';
            const img = document.createElement('img');
            img.alt = escapeAttr(payload.winnerShortName || '');
            img.style.cssText = 'width:85%;height:85%;object-fit:contain;';
            img.addEventListener('error', () => {
                logoEl.innerHTML = `<span class="win-logo-text">${escapeHtml(payload.winnerShortName || '?')}</span>`;
            }, {
                once: true
            });
            logoEl.appendChild(img);
            img.src = payload.winnerLogo;
        }
    }
    overlay.classList.remove('show', 'hiding');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    const duration = payload.duration || 18000;
    winnerTimer = setTimeout(() => {
        if (gen === winnerGeneration) hideWinnerOverlay();
    }, duration);
}

function hideWinnerOverlay() {
    const overlay = document.getElementById('winnerOverlay');
    if (!overlay) return;
    overlay.classList.add('hiding');
    setTimeout(() => {
        overlay.classList.remove('show', 'hiding');
        overlay.innerHTML = '';
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard) {
            scoreboard.style.opacity = '1';
            scoreboard.style.transform = 'translateY(0)';
        }
    }, 800);
    if (winnerTimer) {
        clearTimeout(winnerTimer);
        winnerTimer = null;
    }
    overlayManager.clearActive('winner');
}

function autoScaleMatchScorecard() {
    const overlay = document.getElementById('matchScorecardOverlay');
    if (!overlay || !overlay.classList.contains('show')) return;
    const wrapper = overlay.querySelector('.ms-wrapper');
    if (!wrapper) return;
    wrapper.style.transform = 'scale(1)';
    requestAnimationFrame(() => {
        const viewportH = window.innerHeight,
            viewportW = window.innerWidth,
            contentH = wrapper.scrollHeight,
            contentW = wrapper.scrollWidth;
        const scaleH = (viewportH * 0.96) / contentH;
        const scaleW = (viewportW * 0.96) / contentW;
        let scale = Math.min(scaleH, scaleW, 1);
        if (scale < 0.5) scale = 0.5;
        if (scale < 0.98) {
            wrapper.style.transform = `scale(${scale.toFixed(3)})`;
            wrapper.style.transformOrigin = 'center center';
        } else {
            wrapper.style.transform = '';
        }
    });
}

function showMatchScorecard(payload) {
    if (!payload) return;
    if (!overlayManager.canShow('scorecard')) {
        log('⏭️ Scorecard queued - active overlay:', overlayManager.current);
        overlayManager.addToQueue('scorecard', () => showMatchScorecard(payload));
        return;
    }
    overlayManager.setActive('scorecard');
    const overlay = document.getElementById('matchScorecardOverlay');
    if (!overlay) {
        overlayManager.clearActive('scorecard');
        return;
    }
    hidePlayerProfile();
    hideSummary();
    hidePresentDetails();
    hideWinnerOverlay();
    const scoreboard = document.getElementById('scoreboard');
    if (scoreboard) {
        scoreboard.style.opacity = '0';
        scoreboard.style.transform = 'translateY(30px)';
    }
    if (matchScorecardTimer) {
        clearTimeout(matchScorecardTimer);
        matchScorecardTimer = null;
    }
    const gen = ++scorecardGeneration;
    const team1 = payload.team1 || {},
        team2 = payload.team2 || {};
    const result = payload.resultText || 'MATCH RESULT';
    const team1Logo = team1.logo || '';
    const team2Logo = team2.logo || '';

    function buildBattingRows(rows) {
        if (!rows || rows.length === 0) return '<tr><td colspan="6" style="padding:16px;text-align:center;color:#888;">No batting data</td></tr>';
        return rows.map((row, i) => {
            const isNotOut = !row.isOut;
            const isLastNotOut = isNotOut && !rows.slice(i + 1).some(r => !r.isOut);
            return `<tr class="${isLastNotOut ? 'ms-row-not-out' : ''}"><td style="font-weight:600;">${escapeHtml(row.name || '--')}</td><td class="ms-dismissal ${row.isOut ? 'ms-out' : 'ms-not-out'}">${escapeHtml(row.dismissal || '--')}</td><td>${escapeHtml(row.bowler || '-')}</td><td class="ms-runs-cell">${parseInt(row.runs) >= 0 ? row.runs : '-'}</td><td class="ms-balls-cell">${parseInt(row.balls) >= 0 ? row.balls : '-'}</td><td>${(row.fours ?? '-')}/${(row.sixes ?? '-')}</td></tr>`;
        }).join('');
    }

    function buildTeamCard(team, label) {
        const extras = team.extras ?? 0;
        const overs = team.overs || '0.0';
        const score = team.score || '0/0';
        return `<div class="ms-team-card"><div class="ms-team-header"><div class="ms-team-header-left"><div class="ms-team-header-crest ms-crest-placeholder" data-logo="${escapeAttr(team.logo || '')}" data-name="${escapeAttr(team.shortName || '')}">${escapeHtml(team.shortName || '?')}</div><div class="ms-team-header-info"><span class="ms-team-header-name">${escapeHtml(team.fullName || team.shortName)}</span><span class="ms-team-header-label">${escapeHtml(label)}</span></div></div><div class="ms-team-header-score"><span class="ms-team-score-big">${escapeHtml(score)}</span><span class="ms-team-score-overs">(${escapeHtml(overs)} OV)</span></div></div><div class="ms-batting-table"><table class="ms-table"><thead><tr><th>Batsman</th><th>Dismissal</th><th>Bowler</th><th>R</th><th>B</th><th>4s/6s</th></tr></thead><tbody>${buildBattingRows(team.batting || [])}</tbody></table></div><div class="ms-total-bar"><div class="ms-bar-content"><span class="ms-bar-item">EXTRAS: ${extras}</span><div class="ms-bar-divider"></div><span class="ms-bar-item">${escapeHtml(overs)} OVERS</span></div><div class="ms-bar-score-section"><span class="ms-bar-total-score">${escapeHtml(score)}</span></div></div></div>`;
    }

    function buildPerformerRows(performers, type) {
        if (!performers || performers.length === 0) return '<div class="ms-performer-row"><span class="ms-performer-name" style="color:rgba(255,255,255,0.4);">No data</span></div>';
        return performers.map(p => {
            const stat = type === 'bat' ? `${p.runs}(${p.balls})` : `${p.wickets}/${p.runs}`;
            const detail = type === 'bat' ? `${p.fours || 0}×4, ${p.sixes || 0}×6` : `${escapeHtml(p.overs)} ov`;
            return `<div class="ms-performer-row"><span class="ms-performer-name">${escapeHtml(p.name)}<span class="ms-performer-team-tag">${escapeHtml(p.team || '')}</span></span><div><span class="ms-performer-stat">${stat}</span><span class="ms-performer-detail">${detail}</span></div></div>`;
        }).join('');
    }
    overlay.innerHTML = `<div class="ms-wrapper"><div class="ms-main-header"><div class="ms-panel ms-panel-left"><div class="ms-panel-content"><div class="ms-crest ms-header-crest-1" data-logo="${escapeAttr(team1Logo)}" data-name="${escapeAttr(team1.shortName || '')}">${escapeHtml(team1.shortName || '?')}</div></div></div><div class="ms-panel ms-panel-center"><div class="ms-panel-content"><h1 class="ms-title-text">⚔️ BATTLE OF THE GOLD</h1></div></div><div class="ms-panel ms-panel-right"><div class="ms-panel-content"><div class="ms-crest ms-header-crest-2" data-logo="${escapeAttr(team2Logo)}" data-name="${escapeAttr(team2.shortName || '')}">${escapeHtml(team2.shortName || '?')}</div></div></div></div><div class="ms-result-banner"><div class="ms-result-bottom-line"></div><span class="ms-result-emoji">🏆</span><span class="ms-result-text">${escapeHtml(result)}</span><span class="ms-result-emoji">🏆</span></div><div class="ms-teams-container">${buildTeamCard(team1, '1ST INNINGS')}${buildTeamCard(team2, '2ND INNINGS')}</div><div class="ms-performers-section"><div class="ms-performer-card"><div class="ms-performer-title">🏏 TOP BATSMEN</div><div class="ms-performer-list">${buildPerformerRows(payload.topBatsmen, 'bat')}</div></div><div class="ms-performer-card"><div class="ms-performer-title">🎯 TOP BOWLERS</div><div class="ms-performer-list">${buildPerformerRows(payload.topBowlers, 'bowl')}</div></div></div>${buildMsFooter()}</div>`;
    overlay.querySelectorAll('[data-logo]').forEach(el => {
        const logoSrc = el.getAttribute('data-logo');
        const name = el.getAttribute('data-name') || '?';
        if (logoSrc && logoSrc.length > 10) {
            el.classList.add('ms-has-logo');
            const img = document.createElement('img');
            img.alt = name;
            img.addEventListener('error', () => {
                el.classList.remove('ms-has-logo');
                el.textContent = name;
            }, {
                once: true
            });
            img.src = logoSrc;
            el.innerHTML = '';
            el.appendChild(img);
        }
    });
    overlay.classList.remove('show', 'hiding');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    setTimeout(autoScaleMatchScorecard, 100);
    setTimeout(autoScaleMatchScorecard, 500);
    const duration = payload.duration || 25000;
    matchScorecardTimer = setTimeout(() => {
        if (gen === scorecardGeneration) hideMatchScorecard();
    }, duration);
}

function hideMatchScorecard() {
    const overlay = document.getElementById('matchScorecardOverlay');
    if (!overlay) return;
    overlay.classList.add('hiding');
    setTimeout(() => {
        overlay.classList.remove('show', 'hiding');
        overlay.innerHTML = '';
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard) {
            scoreboard.style.opacity = '1';
            scoreboard.style.transform = 'translateY(0)';
        }
    }, 600);
    if (matchScorecardTimer) {
        clearTimeout(matchScorecardTimer);
        matchScorecardTimer = null;
    }
    overlayManager.clearActive('scorecard');
}
if (IS_DEBUG) {
    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case '4':
                triggerHype('FOUR', animSettings.fourDuration);
                break;
            case '6':
                triggerHype('SIX', animSettings.sixDuration);
                break;
            case 'w':
            case 'W':
                triggerHype('WICKET', animSettings.wicketDuration);
                break;
            case 'p':
            case 'P':
                if (isPlayerProfileVisible) hidePlayerProfile();
                else showPlayerProfile({
                    photo: '',
                    role: 'BATSMAN',
                    name: 'TEST PLAYER',
                    school: 'Test School',
                    age: '25'
                }, animSettings.profileDuration);
                break;
            case 'm':
            case 'M': {
                const so = document.getElementById('summaryOverlay');
                if (so && so.classList.contains('show')) hideSummary();
                else showSummary({
                    title: 'INNINGS SUMMARY',
                    teamName: 'TEST',
                    runs: '150/5',
                    overs: '20.0',
                    target: '151',
                    batsmen: [{
                        name: 'Player 1',
                        runs: 75,
                        balls: 45
                    }],
                    bowlers: [{
                        name: 'Bowler 1',
                        figs: '2-25 (4.0)'
                    }]
                });
                break;
            }
            case 't':
            case 'T':
                triggerAutoMilestone(generateMilestoneCard({
                    name: 'TEST PLAYER',
                    runs: 50,
                    balls: 30,
                    fours: 5,
                    sixes: 2
                }), animSettings.milestoneDuration);
                break;
            case 'd':
            case 'D':
                showPresentDetails({
                    team1Name: 'STC',
                    team2Name: 'GSC',
                    team1FullName: 'ST.THOMAS COLLEGE MATALE',
                    team2FullName: 'GOVT.SCIENCE COLLEGE MATALE',
                    totalScore: '222/10',
                    overs: '18.5',
                    extras: 5,
                    rows: [{
                        name: 'KAMAL KULARATHNA',
                        dismissal: 'BOWLED',
                        bowler: 'NIPUN',
                        fielder: '-',
                        runs: 45,
                        balls: 38,
                        isOut: true
                    }, {
                        name: 'NUWAN PERERA',
                        dismissal: 'CAUGHT',
                        bowler: 'NIPUN',
                        fielder: 'KAMAL',
                        runs: 23,
                        balls: 19,
                        isOut: true
                    }, {
                        name: 'KASUN RAJITHA',
                        dismissal: 'NOT OUT',
                        bowler: '-',
                        fielder: '-',
                        runs: 0,
                        balls: 0,
                        isOut: false
                    }],
                    duration: 15000
                });
                break;
            case 'r':
            case 'R':
                showWinnerOverlay({
                    winnerTeamName: 'ST. THOMAS COLLEGE MATALE',
                    winnerShortName: 'STC',
                    winnerLogo: '',
                    loserTeamName: 'Govt. Science College',
                    loserShortName: 'GSC',
                    loserLogo: '',
                    marginText: 'WON BY 5 WICKETS',
                    resultLine: '156/5 in 18.3 overs',
                    score: '156/5',
                    overs: '18.3',
                    crr: '8.43',
                    topBatsmen: [{
                        name: 'SHEHAN M',
                        runs: 67,
                        balls: 42,
                        fours: 6,
                        sixes: 3,
                        isOut: false
                    }],
                    topBowlers: [{
                        name: 'NIPUN F',
                        wickets: 3,
                        runs: 28,
                        overs: '4.0'
                    }],
                    duration: 15000
                });
                break;
            case 'c':
            case 'C':
                showMatchScorecard({
                    resultText: 'STC WON BY 5 WICKETS',
                    team1: {
                        shortName: 'GSC',
                        fullName: 'GOVT. SCIENCE COLLEGE MATALE',
                        logo: '',
                        score: '154/10',
                        overs: '19.3',
                        extras: 8,
                        batting: [{
                            name: 'KAMAL P',
                            dismissal: 'BOWLED',
                            bowler: 'NIPUN',
                            runs: 45,
                            balls: 38,
                            fours: 5,
                            sixes: 1,
                            isOut: true
                        }]
                    },
                    team2: {
                        shortName: 'STC',
                        fullName: 'ST. THOMAS COLLEGE MATALE',
                        logo: '',
                        score: '156/5',
                        overs: '18.3',
                        extras: 5,
                        batting: [{
                            name: 'SHEHAN M',
                            dismissal: 'NOT OUT',
                            bowler: '-',
                            runs: 67,
                            balls: 42,
                            fours: 6,
                            sixes: 3,
                            isOut: false
                        }]
                    },
                    topBatsmen: [{
                        name: 'SHEHAN M',
                        team: 'STC',
                        runs: 67,
                        balls: 42,
                        fours: 6,
                        sixes: 3
                    }],
                    topBowlers: [{
                        name: 'NIPUN F',
                        team: 'STC',
                        wickets: 3,
                        runs: 28,
                        overs: '4.0'
                    }],
                    duration: 25000
                });
                break;
        }
    });
    log('🔧 Debug mode active - keyboard shortcuts enabled');
    log('⌨️ Shortcuts: 4=FOUR, 6=SIX, W=WICKET, P=Profile, M=Summary, T=Milestone, D=Present Details, R=Winner, C=Scorecard');
}
window.addEventListener('beforeunload', () => {
    stopPresenceRefresh();
});
window.addEventListener('offline', () => log('⚠️ Internet connection lost'));
window.addEventListener('online', () => log('✅ Internet connection restored'));
log('🏏 Scorebar V35.0 Bug-Fixed Loaded');