# PUMP PLAYS REMASTER — Feature Comparison

Old (PUMPPLAYSDS) vs New (PUMPPLAYSREMASTER)

---

## Core Systems

| Feature | Old (DS) | Remaster |
|---------|----------|----------|
| Chat Integration | Puppeteer scraper + WebSocket fallback | pump-chat-client WebSocket (native) |
| Emulator Control | BizHawk DS bridge | Multi-emulator adapters (BizHawk, Project64, Dolphin) |
| Overlay/Streaming | Socket.IO overlay (port 60001) | Socket.IO overlay (configurable port) |
| Database | JSON files (manual sync every 60s) | SQLite (better-sqlite3, WAL mode, indexed) |
| Architecture | Flat monolith, direct method calls | GameEngine orchestrator + EventBus pub/sub |
| Game Support | Single game (DS) | Multi-game config (`config/games/*.json`) |
| Error Handling | Basic try/catch | `emitSafe()` pattern + graceful degradation |
| Feature Flags | None | `ENABLE_*` env vars per feature |

---

## Economy

| Feature | Old (DS) | Remaster |
|---------|----------|----------|
| Wallet Registration | `!wallet <address>` → JSON file | `!wallet <address>` → SQLite wallets table |
| Wallet Locking | Lock after first registration | Same, with `locked` + `verified` columns |
| Reward Calculation | Hourly leaderboard tiers (20M pool / 6 months) | Hourly leaderboard tiers (configurable pool + days) |
| On-Chain Distribution | `@solana/spl-token` transfers | Same — ported with simulation fallback |
| Simulation Mode | Manual test mode flag | Auto-detect: no `SPL_TOKEN_MINT` = simulation |
| Wallet Backfill | N/A (JSON, no schema) | SQL UPDATE fills wallet on old rewards |
| Burn Verification | Not implemented | On-chain tx parsing (`verifyBurnTx`) |
| Balance Gate | Not implemented | Token balance → vote weight + free commands |

### Reward Tiers (Same in Both)

| Rank | Share |
|------|-------|
| 1st | 40% |
| 2nd | 25% |
| 3rd | 15% |
| 4th-10th | 15% (split evenly) |
| 11th+ | 5% (split among participants) |

---

## Chat Integration

| Feature | Old (DS) | Remaster |
|---------|----------|----------|
| Transport | Puppeteer browser automation → `wss://livechat.pump.fun` fallback | `pump-chat-client` WebSocket (npm package) |
| Command Parsing | Inline regex in chat handler | Centralized `CommandParser` module |
| Special Commands | `!wallet`, `!address`, `!rewards`, `!balance` | Same + game-specific extensions |
| Source Tracking | None | Tagged per message (`pumpfun_ws`, `api`) |
| Weighted Voting | None | Configurable user vote weight |

---

## Voting System

| Feature | Old (DS) | Remaster |
|---------|----------|----------|
| Vote Windows | 3s fixed | Configurable per game via JSON |
| Minimum Votes | 1 | Configurable |
| Vote Replacement | No | Yes (change vote mid-window) |
| First Voter Tracking | No | Yes |
| Team Voting | No | Yes (multiplayer split) |
| Command ID/ACK | No | Yes (BizHawk polling contract) |
| Vote History | In-memory only | SQLite persistence |

---

## Game Features

| Feature | Old (DS) | Remaster |
|---------|----------|----------|
| Game Switching | Manual via API | Dynamic `/api/game/switch` + scheduler |
| Game State Reader | None | RAM-based event detection |
| Combo Tracker | None | 8 combo sequences with PPP multipliers |
| Nuzlocke Mode | None | Permadeath tracking + 2x PPP |
| Hall of Fame | None | E4 completion records + stats |
| Auto Highlights | None | Priority-based event detection |
| Prediction Market | None | Bet PPP on game outcomes |
| Bounty Board | None | Community-funded challenges |
| Game Scheduler | None | Cron-based automatic game rotation |

### Combo Sequences (New)

| Combo | Sequence | Multiplier |
|-------|----------|------------|
| Hadouken | down, down-right, right | 3x |
| Shoryuken | right, down, down-right | 3x |
| Triple Tap | A, A, A | 2x |
| Dash Left/Right | left/right x3 | 2x |
| Menu Master | start, up, A | 2x |
| B Cancel | B, B, B | 2x |
| Konami Code | up, up, down, down, left, right, left, right, B, A | 10x |

### Burn Tiers — Team Rocket (New)

| Tier | Burn Amount | Direct Commands/Hour |
|------|------------|---------------------|
| Grunt | 10,000 PPP | 1 |
| Executive | 50,000 PPP | 3 |
| Boss | 250,000 PPP | 10 |

### Balance Gate — Champions DAO (New)

| Tier | Token Balance | Free Commands/Hour | Vote Weight |
|------|-------------|-------------------|-------------|
| Champion | 1M PPP | 1 | 2x |
| Elite Champion | 5M PPP | 3 | 3x |
| Legendary | 25M PPP | Unlimited | 5x |

---

## Infrastructure

### Database Schema (New — SQLite)

| Table | Purpose |
|-------|---------|
| `users` | User profiles, stats, wallet addresses |
| `commands` | Command history with game_id, vote_count, winner flag |
| `achievements` | Per-user, per-game achievement tracking |
| `hourly_stats` | Aggregated hourly stats |
| `wallets` | Solana wallet registrations |
| `pending_rewards` | Reward queue with distributed/tx_signature tracking |
| `predictions` | Prediction market definitions |
| `prediction_bets` | Individual bets |
| `bounties` | Challenge definitions |
| `bounty_contributions` | Bounty funding pool |
| `hall_of_fame` | Game completion records |

### API Endpoints

| Category | Old (DS) | Remaster |
|----------|----------|----------|
| Status | `/status` | `/`, `/api/status` |
| Leaderboard | `/leaderboard/:type` | `/api/leaderboard`, `/api/leaderboard/hourly`, `/api/leaderboard/overview` |
| User Stats | `/stats/user/:username` | `/api/user/:userKey` |
| Commands | `/history` | `/api/commands`, `/api/command` (POST) |
| Votes | None | `/api/votes`, `/api/votes/history` |
| Emulator | None | `/api/emulator/pending`, `/api/emulator/ack`, `/api/emulator/state` |
| Games | None | `/api/games`, `/api/game/switch` |
| Wallet | `/wallet/*` | `/api/wallet/register`, `/api/wallet/:userKey`, `/api/wallet/lock` |
| Rewards | `/rewards/*` | `/api/rewards/pending/:userKey`, `/api/rewards/distribute`, `/api/rewards/distribute-onchain` |
| Team Rocket | None | `/api/team-rocket/tiers`, `/api/team-rocket/status/:userKey`, `/api/team-rocket/burn`, `/api/team-rocket/inject` |
| Combos | None | `/api/combos`, `/api/combos/stats` |
| Hall of Fame | None | `/api/halloffame`, `/api/halloffame/record` |
| Nuzlocke | None | `/api/nuzlocke`, `/api/nuzlocke/toggle` |
| Highlights | None | `/api/highlights` |
| Predictions | None | `/api/predictions`, `/api/predictions/:id/bet`, `/api/predictions/:id/resolve` |
| Bounties | None | `/api/bounties`, `/api/bounties/create`, `/api/bounties/:id/contribute`, `/api/bounties/:id/claim` |
| Schedule | None | `/api/schedule`, `/api/schedule/force` |
| Game State | None | `/api/gamestate` |
| Reports | `/reports/*` | Stats via leaderboard endpoints |

### Event Bus Events (New)

| Event | Trigger |
|-------|---------|
| `chat:message` | New chat message with parsed command |
| `chat:wallet` | Wallet registration request |
| `vote:update` | Vote tallies changed |
| `vote:execute` | Winning command sent to emulator |
| `game:badge_earned` | RAM: badge flag set |
| `game:pokemon_fainted` | RAM: party HP = 0 |
| `game:whiteout` | RAM: all fainted |
| `game:location_changed` | RAM: map ID changed |
| `combo:landed` | Combo sequence completed |
| `nuzlocke:death` | Pokemon died in nuzlocke |
| `nuzlocke:activated` | Nuzlocke mode toggled |
| `halloffame:entry` | E4 completed |
| `schedule:changed` | Game auto-switched |
| `rewards:distributed` | Hourly rewards calculated |
| `rewards:onchain_distributed` | On-chain tokens sent |

---

## Helper Scripts

| Script | Purpose |
|--------|---------|
| `scripts/setup-live-wallet.js` | Generate distributor wallet or check config |
| `scripts/convert-wallet.js` | Convert BIP39 seed phrase to Solana keypair |

---

## What's New in Remaster (Not in Old)

1. SQLite database with proper schema and indexes
2. Multi-emulator adapter pattern (BizHawk, Project64, Dolphin)
3. RAM-based game state reading (badges, HP, location)
4. System-wide EventBus (pub/sub)
5. Centralized ConfigManager + feature flags
6. Team voting for multiplayer games
7. Token burn → direct command injection (Team Rocket)
8. Token balance → vote weight + free commands (Champions DAO)
9. Combo tracker with PPP multipliers
10. Nuzlocke mode with permadeath tracking
11. Hall of Fame game completion records
12. Auto highlight detection for streaming
13. Prediction market (bet on game outcomes)
14. Bounty board (community challenges)
15. Game scheduler (cron-based rotation)
16. Achievements system
17. Command ID/ACK contract for emulator sync
18. Modern WebSocket chat client (no Puppeteer)
19. Wallet backfill (register wallet retroactively, earn past rewards)
20. On-chain burn verification (parse Solana tx)
