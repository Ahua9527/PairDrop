# CLAUDE.md


请务必使用中文回复
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PairDrop is a web-based peer-to-peer file sharing application inspired by Apple's AirDrop. It enables local and internet file transfers through WebRTC with a Node.js backend and vanilla HTML5/JS/CSS frontend. Key features include device pairing, public rooms for internet transfers, and PWA functionality.

## Common Development Commands

### Starting the Server
```bash
# Development server
npm start

# Production server with rate limiting and auto-restart
npm run start:prod

# Docker deployment
docker run -d --restart=unless-stopped --name=pairdrop -p 127.0.0.1:3000:3000 ghcr.io/schlagmichdoch/pairdrop
```

### Environment Configuration
PairDrop uses environment variables for configuration. Key variables include:
- `PORT` (default: 3000)
- `DEBUG_MODE` - enables debug logging
- `RATE_LIMIT` - requests per IP per 5-minute window
- `RTC_CONFIG` - path to STUN/TURN server config file
- `SIGNALING_SERVER` - external signaling server URL
- `WS_FALLBACK` - enables WebSocket fallback
- `IPV6_LOCALIZE` - IPv6 address localization (1-7 segments)

### Command Line Flags
- `--rate-limit` - enable rate limiting (5 requests per window)
- `--auto-restart` - restart on uncaught exceptions
- `--localhost-only` - bind to localhost only
- `--include-ws-fallback` - include WebSocket fallback

## Architecture

### Backend Structure (`server/`)
- `index.js` - Main entry point with configuration parsing and server initialization
- `server.js` - Express HTTP server serving static files and configuration endpoints
- `ws-server.js` - WebSocket signaling server for peer discovery and connection
- `peer.js` - Peer connection management and room handling
- `helper.js` - Utility functions for IP handling and device identification

### Frontend Structure (`public/`)
- `index.html` - Main application entry point
- `scripts/main.js` - Core application class with initialization logic
- `scripts/network.js` - WebRTC peer-to-peer connection management
- `scripts/ui.js` - User interface components and event handling
- `scripts/util.js` - Utility functions and helpers
- `scripts/localization.js` - Internationalization support
- `scripts/persistent-storage.js` - IndexedDB storage for device pairing
- `service-worker.js` - PWA service worker for offline functionality

### Key Components
1. **Peer Discovery**: Uses WebSocket signaling server for initial peer discovery
2. **WebRTC Connections**: Direct peer-to-peer file transfers via WebRTC data channels
3. **Device Pairing**: Persistent device relationships stored in IndexedDB
4. **Public Rooms**: Temporary connections via 5-letter room codes
5. **File Handling**: Support for multiple files with ZIP compression

### Configuration Files
- `rtc_config_example.json` - Example STUN/TURN server configuration
- `turnserver_example.conf` - Example coturn server configuration
- `docker-compose.yml` - Main Docker Compose configuration
- `docker-compose-coturn.yml` - Docker Compose with coturn TURN server

## Development Notes

### No Build Process
PairDrop uses vanilla JavaScript with ES6 modules - no build step or bundling required. The application loads scripts dynamically and uses deferred loading for non-critical resources.

### WebRTC Requirements
- STUN server required for NAT traversal (defaults to Google's public STUN server)
- TURN server required for internet transfers between different networks
- See `docs/host-your-own.md` for TURN server setup instructions

### Client-Server Communication
1. HTTP serves static files and configuration via `/config` endpoint
2. WebSocket signaling server handles peer discovery and room management
3. WebRTC data channels handle actual file transfers

### File Transfer Flow
1. Sender selects files and target device
2. WebRTC connection established via signaling server
3. Files transferred via data channels with progress tracking
4. Multiple files automatically zipped for download

### Internationalization
Language files in `public/lang/` with dynamic loading based on browser locale. Translations managed via Hosted Weblate.