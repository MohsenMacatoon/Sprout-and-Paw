/* ===== Sprout & Paw: storage =====
   Saves diary days and photos on the phone using IndexedDB
   (localStorage is too small for photos). Nothing is uploaded anywhere.

   entries store: { id: "plant:2026-10-04", category, date, note, photoIds: [...] }
   photos store:  { id, thumb: Blob, full: Blob } */
(function (global) {
  'use strict';

  const DB_NAME = 'sprout-and-paw';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function done(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // All days, or only one category's days
  async function getEntries(category) {
    const db = await open();
    const all = await done(db.transaction('entries').objectStore('entries').getAll());
    return category ? all.filter(e => e.category === category) : all;
  }

  async function getPhoto(id) {
    const db = await open();
    return done(db.transaction('photos').objectStore('photos').get(id));
  }

  // One safe write: everything succeeds together or nothing changes.
  // { putEntry, deleteEntryId, putPhotos: [], deletePhotoIds: [] }
  async function write(change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['entries', 'photos'], 'readwrite');
      const entries = tx.objectStore('entries');
      const photos = tx.objectStore('photos');

      (change.putPhotos || []).forEach(p => photos.put(p));
      (change.deletePhotoIds || []).forEach(id => photos.delete(id));
      if (change.deleteEntryId) entries.delete(change.deleteEntryId);
      if (change.putEntry) entries.put(change.putEntry);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Save cancelled'));
    });
  }

  global.DB = { getEntries, getPhoto, write };
})(window);
