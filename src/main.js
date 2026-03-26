const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { exiftool } = require('exiftool-vendored')
const { execFile } = require('child_process')
const os = require('os')

let mainWindow
let thumbCacheDir

// Get ffmpeg path — try multiple approaches
function getFfmpegPath() {
  // 1. Try ffmpeg-static module
  try {
    const p = require('ffmpeg-static')
    if (p && fs.existsSync(p)) return p
    // In asar builds, the path needs to be unpacked
    const unpacked = p.replace('app.asar', 'app.asar.unpacked')
    if (fs.existsSync(unpacked)) return unpacked
  } catch(e) {}

  // 2. Try finding ffmpeg in PATH (system-installed)
  const isWin = process.platform === 'win32'
  const name = isWin ? 'ffmpeg.exe' : 'ffmpeg'
  const pathDirs = (process.env.PATH || '').split(isWin ? ';' : ':')
  for (const dir of pathDirs) {
    const full = path.join(dir, name)
    try { if (fs.existsSync(full)) return full } catch(e) {}
  }

  return null
}

function createWindow() {
  // Create thumb cache dir
  thumbCacheDir = path.join(os.tmpdir(), 'photosort-thumbs')
  fs.mkdirSync(thumbCacheDir, { recursive: true })

  const ffp = getFfmpegPath()
  console.log('FFmpeg path:', ffp || 'NOT FOUND — video thumbnails will use fallback')
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    },
    backgroundColor: '#f4f3f0',
    show: false
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // Prevent black flash on maximize/restore by keeping backgroundColor in sync with theme
  mainWindow.on('maximize', () => mainWindow.webContents.send('win-state-change', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state-change', false))
}

// Window controls
ipcMain.handle('win-minimize', () => mainWindow.minimize())
ipcMain.handle('win-maximize', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize() })
ipcMain.handle('win-close', () => mainWindow.close())
ipcMain.handle('set-bg-color', (_, color) => { mainWindow.setBackgroundColor(color) })

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  exiftool.end()
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Resolve a dropped folder path
ipcMain.handle('resolve-dropped-folder', async (_, folderPath) => {
  try {
    if (folderPath && fs.statSync(folderPath).isDirectory()) return folderPath
  } catch {}
  return null
})

// Pick a folder via dialog
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// Scan a folder and return all media files
ipcMain.handle('scan-folder', async (_, folderPath) => {
  const IMAGE_EXTS = new Set(['jpg','jpeg','png','heic','heif','webp','gif','bmp','tiff','tif'])
  const VIDEO_EXTS = new Set(['mp4','mov','m4v','avi','mkv','wmv','3gp','flv','webm'])

  function getExt(name) {
    const p = name.lastIndexOf('.')
    return p >= 0 ? name.slice(p + 1).toLowerCase() : ''
  }

  function scanDir(dir) {
    let results = []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results = results.concat(scanDir(full))
      } else {
        const ext = getExt(entry.name)
        if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
          const stat = fs.statSync(full)
          results.push({ path: full, name: entry.name, ext, modifiedMs: stat.mtimeMs })
        }
      }
    }
    return results
  }

  return scanDir(folderPath)
})

// Read EXIF/metadata for a single file
// Returns { dateMs, hasRealExif, hasTimezone, isIosScreenshot }
ipcMain.handle('read-metadata', async (_, filePath) => {
  try {
    const tags = await exiftool.read(filePath)

    // iOS writes Title/XPTitle/XPSubject = "Screenshot" on all screenshots including cropped ones
    const titleVal = [tags.Title, tags.XPTitle, tags.XPSubject, tags.XPComment]
      .map(v => (v || '').toString().toLowerCase()).join(' ')
    const isIosScreenshot = titleVal.includes('screenshot')

    const realExifRaw = tags.DateTimeOriginal || tags.CreateDate
    const videoRaw = tags.MediaCreateDate || tags.TrackCreateDate

    function parseRaw(raw) {
      if (!raw) return null
      if (typeof raw === 'object' && raw.year) {
        return {
          dateMs: new Date(raw.year, raw.month - 1, raw.day, raw.hour || 0, raw.minute || 0, raw.second || 0).getTime(),
          hasTimezone: raw.tzoffsetMinutes != null
        }
      }
      const m = String(raw).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
      return m ? { dateMs: new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime(), hasTimezone: false } : null
    }

    const realParsed = parseRaw(realExifRaw)
    const videoParsed = parseRaw(videoRaw)

    if (realParsed) return { dateMs: realParsed.dateMs, hasRealExif: true, hasTimezone: realParsed.hasTimezone, isIosScreenshot }
    if (videoParsed) return { dateMs: videoParsed.dateMs, hasRealExif: true, hasTimezone: videoParsed.hasTimezone, isIosScreenshot }
    return { dateMs: null, hasRealExif: false, hasTimezone: false, isIosScreenshot }
  } catch {
    return null
  }
})

// List immediate subfolders of a folder (for step 2 folder picker)
ipcMain.handle('list-subfolders', async (_, folderPath) => {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    const folders = []
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const full = path.join(folderPath, e.name)
        // Count media files inside
        const IMAGE_EXTS = new Set(['jpg','jpeg','png','heic','heif','webp','gif','bmp','tiff','tif'])
        const VIDEO_EXTS = new Set(['mp4','mov','m4v','avi','mkv','wmv','3gp','flv','webm'])
        let count = 0
        try {
          const files = fs.readdirSync(full)
          for (const f of files) {
            const ext = f.split('.').pop().toLowerCase()
            if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) count++
          }
        } catch {}
        folders.push({ name: e.name, path: full, count })
      }
    }
    return folders
  } catch { return [] }
})

// Scan a flat folder (non-recursive) for review mode
ipcMain.handle('scan-folder-flat', async (_, folderPath) => {
  const IMAGE_EXTS = new Set(['jpg','jpeg','png','heic','heif','webp','gif','bmp','tiff','tif'])
  const VIDEO_EXTS = new Set(['mp4','mov','m4v','avi','mkv','wmv','3gp','flv','webm'])
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    const files = []
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.')) continue
      const ext = e.name.split('.').pop().toLowerCase()
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
        files.push({ path: path.join(folderPath, e.name), name: e.name, ext })
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name))
    return files
  } catch { return [] }
})

// Rename a file (append description)
ipcMain.handle('rename-file', async (_, { filePath, newName }) => {
  try {
    const dir = path.dirname(filePath)
    const dest = path.join(dir, newName)
    if (fs.existsSync(dest)) return { ok: false, error: 'File already exists' }
    fs.renameSync(filePath, dest)
    return { ok: true, newPath: dest }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Delete a file from the output folder only
ipcMain.handle('delete-file', async (_, filePath) => {
  try {
    fs.unlinkSync(filePath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Get a file:// URL safe for Electron to load as image/video src
ipcMain.handle('get-file-url', async (_, filePath) => {
  return 'file://' + filePath.replace(/\\/g, '/')
})
ipcMain.handle('do-sort', async (_, { outputFolder, plan, moveFiles }) => {
  let done = 0
  const errors = []

  fs.mkdirSync(outputFolder, { recursive: true })

  for (const item of plan) {
    try {
      const destDir = path.join(outputFolder, item.folder)
      fs.mkdirSync(destDir, { recursive: true })

      // Find a free filename — bump suffix if file already exists on disk
      let finalName = item.newName
      const ext = item.newName.includes('.') ? '.' + item.newName.split('.').pop() : ''
      const base = ext ? item.newName.slice(0, -ext.length) : item.newName
      let counter = 2
      while (fs.existsSync(path.join(destDir, finalName))) {
        // Strip any existing _N suffix before adding new one
        const cleanBase = base.replace(/_\d+$/, '')
        finalName = `${cleanBase}_${counter}${ext}`
        counter++
      }

      fs.copyFileSync(item.sourcePath, path.join(destDir, finalName))
      if (moveFiles) fs.unlinkSync(item.sourcePath)
      done++
      mainWindow.webContents.send('sort-progress', { done, total: plan.length })
    } catch (e) {
      errors.push({ file: item.origName, error: e.message })
    }
  }

  return { done, errors }
})

// Generate a video thumbnail using ffmpeg — returns file:// URL to cached JPEG
const thumbPromises = new Map()
const crypto = require('crypto')
let ffmpegChecked = false, ffmpegPath = null

ipcMain.handle('generate-thumb', async (_, filePath) => {
  // Check ffmpeg once
  if (!ffmpegChecked) {
    ffmpegChecked = true
    ffmpegPath = getFfmpegPath()
    if (!ffmpegPath) console.log('FFmpeg not available — video thumbnails will use browser fallback')
  }
  if (!ffmpegPath) return null
  // Safe hash for cache filename
  const hash = crypto.createHash('md5').update(filePath).digest('hex')
  const thumbPath = path.join(thumbCacheDir, hash + '.jpg')

  // Return cached if exists
  try {
    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
      return 'file://' + thumbPath.replace(/\\/g, '/')
    }
  } catch(e) {}

  // Deduplicate concurrent requests for same file
  if (thumbPromises.has(filePath)) return thumbPromises.get(filePath)

  const promise = new Promise((resolve) => {
    const args = [
      '-ss', '1',
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'scale=240:240:force_original_aspect_ratio=increase,crop=240:240',
      '-q:v', '4',
      '-y',
      thumbPath
    ]
    execFile(ffmpegPath, args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      thumbPromises.delete(filePath)
      if (err) {
        console.error('FFmpeg thumb error:', filePath, err.message)
        resolve(null)
      } else if (!fs.existsSync(thumbPath)) {
        console.error('FFmpeg thumb missing:', thumbPath)
        resolve(null)
      } else {
        resolve('file://' + thumbPath.replace(/\\/g, '/'))
      }
    })
  })

  thumbPromises.set(filePath, promise)
  return promise
})
