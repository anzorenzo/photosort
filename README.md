# PhotoSort

Sort and rename your photos, videos and screenshots by date — automatically.

## What it does

- Reads EXIF/metadata from photos and videos using exiftool
- Renames files to `YYYY-MM-DD HH.MM.SS.ext` format
- Sorts into folders: `YYYY/`, `YYYY/Videos/`, `YYYY/Screenshots/`, `YYYY/Unsorted/`
- Detects screenshots by matching exact device screen dimensions (images only)
- Pairs Live Photos (JPEG + MOV with same base name) and keeps them together
- Works on Windows and Mac

## Setup

### 1. Install Node.js
Download from https://nodejs.org — install the LTS version.

### 2. Install dependencies
```bash
cd photosort
npm install
```

### 3. Run the app
```bash
npm start
```

## Build a distributable

### Windows (.exe installer)
```bash
npm run build:win
```

### Mac (.dmg)
```bash
npm run build:mac
```

Output will be in the `dist/` folder.

## How to use

1. Launch the app
2. Drop a folder onto the window (or click to browse)
3. Review the preview — see exactly what will be renamed and where
4. Optionally change the output folder (default is `[source]_sorted` next to your original)
5. Click **Sort files**
6. Your original files are never touched — sorted copies go to the output folder

## File sorting logic

| File type | Has metadata? | Destination |
|-----------|--------------|-------------|
| Photo | Yes | Renamed → `YYYY/` |
| Photo | No | Original name → `YYYY/Unsorted/` |
| Screenshot (image matching screen dims) | Yes/No | Renamed/original → `YYYY/Screenshots/` |
| Video | Yes or fallback | Renamed → `YYYY/Videos/` |
| Live Photo .mov | Inherits from paired JPEG | Renamed → `YYYY/` |
