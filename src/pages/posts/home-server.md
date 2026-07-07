---
layout: ../../layouts/PostLayout.astro
title: "Building my home server: from native chaos to a dockerized media empire"
pubDate: 2026-07-07
description: "A self-hosted media stack is less about the content it serves and more about the containerization, networking, and automation patterns you are forced to get right."
author: "João Brito"
---

There's a moment every tinkerer knows well. You're paying for three streaming services, still can't find what you want to watch, and you think: *"How hard can it be to just... host my own?"*

Spoiler: it's both easier and harder than you think. This is the full story, starting from running everything natively as bare binaries, hitting the walls that made me rethink everything, and ending with a fully containerized, self-maintaining media stack that mostly runs itself.

---

## Chapter 1: the native era (before Docker)

Before a single Docker container was ever pulled, the stack was running the old-fashioned way: binaries installed directly on the host, systemd services keeping them alive, configs scattered across the filesystem.

The evidence is still on disk. `/opt/Sonarr` is a full .NET runtime installation: `libcoreclr.so`, `libclrjit.so`, ASP.NET assemblies, `ffprobe`, roughly 430 files sitting directly on the filesystem:

```
/opt/Sonarr/
├── Sonarr              # The actual binary
├── Sonarr.Core.dll     # Core logic
├── ffprobe             # Media probe tool
├── libcoreclr.so       # .NET runtime
├── libclrjit.so        # JIT compiler
├── ServiceInstall      # systemd service installer
├── ServiceUninstall
└── ...430 more files
```

You'd install it like this:

```bash
# The classic "just run the binary" approach
cd /opt/Sonarr
sudo ./ServiceInstall   # registers a systemd service
sudo systemctl enable --now sonarr
```

Sonarr's config lived at `~/.config/Sonarr/`, the standard XDG path that native Linux apps use. Same story for Prowlarr at `~/.config/Prowlarr/`. Jellyfin was even installed as a Flatpak, sandboxed under:

```
/home/brito/.var/app/org.jellyfin.JellyfinServer/
├── data/
├── config/
└── cache/
```

On the surface, this works. Each service runs as a systemd unit, starts on boot, restarts on crash. For a while, it's fine.

### The pain points that broke the native setup

Then reality sets in.

**Dependency drift.** Each .NET app ships its own runtime. Sonarr bundles .NET 8, Radarr bundles a slightly different build, Bazarr runs on Python with its own virtualenv. There's no shared ground. Updating one sometimes breaks shared system libraries.

**Networking is manual.** Every service is on `localhost`. Sonarr connects to qBittorrent at `127.0.0.1:8081`. Radarr connects to Prowlarr at `127.0.0.1:9696`. If a port changes, you update every app that depends on it by hand, through each app's web UI.

**No isolation.** A misbehaving service can eat CPU or open file handles without bounds. There's no `--memory` limit, no cgroup constraints. One runaway process is everyone's problem.

**Reproducibility is zero.** "Works on my machine" is the entire deployment strategy. There's no way to describe the full setup in a file and rebuild it from scratch in 30 seconds.

The breaking point for me was a Sonarr update that required a newer glibc than what the system had. I could either upgrade the OS (risky), hold the package version forever (messy), or find a better way.

Docker was the better way.

---

## Chapter 2: the migration to Docker

Migrating to Docker is not just "put a container around it." The data is what matters: configs, databases, watch histories. Get that wrong and you're starting from scratch.

### The migration strategy: lift the config, not the binary

The key insight is that `*arr` apps store all their state in a SQLite database and a handful of config files. The binary is stateless. The `/config` directory holds everything.

For Sonarr and Prowlarr, the native configs were already sitting at `~/.config/Sonarr` and `~/.config/Prowlarr`. The Docker migration just pointed the container volumes at those exact same paths:

```yaml
# The Docker container reads the SAME config the native app wrote
sonarr:
  image: lscr.io/linuxserver/sonarr:latest
  volumes:
    - /home/brito/.config/Sonarr:/config:z  # same path as native
    - /mnt/Acer/jvtri/Videos/Pirataria/Series:/media/series:z
    - /mnt/Acer/jvtri/Videos/Pirataria/Downloads:/downloads:z

prowlarr:
  image: lscr.io/linuxserver/prowlarr:latest
  volumes:
    - /home/brito/.config/Prowlarr:/config:z  # same path as native
```

This meant zero data loss and zero reconfiguration. Sonarr Docker booted up, found its existing SQLite database, and picked up exactly where the native install left off: all series tracked, all history intact, all quality profiles preserved.

For Jellyfin, same story. The Flatpak stored data under `~/.var/app/org.jellyfin.JellyfinServer/`. The Docker container mounts those exact paths:

```yaml
jellyfin:
  volumes:
    - /home/brito/.var/app/org.jellyfin.JellyfinServer/data:/data:z
    - /home/brito/.var/app/org.jellyfin.JellyfinServer/config:/config:z
    - /home/brito/.var/app/org.jellyfin.JellyfinServer/cache:/cache:z
```

Watch history, user accounts, library scans: everything survived the migration.

### Stopping the native services

Once the Docker containers were validated and running, the native services had to be stopped and disabled to avoid port conflicts:

```bash
# Stop and disable native systemd services
sudo systemctl stop sonarr radarr prowlarr bazarr
sudo systemctl disable sonarr radarr prowlarr bazarr

# Stop the Flatpak Jellyfin
flatpak kill org.jellyfin.JellyfinServer

# Confirm ports are free before starting Docker
sudo ss -tlnp | grep -E '8096|8989|7878|9696'
```

The critical window: between stopping native services and starting Docker containers, the services are down. Do this during off-hours, not when someone is mid-episode on Jellyfin.

### The one thing that tripped me up: PUID/PGID

LinuxServer.io images run their internal processes as a specific user inside the container, mapped to a host UID/GID via environment variables:

```yaml
environment:
  - PUID=1000   # maps to your host user ID
  - PGID=1000   # maps to your host group ID
```

The native services ran as your actual user (UID 1000). Docker containers need to match this exactly. Otherwise the container tries to read config files it doesn't own and fails silently. Running `id` on the host confirms the right values:

```bash
$ id
uid=1000(brito) gid=1000(brito) groups=1000(brito),...
```

Set `PUID=1000` and `PGID=1000` everywhere, and volume permission errors disappear.

### What stayed native

Not everything moved to Docker. AdGuard Home runs with `network_mode: host`, which is really just Docker using the host network stack directly. It needs port 53 at the OS level, which pure bridge networking can't reliably provide.

The old `/opt/Sonarr` binary directory also still sits on disk, a fossil from the native era. It's inert with no systemd service pointing to it, but it's a useful reminder of where the setup started.

> The migration preserved 100% of app state by reusing the same config directories, which meant no re-scanning the library, no re-adding indexers, and no re-configuring quality profiles. Docker became a better wrapper around the same data.

---

## The stack at a glance

Here's everything running on the machine under `/opt/`:

| Service | Role | Port |
|---|---|---|
| **Jellyfin** | Media server (the Netflix alternative) | 8096 |
| **Radarr** | Movie manager & downloader | 7878 |
| **Sonarr** | TV show manager & downloader | 8989 |
| **Prowlarr** | Indexer aggregator for \*arr apps | 9696 |
| **Bazarr** | Subtitle manager | 6767 |
| **qBittorrent** | Download client | 8081 |
| **Jellyseerr** | Request portal (for the whole family) | 5055 |
| **Maintainerr** | Library cleanup & rules engine | 6246 |
| **Decluttarr** | Stale download remover (automation) | internal |
| **Profilarr** | Quality profile sync & management | 6869 |
| **AdGuard Home** | Network-wide DNS & ad blocking | 53/8080 |
| **Caddy** | Reverse proxy with local `.lan` domains | 80/443 |
| **Portainer** | Docker management UI | 9000 |

Everything runs inside Docker, orchestrated by a single `compose.yml` file.

---

## The architecture: one file to rule them all

The entire stack lives in `/opt/docker/compose.yml`. That single file is the source of truth for the whole server. Here's a representative slice:

```yaml
# =============================================================================
# Full *arr + Media Stack — Docker Compose
# =============================================================================
# Paths:
#   Filmes   : /mnt/Acer/jvtri/Videos/Pirataria/Filmes
#   Series   : /mnt/Acer/jvtri/Videos/Pirataria/Series
#   Downloads: /mnt/Acer/jvtri/Videos/Pirataria/Downloads

services:
  # MEDIA SERVER
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    restart: unless-stopped
    environment:
      - TZ=America/Sao_Paulo
    volumes:
      - /mnt/Acer/jvtri/Videos/Pirataria/Filmes:/media/filmes:ro,z
      - /mnt/Acer/jvtri/Videos/Pirataria/Series:/media/series:ro,z
    ports:
      - "8096:8096"
    networks: [arr-net]

  # DOWNLOAD CLIENT
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/Sao_Paulo
      - WEBUI_PORT=8081
    ports:
      - "8081:8081"
      - "58675:58675"     # Torrent port (TCP)
      - "58675:58675/udp" # Torrent port (UDP)
    networks: [arr-net]

networks:
  arr-net:
    driver: bridge
```

All services share a single internal bridge network called `arr-net`. This means Sonarr can talk to qBittorrent by container name, not by IP: no hardcoded addresses, no fragile config.

> Using a shared Docker network means every `*arr` service refers to others by name: `prowlarr:9696`, `jellyseerr:5055`, etc. Changing a port in one place propagates automatically.

---

## The *arr ecosystem

If you haven't heard of the `*arr` family of apps, here's the pipeline they form together:

```
Request (Jellyseerr)
    ↓
Search (Prowlarr, indexes torrent sites)
    ↓
Download (qBittorrent, actual torrent client)
    ↓
Organize (Radarr / Sonarr, rename, move, tag)
    ↓
Subtitle (Bazarr, auto-fetch subs)
    ↓
Stream (Jellyfin, serve to any device)
```

### Radarr & Sonarr

Radarr handles movies, Sonarr handles TV series. Both mount the same `/downloads` volume as qBittorrent, so they can immediately see finished downloads and hard-link them into the media library:

```yaml
radarr:
  image: lscr.io/linuxserver/radarr:latest
  volumes:
    - /home/brito/.config/Radarr:/config:z
    - /mnt/Acer/jvtri/Videos/Pirataria/Filmes:/media/filmes:z
    - /mnt/Acer/jvtri/Videos/Pirataria/Downloads:/downloads:z
```

Jellyfin mounts the same folder as read-only (`ro,z`), while Radarr and Sonarr mount it read-write so they can move files around. You don't want your media server accidentally mangling your files.

### Bazarr

Nobody talks about Bazarr enough. This service auto-fetches subtitles from providers like OpenSubtitles and Subscene, matching them to your exact video file. It's the difference between squinting at auto-generated captions and actually understanding what's happening in a foreign film.

```yaml
bazarr:
  image: lscr.io/linuxserver/bazarr:latest
  volumes:
    - /opt/bazarr/data:/config:z
    - /mnt/Acer/jvtri/Videos/Pirataria/Filmes:/media/filmes:z
    - /mnt/Acer/jvtri/Videos/Pirataria/Series:/media/series:z
```

---

## Caddy + AdGuard: the networking layer

Instead of typing `192.168.1.x:8096` to access Jellyfin, I type `homeflix.lan`. The combination of Caddy and AdGuard Home makes this work on every device on the network.

### Caddy: the reverse proxy

[Caddy](https://caddyserver.com/) is a modern web server with automatic HTTPS. For local use, it's a reverse proxy. The entire routing config fits in a single file:

```caddyfile
# /opt/caddy/Caddyfile

http://requester.lan {
    reverse_proxy jellyseerr:5055
}

http://homeflix.lan {
    reverse_proxy jellyfin:8096
}

http://radarr.lan {
    reverse_proxy radarr:7878
}

http://sonarr.lan {
    reverse_proxy sonarr:8989
}

http://prowlarr.lan {
    reverse_proxy prowlarr:9696
}

http://adguard.lan {
    reverse_proxy host.docker.internal:8080
}

http://qbittorrent.lan {
    reverse_proxy qbittorrent:8081
}
```

Seven lines per service. No Nginx config hell, no SSL certificate juggling.

Caddy runs inside Docker but AdGuard runs on the host with `network_mode: host` because DNS port 53 needs real host-level access. The `host.docker.internal:host-gateway` extra host entry bridges that gap:

```yaml
caddy:
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

### AdGuard Home: DNS + ad blocking

AdGuard Home runs as a DNS server for the entire local network. Every device uses the server's IP as its DNS, which means two things: ads are blocked at the DNS level for every device on the LAN (phones, TVs, smart speakers), and `homeflix.lan` resolves to the server's IP so the Caddy routes work everywhere.

Because AdGuard needs real port 53 access, it uses `network_mode: host`:

```yaml
adguardhome:
  image: adguard/adguardhome:latest
  network_mode: host   # Required for DNS port 53 to work properly
  volumes:
    - /opt/AdGuardHome:/opt/adguardhome/work:z
    - /opt/AdGuardHome/data:/opt/adguardhome/conf:z
```

> Setting up DNS rewrites in AdGuard (`*.lan` pointing to the server IP) combined with Caddy gives every device on the network clean local domain names, without editing hosts files per device.

---

## The automation layer: keeping things clean

Having a media server is useful. Having one that maintains itself is something else entirely. This is where Decluttarr, Maintainerr, and Profilarr come in.

### Decluttarr

Decluttarr monitors qBittorrent and the `*arr` apps for stale downloads: things stuck in "importing," failed torrents, orphaned files. It cleans up the queue automatically so it doesn't fill with junk.

What's interesting: Decluttarr's `/opt/decluttarr` directory is a full git repository, with a `pyproject.toml`, `ruff.toml`, and a local `venv`. This looks like a locally-cloned or forked version of the project, possibly for staying on a specific version or applying patches.

```
/opt/decluttarr/
├── main.py           # Entry point
├── src/              # Source code
├── config/           # Config files
├── .git/             # Version controlled
├── pyproject.toml    # Python project definition
└── venv/             # Python virtual environment
```

### Profilarr

Profilarr solves a real pain point: keeping quality profiles consistent across Radarr and Sonarr. If you've ever manually tweaked the same scoring rules in both apps, you know the frustration. Profilarr runs as two services, a SvelteKit frontend and a backend parser:

```yaml
profilarr:
  image: ghcr.io/dictionarry-hub/profilarr:develop
  environment:
    - PARSER_HOST=profilarr-parser
    - PARSER_PORT=5000
  depends_on:
    profilarr-parser:
      condition: service_healthy  # Waits for the parser to be ready
  ports:
    - "6869:6868"

profilarr-parser:
  image: ghcr.io/dictionarry-hub/profilarr-parser:develop
  expose:
    - "5000"   # Internal only, not mapped to host
```

Like Decluttarr, the Profilarr directory on disk is a full git clone with SvelteKit, Deno, Vite, and TypeScript tooling, which suggests active local development or customization.

### Maintainerr

Maintainerr handles library rules: delete movies not watched in 6 months, remove series that have been cancelled, and so on. It keeps the library from ballooning indefinitely.

> The combination of Decluttarr and Maintainerr means the server is largely self-maintaining. Downloads don't pile up, the library stays curated, and disk space is managed without manual intervention.

---

## The challenges: what actually went wrong

### Challenge 1: DNS bootstrapping (the chicken and egg problem)

The `.lan` domain setup is elegant once it's running. Getting there is not. The problem: to set AdGuard as your DNS server, you need to access AdGuard's UI. But you can't resolve `adguard.lan` until AdGuard is already your DNS.

The solution is to access AdGuard by raw IP first (`http://[server-ip]:8080`), configure the DNS rewrites, then flip your router to use the server as the primary DNS. Only after that do the `.lan` domains start working.

### Challenge 2: `network_mode: host` vs bridge networks

AdGuard runs with `network_mode: host` for DNS access. Caddy runs in the `arr-net` bridge network. Getting Caddy to proxy to AdGuard required the `host.docker.internal:host-gateway` bridge, which is a Linux-specific Docker feature and does not work on macOS the same way.

```yaml
caddy:
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

Without this, Caddy cannot reach AdGuard's port 8080 on the host. It's one of those "why isn't this working" moments that costs an hour of debugging.

### Challenge 3: file permissions with SELinux/`:z` labels

Notice the `:z` at the end of every volume mount:

```yaml
volumes:
  - /opt/bazarr/data:/config:z
```

That `:z` tells Docker, on SELinux systems like Fedora/RHEL, to relabel the volume with a shared SELinux context. Without it, containers might silently fail to read or write their config files. The error messages are cryptic. This one cost a few restarts before I figured it out.

### Challenge 4: Sonarr lives in two places

Sonarr is an interesting case. The `/opt/Sonarr` directory contains a full .NET binary installation packed with `System.*` DLLs, ASP.NET assemblies, and `ffprobe`. But the Docker stack uses the LinuxServer image and stores config at `/home/brito/.config/Sonarr`.

This dual installation is a fossil from the native era. The native install is inert now, but it's worth knowing it's there so you don't accidentally run two instances fighting over the same SQLite database.

---

## Jellyseerr: the public face

Of all the services, Jellyseerr is the one that non-technical users see. It's mapped to `requester.lan` and provides a clean UI for requesting new content. Someone in the household wants to watch a specific show? They search for it on `requester.lan`, hit "Request," and the pipeline kicks off automatically: Sonarr picks it up, Prowlarr finds a torrent, qBittorrent downloads it, and Jellyfin has it available within hours.

```yaml
jellyseerr:
  image: fallenbagel/jellyseerr:latest
  environment:
    - TZ=America/Sao_Paulo
    - PORT=5055
  volumes:
    - /opt/jellyseerr/config:/app/config:z
```

> Jellyseerr is what makes the whole setup actually usable for everyone in the household. The pipeline is automated, so from a user's perspective: search, click, watch.

---

## Portainer: because sometimes you just need a UI

When you have 13 containers running and want to quickly check logs for one specific service, a web UI is faster than the command line. Portainer provides that.

```yaml
portainer:
  image: portainer/portainer-ce:latest
  security_opt:
    - label:disable     # Needed on SELinux systems
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /opt/portainer/data:/data:z
  ports:
    - "9000:9000"
    - "9443:9443"   # HTTPS
```

The `security_opt: label:disable` is another SELinux nuance. By default, SELinux prevents containers from accessing `/var/run/docker.sock`. Disabling the label lets Portainer manage Docker as expected.

---

## The storage reality

Everything media-related lives on a mounted Acer drive:

```
/mnt/Acer/jvtri/Videos/Pirataria/
├── Filmes/      # Movies library
├── Series/      # TV shows library
└── Downloads/   # Active downloads (torrent staging area)
```

All service configs live on the SSD under `/opt/` (fast, reliable for config reads and writes), while the actual media files live on the external drive (slower, but capacity-oriented). This is a sensible split: SQLite databases and config files benefit from fast storage, while video files just need bulk capacity.

---

## What I'd do differently

After living with this setup, here's what I'd change:

1. **Version-pin Docker images.** Using `:latest` everywhere is convenient but can break things after an update. Pinning to a specific tag (e.g., `jellyfin/jellyfin:10.9.0`) gives you control over when you upgrade.

2. **Add Watchtower or a manual update script.** Since everything is `latest`, updates are ad-hoc. Watchtower can automate this, or a simple `docker compose pull && docker compose up -d` in a cron job would do.

3. **Consider Traefik instead of Caddy** if you eventually want automatic Let's Encrypt certs with external access. Caddy is simpler for pure local use, but Traefik integrates more deeply with Docker labels.

4. **Clean up the native Sonarr install.** Having both a native .NET install at `/opt/Sonarr` and a Docker container running is a footgun. Either go fully Docker or fully native, not both.

---

## Final thoughts

Thirteen services, all talking to each other, serving a fully automated media pipeline with network-wide DNS ad blocking and clean local domain names. It takes a few weekends to get right, but once it's running you mostly forget it's there.

The real lesson is not any single technology choice. It's that automation beats repetition. Every manual step you eliminate, whether renaming files, fetching subtitles, or cleaning up stale downloads, is time you get back. The server runs, the media flows, the ads are blocked, and the family is happy.
