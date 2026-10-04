/* ===== Sprout & Paw: app logic =====
   Screens, timeline, adding/editing days, and the photo viewer. */
(function () {
  'use strict';

  const MAX_PHOTOS = 3; // per date
  const SETTINGS_KEY = 'sproutpaw:settings';

  const CATS = {
    plant:  { word: 'plant', defaultName: 'My plant', icon: '#i-leaf', note: 'New leaf today, watered in the morning' },
    animal: { word: 'pet',   defaultName: 'My pet',   icon: '#i-paw',  note: 'Weighed 3.2 kg, learned a new trick' }
  };

  const $ = id => document.getElementById(id);

  // ----- Settings (small things kept in localStorage) -----
  const settings = loadSettings();
  function loadSettings() {
    const base = { category: null, newestFirst: true, names: {} };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); }
    catch (e) { return base; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  let entries = [];             // days for the open diary
  const thumbCache = new Map(); // photoId -> Promise<object URL>
  let sheet = null;             // add/edit form state
  let pickTarget = 'new';       // where picked photos go: 'new' or 'sheet'
  let viewer = null;

  // ----- Small helpers -----
  const pad = n => String(n).padStart(2, '0');
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function formatDate(s) {
    return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const formatSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const entryId = (cat, date) => cat + ':' + date;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2800);
  }

  function lockScroll(on) { document.body.classList.toggle('no-scroll', on); }

  function setThemeColor() {
    const c = getComputedStyle(document.body).getPropertyValue('--primary').trim();
    document.querySelector('meta[name="theme-color"]').setAttribute('content', c || '#2F7D4A');
  }

  // ===== Screens =====
  async function showChoose() {
    settings.category = null;
    saveSettings();
    document.body.dataset.theme = 'none';
    $('diaryScreen').hidden = true;
    $('chooseScreen').hidden = false;
    setThemeColor();
    try {
      const all = await DB.getEntries();
      ['plant', 'animal'].forEach(cat => {
        const n = all.filter(e => e.category === cat).length;
        const name = settings.names[cat];
        $('meta-' + cat).textContent = n
          ? (name ? name + ', ' : '') + plural(n, 'day') + ' logged'
          : 'Start a new diary';
      });
    } catch (e) { /* storage unavailable: cards still work */ }
  }

  async function openDiary(cat) {
    settings.category = cat;
    saveSettings();
    document.body.dataset.theme = cat;
    $('chooseScreen').hidden = true;
    $('diaryScreen').hidden = false;
    $('titleIcon').setAttribute('href', CATS[cat].icon);
    $('emptyIcon').setAttribute('href', CATS[cat].icon);
    $('entryNote').placeholder = CATS[cat].note;
    updateTitle();
    setThemeColor();
    window.scrollTo(0, 0);
    await refresh();
  }

  function updateTitle() {
    const cat = settings.category;
    $('diaryTitle').textContent = settings.names[cat] || CATS[cat].defaultName;
  }

  async function refresh() {
    try {
      entries = await DB.getEntries(settings.category);
    } catch (e) {
      entries = [];
      toast('Storage is blocked in this browser, so photos can’t be saved.', 5000);
    }
    renderTimeline();
  }

  // ===== Timeline =====
  function renderTimeline() {
    const tl = $('timeline');
    tl.textContent = '';

    const sorted = entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const firstDate = sorted.length ? sorted[0].date : null;
    if (settings.newestFirst) sorted.reverse();

    const photoCount = entries.reduce((n, e) => n + e.photoIds.length, 0);
    $('summary').textContent = entries.length
      ? plural(photoCount, 'photo') + ' across ' + plural(entries.length, 'day')
      : '';
    $('emptyState').hidden = entries.length > 0;
    $('sortBtn').hidden = entries.length < 2;
    $('sortLabel').textContent = settings.newestFirst ? 'Newest' : 'Oldest';
    $('sortBtn').setAttribute('aria-label', settings.newestFirst ? 'Showing newest first. Tap for oldest first.' : 'Showing oldest first. Tap for newest first.');

    sorted.forEach(entry => tl.appendChild(dayCard(entry, daysBetween(firstDate, entry.date) + 1)));
    cleanupThumbs();
  }

  function dayCard(entry, dayNum) {
    const card = el('article', 'day');

    const head = el('div', 'day-head');
    const titles = el('div');
    titles.append(el('span', 'day-badge', 'Day ' + dayNum), el('h3', 'day-date', formatDate(entry.date)));
    const edit = el('button', 'icon-btn day-edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit ' + formatDate(entry.date));
    edit.appendChild(icon('edit'));
    edit.addEventListener('click', () => openSheet('edit', entry));
    head.append(titles, edit);

    const album = el('div', 'album n' + entry.photoIds.length);
    entry.photoIds.forEach((pid, i) => {
      const btn = el('button', 'ph');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Open photo ' + (i + 1) + ' of ' + entry.photoIds.length);
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      btn.appendChild(img);
      thumbUrl(pid).then(u => { if (u) img.src = u; });
      btn.addEventListener('click', () => openViewer(entry, i, dayNum));
      album.appendChild(btn);
    });

    card.append(head, album);
    if (entry.note) card.appendChild(el('p', 'day-note', entry.note));
    return card;
  }

  function thumbUrl(pid) {
    if (!thumbCache.has(pid)) {
      thumbCache.set(pid, DB.getPhoto(pid)
        .then(rec => (rec ? URL.createObjectURL(rec.thumb) : null))
        .catch(() => null));
    }
    return thumbCache.get(pid);
  }

  // Free memory for photos no longer shown
  function cleanupThumbs() {
    const live = new Set();
    entries.forEach(e => e.photoIds.forEach(id => live.add(id)));
    thumbCache.forEach((p, id) => {
      if (!live.has(id)) {
        thumbCache.delete(id);
        p.then(u => u && URL.revokeObjectURL(u));
      }
    });
  }

  // ===== Picking photos =====
  function openPicker(target) {
    pickTarget = target;
    $('pickSheet').hidden = false;
    lockScroll(true);
  }
  function closePicker() {
    $('pickSheet').hidden = true;
    if (!sheet) lockScroll(false);
  }

  async function handleFiles(input) {
    let files = Array.from(input.files || []);
    input.value = ''; // lets the same photo be picked again later
    if (!files.length) return;

    let room = MAX_PHOTOS;
    if (pickTarget === 'sheet' && sheet) room = MAX_PHOTOS - sheetPhotos().length;
    let skipped = 0;
    if (files.length > room) {
      skipped = files.length - room;
      files = files.slice(0, Math.max(0, room));
    }
    if (!files.length) { toast('This date already has 3 photos.'); return; }

    toast(files.length > 1 ? 'Compressing ' + files.length + ' photos…' : 'Compressing photo…', 60000);

    const added = [];
    let before = 0, after = 0, failed = 0;
    for (const file of files) {
      try {
        const r = await Photo.compress(file);
        added.push({ id: uid(), full: r.full, thumb: r.thumb, url: URL.createObjectURL(r.thumb) });
        before += file.size;
        after += r.full.size + r.thumb.size;
      } catch (e) {
        failed++;
      }
    }

    if (!added.length) {
      toast('That photo couldn’t be opened. Try a JPG or PNG.', 4000);
      return;
    }

    if (pickTarget === 'sheet' && sheet) {
      sheet.added.push(...added);
      renderSheet();
    } else {
      openSheet('add', null, added);
    }

    let msg = 'Compressed ' + formatSize(before) + ' to ' + formatSize(after);
    if (skipped) msg = 'Only 3 photos per date, so ' + plural(skipped, 'photo') + ' skipped';
    if (failed) msg = plural(failed, 'photo') + ' couldn’t be opened';
    toast(msg);
  }

  // ===== Add / edit sheet =====
  // The sheet always edits "the day for the chosen date".
  // Add mode: if that date already has photos, new ones join them.
  // Edit mode: changing the date moves the whole day.
  function openSheet(mode, entry, added) {
    sheet = {
      mode,
      base: mode === 'edit' ? entry : null,
      added: added || [],
      removed: new Set(),
      noteTouched: false,
      saved: false
    };
    $('entryTitle').textContent = mode === 'edit' ? 'Edit day' : 'New photos';
    $('entryDate').max = todayStr();
    $('entryDate').value = mode === 'edit' ? entry.date : todayStr();
    $('entryNote').value = mode === 'edit' ? (entry.note || '') : '';
    $('entryDelete').hidden = mode !== 'edit';
    if (mode === 'add') syncAddTarget();
    $('entrySheet').hidden = false;
    lockScroll(true);
    renderSheet();
  }

  // Add mode: find the existing day for the chosen date, if any
  function syncAddTarget() {
    const date = $('entryDate').value;
    const existing = entries.find(e => e.date === date) || null;
    if (existing !== sheet.base) {
      sheet.base = existing;
      sheet.removed.clear();
      if (!sheet.noteTouched) $('entryNote').value = existing ? (existing.note || '') : '';
    }
  }

  function keptExisting() {
    return sheet.base ? sheet.base.photoIds.filter(id => !sheet.removed.has(id)) : [];
  }
  function sheetPhotos() {
    return keptExisting().map(id => ({ id, existing: true }))
      .concat(sheet.added.map(p => ({ id: p.id, url: p.url })));
  }

  function renderSheet() {
    const photos = sheetPhotos();
    const box = $('slots');
    box.textContent = '';

    photos.forEach((p, i) => {
      const slot = el('div', 'slot' + (i >= MAX_PHOTOS ? ' over' : ''));
      const img = el('img');
      img.alt = '';
      if (p.url) img.src = p.url;
      else thumbUrl(p.id).then(u => { if (u) img.src = u; });
      const rm = el('button', 'slot-remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      rm.appendChild(icon('close', 'icon-sm'));
      rm.addEventListener('click', () => removeSheetPhoto(p));
      slot.append(img, rm);
      box.appendChild(slot);
    });

    if (photos.length < MAX_PHOTOS) {
      const add = el('button', 'slot-add');
      add.type = 'button';
      add.append(icon('plus'), el('span', null, 'Add'));
      add.addEventListener('click', () => openPicker('sheet'));
      box.appendChild(add);
    }

    $('slotCount').textContent = photos.length + ' of ' + MAX_PHOTOS;
    validateSheet(photos.length);
  }

  function removeSheetPhoto(p) {
    if (p.existing) {
      sheet.removed.add(p.id);
    } else {
      const i = sheet.added.findIndex(a => a.id === p.id);
      if (i !== -1) { URL.revokeObjectURL(sheet.added[i].url); sheet.added.splice(i, 1); }
    }
    renderSheet();
  }

  function validateSheet(total) {
    const date = $('entryDate').value;
    let error = '';
    let hint = '';

    const otherDay = sheet.mode === 'edit'
      ? entries.find(e => e.date === date && e.id !== sheet.base.id)
      : null;

    if (!date) error = 'Pick a date.';
    else if (date > todayStr()) error = 'The date can’t be in the future.';
    else if (otherDay) error = 'That date already has its own entry. Pick another date.';
    else if (total > MAX_PHOTOS) {
      error = 'Only 3 photos per date. Remove ' + plural(total - MAX_PHOTOS, 'photo') +
        (sheet.mode === 'add' ? ' or pick another date.' : '.');
    } else if (total === 0) {
      error = sheet.mode === 'edit' ? 'Add at least one photo, or delete this day.' : 'Add at least one photo.';
    }

    if (sheet.mode === 'add' && sheet.base && !error) {
      hint = 'This date already has ' + plural(sheet.base.photoIds.length, 'photo') + '. New photos will join them.';
    } else if (sheet.mode === 'add' && !sheet.base) {
      hint = 'Set to the day you added the photo. Tap the date to change it.';
    }

    $('entryError').textContent = error;
    $('dateHint').textContent = hint;
    $('entrySave').disabled = !!error;
  }

  async function saveSheet(e) {
    e.preventDefault();
    if ($('entrySave').disabled) return;

    const cat = settings.category;
    const date = $('entryDate').value;
    const id = entryId(cat, date);
    const entry = {
      id,
      category: cat,
      date,
      note: $('entryNote').value.trim(),
      photoIds: keptExisting().concat(sheet.added.map(p => p.id)),
      updated: Date.now()
    };
    const change = {
      putEntry: entry,
      putPhotos: sheet.added.map(p => ({ id: p.id, full: p.full, thumb: p.thumb })),
      deletePhotoIds: Array.from(sheet.removed)
    };
    if (sheet.mode === 'edit' && sheet.base.id !== id) change.deleteEntryId = sheet.base.id;

    $('entrySave').disabled = true;
    try {
      await DB.write(change);
    } catch (err) {
      $('entrySave').disabled = false;
      toast('Couldn’t save. Your phone may be low on storage.', 4000);
      return;
    }

    // keep the new thumbnails' URLs for the timeline
    sheet.added.forEach(p => thumbCache.set(p.id, Promise.resolve(p.url)));
    const wasEdit = sheet.mode === 'edit';
    sheet.saved = true;
    closeSheet(true);
    askPersistentStorage();
    await refresh();
    toast(wasEdit ? 'Changes saved' : 'Saved to ' + formatDate(date));
  }

  function closeSheet(force) {
    if (!sheet) return;
    if (!force && !sheet.saved && sheet.added.length &&
        !confirm('Discard ' + plural(sheet.added.length, 'new photo') + '?')) return;
    if (!sheet.saved) sheet.added.forEach(p => URL.revokeObjectURL(p.url));
    sheet = null;
    $('entrySheet').hidden = true;
    lockScroll(false);
  }

  async function deleteDay() {
    const base = sheet.base;
    if (!confirm('Delete ' + formatDate(base.date) + ' and its photos? This can’t be undone.')) return;
    try {
      await DB.write({ deleteEntryId: base.id, deletePhotoIds: base.photoIds });
    } catch (e) {
      toast('Couldn’t delete. Please try again.');
      return;
    }
    closeSheet(true);
    await refresh();
    toast('Day deleted');
  }

  // Ask the browser not to clear the diary when space runs low
  let persistAsked = false;
  function askPersistentStorage() {
    if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }

  // ===== Viewer =====
  async function openViewer(entry, index, dayNum) {
    viewer = { entry, index, dayNum, url: null };
    $('viewer').hidden = false;
    lockScroll(true);
    $('viewerNote').textContent = entry.note || '';
    await showViewerPhoto();
  }

  async function showViewerPhoto() {
    if (!viewer) return;
    const { entry, index } = viewer;
    $('viewerDate').textContent = 'Day ' + viewer.dayNum + ', ' + formatDate(entry.date);
    $('viewerCount').textContent = entry.photoIds.length > 1 ? (index + 1) + ' / ' + entry.photoIds.length : '';
    $('viewerPrev').hidden = index === 0;
    $('viewerNext').hidden = index === entry.photoIds.length - 1;

    const rec = await DB.getPhoto(entry.photoIds[index]).catch(() => null);
    if (!viewer || viewer.index !== index) return; // user moved on
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer.url = rec ? URL.createObjectURL(rec.full) : null;
    $('viewerImg').src = viewer.url || '';
  }

  function stepViewer(dir) {
    if (!viewer) return;
    const next = viewer.index + dir;
    if (next < 0 || next >= viewer.entry.photoIds.length) return;
    viewer.index = next;
    showViewerPhoto();
  }

  function closeViewer() {
    if (!viewer) return;
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer = null;
    $('viewerImg').removeAttribute('src');
    $('viewer').hidden = true;
    lockScroll(false);
  }

  // ===== Events =====
  document.querySelectorAll('.choice').forEach(btn => {
    btn.addEventListener('click', () => openDiary(btn.dataset.cat));
  });
  $('switchBtn').addEventListener('click', showChoose);

  $('titleBtn').addEventListener('click', () => {
    const cat = settings.category;
    const current = settings.names[cat] || '';
    const name = prompt('Name your ' + CATS[cat].word + ':', current || CATS[cat].defaultName);
    if (name === null) return;
    settings.names[cat] = name.trim().slice(0, 40);
    saveSettings();
    updateTitle();
  });

  $('sortBtn').addEventListener('click', () => {
    settings.newestFirst = !settings.newestFirst;
    saveSettings();
    renderTimeline();
  });

  $('addBtn').addEventListener('click', () => openPicker('new'));
  $('pickCamera').addEventListener('click', () => { closePicker(); $('cameraInput').click(); });
  $('pickGallery').addEventListener('click', () => { closePicker(); $('galleryInput').click(); });
  $('pickCancel').addEventListener('click', closePicker);
  $('pickSheet').addEventListener('click', e => { if (e.target === $('pickSheet')) closePicker(); });
  $('cameraInput').addEventListener('change', e => handleFiles(e.target));
  $('galleryInput').addEventListener('change', e => handleFiles(e.target));

  $('entryForm').addEventListener('submit', saveSheet);
  $('entryClose').addEventListener('click', () => closeSheet(false));
  $('entrySheet').addEventListener('click', e => { if (e.target === $('entrySheet')) closeSheet(false); });
  $('entryDelete').addEventListener('click', deleteDay);
  $('entryNote').addEventListener('input', () => { if (sheet) sheet.noteTouched = true; });
  $('entryDate').addEventListener('change', () => {
    if (!sheet) return;
    if (sheet.mode === 'add') syncAddTarget();
    renderSheet();
  });

  $('viewerClose').addEventListener('click', closeViewer);
  $('viewerPrev').addEventListener('click', () => stepViewer(-1));
  $('viewerNext').addEventListener('click', () => stepViewer(1));
  let touchX = null;
  $('viewer').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  $('viewer').addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
  });

  document.addEventListener('keydown', e => {
    if (viewer) {
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowLeft') stepViewer(-1);
      if (e.key === 'ArrowRight') stepViewer(1);
    } else if (e.key === 'Escape') {
      if (!$('pickSheet').hidden) closePicker();
      else if (sheet) closeSheet(false);
    }
  });

  // ===== Start =====
  if (settings.category && CATS[settings.category]) openDiary(settings.category);
  else showChoose();

  // Offline support (works on https:// or localhost)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
