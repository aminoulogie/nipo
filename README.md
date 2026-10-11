# Nipo

Nipo is an Apple Music-style iOS/PWA client for Navidrome with local Files import.

## Features

- Navidrome / Subsonic sign-in and server library
- Home, Radio, Search, Albums, Artists and Playlists
- Favorites and playlist management
- Full Now Playing UI, queue, shuffle, repeat, seeking and volume
- Keep server tracks offline for local playback
- Import MP3 and other common audio files from iOS Files
- Imported files are copied into Nipo's persistent local storage and appear under **Library → Downloaded**
- MP3 ID3 title, artist, album, track number and embedded artwork import
- Background audio and media controls
- GitHub Actions builds an unsigned IPA and publishes it to Releases

## Development

```bash
npm install
npm run serve
```

For the native iOS shell:

```bash
npm run sync:ios
```

The native build can receive a default Navidrome URL through `NIPO_SERVER`.
