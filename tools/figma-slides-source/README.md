# Case Study Authoring

AI Options now drafts separate proposals. It never regenerates a study in place.

- Add notes, PDFs, PPTX files, Markdown, or a Studio Figma Slides export.
- Sources and original imported files stay in this browser's IndexedDB, separate from published case-study data. This is local storage, not encrypted storage or cross-device sync; clearing site data removes it.
- Explicitly approve sending selected sources to the configured AI providers. Importing a file does not call AI. Reference links are text only and are not fetched.
- Choose a narrative and focus request. Existing visible, unprotected sections are opt-in evidence; complete existing artifacts can be reused intact.
- Review the native preview, source quotations and evidence gaps. Edit copy, choose sections, and append or update a matching unprotected text/statement section. Other components, media, decks, protection and settings remain intact.
- Apply saves a draft, not a publication. Changed studies invalidate older proposals. Numbers and source quotations receive deterministic checks; those checks do not prove every claim or causal inference. Author review is required.

## Figma Slides

**Ready-to-use path:** export your Figma Slides presentation as PDF and add it in AI Options. Each PDF page retains its identity, extracted text and a downsampled analysis image. The original file is stored unchanged. PDFs do not include speaker notes, animation or interactive behavior. Image-only pages need a transcription for cited claims.

**Developer preview:** this folder includes a read-only Slides plugin using Figma's documented plugin API. It exports visible, non-skipped slides in slide-grid row order, text layer content and PNG analysis copies. It does not modify the deck, read credentials, request network access, or call AI. Text follows layer order, which may differ from reading order.

1. In Figma desktop, create a local development plugin for Slides to obtain a Figma-assigned plugin ID.
2. Use the fields in `manifest.example.json` with that ID in the local plugin's manifest, and use this folder's `code.js` and `ui.html` as its entry points.
3. Run it in a Slides page with one slide grid, export, and download the local package.
4. Add the downloaded JSON in the case study's AI Options source picker. Review source text and slide order before drafting.

The plugin host and download workflow require real Figma acceptance testing. No private-link REST import or Figma token storage is implemented. PDF is the supported fallback.

## Coverage And Limits

- Up to 80 source pages and 120 MB of original files in one workspace; 16 selected page images and 120,000 text characters per draft; 16,000 text characters per page; 30 MB per file.
- For PDFs and Figma packages, the first 16 pages are selected initially; remaining pages are visible and selectable, never silently discarded. Selecting more than 16 images blocks generation.
- PPTX presentation relationships determine slide order and speaker-note mapping. Text is extracted; charts, vectors, embedded images and layout are not rendered. Add a PDF for visuals.
- Original files remain local and unchanged. Analysis images are downsampled and never replace case-study assets.
- Output supports seven new native section types plus intact reuse of any eligible existing component. Metadata generation, automatic media placement, semantic fact verification, direct Figma links, and cross-device source sync are not implemented.
- No paid-provider or real Figma tests were performed during implementation; synthetic tests do not establish writing quality on your work.

Verification: `node --test case-study-authoring.test.mjs` and `node --test --test-name-pattern="case authoring" slide-studio-deck.test.mjs` with `SLIDE_LAB_URL` set to the local site server.