# Résumé Autofill — Edge / Chrome extension

A personal widget that fills job-application forms fast using your résumé — your
**summary**, **work experiences** (a *full* and a *snippet* version of each),
**skills** and **contact details**.

On any job site you can:

- Click the floating **⚡ button** (bottom-right) to open a panel, choose **Full**
  or **Snippet**, then click a block to drop it into the field you last touched.
- Use the inline **⚡ Autofill chip** that appears next to a text box.
- **Right-click** a form field → **Résumé Autofill** → pick a block.
- Hit **Auto-fill contact fields** to populate name / email / phone / links in one go.

Your data **syncs across every PC** where you're signed into the same Edge/Chrome
profile (via `storage.sync`). You can also publish an `autofill.json` from your
site and pull it on any device.

---

## Install in Microsoft Edge

1. Open **`edge://extensions`**.
2. Turn on **Developer mode** (bottom-left).
3. Click **Load unpacked** and select this **`extension/`** folder.
4. Pin **Résumé Autofill** to the toolbar (puzzle icon → pin).
5. Click the icon → **Edit / add résumé data** (or **OCR a resume**) and fill it in.

> Chrome is identical: `chrome://extensions` → Developer mode → Load unpacked.

## Add your résumé

Open the extension's **options** (icon → *Edit / add résumé data*):

- **Import from a resume (AI/OCR):** paste resume text or upload a **PDF** or
  image of your résumé (scanned PDFs are OCR'd by the model), add your OpenAI API
  key (stored only on this device), and click **Extract**. Review, then **Save**.
- Or type everything manually. Each experience has a **Full** (detailed) and a
  **Snippet** (1–2 line) field. Use **✨ Snippet from full** to draft the short one.

## Cross-device / "from admin"

- Signed-in profile sync is automatic — install the extension on your other PC and
  your data appears.
- To drive it from your portfolio admin, publish an `autofill.json` and paste its
  URL under **Sync across devices → Pull now**.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest |
| `src/model.js` | data model + storage keys |
| `src/store.js` | local + chunked `storage.sync` helpers |
| `src/insert.js` | field detection + React-safe value insertion |
| `content.js` | on-page FAB, panel, chip, contact autofill |
| `background.js` | right-click context menu |
| `popup.html/js/css` | toolbar popup (modes + toggles) |
| `options.html/js/css` | résumé editor + AI/OCR + import/export/sync |
| `icons/` | toolbar icons (`make_icons.py` regenerates them) |

## Privacy

Everything lives in your browser storage. Your API key is kept in
`storage.local` and is **never** synced. No analytics, no external servers except
the AI endpoint you call for OCR and the `autofill.json` URL you choose to pull.
