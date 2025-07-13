const CACHE_NAME = 'budget-app-v3';
const SYNC_TAG = 'sync-budget-data';
const API_URL = 'https://script.google.com/macros/s/AKfycbzUvxwJT3VCAZRSJ1cHZ7Q0dlzcr1eopAscKo-wgAmgQBkYnYXl3psMZ6oZUg41Lc09/exec';

// Install Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll([
          '/',
          '/budget.html',
          '/budgetstyle.css',
          'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap',
          'https://fonts.googleapis.com/icon?family=Material+Icons'
        ]);
      })
  );
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Background Sync Event
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    console.log('Background sync triggered');
    event.waitUntil(
      syncDataWithGoogleSheets().catch(error => {
        console.error('Sync failed:', error);
        // Simpan status error untuk ditampilkan nanti
        return updateSyncStatus([], 'error', error.message);
      })
    );
  }
});

// Fungsi utama untuk sinkronisasi
async function syncDataWithGoogleSheets() {
  // 1. Ambil data pending dari IndexedDB
  const pendingData = await getPendingDataFromIDB();
  
  if (!pendingData || pendingData.length === 0) {
    console.log('No pending data to sync');
    return;
  }

  // 2. Siapkan data untuk dikirim
  const batchSize = 50; // Sesuaikan dengan kebutuhan
  const batches = [];
  
  for (let i = 0; i < pendingData.length; i += batchSize) {
    batches.push(pendingData.slice(i, i + batchSize));
  }

  // 3. Proses setiap batch
  for (const batch of batches) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: "saveBudget",
          data: batch
        })
      });

      // 4. Verifikasi response (meskipun no-cors)
      if (response && response.ok) {
        await updateSyncStatus(
          batch.map(item => item.id), 
          'synced'
        );
        console.log('Successfully synced batch of', batch.length);
      } else {
        throw new Error('Server response not OK');
      }
    } catch (error) {
      console.error('Error syncing batch:', error);
      await updateSyncStatus(
        batch.map(item => item.id), 
        'pending', 
        error.message
      );
      throw error; // Trigger retry
    }
  }

  // 5. Kirim notifikasi ke client
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'sync-complete',
        count: pendingData.length
      });
    });
  });
}

// Helper: Get pending data dari IndexedDB
async function getPendingDataFromIDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('BudgetDB', 1);
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('budgets', 'readonly');
      const store = transaction.objectStore('budgets');
      const index = store.index('by_syncStatus');
      const getRequest = index.getAll('pending');
      
      getRequest.onsuccess = () => {
        resolve(getRequest.result || []);
      };
      
      getRequest.onerror = () => {
        console.error('Error getting pending data');
        resolve([]);
      };
    };
    
    request.onerror = () => {
      console.error('Error opening IndexedDB');
      resolve([]);
    };
  });
}

// Helper: Update status sync di IndexedDB
async function updateSyncStatus(ids, status, error = null) {
  return new Promise((resolve) => {
    const request = indexedDB.open('BudgetDB', 1);
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('budgets', 'readwrite');
      const store = transaction.objectStore('budgets');
      
      const promises = ids.map(id => {
        return new Promise((res) => {
          const getRequest = store.get(id);
          
          getRequest.onsuccess = () => {
            const data = getRequest.result;
            if (data) {
              data.syncStatus = status;
              if (error) data.syncError = error;
              
              const putRequest = store.put(data);
              putRequest.onsuccess = res;
              putRequest.onerror = res;
            } else {
              res();
            }
          };
          
          getRequest.onerror = res;
        });
      });
      
      Promise.all(promises).then(resolve);
    };
    
    request.onerror = () => {
      console.error('Error opening IndexedDB for update');
      resolve();
    };
  });
}

// Cache strategy untuk aset
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Cache-first strategy untuk aset statis
  if (event.request.url.includes('/styles/') || 
      event.request.url.includes('/scripts/') ||
      event.request.url.includes('/images/')) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    );
    return;
  }
  
  // Network-first untuk API requests
  if (event.request.url.includes(API_URL)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone response untuk cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  
  // Default: network first
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});
