# nipo

An installable web music player for a self-hosted [Navidrome](https://www.navidrome.org/) server,
with an Apple Music-style interface. Add it to an iPhone home screen and it runs fullscreen like a
native app, with lock-screen and Control Center transport controls.

## Why

Navidrome's built-in web UI and its bundled themes all share the same layout. This is a separate
front-end that talks to Navidrome over the standard Subsonic API, so the server is left untouched.

## Features

- Home, New, Radio, Library and Search with a sliding liquid-glass tab pill
- Library playlists include a live **Starred** list (`getStarred2`) — starring a song adds it there
- Create playlists and add songs from the ⋯ action sheet
- Album and playlist detail pages with Play and Shuffle
- Floating glass mini-player that expands into a full Now Playing sheet
- Background tint derived from the current track's artwork
- Queue view, shuffle, repeat, favourite (star), seek and volume
- iOS `MediaSession` integration: lock screen, Control Center, headphone buttons
- Installable as a PWA (standalone display, home-screen icon, safe-area aware)

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A running Navidrome server

No npm dependencies — the server uses only Node's standard library.

## Running

```bash
node server.js
```

Then open `http://localhost:4534` and sign in with your Navidrome username and password.

To install on iOS: open the same URL in Safari using the host machine's LAN address
(for example `http://192.168.1.20:4534`), then **Share → Add to Home Screen**.

### Configuration

Edit the constants at the top of `server.js`:

| Constant          | Default     | Purpose                                  |
| ----------------- | ----------- | ---------------------------------------- |
| `NAVIDROME_HOST`  | `127.0.0.1` | Host running Navidrome                   |
| `NAVIDROME_PORT`  | `4533`      | Navidrome's port                         |
| `LISTEN_PORT`     | `4534`      | Port this app listens on                 |

## How it works

`server.js` does two things: it serves the static files in `public/`, and it reverse-proxies every
`/rest/*` request through to Navidrome. Because the browser only ever talks to a single origin,
there is no CORS configuration to do, and audio streaming keeps working because `Range` headers are
passed through untouched.

Authentication uses the standard Subsonic token scheme — the client sends
`token = md5(password + salt)` rather than the password itself. Credentials are held only in the
browser's own `localStorage`.

## Regenerating the app icons

```bash
node generate-icons.js
```

Writes `public/icons/icon-192.png` and `icon-512.png`. It encodes the PNGs using only Node's
built-in `zlib`, so there is no image library to install.

## Layout

```
server.js           static file server + Subsonic reverse proxy
generate-icons.js   PWA icon generator
public/
  index.html        app shell
  app.js            API client, player, views, navigation
  styles.css        theme and layout
  md5.js            MD5, for Subsonic token auth
  manifest.webmanifest
```

## Licence

MIT
