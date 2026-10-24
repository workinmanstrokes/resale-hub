# Resale Hub on Firebase: setup checklist

Everything in the repo is ready; these are the steps that need **your** accounts
(Firebase/Google Cloud, eBay developer, Etsy developer, Expo/EAS). Replace
`PROJECT_ID` below with your Firebase project ID.

What runs where:

| Piece | Firebase product |
|---|---|
| API (`functions/`, Express) | Cloud Functions 2nd gen, Node 22, function `api` (us-central1, max 10 instances) |
| Data (users, listings, eBay settings, rate-limit counters) | Cloud Firestore (`firestore.rules`) |
| Listing photos (`users/<uid>/photos/…`, public download-token URLs eBay can fetch) | Cloud Storage for Firebase (`storage.rules`) |
| Sign-in | Firebase Authentication, email/password |
| Privacy, support, account-deletion pages + `/api/**` rewrite | Firebase Hosting (`web/`) |

## 0. Tools

```bash
npm install -g firebase-tools eas-cli   # Node 22 recommended
firebase login
eas login
```

## 1. Create the Firebase project (or reuse one)

1. https://console.firebase.google.com → **Add project** (or pick an existing one). Google Analytics is not needed.
2. In the repo root: `firebase use --add` → choose the project, alias `default` (writes `.firebaserc`, which is git-ignored; see `.firebaserc.example`).

## 2. Blaze plan + budget alert (required)

Cloud Functions, Secret Manager and outbound calls to eBay/Etsy need the pay-as-you-go **Blaze** plan. Typical small-app usage stays inside the free tier.

1. Firebase console → ⚙ → **Usage and billing** → **Details & settings** → **Modify plan** → **Blaze**, link a billing account.
2. Budget alert: https://console.cloud.google.com/billing → your billing account → **Budgets & alerts** → **Create budget**. Scope it to this project, amount e.g. **$10/month**, alert thresholds 50% / 90% / 100%, email alerts to billing admins.
   Budgets only *alert*; they don't stop spending. The function is capped at 10 instances and every API route is rate limited per user, which keeps costs bounded.

## 3. Turn on Auth, Firestore and Storage

1. **Authentication** → Get started → **Sign-in method** → enable **Email/Password** (leave "Email link" off).
   - Templates → Password reset: set the sender name to "Resale Hub" (the app's "Forgot password?" uses it).
   - Settings → keep **Email enumeration protection** on.
2. **Firestore Database** → Create database → **production mode** → location `nam5 (us-central)` (or your choice; it can't be changed later).
3. **Storage** → Get started → production mode → same region.
4. Note the **Web API Key**: ⚙ Project settings → General. (Optional hardening: Google Cloud console → APIs & Services → Credentials → that key → *API restrictions* → allow only **Identity Toolkit API** and **Token Service API**.)

## 4. eBay developer setup

1. https://developer.ebay.com → **Application Keys** → create a **Production** keyset (Sandbox for testing). Copy **App ID (Client ID)** and **Cert ID (Client Secret)**.
2. **Marketplace account deletion** (eBay requires this before the production keyset works): Application Keys → *Alerts & Notifications* → choose **Marketplace account deletion** → set
   - Endpoint: `https://PROJECT_ID.web.app/api/ebay/account-deletion`
   - Verification token: a random 32–80 char string (letters, digits, `_`, `-`); keep it for step 5.
   Click **Save** only *after* deploying (step 6), since eBay calls the endpoint to verify it. Then **Send Test Notification**.
3. **Register the OAuth redirect (RuName)**: Application Keys → **User Tokens** → *Get a Token from eBay via Your Application* → **Add eBay Redirect URL**:
   - Your auth accepted URL: `https://PROJECT_ID.web.app/api/ebay/oauth/callback`
   - Your auth declined URL: `https://PROJECT_ID.web.app/api/ebay/oauth/callback`
   - Your privacy policy URL: `https://PROJECT_ID.web.app/privacy`
   - Display title: `Resale Hub`; OAuth enabled.
   Save and copy the **RuName** (looks like `Your_Name-YourApp-PRD-abc123-defgh`). That string, not the URL, is the redirect_uri.
4. Etsy (optional, search only): https://www.etsy.com/developers/your-apps → copy the **keystring** and **shared secret** (Etsy requires both since Feb 2026).

## 5. Function secrets and config

From the repo root:

```bash
firebase functions:secrets:set EBAY_CLIENT_ID          # App ID
firebase functions:secrets:set EBAY_CLIENT_SECRET      # Cert ID
firebase functions:secrets:set EBAY_RUNAME             # RuName from step 4.3
firebase functions:secrets:set EBAY_VERIFICATION_TOKEN # token from step 4.2
firebase functions:secrets:set ETSY_API_KEY            # Etsy keystring, or: disabled
firebase functions:secrets:set ETSY_SHARED_SECRET      # Etsy shared secret, or: disabled
```

Non-secret config: `cp functions/.env.example functions/.env`, then set:

```
EBAY_ENV=production          # or sandbox (sandbox keys + sandbox RuName)
EBAY_DELETION_ENDPOINT=https://PROJECT_ID.web.app/api/ebay/account-deletion
```

Sellers' own eBay OAuth tokens, business policy IDs and inventory location are **not** configured here: each user connects eBay in the app, and the API fetches their policies/locations with the eBay Account and Inventory APIs and stores them per user in Firestore.

## 6. Deploy

```bash
cd functions && npm ci && cd ..
firebase deploy --only functions,firestore,storage,hosting
curl https://PROJECT_ID.web.app/api/health          # -> {"ok":true}
curl https://PROJECT_ID.web.app/api/marketplaces    # eBay/Etsy should show configured: true
```

This deploys the `api` function, Firestore rules plus TTL policies (`rateLimits.expiresAt`, `oauthStates.expiresAt`), Storage rules, and the Hosting site:
- Privacy policy: `https://PROJECT_ID.web.app/privacy`
- Support: `https://PROJECT_ID.web.app/support`
- Account deletion (Google Play "delete account URL"): `https://PROJECT_ID.web.app/delete-account`

Then finish eBay step 4.2 (Save + test notification).

## 7. App environment variables

The app reads its backend from `EXPO_PUBLIC_*` variables (no LAN IP):

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://PROJECT_ID.web.app/api` |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Web API key from step 3.4 |
| `EXPO_PUBLIC_WEB_URL` (optional) | `https://PROJECT_ID.web.app` (defaults to the API origin) |

- Local dev: `cp mobile/.env.example mobile/.env.local` and fill it in, then `cd mobile && npx expo start`.
- EAS builds:
  ```bash
  cd mobile
  eas init                      # links the Expo project, adds extra.eas.projectId to app.json
  for ENV in development preview production; do
    eas env:create --environment $ENV --name EXPO_PUBLIC_API_URL --value https://PROJECT_ID.web.app/api --visibility plaintext
    eas env:create --environment $ENV --name EXPO_PUBLIC_FIREBASE_API_KEY --value YOUR_WEB_API_KEY --visibility plaintext
  done
  ```

## 8. Build and submit

```bash
cd mobile
eas build -p android --profile preview      # installable test APK
eas build -p android --profile production   # .aab for Google Play
eas build -p ios --profile production       # needs an Apple Developer account
eas submit -p android --profile production
eas submit -p ios --profile production
```

IDs: iOS bundle identifier and Android package are both `com.diddlerrr.resalehub`. Version numbers are managed remotely by EAS (`appVersionSource: remote`, auto-increment on production).

Store listing fields: privacy policy URL `/privacy`, support URL `/support`, Play account-deletion URL `/delete-account`, audience 13+. Data collected (for Play Data safety / App Store privacy labels): email (account), photos (user content), listing content, eBay tokens (linked to the user, not used for tracking), no ads, no third-party analytics.

## Local development with emulators

```bash
cd functions && npm ci
npm test                         # emulator-backed API test (needs Java 21+)
firebase emulators:start         # API at http://localhost:5000/api (Hosting rewrite)
```

Point the app at the emulators with `EXPO_PUBLIC_API_URL=http://<LAN-IP>:5000/api` and `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=<LAN-IP>:9099` in `mobile/.env.local`. For local secrets, create `functions/.secret.local` with `NAME=value` lines (git-ignored).
