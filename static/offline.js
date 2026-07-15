/* Offline storage for the Zebra cashier (loaded before zebra.js).
   Two IndexedDB stores, wrapped in promises, exposed as the ZebraOffline
   global:
     - "catalog": one record — the full /api/catalog payload (products +
       quick-tap groups), mirrored while online so barcode lookups, name
       search and the quick-tap buttons keep working when the server is
       unreachable (the server is in Sydney, the shop in Kathmandu — any
       internet problem takes it away entirely).
     - "outbox": completed sales that couldn't reach the server, keyed by a
       client-generated UUID so the /api/sales/sync endpoint can import them
       idempotently — a retry or a lost response can never double-record.
   No frameworks, no external libraries (confirmed decision 1). */

(function () {
  "use strict";

  const DB_NAME = "zebra-pos";
  const DB_VERSION = 1;
  const CATALOG_KEY = "payload";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("catalog")) {
          db.createObjectStore("catalog");
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "client_uuid" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, work) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, mode);
          const store = t.objectStore(storeName);
          const result = work(store);
          // work() returns undefined for write-only calls (e.g. store.put()
          // with nothing to read back) — only unwrap __value when a holder
          // from reqValue() was actually returned.
          t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function reqValue(request) {
    // Wrap an IDBRequest so tx() can resolve with its result after commit.
    const holder = {};
    request.onsuccess = () => {
      holder.__value = request.result;
    };
    return holder;
  }

  window.ZebraOffline = {
    saveCatalog(payload) {
      return tx("catalog", "readwrite", (store) => {
        store.put({ saved_at: Date.now(), payload }, CATALOG_KEY);
      });
    },

    getCatalog() {
      // Resolves to { saved_at, payload } or undefined if never synced.
      return tx("catalog", "readonly", (store) => reqValue(store.get(CATALOG_KEY)));
    },

    queueSale(sale) {
      // sale: { client_uuid, date, time, items } — same shape the
      // /api/sales/sync endpoint accepts.
      return tx("outbox", "readwrite", (store) => {
        store.put(sale);
      });
    },

    listQueuedSales() {
      return tx("outbox", "readonly", (store) => reqValue(store.getAll()));
    },

    countQueuedSales() {
      return tx("outbox", "readonly", (store) => reqValue(store.count()));
    },

    removeQueuedSales(uuids) {
      return tx("outbox", "readwrite", (store) => {
        uuids.forEach((u) => store.delete(u));
      });
    },
  };
})();
