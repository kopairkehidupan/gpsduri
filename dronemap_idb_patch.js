// ============================================================
// DroneMap v3 Pro — IndexedDB Session Patch
//
// MASALAH YANG DISELESAIKAN:
//   "Aw, Snap!" / tab crash saat load .dmsession besar di:
//   - Komputer RAM rendah (≤4GB)
//   - Jaringan internet lambat (library CDN lama load)
//
// SOLUSI:
//   Simpan/load sesi langsung ke IndexedDB (storage browser),
//   BUKAN via file JSON besar yang harus di-parse sekaligus.
//
//   IndexedDB menyimpan foto sebagai Blob — TIDAK masuk JS heap,
//   sehingga tidak ada ledakan memori saat load sesi.
//
// CARA PAKAI:
//   Tambahkan setelah dronemap_memory_fix.js:
//   <script src="dronemap_idb_patch.js"></script>
//
// ARSITEKTUR:
//   DB: DroneMapDB (IndexedDB)
//   Store 1: 'photos'   — key: photoId, value: {meta + blob}
//   Store 2: 'sessions' — key: sessionName, value: {metadata tanpa foto}
//
// WORKFLOW:
//   Simpan → foto dikonversi ke Blob → disimpan satu per satu ke IDB
//   Load   → baca metadata → load tiap foto sebagai BlobURL (lazy)
//   Tidak ada string JSON besar, tidak ada OOM!
// ============================================================

'use strict';

// ─────────────────────────────────────────────────────────────
// KONSTANTA
// ─────────────────────────────────────────────────────────────
var _IDB_NAME    = 'DroneMapDB';
var _IDB_VERSION = 1;
var _STORE_PHOTOS   = 'photos';
var _STORE_SESSIONS = 'sessions';

// ─────────────────────────────────────────────────────────────
// 1. BUKA DATABASE
// ─────────────────────────────────────────────────────────────
function _idbOpen() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(_IDB_NAME, _IDB_VERSION);

    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      // Store foto: key = photoId (number)
      if (!db.objectStoreNames.contains(_STORE_PHOTOS)) {
        db.createObjectStore(_STORE_PHOTOS, { keyPath: 'id' });
      }
      // Store sesi: key = sessionName (string)
      if (!db.objectStoreNames.contains(_STORE_SESSIONS)) {
        var ss = db.createObjectStore(_STORE_SESSIONS, { keyPath: 'name' });
        ss.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    req.onsuccess  = function(e) { resolve(e.target.result); };
    req.onerror    = function(e) { reject(e.target.error); };
    req.onblocked  = function()  { reject(new Error('IndexedDB blocked — tutup tab DroneMap lain')); };
  });
}

// ─────────────────────────────────────────────────────────────
// 2. HELPER: Promise wrapper untuk IDB transaction
// ─────────────────────────────────────────────────────────────
function _idbTx(db, stores, mode, fn) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(stores, mode);
    tx.oncomplete = function() { resolve(); };
    tx.onerror    = function(e) { reject(e.target.error); };
    fn(tx);
  });
}

function _idbGet(store, key) {
  return new Promise(function(resolve, reject) {
    var req = store.get(key);
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

function _idbPut(store, val) {
  return new Promise(function(resolve, reject) {
    var req = store.put(val);
    req.onsuccess = function() { resolve(); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

function _idbGetAll(store) {
  return new Promise(function(resolve, reject) {
    var req = store.getAll ? store.getAll() : null;
    if (req) {
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror   = function(e) { reject(e.target.error); };
    } else {
      // Fallback via cursor
      var results = [];
      var cur = store.openCursor();
      cur.onsuccess = function(e) {
        var cursor = e.target.result;
        if (cursor) { results.push(cursor.value); cursor.continue(); }
        else resolve(results);
      };
      cur.onerror = function(e) { reject(e.target.error); };
    }
  });
}

function _idbDelete(store, key) {
  return new Promise(function(resolve, reject) {
    var req = store.delete(key);
    req.onsuccess = function() { resolve(); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

// ─────────────────────────────────────────────────────────────
// 3. KONVERSI src/blobUrl → Blob
// ─────────────────────────────────────────────────────────────
async function _srcToBlob(photo) {
  var src = photo._blobUrl || photo.src;
  if (!src) return null;
  try {
    var resp = await fetch(src);
    return await resp.blob();
  } catch(e) {
    console.warn('[IDB] _srcToBlob gagal:', photo.name, e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4. SIMPAN SESI KE INDEXEDDB
// ─────────────────────────────────────────────────────────────
async function idbSaveSession(sessionName) {
  if (!sessionName || !sessionName.trim()) {
    sessionName = 'Sesi ' + new Date().toLocaleDateString('id-ID');
  }
  sessionName = sessionName.trim();

  // Hitung estimasi jumlah foto
  var totalFoto = photos.length;
  if (totalFoto === 0 && measures.length === 0 && trees.length === 0) {
    showToast('⚠ Tidak ada data untuk disimpan');
    return;
  }

  // Tampilkan progress overlay
  var ovId = '_idbSaveOv';
  document.body.insertAdjacentHTML('beforeend',
    '<div id="'+ovId+'" style="position:fixed;inset:0;background:rgba(13,17,23,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999999;gap:14px">'
    + '<div style="width:36px;height:36px;border:3px solid var(--bd);border-top-color:var(--saw);border-radius:50%;animation:spin .8s linear infinite"></div>'
    + '<div style="font-family:\'Space Mono\',monospace;font-size:12px;color:var(--saw2)" id="_idbSaveTxt">Membuka database...</div>'
    + '<div style="width:260px;height:5px;background:var(--bd);border-radius:4px;overflow:hidden">'
    + '<div id="_idbSaveBar" style="height:100%;width:0%;background:var(--saw);border-radius:4px;transition:width .25s"></div></div>'
    + '<div style="font-size:9px;color:var(--mu)" id="_idbSaveSub">' + totalFoto + ' foto akan disimpan sebagai Blob</div>'
    + '</div>');

  function setP(pct, msg) {
    var bar = document.getElementById('_idbSaveBar');
    var txt = document.getElementById('_idbSaveTxt');
    if (bar) bar.style.width = Math.min(pct, 100) + '%';
    if (txt && msg) txt.textContent = msg;
  }
  function closeOv() {
    var el = document.getElementById(ovId);
    if (el) el.remove();
  }

  try {
    setP(5, 'Membuka IndexedDB...');
    var db = await _idbOpen();
    await _yieldToUI(20);

    // ── Simpan tiap foto sebagai Blob satu per satu ──
    setP(10, 'Simpan foto (0/' + totalFoto + ')...');
    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      setP(10 + Math.round(i / Math.max(totalFoto, 1) * 70),
        'Simpan foto ' + (i + 1) + '/' + totalFoto + ': ' + photo.name);
      await _yieldToUI(16);

      var blob = await _srcToBlob(photo);

      // Metadata foto (tanpa src — src disimpan sebagai Blob)
      var photoRecord = {
        id:               photo.id,
        sessionName:      sessionName,
        name:             photo.name,
        w:                photo.w,
        h:                photo.h,
        gcps:             photo.gcps || [],
        georef:           photo.georef || false,
        bounds:           photo.bounds || null,
        corners:          photo.corners || null,
        visible:          photo.visible !== false,
        opacity:          photo.opacity !== undefined ? photo.opacity : 1,
        feather:          photo.feather || 0,
        blendMode:        photo.blendMode || 'normal',
        offsetLat:        photo.offsetLat || 0,
        offsetLng:        photo.offsetLng || 0,
        zOrder:           photo.zOrder || 0,
        brightness:       photo.brightness || 100,
        contrast:         photo.contrast || 100,
        saturation:       photo.saturation || 100,
        colorNormApplied: photo.colorNormApplied || false,
        blob:             blob   // ← Blob disimpan di IDB, BUKAN di JS heap
      };

      await _idbTx(db, [_STORE_PHOTOS], 'readwrite', function(tx) {
        _idbPut(tx.objectStore(_STORE_PHOTOS), photoRecord);
      });

      await _yieldToUI(50); // beri waktu GC bebaskan blob temporary
    }

    setP(82, 'Simpan metadata sesi...');
    await _yieldToUI(20);

    // ── Simpan metadata sesi (tanpa foto) ──
    var sessionRecord = {
      name:               sessionName,
      savedAt:            new Date().toISOString(),
      tool:               'DroneMap v3 Pro',
      photoIds:           photos.map(function(p) { return p.id; }),
      photoCount:         photos.length,
      georefCount:        photos.filter(function(p) { return p.georef; }).length,
      measures:           measures.map(function(m) {
        var obj = { id: m.id, type: m.type, label: m.label };
        if (m.area !== undefined) obj.area = m.area;
        if (m.perim !== undefined) obj.perim = m.perim;
        if (m.coords) obj.coords = m.coords;
        if (m.len !== undefined) obj.len = m.len;
        if (m.lat !== undefined) obj.lat = m.lat;
        if (m.lng !== undefined) obj.lng = m.lng;
        if (m.treesInside) obj.treesInside = m.treesInside;
        if (m.density) obj.density = m.density;
        if (m.isBatasKebun) obj.isBatasKebun = true;
        return obj;
      }),
      shapeId:            shapeId,
      trees:              trees.map(function(t) {
        return { id: t.id, lat: t.lat, lng: t.lng, no: t.no, block: t.block, status: t.status, note: t.note };
      }),
      treeId:             treeId,
      batasKebunIds:      Array.from(_batasKebunIds),
      bkOwnerMapExplicit: _bkOwnerMapExplicit,
      bkColorMap:         _bkColorMap,
      labelOffsets:       _labelOffsets,
      exportBatasShow:    _exportBatasShow,
      exportLabelShow:    _exportLabelShow,
      areaUnit:           areaUnit,
      lenUnit:            lenUnit
    };

    await _idbTx(db, [_STORE_SESSIONS], 'readwrite', function(tx) {
      _idbPut(tx.objectStore(_STORE_SESSIONS), sessionRecord);
    });

    setP(95, 'Selesai!');
    await _yieldToUI(200);
    closeOv();
    db.close();

    showToast('✅ Sesi "' + sessionName + '" tersimpan di browser!\n'
      + totalFoto + ' foto · ' + measures.length + ' pengukuran · ' + trees.length + ' pokok\n'
      + '⚡ IndexedDB — tidak ada crash saat muat ulang');

    // Refresh daftar sesi
    _idbRenderSessionList();

  } catch(err) {
    closeOv();
    console.error('[IDB] Save error:', err);
    showToast('❌ Gagal simpan ke browser: ' + err.message
      + '\n\nCoba: buka Settings > Privacy > Clear Site Data → hapus data lama, lalu coba lagi.');
  }
}

// ─────────────────────────────────────────────────────────────
// 5. MUAT SESI DARI INDEXEDDB
// ─────────────────────────────────────────────────────────────
async function idbLoadSession(sessionName) {
  var statusEl = document.getElementById('sessionLoadStatus');
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.style.background = 'rgba(88,166,255,.08)';
    statusEl.style.color = 'var(--in)';
    statusEl.style.border = '1px solid rgba(88,166,255,.25)';
    statusEl.innerHTML = '⏳ Memuat sesi dari browser...<br>'
      + '<div style="width:100%;height:4px;background:var(--bd);border-radius:2px;margin-top:5px">'
      + '<div id="idbLoadBar" style="height:100%;width:0%;background:var(--in);border-radius:2px;transition:width .3s"></div></div>'
      + '<div id="idbLoadMsg" style="font-size:8px;color:var(--mu);margin-top:3px">Membuka IndexedDB...</div>';
  }

  function setBar(pct, msg) {
    var bar = document.getElementById('idbLoadBar');
    var m   = document.getElementById('idbLoadMsg');
    if (bar) bar.style.width = Math.min(pct, 100) + '%';
    if (m && msg) m.textContent = msg;
  }

  try {
    setBar(5, 'Buka IndexedDB...');
    var db = await _idbOpen();
    await _yieldToUI(20);

    // ── Baca metadata sesi ──
    setBar(10, 'Baca metadata sesi...');
    var sessionRecord = null;
    await _idbTx(db, [_STORE_SESSIONS], 'readonly', async function(tx) {
      sessionRecord = await _idbGet(tx.objectStore(_STORE_SESSIONS), sessionName);
    });

    if (!sessionRecord) {
      throw new Error('Sesi "' + sessionName + '" tidak ditemukan di IndexedDB');
    }

    setBar(15, 'Bersihkan state lama...');
    await _yieldToUI(20);

    // ── Bersihkan state lama (sama seperti _doLoadSessionWithBlobConversion) ──
    if (typeof photos !== 'undefined') {
      photos.forEach(function(p) {
        if (p.overlay && map) try { map.removeLayer(p.overlay); } catch(e) {}
        if (p.gcpLayer && map) try { map.removeLayer(p.gcpLayer); } catch(e) {}
        if (p._blobUrl) { try { URL.revokeObjectURL(p._blobUrl); } catch(e) {} }
      });
    }
    if (typeof _geserPhotoId !== 'undefined' && _geserPhotoId) _stopGeserMode();
    if (typeof _geserMarkers !== 'undefined') {
      Object.keys(_geserMarkers).forEach(function(id) {
        if (_geserMarkers[id] && map) try { map.removeLayer(_geserMarkers[id]); } catch(e) {}
      });
      _geserMarkers = {};
    }
    if (typeof _treeLayer !== 'undefined' && _treeLayer) _treeLayer.clearLayers();
    if (typeof _labelDragMarkers !== 'undefined') {
      Object.keys(_labelDragMarkers).forEach(function(id) {
        if (_labelDragMarkers[id] && map) try { map.removeLayer(_labelDragMarkers[id]); } catch(e) {}
      });
      _labelDragMarkers = {};
    }

    // ── Restore state dari metadata ──
    setBar(20, 'Restore variabel...');
    await _yieldToUI(20);

    measures            = sessionRecord.measures || [];
    shapeId             = sessionRecord.shapeId || 0;
    trees               = (sessionRecord.trees || []).map(function(t) { return Object.assign({}, t, { marker: null }); });
    treeId              = sessionRecord.treeId || 0;
    _batasKebunIds      = new Set(sessionRecord.batasKebunIds || []);
    _bkOwnerMapExplicit = sessionRecord.bkOwnerMapExplicit || {};
    _bkColorMap         = sessionRecord.bkColorMap || {};
    _labelOffsets       = sessionRecord.labelOffsets || {};
    _exportBatasShow    = sessionRecord.exportBatasShow || {};
    _exportLabelShow    = sessionRecord.exportLabelShow || {};
    _bkOwnerMap         = {};
    _batasKebunPolygons = [];
    areaUnit            = sessionRecord.areaUnit || 'auto';
    lenUnit             = sessionRecord.lenUnit || 'auto';

    // ── Buat array foto kosong (tanpa src) ──
    setBar(25, 'Inisialisasi array foto...');
    await _yieldToUI(20);

    photos = (sessionRecord.photoIds || []).map(function(pid) {
      return {
        id: pid, name: '...', src: null, _blobUrl: null,
        w: 0, h: 0, gcps: [], georef: false, bounds: null, corners: null,
        overlay: null, gcpLayer: null,
        visible: true, opacity: 1, feather: 0, blendMode: 'normal',
        offsetLat: 0, offsetLng: 0, zOrder: 0,
        brightness: 100, contrast: 100, saturation: 100, colorNormApplied: false
      };
    });

    // ── Init peta ──
    setBar(30, 'Init peta...');
    await _yieldToUI(30);

    var georefMeta = sessionRecord.measures ? [] : [];
    // Kita perlu tahu foto mana yang georef — dari IDB nanti
    // Init peta akan dilakukan setelah foto pertama georef diload

    var mapInitialized = false;
    var needMapInit = false; // akan diset setelah baca foto pertama

    // ── Load tiap foto dari IDB — SATU PER SATU ──
    var total = sessionRecord.photoIds ? sessionRecord.photoIds.length : 0;

    for (var i = 0; i < sessionRecord.photoIds.length; i++) {
      var photoId = sessionRecord.photoIds[i];
      var pct = 30 + Math.round(i / Math.max(total, 1) * 55);
      setBar(pct, 'Load foto ' + (i + 1) + '/' + total + '...');
      await _yieldToUI(16);

      // Baca foto dari IDB
      var photoRecord = null;
      await _idbTx(db, [_STORE_PHOTOS], 'readonly', async function(tx) {
        photoRecord = await _idbGet(tx.objectStore(_STORE_PHOTOS), photoId);
      });

      if (!photoRecord) {
        console.warn('[IDB] Foto id=' + photoId + ' tidak ditemukan di IDB');
        continue;
      }

      // Update entry foto di array photos
      var photoEntry = photos.find(function(p) { return p.id === photoId; });
      if (!photoEntry) continue;

      // Salin semua metadata dari IDB ke photoEntry
      photoEntry.name             = photoRecord.name;
      photoEntry.w                = photoRecord.w;
      photoEntry.h                = photoRecord.h;
      photoEntry.gcps             = photoRecord.gcps || [];
      photoEntry.georef           = photoRecord.georef || false;
      photoEntry.bounds           = photoRecord.bounds || null;
      photoEntry.corners          = photoRecord.corners || null;
      photoEntry.visible          = photoRecord.visible !== false;
      photoEntry.opacity          = photoRecord.opacity !== undefined ? photoRecord.opacity : 1;
      photoEntry.feather          = photoRecord.feather || 0;
      photoEntry.blendMode        = photoRecord.blendMode || 'normal';
      photoEntry.offsetLat        = photoRecord.offsetLat || 0;
      photoEntry.offsetLng        = photoRecord.offsetLng || 0;
      photoEntry.zOrder           = photoRecord.zOrder || 0;
      photoEntry.brightness       = photoRecord.brightness || 100;
      photoEntry.contrast         = photoRecord.contrast || 100;
      photoEntry.saturation       = photoRecord.saturation || 100;
      photoEntry.colorNormApplied = photoRecord.colorNormApplied || false;

      // Konversi Blob → BlobURL (hemat heap)
      if (photoRecord.blob) {
        try {
          var blobUrl = URL.createObjectURL(photoRecord.blob);
          photoEntry._blobUrl = blobUrl;
          photoEntry.src = blobUrl;
          // Track untuk cleanup
          if (typeof _allBlobUrls !== 'undefined') {
            _allBlobUrls[photoId] = blobUrl;
          }
        } catch(blobErr) {
          console.warn('[IDB] createObjectURL gagal:', blobErr);
        }
      }
      // Bebaskan blob dari memori segera (sudah punya blobUrl)
      photoRecord.blob = null;

      await _yieldToUI(80); // GC pause penting setelah tiap foto

      // ── Init peta dari foto georef pertama ──
      if (photoEntry.georef && photoEntry.gcps && photoEntry.gcps.length >= 3) {
        if (!mapInitialized) {
          if (!map) {
            setBar(pct, 'Init peta...');
            _initMapFromPhoto(photoEntry);
            await _yieldToUI(80);
          } else {
            if (drawnItems) drawnItems.clearLayers();
          }
          // Restore polygon layers
          _restoreMeasureLayers();
          mapInitialized = true;
        }

        // Build overlay (lazy — tidak build canvas sekaligus)
        try {
          var toGeo = buildAffine(photoEntry.gcps);
          photoEntry.overlay = createRotatedOverlay(photoEntry, toGeo);

          if (photoEntry.visible && map) {
            photoEntry.overlay.addTo(map);
            // Lazy build — canvas dibangun saat masuk viewport (via MemFix patch)
            if (typeof _enqueueBuild !== 'undefined') {
              _enqueueBuild(photoEntry.overlay);
            } else {
              // Fallback: build async tapi tidak await (non-blocking)
              photoEntry.overlay._buildOfc();
            }
          }

          photoEntry.gcpLayer = L.featureGroup();
          photoEntry.gcps.forEach(function(g, gi) {
            L.circleMarker([g.lat, g.lng], {
              radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane'
            }).addTo(photoEntry.gcpLayer).bindPopup('<b>' + photoEntry.name + '</b><br>GCP ' + (gi + 1));
          });
          var togGCP = document.getElementById('togGCP');
          if (togGCP && togGCP.checked && map) photoEntry.gcpLayer.addTo(map);

        } catch(overlayErr) {
          console.warn('[IDB] Gagal build overlay untuk', photoEntry.name, overlayErr);
        }
      }

      await _yieldToUI(20);
    }

    db.close();

    // ── Restore tree markers ──
    setBar(87, 'Restore pokok sawit...');
    await _yieldToUI(20);
    if (_treeLayer) _treeLayer.clearLayers();
    trees.forEach(function(t) { addTreeMarker(t); });

    // ── fitBounds ──
    setBar(91, 'Fit bounds peta...');
    await _yieldToUI(20);
    var allBounds = photos.filter(function(p) { return p.georef && p.bounds; }).map(function(p) { return p.bounds; });
    if (allBounds.length > 0 && map) {
      var aLats = [], aLngs = [];
      allBounds.forEach(function(b) { aLats.push(b[0][0], b[1][0]); aLngs.push(b[0][1], b[1][1]); });
      map.fitBounds([
        [Math.min.apply(null, aLats), Math.min.apply(null, aLngs)],
        [Math.max.apply(null, aLats), Math.max.apply(null, aLngs)]
      ], { padding: [20, 20] });
    }

    // ── Rebuild BK state ──
    setBar(93, 'Finalisasi...');
    await _yieldToUI(20);
    _rebuildBatasKebunPolygons();
    _updateBatasKebunInfoPanel();
    updateGcpCoverageBox();
    hideImagePanel();
    updateStep(3);

    // ── Update UI ──
    setBar(96, 'Update tampilan...');
    await _yieldToUI(20);

    var georefDone = photos.filter(function(p) { return p.georef; }).length;

    renderMeasures();
    renderTreeList();
    updateStats();
    updateSensusStats();
    renderExportBlokList();
    await _yieldToUI(30);
    renderPhotoList();
    await _yieldToUI(30);
    renderLayerList();

    document.getElementById('hdrPhotoCount').textContent = photos.length + ' foto';
    document.getElementById('hdrTreeCount').textContent = '🌴 ' + trees.length + ' pokok';
    if (georefDone > 0) {
      document.getElementById('hdrRotTag').style.display = '';
      document.getElementById('hdrRotTag').textContent = '✓ ' + georefDone + ' foto georef';
    }

    document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('.stab')[4].classList.add('active');
    document.getElementById('tab-measure').classList.add('active');

    setBar(100, 'Selesai!');

    if (statusEl) {
      statusEl.style.background = 'rgba(63,185,80,.08)';
      statusEl.style.color = 'var(--ok)';
      statusEl.style.border = '1px solid rgba(63,185,80,.25)';
      statusEl.innerHTML = '✅ Sesi dipulihkan dari browser!<br>'
        + georefDone + ' foto georef · '
        + measures.length + ' pengukuran · '
        + trees.length + ' pokok sawit<br>'
        + '<span style="color:var(--mu);font-size:8px">⚡ IndexedDB — tidak ada OOM crash</span>';
    }

    showToast('✅ Sesi "' + sessionName + '" dipulihkan!\n'
      + georefDone + ' foto, ' + measures.length + ' pengukuran, ' + trees.length + ' pokok\n'
      + '⚡ Foto render bertahap saat di-zoom/pan...');

    // Refresh daftar sesi
    _idbRenderSessionList();

  } catch(err) {
    console.error('[IDB] Load error:', err);
    if (statusEl) {
      statusEl.style.background = 'rgba(248,81,73,.08)';
      statusEl.style.color = 'var(--er)';
      statusEl.style.border = '1px solid rgba(248,81,73,.3)';
      statusEl.innerHTML = '❌ Gagal muat dari browser: ' + err.message
        + '<br><span style="font-size:8px;color:var(--mu)">Coba simpan ulang sesi terlebih dahulu.</span>';
    }
    showToast('❌ Gagal muat sesi: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// 6. HAPUS SESI DARI INDEXEDDB
// ─────────────────────────────────────────────────────────────
async function idbDeleteSession(sessionName) {
  showConfirm('Hapus sesi "' + sessionName + '" dari browser?\n\nData foto juga akan dihapus dari IndexedDB.', async function() {
    try {
      var db = await _idbOpen();

      // Baca photoIds dulu untuk hapus foto juga
      var sessionRecord = null;
      await _idbTx(db, [_STORE_SESSIONS], 'readonly', async function(tx) {
        sessionRecord = await _idbGet(tx.objectStore(_STORE_SESSIONS), sessionName);
      });

      // Hapus semua foto dari store
      if (sessionRecord && sessionRecord.photoIds) {
        for (var i = 0; i < sessionRecord.photoIds.length; i++) {
          await _idbTx(db, [_STORE_PHOTOS], 'readwrite', function(tx) {
            _idbDelete(tx.objectStore(_STORE_PHOTOS), sessionRecord.photoIds[i]);
          });
        }
      }

      // Hapus session record
      await _idbTx(db, [_STORE_SESSIONS], 'readwrite', function(tx) {
        _idbDelete(tx.objectStore(_STORE_SESSIONS), sessionName);
      });

      db.close();
      showToast('🗑 Sesi "' + sessionName + '" dihapus dari browser');
      _idbRenderSessionList();

    } catch(err) {
      console.error('[IDB] Delete error:', err);
      showToast('❌ Gagal hapus sesi: ' + err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 7. DAFTAR SESI TERSIMPAN DI BROWSER
// ─────────────────────────────────────────────────────────────
async function _idbRenderSessionList() {
  var listEl = document.getElementById('_idbSessionList');
  if (!listEl) return;

  listEl.innerHTML = '<div style="font-size:9px;color:var(--mu);font-family:\'Space Mono\',monospace;padding:8px 0">Memuat daftar sesi...</div>';

  try {
    var db = await _idbOpen();
    var sessions = [];
    await _idbTx(db, [_STORE_SESSIONS], 'readonly', async function(tx) {
      sessions = await _idbGetAll(tx.objectStore(_STORE_SESSIONS));
    });
    db.close();

    // Sort: terbaru dulu
    sessions.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });

    if (sessions.length === 0) {
      listEl.innerHTML = '<div style="font-size:9px;color:var(--mu);font-family:\'Space Mono\',monospace;padding:8px 0;text-align:center;line-height:2">Belum ada sesi tersimpan.<br>Klik "Simpan ke Browser" untuk mulai.</div>';
      return;
    }

    listEl.innerHTML = sessions.map(function(s) {
      var dt = s.savedAt ? new Date(s.savedAt).toLocaleString('id-ID', {
        day:'2-digit', month:'short', year:'numeric',
        hour:'2-digit', minute:'2-digit'
      }) : '?';
      var sizeInfo = s.photoCount + ' foto · ' + (s.georefCount || 0) + ' georef';
      return '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:5px;padding:8px 10px;margin-bottom:5px">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'
        +   '<div style="flex:1;min-width:0">'
        +     '<div style="font-size:10px;font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + s.name + '">' + s.name + '</div>'
        +     '<div style="font-size:8px;color:var(--mu);font-family:\'Space Mono\',monospace;margin-top:2px">' + dt + ' · ' + sizeInfo + '</div>'
        +   '</div>'
        + '</div>'
        + '<div style="display:flex;gap:4px">'
        +   '<button onclick="idbLoadSession(\'' + s.name.replace(/'/g, "\\'") + '\')" style="flex:1;padding:4px 0;font-size:9px;border-radius:4px;cursor:pointer;border:1px solid var(--in);background:rgba(88,166,255,.1);color:var(--in);font-family:\'Space Mono\',monospace">📂 Muat</button>'
        +   '<button onclick="idbDeleteSession(\'' + s.name.replace(/'/g, "\\'") + '\')" style="padding:4px 8px;font-size:9px;border-radius:4px;cursor:pointer;border:1px solid var(--bd);background:var(--s3);color:var(--mu)">🗑</button>'
        + '</div>'
        + '</div>';
    }).join('');

  } catch(err) {
    listEl.innerHTML = '<div style="font-size:9px;color:var(--er);font-family:\'Space Mono\',monospace;padding:8px 0">'
      + '⚠ Gagal baca IndexedDB: ' + err.message + '</div>';
  }
}

// ─────────────────────────────────────────────────────────────
// 8. HITUNG TOTAL UKURAN DATA DI INDEXEDDB
// ─────────────────────────────────────────────────────────────
async function _idbGetStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      var est = await navigator.storage.estimate();
      var usedMB = (est.usage / 1024 / 1024).toFixed(1);
      var quotaMB = (est.quota / 1024 / 1024 / 1024).toFixed(1) + ' GB';
      return usedMB + ' MB / ' + quotaMB;
    }
  } catch(e) {}
  return '?';
}

// ─────────────────────────────────────────────────────────────
// 9. INJECT UI KE SIDEBAR
// ─────────────────────────────────────────────────────────────
function _idbInjectUI() {
  // Cari section "Simpan & Pulihkan Sesi" di tab export
  var exportTab = document.getElementById('tab-export');
  if (!exportTab) return;

  // Cari section terakhir (yang sudah ada untuk simpan/pulihkan sesi)
  var sessionSec = exportTab.querySelector('.s-sec:last-child');
  if (!sessionSec) return;

  // Buat section baru setelah section existing
  var newSec = document.createElement('div');
  newSec.className = 's-sec';
  newSec.style.cssText = 'background:rgba(63,185,80,.04);border-top:2px solid rgba(63,185,80,.35)';
  newSec.innerHTML =
    '<div class="s-ttl" style="color:var(--ok)">🗄 Simpan di Browser (IndexedDB)</div>'
    + '<div class="ibox" style="margin-bottom:9px;border-left-color:var(--ok)">'
    +   '<strong style="color:var(--ok)">Tidak ada Aw Snap!</strong> Foto disimpan sebagai Blob di dalam browser — '
    +   'tidak perlu parse JSON besar, tidak OOM, tetap aman meski jaringan putus.'
    + '</div>'

    // Input nama sesi
    + '<div style="margin-bottom:7px">'
    +   '<input id="_idbSessName" type="text" placeholder="Nama sesi (opsional)..." '
    +     'style="width:100%;background:var(--s2);border:1px solid var(--bd);border-radius:5px;padding:6px 9px;color:var(--tx);font-family:\'Space Mono\',monospace;font-size:10px;outline:none;box-sizing:border-box">'
    + '</div>'

    // Tombol simpan
    + '<button onclick="_idbSaveClick()" class="btn btn-ok btn-full" style="margin-bottom:6px">'
    +   '🗄 Simpan ke Browser Sekarang'
    + '</button>'

    // Info storage
    + '<div id="_idbStorageInfo" style="font-size:8px;color:var(--mu);font-family:\'Space Mono\',monospace;text-align:right;margin-bottom:8px">'
    +   'Menghitung storage...'
    + '</div>'

    // Daftar sesi
    + '<div class="s-ttl" style="margin-top:4px;color:var(--ok)">Sesi Tersimpan di Browser</div>'
    + '<div id="_idbSessionList"><div style="font-size:9px;color:var(--mu);text-align:center;padding:6px 0">Memuat...</div></div>'

    // Info tambahan
    + '<div style="margin-top:8px;font-size:8px;color:var(--mu);font-family:\'Space Mono\',monospace;line-height:1.8;padding:5px 7px;background:var(--s2);border-radius:4px;border:1px solid var(--bd)">'
    +   '⚠ Data tersimpan di <b>browser ini saja</b>.<br>'
    +   'Hapus data browser = sesi hilang.<br>'
    +   'Untuk backup/sharing, tetap gunakan 💾 file .dmsession.'
    + '</div>';

  sessionSec.parentNode.insertBefore(newSec, sessionSec.nextSibling);

  // Update storage info
  _idbGetStorageInfo().then(function(info) {
    var el = document.getElementById('_idbStorageInfo');
    if (el) el.textContent = '📦 Storage terpakai: ' + info;
  });

  // Load daftar sesi
  _idbRenderSessionList();
}

function _idbSaveClick() {
  var nameEl = document.getElementById('_idbSessName');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) {
    var now = new Date();
    name = 'Sesi ' + now.getDate().toString().padStart(2,'0') + '-'
      + (now.getMonth()+1).toString().padStart(2,'0') + '-'
      + now.getFullYear() + ' '
      + now.getHours().toString().padStart(2,'0') + ':'
      + now.getMinutes().toString().padStart(2,'0');
  }
  idbSaveSession(name);
}

// ─────────────────────────────────────────────────────────────
// 10. INSTALL — jalankan setelah DOM siap
// ─────────────────────────────────────────────────────────────
window.addEventListener('load', function() {
  // Cek apakah IndexedDB tersedia
  if (!window.indexedDB) {
    console.warn('[IDB] IndexedDB tidak tersedia di browser ini');
    return;
  }

  // Inject UI setelah delay singkat (beri waktu DOM utama selesai)
  setTimeout(_idbInjectUI, 1200);

  // Badge di header
  var hdrR = document.querySelector('.hdr-r');
  if (hdrR) {
    var badge = document.createElement('span');
    badge.className = 'hdr-tag';
    badge.title = 'IndexedDB Session Storage aktif\nTidak ada Aw Snap saat simpan/muat sesi';
    badge.textContent = '🗄 IDB';
    badge.style.color = 'var(--ok)';
    badge.style.cursor = 'help';
    badge.onclick = function() { switchTab('export', document.querySelectorAll('.stab')[5]); };
    hdrR.appendChild(badge);
  }

  console.log('[IDB Patch] IndexedDB Session Storage aktif');
  console.log('[IDB Patch] DB:', _IDB_NAME, '| Stores:', _STORE_PHOTOS, '+', _STORE_SESSIONS);
});
