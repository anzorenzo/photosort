const IMAGE_EXTS = new Set(['jpg','jpeg','png','heic','heif','webp','gif','bmp','tiff','tif'])
const VIDEO_EXTS = new Set(['mp4','mov','m4v','avi','mkv','wmv','3gp','flv','webm'])
const PNG_LIKE   = new Set(['png','webp','gif','bmp'])

const modeState = {
  quick:     { sourceFolder:null, outputFolder:null, processedFiles:[], usedNames:{}, moveFiles:false },
  catalogue: { sourceFolder:null, outputFolder:null, processedFiles:[], usedNames:{}, catOutputFolder:null }
}

let reviewFiles=[], reviewIndex=0, reviewOutputFolder=null
let reviewMode='single', gridSize='s', selectedItems=new Set()
let confirmDelete=true, toastTimer=null
let fpReturnScreen='declutter', fpReturnMode='declutter'
let reviewIsCatalogue=false, hoverTimer=null
let currentScreen='home'
let catalogueFormat = localStorage.getItem('catalogueFormat') || 'YYYY-MM-DD HH.MM.SS'
let reviewZoom = 1

// ── Window controls ──
// pointer-events:none on SVGs means the button always receives the event
document.getElementById('win-min').addEventListener('click', () => window.api.winMinimize())
document.getElementById('win-max').addEventListener('click', () => window.api.winMaximize())
document.getElementById('win-close').addEventListener('click', () => window.api.winClose())

// ── Dark mode ──
const darkToggle = document.getElementById('setting-dark-mode')
function syncBgColor() {
  const isDark = document.documentElement.classList.contains('dark')
  window.api.setBgColor(isDark ? '#141412' : '#f4f3f0')
}
darkToggle.addEventListener('change', () => { document.documentElement.classList.toggle('dark', darkToggle.checked); localStorage.setItem('darkMode', darkToggle.checked?'1':'0'); syncBgColor() })
if (localStorage.getItem('darkMode')==='1') { document.documentElement.classList.add('dark'); darkToggle.checked=true }
syncBgColor()

// Listen for maximize/restore to ensure bg stays in sync
window.api.onWinStateChange(() => syncBgColor())

// ── Settings ──
const confirmDeleteToggle = document.getElementById('setting-confirm-delete')
const defaultMoveToggle = document.getElementById('setting-default-move')
const catalogueFormatSelect = document.getElementById('catalogue-format')

confirmDelete = localStorage.getItem('setting-confirm-delete') !== '0'
modeState.quick.moveFiles = localStorage.getItem('setting-default-move') === '1'
confirmDeleteToggle.checked = confirmDelete
defaultMoveToggle.checked = modeState.quick.moveFiles
catalogueFormatSelect.value = catalogueFormat

confirmDeleteToggle.addEventListener('change', e => {
  confirmDelete = e.target.checked
  localStorage.setItem('setting-confirm-delete', confirmDelete ? '1' : '0')
})
defaultMoveToggle.addEventListener('change', e => {
  modeState.quick.moveFiles = e.target.checked
  localStorage.setItem('setting-default-move', modeState.quick.moveFiles ? '1' : '0')
})
catalogueFormatSelect.addEventListener('change', e => {
  catalogueFormat = e.target.value
  localStorage.setItem('catalogueFormat', catalogueFormat)
  if (modeState.catalogue.processedFiles.length) {
    modeState.catalogue.usedNames = {}
    remapCataloguePlan()
    renderList('catalogue', modeState.catalogue.processedFiles)
  }
})

// ── Screen transitions ──
function showScreen(name) {
  if (name===currentScreen) return
  const prev = document.getElementById(currentScreen+'-screen')
  const next = document.getElementById(name+'-screen')
  if (!next) return
  if (prev) { prev.classList.add('exit'); setTimeout(() => prev.classList.remove('active','exit'), 520) }
  next.classList.add('active')
  // Toggle dark background for review
  document.getElementById('content').classList.toggle('review-active', name==='review')
  currentScreen = name
  const navMap = { 'folder-picker': fpReturnMode==='declutter'?'declutter':'catalogue', 'review': fpReturnMode==='declutter'?'declutter':'catalogue' }
  const active = navMap[name] || name
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.screen===active))
}
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.screen)))
document.querySelectorAll('.home-card').forEach(card => card.addEventListener('click', () => showScreen(card.dataset.goto)))

// ── Utils ──
const pad = n => String(n).padStart(2,'0')
function fmtDate(ms, format = catalogueFormat) {
  const d = new Date(ms)
  const parts = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    SS: pad(d.getSeconds())
  }
  const formats = {
    'YYYY-MM-DD HH.MM.SS': `${parts.YYYY}-${parts.MM}-${parts.DD} ${parts.HH}.${parts.mm}.${parts.SS}`,
    'YYYY-MM-DD HH-MM-SS': `${parts.YYYY}-${parts.MM}-${parts.DD} ${parts.HH}-${parts.mm}-${parts.SS}`,
    'YYYYMMDD_HHMMSS': `${parts.YYYY}${parts.MM}${parts.DD}_${parts.HH}${parts.mm}${parts.SS}`,
    'YYYY.MM.DD HH.MM.SS': `${parts.YYYY}.${parts.MM}.${parts.DD} ${parts.HH}.${parts.mm}.${parts.SS}`
  }
  return formats[format] || formats['YYYY-MM-DD HH.MM.SS']
}
const getExt  = name => { const p=name.lastIndexOf('.'); return p>=0?name.slice(p+1).toLowerCase():'' }
const getBase = name => { const p=name.lastIndexOf('.'); return p>=0?name.slice(0,p):name }
function dedup(used,folder,base,ext){const k=`${folder}||${base}.${ext}`.toLowerCase();if(!used[k]){used[k]=1;return`${base}.${ext}`}return`${base}_${++used[k]}.${ext}`}

// ── Drop zones ──
function setupDZ(dzId, browseId, mode) {
  const dz = document.getElementById(dzId)
  const br = document.getElementById(browseId)
  if (br) br.addEventListener('click', e => { e.stopPropagation(); pickForMode(mode) })
  dz.addEventListener('click', () => pickForMode(mode))
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', async e => {
    e.preventDefault(); dz.classList.remove('drag-over')
    const files = Array.from(e.dataTransfer.files); if (!files.length) return
    const ok = await window.api.resolveDroppedFolder(files[0].path)
    if (ok) loadForMode(mode, files[0].path)
  })
}
setupDZ('dz-quick','quick-browse','quick')
setupDZ('dz-cat','cat-browse','catalogue')
setupDZ('dz-declutter','declutter-browse','declutter')

async function pickForMode(mode) { const f=await window.api.pickFolder(); if(f) loadForMode(mode,f) }

// Collapse drop zone, switch to content layout, reveal content area
function revealContent(mode) {
  const pfx = mode==='quick'?'quick':'cat'
  const screen = document.getElementById(`${mode==='quick'?'quick':'catalogue'}-screen`)
  document.getElementById(`${pfx}-dz-wrap`).classList.add('collapsed')
  screen.classList.add('has-content')
  setTimeout(() => document.getElementById(`${pfx}-content`).classList.add('visible'), 100)
}

// Reveal post-analysis elements (list, output row, actions)
function revealPostAnalyze(mode) {
  const pfx = mode==='quick'?'quick':'cat'
  const els = document.getElementById(`${pfx}-content`).querySelectorAll('.post-analyze')
  els.forEach((el, i) => {
    setTimeout(() => el.classList.add('revealed'), i * 80)
  })
}

async function loadForMode(mode, folder) {
  if (mode==='declutter') { startDeclutter(folder); return }
  const st = modeState[mode]
  st.sourceFolder = folder
  st.outputFolder = folder + (mode==='catalogue' ? '_catalogue' : '_sorted')
  if (mode==='catalogue') st.catOutputFolder = st.outputFolder
  const pfx = mode==='quick'?'quick':'cat'
  document.getElementById(`${pfx}-out-path`).textContent = st.outputFolder
  revealContent(mode)
  await analyzeFolder(mode, folder)
}

document.getElementById('quick-out-btn').addEventListener('click', async () => { const f=await window.api.pickFolder(); if(f){modeState.quick.outputFolder=f;document.getElementById('quick-out-path').textContent=f} })
document.getElementById('cat-out-btn').addEventListener('click', async () => { const f=await window.api.pickFolder(); if(f){modeState.catalogue.outputFolder=f;modeState.catalogue.catOutputFolder=f;document.getElementById('cat-out-path').textContent=f} })

// ── Analyze ──
async function analyzeFolder(mode, folder) {
  const st=modeState[mode], isCat=mode==='catalogue'
  const pfx=isCat?'cat':'quick', sp=isCat?'as':'qs'
  st.usedNames={}; st.processedFiles=[]

  // Show stats + analyzing, hide post-analyze elements
  document.getElementById(`${pfx}-stats`).classList.remove('hidden')
  document.getElementById(`${pfx}-analyzing`).style.display='block'
  document.getElementById(`${pfx}-list`).classList.add('hidden')
  document.getElementById(`${pfx}-out-row`).classList.add('hidden')
  // Reset post-analyze reveal
  document.getElementById(`${pfx}-content`).querySelectorAll('.post-analyze').forEach(el => el.classList.remove('revealed'))
  const mainBtn = document.getElementById(isCat?'cat-rename-btn':'quick-sort-btn')
  mainBtn.disabled=true; mainBtn.textContent=isCat?'Rename files':'Sort files'; mainBtn.style.background=''; mainBtn.style.color=''
  // Reset button onclick for catalogue (in case it was morphed to Step 2)
  if(isCat) mainBtn.onclick=null
  hideDoneLabel(pfx)
  ;['total','photos','videos','shots','review'].forEach(k => { const el=document.getElementById(`${sp}-${k}`); if(el) el.textContent='...' })

  const files = await window.api.scanFolder(folder)
  const ordered = [...files.filter(f=>IMAGE_EXTS.has(f.ext)), ...files.filter(f=>VIDEO_EXTS.has(f.ext))]
  const liveMap = {}
  for (let i=0; i<ordered.length; i++) {
    document.getElementById(`${pfx}-al-label`).textContent = `Analyzing ${i+1} of ${ordered.length}...`
    document.getElementById(`${pfx}-al-bar`).style.width = Math.round(((i+1)/ordered.length)*100)+'%'
    st.processedFiles.push(await processFile(ordered[i], liveMap, st.usedNames, isCat))
  }

  document.getElementById(`${pfx}-analyzing`).style.display='none'
  renderList(mode, st.processedFiles)
  updateStats(mode, st.processedFiles)
  document.getElementById(`${pfx}-out-row`).classList.remove('hidden')
  mainBtn.disabled=false

  // Stagger reveal of file list + output + actions
  revealPostAnalyze(mode)
}

async function processFile(f,liveMap,used,isArch) {
  const isImg=IMAGE_EXTS.has(f.ext), isVid=VIDEO_EXTS.has(f.ext)
  const isPng=PNG_LIKE.has(f.ext), base=getBase(f.name), modMs=f.modifiedMs
  const meta = await window.api.readMetadata(f.path)
  const hasExif=!!(meta?.hasRealExif), hasTz=!!(meta?.hasTimezone), isIosSS=!!(meta?.isIosScreenshot)
  let dateMs=meta?.dateMs||null, isShot=false, isLive=false
  if(isImg){if(isIosSS||(isPng&&!hasTz))isShot=true;if(hasExif&&!isShot)liveMap[base.toLowerCase()]=dateMs}
  if(isVid){const lm=liveMap[base.toLowerCase()];if(lm&&f.ext==='mov'){isLive=true;if(!dateMs)dateMs=lm}if(!dateMs)dateMs=modMs}
  if(!dateMs)dateMs=modMs
  const year=new Date(dateMs).getFullYear(), isJpg=f.ext==='jpg'||f.ext==='jpeg'
  const needsReview=isJpg&&!hasTz&&!isIosSS
  let folder,newName,badge
  if(isShot){
    badge='screenshot'
    folder='Screenshots'
    const shotFormat = isArch ? catalogueFormat : 'YYYY-MM-DD HH.MM.SS'
    newName = dedup(used, folder, fmtDate(dateMs, shotFormat), f.ext)
  }
  else if(needsReview){badge='review';folder=isArch?'Review':`${year}/Review`;newName=dedup(used,folder,fmtDate(dateMs),f.ext)}
  else if(isLive){badge='live';folder=`${year}`;newName=dedup(used,folder,fmtDate(dateMs),f.ext)}
  else if(isImg){if(hasExif){badge='photo';folder=`${year}`;newName=dedup(used,folder,fmtDate(dateMs, isArch ? catalogueFormat : 'YYYY-MM-DD HH.MM.SS'),f.ext)}else{badge='unsorted';folder=isArch?'Unsorted':`${year}/Unsorted`;newName=f.name}}
  else if(isVid){badge='video';folder=`${year}`;newName=dedup(used,folder,fmtDate(dateMs, isArch ? catalogueFormat : 'YYYY-MM-DD HH.MM.SS'),f.ext)}
  else{badge='unsorted';folder=isArch?'Unsorted':`${year}/Unsorted`;newName=f.name}
  return {sourcePath:f.path,origName:f.name,newName,folder,badge,dateMs}
}

function remapCataloguePlan() {
  const st = modeState.catalogue
  const used = {}
  st.processedFiles = st.processedFiles.map(pf => {
    let newName = pf.newName
    const ext = getExt(pf.origName)

    if (pf.badge === 'photo' || pf.badge === 'video' || pf.badge === 'live' || pf.badge === 'review') {
      const ts = pf.dateMs || Date.now()
      newName = dedup(used, pf.folder, fmtDate(ts), ext)
    } else if (pf.badge === 'screenshot') {
      newName = pf.dateMs ? dedup(used, pf.folder, fmtDate(pf.dateMs), ext) : pf.origName
    }
    return { ...pf, newName }
  })
}

function renderList(mode,files) {
  const pfx=mode==='quick'?'quick':'cat', body=document.getElementById(`${pfx}-list-body`)
  body.innerHTML=''
  for(const pf of files){
    const row=document.createElement('div'); row.className='file-row'
    const bc={photo:'badge-photo',video:'badge-video',screenshot:'badge-screenshot',live:'badge-live',unsorted:'badge-unsorted',review:'badge-review'}[pf.badge]||'badge-unsorted'
    row.innerHTML=`<span class="f-orig" title="${pf.origName}">${pf.origName}</span><span class="f-new">${pf.newName}</span><span class="f-dest">${pf.folder}/</span><span><span class="badge ${bc}">${pf.badge==='live'?'live':pf.badge}</span></span>`
    body.appendChild(row)
  }
  document.getElementById(`${pfx}-list`).classList.remove('hidden')
}

function updateStats(mode,files) {
  const p=mode==='quick'?'qs':'as'
  document.getElementById(`${p}-total`).textContent=files.length
  document.getElementById(`${p}-photos`).textContent=files.filter(f=>f.badge==='photo'||f.badge==='live').length
  document.getElementById(`${p}-videos`).textContent=files.filter(f=>f.badge==='video').length
  document.getElementById(`${p}-shots`).textContent=files.filter(f=>f.badge==='screenshot').length
  document.getElementById(`${p}-review`).textContent=files.filter(f=>f.badge==='review').length
}

// ── Button state helpers ──
function showDoneLabel(pfx, text) {
  const label = document.getElementById(`${pfx}-done-label`)
  if (label) { label.textContent = text; label.classList.add('visible') }
}
function hideDoneLabel(pfx) {
  const label = document.getElementById(`${pfx}-done-label`)
  if (label) label.classList.remove('visible')
}

// ── Quick Sort ──
document.getElementById('quick-sort-btn').addEventListener('click', async () => {
  const st=modeState.quick; if(!st.outputFolder)return
  const btn=document.getElementById('quick-sort-btn'); btn.disabled=true; btn.textContent='Working...'
  window.api.onSortProgress(({done,total})=>{ btn.textContent=`${done}/${total}...` })
  const{done,errors}=await window.api.doSort(st.outputFolder,st.processedFiles,st.moveFiles)
  btn.textContent=`✓ ${done} sorted`
  btn.style.background='var(--green-bg)'; btn.style.color='var(--green-text)'
})

// ── Catalogue ──
document.getElementById('cat-rename-btn').addEventListener('click', async () => {
  const st=modeState.catalogue; if(!st.outputFolder)return
  const btn=document.getElementById('cat-rename-btn'); btn.disabled=true; btn.textContent='Working...'
  window.api.onSortProgress(({done,total})=>{ btn.textContent=`${done}/${total}...` })
  const{done,errors}=await window.api.doSort(st.outputFolder,st.processedFiles,false)
  st.catOutputFolder=st.outputFolder
  // Show done label sliding out to the left
  showDoneLabel('cat', `✓ ${done} renamed`)
  // Morph button into Step 2 after a brief pause
  setTimeout(()=>{
    btn.textContent='Step 2: Review →'
    btn.style.background='var(--blue-bg)'; btn.style.color='var(--blue-text)'
    btn.disabled=false
    btn.onclick=()=>{
      fpReturnMode='catalogue'; fpReturnScreen='catalogue'
      openFolderPicker(st.catOutputFolder,'catalogue')
    }
  }, 600)
})

// ── Folder picker ──
async function openFolderPicker(rootFolder, mode) {
  reviewOutputFolder=rootFolder
  const subs=await window.api.listSubfolders(rootFolder)
  if(!subs.length){showToast('No subfolders found.');return}
  buildFolderPicker(subs,mode)
  document.getElementById('fp-title').textContent=mode==='declutter'?'Pick a folder to declutter':'Choose a folder to review'
  document.getElementById('fp-desc').textContent=mode==='declutter'?'Select a subfolder to start decluttering.':'Pick a subfolder from your catalogue output.'
  showScreen('folder-picker')
}
function buildFolderPicker(subs,mode) {
  const list=document.getElementById('folder-list'); list.innerHTML=''
  for(const sf of subs){
    const card=document.createElement('div'); card.className='folder-card'
    card.innerHTML=`<div class="folder-card-name">${sf.name}</div><div class="folder-card-count">${sf.count} files</div>`
    card.addEventListener('click',()=>startReview(sf.path,sf.name,mode))
    list.appendChild(card)
  }
}
document.getElementById('fp-back-btn').addEventListener('click',()=>showScreen(fpReturnScreen))

// ── Declutter ──
async function startDeclutter(folder) {
  fpReturnMode='declutter'; fpReturnScreen='declutter'
  const subs=await window.api.listSubfolders(folder)
  if(subs.length>0){
    reviewOutputFolder=folder
    buildFolderPicker(subs,'declutter')
    document.getElementById('fp-title').textContent='Pick a folder to declutter'
    document.getElementById('fp-desc').textContent='Select a subfolder to start decluttering.'
    showScreen('folder-picker')
  }else{
    startReview(folder, folder.split(/[\\/]/).pop(), 'declutter')
  }
}

// ── Review ──
async function startReview(folder, name, mode) {
  reviewIsCatalogue = (mode !== 'declutter')
  clearThumbQueue()

  // ① Clear everything and show black screen immediately
  const singleWrap=document.getElementById('rv-single-wrap')
  const vidEl=document.getElementById('rv-vid'), imgEl=document.getElementById('rv-img')
  singleWrap.style.display='flex'
  try { vidEl.pause() } catch(e) {}
  vidEl.removeAttribute('src'); vidEl.load(); vidEl.style.display='none'
  imgEl.removeAttribute('src'); imgEl.style.display='none'
  document.getElementById('rv-timeline').innerHTML=''
  document.getElementById('rv-grid').innerHTML=''
  document.getElementById('rv-filename').textContent=''
  document.getElementById('rv-scrub-wrap').classList.remove('show')
  selectedItems.clear(); updateGridDelBar()
  setViewMode('single', true)

  // ③ Set labels
  document.getElementById('rv-folder-label').textContent=name
  document.getElementById('rv-filename-row').style.display=reviewIsCatalogue?'flex':'none'
  document.getElementById('rv-counter').textContent=''

  // ④ Show review screen IMMEDIATELY (black bg, no content yet)
  showScreen('review')

  // ⑤ Load file list
  const files = await window.api.scanFolderFlat(folder)
  if(!files.length){showToast('No media files here.');;showScreen(fpReturnScreen);return}
  reviewFiles=[...files]; reviewIndex=0

  // ⑥ Show first file
  document.getElementById('rv-counter').textContent=`1 / ${reviewFiles.length}`
  showFile(0)

  // ⑦ Build timeline after a delay — let the screen and first photo settle
  setTimeout(()=> buildTimeline(), 500)
}

function setViewMode(mode, skipBuild) {
  reviewMode=mode
  const singleWrap=document.getElementById('rv-single-wrap')
  const grid=document.getElementById('rv-grid-wrap')
  const bot=document.getElementById('rv-bottom'), nl=document.getElementById('rv-nav-l'), nr=document.getElementById('rv-nav-r')
  const sb=document.getElementById('rv-size-btns'), vs=document.getElementById('rv-view-single'), vg=document.getElementById('rv-view-grid')
  if(mode==='single'){
    grid.classList.remove('show')
    singleWrap.style.display='flex'; bot.style.display='flex'
    nl.style.display='flex'; nr.style.display='flex'
    sb.classList.add('hidden')
    vs.classList.add('active-view'); vg.classList.remove('active-view')
    selectedItems.clear(); updateGridDelBar()
    if(reviewFiles.length && !skipBuild) showFile(reviewIndex)
  }else{
    singleWrap.style.display='none'; bot.style.display='none'
    nl.style.display='none'; nr.style.display='none'
    sb.classList.remove('hidden')
    vg.classList.add('active-view'); vs.classList.remove('active-view')
    if(!skipBuild){
      // Build grid while hidden, then show after a frame
      grid.classList.remove('show')
      buildGrid()
      requestAnimationFrame(()=> requestAnimationFrame(()=> grid.classList.add('show')))
    }
  }
}

document.getElementById('rv-view-single').addEventListener('click',()=>setViewMode('single'))
document.getElementById('rv-view-grid').addEventListener('click',()=>setViewMode('grid'))
document.querySelectorAll('.rv-size-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    gridSize=btn.dataset.size
    document.querySelectorAll('.rv-size-btn').forEach(b=>b.classList.toggle('active',b===btn))
    document.getElementById('rv-grid').className=`rv-grid sz-${gridSize}`
  })
})

function buildGrid() {
  clearThumbQueue()
  const grid=document.getElementById('rv-grid'); grid.innerHTML=''; grid.className=`rv-grid sz-${gridSize}`
  let idx=0
  const batchSize=30

  function buildBatch(){
    const end=Math.min(idx+batchSize, reviewFiles.length)
    for(;idx<end;idx++){
      const f=reviewFiles[idx], i=idx
      const item=document.createElement('div'); item.className='grid-item'; item.dataset.index=i
      const check=document.createElement('div'); check.className='grid-check'
      check.innerHTML='<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      item.appendChild(check)
      if(VIDEO_EXTS.has(f.ext)){
        const img=document.createElement('img'); img.loading='lazy'
        img.style.background='#1a1a18'
        item.appendChild(img)
        const badge=document.createElement('div'); badge.className='grid-vid-icon'
        badge.innerHTML='<svg width="18" height="18" viewBox="0 0 18 18" fill="white" opacity="0.75"><polygon points="5,3 15,9 5,15"/></svg>'
        item.appendChild(badge)
        queueThumb(()=> generateVideoThumb(f.path, img))
      }else{
        const img=document.createElement('img'); img.loading='lazy'
        img.src=fileUrl(f.path)
        item.appendChild(img)
      }
      if(reviewIsCatalogue){
        const bar=document.createElement('div'); bar.className='grid-name-bar'
        bar.addEventListener('click',e=>e.stopPropagation())
        const input=document.createElement('div'); input.className='grid-name-input'; input.contentEditable='true'; input.spellcheck=false
        input.textContent=getBase(f.name); input.dataset.original=getBase(f.name)
        const extSpan=document.createElement('span'); extSpan.className='grid-name-ext'; extSpan.textContent='.'+getExt(f.name)
        input.addEventListener('keydown',async e=>{
          if(e.key==='Enter'){e.preventDefault();await saveGridName(i,input,getExt(f.name));input.blur()}
          if(e.key==='Escape'){input.textContent=input.dataset.original;input.blur()}
          e.stopPropagation()
        })
        bar.appendChild(input); bar.appendChild(extSpan); item.appendChild(bar)
      }
      item.addEventListener('mouseenter',()=>{ hoverTimer=setTimeout(()=>showHover(f,item),650) })
      item.addEventListener('mouseleave',()=>{ clearTimeout(hoverTimer); hideHover() })
      item.addEventListener('click',e=>{
        const idx=parseInt(item.dataset.index)
        if(e.shiftKey&&selectedItems.size>0){ const last=Math.max(...selectedItems); const mn=Math.min(last,idx),mx=Math.max(last,idx); for(let j=mn;j<=mx;j++) selectedItems.add(j) }
        else{ if(selectedItems.has(idx)) selectedItems.delete(idx); else selectedItems.add(idx) }
        updateGridSelection(); updateGridDelBar()
      })
      grid.appendChild(item)
    }
    if(idx<reviewFiles.length) requestAnimationFrame(buildBatch)
  }
  buildBatch()
}

async function saveGridName(idx,inputEl,ext) {
  const nb=inputEl.textContent.trim(), f=reviewFiles[idx], nn=nb+'.'+ext
  if(!nb||nn===f.name)return
  const r=await window.api.renameFile(f.path,nn)
  if(r.ok){reviewFiles[idx]={...f,path:r.newPath,name:nn};inputEl.dataset.original=nb}
  else{showToast('Rename failed: '+r.error);inputEl.textContent=inputEl.dataset.original}
}

function updateGridSelection(){document.querySelectorAll('.grid-item').forEach((item,i)=>item.classList.toggle('selected',selectedItems.has(i)))}
function updateGridDelBar(){const bar=document.getElementById('grid-del-bar');bar.classList.toggle('show',selectedItems.size>0);document.getElementById('grid-sel-count').textContent=`${selectedItems.size} selected`}

document.getElementById('grid-del-btn').addEventListener('click',async()=>{
  if(!selectedItems.size)return
  if(confirmDelete&&!confirm(`Delete ${selectedItems.size} file(s)?`))return
  const indices=[...selectedItems].sort((a,b)=>b-a)
  for(const i of indices){await window.api.deleteFile(reviewFiles[i].path);reviewFiles.splice(i,1)}
  selectedItems.clear(); buildGrid(); updateGridDelBar(); showToast(`Deleted ${indices.length} file(s)`)
})

async function showHover(f,el) {
  const url=await window.api.getFileUrl(f.path)
  const p=document.getElementById('hover-preview')
  const pImg=document.getElementById('hover-preview-img'), pVid=document.getElementById('hover-preview-vid')
  if(VIDEO_EXTS.has(f.ext)){
    pImg.style.display='none'; pImg.src=''
    pVid.style.display='block'; pVid.src=url; pVid.load(); pVid.play().catch(()=>{})
  }else{
    pVid.style.display='none'; pVid.src=''; try{pVid.pause()}catch(e){}
    pImg.style.display='block'; pImg.src=url
  }
  const rect=el.getBoundingClientRect()
  const pw=530, ph=530
  let x=rect.right+10, y=rect.top
  if(x+pw>window.innerWidth) x=rect.left-pw-10
  if(x<0) x=10
  if(y+ph>window.innerHeight) y=window.innerHeight-ph
  if(y<0) y=0
  p.style.left=x+'px'; p.style.top=y+'px'; p.style.opacity='1'
}
function hideHover(){document.getElementById('hover-preview').style.opacity='0'}

// ── Video thumbnail queue — process max 3 at a time ──
let thumbQueue=[], thumbActive=0
const THUMB_CONCURRENCY=3
function queueThumb(task){ thumbQueue.push(task); drainThumbQueue() }
function drainThumbQueue(){
  while(thumbActive<THUMB_CONCURRENCY&&thumbQueue.length){
    thumbActive++
    const task=thumbQueue.shift()
    task().finally(()=>{ thumbActive--; setTimeout(drainThumbQueue, 50) })
  }
}
function clearThumbQueue(){ thumbQueue=[]; thumbActive=0 }

function generateVideoThumb(filePath, imgElement) {
  return window.api.generateThumb(filePath).then(url=>{
    if(url && imgElement) { imgElement.src=url; return }
    return fallbackVideoThumb(filePath, imgElement)
  }).catch(()=> fallbackVideoThumb(filePath, imgElement))
}

function fallbackVideoThumb(filePath, imgElement) {
  return new Promise(resolve=>{
    const url=fileUrl(filePath)
    const vid=document.createElement('video'); vid.src=url; vid.muted=true; vid.preload='metadata'
    vid.style.cssText='position:fixed;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none'
    const cleanup=()=>{ try{vid.remove()}catch(e){} resolve() }
    const timeout=setTimeout(cleanup, 5000)
    vid.addEventListener('loadedmetadata',()=>{
      vid.currentTime=Math.min(1, vid.duration*0.1||0)
      vid.addEventListener('seeked',()=>{
        clearTimeout(timeout)
        if(imgElement){
          const c=document.createElement('canvas'); c.width=240; c.height=240
          const ctx=c.getContext('2d')
          const vw=vid.videoWidth||1, vh=vid.videoHeight||1
          const scale=Math.max(240/vw,240/vh), sw=vw*scale, sh=vh*scale
          ctx.drawImage(vid,(240-sw)/2,(240-sh)/2,sw,sh)
          imgElement.src=c.toDataURL('image/jpeg',0.7)
        }
        cleanup()
      },{once:true})
    },{once:true})
    vid.addEventListener('error',()=>{ clearTimeout(timeout); cleanup() },{once:true})
    document.body.appendChild(vid)
  })
}

// Build timeline in batches to avoid blocking the UI
function buildTimeline() {
  clearThumbQueue()
  const strip=document.getElementById('rv-timeline'); strip.innerHTML=''
  let idx=0
  const batchSize=20

  function buildBatch(){
    const end=Math.min(idx+batchSize, reviewFiles.length)
    for(;idx<end;idx++){
      const f=reviewFiles[idx], i=idx
      const thumb=document.createElement('div')
      thumb.className='t-thumb'+(i===0?' active':''); thumb.dataset.index=i
      if(VIDEO_EXTS.has(f.ext)){
        const img=document.createElement('img'); img.loading='lazy'
        img.style.background='#1a1a18'
        thumb.appendChild(img)
        const badge=document.createElement('div'); badge.className='t-vid-badge'
        badge.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12" fill="white" opacity="0.8"><polygon points="3,1.5 10.5,6 3,10.5"/></svg>'
        thumb.appendChild(badge)
        queueThumb(()=> generateVideoThumb(f.path, img))
      }else{
        const img=document.createElement('img'); img.loading='lazy'
        img.src=fileUrl(f.path)
        thumb.appendChild(img)
      }
      thumb.addEventListener('click',()=>{ reviewIndex=i; showFile(i) })
      strip.appendChild(thumb)
    }
    if(idx<reviewFiles.length) requestAnimationFrame(buildBatch)
  }
  buildBatch()
}

let scrubRAF=null
function stopScrubTracking() { if(scrubRAF){cancelAnimationFrame(scrubRAF);scrubRAF=null} }

function fmtTime(s) { const m=Math.floor(s/60); return `${m}:${String(Math.floor(s%60)).padStart(2,'0')}` }

// Convert file path to file:// URL — fully synchronous, no IPC needed
function fileUrl(filePath) {
  return 'file://' + filePath.replace(/\\/g, '/')
}

// Preload adjacent images
function preloadAdjacent(idx){
  for(const i of [idx-1,idx+1]){
    if(i>=0&&i<reviewFiles.length&&IMAGE_EXTS.has(reviewFiles[i].ext)){
      const img=new Image(); img.src=fileUrl(reviewFiles[i].path)
    }
  }
}

function applyReviewZoom() {
  const imgEl=document.getElementById('rv-img')
  const vidEl=document.getElementById('rv-vid')
  const active = imgEl.style.display !== 'none' ? imgEl : vidEl
  if (!active) return
  active.style.transform = `scale(${reviewZoom})`
}

function resetReviewZoom() {
  reviewZoom = 1
  applyReviewZoom()
}

let prevReviewIndex=0
function showFile(idx) {
  if(idx<0||idx>=reviewFiles.length)return
  stopScrubTracking()
  prevReviewIndex=reviewIndex
  reviewIndex=idx
  const f=reviewFiles[idx]
  resetReviewZoom()
  document.getElementById('rv-counter').textContent=`${idx+1} / ${reviewFiles.length}`
  const base=getBase(f.name), ext=getExt(f.name)
  const fnEl=document.getElementById('rv-filename')
  fnEl.textContent=base; fnEl.dataset.original=base
  document.getElementById('rv-ext').textContent='.'+ext
  document.querySelectorAll('.t-thumb').forEach((t,i)=>t.classList.toggle('active',i===idx))
  const active=document.querySelector(`.t-thumb[data-index="${idx}"]`)
  if(active) active.scrollIntoView({inline:'nearest',behavior:'smooth'})
  const url=fileUrl(f.path)
  const imgEl=document.getElementById('rv-img'), vidEl=document.getElementById('rv-vid')
  const scrubWrap=document.getElementById('rv-scrub-wrap')
  if(VIDEO_EXTS.has(f.ext)){
    imgEl.style.display='none'; imgEl.removeAttribute('src')
    vidEl.style.display='block'; vidEl.src=url; vidEl.load(); vidEl.play().catch(()=>{}); applyReviewZoom()
    scrubWrap.classList.add('show')
    const scrub=document.getElementById('rv-scrub')
    const curEl=document.getElementById('rv-time-cur'), durEl=document.getElementById('rv-time-dur')
    vidEl.onloadedmetadata=()=>{
      scrub.max=vidEl.duration||100
      durEl.textContent=fmtTime(vidEl.duration||0)
    }
    function trackTime(){
      if(vidEl.style.display==='block'&&!vidEl.paused){
        scrub.value=vidEl.currentTime
        curEl.textContent=fmtTime(vidEl.currentTime)
      }
      scrubRAF=requestAnimationFrame(trackTime)
    }
    trackTime()
  }else{
    vidEl.style.display='none'; try{vidEl.pause()}catch(e){} vidEl.removeAttribute('src'); vidEl.load()
    imgEl.style.display='block'; imgEl.src=url; applyReviewZoom()
    scrubWrap.classList.remove('show')
  }
  preloadAdjacent(idx)
}

const fnEl=document.getElementById('rv-filename')
document.getElementById('rv-nav-l').addEventListener('click',()=>{ if(reviewIndex>0) showFile(reviewIndex-1) })
document.getElementById('rv-nav-r').addEventListener('click',()=>{ if(reviewIndex<reviewFiles.length-1) showFile(reviewIndex+1) })
// Click video to toggle play/pause
document.getElementById('rv-vid').addEventListener('click',function(){ if(this.paused) this.play().catch(()=>{}); else this.pause() })
fnEl.addEventListener('focus',()=>{ const r=document.createRange(); r.selectNodeContents(fnEl); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r) })
fnEl.addEventListener('keydown',async e=>{
  if(e.key==='Enter'){e.preventDefault();await saveSingleName();fnEl.blur();if(reviewIndex<reviewFiles.length-1)showFile(reviewIndex+1)}
  if(e.key==='Escape'){fnEl.textContent=fnEl.dataset.original;fnEl.blur()}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight') e.stopPropagation()
})
async function saveSingleName() {
  const nb=fnEl.textContent.trim(), f=reviewFiles[reviewIndex]
  const ext=getExt(f.name), nn=nb+'.'+ext
  if(!nb||nn===f.name)return
  const r=await window.api.renameFile(f.path,nn)
  if(r.ok) reviewFiles[reviewIndex]={...f,path:r.newPath,name:nn}
  else{showToast('Rename failed: '+r.error);fnEl.textContent=fnEl.dataset.original}
}

async function deleteCurrent() {
  const f=reviewFiles[reviewIndex]; if(!f)return
  if(confirmDelete&&!confirm(`Delete "${f.name}"?`))return
  const r=await window.api.deleteFile(f.path)
  if(!r.ok){showToast('Delete failed: '+r.error);return}
  reviewFiles.splice(reviewIndex,1)
  if(!reviewFiles.length){showToast('No more files.');showScreen('folder-picker');return}
  buildTimeline(); showFile(Math.min(reviewIndex,reviewFiles.length-1))
  showToast(`Deleted ${f.name}`)
}

document.getElementById('rv-back-btn').addEventListener('click',async()=>{
  
  if(reviewOutputFolder){const subs=await window.api.listSubfolders(reviewOutputFolder);if(subs.length){buildFolderPicker(subs,fpReturnMode);showScreen('folder-picker');return}}
  showScreen(fpReturnScreen)
})

// Scrub bar interaction
document.getElementById('rv-scrub').addEventListener('input', e => {
  const vidEl=document.getElementById('rv-vid')
  if(vidEl.style.display==='block'&&vidEl.duration) vidEl.currentTime=parseFloat(e.target.value)
})

const reviewWrap = document.getElementById('rv-single-wrap')
reviewWrap.addEventListener('wheel', e => {
  if (reviewMode !== 'single') return
  e.preventDefault()
  const delta = e.deltaY < 0 ? 0.12 : -0.12
  reviewZoom = Math.max(0.5, Math.min(5, +(reviewZoom + delta).toFixed(2)))
  applyReviewZoom()
}, { passive: false })

const activePointers = new Map()
let pinchStartDistance = null
let pinchStartZoom = 1

function pointerDistance(a, b) {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

function resetPinchState() {
  pinchStartDistance = null
  pinchStartZoom = reviewZoom
}

reviewWrap.addEventListener('pointerdown', e => {
  if (reviewMode !== 'single') return
  activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
  reviewWrap.setPointerCapture(e.pointerId)
  if (activePointers.size === 2) {
    const [a, b] = [...activePointers.values()]
    pinchStartDistance = pointerDistance(a, b)
    pinchStartZoom = reviewZoom
  }
})

reviewWrap.addEventListener('pointermove', e => {
  if (reviewMode !== 'single') return
  if (!activePointers.has(e.pointerId)) return
  activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
  if (activePointers.size < 2 || pinchStartDistance === null) return

  const [a, b] = [...activePointers.values()]
  const currentDistance = pointerDistance(a, b)
  if (!currentDistance || !pinchStartDistance) return

  const scale = currentDistance / pinchStartDistance
  reviewZoom = Math.max(0.5, Math.min(5, +(pinchStartZoom * scale).toFixed(2)))
  applyReviewZoom()
})

function handlePointerEnd(e) {
  if (activePointers.has(e.pointerId)) activePointers.delete(e.pointerId)
  if (activePointers.size < 2) resetPinchState()
  try { reviewWrap.releasePointerCapture(e.pointerId) } catch (_) {}
}

reviewWrap.addEventListener('pointerup', handlePointerEnd)
reviewWrap.addEventListener('pointercancel', handlePointerEnd)
reviewWrap.addEventListener('pointerleave', handlePointerEnd)

document.addEventListener('keydown',async e=>{
  const inReview=currentScreen==='review'
  const editing=document.activeElement===fnEl||document.activeElement.classList.contains('grid-name-input')
  if(!inReview||editing)return
  if(e.key===' '){
    e.preventDefault()
    const vidEl=document.getElementById('rv-vid')
    if(vidEl.style.display==='block'){
      if(vidEl.paused) vidEl.play().catch(()=>{})
      else vidEl.pause()
    }
    return
  }
  if(reviewMode==='single'){
    if(e.key==='ArrowRight'){e.preventDefault();if(reviewIndex<reviewFiles.length-1)showFile(reviewIndex+1)}
    if(e.key==='ArrowLeft'){e.preventDefault();if(reviewIndex>0)showFile(reviewIndex-1)}
    if(e.key==='Delete'){e.preventDefault();await deleteCurrent()}
  }else{
    if(e.key==='Delete'&&selectedItems.size){e.preventDefault();document.getElementById('grid-del-btn').click()}
  }
})

function showToast(msg){clearTimeout(toastTimer);document.getElementById('toast-msg').textContent=msg;document.getElementById('toast').classList.add('show');toastTimer=setTimeout(()=>document.getElementById('toast').classList.remove('show'),3000)}
