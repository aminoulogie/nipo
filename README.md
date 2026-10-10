# Nipo

Nipo is an offline-first iOS music player built with Capacitor.

## What it does

- Imports MP3 and other common audio files from the iOS Files picker
- Copies imported tracks into the app's persistent local storage
- Plays without Navidrome, a LAN server, or an internet connection
- Reads common ID3 title, artist, album, track number, and embedded artwork metadata
- Provides Songs, Albums, Artists, search, shuffle, repeat, queue, favorites, and background playback
- Detects duplicate imports using a local fingerprint
- Lets you remove tracks from the device

## Development

```bash
npm install
npm run serve
```

For the iOS shell:

```bash
npm run sync:ios
```

The GitHub Actions workflow builds an unsigned IPA. The application itself has no server dependency.
