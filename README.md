# Drum Stream Assets

A comprehensive streaming setup for drum performances with real-time song requests, audio stem separation, and interactive overlays.

## Core Components

- **music-stem-server**: Handles song downloads and audio stem separation
- **electron-overlays**: Real-time stream overlays and viewer interactions
- **streamer.bot**: Stream automation and event handling
- **job-handlers**: Background task processing for stream events

## Quick Start

1. Ensure dependencies are installed:
   - Node.js
   - npm
   - Streamer.bot

2. Run `launch.bat` to start all services:
   - Streamer.bot
   - Music stem server
   - Electron overlays

## Features

- Song request system with priority queuing
- Real-time audio stem separation
- Channel point redemptions
- TTS integration
- Interactive overlays
- Automated stream management
- Bits and donation handling
- Custom chat commands

## Architecture

- Frontend: Electron-based overlays
- Backend: Node.js services
- Integration: Streamer.bot for Twitch events
- Storage: Local file system for processed audio

## Common Commands

- `!sr`: Request a song
- `!today`: View stream statistics
- `!help`: Display available commands
- `!rules`: Show stream rules
- `!shenanigans`: List available stream effects

## Security Note

API keys and sensitive credentials should be stored securely and never committed to the repository.
