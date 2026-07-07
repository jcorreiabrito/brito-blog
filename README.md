# minimalist blog

A distraction-free, lightning-fast personal blog built with Astro. 

The design is heavily inspired by Apple's classic layout: typography-focused, plenty of whitespace, high contrast, and a smooth theme switcher that matches the system settings but lets you manually toggle it if you want.

All pages/posts are just Markdown files versioned in this codebase. No databases, no complex setup, and no client-side JavaScript overhead.

---

## Getting Started

1. **Install dependencies:**
   Make sure you have Node.js installed, then run:
   ```bash
   npm install
   ```

2. **Run locally:**
   Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:4321` in your browser. Any change you make to the code or markdown files will live-update instantly.

3. **Build for production:**
   To generate the static HTML/CSS files:
   ```bash
   npm run build
   ```
   This compiles everything into the `dist/` folder, which is ready to drop into any static hosting service.

---

## Writing a Post

Writing is as simple as creating a new `.md` file inside `src/pages/posts/`. For example, create `my-first-post.md`:

```markdown
---
layout: ../../layouts/PostLayout.astro
title: "Title of My Post"
pubDate: 2026-07-07
description: "A short description that will show on the home page."
author: "Your Name"
---

Your content goes here. You can use standard Markdown like **bold**, *italics*, `inline code`, bullet lists, and code blocks.
```

The home page will automatically pick up the file, read the date, sort it, and display it.

---

## Customizing

- **Change the homepage intro:** Open `src/pages/index.astro` and edit the intro text inside the first `<section>`.
- **Change styling / colors:** Open `src/styles/global.css`. You can customize the light and dark color schemes (backgrounds, text, links) by modifying the CSS variables at the top of the file.
- **Header & Logo:** Change the text logo in `src/layouts/Layout.astro`.

---

## Deployment & Domain

Check the detailed guides in the `doc/` directory:
- [doc/architecture.md](file:///home/brito/brito-minimal-markdown-blog/doc/architecture.md) — Explains the structure and design system.
- [doc/deployment.md](file:///home/brito/brito-minimal-markdown-blog/doc/deployment.md) — Step-by-step instructions on hooking up a custom domain and deploying to Cloudflare Pages (our recommended host).
