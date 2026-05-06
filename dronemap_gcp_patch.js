/**
 * DroneMap v3 Pro — Patch: Auto-Lokasi GCP  (v1.1 — bugfix)
 * ===========================================================
 * File  : dronemap_gcp_patch.js
 * Pasang: <script src="dronemap_gcp_patch.js"></script>
 *         SETELAH semua <script> utama DroneMap, sebelum </body>
 *
 * Bugfix v1.1:
 *  [BUG 1] exifr CDN gagal load → onerror tidak panggil _init()
 *           → SEMUA fitur tidak aktif. FIXED: onerror sekarang tetap panggil _init()
 *  [BUG 2] Selector toolbar [style*="bottom:0"] gagal karena browser
 *           normalisasi CSS jadi "bottom: 0px". FIXED: cari via #btnSplitApply
 *  [BUG 3] setTimeout 160ms terlalu pendek di PC lambat.
 *           FIXED: retry loop 20x setiap 100ms
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // 0. INJECT CSS
  // ══════════════════════════════════════════════════════════
  var _css = [
    '.sv-search-bar{display:flex;align-items:center;gap:5px;background:rgba(13,17,23,.92);',
    'border:1px solid var(--saw);border-radius:6px;padding:3px 6px 3px 10px;min-width:0;flex-shrink:0}',
    '.sv-search-bar input{background:transparent;border:none;color:var(--tx);',
    'font-family:"Space Mono",monospace;font-size:10px;outline:none;width:180px}',
    '.sv-search-bar input::placeholder{color:var(--mu)}',
    '.sv-search-btn{padding:2px 9px;border-radius:4px;border:1px solid var(--saw);',
    'background:rgba(90,158,53,.2);color:var(--saw2);font-size:9px;cursor:pointer;',
    'white-space:nowrap;font-family:"Space Mono",monospace;transition:.15s;flex-shrink:0}',
    '.sv-search-btn:hover{background:rgba(90,158,53,.4)}',
    '.sv-blue{border-color:var(--in)!important;color:var(--in)!important;',
    'background:rgba(88,166,255,.15)!important}',
    '.sv-blue:hover{background:rgba(88,166,255,.3)!important}',
    '.exif-badge{display:inline-block;font-size:8px;padding:1px 5px;border-radius:8px;',
    'background:rgba(88,166,255,.15);color:var(--in);border:1px solid rgba(88,166,255,.3);',
    'font-family:"Space Mono",monospace;margin-left:4px;vertical-align:middle}',
    '.sv-exif-hint{position:absolute;top:52px;left:50%;transform:translateX(-50%);',
    'background:rgba(13,17,23,.95);border:1px solid var(--in);border-radius:20px;',
    'padding:5px 14px;font-size:9px;color:var(--in);font-family:"Space Mono",monospace;',
    'z-index:300;white-space:nowrap;pointer-events:none;animation:svFadeIn .4s ease}',
    '@keyframes svFadeIn{from{opacity:0;transform:translateX(-50%) translateY(-6px)}',
    'to{opacity:1;transform:translateX(-50%) translateY(0)}}',
    '.sv-exif-pulse{display:inline-block;width:7px;height:7px;border-radius:50%;',
    'background:var(--in);margin-right:5px;animation:svPulse 1.2s infinite;vertical-align:middle}',
    '@keyframes svPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.5)}}',
    '#exifGpsInfo{margin-top:7px;background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);',
    'border-radius:5px;padding:6px 9px;font-size:9px;font-family:"Space Mono",monospace;',
    'color:var(--in);line-height:1.8}'
  ].join('');

  var _styleEl = document.createElement('style');
  _styleEl.textContent = _css;
  document.head.appendChild(_styleEl);

  // ══════════════════════════════════════════════════════════
  // 1. LOAD EXIFR (LITE) — BUG FIX: onerror tetap panggil cb()
  // ══════════════════════════════════════════════════════════
  var _exifrReady = false;

  function _loadExifr(cb) {
    if (typeof exifr !== 'undefined') { _exifrReady = true; cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js';
    s.onload = function () {
      _exifrReady = true;
      console.log('[GCP Patch] exifr OK');
      cb();
    };
    // ★ BUG FIX: Tetap panggil cb() meski CDN gagal
    s.onerror = function () {
      console.warn('[GCP Patch] exifr gagal — fitur EXIF GPS tidak aktif, fitur lain tetap jalan');
      cb(); // ← inilah yang hilang di versi lama
    };
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════
  // 2. EKSTRAK GPS EXIF
  // ══════════════════════════════════════════════════════════
  async function _extractExifGPS(dataUrl) {
    if (!_exifrReady || typeof exifr === 'undefined') return null;
    try {
      var gps = await exifr.gps(dataUrl);
      if (gps && gps.latitude != null && gps.longitude != null)
        return { lat: gps.latitude, lng: gps.longitude };
    } catch (e) {}
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // 3. PARSE KOORDINAT (berbagai format)
  // ══════════════════════════════════════════════════════════
  function _parseCoord(raw) {
    if (!raw || !raw.trim()) return null;
    raw = raw.trim();

    // Format desimal biasa
    var parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (parts.length >= 2) {
      var la = parseFloat(parts[0]), lo = parseFloat(parts[1]);
      if (!isNaN(la) && !isNaN(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180)
        return { lat: la, lng: lo };
    }

    // URL Google Maps: @lat,lng,zoom
    var m = raw.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) {
      var la2 = parseFloat(m[1]), lo2 = parseFloat(m[2]);
      if (!isNaN(la2) && !isNaN(lo2)) return { lat: la2, lng: lo2 };
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════
  // 4. CARI TOOLBAR — BUG FIX: tidak pakai [style*="bottom:0"]
  // ══════════════════════════════════════════════════════════
  function _findSplitToolbar() {
    // Strategi 1: lewat tombol Georeference yang punya ID unik
    var applyBtn = document.getElementById('btnSplitApply');
    if (applyBtn && applyBtn.parentElement) return applyBtn.parentElement;

    // Strategi 2: lewat tombol exitSplitView
    var wrap = document.getElementById('splitWrap');
    if (!wrap) return null;
    var allBtns = wrap.querySelectorAll('button');
    for (var i = 0; i < allBtns.length; i++) {
      var oc = allBtns[i].getAttribute('onclick') || '';
      if (oc.indexOf('exitSplitView') !== -1) return allBtns[i].parentElement;
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════
  // 5. PATCH addPhoto
  // ══════════════════════════════════════════════════════════
  function _patchAddPhoto() {
    var _orig = addPhoto;
    addPhoto = function (file) {
      _orig(file);
      if (!_exifrReady) return;
      setTimeout(function () {
        var p = photos[photos.length - 1];
        if (!p || p.exifGPS !== undefined) return;
        p.exifGPS = null;
        var wait = setInterval(function () {
          if (!p.src) return;
          clearInterval(wait);
          _extractExifGPS(p.src).then(function (gps) {
            if (!gps) return;
            p.exifGPS = gps;
            if (typeof renderPhotoList === 'function') renderPhotoList();
            if (typeof setStatus === 'function')
              setStatus('📍 GPS EXIF: ' + gps.lat.toFixed(5) + ', ' + gps.lng.toFixed(5), 'info');
          });
        }, 200);
      }, 100);
    };
    console.log('[GCP Patch] addPhoto ✓');
  }

  // ══════════════════════════════════════════════════════════
  // 6. PATCH renderPhotoList — badge GPS
  // ══════════════════════════════════════════════════════════
  function _patchRenderPhotoList() {
    var _orig = renderPhotoList;
    renderPhotoList = function () {
      _orig();
      photos.forEach(function (p) {
        if (!p.exifGPS) return;
        document.querySelectorAll('.photo-item').forEach(function (item) {
          if ((item.getAttribute('onclick') || '').indexOf(String(p.id)) === -1) return;
          var nameEl = item.querySelector('.photo-name');
          if (!nameEl || nameEl.querySelector('.exif-badge')) return;
          var badge = document.createElement('span');
          badge.className = 'exif-badge';
          badge.title = 'GPS EXIF: ' + p.exifGPS.lat.toFixed(6) + ', ' + p.exifGPS.lng.toFixed(6);
          badge.textContent = '📍GPS';
          nameEl.appendChild(badge);
        });
      });
    };
    console.log('[GCP Patch] renderPhotoList ✓');
  }

  // ══════════════════════════════════════════════════════════
  // 7. PATCH updateGCPStatus — info EXIF di tab GCP
  // ══════════════════════════════════════════════════════════
  function _patchUpdateGCPStatus() {
    var _orig = updateGCPStatus;
    updateGCPStatus = function () {
      _orig();

      // Hapus panel lama agar tidak dobel
      var old = document.getElementById('exifGpsInfo');
      if (old) old.parentNode.removeChild(old);

      var p = (typeof getPhoto === 'function' && typeof currentPhotoId !== 'undefined')
        ? getPhoto(currentPhotoId) : null;
      if (!p || !p.exifGPS) return;

      var info = document.getElementById('gcpPhotoInfo');
      if (!info) return;

      var div = document.createElement('div');
      div.id = 'exifGpsInfo';
      div.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">' +
          '<span><b>📍 GPS EXIF Foto:</b></span>' +
          '<button id="btnUseExif" style="font-size:8px;padding:2px 7px;border-radius:3px;' +
          'border:1px solid var(--in);background:rgba(88,166,255,.15);color:var(--in);' +
          'cursor:pointer;font-family:\'Space Mono\',monospace">+ Pakai sebagai GCP</button>' +
        '</div>' +
        '<div style="color:var(--mu)">' + p.exifGPS.lat.toFixed(7) + ', ' + p.exifGPS.lng.toFixed(7) + '</div>' +
        '<div style="color:var(--mu);font-size:8px;margin-top:1px">Klik tombol → klik pixel di foto yang ' +
        '<b style="color:var(--in)">persis</b> di titik GPS ini</div>';
      info.appendChild(div);

      var _capturedPhoto = p; // closure
      document.getElementById('btnUseExif').addEventListener('click', function () {
        _useExifAsGCP(_capturedPhoto);
      });
    };
    console.log('[GCP Patch] updateGCPStatus ✓');
  }

  // ══════════════════════════════════════════════════════════
  // 8. PRE-FILL EXIF KE MODAL GCP
  // ══════════════════════════════════════════════════════════
  function _useExifAsGCP(photo) {
    if (!photo || !photo.exifGPS) return;
    if (typeof showToast === 'function')
      showToast('💡 Koordinat EXIF sudah di-pre-fill.\nKlik titik tengah foto yang sesuai posisi GPS.');

    var _origModal = openGCPModal;
    openGCPModal = function (x, y) {
      _origModal(x, y);
      setTimeout(function () {
        var latEl = document.getElementById('inLat');
        var lngEl = document.getElementById('inLng');
        if (latEl && !latEl.value) latEl.value = photo.exifGPS.lat.toFixed(7);
        if (lngEl && !lngEl.value) lngEl.value = photo.exifGPS.lng.toFixed(7);
      }, 30);
      openGCPModal = _origModal;
    };

    if (typeof showImagePanel === 'function' && typeof buildImagePanel === 'function') {
      showImagePanel();
      buildImagePanel(photo);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 9. PATCH enterSplitView — BUG FIX: retry loop, bukan setTimeout tetap
  // ══════════════════════════════════════════════════════════
  function _patchEnterSplitView() {
    var _orig = enterSplitView;

    enterSplitView = function () {
      _orig(); // Jalankan fungsi asli

      // BUG FIX: Retry sampai splitWrap & _splitMap benar-benar siap
      var tries = 0;
      var interval = setInterval(function () {
        tries++;
        var wrap = document.getElementById('splitWrap');
        // _splitMap adalah var global — setelah _orig() selesai pasti sudah di-set
        var mapReady = (typeof _splitMap !== 'undefined' && _splitMap !== null);

        if (!wrap || !mapReady) {
          if (tries >= 25) { // max 2.5 detik
            clearInterval(interval);
            console.warn('[GCP Patch] Timeout: Split View tidak siap');
          }
          return;
        }

        clearInterval(interval); // Berhasil — hentikan loop

        var photo = (typeof getPhoto === 'function' && typeof currentPhotoId !== 'undefined')
          ? getPhoto(currentPhotoId) : null;

        // ── Auto-center & marker kamera (hanya jika foto punya GPS) ──
        if (photo && photo.exifGPS) {
          var gps = photo.exifGPS;
          try {
            _splitMap.setView([gps.lat, gps.lng], 18, { animate: true });

            var camIcon = L.divIcon({
              className: '',
              html: '<div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center">' +
                '<div style="position:absolute;width:34px;height:34px;border-radius:50%;' +
                'background:rgba(88,166,255,.2);border:2px solid rgba(88,166,255,.6);' +
                'animation:svPulse 1.5s infinite"></div>' +
                '<div style="position:relative;width:20px;height:20px;border-radius:50%;' +
                'background:rgba(88,166,255,.9);border:2.5px solid #fff;' +
                'box-shadow:0 1px 6px rgba(0,0,0,.5);display:flex;align-items:center;' +
                'justify-content:center;font-size:11px">📷</div></div>',
              iconSize: [34, 34], iconAnchor: [17, 17]
            });

            var camMarker = L.marker([gps.lat, gps.lng], { icon: camIcon, zIndexOffset: 3000 })
              .bindPopup(
                '<b style="color:var(--in)">📷 Posisi Kamera (EXIF GPS)</b><br>' +
                '<span style="font-family:monospace;font-size:9px;color:var(--mu)">' +
                gps.lat.toFixed(7) + ', ' + gps.lng.toFixed(7) + '</span>',
                { maxWidth: 240 }
              )
              .addTo(_splitMap)
              .openPopup();

            _splitMap.once('click', function () {
              setTimeout(function () { try { _splitMap.removeLayer(camMarker); } catch (e) {} }, 400);
            });
          } catch (e) {
            console.warn('[GCP Patch] Gagal buat marker EXIF:', e);
          }

          // Hint banner
          var mapPane = document.getElementById('splitMapPane');
          if (mapPane) {
            var hint = document.createElement('div');
            hint.className = 'sv-exif-hint';
            hint.innerHTML = '<span class="sv-exif-pulse"></span>GPS EXIF terdeteksi — peta menuju lokasi foto';
            mapPane.appendChild(hint);
            setTimeout(function () { try { hint.parentNode.removeChild(hint); } catch (e) {} }, 5000);
          }
        }

        // ── Inject search bar ──
        _injectSearchBar(photo);

      }, 100); // cek tiap 100ms
    };

    console.log('[GCP Patch] enterSplitView ✓');
  }

  // ══════════════════════════════════════════════════════════
  // 10. INJECT SEARCH BAR KE TOOLBAR
  // ══════════════════════════════════════════════════════════
  function _injectSearchBar(photo) {
    var toolbar = _findSplitToolbar();
    if (!toolbar) {
      console.warn('[GCP Patch] Toolbar tidak ditemukan');
      return;
    }
    if (toolbar.querySelector('.sv-search-bar')) return; // sudah ada

    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:5px;margin-right:6px;flex-shrink:0';

    // Input box
    var searchWrap = document.createElement('div');
    searchWrap.className = 'sv-search-bar';
    searchWrap.title = 'Paste koordinat lat, lng atau URL Google Maps';

    var inp = document.createElement('input');
    inp.id = 'svCoordInput';
    inp.placeholder = 'lat, lng  atau URL Google Maps';
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') _svJump(); });
    searchWrap.appendChild(inp);
    wrapper.appendChild(searchWrap);

    // Tombol Go
    var btnGo = document.createElement('button');
    btnGo.className = 'sv-search-btn';
    btnGo.textContent = '🎯 Go';
    btnGo.addEventListener('click', _svJump);
    wrapper.appendChild(btnGo);

    // Tombol kembali ke EXIF
    if (photo && photo.exifGPS) {
      var btnExif = document.createElement('button');
      btnExif.className = 'sv-search-btn sv-blue';
      btnExif.textContent = '📷 EXIF';
      btnExif.title = 'Kembali ke posisi kamera: ' + photo.exifGPS.lat.toFixed(5) + ', ' + photo.exifGPS.lng.toFixed(5);
      var _gps = photo.exifGPS;
      btnExif.addEventListener('click', function () {
        if (typeof _splitMap !== 'undefined' && _splitMap)
          _splitMap.setView([_gps.lat, _gps.lng], 18, { animate: true });
      });
      wrapper.appendChild(btnExif);
    }

    toolbar.insertBefore(wrapper, toolbar.firstChild);
    console.log('[GCP Patch] Search bar injected ✓' + (photo && photo.exifGPS ? ' (+EXIF btn)' : ''));
  }

  // ══════════════════════════════════════════════════════════
  // 11. JUMP KE KOORDINAT
  // ══════════════════════════════════════════════════════════
  function _svJump() {
    var inp = document.getElementById('svCoordInput');
    if (!inp || typeof _splitMap === 'undefined' || !_splitMap) return;

    var coords = _parseCoord(inp.value);
    if (!coords) {
      inp.style.outline = '2px solid var(--er)';
      inp.style.color = 'var(--er)';
      var ph = inp.placeholder;
      inp.placeholder = '⚠ Format salah — coba: -0.5075, 101.4478';
      setTimeout(function () {
        inp.style.outline = '';
        inp.style.color = '';
        inp.placeholder = ph;
      }, 2500);
      return;
    }

    _splitMap.setView([coords.lat, coords.lng], 18, { animate: true });

    try {
      var icon = L.divIcon({
        className: '',
        html: '<div style="width:20px;height:20px;border-radius:50%;' +
          'background:rgba(248,81,73,.9);border:2.5px solid #fff;' +
          'box-shadow:0 1px 6px rgba(0,0,0,.6)"></div>',
        iconSize: [20, 20], iconAnchor: [10, 10]
      });
      var mk = L.marker([coords.lat, coords.lng], { icon: icon, zIndexOffset: 2500 })
        .addTo(_splitMap)
        .bindPopup('🎯 ' + coords.lat.toFixed(6) + ', ' + coords.lng.toFixed(6))
        .openPopup();
      var rm = function () { try { _splitMap.removeLayer(mk); } catch (e) {} };
      setTimeout(rm, 9000);
      _splitMap.once('click', function () { setTimeout(rm, 300); });
    } catch (e) {}

    inp.value = '';
  }

  // ══════════════════════════════════════════════════════════
  // 12. BATCH EXIF dari foto yang sudah ada
  // ══════════════════════════════════════════════════════════
  function _batchExtract() {
    if (!_exifrReady) return;
    var pending = (typeof photos !== 'undefined' ? photos : [])
      .filter(function (p) { return p.exifGPS === undefined && p.src; });
    if (!pending.length) return;

    var done = 0;
    pending.forEach(function (p) {
      p.exifGPS = null;
      _extractExifGPS(p.src).then(function (gps) {
        if (gps) p.exifGPS = gps;
        if (++done === pending.length) {
          if (typeof renderPhotoList === 'function') renderPhotoList();
          var found = pending.filter(function (x) { return x.exifGPS; }).length;
          if (found && typeof setStatus === 'function')
            setStatus(found + ' foto memiliki GPS EXIF — klik "Pilih GCP dari Peta Satelit"', 'info');
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // 13. INIT — polling sampai DroneMap siap
  // ══════════════════════════════════════════════════════════
  function _init() {
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      if (typeof addPhoto !== 'undefined' &&
          typeof enterSplitView !== 'undefined' &&
          typeof renderPhotoList !== 'undefined') {
        clearInterval(poll);
        _patchAddPhoto();
        _patchRenderPhotoList();
        _patchUpdateGCPStatus();
        _patchEnterSplitView();
        _batchExtract();
        console.log('[DroneMap GCP Patch v1.1] ✅ Aktif — exifr: ' + (_exifrReady ? '✓' : '✗ (fitur lain OK)'));
      }
      if (tries > 60) {
        clearInterval(poll);
        console.error('[GCP Patch] ❌ Timeout: fungsi DroneMap tidak ditemukan setelah 15 detik');
      }
    }, 250);
  }

  // ══════════════════════════════════════════════════════════
  // START
  // ══════════════════════════════════════════════════════════
  _loadExifr(_init); // Load exifr → lalu init (apapun hasilnya)

})();
