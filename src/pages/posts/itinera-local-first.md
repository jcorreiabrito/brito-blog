---
layout: ../../layouts/PostLayout.astro
title: "Building Itinera: The Reality of Going Local First"
pubDate: 2026-07-07
description: "Offline-first application architecture is less about database choice and more about designing for conflict, security origin inheritance, and silent authentication proxying."
author: "João Brito"
---

You are sitting in an airport terminal, your phone displays a single bar of unstable connection, and you are trying to retrieve your boarding pass or check your lodging address. The spinner rotates endlessly. In that moment, you realize that the modern software engineering consensus, which relies on continuous connectivity and external cloud services to render simple text, is a systemic design failure. We have traded basic reliability for developer convenience.

This friction led me to build Itinera, a self-hosted, offline-first trip planner. But moving away from the standard client-server request-response lifecycle to a local-first model is not a simple swap of libraries. It exposes fundamental architectural questions about data replication, browser security boundaries, and conflict resolution that most application developers never have to consider.


## The Stack

Itinera runs as a Docker Compose stack with three containers wired through a private virtual network.

The frontend is a **SvelteKit** static SPA built with `@sveltejs/adapter-static` in SPA mode. It is installable as a PWA, with a service worker precaching the app shell and fonts for full offline navigation. Styling uses **Tailwind CSS** with a custom design system: Fraunces for headings, Inter for body text, and a forest green primary accent. The data layer is **PouchDB** sitting on top of **IndexedDB**, which is the piece that makes offline writes actually work.

The server side is intentionally lean. **CouchDB** is the source of truth. A **FastAPI** (Python 3.12) companion service handles background work that the browser cannot do: scheduled JSON exports, printable trip PDFs via Jinja2 templates, database compaction, and the Docker health probe that Compose uses to gate startup order. It does not handle any trip CRUD. All of that goes directly through PouchDB-to-CouchDB replication.

In front of everything sits **Caddy**, acting as the unified edge: static file serving, reverse proxy for `/api/*` traffic to FastAPI, and the authentication injection point for `/db/*` replication traffic. TLS is automatic via Let's Encrypt.


## The Sync Illusion

Many developers mistake offline compatibility for an aggressive caching policy. They build standard applications and wrap them in service workers or local storage caches. This is a half-measure that breaks the moment a user attempts to write data without a network path.

A true local-first application requires a complete paradigm shift. The local device must host the database of record. In Itinera, PouchDB handles all reads and writes in the browser. The network is relegated to an asynchronous background concern.

The real challenge begins when syncing this local store with a remote CouchDB instance. Hardcoding target URLs creates brittle deployments. Instead, the sync engine derives the remote database target at runtime:

```ts
function resolveRemoteUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || typeof window === 'undefined') {
    return url;
  }
  return `${window.location.origin}${url}`;
}
```

This is one of those small decisions that saves enormous pain later. Because the remote URL resolves from `window.location.origin`, the same build works identically on `localhost:5173`, a Tailscale IP, a home server on the LAN, or a public domain. No rebuild, no environment-specific config. The replication feed runs with `{ live: true, retry: true }`, so reconnection after a network drop is completely automatic.


## The Silent Authentication Gate

Connecting a browser database directly to a remote replication source introduces a critical credential management problem. Shipping administrator keys to a client-side bundle is a fatal security flaw.

Caddy solves this with a single proxy block. It intercepts every request on the `/db/*` path, injects the CouchDB basic auth header from an environment variable, and forwards the request to CouchDB on the private Docker network. The browser client never sees credentials. The `createRemoteDb` call in PouchDB uses `skip_setup: true` to prevent the client from trying to create the database:

```ts
export function createRemoteDb(): Database {
  return new impl(resolveRemoteUrl(remoteUrl), { skip_setup: true });
}
```

The failure mode worth knowing: if Caddy's upstream URL or credentials drift out of sync with what CouchDB expects, replication fails silently from the client's perspective. The sync status store surfaces this as an `error` state, but detecting *why* it failed requires checking the FastAPI health endpoint, which has a direct line to CouchDB and fails loudly when it cannot reach it.


## The ULID ID Scheme: Range Scans Without Indexes

One of the bigger wins in this project was the document ID design. Every document carries a meaningful, prefix-sortable ID:

- `trip:{ulid}` for trips
- `exp:{tripUlid}:{ulid}` for expenses
- `flt:{tripUlid}:{ulid}` for flights
- `day:{tripUlid}:{date}` for annotated itinerary days

Because ULIDs are monotonically increasing by creation time, all child documents for a trip sort together in CouchDB's B-tree. Fetching every expense for a trip does not need a Mango index. It needs a range scan:

```ts
export function tripTypeRange(type: DocType, trip: string): KeyRange {
  return prefixRange(`${PREFIX_BY_TYPE[type]}:${bareTripUid(trip)}:`);
}

function prefixRange(prefix: string): KeyRange {
  return { startkey: prefix, endkey: prefix + HIGH_KEY };
}
```

Where `HIGH_KEY` is `\ufff0`, the Unicode high surrogate that sorts after any normal character. This pattern fetches an entire category of documents for a trip in a single `allDocs` call with no secondary index. It also keeps the same ID scheme on both the client (PouchDB) and the server (FastAPI/CouchDB), so neither side needs ID translation logic.


## Origin Safety and Executable Attachments

Handling travel documents, like flight PDFs and hotel reservations, introduces a security concern specific to local-first browser applications. When displaying an attachment offline, the app retrieves the binary blob from IndexedDB and creates an object URL.

The vulnerability is in origin inheritance. A blob object URL inherits the origin of the page that created it. If a user uploads an SVG or HTML file as a boarding pass, rendering it inline allows any embedded script to execute within the application origin. Because that origin has proxy-level write access to the database, a malicious attachment could read, modify, or delete all trip data.

The mitigation is a strict MIME allowlist at the data layer. Only inert raster images and PDFs render inline. Everything else gets remapped to `application/octet-stream`, which forces a download:

```ts
const INLINE_RENDERABLE = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'
]);

export function safeViewMime(mime: string): string {
  return INLINE_RENDERABLE.has(mime) ? mime : 'application/octet-stream';
}
```

The stored bytes and the original MIME are never modified. Only the view type changes. This means the data is always recoverable, and the security boundary is enforced purely at render time.


## The Conflict Reality

In a distributed environment where multiple clients write to local databases without coordination, write conflicts are a certainty. A user editing a packing list on a phone while offline, while simultaneously modifying the same list on a laptop, creates divergent document states.

CouchDB handles conflicts by preserving all versions in a branched revision tree. It does not choose a winner; it keeps both paths alive. If left unresolved, these branches accumulate, bloating the local database and degrading replication performance.

Itinera implements last-write-wins based on `updatedAt` timestamps. The comparison is deterministic:

```ts
export function compareRevisions(a: RevEntry, b: RevEntry): number {
  const ua = a.updatedAt ?? '';
  const ub = b.updatedAt ?? '';
  if (ua !== ub) return ua > ub ? 1 : -1;
  // On a genuine tie, the higher revision hash wins.
  const ha = revHash(a._rev);
  const hb = revHash(b._rev);
  if (ha === hb) return 0;
  return ha > hb ? 1 : -1;
}
```

After picking the winner, the losing revision's content is snapshotted into a device-local `_local/` document before its conflict branch is deleted from the live revision tree. The `_local/` document type does not replicate, which means the audit log stays on the device that resolved the conflict without polluting the shared data set.

Clearing the branch is the part most implementations skip. Without it, CouchDB continues reporting the document as conflicted, triggering the resolution logic again on every sync. The delete is what breaks the cycle.


## What We Actually Own

Designing a system this way is significantly harder than building a standard client-server app. It forces you to write custom synchronization logic, manage distributed state, and handle security concerns that cloud providers normally abstract away.

But the reward is absolute reliability. Your application is not subject to the uptime of a third-party cloud provider, the latency of a mobile network, or the sudden deprecation of an external service. The data remains on your hardware, and the application runs entirely on your local machine. Going local first changes the browser from a simple terminal for remote servers back into what it was meant to be: a powerful, autonomous computing platform.
