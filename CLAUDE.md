# PUMP PLAYS REMASTER

## Architecture
- **Multi-game platform**: Config-driven game switching via `config/games/*.json`
- **Event-driven**: All components communicate via `src/core/EventBus.js`
- **Adapter pattern**: Emulators abstracted behind `src/emulator/adapters/BaseAdapter.js`
- **State machine voting**: VoteManager uses IDLE → COLLECTING → PROCESSING phases

## Key Conventions
- Single source of truth for commands: `config/systems/{system}.json`
- Command ID/ACK contract for emulator polling (no double-execution)
- Feature flags in `.env` for non-MVP features
- SQLite via `better-sqlite3` for persistent data (Phase 2+)
- Composite user keys for identity stability

## Ports
- 4000: API server
- 4001: Overlay (Socket.IO)
- 7777: ViGEm Python server (Phase 4, N64)

## Emulators
- BizHawk: GBA, GB, DS (Lua scripts in `scripts/bizhawk/`)
- Project64: N64 Stadium (ViGEm in `scripts/vigem/`)
- Dolphin: GameCube/Wii (Phase 7)

## Commands
- `npm run dev` - Start with nodemon
- `npm start` - Production start
