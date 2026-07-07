# Blog Architecture Plan

This document outlines the architecture, layout structure, and design principles of the minimal Markdown blog.

## Directory Layout

We propose the following clean, standard Astro structure:

```text
minimal-markdown-blog/
├── doc/
│   ├── architecture.md      # This document
│   └── deployment.md        # Deployment and custom domain configuration
├── src/
│   ├── components/          # Reusable components (Header, Footer, ThemeToggle)
│   ├── layouts/
│   │   ├── Layout.astro     # Standard page shell
│   │   └── PostLayout.astro # Optimized layout for articles (typography, dates)
│   ├── pages/
│   │   ├── index.astro      # Homepage (lists posts)
│   │   └── posts/           # Directory where blog post Markdown files live
│   │       └── hello-world.md
│   ├── styles/
│   │   └── global.css       # Core typography, dark/light colors, transitions
│   └── env.d.ts             # TypeScript definitions
├── public/                  # Static assets (favicon, images)
├── astro.config.mjs         # Astro configuration
├── package.json             # NPM dependencies & build commands
└── tsconfig.json            # TypeScript configuration (optional but recommended)
```

## How Markdown Pages Work

Astro has built-in routing for markdown. Any `.md` file inside `src/pages/posts/` automatically builds to a URL route:

`src/pages/posts/my-first-post.md` -> `yoursite.com/posts/my-first-post`

### Frontmatter Format
Each blog post Markdown file uses YAML frontmatter at the top to supply metadata:

```yaml
---
layout: ../../layouts/PostLayout.astro
title: "Simplicity in Design"
pubDate: 2026-07-07
description: "Exploring the elements of premium minimal web layouts inspired by classic design."
author: "Author Name"
tags: ["design", "minimalism"]
---

Your blog content goes here...
```

The `PostLayout.astro` file will automatically read this metadata to construct:
1. The browser title tag (`<title>`) and meta descriptions for SEO.
2. The page heading (`<h1>`), publication date format, and author block.
3. The core HTML layout wrapping your markdown content.

## Design System & Style Tokens (Apple-Inspired)

To achieve a premium, Apple-like design, we will use a strict, minimal style system in `global.css`:

### 1. Typography
- **Font Stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. On Apple devices, this maps directly to *SF Pro* / *San Francisco*.
- **Body Font Size:** `17px` on mobile, scaling up to `19px` on desktop for premium readability.
- **Line Heights:** `1.5` for body text, `1.2` for headings.
- **Content Width:** Max `680px` for reading areas (optimal line length of 60–80 characters).

### 2. Palette (Light / Dark Mode)
Using modern CSS variables, the site will automatically respond to system preferences (`prefers-color-scheme`) and offer optional manual overrides:

| Style Variable | Light Theme | Dark Theme |
| :--- | :--- | :--- |
| `--bg-primary` | `#ffffff` | `#000000` |
| `--bg-secondary` | `#f5f5f7` (Apple gray) | `#1d1d1f` |
| `--text-primary` | `#1d1d1f` (Rich charcoal) | `#f5f5f7` |
| `--text-secondary`| `#86868b` (Muted) | `#86868b` |
| `--accent` | `#0066cc` (Link blue) | `#2997ff` (Bright blue) |
| `--border-color` | `#d2d2d7` | `#333336` |

### 3. Layout Spacing
- Rely on spacious, defensive paddings (`padding: 1.5rem` to `4rem`) to let the page "breathe."
- Align all text content cleanly with the left edge.
- Subtle grid/flex patterns with no unnecessary lines or borders.
