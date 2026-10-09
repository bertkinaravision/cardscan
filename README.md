# CardScan

A phone web app (PWA) for scanning business cards into a shared Google Sheet.

1. Take a photo of the front of a card, and optionally the back. Tap **Add card to queue**.
2. Keep scanning. Each card is read by a vision AI model on its own, in the background.
3. Tap **Review**. Check the fields next to the photo. Fields the model was unsure of say **Check**.
4. Tap **Approve & save**. The card photos go to Google Drive and one row is added to the Sheet.

Nothing is written to the Sheet until you approve a card.

**Faster batches.**

- **Import many photos (one card each):** pick a whole set of card photos from the gallery (for example shot earlier with the phone's camera); each becomes a queued card (front only).
- Event and date are copied into each card when it is added. If you change them later, a button offers to apply the new event and date to the cards still in the queue.
- Event and owner fields suggest earlier values, so spellings stay consistent and the Contacts filters stay tidy.
- Reading or saving a card gives up after about 50 seconds on a bad connection; reading is retried automatically, saving asks you to tap Approve again (safe: a card is never saved twice).

**Dark mode** follows the phone's setting.

The **Contacts** tab lists everyone in the Sheet:

- Search by name, company, email or notes. Filter by status, owner and event. Sort by newest or by next action date (overdue next actions show in red).
- Change the status straight from the list. Tap a contact to edit its next action, owner, notes or any other field, call or email them, open the card photos, or save them to your phone's contacts.
- **Delete** removes the Sheet row and the card photos in Drive.
- **Export CSV** / **Export vCard** downloads the contacts currently shown (respecting search and filters).

**Duplicates.** When you review a card whose email, or name plus company, matches a saved contact, CardScan asks whether to save it as a new contact or update the existing one. Updating fills in the newer card details, adds the event and notes, and keeps the status, owner and next action.

**Offline.** After the app has been opened once with signal, it also opens without signal. Cards you add are kept on the phone and processed when the connection is back.

Built with Next.js, deployed on Vercel. Only the emails listed in `ALLOWED_EMAILS` can sign in.

## Phases

| | Test phase (now) | Next phase (Workspace) |
|---|---|---|
| Google accounts | Personal | Google Workspace |
| Sheet + images | Sheet and folder in a personal Drive, shared with each other | Shared drive |
| Image uploads | As the signed-in person (`DRIVE_UPLOAD_MODE=user`) | As the service account (`DRIVE_UPLOAD_MODE=service_account`) |
| Vision model | Gemini free tier | Claude Haiku 5.5 (`LLM_PROVIDER=anthropic`) |
| Cost | $0 | about $0.05 per month at 50 cards |

Moving between phases only means changing environment variables. See [Switching to Google Workspace](#switching-to-google-workspace).

> **Gemini free tier and privacy.** On the free tier, Google may use the card photos and results to improve its products, and human reviewers may read them. Google says not to send personal information to the free tier. Use it only for testing. The paid tiers of Gemini and Claude don't train on your data.

> **Why images upload as the signed-in person in the test phase.** A service account has no Drive storage of its own, so it can't add files to a personal Drive folder. Only a Workspace shared drive works. Until then, photos are uploaded with your own Google login. The catch: while the Google sign-in app is in "Testing" mode, Google signs you out every 7 days, so you sign in again once a week.

## One-time setup (test phase)

Do this with Bert's personal Google account. It takes about 20 minutes.

### 1. Google Cloud project

1. Go to <https://console.cloud.google.com/>, click the project picker at the top, then **New project**. Name it `cardscan`.
2. Go to **APIs & Services → Library**. Enable **Google Sheets API** and **Google Drive API**.

### 2. Service account (writes to the Sheet)

1. **APIs & Services → Credentials → Create credentials → Service account**. Name it `cardscan`. Skip the optional steps.
2. Open the new service account → **Keys → Add key → Create new key → JSON**. A file downloads. Keep it private; it is a password.
3. Copy the service account's email address (like `cardscan@cardscan-12345.iam.gserviceaccount.com`).

### 3. Google sign-in (OAuth client)

1. **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**).
   - User type: **External**. App name: `CardScan`. Add your email as support and developer contact.
   - **Audience / Test users:** add Bert's and Preeti's Gmail addresses. Leave the publishing status on **Testing**.
   - **Data access / Scopes:** add `.../auth/drive` (needed in the test phase for image uploads).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URIs (add both):
     - `https://YOUR-APP.vercel.app/api/auth/callback/google` (you'll know the exact domain after step 7; you can come back and add it)
     - `http://localhost:3000/api/auth/callback/google`
3. Copy the **Client ID** and **Client secret**.

### 4. The Sheet

1. Create a new Google Sheet, for example `CardScan contacts`.
2. **Share** it with the service account email (Editor) and with Preeti (Editor).
3. Copy the ID from the URL: `docs.google.com/spreadsheets/d/`**`THIS-PART`**`/edit`.

The app creates the `Contacts` tab and header row by itself on the first save.

### 5. The image folder

1. In Google Drive, create a folder, for example `CardScan images`.
2. **Share** it with Preeti (Editor).
3. Copy the ID from the URL: `drive.google.com/drive/folders/`**`THIS-PART`**.

### 6. Gemini API key

1. Go to <https://aistudio.google.com/> and sign in.
2. Click **Get API key → Create API key**. Don't add billing; that keeps it on the free tier.
3. The app uses `gemini-3.5-flash-lite` by default. In tests it read English, Chinese and Japanese cards correctly in under 2 seconds. Google retires older models for new users without much notice (`gemini-2.5-flash` already is); if you see "model not found", set `LLM_MODEL` to a current Flash or Flash-Lite model from AI Studio's list.

### 7. Deploy on Vercel

1. Go to <https://vercel.com/new>, import the `cardscan` GitHub repository.
2. Before clicking Deploy, open **Environment Variables** and add everything from the table below.
3. Deploy. Note the domain (for example `cardscan-xyz.vercel.app`) and make sure the redirect URI in step 3 uses it.
4. Functions run in Singapore (`sin1`, set in `vercel.json`).

Sign in only on the production URL (the one you added as a redirect URI). Vercel's preview links for other branches have different addresses, and Google will refuse them with "redirect_uri_mismatch".

Vercel's free Hobby plan is meant for non-commercial use. Upgrade to Pro if that matters to you.

## Environment variables

See `.env.example` for a copy-paste template. **The examples below only show the format: use your own values.** After deploying, open `https://<your-app>/api/health` to check what the app sees (it flags missing values and leftover examples).

| Name | Format (not a real value) | What it is |
|---|---|---|
| `AUTH_SECRET` | (random) | Encrypts the sign-in cookie. Generate with `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` | `123-abc.apps.googleusercontent.com` | OAuth client ID (step 3). |
| `AUTH_GOOGLE_SECRET` | `GOCSPX-...` | OAuth client secret (step 3). |
| `ALLOWED_EMAILS` | `bert@gmail.com,preeti@gmail.com` | Only these Google accounts can sign in. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",...}` | Paste the whole key file from step 2. Base64 of the file also works. |
| `SHEET_ID` | `1AbC...` | Sheet ID (step 4). |
| `SHEET_TAB` | `Contacts` | Optional. Tab name. |
| `DRIVE_FOLDER_ID` | `1XyZ...` | Folder ID for card photos (step 5). |
| `DRIVE_UPLOAD_MODE` | `user` | `user` in the test phase, `service_account` with a Workspace shared drive. |
| `LLM_PROVIDER` | `gemini` | `gemini`, `anthropic` or `mock`. |
| `LLM_MODEL` | (empty) | Optional. Defaults: `gemini-3.5-flash-lite` / `claude-haiku-5-5`. |
| `LLM_FALLBACK_MODELS` | (empty) | Optional, Gemini only. Models to switch to when the main one's free daily limit is used up or it is retired. Default: `gemini-3.1-flash-lite,gemini-3.5-flash`. |
| `GEMINI_API_KEY` | `AIza...` | When `LLM_PROVIDER=gemini`. |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | When `LLM_PROVIDER=anthropic`. |

After changing a variable on Vercel, redeploy (**Deployments → ⋯ → Redeploy**). When you change `DRIVE_UPLOAD_MODE`, the OAuth client, or `ALLOWED_EMAILS`, also sign out and in again.

## Install on your phone

1. Open the Vercel URL in Safari (iPhone) or Chrome (Android) and sign in.
   - Test phase: Google shows **"Google hasn't verified this app"**. That's expected for your own app in Testing mode: tap **Advanced → Go to CardScan (unsafe)**.
   - On the permissions screen, **tick the Google Drive box**. Without it, saving fails with "CardScan has no Google Drive access".
2. iPhone: **Share → Add to Home Screen**. Android: **⋮ → Add to Home screen** (or **Install app**).
3. Open CardScan from the home screen icon. The first time you take a photo, allow camera access.

The queue is stored on the phone, so you can keep scanning with bad signal. Cards are read while the app is open.

## Troubleshooting

| You see | Cause and fix |
|---|---|
| Sign-in page: "Server setup problem" (`Configuration`) | A sign-in variable is missing or misnamed (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`), or variables were added without redeploying. Fix, then **Redeploy**. Vercel → Logs, filter `/api/auth`, shows the exact error. |
| Google: "Error 400: redirect_uri_mismatch" | Add `https://<your-app>.vercel.app/api/auth/callback/google` to the OAuth client's redirect URIs. Use the production URL, not a preview link. |
| Google: "Access blocked" / app in testing | Add the Gmail address under **Test users** on the OAuth consent screen. |
| "This Google account is not allowed" | The email isn't in `ALLOWED_EMAILS` (comma-separated, exact address). |
| Save: "The service account can't open the Sheet" | Share the Sheet with the service account email as **Editor**. |
| Save: "Sheet not found" | `SHEET_ID` is wrong: use the part between `/d/` and `/edit` in the Sheet URL. |
| Save: "CardScan has no Google Drive access" | Sign out, sign in again, and tick the Google Drive box on Google's screen. |
| Save: "image folder can't be found" | `DRIVE_FOLDER_ID` is wrong, or the folder isn't shared with the person signed in. |
| Save: "Google Drive access has expired" | Test phase only: Google ends access after 7 days. Sign out and in again. |
| Card: "Gemini model … is not available" | Set `LLM_MODEL` to a current model from AI Studio and redeploy. |
| Card: "No Gemini model is available right now" | Every model's free daily limit is used up (the app already switched between models), or the models were retired. Tap Retry later, set newer models in `LLM_MODEL` / `LLM_FALLBACK_MODELS`, or switch to a paid model. |
| Card: "The AI model is busy" | Temporary; the app retries by itself. |
| Card: "Signed out. Sign in again to continue." | Your session ended. Sign in again; the card continues on its own. |

## The Sheet

One row per approved contact, in this column order:

`id, salutation, first_name, last_name, job_title, company, email, mobile, website, address, linkedin, other, event, date_met, notes, status, owner, next_action, next_action_date, scanned_by, scanned_at, last_updated, image_front_link, image_back_link, image_file_ids, source_card_ids`

- `salutation` holds titles such as Dr., Prof., Mr., Ms.; letters after a name (PhD, MBA) go to `other`.
- `mobile` is the mobile number (or the main number if there is no mobile). Office, direct line and fax numbers go to `other`, as does a name printed only in Chinese or Japanese.

- `status` has a dropdown: To contact, Contacted, In conversation, Closed, Not relevant.
- `next_action` has a dropdown too (Send email, Send brochure / deck, Call, Schedule meeting, Arrange demo, Send proposal / quote, Connect on LinkedIn, Introduce to colleague, Follow up later); anything else can still be typed. Change the list in `NEXT_ACTIONS` in `src/lib/fields.ts`.
- `id` and `image_file_ids` are used by the app to find, edit and delete rows. Don't change them.
- Make it look nice: colours, column widths, bold, freezing, hiding columns (`id`, `image_file_ids` and `source_card_ids` are only for the app), sorting and filtering are all fine.
- You can rename headers to readable ones, for example `first_name` → `First name`, `event` → `Event / place met`, `next_action_date` → `Next action date`. The app recognises the technical name or the label the app itself shows. Other names (e.g. "Given name") are treated as your own extra column, and the app adds a new `first_name` column at the right.
- You can move columns and add your own; the app matches columns by header, not position.
- Text is written as plain text, so nothing on a card can turn into a Sheets formula.

## Switching to Google Workspace

Do this once your Workspace is live. Only environment variables change; no code changes.

### A. Shared drive

1. In Google Drive (Workspace account), click **Shared drives → New**. Name it `CardScan`.
2. **Manage members:** add Bert and Preeti as **Manager**, and the service account email as **Content manager**.
   - If the service account is from the personal Cloud project (see C), the shared drive must allow people outside your organisation: **Shared drive settings → Allow people outside … to access files** (your Workspace admin may need to allow this in the Admin console first).
3. Create a folder `Images` inside it, and copy its ID → new `DRIVE_FOLDER_ID`.
4. Move the Sheet into the shared drive, or create a new one there and copy the ID → new `SHEET_ID`.
   - A Sheet owned by a personal account usually can't be moved into a Workspace shared drive. Use **File → Make a copy** and choose the shared drive as the location, then use the copy's ID.
   - Photos from the test phase stay in the personal folder; their links in old rows keep working as long as that folder stays shared. Treat test-phase data as test data, or delete those rows from the app before switching.

### B. Sign-in for Workspace accounts

Either reuse the OAuth client from the test phase (just update `ALLOWED_EMAILS`), or, better, create a new Cloud project inside your Workspace organisation:

1. Create a project in the Workspace organisation, enable the Sheets and Drive APIs.
2. **OAuth consent screen:** user type **Internal**. No test users, no weekly sign-out, no Drive scope needed.
3. Create a **Web application** OAuth client with the same redirect URIs as before.
4. New `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### C. Service account

New Workspace organisations often block creating service account keys (organisation policy `iam.disableServiceAccountKeyCreation`). Options:

- Keep the service account from the personal project (it works, provided the shared drive allows outside members, see A.2), or
- Ask your Workspace admin to allow key creation for the CardScan project, create a new service account and key there, and use it → new `GOOGLE_SERVICE_ACCOUNT_JSON`. Add its email to the shared drive as Content manager.

### D. Vision model: Claude Haiku 5.5

1. Create an API key at <https://platform.claude.com/> (add a payment method; expected cost is about $0.05 per month at 50 cards).
2. Set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

(Alternative: keep Gemini and enable billing on the Cloud project that owns the Gemini key. Paid-tier requests aren't used for training.)

### E. Update Vercel and redeploy

| Variable | New value |
|---|---|
| `DRIVE_UPLOAD_MODE` | `service_account` |
| `DRIVE_FOLDER_ID` | folder in the shared drive |
| `SHEET_ID` | Sheet in the shared drive |
| `ALLOWED_EMAILS` | the two Workspace emails |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | only if you made a new OAuth client (B) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | only if you made a new service account (C) |
| `LLM_PROVIDER`, `ANTHROPIC_API_KEY` | `anthropic` and the key (D) |

Redeploy, then on both phones sign out and sign in with the Workspace account.

## Privacy (Singapore PDPA)

This is a practical summary, not legal advice.

- Business contact information (name, title, work phone, work email, work address) is largely outside the PDPA's main obligations when collected for business purposes. Notes and photos can go beyond that, so treat everything as personal data.
- Access: only the emails in `ALLOWED_EMAILS` can sign in. The Sheet and photos are shared only with those two people (and the service account).
- Deletion: deleting a contact in the app removes the Sheet row and its card photos. In the test phase, a photo uploaded by the other person may not be deletable by you (Drive only lets the owner delete files in a personal Drive); the app tells you when that happens. In a Workspace shared drive this doesn't happen.
- Offline copy: the phone keeps a copy of the app's screens (not the contact list) so it opens without signal.
- Signing out asks first, warns about cards not yet saved, and clears the queue, the card photos stored on the phone and the offline copy.
- `/api/health` shows only whether each setting is present unless you are signed in; IDs and model checks need sign-in.
- Model provider: in the test phase Gemini's free tier may use photos for training (see above). In the next phase Claude's API doesn't train on your data by default.
- No analytics or third-party trackers. Secrets live only in Vercel's environment variables.
- Photos are compressed on the phone (max 1600px JPEG) before upload.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
```

Set `LLM_PROVIDER=mock` to try the app without an AI key (every card returns the same sample contact). Saving still needs the Google settings.

Checks: `npm run lint`, `npx tsc --noEmit`, `npm test` (Sheet, Drive and merge logic against a fake Google API; no account needed), `npm run build`.

## Code map

- `src/components/ScanScreen.tsx`: capture screen and queue.
- `src/components/QueueRunner.tsx`: sends queued cards to the AI one at a time.
- `src/components/ReviewScreen.tsx`: review and approve, duplicate check.
- `src/components/ContactsScreen.tsx`: list, search, filters, inline edits, delete, export.
- `src/lib/client/contacts.ts`, `export.ts`: contact API calls, duplicate matching, CSV/vCard.
- `public/sw.js`: offline support.
- `src/lib/client/queue.ts`: queue stored on the phone (IndexedDB).
- `src/lib/llm/`: model adapters (Gemini, Claude, mock) and the shared prompt.
- `src/lib/fields.ts`: field list, statuses, Sheet columns, validation.
- `src/lib/server/sheet.ts`, `google.ts`: Google Sheets and Drive.
- `src/auth.ts`: Google sign-in and the allowlist.
