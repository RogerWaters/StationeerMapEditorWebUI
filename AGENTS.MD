### Map Generator – Best Practices

This project is intentionally framework-light so it can be shipped as static files (e.g., GitHub Pages). Keep the following rules in mind whenever extending the tool:

1. **Pure static delivery**  
   - No npm/bundlers; depend only on committed JS/CSS/asset files.  
   - Mirror external CSS/JS/Fonts locally under `vendor/` or `assets/` before referencing them.

2. **Modular UI structure**  
   - Keep state manipulation inside `assets/js/state/` modules.  
   - Each panel lives in `assets/js/panels/` and exposes creation + sync helpers.  
   - Avoid inline logic in `index.html`; the SPA bootstraps from `assets/js/app.js` only.

3. **UX expectations**  
   - World/tree changes apply immediately—no extra save buttons inside panels.  
   - Layouts should always use the full viewport height; rely on internal scrollviews when content exceeds the available space.  
   - Avoid animations during panel switches to keep the professional desktop tooling feel.

4. **Testing discipline**  
   - Every new panel or major UI surface needs at least one browser UI test under `tests/ui/`.  
   - Tests should load the actual SPA, drive it via the AppHarness hooks, and assert the relevant DOM/Webix state using Mocha/Chai.  
   - Keep the automated runner (`tests/run-ui-tests.mjs`) up to date so new suites can piggyback on it.

5. **Consistency & style**  
   - Reuse shared styles in `assets/css/app.css` and match existing typography/colors.  
   - Panels should be borderless; spacing belongs inside content blocks, not around the multiview container.  
   - Strings must remain bilingual-friendly (currently German labels with some English keywords).

6. **State hygiene**  
   - Never mutate UI widgets directly from state modules; instead, update `projectState` and let views re-sync.  
   - Keep navigation tree rebuilds idempotent and guard against recursive selection handlers.

Document any deviations from these guidelines directly in this file so future collaborators understand the rationale.
