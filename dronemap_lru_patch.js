// ============================================================
// DroneMap v3 Pro — LRU Canvas Pool Patch
// dronemap_lru_patch.js
//
// MASALAH:
//   _buildOfc() membuat canvas ~50MB per foto.
//   5 foto = 250MB canvas sekaligus → OOM bahkan setelah IDB patch.
//
// SOLUSI:
//   LRU (Least Recently Used) Canvas Pool.
//   Hanya max N canvas aktif di heap sekaligus.
//   Canvas yang tidak dipakai di-evict (dibebaskan).
//   Saat foto lama muncul di viewport → canvas rebuild otomatis.
//
// CARA PAKAI — urutan script harus tepat:
//   <script src="dronemap_memory_fix.js"></script>
//   <script src="dronemap_idb_patch.js"></script>    ← opsional
//   <script src="dronemap_lru_patch.js"></script>    ← PATCH INI
//
// CARA KERJA:
//   • _OFC_MAX dihitung dari navigator.deviceMemory
//     ≤2GB RAM  → max 1 canvas (~50MB)
//     ≤4GB RAM  → max 2 canvas (~100MB)
//     ≤8GB RAM  → max 3 canvas (~150MB)
//     >8GB RAM  → max 4 canvas (~200MB)
//   • Saat canvas baru mau dibuat & pool penuh → evict canvas terlama
//   • Saat _update() dipanggil & canvas sudah di-evict → rebuild dijadwalkan (300ms debounce)
//   • Semua canvas dihitung termasuk yang dibuat oleh MemFix patch
// ============================================================

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 1. UKURAN POOL — adaptif berdasarkan RAM device
  // ─────────────────────────────────────────────────────────────
  var _OFC_MAX = (function () {
    var mem = navigator.deviceMemory;   // undefined di browser lama
    if (!mem) {
      // Fallback: cek via performance.memory (Chrome-only)
      try {
        var totalMB = performance.memory.jsHeapSizeLimit / 1024 / 1024;
        mem = totalMB < 512 ? 1 : totalMB < 1024 ? 2 : totalMB < 2048 ? 4 : 8;
      } catch (e) {
        mem = 2; // asumsi aman
      }
    }
    var max = mem <= 2 ? 1 : mem <= 4 ? 2 : mem <= 8 ? 3 : 4;
    console.log('[LRU] deviceMemory=' + (mem || '?') + 'GB → max canvas pool=' + max);
    return max;
  })();

  // ─────────────────────────────────────────────────────────────
  // 2. POOL STATE
  // ─────────────────────────────────────────────────────────────
  // _ofcPool: Array<{ layer, ts }>
  // Urutan = oldest (index 0) to newest (index length-1)
  var _ofcPool = [];

  // ─────────────────────────────────────────────────────────────
  // 3. POOL OPERATIONS
  // ─────────────────────────────────────────────────────────────

  // Cek apakah layer ada di pool
  function _poolHas(layer) {
    return _ofcPool.some(function (e) { return e.layer === layer; });
  }

  // Touch: perbarui timestamp layer (pindah ke akhir = newest)
  function _poolTouch(layer) {
    var idx = _ofcPool.findIndex(function (e) { return e.layer === layer; });
    if (idx !== -1) {
      _ofcPool.splice(idx, 1);
    }
    _ofcPool.push({ layer: layer, ts: Date.now() });
  }

  // Evict: buang canvas layer dari memori
  function _evictLayer(entry) {
    var layer = entry.layer;
    if (layer._ofc) {
      try {
        // Paksa browser bebaskan pixel buffer canvas
        layer._ofc.width = 1;
        layer._ofc.height = 1;
      } catch (e) { /* ignore */ }
      layer._ofc = null;
    }
    layer._ofcBuilding = false;
    layer._ofcPromise = null;
  }

  // Pastikan ada slot di pool. Evict terlama jika perlu.
  function _poolMakeRoom() {
    while (_ofcPool.length >= _OFC_MAX) {
      var oldest = _ofcPool.shift();   // ambil dari depan (terlama)
      _evictLayer(oldest);
      console.log('[LRU] Evicted canvas untuk foto →', oldest.layer._photoName || '?');
    }
  }

  // Hapus layer dari pool (saat onRemove)
  function _poolRemove(layer) {
    var idx = _ofcPool.findIndex(function (e) { return e.layer === layer; });
    if (idx !== -1) {
      _evictLayer(_ofcPool[idx]);
      _ofcPool.splice(idx, 1);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. MONKEY-PATCH createRotatedOverlay
  //    Tunggu sampai fungsi tersedia (bisa di-define setelah script ini load)
  // ─────────────────────────────────────────────────────────────
  function _installPatch() {
    if (typeof window.createRotatedOverlay !== 'function') {
      // Belum tersedia — coba lagi setelah delay
      setTimeout(_installPatch, 200);
      return;
    }

    var _origCreate = window.createRotatedOverlay;

    window.createRotatedOverlay = function (photo, toGeo) {
      // Panggil fungsi asli untuk buat layer instance
      var layer = _origCreate(photo, toGeo);

      // Simpan referensi nama untuk debug
      layer._photoName = photo.name;

      // ── Wrap _buildOfc ──────────────────────────────────────
      var _origBuildOfc = layer._buildOfc.bind(layer);

      layer._buildOfc = function () {
        // Jika canvas sudah ada dan layer ada di pool → touch & return
        if (layer._ofc && _poolHas(layer)) {
          _poolTouch(layer);
          return Promise.resolve({ ofc: layer._ofc, img: layer._ofcImg });
        }

        // Jika sedang dibangun → return promise yang ada
        if (layer._ofcBuilding && layer._ofcPromise) {
          return layer._ofcPromise;
        }

        // Buat ruang di pool (evict terlama jika perlu)
        _poolMakeRoom();

        // Daftarkan layer ke pool SEBELUM build agar tidak di-evict diri sendiri
        _poolTouch(layer);

        // Panggil build asli
        var promise = _origBuildOfc();

        // Setelah build selesai → pastikan layer masih di pool (tidak di-evict saat build berjalan)
        if (promise && typeof promise.then === 'function') {
          promise.then(function () {
            // Jika layer di-evict saat build berjalan (race condition), canvas perlu dibebaskan
            if (!_poolHas(layer) && layer._ofc) {
              console.log('[LRU] Layer di-evict saat build berjalan, bebaskan canvas:', layer._photoName);
              try { layer._ofc.width = 1; layer._ofc.height = 1; } catch (e) {}
              layer._ofc = null;
              layer._ofcBuilding = false;
            }
          }).catch(function () { /* build gagal — diabaikan */ });
        }

        return promise;
      };

      // ── Wrap _update ────────────────────────────────────────
      //    Jika canvas di-evict, jadwalkan rebuild saat foto kembali terlihat
      var _origUpdate = layer._update.bind(layer);

      layer._update = function () {
        // Touch pool (perbarui "last used")
        if (_poolHas(layer)) {
          _poolTouch(layer);
        }

        // Jika canvas di-evict dan tidak sedang dibangun → jadwalkan rebuild
        if (!layer._ofc && !layer._ofcBuilding && layer._map) {
          clearTimeout(layer._rebuildTimer);
          layer._rebuildTimer = setTimeout(function () {
            if (!layer._ofc && layer._map) {
              console.log('[LRU] Rebuild canvas untuk foto:', layer._photoName);
              layer._buildOfc();
            }
          }, 280); // debounce 280ms — tidak rebuild saat lagi pan/zoom cepat
          return; // skip render frame ini, tunggu canvas siap
        }

        // Canvas tersedia → render normal
        _origUpdate();
      };

      // ── Wrap onRemove ───────────────────────────────────────
      //    Bebaskan canvas dan slot pool saat layer dihapus dari peta
      var _origOnRemove = layer.onRemove.bind(layer);

      layer.onRemove = function (map) {
        clearTimeout(layer._rebuildTimer);
        _poolRemove(layer);
        _origOnRemove(map);
      };

      // ── Wrap setFeatherVal / setColorAdj ───────────────────
      //    Saat parameter berubah, canvas lama invalid → evict dulu
      var _origSetFeather = layer.setFeatherVal ? layer.setFeatherVal.bind(layer) : null;
      if (_origSetFeather) {
        layer.setFeatherVal = function (v) {
          // Evict canvas lama agar tidak ada 2 canvas coexist saat rebuild
          if (layer._ofc) {
            _poolRemove(layer);
          }
          _origSetFeather(v);
        };
      }

      var _origSetColorAdj = layer.setColorAdj ? layer.setColorAdj.bind(layer) : null;
      if (_origSetColorAdj) {
        layer.setColorAdj = function (br, ct, sat) {
          if (layer._ofc) {
            _poolRemove(layer);
          }
          _origSetColorAdj(br, ct, sat);
        };
      }

      return layer;
    };

    console.log('[LRU] createRotatedOverlay berhasil di-patch. Pool max=' + _OFC_MAX);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. PATCH buildFeatheredCanvas — pastikan MAX_DIM adaptif
  //    (override ulang dari MemFix jika MAX_DIM masih terlalu besar)
  // ─────────────────────────────────────────────────────────────
  function _patchBuildFeatheredCanvas() {
    if (typeof window.buildFeatheredCanvas !== 'function') {
      setTimeout(_patchBuildFeatheredCanvas, 200);
      return;
    }

    var _origBFC = window.buildFeatheredCanvas;
    var _MAX_DIM_LRU = (function () {
      var mem = navigator.deviceMemory || 2;
      // Lebih konservatif dari MemFix karena kita mau pool berjalan efektif
      // Canvas: width × height × 4 bytes (RGBA)
      // Target: tiap canvas < 40MB → sqrt(40MB/4) ≈ 3162px → pakai 1536 untuk aman
      if (mem <= 2)  return 512;   // ~1MB per canvas — sangat aman
      if (mem <= 4)  return 1024;  // ~4MB per canvas
      if (mem <= 8)  return 1536;  // ~9MB per canvas
      return 2048;                  // ~16MB per canvas
    })();

    window.buildFeatheredCanvas = function (imgSrc, w, h, featherAmt, brightness, contrast, saturation, callback) {
      // Terapkan MAX_DIM lebih konservatif
      var sc = 1;
      if (w > _MAX_DIM_LRU || h > _MAX_DIM_LRU) {
        sc = Math.min(_MAX_DIM_LRU / w, _MAX_DIM_LRU / h);
      }
      var ow = Math.round(w * sc);
      var oh = Math.round(h * sc);

      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          try {
            var ofc = document.createElement('canvas');
            ofc.width = ow;
            ofc.height = oh;
            var ctx = ofc.getContext('2d');
            var br = brightness || 100, ct = contrast || 100, sat2 = saturation || 100;
            ctx.filter = 'brightness(' + br + '%) contrast(' + ct + '%) saturate(' + sat2 + '%)';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, ow, oh);
            ctx.filter = 'none';

            if (featherAmt > 0) {
              var mask = document.createElement('canvas');
              mask.width = ow; mask.height = oh;
              var mctx = mask.getContext('2d');
              var cx = ow / 2, cy = oh / 2, eb = featherAmt;
              var grad = mctx.createRadialGradient(
                cx, cy, Math.min(cx, cy) * (1 - eb * 1.5),
                cx, cy, Math.max(cx, cy) * 1.05
              );
              grad.addColorStop(0, 'rgba(0,0,0,1)');
              grad.addColorStop(1, 'rgba(0,0,0,0)');
              mctx.fillStyle = grad;
              mctx.fillRect(0, 0, ow, oh);
              ctx.globalCompositeOperation = 'destination-in';
              ctx.drawImage(mask, 0, 0);
              ctx.globalCompositeOperation = 'source-over';
              mask.width = 1; mask.height = 1;
            }

            ofc._origW = w;
            ofc._origH = h;

            if (callback) callback(ofc, img);
            resolve({ ofc: ofc, img: img });
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = function () { reject(new Error('Gagal load gambar')); };
        img.src = imgSrc;
      });
    };

    console.log('[LRU] buildFeatheredCanvas di-patch. MAX_DIM=' + _MAX_DIM_LRU);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. DEBUG PANEL — status pool di UI (opsional)
  // ─────────────────────────────────────────────────────────────
  function _showPoolStatus() {
    var el = document.getElementById('_lruPoolStatus');
    if (!el) return;
    var active = _ofcPool.length;
    var names = _ofcPool.map(function (e) { return e.layer._photoName || '?'; }).join(', ');
    el.textContent = 'Canvas aktif: ' + active + '/' + _OFC_MAX + (names ? ' (' + names + ')' : '');
    el.style.color = active >= _OFC_MAX ? 'var(--ac)' : 'var(--ok)';
  }

  // Update status panel tiap 2 detik (jika ada)
  setInterval(_showPoolStatus, 2000);

  // ─────────────────────────────────────────────────────────────
  // 7. INJECT STATUS UI KE SIDEBAR
  // ─────────────────────────────────────────────────────────────
  function _injectStatusUI() {
    var exportTab = document.getElementById('tab-export');
    if (!exportTab) { setTimeout(_injectStatusUI, 800); return; }

    // Cari section session di tab export
    var allSecs = exportTab.querySelectorAll('.s-sec');
    if (!allSecs.length) { setTimeout(_injectStatusUI, 800); return; }

    var container = allSecs[allSecs.length - 1];
    var statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'margin-top:8px;font-size:8px;font-family:\'Space Mono\',monospace;padding:5px 8px;background:var(--s2);border-radius:4px;border:1px solid var(--bd);line-height:1.8';
    statusDiv.innerHTML =
      '<div style="color:var(--mu);margin-bottom:2px">🧠 LRU Canvas Pool</div>' +
      '<div id="_lruPoolStatus" style="color:var(--ok)">Menunggu aktivitas peta...</div>' +
      '<div style="color:var(--mu);margin-top:2px">Max: ' + _OFC_MAX + ' canvas | Device RAM: ' + (navigator.deviceMemory || '?') + 'GB</div>';
    container.appendChild(statusDiv);
  }

  // ─────────────────────────────────────────────────────────────
  // 8. ENTRY POINT
  // ─────────────────────────────────────────────────────────────
  window.addEventListener('load', function () {
    // Install patch setelah semua library & script utama siap
    setTimeout(function () {
      _installPatch();
      _patchBuildFeatheredCanvas();
      _injectStatusUI();
    }, 500);

    // Ekspor ke window untuk debugging di console
    window._lruPool = _ofcPool;
    window._lruMax = _OFC_MAX;
    window._lruEvictAll = function () {
      _ofcPool.slice().forEach(function (e) { _evictLayer(e); });
      _ofcPool.length = 0;
      console.log('[LRU] Manual evict all — semua canvas dibebaskan');
    };
  });

  console.log('[LRU Patch] Loaded. Pool max akan=' + _OFC_MAX + ' (install setelah window.load)');

})();
