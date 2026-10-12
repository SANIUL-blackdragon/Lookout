<!-- Logo + Badges -->
<p align="center">
  <img src="assets/logo/logo.svg" alt="Lookout" width="160" />
</p>

<p align="center">
  <a href="https://github.com/SANIUL-blackdragon/Lookout"><img src="https://img.shields.io/github/stars/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="GitHub stars" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/network/members"><img src="https://img.shields.io/github/forks/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Forks" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/issues"><img src="https://img.shields.io/github/issues/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Issues" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/graphs/contributors"><img src="https://img.shields.io/github/contributors/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="Contributors" /></a>
  <a href="https://github.com/SANIUL-blackdragon/Lookout/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SANIUL-blackdragon/Lookout?style=for-the-badge" alt="License" /></a>
</p>

# Lookout

A collection of remarkable corners of the web. At least visually.

Lookout is a curated archive of websites that stand out for their design, composition, interaction, and aesthetic quality. The goal is simple: collect beautiful digital experiences, preserve them, and make them easy to explore for inspiration.

---

## Demo / Preview
Add screenshots or a demo GIF under `assets/` and reference them here:

![Preview](assets/preview.png)

---

## Features

- Curated collection of visually compelling websites
- Minimal, archive-style layout optimized for visual browsing
- Entries with metadata, description, and credits
- Easy local hosting and deployment
- Simple structure for contributions and expansion

---

## Project structure

```
Lookout/
├── index.html
├── assets/
│   ├── logo.png        <-- recommended logo location
│   ├── css/
│   ├── js/
│   └── images/
├── sites/
│   ├── example-site/
│   │   ├── index.html
│   │   └── metadata.json
├── README.md
└── LICENSE
```

Tip: put your logo at `assets/logo.png` (transparent PNG / SVG recommended). The header uses that path.

---

## Local setup

Serve as a static site with any simple server.

Python:
```bash
python -m http.server 8000
# open http://localhost:8000
```

Node:
```bash
npx serve .
# open http://localhost:5000 (or shown port)
```

---

## How to add a site

Under `sites/` create a folder for the site and include:
- index.html (optional local snapshot)
- metadata.json with fields like:
  - title
  - url
  - author
  - description
  - tags
- preview image in `assets/images/`

Example metadata.json:
```json
{
  "title": "Example Site",
  "url": "https://example.com",
  "author": "Designer Name",
  "description": "Short description of why this site is remarkable.",
  "tags": ["typography", "experimental", "animation"]
}
```

---

## Contributing

1. Fork the repo
2. Add or update an entry under `sites/` and include a preview
3. Add or update `assets/logo.png` if you want a new logo
4. Open a pull request with a short description of your change

Please follow the existing entry structure to keep the archive consistent.

---

## Badges & Branding notes

- Badges above use Shields.io and auto-update (stars, forks, issues, contributors, license, CI).
- Keep `assets/logo.png` (160–320px wide) or add an SVG at the same path for crisp scaling.
- If you prefer the logo inline with the title rather than centered, replace the header with:
```html
<p align="left">
  <img src="assets/logo.png" alt="Lookout" width="64" style="vertical-align:middle" /> <strong>Lookout</strong>
</p>
```

---

## License

This project is licensed under the MIT License — see the LICENSE file for details.

---

If you want, I can:
- commit this README to the repository and place the file at the proper path,
- add a suggestions commit that creates an `assets/logo.png` placeholder and a sample `sites/example-site/metadata.json`,
- or generate a more design-forward README with custom styling and a demo GIF.
