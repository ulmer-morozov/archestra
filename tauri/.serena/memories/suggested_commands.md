# Development Commands

## Installation & Setup
```bash
pnpm install    # Install all dependencies
```

## Development
```bash
pnpm dev         # Run Vite development server (frontend only)
pnpm tauri dev   # Run Tauri dev mode (full desktop app)
```

## Building
```bash
pnpm build       # Build frontend (runs tsc && vite build)
pnpm tauri build # Build full Tauri application
```

## Other Commands
```bash
pnpm preview     # Preview production build
```

## System Utilities (Darwin/macOS)
- `git` - Version control (/usr/bin/git)
- `pnpm` - Package manager
- `node` - JavaScript runtime
- `ls`, `cd`, `grep`, `find` - Standard Unix commands
- Note: Cargo/Rust toolchain needs to be installed separately for Tauri development