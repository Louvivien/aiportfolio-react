# URNU.DE Pricing Issue - Summary & Solution

## Problem
Your portfolio shows **URNU.DE at €26.50 with 0% intraday change**, but Trade Republic shows **€27.34 (+3.35%)**.

## Root Cause
1. **Yahoo Finance** has the correct live price (€27.35) but is currently **rate-limited** (HTTP 429)
2. **Boursorama** has **stale data** (€26.50 from yesterday's close)
3. The backend falls back to cached Boursorama data when Yahoo is blocked

## What I Fixed

### 1. Added Cache Clearing Function
- Location: `/backend/src/priceService.js` line ~16
- Function: `clearAllCaches()` - clears all cached prices and removes Yahoo rate limit block

### 2. Added Direct Yahoo Chart API Fetcher
- Location: `/backend/src/priceService.js` line ~412
- Function: `fetchYahooChartApi()` - bypasses the yahoo-finance2 library which gets rate-limited
- This API is more reliable and less prone to rate limiting

## Current Status
✅ **URNU.DE is the CORRECT ticker** - XETRA exchange, highest volume
✅ Code fixes are in place
⚠️  **Yahoo Finance is temporarily rate-limited** due to testing
⚠️  Will auto-recover in 15-60 minutes

## What To Do Next

### Option 1: Wait for Rate Limit to Expire (Recommended)
```bash
# In 15-60 minutes, restart your backend:
cd /Users/vivienrichaud/Documents/aiportfolio-react/backend
npm run dev
# or if already running:
# Just wait - the next price fetch will work automatically
```

### Option 2: Force Refresh Now (if backend is running)
If your backend server is running, the next scheduled price refresh will automatically:
1. Try the new Yahoo Chart API first
2. Get live prices once the rate limit expires
3. Show correct intraday changes

### Option 3: Manual Test (after waiting)
```bash
cd /Users/vivienrichaud/Documents/aiportfolio-react/backend
node refresh-urnu.js
```

## Expected Result
Once Yahoo rate limit clears, you should see:
- Current Price: **€27.35** (or current market price)
- Previous Close: **€26.50**
- Intraday Change: **€0.85**
- Intraday Change %: **+3.21%**

## Verification
Check that it's working:
1. Open your portfolio app
2. Look at URNU.DE row
3. The "Intraday" and "Intraday %" columns should show **non-zero** values
4. Compare with Trade Republic - should match within €0.10

## Why This Happened
- Boursorama tracks German stocks but updates less frequently than Yahoo
- The yahoo-finance2 library is aggressive and gets rate-limited easily
- Multiple data source fallbacks caused stale data to persist in cache

## Prevention
The new code now:
- ✅ Tries Yahoo Chart API first (more reliable)
- ✅ Falls back to yahoo-finance2 library if needed
- ✅ Only uses Boursorama as last resort
- ✅ Provides `clearAllCaches()` for manual refresh

---
**Note**: Keep using **URNU.DE** - it's correct! The issue was the data source, not the ticker symbol.
