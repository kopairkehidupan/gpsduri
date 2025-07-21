// ---------------- END POINT untuk mengambil data dari server-------------//
    // Database setup for IndexedDB
    const DB_NAME = 'KebunDatabase';
      const DB_VERSION = 2; // Versi dinaikkan untuk tambahan store
      const STORES = {
        PROD_ACTUAL: 'prodActual',
        PROD_BUDGET: 'prodBudget',
        BUDGET: 'budget',
        ACTUAL: 'actual',
        SYNC_META: 'syncMeta' // Tambahan store untuk metadata
      };
    
    let db;
    
    function openDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
          console.error('Database error:', event.target.error);
          reject(event.target.error);
        };
        
        request.onsuccess = (event) => {
          db = event.target.result;
          
          // Tambahkan handler untuk error yang mungkin terjadi setelah open
          db.onerror = (event) => {
            console.error('Database error after open:', event.target.error);
            // Tidak reject di sini, hanya log karena mungkin recoverable
          };
          
          // Tambahkan handler untuk version change
          db.onversionchange = (event) => {
            db.close();
            console.log('Database closed due to version change');
          };
          
          console.log('Database opened successfully');
          resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          // Create object stores
          if (!db.objectStoreNames.contains(STORES.PROD_ACTUAL)) {
            const store = db.createObjectStore(STORES.PROD_ACTUAL, { keyPath: 'id' });
            store.createIndex('by_timestamp', 'Timestamp', { unique: false });
          }
          
          if (!db.objectStoreNames.contains(STORES.PROD_BUDGET)) {
            const store = db.createObjectStore(STORES.PROD_BUDGET, { keyPath: 'id' });
            store.createIndex('by_timestamp', 'Timestamp', { unique: false });
          }
          
          if (!db.objectStoreNames.contains(STORES.BUDGET)) {
            const store = db.createObjectStore(STORES.BUDGET, { keyPath: 'id' });
            store.createIndex('by_timestamp', 'Timestamp', { unique: false });
          }
          
          if (!db.objectStoreNames.contains(STORES.ACTUAL)) {
            const store = db.createObjectStore(STORES.ACTUAL, { keyPath: 'id' });
            store.createIndex('by_timestamp', 'Timestamp', { unique: false });
          }
          
          if (!db.objectStoreNames.contains(STORES.SYNC_META)) {
            db.createObjectStore(STORES.SYNC_META, { keyPath: 'storeName' });
          }
          
          console.log('Database upgrade complete');
        };

        // Tambahkan handler untuk blocked event
        request.onblocked = (event) => {
          console.error('Database blocked, closing all connections');
          if (db) db.close();
          event.target.source.close();
          window.location.reload(); // Force refresh jika diperlukan
        };
      });
    }

    // Fungsi untuk mendapatkan timestamp sync terakhir
    async function getLastSyncTime(storeName) {
      return new Promise((resolve, reject) => {
        // Tambahkan pengecekan db
        if (!db) {
          reject(new Error('Database not initialized'));
          return;
        }
        
        const transaction = db.transaction(STORES.SYNC_META, 'readonly');
        const store = transaction.objectStore(STORES.SYNC_META);
        const request = store.get(storeName);
        
        request.onsuccess = () => resolve(request.result?.lastSync || null);
        request.onerror = () => reject(new Error('Failed to get sync time'));
      });
    }
    
    // Fungsi untuk menyimpan timestamp sync
    async function setLastSyncTime(storeName) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.SYNC_META, 'readwrite');
        const store = transaction.objectStore(STORES.SYNC_META);
        const request = store.put({ 
          storeName, 
          lastSync: new Date().toISOString() 
        });
        
        request.onsuccess = resolve;
        request.onerror = reject;
      });
    }
    
    // Fungsi untuk sync data dengan chunk processing
    async function syncStoreData(endpoint) {
      const CHUNK_SIZE = 2000;
      try {
        if (!db || db.version !== DB_VERSION) {
          db = await openDatabase();
        }
    
        // [1] Ambil semua data terbaru dari sheet
        const [countData, allSheetData] = await Promise.all([
          fetchDataFromSheets(endpoint.url, `${endpoint.action}Count`),
          fetchDataFromSheets(endpoint.url, endpoint.action)
        ]);
        
        const totalRecords = countData.count || 0;
        const sheetData = Array.isArray(allSheetData) ? allSheetData : (allSheetData?.data || []);
        
        // [2] Ambil semua ID dari IndexedDB dan Sheet dengan format yang konsisten
        const [dbIds, sheetIds] = await Promise.all([
          getAllIdsFromIndexedDB(endpoint.store),
          Promise.resolve(sheetData.map(item => String(item.id))) // Pastikan string untuk konsistensi
        ]);
        
        console.log(`Sync ${endpoint.store}: DB IDs: ${dbIds.length}, Sheet IDs: ${sheetIds.length}`);
    
        // [3] Cari ID yang perlu dihapus (ada di DB tapi tidak ada di Sheet)
        const idsToDelete = dbIds.filter(dbId => !sheetIds.includes(String(dbId)));
        console.log(`IDs to delete: ${idsToDelete.length}`, idsToDelete);
    
        // [4] Proses penghapusan dalam batch
        let deletedCount = 0;
        if (idsToDelete.length > 0) {
          // Hapus dalam batch untuk menghindari timeout
          const BATCH_SIZE = 500;
          for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
            const batch = idsToDelete.slice(i, i + BATCH_SIZE);
            deletedCount += await deleteRecordsFromIndexedDB(endpoint.store, batch);
            console.log(`Deleted batch ${i} to ${i + batch.length}`);
          }
        }
    
        // [5] Proses tambah/update data
        let added = 0, updated = 0;
        if (sheetData.length > 0) {
          for (let i = 0; i < sheetData.length; i += CHUNK_SIZE) {
            const chunk = sheetData.slice(i, i + CHUNK_SIZE);
            const result = await processDataChunkWithRetry(endpoint.store, chunk);
            added += result.added;
            updated += result.updated;
            
            updateProgress(
              (i / sheetData.length) * 100,
              endpoint.name,
              'active',
              i,
              totalRecords
            );
            
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
    
        console.log(`Sync result: ${added} added, ${updated} updated, ${deletedCount} deleted`);
        await setLastSyncTime(endpoint.store);
        return { added, updated, deleted: deletedCount };
        
      } catch (error) {
        console.error(`Sync failed for ${endpoint.name}:`, error);
        throw error;
      }
    }

    // Fungsi untuk mendapatkan semua ID dengan konsisten
    async function getAllIdsFromIndexedDB(storeName) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAllKeys();
        
        request.onsuccess = () => {
          // Konversi semua ID ke string untuk konsistensi
          const ids = request.result.map(id => 
            typeof id === 'number' ? String(id) : id
          );
          resolve(ids);
        };
        request.onerror = () => reject(new Error('Failed to get IDs from IndexedDB'));
      });
    }
    
    // Fungsi penghapusan yang lebih robust
    async function deleteRecordsFromIndexedDB(storeName, ids) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        let deletedCount = 0;
        let errorCount = 0;
    
        // Handle transaction completion
        transaction.oncomplete = () => {
          console.log(`Deleted ${deletedCount} records successfully`);
          resolve(deletedCount);
        };
        
        transaction.onerror = (event) => {
          console.error('Transaction error:', event.target.error);
          reject(event.target.error);
        };
    
        // Proses penghapusan per ID
        ids.forEach(id => {
          // Handle baik ID string maupun number
          const idToDelete = isNaN(id) ? id : Number(id);
          const request = store.delete(idToDelete);
          
          request.onsuccess = () => {
            deletedCount++;
          };
          
          request.onerror = (event) => {
            errorCount++;
            console.error(`Failed to delete ID ${id}:`, event.target.error);
          };
        });
      });
    }
    
    // Fungsi baru dengan retry mechanism
    async function processDataChunkWithRetry(storeName, chunk, retries = 3) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await processDataChunk(storeName, chunk);
        } catch (error) {
          console.warn(`Attempt ${attempt} failed for chunk:`, error);
          if (attempt === retries) throw error;
          
          // Tunggu sebelum retry
          await new Promise(resolve => setTimeout(resolve, 200 * attempt));
          
          // Coba buka kembali database
          if (db) db.close();
          db = await openDatabase();
        }
      }
    }

    // Fungsi untuk memproses chunk data
    async function processDataChunk(storeName, chunk) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        let added = 0;
        let updated = 0;
        
        const processNext = (index) => {
          if (index >= chunk.length) {
            resolve({ added, updated });
            return;
          }
          
          const item = chunk[index];
          const getRequest = store.get(item.id);
          
          getRequest.onsuccess = () => {
            const existing = getRequest.result;
            
            if (existing) {
              // Update existing
              const putRequest = store.put(item);
              putRequest.onsuccess = () => {
                updated++;
                processNext(index + 1);
              };
              putRequest.onerror = () => processNext(index + 1);
            } else {
              // Add new
              const addRequest = store.add(item);
              addRequest.onsuccess = () => {
                added++;
                processNext(index + 1);
              };
              addRequest.onerror = () => processNext(index + 1);
            }
          };
          
          getRequest.onerror = () => processNext(index + 1);
        };
        
        processNext(0);
      });
    }
    
    // Function to save data to IndexedDB
    function saveToIndexedDB(storeName, data) {
      return new Promise((resolve, reject) => {
        if (!db) {
          reject(new Error('Database not initialized'));
          return;
        }
        
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        // Clear existing data first
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = () => {
          console.log(`Cleared existing data in ${storeName}`);
          
          // Add all new data
          const requests = data.map(item => {
            return new Promise((innerResolve, innerReject) => {
              const request = store.add(item);
              request.onsuccess = () => innerResolve();
              request.onerror = (event) => innerReject(event.target.error);
            });
          });
          
          Promise.all(requests)
            .then(() => {
              console.log(`Saved ${data.length} items to ${storeName}`);
              resolve();
            })
            .catch(error => {
              console.error(`Error saving to ${storeName}:`, error);
              reject(error);
            });
        };
        
        clearRequest.onerror = (event) => {
          console.error(`Error clearing ${storeName}:`, event.target.error);
          reject(event.target.error);
        };
      });
    }
    
    // Function to fetch data from Google Sheets
    async function fetchDataFromSheets(url, action) {
      try {
        console.log(`Fetching ${url}?action=${action}`);
        const response = await fetch(`${url}?action=${action}`);
        
        if (!response.ok) {
          const text = await response.text();
          console.error('Response not OK:', text);
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const text = await response.text();
        console.log('Raw response:', text); // Log raw response
        
        try {
          const data = JSON.parse(text);
          console.log('Parsed data:', data);
          
          // Handle inconsistent response formats
          if (action.includes('Count')) {
            return data.count ? data : { count: 0 };
          } else {
            return data.data || data || [];
          }
        } catch (jsonError) {
          console.error('JSON parse error:', jsonError);
          throw new Error('Invalid JSON response: ' + text);
        }
      } catch (error) {
        console.error('Fetch error:', error);
        throw error;
      }
    }

    async function fetchWithTimeout(url, options = {}, timeout = 10000) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal 
        });
        clearTimeout(id);
        return response;
      } catch (error) {
        clearTimeout(id);
        throw error;
      }
    }
    
    // Fungsi JSONP fallback
    function fetchWithJsonp(url, action) {
      return new Promise((resolve, reject) => {
        const callbackName = `jsonp_${Date.now()}`;
        const script = document.createElement('script');
        
        window[callbackName] = (data) => {
          resolve(data);
          delete window[callbackName];
          document.body.removeChild(script);
        };
        
        script.src = `${url}?action=${action}&callback=${callbackName}`;
        script.onerror = () => {
          reject(new Error('JSONP request failed'));
          delete window[callbackName];
          document.body.removeChild(script);
        };
        
        document.body.appendChild(script);
      });
    }

    // Function to update progress
    function updateProgress(progress, currentStep, status = 'active', loaded = 0, total = 0) {
      const progressFill = document.getElementById('progressFill');
      const progressText = document.getElementById('progressText');
      const stepElements = document.querySelectorAll('.step');
      
      // Update progress bar
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `${Math.round(progress)}%`;
      
      // Update step status
      stepElements.forEach(step => {
        const stepName = step.dataset.step;
        if (stepName === currentStep) {
          step.className = 'step ' + status;
          const detailsEl = step.querySelector('.step-details');
          if (total > 0) {
            detailsEl.textContent = `${loaded}/${total} data masuk`;
          } else if (status === 'completed') {
            detailsEl.textContent = `${loaded} data masuk`;
          } else if (status === 'failed') {
            detailsEl.textContent = 'Gagal mengambil data';
          } else {
            detailsEl.textContent = 'Menyambungkan...';
          }
        } else if (getStepOrder(stepName) < getStepOrder(currentStep)) {
          step.className = 'step completed';
        }
      });
    }

    // Helper function untuk menentukan urutan step
    function getStepOrder(stepName) {
      const order = {
        'prodActual': 1,
        'prodBudget': 2,
        'budget': 3,
        'actual': 4
      };
      return order[stepName] || 0;
    }

    // Fungsi untuk menampilkan notifikasi di progress bar
    function showProgressNotification(message, isSuccess) {
      const notification = document.getElementById('progressNotification');
      notification.innerHTML = `
        <i class="material-icons">${isSuccess ? 'check_circle' : 'error'}</i>
        ${message}
      `;
      notification.className = `notification ${isSuccess ? 'success' : 'error'}`;
      notification.style.display = 'block';
      
      // Sembunyikan otomatis setelah 3 detik
      if (isSuccess) {
        setTimeout(() => {
          notification.style.display = 'none';
          showProgressModal(false);
        }, 3000);
      }
    }
    
    // Show/hide modal
    function showProgressModal(show) {
      document.getElementById('progressModal').style.display = show ? 'flex' : 'none';
    }
    
    // Modified loadAllData function with data count tracking
    async function loadAllData() {
      showProgressModal(true);
      updateProgress(0, 'prodActual');
      
        // Force close and reopen
        if (db) {
          try {
            db.close();
          } catch (e) {
            console.log('Error closing db:', e);
          }
        }
        
        // Add delay to ensure clean state
        await new Promise(resolve => setTimeout(resolve, 500));
      
        try {
        // Tunggu sampai database benar-benar terbuka
        db = await openDatabase();
        console.log('Database opened:', db);
        if (!db) throw new Error('Failed to open database');
        
        const endpoints = [
          { 
            name: 'prodActual',
            url: 'https://script.google.com/macros/s/AKfycbyqGIhP5Cqo6u84CiIMnzgJtcouL2PXSkS3Weq6k2emvncurac6WJViqBCAcPyLF-n7ZQ/exec',
            action: 'getAllProdActual',
            store: STORES.PROD_ACTUAL
          },
          { 
            name: 'prodBudget',
            url: 'https://script.google.com/macros/s/AKfycbx6U6vZZu8YalBysJerAxRzwMYc5XPqs-CY7W1yVvHFIpIbaf5LAhvXM2hI01LLc2_K/exec',
            action: 'getAllProdBudget',
            store: STORES.PROD_BUDGET
          },
          { 
            name: 'budget',
            url: 'https://script.google.com/macros/s/AKfycbzUvxwJT3VCAZRSJ1cHZ7Q0dlzcr1eopAscKo-wgAmgQBkYnYXl3psMZ6oZUg41Lc09/exec',
            action: 'getAllBudget',
            store: STORES.BUDGET
          },
          { 
            name: 'actual',
            url: 'https://script.google.com/macros/s/AKfycbyDxiaYGwHV202um7tr7LLhGvEWnAvDGiBid4vD8yMfGbNu3AJab9XcJgORkIl_BRwJbw/exec',
            action: 'getAllActual',
            store: STORES.ACTUAL
          }
        ];
        
        // Lakukan full sync pertama kali atau periodic
        const lastFullSync = await getLastSyncTime('lastFullSync');
        const daysSinceFullSync = lastFullSync ? 
          (new Date() - new Date(lastFullSync)) / (1000 * 60 * 60 * 24) : Infinity;
        
        const needFullSync = !lastFullSync || daysSinceFullSync > 7;
        
        for (let i = 0; i < endpoints.length; i++) {
          const endpoint = endpoints[i];
          const progress = (i / endpoints.length) * 100;
          updateProgress(progress, endpoint.name, 'active');
          
          try {
            if (needFullSync) {
              const countData = await fetchDataFromSheets(endpoint.url, `${endpoint.action}Count`);
              const totalRecords = countData.count || 0;
              
              updateProgress(progress, endpoint.name, 'active', 0, totalRecords);
              
              const fullData = await fetchDataFromSheets(endpoint.url, endpoint.action);
              
              await saveLargeData(endpoint.store, fullData, 2000, (processed) => {
                updateProgress(
                  progress + (10 * (processed / fullData.length)),
                  endpoint.name,
                  'active',
                  processed,
                  totalRecords
                );
              });
              
              await setLastSyncTime(endpoint.store);
              updateProgress(((i + 1) / endpoints.length) * 100, endpoint.name, 'completed', fullData.length, totalRecords);
            } else {
              const result = await syncStoreData(endpoint);
              updateProgress(
                ((i + 1) / endpoints.length) * 100,
                endpoint.name,
                'completed',
                result.added + result.updated,
                result.added + result.updated + result.deleted
              );
            }
            
            // Beri waktu untuk UI update
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            console.error(`Error loading ${endpoint.name}:`, error);
            updateProgress(progress, endpoint.name, 'failed');
            
            // Coba refresh database sebelum melanjutkan ke endpoint berikutnya
            if (db) db.close();
            db = await openDatabase();
            
            throw error;
          }
        }
        
        if (needFullSync) {
          await setLastSyncTime('lastFullSync');
        }
        
        showProgressNotification('Data berhasil disinkronisasi', true);
        return true;
      } catch (error) {
        showProgressNotification(`Gagal sinkronisasi data: ${error.message}`, false);
        console.error('Database open error:', error);
        throw error;
      } finally {
        setTimeout(() => showProgressModal(false), 1000);
      }
    }
    
    // Fungsi bantu untuk save data besar per chunk
    async function saveLargeData(storeName, data, chunkSize, progressCallback) {
      return new Promise((resolve, reject) => {
        // Tambahkan timeout untuk mencegah hanging
        const timeout = setTimeout(() => {
          reject(new Error('Database operation timed out'));
        }, 30000); // 30 detik timeout
        
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.oncomplete = () => {
          clearTimeout(timeout);
          resolve();
        };
        transaction.onerror = (event) => {
          clearTimeout(timeout);
          reject(event.target.error);
        };
        
        const store = transaction.objectStore(storeName);
        
        // Clear existing data first dengan timeout terpisah
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
          let processed = 0;
          
          const processNextChunk = (startIdx) => {
            if (startIdx >= data.length) return;
            
            const endIdx = Math.min(startIdx + chunkSize, data.length);
            const chunk = data.slice(startIdx, endIdx);
            
            chunk.forEach(item => {
              const request = store.add(item);
              request.onerror = () => {
                console.error('Error adding item:', item.id, request.error);
              };
            });
            
            processed += chunk.length;
            progressCallback(processed);
            
            // Gunakan setTimeout untuk memberi jeda antara chunk
            setTimeout(() => processNextChunk(endIdx), 50);
          };
          
          processNextChunk(0);
        };
        
        clearRequest.onerror = (event) => {
          clearTimeout(timeout);
          reject(event.target.error);
        };
      });
    }
    
    document.getElementById('loadDataBtn').addEventListener('click', async function() {
      // Tambahkan ini di awal event handler
      if (db) {
        db.close();
        db = null;
      }
      this.disabled = true;
      this.innerHTML = '<span class="spinner"></span> Memuat...';
      
      try {
        // Pastikan tidak ada instance database yang menggantung
        if (db) {
          try {
            db.close();
          } catch (e) {
            console.log('Error closing database:', e);
          }
          db = null;
        }
        
        await loadAllData();
      } catch (error) {
        console.error('Error:', error);
        
        // Coba reset database state
        try {
          if (db) db.close();
          db = null;
          db = await openDatabase();
        } catch (e) {
          console.error('Error resetting database:', e);
        }
        
        showProgressNotification('Gagal memuat data. Silakan coba lagi.', false);
      } finally {
        this.disabled = false;
        this.innerHTML = '<i class="material-icons" style="font-size: 16px;">refresh</i><span>Muat Data</span>';
      }
    });
