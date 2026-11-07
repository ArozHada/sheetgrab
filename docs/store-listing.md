# Chrome Web Store and OAuth verification copy

This is paste-ready text for the developer dashboard and Google's OAuth verification form.
(This file lives in `docs/`, so it's public along with the repo. It contains nothing private.)

---

## Store listing tab

**Name:** SheetGrab

**Contact email** (set and verify it in the dashboard under Account): sheetgrab@protonmail.com

**Summary** (max 132 characters, same as the manifest description):
> Clip job postings, internships and papers from any page into your Google Sheet.

**Category:** Productivity → Workflow & Planning (or Tools)

**Language:** English

**Description:**
> Tracking job or internship applications in a spreadsheet? SheetGrab turns the posting you're looking at into a new row in your own Google Sheet, in one click.
>
> HOW IT WORKS
> 1. Connect your Google account and paste the link to your tracking Sheet.
> 2. SheetGrab reads your column headers (Company, Role, Deadline, Contact, Link, Date Saved…) and matches each one to an extraction rule. It can create any missing columns for you.
> 3. On any job posting, click the SheetGrab icon. The fields are pre-filled from the page. Check them, edit anything, and click "Save to Sheet". You'll see "Added to Row 42".
>
> WORKS ON ANY SITE
> SheetGrab doesn't rely on one website's layout. It looks for labels like "Deadline:", "Apply by", "Hiring Manager" or "Reach out to", and uses standard job and article metadata. It works on LinkedIn, job boards, company career pages and research paper sites. Tip: select part of a page before clicking, and SheetGrab looks there first.
>
> PRIVATE BY DESIGN
> • The page is read only when you click the icon.
> • Data goes straight from your browser to your own Google Sheet. There are no SheetGrab servers.
> • No analytics, no ads, no tracking.
>
> Also handy for researchers: save paper titles, authors, abstracts and publication dates.

**Graphics:**
- Icon: `icons/icon128.png`
- Screenshots (1280×800): run `npm run screenshots` and upload the files in `dist/store/`
- Small promo tile (440×280): `dist/store/promo-440x280.png` (made by the same script)

---

## Privacy practices tab

**Single purpose description:**
> SheetGrab saves details from the web page the user is viewing (such as job title, company, deadline, contact and link) as a new row in a Google Sheet the user chooses.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Lets SheetGrab read the page the user is viewing, only after they click the extension icon, so it can pre-fill the form. No access to any other tab. |
| `scripting` | Runs a one-time script in the active tab (after the user clicks the icon) that collects the page's text, title, URL and metadata for the form. |
| `identity` | Signs the user in with Chrome's built-in Google sign-in to get an OAuth token for the Google Sheets API. |
| `storage` | Saves the user's settings (spreadsheet ID, tab name, column mapping) with `chrome.storage.sync`. |
| Host permission `https://sheets.googleapis.com/*` | Calls the Google Sheets API to read the header row of the user's spreadsheet and append rows. This is the only server SheetGrab talks to. |

**Remote code:** No, I am not using remote code. (All JavaScript is included in the package.)

**Data usage.** Tick these:
- **Personally identifiable information:** yes, if a page contains a contact's name or email that the user chooses to save.
- **Website content:** yes, text from the page the user clips.
- **Authentication information:** yes, the Google OAuth token (managed by Chrome, used only for the Sheets API).

Leave everything else unticked: health, financial, location, web history, user activity and personal communications.

**Certify all three:**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://arozhada.github.io/sheetgrab/privacy.html`

---

## Google OAuth verification (consent screen → Publish app → Prepare for verification)

**App name:** SheetGrab

**Developer contact email** (only Google sees this): sheetgrab@protonmail.com

**User support email** (shown on the consent screen): a Proton address can't be picked here, because Google only offers your signed-in account or a Google Group you manage. Create a free Google Group, add sheetgrab@protonmail.com as a member, and select the group.

**App homepage:** `https://arozhada.github.io/sheetgrab/`

**Privacy policy:** `https://arozhada.github.io/sheetgrab/privacy.html`

**Authorized domain:** `arozhada.github.io` (must be verified in Google Search Console)

**Scope:** `https://www.googleapis.com/auth/spreadsheets` (sensitive)

**Scope justification:**
> SheetGrab is a Chrome extension that saves details from the web page a user is viewing (e.g. a job posting's title, company, deadline and link) as a new row in a Google Sheet the user picks by pasting its URL. It needs the spreadsheets scope to (1) read the spreadsheet's tab names and header row so the user can map columns, (2) append a row when the user clicks "Save to Sheet", and (3) add missing header cells the user asked for. The narrower drive.file scope does not work for this flow, because the user pastes the URL of an existing spreadsheet they created outside the app. The app never deletes data and has no servers; all requests go directly from the user's browser to the Sheets API.

**Demo video** (unlisted YouTube, about 2 minutes). Record in this order:
1. Show the extension's ID in `chrome://extensions` (it must match the OAuth client).
2. Open SheetGrab settings and click **Connect Google Account**. Show the full Google consent screen, with the app name and the Sheets permission visible.
3. Paste a Sheet URL, click **Load tabs**, pick a tab and show the column mapping. Tick a missing column and click **Save settings**. Switch to the Sheet and show the new header.
4. Open a job posting, click the SheetGrab icon, edit one field and click **Save to Sheet**.
5. Switch to the Sheet and show the new row.
6. Back in settings, click **Disconnect**.
