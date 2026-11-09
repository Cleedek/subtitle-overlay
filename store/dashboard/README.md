# Filling the Chrome Web Store Developer Dashboard from Arc

The Dashboard can't be driven by extensions or the app's built-in browser, but Arc runs JavaScript sent by AppleScript (no setting needed). Open the item in Arc, keep that tab active, then:

- `./arc.sh file.js` runs a JS file in Arc's active tab and prints the result (async code returns `{}`, so keep steps synchronous).
- `python3 fill.py <code> [text-file]` switches Store listing language (codes as in the Dashboard: `zh-CN`, `pt-BR`, …) and puts the file's text in Description.
- `python3 mkupload.py <png> '<container selector>' out.js` makes a JS file that drops an image into a screenshot slot. Global screenshots: `[data-image-upload-type="4"][data-is-global="true"]`; the current language's own: `[data-image-upload-type="4"]:not([data-is-global])`. Max 5 per slot, so remove one first (its "Remove image" button, then the dialog's "Remove" via `dlgbtn.js`), then reorder with `moveleft.js`.
- `save.js` clicks Save draft. Submit for review stays a human click.
