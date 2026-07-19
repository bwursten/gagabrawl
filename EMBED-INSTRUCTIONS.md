# Embedding GaGa Brawl on WordPress.com (Business plan)

You have a ready-to-deploy build in the **`dist/`** folder and a zipped copy,
**`gagabrawl-embed.zip`**, for drag-and-drop hosting. All asset filenames are
content-hashed (e.g. `game.6393147c.js`), so they can be cached forever and
you'll never serve a stale file after an update.

The game is entirely client-side — no server code, no database. Hosting is just
serving static files, and each player's high scores live in their own browser.

You have two ways to get it onto your site. Path A is the simplest and most
reliable; Path B keeps everything on your own domain.

---

## Path A — Host on a free static host, then iframe it (recommended)

WordPress.com's Media Library won't accept raw `.js`/`.html` files, so host the
game on a static host and embed it. This scales to millions of loads for free.

### 1. Deploy the files

Pick one:

- **Cloudflare Pages** — create a project, choose "Direct Upload", and drag in
  `gagabrawl-embed.zip` (or the contents of `dist/`). You get a URL like
  `https://gagabrawl.pages.dev`.
- **Netlify** — go to app.netlify.com → "Add new site" → "Deploy manually" and
  drag the `dist/` folder (or the zip) onto the page. You get a URL like
  `https://gagabrawl.netlify.app`.
- **GitHub Pages** — push the contents of `dist/` to a repo and enable Pages.
  URL like `https://you.github.io/gagabrawl/`. (Note: GitHub Pages ignores the
  `_headers` file; caching still works via hashed names, just with GitHub's own
  short cache window.)

The included `_headers` file makes Cloudflare Pages / Netlify cache the hashed
assets for a year automatically.

### 2. Embed it on your WordPress.com page

Edit a page/post → add a **Custom HTML** block → paste this, and replace the
`src` URL with your deploy URL:

```html
<div style="max-width:700px;margin:0 auto;">
  <div style="position:relative;width:100%;aspect-ratio:1/1;">
    <iframe
      src="https://YOUR-DEPLOY-URL/index.html"
      style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px;"
      loading="lazy"
      allowfullscreen
      title="GaGa Brawl"></iframe>
  </div>
</div>
```

If the Custom HTML block strips the iframe (some security setups do), install the
free **"Advanced iFrame"** plugin (your Business plan allows plugins) and use its
shortcode instead — same URL.

---

## Path B — Host on your own WordPress.com domain via SFTP

This keeps the game on `yoursite.com`, which means high scores persist reliably
even in Safari (see the note below). Business plan includes SFTP access.

1. In your WordPress.com dashboard: **Settings → Hosting Configuration → SFTP/SSH**
   and copy your SFTP credentials.
2. Connect with an SFTP client (FileZilla, Cyberduck) and upload the **contents
   of `dist/`** into `/wp-content/uploads/gagabrawl/` so you end up with
   `/wp-content/uploads/gagabrawl/index.html`.
3. Confirm it loads at
   `https://yoursite.com/wp-content/uploads/gagabrawl/index.html`.
4. Use the same iframe snippet as Path A, with that URL as the `src`.

If step 3 doesn't serve the page (some configurations route `.html` through
WordPress), fall back to Path A.

---

## Why same-domain matters (the Safari note)

The game saves best scores in the browser's `localStorage`. When the game is
embedded from a **different** domain (Path A), Safari and some privacy modes
block that "third-party" storage, so those players' scores won't persist between
visits (the game still plays fine). Hosting on your **own** domain (Path B)
avoids this. If persistent high scores matter, prefer Path B.

## Updating the game later

Rebuild, and the changed files get new hashes automatically — just re-upload
`dist/`. Because `index.html` is set to revalidate, players pick up the new
version on their next visit without any cache-clearing.
