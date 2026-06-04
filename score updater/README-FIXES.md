# 🔧 Bug Fix Changelog
## Thomians Media CMS + Score Updater System
**Version:** Post-Fix Release  
**Date:** 2026-06-03  
**Fixed Bugs:** 9 (2 Critical · 2 High · 3 Medium · 2 Low)

---

## 🔴 Critical Fixes

### BUG-01 — `overRunsHistory` Wipe on Chase Start
**File:** `system/score updater/scorer.js`  
**Function:** `loadMatchState()`

**Problem:**  
When the 2nd innings began (target set by admin), the Scorer detected `previousTarget === 0 && newTarget > 0` and wiped `matchState.overRunsHistory = []`. This erased all 1st innings over data, causing:
- Momentum chart to go blank
- Worm chart 1st innings line to disappear
- Manhattan chart 1st innings bars to vanish

**Fix:**  
Removed the two destructive lines:
```js
// REMOVED:
matchState.overRunsHistory = [];
lastRecordedOverCount = 0;
```
The admin handles innings resets via `initSuperOver()` or manual reset. The scorer must preserve all historical data.

---

### BUG-02 — `innings_1` Nullified When 2nd Innings Starts
**File:** `system/admin/admin.js`  
**Function:** `buildSupabasePayload()`

**Problem:**  
`buildSupabasePayload()` built only the *current* innings key (`innings_1` OR `innings_2`). When Supabase received a `PATCH` with only `innings_2` in the payload, it set `innings_1` to `null`. This caused:
- All 1st innings chart data (Worm, Manhattan, Partnership, Scorecard) to permanently disappear once 2nd innings started

**Fix:**  
- Added `matchState.innings1Snapshot` / `innings2Snapshot` — saved when an innings ends
- `buildSupabasePayload()` now sends BOTH innings in every write
- `saveInningsSnapshot()` called from:
  - `presetInningsOverCard()` — when innings over card shown
  - `setBattingSide()` — when batting side changes
  - `initSuperOver()` — before super over reset

---

## 🟠 High Priority Fixes

### BUG-03 — Super Over Has No CMS Context
**Files:**  
- `system/admin/admin.js` → `buildSupabasePayload()`, `initSuperOver()`  
- `thomians-media-cms/src/lib/types.ts` → `LiveState` interface  
- `thomians-media-cms/src/components/tabs/LiveTab.tsx`

**Problem:**  
When admin triggered Super Over:
- CMS page showed `0/0 (0.0)` with no explanation
- "MATCH TIED" banner stayed (stale)
- No Super Over label anywhere on the public site

**Fix:**  
- Added `isSuperOver`, `superOverRound`, `tiedScore`, `tiedOvers` fields to `LiveState` in `types.ts`
- Admin sets these in `matchState` and includes them in every Supabase write via `liveState`
- `LiveTab.tsx` shows a gold ⚡ Super Over banner when `liveState.isSuperOver === true`
- Banner shows the tied score context (e.g., "Match was tied at 145/8 (20.0 ov)")

---

### BUG-04 — Partnership Chart Always Empty
**File:** `system/admin/admin.js`

**Problem:**  
`buildSupabasePayload()` had `partnerships: []` hardcoded. The scorer tracked only *current* partnership (`partRuns`/`partBalls`) but never historical ones. Partnership chart always showed "no data".

**Fix:**  
- Added `matchState.partnershipHistory[]` to admin state
- Before each wicket's `resetPartnership()` call, pushes current partnership data:
  `{ bat1, bat2, runs, balls, bat1Runs, bat2Runs, teamScoreAtEnd }`
- Added `buildPartnerships()` helper function
- `buildSupabasePayload()` now uses `buildPartnerships(matchState.partnershipHistory)`

---

## 🟡 Medium Priority Fixes

### BUG-05 — `overRunsHistory` Dedup Race Condition
**File:** `system/score updater/scorer.js`  
**Function:** `trackOverRunsHistory()`

**Problem:**  
Dedup used `matchState.overRunsHistory.length` vs `lastRecordedOverCount`. When admin sync changed the array length, `lastRecordedOverCount` fell out of sync, causing valid overs to be skipped.

**Fix:**  
Changed dedup to use `Math.floor(matchState.balls / 6)` — the actual completed over count — as the source of truth. `lastRecordedOverCount` now tracks by over number, not array index.

---

### BUG-06 — Bowler Figs Parsing Edge Case
**File:** `system/admin/admin.js`  
**Function:** `buildBowlingCard()`

**Problem:**  
`bowler.figs.split(' ')[1]` returned `undefined` if `figs` string had no space (edge case at over start). Caused bowler overs to show wrong value on CMS scorecard.

**Fix:**  
Always use `parseBowlerFigures()` which handles all edge cases safely, then derive overs from `balls` count.

---

### BUG-07 — Fall of Wickets Shows Wrong Score
**File:** `system/admin/admin.js`  
**Functions:** `buildFallOfWickets()`, `selectWicketType()`

**Problem:**  
`buildFallOfWickets()` used `p.runs` (individual batsman runs) as the team score at dismissal. Should be the *team's total runs* at the moment of dismissal.

**Fix:**  
- Added `matchState._currentTeamScore` tracking — updated after every `processBallScore()` call
- On each wicket, saves `teamScore: matchState._currentTeamScore` into the dismissal record
- `buildFallOfWickets()` now uses `p.teamScore || p.runs` (with safe fallback)

---

## 🟢 Low Priority Fixes

### BUG-08 — Stale Chart Data After Super Over Reset
**File:** `thomians-media-cms/src/hooks/useMatchLiveData.ts`  
**Function:** `fetchData()`

**Problem:**  
When Super Over started, admin sent empty `overByOver[]`. The CMS merge logic kept the previous (longer) innings data, causing old charts to persist incorrectly.

**Fix:**  
When `parsedLiveState.isSuperOver === true`, force-reset `prevInnings1Ref` and `prevInnings2Ref` to their empty defaults before processing incoming innings data. This ensures clean state for Super Over charts.

---

### BUG-09 — Fake Estimated Partnership Chart
**File:** `thomians-media-cms/src/components/cards/PartnershipProgressCard.tsx`

**Problem:**  
The Partnership Progress card fabricated per-over data by dividing current partnership runs evenly across overs (`bat1Rate * ballsThisOver`). This was a rough estimate, not real ball-by-ball data.

**Fix:**  
After BUG-04 fix provides real `partnerships[]` data:
- Card now accepts `activeInningsData?: InningsData` prop
- When real partnership history is available, shows actual `bat1Runs` / `bat2Runs` per partnership
- Falls back to estimated view when no historical data exists (first partnership of match)
- `AnalyticsTab.tsx` passes `activeInningsData` to the card

---

## 📁 Files Changed

| File | Bugs Fixed | Change Type |
|------|-----------|-------------|
| `system/score updater/scorer.js` | BUG-01, BUG-05 | Logic fix (remove 2 lines + dedup update) |
| `system/admin/admin.js` | BUG-02, BUG-03, BUG-04, BUG-06, BUG-07 | Additive (new functions + payload update) |
| `thomians-media-cms/src/lib/types.ts` | BUG-03 | Additive (optional fields to interface) |
| `thomians-media-cms/src/hooks/useMatchLiveData.ts` | BUG-08 | Conditional reset guard |
| `thomians-media-cms/src/components/tabs/LiveTab.tsx` | BUG-03 | Additive (new banner component) |
| `thomians-media-cms/src/components/cards/PartnershipProgressCard.tsx` | BUG-09 | Prop + real data display |

---

## ✅ Free-Tier Impact Assessment

| Fix | Supabase Writes | Firebase Writes | KV Writes | D1 Writes | Workers CPU |
|-----|----------------|-----------------|-----------|-----------|-------------|
| BUG-01 | None | None | None | None | None |
| BUG-02 | +~400 bytes/write (2nd innings added to payload) | None | None | None | Negligible |
| BUG-03 | +~50 bytes/write (3 small fields) | None | None | None | None |
| BUG-04 | +~200 bytes/write (partnerships array) | None | None | None | None |
| BUG-05 | None | None | None | None | None |
| BUG-06 | None | None | None | None | None |
| BUG-07 | +~10 bytes/write (teamScore per FoW entry) | None | None | None | None |
| BUG-08 | None | None | None | None | None |
| BUG-09 | None | None | None | None | None |

**Total additional Supabase write size:** ~660 bytes per write  
**Daily Supabase writes:** ~480 (vote queue) — match data writes are much less frequent  
**Impact on free tier:** Negligible — still well within Supabase free limits

---

## ⚠️ Systems NOT Modified (Free-Tier Critical)

- `/api/live/route.ts` — CDN caching headers unchanged (s-maxage=15)
- KV write patterns — vote queue 2min backup unchanged
- D1 voting system — completely untouched
- Polling interval — 10s + jitter unchanged
- Edge caching middleware — s-maxage headers untouched
- Worker bundle size — no new dependencies added
- Supabase `match_live` table schema — no new columns (uses existing JSONB columns)

---

## 🧪 Testing Checklist

After applying fixes, verify:

- [ ] **BUG-01:** Score 1st innings → set target → Momentum/Worm charts still show 1st innings data
- [ ] **BUG-02:** Score 1st innings → switch batting side → reload CMS → both innings show on charts
- [ ] **BUG-03:** Trigger Super Over → CMS shows gold ⚡ banner with tied score
- [ ] **BUG-03:** Super Over score resets to 0/0 with clear "SUPER OVER" label
- [ ] **BUG-04:** Score 3+ wickets → Partnership chart shows historical partnerships
- [ ] **BUG-05:** Score 20 overs → all 20 overs appear in Manhattan chart (no skips)
- [ ] **BUG-06:** Bowler with 2+ overs in scorecard shows correct overs notation
- [ ] **BUG-07:** Fall of Wickets shows team score at time of dismissal (not batsman score)
- [ ] **BUG-08:** Trigger Super Over → charts reset cleanly, no stale 1st innings bleeding
- [ ] **BUG-09:** Partnership Progress card shows real data when partnerships > 0
- [ ] **Free tier:** KV writes still ≤ 720/day, D1 writes ≤ 5280/day, Workers ≤ 83K/day
