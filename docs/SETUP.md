# Resale Hub setup (100% free: Firebase Spark + Vercel Hobby + eBay)

Everything in the repo is ready. These are the steps that need **your** accounts.
Nothing here needs a credit card, and **the Firebase project must stay on the Spark
plan: never upgrade to Blaze or link a billing account.**

What runs where:

| Piece | Where | Cost |
|---|---|---|
| API (`backend/`, Express): eBay OAuth callback, token exchange/refresh, listing create/update/end, photo upload, search, account deletion | **Vercel** serverless function (Hobby plan). Alternative: Cloudflare Workers free plan (experimental) or any Node host | Free |
| Data: users, listings (+ small photo previews), eBay settings, OAuth tokens, rate-limit counters | **Cloud Firestore** on Spark (`firestore.rules`), project `resale-hub-6a648` | Free (1 GiB, 50K reads / 20K writes / 20K deletes per day) |
| Listing photos | **eBay Picture Services** via the Media API, under each seller's own eBay account | Free |
| Sign-in | Firebase Authentication, email/password | Free |
| Privacy, support, account-deletion pages | **Firebase Hosting** on Spark (`web/`) | Free |

Why not Cloud Functions / Storage? On Spark, Cloud Functions can't be deployed (they
need Blaze) and new Cloud Storage buckets need Blaze too. Firestore and Hosting are
fine on Spark, and the Firebase Admin SDK reaches Firestore from Vercel over HTTPS.

The API host used below is **`https://resale-hub-api.vercel.app`** (Vercel project
name `resale-hub-api`). If Vercel gives your project a different domain, use that
everywhere this guide says `API_HOST`.

## 0. Tools

```bash
npm install -g firebase-tools vercel eas-cli   # Node 22+
firebase login      # already signed in on the dev box
vercel login        # your Vercel account (the one that hosts wing-protocol)
eas login
```

## 1. Firebase project `resale-hub-6a648` (Spark)

1. `cp .firebaserc.example .firebaserc` (git-ignored; points at `resale-hub-6a648`).
2. Console → **Authentication** → Get started → **Sign-in method** → enable **Email/Password**.
   Templates → Password reset: sender name "Resale Hub". Keep email enumeration protection on.
3. Console → **Firestore Database** → Create database → **Standard edition**, **production mode**,
   location `nam5 (us-central)` (can't change later). This is free on Spark.
4. Skip **Storage** (it would ask for Blaze). The app doesn't use it.
5. Note the **Web API Key**: ⚙ Project settings → General. (Optional hardening: Google Cloud
   console → APIs & Services → Credentials → that key → API restrictions → only
   *Identity Toolkit API* and *Token Service API*.)
6. **Service account key for the API**: ⚙ Project settings → **Service accounts** →
   **Generate new private key**. Keep the downloaded JSON private; it goes into Vercel as
   `FIREBASE_SERVICE_ACCOUNT` in step 3 and nowhere else (never commit it).
7. Deploy rules, the Email/Password provider and pages (no functions/storage in `firebase.json`):
   ```bash
   firebase deploy --only firestore,auth,hosting --project resale-hub-6a648
   ```
   `firestore.rules`: owner-only reads; listings are owner-writable with validated fields
   (never ownership or publish state); user/eBay-token/bookkeeping docs are server-only.
   Tests: `backend/test/rules.test.js`.

Web app config (public, already in `mobile/src/api/config.js`): apiKey
`AIzaSyDegPUHseJPcMbeaxOfIQuTUDnosjsGkvY`, appId `1:613695085581:web:82a994dd5d2ca61af40944`,
authDomain `resale-hub-6a648.firebaseapp.com`, messagingSenderId `613695085581`.
   Pages: `https://resale-hub-6a648.web.app/privacy`, `/support`, `/delete-account`.

## 2. eBay developer setup

1. https://developer.ebay.com → **Application Keys** → **Production** keyset (Sandbox for testing).
   Copy **App ID (Client ID)** → `EBAY_CLIENT_ID`, **Cert ID (Client Secret)** → `EBAY_CLIENT_SECRET`.
2. **OAuth redirect (RuName)**: Application Keys → **User Tokens** → *Get a Token from eBay via
   Your Application* → **Add eBay Redirect URL** (or edit the existing one):
   - Auth accepted URL: `https://API_HOST/api/ebay/oauth/callback`
   - Auth declined URL: `https://API_HOST/api/ebay/oauth/callback`
   - Privacy policy URL: `https://resale-hub-6a648.web.app/privacy`
   - Display title `Resale Hub`, **OAuth enabled**.
   Copy the **RuName** string (like `Your_Name-YourApp-PRD-abc123-defgh`) → `EBAY_RUNAME`.
   The RuName, not the URL, is what the API sends as `redirect_uri`.
3. **Marketplace account deletion** (required for the production keyset): Application Keys →
   *Alerts & Notifications* → **Marketplace account deletion**:
   - Endpoint: `https://API_HOST/api/ebay/account-deletion` → also `EBAY_DELETION_ENDPOINT`
   - Verification token: 32–80 chars (letters, digits, `_`, `-`) → `EBAY_VERIFICATION_TOKEN`
   Click **Save** only *after* step 3 is deployed (eBay calls the endpoint to verify it), then
   **Send Test Notification**.
4. Scopes used: `api_scope`, `sell.inventory` (listings **and** photo uploads via the Media
   API), `sell.account.readonly`, `commerce.identity.readonly`. No extra eBay approval needed.
5. Etsy (optional, search only): https://www.etsy.com/developers/your-apps → keystring and shared secret.

## 3. Deploy the API to Vercel (free Hobby plan)

```bash
cd backend
vercel link --project resale-hub-api      # creates the project on first run; Root Directory = backend
vercel env add FIREBASE_PROJECT_ID production        # resale-hub-6a648
vercel env add FIREBASE_SERVICE_ACCOUNT production   # paste the whole service-account JSON (step 1.6)
vercel env add EBAY_ENV production                   # production (or sandbox)
vercel env add EBAY_CLIENT_ID production
vercel env add EBAY_CLIENT_SECRET production
vercel env add EBAY_RUNAME production
vercel env add EBAY_VERIFICATION_TOKEN production
vercel env add EBAY_DELETION_ENDPOINT production     # https://API_HOST/api/ebay/account-deletion
vercel env add ETSY_API_KEY production               # or: disabled
vercel env add ETSY_SHARED_SECRET production         # or: disabled
vercel deploy --prod
curl https://API_HOST/api/health          # -> {"ok":true}
curl https://API_HOST/api/marketplaces    # eBay should show configured: true
```

Or in the dashboard: **Add New → Project** → import `workinmanstrokes/resale-hub` → **Root
Directory `backend`** → Framework *Other* → add the same variables under **Environment
Variables** → Deploy. Node.js version: 22.x or 24.x (Settings → Build and Deployment).

`backend/vercel.json` routes `/api/*` to `backend/api/index.js`, which runs the Express app.
All eBay secrets live only in Vercel env vars; the app never sees them.

Then finish eBay step 2.3 (Save + test notification).

### Alternative: Cloudflare Workers (free plan, experimental)

`backend/worker/index.js` + `backend/wrangler.toml` run the same app on Workers with
`nodejs_compat`. It hasn't been run on Cloudflare yet; prefer Vercel.

```bash
cd backend
npx wrangler login
for n in FIREBASE_PROJECT_ID FIREBASE_SERVICE_ACCOUNT EBAY_CLIENT_ID EBAY_CLIENT_SECRET EBAY_RUNAME EBAY_VERIFICATION_TOKEN EBAY_DELETION_ENDPOINT; do npx wrangler secret put $n; done
npx wrangler deploy      # -> https://resale-hub-api.<your-subdomain>.workers.dev
```

Use that workers.dev host as `API_HOST` in the eBay RuName / deletion endpoint and the app.
Any other Node host also works: `cd backend && npm start` (reads `backend/.env`).

## 4. Free-tier limits to know

- Firestore Spark: 50K reads, 20K writes, 20K deletes per day; 1 GiB stored. Each publish,
  upload, search and sign-in uses a few. If a daily quota runs out, Firestore stops until
  midnight Pacific; nothing is ever charged. Cheap routes are rate limited in memory to save
  writes; upload/publish/search/sensitive routes use Firestore counters (one doc per user per
  limit, overwritten each window, so they never pile up).
- Firestore TTL policies need billing, so none are used: expired OAuth states are removed
  by the API itself.
- Vercel Hobby: request bodies up to 4.5 MB, so the app shrinks photos to 1600 px JPEG on
  the phone first (the API rejects anything over 4 MB). Hobby is for non-commercial use;
  check Vercel's terms if the app starts making money.
- eBay Picture Services keeps photos used in a live listing; photos uploaded but never
  listed expire on eBay's side (the API returns the expiry date). There is nothing for us
  to delete. Each listing also stores a ~240 px preview in Firestore for My Listings.

## 5. Photos and account deletion

- Adding a photo needs a connected eBay account (Account tab → Connect eBay). The API
  forwards it to eBay's Media API (`createImageFromFile`) with that seller's token and stores
  only the returned `https://i.ebayimg.com/...` URL on the listing. Pasted https photo links
  still work without eBay.
- **Delete account** (in-app, or the `/delete-account` page) removes the user's listings and
  previews, eBay tokens/settings, pending OAuth states, rate-limit counters, and the Firebase
  Auth record. Live eBay listings stay on eBay.
- eBay Marketplace Account Deletion notifications (`POST /api/ebay/account-deletion`) remove
  the stored eBay tokens, policies and identity for that eBay user.

## 6. App environment variables

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://API_HOST/api` |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Web API key from step 1.5 |
| `EXPO_PUBLIC_WEB_URL` | `https://resale-hub-6a648.web.app` (the default) |

- Local dev: `cp mobile/.env.example mobile/.env.local`, fill it in, `cd mobile && npx expo start`.
- EAS builds:
  ```bash
  cd mobile
  eas init
  for ENV in development preview production; do
    eas env:create --environment $ENV --name EXPO_PUBLIC_API_URL --value https://API_HOST/api --visibility plaintext
    eas env:create --environment $ENV --name EXPO_PUBLIC_FIREBASE_API_KEY --value YOUR_WEB_API_KEY --visibility plaintext
    eas env:create --environment $ENV --name EXPO_PUBLIC_WEB_URL --value https://resale-hub-6a648.web.app --visibility plaintext
  done
  ```

## 7. Build and submit

```bash
cd mobile
eas build -p android --profile preview      # installable test APK
eas build -p android --profile production   # .aab for Google Play
eas submit -p android --profile production
```

IDs: bundle identifier / package `com.diddlerrr.resalehub`. Store listing: privacy policy
`https://resale-hub-6a648.web.app/privacy`, support `/support`, Play account-deletion URL
`/delete-account`, audience 18+. Data collected (Play Data safety / App Store labels): email
(account), photos (user content, sent to eBay), listing content, eBay tokens (linked to the
user, not used for tracking); no ads, no third-party analytics.

## Local development and tests

```bash
cd backend && npm ci
npm test                    # Firestore + Auth emulators + a fake eBay server (needs Java 21+)
npm run test:unit           # no emulators
firebase emulators:start --only auth,firestore     # in one terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=demo-resale-hub npm start    # API at http://localhost:8787/api
```

Point the app at it with `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8787/api` and
`EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=<LAN-IP>:9099`.
