# AirCoin Arcade

Mobile-first Telegram Mini App starter: 10 lightweight Canvas/casual games, a dark arcade UI, TON Connect entry point, AirCoin wallet screen, reward/shop screens, and an Express + Supabase API foundation.

## Important status

This repository is a **Stage 1 playable foundation plus a Stage 2 backend scaffold**, not a live money service yet. The arcade UI and games run locally. Real ad rewards intentionally remain disabled until the current Adsgram verification flow is implemented and tested. Score submissions are client-reported and must not be used for prize payouts until anti-cheat validation is added. Withdrawal requests are database-backed when the backend is configured; actual TON transfers remain manual and must be sent and verified by the admin.

## Stack

- Vite + vanilla JavaScript + Canvas API
- Express API with Telegram `initData` HMAC validation
- Supabase Postgres schema and transactional RPCs
- TON Connect UI (`@tonconnect/ui`)
- GitHub → Vercel frontend, Render API, Supabase database

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill backend secrets only in your local environment.
3. Run `npm install`.
4. Run `npm run dev` for the frontend.
5. In another terminal run `npm run server` for the API.
6. The frontend works in demo mode at the Vite URL. API actions requiring Telegram auth and Supabase will stay disabled until configured.

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the backend environment only.
4. Never expose the service-role key in frontend variables.

## Telegram Mini App

1. Create a bot with BotFather and configure its Mini App URL to your deployed HTTPS frontend.
2. Set `BOT_TOKEN` on the backend.
3. Requests must pass the raw Telegram WebApp `initData` in `x-telegram-init-data`; do not trust `initDataUnsafe` as authentication.
4. Set `ADMIN_TELEGRAM_ID` to your own Telegram numeric ID.
5. Test auth inside Telegram, not only in a normal browser.

## TON Connect

- Update `public/tonconnect-manifest.json` with your real HTTPS deployment domain and a publicly reachable PNG/ICO icon URL (TON Connect docs require a public HTTPS manifest and supported icon format).
- The wallet connect button appears on the Wallet page. It only connects a wallet; it does not send payments by itself.
- Never request or store seed phrases/private keys.
- For in-game purchases, create an order server-side, have the wallet approve a TON transaction, and verify the resulting transaction on-chain before delivering items.
- For withdrawals, admin should approve and send the transaction manually, then record the transaction hash and mark it paid. Do not treat an approval as a payment.

## Adsgram

- Add your current Adsgram placement ID to backend configuration.
- Implement and test the provider's current rewarded-ad completion and server-side verification/callback method before crediting AirCoins.
- Never credit a reward solely because a frontend JavaScript callback fired.
- Enforce 100 rewards per UTC day with a database transaction and a unique provider claim ID. Current `/api/rewards/claim` intentionally returns `501` until provider verification is implemented.

## Economy

- 1 AirCoin = 0.0001 Gram at the project's configured accounting rate.
- Minimum withdrawal = 100 AirCoins (0.01 Gram at that rate).
- Daily rewarded-ad cap = 100.
- These are game rules, not a guarantee of token value or available funds.

## Deploy

### Frontend (Vercel)
1. Push this project to a GitHub repository.
2. Import the repository in Vercel.
3. Build command: `npm run build`; output directory: `dist`.
4. Set `VITE_API_BASE_URL` to your Render API URL once API integration is completed.
5. Add your real domain to `public/tonconnect-manifest.json`.

### Backend (Render)
1. Create a new Web Service from the same repository.
2. Build command: `npm install`; start command: `npm run server`.
3. Add the backend variables from `.env.example` in Render's environment settings.
4. Check `/health` after deployment. Free instances may sleep and cold-start.

### GitHub auto-deploy
Commit and push changes. Vercel and Render can redeploy automatically when connected to the repository.

## Next engineering stages

- Stage 2: wire the frontend to `/api/me`, scores, and leaderboards; add robust score validation and Telegram auth in every API call.
- Stage 3: implement Adsgram's current server-verification path and an atomic UTC daily cap.
- Stage 4: implement TON purchase order creation and on-chain transaction verification, plus admin payout history.
- Stage 5: tests, rate limiting, monitoring, privacy policy, terms, abuse prevention, and deployment hardening.
