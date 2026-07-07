---
layout: ../../layouts/PostLayout.astro
title: "Building my home server: from native chaos to a dockerized media empire"
pubDate: 2026-07-07
description: "A self-hosted media stack is less about the content it serves and more about the containerization, networking, and automation patterns you are forced to get right."
author: "João Brito"
---

There's a moment every tinkerer knows well. You're paying for three streaming services, still can't find what you want to watch, and you think: *"How hard can it be to just... host my own?"*

Spoiler: it's both easier and harder than you think. This is the story of starting from bare binaries on a Linux host, hitting the walls that made me rethink everything, and landing on a fully containerized media stack that mostly runs itself.


## The native era

Before a single container was pulled, everything ran the old-fashioned way: binaries installed directly on the host, systemd services keeping them alive, configs scattered across the filesystem.

Sonarr lived at `/opt/Sonarr` as a full .NET runtime installation, roughly 430 files including `libcoreclr.so`, `libclrjit.so`, and a bundled `ffprobe`. Prowlarr sat at `~/.config/Prowlarr`. Jellyfin was installed as a Flatpak, sandboxed in its own app directory. Each service ran as a systemd unit and restarted on crash. For a while, this is fine.

Then reality sets in.

**Dependency drift.** Each .NET app ships its own runtime. Sonarr bundles .NET 8, Radarr bundles a slightly different build, Bazarr runs on Python with its own virtualenv. Updating one sometimes breaks shared system libraries underneath.

**Manual networking.** Every service is on `localhost`. Sonarr finds qBittorrent at `127.0.0.1:8081`. If a port changes, you update every dependent app by hand, through each app's web UI.

**No isolation.** A runaway process can eat CPU or exhaust file handles with no bounds. There's no `--memory` limit, no cgroup constraints.

**Zero reproducibility.** There's no way to describe the full setup in a file and rebuild it from scratch. "Works on my machine" is the entire deployment strategy.

The breaking point was a Sonarr update that required a newer glibc than the system had. I could upgrade the OS, freeze the package forever, or find a better way. Docker was the better way.


## The migration

The `*arr` family stores all their state in a SQLite database and a handful of config files. The binary is stateless. This means migrating to Docker is mostly a matter of pointing the container volumes at the same config directories the native apps were already using. Sonarr Docker boots up, finds the existing database, and picks up where the native install left off: all series tracked, all history intact, all quality profiles preserved. No re-scanning, no reconfiguring.

The one thing that trips people up with LinuxServer.io images is `PUID`/`PGID`. These images run their internal processes as a specific user and map it to a host UID via environment variables. The native services ran as your actual user. The containers need to match exactly, otherwise they silently fail to read the config files they don't own. Running `id` on the host gives you the right values, and setting them consistently everywhere makes permission errors disappear.


## The stack at a glance

Thirteen services, all wired together through a single `compose.yml`:

| Service | Role |
|---|---|
| **Jellyfin** | Media server |
| **Radarr / Sonarr** | Movie & TV manager |
| **Prowlarr** | Indexer aggregator |
| **Bazarr** | Subtitle auto-fetch |
| **qBittorrent** | Download client |
| **Jellyseerr** | Request portal |
| **Maintainerr** | Library cleanup rules |
| **Decluttarr** | Stale download remover |
| **Profilarr** | Quality profile sync |
| **AdGuard Home** | Network-wide DNS + ad blocking |
| **Caddy** | Reverse proxy with `.lan` domains |
| **Portainer** | Docker management UI |

All services share a single internal bridge network called `arr-net`. This means Sonarr talks to qBittorrent by container name, not IP. Changing a port in one place propagates automatically.

The full pipeline looks like this:

```
Request (Jellyseerr)
    ↓
Search (Prowlarr, indexes torrent sites)
    ↓
Download (qBittorrent)
    ↓
Organize (Radarr / Sonarr, rename + move)
    ↓
Subtitle (Bazarr)
    ↓
Stream (Jellyfin)
```


## Caddy + AdGuard: the networking layer

The cleanest part of the whole stack. Instead of typing a raw IP and port to reach Jellyfin, I type `homeflix.lan`. Caddy handles the routing, AdGuard handles the DNS.

Caddy runs as a reverse proxy inside Docker. The entire routing config is a single file:

```caddyfile
http://homeflix.lan    { reverse_proxy jellyfin:8096 }
http://requester.lan   { reverse_proxy jellyseerr:5055 }
http://sonarr.lan      { reverse_proxy sonarr:8989 }
http://radarr.lan      { reverse_proxy radarr:7878 }
http://prowlarr.lan    { reverse_proxy prowlarr:9696 }
http://qbittorrent.lan { reverse_proxy qbittorrent:8081 }
```

AdGuard Home runs as a DNS server for the entire local network. Every device on the LAN uses the server as its DNS resolver, which means ads are blocked at the DNS level for every device (phones, TVs, smart speakers), and the `.lan` domains resolve to the server's IP so the Caddy routes work on every device automatically.


## The automation layer

The stack is largely self-maintaining. Three services handle the cleanup work:

**Decluttarr** monitors qBittorrent and the `*arr` apps for stale downloads: things stuck in "importing," failed torrents, orphaned files. It clears the queue automatically.

**Maintainerr** handles library rules: delete movies not watched in six months, remove cancelled series, keep disk space in check.

**Profilarr** keeps quality profiles consistent between Radarr and Sonarr. If you've ever manually synced the same scoring rules in both apps, you understand why this service exists. It runs as two containers, a SvelteKit frontend and a backend parser, with a `service_healthy` dependency condition so the frontend waits for the parser to be ready before starting.


## The challenges

### DNS bootstrapping: the chicken and egg problem

To set AdGuard as your DNS server, you need to access AdGuard's UI. But you can't resolve `adguard.lan` until AdGuard is already your DNS. The fix: access AdGuard by raw IP first, configure the DNS rewrites, then flip your router to use the server as the primary resolver. Only after that do the `.lan` domains start working everywhere.

### `network_mode: host` vs bridge networks

AdGuard runs with `network_mode: host` because DNS port 53 needs real host-level access. Caddy runs inside the `arr-net` bridge network. Getting Caddy to proxy to AdGuard required an `extra_hosts` entry that maps `host.docker.internal` to the host gateway IP, which is a Linux-specific Docker feature. Without it, Caddy simply cannot reach AdGuard's management port, and the error gives you nothing useful to work with.

### File permissions and SELinux

On Fedora/RHEL systems, every volume mount needs a `:z` label:

```yaml
volumes:
  - /your/config/path:/config:z
```

That `:z` tells Docker to relabel the volume with a shared SELinux context. Without it, containers silently fail to read or write their config files. The error messages are cryptic enough that this one cost several restarts to diagnose.

### The ghost installation problem

After migrating from native to Docker, the native binary directory is still sitting on disk. It's inert, with no systemd service pointing to it. But it's a footgun: if you accidentally start the native service, it fights the Docker container for the same SQLite database. The fix is obvious but easy to forget: remove or explicitly disable the native install once the Docker container is stable.


## What I'd do differently

1. **Version-pin images.** Using `:latest` everywhere means an update can break things without warning. Pinning to a specific tag gives you control over when you upgrade.

2. **Add an update script.** Since everything is `latest`, updates are ad-hoc right now. A simple `docker compose pull && docker compose up -d` in a weekly cron job would handle it cleanly.

3. **Consider Traefik** if you eventually want external access with real TLS certs. Caddy is simpler for a pure local setup, but Traefik integrates more naturally with Docker labels for dynamic routing.


## Final thoughts

The real lesson is not any single technology choice. It's that automation beats repetition. Every manual step you eliminate, renaming files, fetching subtitles, cleaning up stale downloads, is time you get back. The server runs, the media flows, the ads are blocked, and the family is happy.
