# SheetGrab

A Chrome extension (Manifest V3) that clips job postings, internships and research papers into your own Google Sheet with one click.

SheetGrab doesn't scrape specific sites. It reads the page text and looks for labels like "Deadline:", "Apply by" or "Hiring Manager". It also uses standard metadata (JSON-LD `JobPosting`, `citation_*` and `og:*` tags), so it works on LinkedIn, ATS boards (Greenhouse, Lever, Workday…), company career pages and paper sites. Everything runs locally. The only network calls go to Google's Sheets API, using your own OAuth token.

## One-time setup (≈10 minutes)

The extension uses Chrome's built-in Google sign-in (`chrome.identity`), which needs an OAuth client ID that you own.

1. **Load the extension.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
   The extension ID should be **`piomlnckefcdoihgpfaijbfmjdoglnai`**. The `key` field in `manifest.json` (the Chrome Web Store public key) keeps it the same as the published extension.
2. **Create a Google Cloud project** at <https://console.cloud.google.com/>.
3. **Enable the Google Sheets API:** go to APIs & Services → Library → "Google Sheets API" → Enable.
4. **Configure the OAuth consent screen** (APIs & Services → OAuth consent screen / Google Auth Platform):
   - User type: **External**. Publishing status: **Testing**.
   - Add your own Google account under **Test users**.
   - Scope: `https://www.googleapis.com/auth/spreadsheets`.
5. **Create the OAuth client** (Credentials → Create credentials → OAuth client ID):
   - Application type: **Chrome Extension**.
   - Item ID: `piomlnckefcdoihgpfaijbfmjdoglnai`.
6. Copy the client ID into `manifest.json` → `oauth2.client_id`, replacing `YOUR_CLIENT_ID.apps.googleusercontent.com`.
7. Click the reload icon for SheetGrab in `chrome://extensions`.

## Using it

1. The settings page opens on install. You can also right-click the icon → Options.
   1. Click **Connect Google Account**.
   2. Paste your Sheet URL and click **Load tabs**, then pick a tab.
   3. Row 1 is read as headers and each column gets a rule guessed from its name. Under **Make sure my Sheet has these columns**, tick the standard fields you want. The defaults are Company, Role, Deadline, Contact, Link and Date Saved. Any that are missing get created in row 1 and linked to the right rule when you save, so an empty Sheet works too.
   4. Rows are written by header name, so you can reorder columns freely. If a mapped column is deleted later, SheetGrab re-creates it the next time it has a value for it. "Apply By" becomes Deadline, "Company" becomes Company, "Link" becomes Page URL, and so on. Adjust the rules or keywords as needed, then click **Save settings**.
2. On a job posting, click the SheetGrab icon. The form shows one field per column, pre-filled, with a hint saying where each value came from.
3. Fix anything that's wrong and click **Save to Sheet**. You'll see "Added to Row N".

Tip: select part of the page before clicking the icon, and SheetGrab searches the selection first.

### Rules

| Rule | Looks at (in order) |
| --- | --- |
| Job title | JSON-LD title → "Job Title:/Position:/Role:" → page title |
| Company | "Company:/Organization:/Employer:" → JSON-LD hiringOrganization → page title → `og:site_name` |
| Deadline | "Deadline/Apply by/Closes on/…" + a date → JSON-LD validThrough |
| Contact person | "Hiring Manager/Recruiter/Contact/Reach out to…" → a name and/or email |
| Location, Salary | labels → JSON-LD jobLocation / baseSalary |
| Authors, Abstract, Published date | `citation_*` meta → JSON-LD article → labels |
| Page title, Page URL, Date saved | page metadata / today |
| Custom keywords | your labels, with a value type (date, person, email, text…) |
| Custom regex | first capture group (or the whole match) in the page text |

## Development

No build step and no dependencies. These are plain ES modules that Chrome loads directly.

```
manifest.json
background/   service worker: OAuth token handling + Sheets API calls
content/      collectPageData(): injected on click, returns raw page text/meta/JSON-LD
lib/          extract.js (pure extraction engine), rules.js, storage.js, dom.js, messaging.js
popup/        the clipper form
options/      settings + column mapping
tests/        node --test unit tests with page fixtures
scripts/      package.mjs (store zip), screenshots.mjs (store images)
docs/         homepage + privacy policy to host (e.g. GitHub Pages), store-listing.md (dashboard copy)
```

```sh
npm test              # or: node --test   (Node 20+)
npm run package       # tests + dist/sheetgrab-<version>.zip for the Chrome Web Store
npm run screenshots   # dist/store/*.png (1280×800 screenshots + 440×280 promo tile)
```

To debug, open `chrome://extensions` and use **Inspect views: service worker** for background logs. Right-click the popup → Inspect for popup logs.

## Publishing to the Chrome Web Store

End users don't need any Google Cloud setup. They install SheetGrab and click **Connect Google Account**. These steps are for you, once.

1. **Developer account.** Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). It's a one-time $5 fee and needs 2-step verification.
2. **Host `docs/`** on GitHub Pages or similar.
   - Replace the `YOUR-…` placeholders in `docs/index.html`, `docs/privacy.html` and `docs/store-listing.md`.
   - Set `homepage_url` in `manifest.json` to the hosted URL.
   - Verify the domain in [Google Search Console](https://search.google.com/search-console). OAuth verification requires it.
3. **Build and upload.** Run `npm run package`, then upload `dist/sheetgrab-<version>.zip` as a **new item**. Don't submit it yet.
4. **Switch to the store's extension ID.** The store assigns a new ID, which you can see on the item page.
   1. In Google Cloud → Credentials, edit your *Chrome Extension* OAuth client and set **Item ID** to the new ID.
   2. In the dashboard → Package → **View public key**, copy the key (without the BEGIN/END lines) into the `key` field of `manifest.json`. Your unpacked dev build now has the same ID as the store version.
   3. Reload the unpacked extension and check that **Connect Google Account** still works.
5. **Fill in the listing.**
   - Use the copy in [docs/store-listing.md](docs/store-listing.md), and the images from `npm run screenshots`.
   - On the Privacy tab, paste the single purpose, the permission justifications and the privacy policy URL.
   - Then **Submit for review**. It usually takes a few days.
6. **OAuth verification.**
   - Set the consent screen to **In production**, then submit for verification. Use the scope justification and demo-video script in `docs/store-listing.md`.
   - Until it's approved, users see an "unverified app" screen and you're limited to 100 users.
   - Verification is free. The `spreadsheets` scope is *sensitive*, not *restricted*, so you don't need a paid security assessment.

**Updates:** bump `version` in `manifest.json`, run `npm run package`, and upload the new zip on the item's Package tab. The packaging script always removes `key`, so leaving the store key in your local manifest is fine.

### Notes

- **Permissions:** `activeTab` + `scripting` (the page is read only when you click the icon), `identity`, `storage`, and access to `sheets.googleapis.com`. No broad host permissions.
- **Formula injection:** page-derived values that start with `=`, `+`, `-` or `@` are saved as text, so they can't become live formulas.
- **Restricted pages:** on pages Chrome doesn't let extensions read (`chrome://` pages, the Web Store), only the URL, title and date are filled in.
- **Publishing:** to publish on the Chrome Web Store you'd submit the consent screen for verification. The `spreadsheets` scope is "sensitive", not "restricted".
