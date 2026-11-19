const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const NATIVE_MODULE =
  'app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'

function nativeModulePath(context) {
  if (context.electronPlatformName === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      NATIVE_MODULE,
    )
  }
  return join(context.appOutDir, 'resources', NATIVE_MODULE)
}

function assertNativePlatform(file, platform) {
  const header = readFileSync(file).subarray(0, 4)
  const magic = header.readUInt32BE(0)
  const matches = {
    darwin: magic === 0xfeedface || magic === 0xcefaedfe || magic === 0xfeedfacf || magic === 0xcffaedfe,
    win32: header[0] === 0x4d && header[1] === 0x5a,
    linux: header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46,
  }

  // electron-rebuild can report success while leaving a native module from the
  // previously packaged platform in place, which produces a silently broken app.
  if (!matches[platform]) {
    throw new Error(`Packaged native module does not match ${platform}: ${file}`)
  }
}

// Ad-hoc sign the packed macOS bundle. Apple Silicon refuses to launch unsigned
// apps, and electron-builder skips signing when no Developer ID is installed.
module.exports = async function afterPack(context) {
  assertNativePlatform(nativeModulePath(context), context.electronPlatformName)

  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
