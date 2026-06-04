// ==========================================
// AUTH.JS - V2.2 Professional Auth System
// ✅ V2.2: Real-time role revocation + infinite loop fix + periodic fallback
// ==========================================

const AUTH_CONFIG = {
    FIREBASE: {
        apiKey: "AIzaSyA3SPSsNTwK6doYq-lpKTozGgRha9HObFI",
        authDomain: "stc-score-v3.firebaseapp.com",
        databaseURL: "https://stc-score-v3-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "stc-score-v3",
        storageBucket: "stc-score-v3.firebasestorage.app",
        messagingSenderId: "626214005830",
        appId: "1:626214005830:web:bd50292e589b0d34896e47"
    },
    OWNER_EMAIL: 'YOUR_EMAIL@gmail.com',
    PAGE_ROLES: {
        admin: ['owner', 'admin'],
        scorer: ['owner', 'admin', 'scorer'],
        team: ['owner', 'admin', 'team'],
        scorebar: [],
        'admin-control': ['owner']
    },
    PAGE_NAMES: {
        admin: 'Admin Panel',
        scorer: 'Score Updater',
        team: 'Team Manager',
        scorebar: 'Scoreboard',
        'admin-control': 'Access Control'
    }
};

let authDb = null;
let authAuth = null;
let authApp = null;
let currentUser = null;
let currentUserData = null;
let currentPageName = null;
let accessListenerAttached = false;
let accessListenerRef = null;
let isRedirectFlow = false;
let bandwidthTracker = { reads: 0, writes: 0, estimatedKB: 0 };
let accessCheckInterval = null; // ✅ V2.2: Periodic fallback

// ==========================================
// BANDWIDTH TRACKER
// ==========================================
function trackBandwidth(type, data) {
    if (type === 'read') bandwidthTracker.reads++;
    if (type === 'write') bandwidthTracker.writes++;
    bandwidthTracker.estimatedKB += Math.ceil(JSON.stringify(data || {}).length / 1024);
}
function getBandwidthUsage() { return { ...bandwidthTracker }; }

// ==========================================
// ENVIRONMENT CHECKS
// ==========================================
function isSecureEnvironment() {
    const proto = window.location.protocol;
    return proto === 'https:' || proto === 'http:' || proto === 'chrome-extension:';
}
function isWebStorageAvailable() {
    try { localStorage.setItem('__t__', '1'); localStorage.removeItem('__t__'); return true; }
    catch (e) { return false; }
}

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
function initAuthFirebase() {
    if (authApp) return;
    try {
        if (!window.firebase) { console.error('Firebase SDK not loaded!'); return; }
        if (!firebase.apps.length) authApp = firebase.initializeApp(AUTH_CONFIG.FIREBASE);
        else authApp = firebase.apps[0];
        authDb = firebase.database();
        authAuth = firebase.auth();
        const persistence = isWebStorageAvailable()
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION;
        authAuth.setPersistence(persistence).catch(err => {
            authAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err2 => {
                authAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
            });
        });
        console.log('Auth Firebase initialized');
    } catch (error) { console.error('Firebase init error:', error); }
}

// ==========================================
// INJECT AUTH OVERLAY HTML
// ==========================================
function injectAuthOverlay(pageName) {
    const existing = document.getElementById('authOverlayNew');
    if (existing) existing.remove();
    const pageNameDisplay = AUTH_CONFIG.PAGE_NAMES[pageName] || pageName;
    const envWarning = !isSecureEnvironment()
    ? `<div class="auth-env-warning">Popup login not supported in this environment. Using redirect method.</div>`
    : '';

    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.id = 'authOverlayNew';

    overlay.innerHTML = `
        <div class="auth-bg">
            <div class="auth-grid"></div>
            <div class="auth-orb auth-orb-1"></div>
            <div class="auth-orb auth-orb-2"></div>
            <div class="auth-orb auth-orb-3"></div>
            <div class="auth-shooting-star"></div>
            <div class="auth-shooting-star"></div>
            <div class="auth-shooting-star"></div>
        </div>
        <div class="auth-card">
            <div class="auth-card-border"></div>
            <div class="auth-state active" id="authStateSignIn">
                <div class="auth-logo-container">
                    <div class="auth-logo-ring"></div>
                    <div class="auth-logo-ring auth-logo-ring-2"></div>
                    <div class="auth-logo-icon">
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                            <circle cx="20" cy="20" r="18" fill="url(#ballGrad)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                            <path d="M8 20 Q14 16, 20 20 Q26 24, 32 20" stroke="#FDE047" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/>
                            <path d="M8 24 Q14 20, 20 24 Q26 28, 32 24" stroke="#FDE047" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/>
                            <defs><radialGradient id="ballGrad" cx="0.35" cy="0.35"><stop offset="0%" stop-color="#ef4444"/><stop offset="60%" stop-color="#b91c1c"/><stop offset="100%" stop-color="#991b1b"/></radialGradient></defs>
                        </svg>
                    </div>
                </div>
                <div class="auth-page-badge"><span class="badge-dot"></span>${pageNameDisplay}</div>
                <h2 class="auth-title">Welcome Back</h2>
                <p class="auth-subtitle">Sign in with your Google account to access this page</p>
                ${envWarning}
                <button class="auth-google-btn" onclick="signInWithGoogle()">
                    <span class="google-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg></span>
                    <span class="btn-text">Sign in with Google</span><span class="btn-shimmer"></span>
                </button>
                <div class="auth-divider"><span>Secured by Firebase</span></div>
                <div class="auth-error" id="authError"></div>
                <div class="auth-footer">STC Cricket Live Score &bull; Protected System</div>
            </div>
            <div class="auth-state" id="authStateLoading">
                <div class="auth-spinner-wrap"><div class="auth-spinner-outer"></div><div class="auth-spinner-inner"></div><div class="auth-spinner-ball"></div></div>
                <span class="auth-spinner-text" id="authLoadingText">Loading...</span>
            </div>
            <div class="auth-state" id="authStatePending">
                <div class="auth-pending-icon"><div class="pending-ring"></div><div class="pending-ring pending-ring-2"></div><div class="pending-ring pending-ring-3"></div><svg class="pending-hourglass" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="4 2"/><polyline points="12 6 12 12 16 14" stroke-linecap="round"/></svg></div>
                <h2 class="auth-pending-title">Awaiting Approval</h2>
                <p class="auth-pending-text">Your request has been sent to the administrator.<br>You'll be granted access automatically once approved.</p>
                <div class="auth-pending-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
                <div class="auth-profile-section" id="authPendingProfile" style="display:none;"><img class="auth-profile-avatar" id="authPendingAvatar" src="" alt="Avatar"><div class="auth-profile-info"><div class="auth-profile-name" id="authPendingName">--</div><div class="auth-profile-email" id="authPendingEmail">--</div></div></div>
                <button class="auth-btn auth-btn-ghost auth-btn-full" onclick="signOutAuth()" style="margin-top:16px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign Out</button>
                <div class="auth-footer">Access will be granted automatically upon approval</div>
            </div>
            <div class="auth-state" id="authStateApproved">
                <div class="auth-approved-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                <h2 class="auth-approved-title">Access Granted!</h2>
                <p class="auth-approved-text">Redirecting you in a moment...</p>
                <div class="auth-progress-bar"><div class="auth-progress-fill"></div></div>
            </div>
            <div class="auth-state" id="authStateDenied">
                <div class="auth-denied-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
                <h2 class="auth-denied-title">Access Denied</h2>
                <p class="auth-denied-text">Your access request has been denied by the administrator.<br>Please contact the admin for more information.</p>
                <button class="auth-btn auth-btn-danger auth-btn-full" onclick="signOutAuth()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign Out</button>
            </div>
            <div class="auth-state" id="authStateNoAccess">
                <div class="auth-noaccess-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                <h2 class="auth-noaccess-title">No Access</h2>
                <p class="auth-noaccess-text">Your account doesn't have permission to access this page.<br>Request the required role from the administrator.</p>
                <div class="auth-noaccess-roles" id="authNoAccessRoles"></div>
                <div class="auth-profile-section"><img class="auth-profile-avatar" id="authNoAccessAvatar" src="" alt="Avatar"><div class="auth-profile-info"><div class="auth-profile-name" id="authNoAccessName">--</div><div class="auth-profile-email" id="authNoAccessEmail">--</div></div></div>
                <div class="auth-btn-group" style="margin-top:16px;">
                    <button class="auth-btn auth-btn-primary" onclick="requestPageAccess()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Request Access</button>
                    <button class="auth-btn auth-btn-danger" onclick="signOutAuth()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign Out</button>
                </div>
            </div>
            <div class="auth-state" id="authStateDelayed">
                <div class="auth-pending-icon"><div class="pending-ring"></div><div class="pending-ring pending-ring-2"></div><svg class="pending-hourglass" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
                <h2 class="auth-pending-title" style="color:#fbbf24;">Request Delayed</h2>
                <p class="auth-pending-text">The administrator has put your request on hold.<br>Please try again later.</p>
                <div class="auth-pending-dots"><div class="dot" style="--dot-color:#fbbf24;"></div><div class="dot" style="--dot-color:#fbbf24;"></div><div class="dot" style="--dot-color:#fbbf24;"></div></div>
                <button class="auth-btn auth-btn-ghost auth-btn-full" onclick="signOutAuth()" style="margin-top:16px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign Out</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    const gBtn = overlay.querySelector('.auth-google-btn');
    if (gBtn) {
        gBtn.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            ripple.className = 'btn-ripple';
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    }
}

// ==========================================
// SWITCH AUTH STATE
// ==========================================
function showAuthState(stateId) {
    document.querySelectorAll('#authOverlayNew .auth-state').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(stateId);
    if (target) target.classList.add('active');
}

function hideAuthOverlay() {
    const overlay = document.getElementById('authOverlayNew');
    if (overlay) {
        overlay.classList.add('hidden');
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 600);
    }
    try {
        document.dispatchEvent(new CustomEvent('auth-approved', {
            detail: { user: currentUser, userData: currentUserData }
        }));
    } catch (e) { console.warn('Auth event dispatch error:', e); }
}

function showAuthError(message) {
    const errEl = document.getElementById('authError');
    if (errEl) { errEl.textContent = message; errEl.classList.add('show'); setTimeout(() => errEl.classList.remove('show'), 8000); }
}

// ==========================================
// ESCAPE HTML
// ==========================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==========================================
// GOOGLE SIGN IN
// ==========================================
function signInWithGoogle() {
    if (!authAuth) { showAuthError('Firebase Auth not initialized'); return; }
    showAuthState('authStateLoading');
    const loadingText = document.getElementById('authLoadingText');
    if (loadingText) loadingText.textContent = 'Signing in with Google...';
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile'); provider.addScope('email');
    if (isSecureEnvironment()) {
        authAuth.signInWithPopup(provider).catch((error) => {
            if (error.code === 'auth/popup-closed-by-user') { showAuthState('authStateSignIn'); showAuthError('Sign-in popup was closed'); }
            else if (error.code === 'auth/unauthorized-domain') { showAuthState('authStateSignIn'); showAuthError('Domain not authorized. Add it in Firebase Console.'); }
            else if (error.code === 'auth/operation-not-supported-in-this-environment' || error.code === 'auth/popup-blocked') { signInWithRedirectFallback(provider); }
            else { signInWithRedirectFallback(provider); }
        });
    } else { signInWithRedirectFallback(provider); }
}

function signInWithRedirectFallback(provider) {
    if (!authAuth || !provider) return;
    isRedirectFlow = true;
    showAuthState('authStateLoading');
    const loadingText = document.getElementById('authLoadingText');
    if (loadingText) loadingText.textContent = 'Redirecting to Google...';
    authAuth.signInWithRedirect(provider).catch((error) => {
        showAuthState('authStateSignIn');
        showAuthError('Sign-in failed: ' + (error.message || 'Unknown error'));
    });
}

function handleRedirectResult() {
    if (!authAuth) return;
    authAuth.getRedirectResult().then((result) => {
        if (result && result.user) console.log('Redirect sign-in successful:', result.user.email);
    }).catch((error) => {
        showAuthState('authStateSignIn');
        showAuthError('Sign-in failed: ' + (error.message || ''));
    });
}

// ==========================================
// SIGN OUT
// ==========================================
async function signOutAuth() {
    console.log('🚪 Signing out...');
    if (accessListenerRef) { try { accessListenerRef.off(); } catch (e) { } accessListenerRef = null; }
    accessListenerAttached = false;
    stopAccessCheckInterval(); // ✅ V2.2
    currentUser = null; currentUserData = null; isRedirectFlow = false;
    try { localStorage.removeItem('stc_auth_user_cache'); localStorage.removeItem('stc_auth_session'); } catch (e) { }
    if (authAuth) { try { await authAuth.signOut(); } catch (e) { } }
    window.location.href = window.location.pathname;
}

// ==========================================
// REQUEST PAGE ACCESS
// ==========================================
async function requestPageAccess() {
    if (!currentUser || !authDb) return;
    const pageName = currentPageName;
    const pageNameDisplay = AUTH_CONFIG.PAGE_NAMES[pageName] || pageName;
    try {
        const updates = {};
        updates['access_requests/' + currentUser.uid] = {
            uid: currentUser.uid, name: currentUser.displayName || '',
            email: currentUser.email || '', photo: currentUser.photoURL || '',
            requestedPage: pageName, pageNameDisplay, requestedAt: firebase.database.ServerValue.TIMESTAMP, status: 'pending'
        };
        updates['users/' + currentUser.uid + '/status'] = 'pending';
        await authDb.ref().update(updates);
        trackBandwidth('write', updates);
        showAuthState('authStatePending');
        updatePendingProfile();
        listenForAccessChanges();
    } catch (error) { showAuthError('Failed to send access request'); }
}

function updatePendingProfile() {
    if (!currentUser) return;
    const section = document.getElementById('authPendingProfile');
    if (section) section.style.display = 'flex';
    const avatar = document.getElementById('authPendingAvatar');
    const name = document.getElementById('authPendingName');
    const email = document.getElementById('authPendingEmail');
    if (avatar) avatar.src = currentUser.photoURL || '';
    if (name) name.textContent = currentUser.displayName || '';
    if (email) email.textContent = currentUser.email || '';
}

// ==========================================
// ✅ V2.2: Check if user is currently INSIDE the app
// ==========================================
function isUserInsideApp() {
    const overlay = document.getElementById('authOverlayNew');
    if (!overlay) return true;
    if (overlay.classList.contains('hidden')) return true;
    return false;
}

// ==========================================
// ✅ V2.2: LISTEN FOR ACCESS CHANGES - LOOP FIXED
// ==========================================
function listenForAccessChanges() {
    if (!currentUser || !authDb || accessListenerAttached) return;
    accessListenerAttached = true;

    accessListenerRef = authDb.ref('users/' + currentUser.uid);
    accessListenerRef.on('value', (snap) => {
        const userData = snap.val();
        if (!userData) {
            if (isUserInsideApp()) forceAuthRevoke('User record removed from system');
            return;
        }

        trackBandwidth('read', userData);
        currentUserData = userData;
        console.log('📡 Access update:', userData.status, 'Roles:', userData.roles);

        const insideApp = isUserInsideApp();

        switch (userData.status) {
            case 'approved':
                if (insideApp) {
                    // ✅ Already inside — just enforce roles, DON'T re-trigger confetti
                    enforcePageAccess(userData);
                } else {
                    // On auth screen — normal approval flow
                    handleApproved(userData);
                }
                break;
            case 'denied':
                if (insideApp) {
                    forceAuthRevoke('Access has been denied by administrator');
                } else {
                    // Just show denied on auth screen — NO forceAuthRevoke (prevents loop)
                    showAuthState('authStateDenied');
                    const dt = document.querySelector('#authStateDenied .auth-denied-text');
                    if (dt) dt.innerHTML = `${escapeHtml('Access denied by administrator')}<br>Contact admin for more info.`;
                }
                break;
            case 'delayed':
                if (insideApp) forceAuthRevoke('Access has been delayed by administrator');
                else showAuthState('authStateDelayed');
                break;
            case 'pending':
                showAuthState('authStatePending');
                updatePendingProfile();
                break;
            default:
                if (insideApp) forceAuthRevoke('Access status unknown');
                break;
        }
    });

    // ✅ V2.2: Start periodic fallback check (in case real-time listener misses updates)
    startAccessCheckInterval();
}

// ==========================================
// ✅ V2.2: PERIODIC FALLBACK ACCESS CHECK
// Reads user data every 30s as backup for real-time listener
// ==========================================
function startAccessCheckInterval() {
    stopAccessCheckInterval();
    accessCheckInterval = setInterval(async () => {
        if (!currentUser || !authDb) return;
        try {
            const snap = await authDb.ref('users/' + currentUser.uid).once('value');
            const userData = snap.val();
            if (!userData) {
                if (isUserInsideApp()) forceAuthRevoke('User record removed');
                return;
            }
            currentUserData = userData;

            // Only enforce if user is inside app
            if (!isUserInsideApp()) return;

            if (userData.status === 'denied' || userData.status === 'delayed') {
                console.warn('⛔ Fallback check: Access revoked!', userData.status);
                forceAuthRevoke(`Access ${userData.status} by administrator`);
                return;
            }

            if (userData.status === 'approved') {
                enforcePageAccess(userData);
            }
        } catch (e) { /* silent */ }
    }, 30000); // Check every 30 seconds
}

function stopAccessCheckInterval() {
    if (accessCheckInterval) { clearInterval(accessCheckInterval); accessCheckInterval = null; }
}

// ==========================================
// ✅ Enforce page access based on current roles
// Shows No Access popup (with Request Access button) instead of Denied
// ==========================================
function enforcePageAccess(userData) {
    if (!currentPageName || !userData) return;
    const requiredRoles = AUTH_CONFIG.PAGE_ROLES[currentPageName] || [];
    if (requiredRoles.length === 0) return;
    const userRoles = userData.roles || [];
    const hasAccess = userRoles.some(r => requiredRoles.includes(r));
    if (!hasAccess) {
        console.warn('⚠️ Role revoked! Required:', requiredRoles, 'Has:', userRoles);
        // ✅ V2.2 FIX: Show No Access popup instead of Denied
        forceRoleRevoke(requiredRoles, userRoles);
    }
}

// ==========================================
// ✅ Force auth revocation — kicks user out
// ==========================================
function forceAuthRevoke(reason) {
    console.warn('🚫 Access revoked:', reason);

    // 1. Dispatch event for page-specific cleanup
    try {
        document.dispatchEvent(new CustomEvent('auth-revoked', {
            detail: { reason, user: currentUser, userData: currentUserData }
        }));
    } catch (e) { console.warn('Dispatch error:', e); }

    // 2. Show auth overlay with denied state
    let overlay = document.getElementById('authOverlayNew');
    if (!overlay && currentPageName) {
        injectAuthOverlay(currentPageName);
        overlay = document.getElementById('authOverlayNew');
    }
    if (overlay) {
        overlay.classList.remove('hidden');
        showAuthState('authStateDenied');
    }

    // 3. Update denied text with reason
    setTimeout(() => {
        const deniedText = document.querySelector('#authStateDenied .auth-denied-text');
        if (deniedText && reason) {
            deniedText.innerHTML = `${escapeHtml(reason)}<br>Please contact the administrator for more information.`;
        }
    }, 300);

    // 4. Stop monitoring
    accessListenerAttached = false;
    if (accessListenerRef) { accessListenerRef.off(); accessListenerRef = null; }
    stopAccessCheckInterval();
}

// ==========================================
// ✅ V2.2: Role-based revocation — shows No Access popup
// Different from forceAuthRevoke (which shows Denied)
// Keeps listener alive so admin can re-add role → auto-approve!
// ==========================================
function forceRoleRevoke(requiredRoles, userRoles) {
    console.warn('🚫 Role access revoked for page:', currentPageName);

    // 1. Dispatch auth-revoked event for page cleanup
    try {
        document.dispatchEvent(new CustomEvent('auth-revoked', {
            detail: {
                reason: `Your ${currentPageName} access has been removed`,
                user: currentUser,
                userData: currentUserData,
                isRoleRevoke: true  // ✅ Flag so pages know it's role-based, not denial
            }
        }));
    } catch (e) { console.warn('Dispatch error:', e); }

    // 2. Re-inject overlay if removed from DOM
    let overlay = document.getElementById('authOverlayNew');
    if (!overlay && currentPageName) {
        injectAuthOverlay(currentPageName);
        overlay = document.getElementById('authOverlayNew');
    }

    // 3. Show overlay with No Access state
    if (overlay) {
        overlay.classList.remove('hidden');
        showNoAccessState(currentUserData || { roles: userRoles || [] });
    }

    // 4. ✅ DO NOT detach listener!
    // Keep it alive so when admin re-adds the role,
    // listener fires → user is still "approved" → handleApproved → auto-approve!
    // No need for manual refresh!
}

// ==========================================
// HANDLE APPROVED
// ==========================================
function handleApproved(userData) {
    showAuthState('authStateApproved');
    launchConfetti();
    const requiredRoles = AUTH_CONFIG.PAGE_ROLES[currentPageName] || [];
    const userRoles = userData.roles || [];
    if (requiredRoles.length === 0) { setTimeout(() => hideAuthOverlay(), 1500); return; }
    if (userRoles.some(r => requiredRoles.includes(r))) {
        setTimeout(() => hideAuthOverlay(), 1500);
    } else {
        setTimeout(() => showNoAccessState(userData), 1500);
    }
}

function showNoAccessState(userData) {
    if (!userData) userData = { roles: [] };
    const requiredRoles = AUTH_CONFIG.PAGE_ROLES[currentPageName] || [];
    const userRoles = userData.roles || [];

    const rolesContainer = document.getElementById('authNoAccessRoles');
    if (rolesContainer) {
        let html = '<span style="font-size:0.75rem;color:#a1a1aa;font-weight:700;">Required:</span> ';
        requiredRoles.forEach(r => { html += `<span class="auth-role-tag">${r}</span> `; });
        html += '<br><span style="font-size:0.75rem;color:#a1a1aa;font-weight:700;margin-top:8px;display:inline-block;">Yours:</span> ';
        if (!userRoles.length) html += `<span class="auth-role-tag">None</span>`;
        else userRoles.forEach(r => { html += `<span class="auth-role-tag ${requiredRoles.includes(r) ? 'has' : ''}">${r}</span> `; });
        rolesContainer.innerHTML = html;
    }

    // ✅ Use currentUser if userData is incomplete
    const srcUser = currentUser || {};
    const avatar = document.getElementById('authNoAccessAvatar');
    const name = document.getElementById('authNoAccessName');
    const email = document.getElementById('authNoAccessEmail');
    if (avatar) avatar.src = srcUser.photoURL || userData.photo || '';
    if (name) name.textContent = srcUser.displayName || userData.name || '--';
    if (email) email.textContent = srcUser.email || userData.email || '--';

    showAuthState('authStateNoAccess');
}

// ==========================================
// CONFETTI
// ==========================================
function launchConfetti() {
    const colors = ['#F8B400', '#10b981', '#fde047', '#ef4444', '#8b5cf6', '#f472b6'];
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = 'auth-confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.top = '-10px';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 0.8 + 's';
        piece.style.animationDuration = (1.5 + Math.random()) + 's';
        piece.style.width = (6 + Math.random() * 8) + 'px';
        piece.style.height = (6 + Math.random() * 8) + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        document.body.appendChild(piece);
        setTimeout(() => { if (piece.parentNode) piece.parentNode.removeChild(piece); }, 3000);
    }
}

// ==========================================
// OWNER CHECK
// ==========================================
function isOwnerEmail(email) {
    return email && email.toLowerCase() === AUTH_CONFIG.OWNER_EMAIL.toLowerCase();
}

// ==========================================
// HANDLE USER STATE CHANGE
// ==========================================
async function handleUserStateChange(user) {
    if (!user) { currentUser = null; currentUserData = null; showAuthState('authStateSignIn'); return; }

    currentUser = user;
    console.log('User logged in:', user.email);

    showAuthState('authStateLoading');
    const loadingText = document.getElementById('authLoadingText');
    if (loadingText) loadingText.textContent = 'Verifying access...';

    try {
        // Owner auto-approve
        if (isOwnerEmail(user.email)) {
            console.log('Owner detected! Auto-approving...');
            const updates = {
                name: user.displayName || '', email: user.email || '', photo: user.photoURL || '',
                status: 'approved', roles: ['owner', 'admin', 'scorer', 'team'],
                lastLogin: firebase.database.ServerValue.TIMESTAMP, updatedAt: firebase.database.ServerValue.TIMESTAMP
            };
            await authDb.ref('users/' + user.uid).update(updates);
            trackBandwidth('write', updates);
            const existingSnap = await authDb.ref('users/' + user.uid + '/createdAt').once('value');
            if (!existingSnap.val()) {
                await authDb.ref('users/' + user.uid).update({
                    createdAt: firebase.database.ServerValue.TIMESTAMP, approvedBy: 'auto', approvedAt: firebase.database.ServerValue.TIMESTAMP
                });
            }
            await authDb.ref('access_requests/' + user.uid).remove();
            currentUserData = { status: 'approved', roles: ['owner', 'admin', 'scorer', 'team'] };
            handleApproved(currentUserData);
            listenForAccessChanges(); // ✅ V2.2: Owner also monitored!
            return;
        }

        // Check existing user
        const userSnap = await authDb.ref('users/' + user.uid).once('value');
        const userData = userSnap.val();
        trackBandwidth('read', userData);

        if (userData && userData.status === 'approved') {
            currentUserData = userData;
            await authDb.ref('users/' + user.uid).update({
                lastLogin: firebase.database.ServerValue.TIMESTAMP,
                name: user.displayName || userData.name, photo: user.photoURL || userData.photo
            });
            handleApproved(userData);
            listenForAccessChanges();
            return;
        }

        if (userData && userData.status === 'denied') {
            currentUserData = userData;
            showAuthState('authStateDenied');
            listenForAccessChanges();
            return;
        }

        if (userData && userData.status === 'delayed') {
            currentUserData = userData;
            showAuthState('authStateDelayed');
            listenForAccessChanges();
            return;
        }

        // New user — create request
        const pageName = currentPageName;
        const pageNameDisplay = AUTH_CONFIG.PAGE_NAMES[pageName] || pageName;
        const updates = {};
        updates['users/' + user.uid] = {
            name: user.displayName || '', email: user.email || '', photo: user.photoURL || '',
            status: 'pending', roles: [], createdAt: firebase.database.ServerValue.TIMESTAMP, lastLogin: firebase.database.ServerValue.TIMESTAMP
        };
        updates['access_requests/' + user.uid] = {
            uid: user.uid, name: user.displayName || '', email: user.email || '',
            photo: user.photoURL || '', requestedPage: pageName, pageNameDisplay,
            requestedAt: firebase.database.ServerValue.TIMESTAMP, status: 'pending'
        };
        await authDb.ref().update(updates);
        trackBandwidth('write', updates);
        showAuthState('authStatePending');
        updatePendingProfile();
        listenForAccessChanges();
        console.log('Access request created for', user.email);
    } catch (error) {
        console.error('Auth check error:', error);
        showAuthState('authStateSignIn');
        showAuthError('Verification failed: ' + (error.message || ''));
    }
}

// ==========================================
// INIT PAGE AUTH
// ==========================================
function initPageAuth(pageName) {
    currentPageName = pageName;
    initAuthFirebase();
    if (!authAuth || !authDb) { console.error('Firebase not initialized for auth'); return; }
    injectAuthOverlay(pageName);
    handleRedirectResult();
    authAuth.onAuthStateChanged((user) => { handleUserStateChange(user); });
}

// ==========================================
// UTILITY EXPORTS
// ==========================================
function getCurrentUser() { return currentUser; }
function getCurrentUserData() { return currentUserData; }
function isOwner() { return currentUserData?.roles?.includes('owner'); }
function hasRole(role) { return currentUserData?.roles?.includes(role); }

// ==========================================
// GLOBAL EXPORTS
// ==========================================
Object.assign(window, {
    signInWithGoogle, signOutAuth, initPageAuth,
    getCurrentUser, getCurrentUserData, isOwner, hasRole,
    requestPageAccess, getBandwidthUsage, AUTH_CONFIG,
    escapeHtml, forceAuthRevoke, enforcePageAccess, isUserInsideApp
});

console.log('Auth Module V2.2 Loaded (Real-time Revocation + Loop Fix + Fallback Check)');