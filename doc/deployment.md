# Blog Deployment and Domain Plan

This document details the strategy for putting the blog online, setting up version control (git), and configuring a custom domain.

## 1. Version Control (Git)

Because the entire blog's content and design are stored in plain text, you can version control it with Git.

### Recommended Steps:
1. Initialize git in the root folder:
   ```bash
   git init
   ```
2. Create a `.gitignore` to avoid versioning generated files and dependencies:
   ```text
   # dependencies
   node_modules/

   # build outputs
   dist/

   # IDEs and OS files
   .DS_Store
   .vscode/
   .idea/
   ```
3. Commit all files:
   ```bash
   git add .
   # Note: Commit message best practices
   git commit -m "Initialize minimal markdown blog codebase"
   ```
4. Push to a private or public repository on GitHub, GitLab, or Bitbucket.

---

## 2. Choosing a Hosting Provider

Since the blog builds to a highly optimized static site, you can host it for **free** on multiple modern edge networks. The top three recommendations are:

### Option A: Cloudflare Pages (Highly Recommended)
- **Pros:** Global edge network, unlimited bandwidth, free custom domain SSL, automatically handles CNAME/DNS setup if you use Cloudflare DNS.
- **Setup:** Connect your GitHub repo, select **Astro** preset, build command `npm run build`, output directory `dist`.

### Option B: Vercel
- **Pros:** Zero-config integrations, fast deployment, built-in preview deployments for git branches.
- **Setup:** Click "Add New Project" -> Import GitHub repo -> Select **Astro** -> Click "Deploy".

### Option C: GitHub Pages
- **Pros:** Built directly into GitHub.
- **Setup:** Can be set up via a GitHub Actions workflow to build and deploy to a `gh-pages` branch.

---

## 3. Configuring a Custom Domain

To host the blog under your own domain (e.g. `yourname.com` or `blog.yourname.com`), follow these steps:

### Step 1: Add Domain to the Host
In your hosting provider dashboard (Vercel, Cloudflare, etc.):
1. Go to **Settings** -> **Domains**.
2. Enter your custom domain (e.g., `blog.yourdomain.com`).

### Step 2: Configure DNS Records (at your Domain Registrar)
Go to your domain registrar (GoDaddy, Namecheap, Google Domains/Squarespace, Porkbun) and update your DNS records.

#### For a Subdomain (e.g., `blog.yourdomain.com`)
Add a **CNAME** record:
- **Type:** `CNAME`
- **Name:** `blog` (or the prefix you want)
- **Target/Value:** The host-specific target provided by your provider (e.g., `cname.vercel-dns.com` or your Cloudflare Pages domain `minimal-blog.pages.dev`).
- **TTL:** Auto or 3600.

#### For an Apex Domain (e.g., `yourdomain.com` directly)
Add **A** records:
- **Type:** `A`
- **Name:** `@` (represents the root domain)
- **Value:** The IP address(es) provided by your host (e.g., Vercel's IP `76.76.21.21` or Cloudflare Pages A records).
- Add a CNAME redirect for `www` to `@` so `www.yourdomain.com` resolves correctly.

### Step 3: Wait for Propagation and SSL
DNS propagation typically takes anywhere from 5 minutes to 24 hours. Once propagated, your hosting provider will automatically issue a free Let's Encrypt SSL certificate, ensuring your blog is served securely via HTTPS.
