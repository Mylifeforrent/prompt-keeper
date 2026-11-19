import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// electron-rebuild records only the arch and ABI in this marker, not the
// platform. A marker left by a macOS build therefore makes a following Windows
// cross-build a silent no-op that packages the macOS native module.
rmSync(resolve('node_modules/better-sqlite3/build/Release/.forge-meta'), { force: true })
