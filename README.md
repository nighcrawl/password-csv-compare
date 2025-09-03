# Password CSV Compare

This project implements a **client‑side web application** to help migrate passwords from Dashlane to Apple Passwords without creating duplicates. It is designed to run entirely in the browser, with a mobile‑first user interface optimised for iOS 17+ devices and a bilingual (French/English) experience.

## Features

* **Import two CSV files** – one exported from Dashlane and one exported from Apple Passwords. Drag‑and‑drop is supported on desktop, while file pickers are used on mobile.
* **Flexible column detection** – the parser automatically maps common column names (title/name, URL, username, password, notes, OTP) so that exports with arbitrary column orders or labels work out of the box.
* **Data normalisation** – URLs are normalised (HTTPS prefix ensured and trailing slashes removed), usernames are lower‑cased when they contain an `@`, and the registrable domain is extracted from the URL. This allows accurate comparisons even when the exported data differs slightly.
* **Comparison modes** – by default the comparison uses the combination of **domain + username**. You can enable a stricter mode that compares **full URL + username** via a toggle.
* **Result summary and preview** – after comparing, the app displays the number of entries in each source and how many entries are missing in Apple Passwords. A scrollable preview table lists the missing entries.
* **CSV export** – one click generates an Apple‑compatible CSV (`title,url,username,password,notes,otpAuth`) containing only the missing entries so you can import it directly into Apple Passwords.
* **Offline capable** – thanks to a minimal service worker and PWA manifest, the app can be installed on your iPhone (“Add to Home Screen”) and will work offline. No data ever leaves your device.
* **Auto dark/light theme** – adapts to the user’s preferred colour scheme, with a high contrast design suitable for accessibility.
* **Bilingual UI** – a language toggle lets you switch between French and English at any time. All static text and dynamic labels are translated.

## Getting Started

The project is a static web app; no build tools are required. You can simply open `index.html` in a modern browser. To develop or preview locally:

1. Clone or download the repository.
2. Open `password-csv-compare/index.html` in your web browser.
3. Optionally, serve the folder via a local HTTP server (for example with `npx http-server .`) to test service‑worker caching and the PWA install prompt.

### GitHub Pages Deployment

To deploy on GitHub Pages:

1. Create a repository on GitHub and copy the contents of `password-csv-compare` into its root.
2. Commit and push the files.
3. In the repository settings, enable GitHub Pages for the `main` branch (or a dedicated `gh-pages` branch).
4. After a few minutes, the app will be available at `https://{username}.github.io/{repository}` and installable as a PWA.

## Security and Privacy

All operations occur in the browser. Files are read locally using the File API; nothing is uploaded. The service worker caches only the application shell (HTML, CSS, JS, icons) and never stores or transmits your password data. After use, delete the CSV files from your device if you no longer need them.

## Contributing

Contributions are welcome! If you encounter an edge case where the column detection fails or want to add more features (e.g. custom column mapping, additional languages), feel free to submit a pull request.