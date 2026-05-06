/**
 * DroneMap v3 Pro — Patch: Auto-Lokasi GCP
 * ==========================================
 * File  : dronemap_gcp_patch.js
 * Pasang: <script src="dronemap_gcp_patch.js"></script>
 *         SETELAH semua <script> utama DroneMap, sebelum </body>
 *
 * Fitur:
 *  1. Ekstrak GPS EXIF dari foto saat upload (via exifr)
 *  2. Split View peta otomatis menuju lokasi foto
 *  3. Marker "📷 Kamera di sini" di peta
 *  4. Search bar koordinat di toolbar Split View
 *  5. Badge "📍GPS" di daftar foto
 *  6. Pre-fill koordinat EXIF ke modal GCP
 */

(function () {
  'use strict';

  // ── 0. Inject CSS ─────────────────────────────────────────
  var _css = [
    '.sv-search-bar{display:flex;align-items:center;gap:5px;background:rgba(13,17,23,.92);border:1px solid var(--saw);border-radius:6px;padding:3px 6px 3px 10px;min-width:0}',
    '.sv-search-bar input{background:transparent;border:none;color:var(--tx);font-family:"Space Mono",monospace;font-size:10px;outline:none;width:190px}',
    '.sv-search-bar input::placeholder{color:var(--mu)}',
    '.sv-search-btn{padding:2px 9px;border-radius:4px;border:1px solid var(--saw);background:rgba(90,158,53,.2);color:var(--saw2);font-size:9px;cursor:pointer;white-space:nowrap;font-family:"Space Mono",monospace;transition:.15s}',
    '.sv-search-btn:hover{background:rgba(90,158,53,.4)}',
    '.sv-search-btn.blue{border-color:var(--in);color:var(--in);background:rgba(88,166,255,.15)}',
    '.sv-search-btn.blue:hover{background:rgba(88,166,255,.3)}',
    '.exif-badge{display:inline-block;font-size:8px;padding:1px 5px;border-radius:8px;background:rgba(88,166,255,.15);color:var(--in);border:1px solid rgba(88,166,255,.3);font-family:"Space Mono",monospace;margin-left:4px;vertical-align:middle}',
    '.sv-exif-hint{position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(13,17,23,.95);border:1px solid var(--in);border-radius:20px;padding:5px 14px;font-size:9px;color:var(--in);font-family:"Space Mono",monospace;z-index:300;white-space:nowrap;pointer-events:none;animation:_svFade .4s ease}',
    '@keyframes _svFade{from{opacity:0;transform:translateX(-50%) translateY(-6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
    '.sv-exif-pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--in);margin-right:5px;animation:_svPulse 1.2s infinite;vertical-align:middle}',
    '@keyframes _svPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.5)}}',
    '#exifGpsInfo{margin-top:7px;background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);border-radius:5px;padding:6px 9px;font-size:9px;font-family:"Space Mono",monospace;color:var(--in);line-height:1.8}'
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = _css;
  document.head.appendChild(styleEl);

  // ── 1. Load exifr (lite) via CDN ──────────────────────────
  function _loadExifr(cb) {
    if (typeof exifr !== 'undefined') { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js';
    s.onload = cb;
    s.onerror = function () { console.warn('[GCP Patch] exifr gagal dimuat — fitur EXIF GPS dinonaktifkan'); };
    document.head.appendChild(s);
  }

  // ── 2. Ekstrak GPS dari data URL foto ─────────────────────
  async function _extractExifGPS(dataUrl) {
    try {
      if (typeof exifr === 'undefined') return null;
      var gps = await exifr.gps(dataUrl);
      if (gps && gps.latitude != null && gps.longitude != null) {
        return { lat: gps.latitude, lng: gps.longitude };
      }
    } catch (e) { /* foto tanpa EXIF GPS — biarkan null */ }
    return null;
  }

  // ── 3. Parse input koordinat (berbagai format) ────────────
  function _parseCoord(raw) {
    if (!raw || !raw.trim()) return null;
    raw = raw.trim();

    // Format desimal: "lat, lng" atau "lat lng"
    var parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (parts.length >= 2) {
      var lat = parseFloat(parts[0]);
      var lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
        return { lat: lat, lng: lng };
    }

    // Format URL Google Maps: .../@lat,lng,zoom...
    var m = raw.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) {
      var la = parseFloat(m[1]), lo = parseFloat(m[2]);
      if (!isNaN(la) && !isNaN(lo)) return { lat: la, lng: lo };
    }

    return null;
  }

  // ── 4. Patch addPhoto — ekstrak EXIF setelah file dibaca ──
  function _patchAddPhoto() {
    if (typeof addPhoto === 'undefined') return;
    var _orig = addPhoto;
    addPhoto = function (file) {
      _orig(file);
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
            renderPhotoList();
            setStatus('📍 GPS EXIF: ' + gps.lat.toFixed(5) + ', ' + gps.lng.toFixed(5), 'info');
          });
        }, 200);
      }, 100);
    };
  }

  // ── 5. Patch renderPhotoList — tambah badge GPS ───────────
  function _patchRenderPhotoList() {
    if (typeof renderPhotoList === 'undefined') return;
    var _orig = renderPhotoList;
    renderPhotoList = function () {
      _orig();
      photos.forEach(function (p) {
        if (!p.exifGPS) return;
        document.querySelectorAll('.photo-item').forEach(function (item) {
          var oc = item.getAttribute('onclick') || '';
          if (oc.indexOf(String(p.id)) === -1) return;
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
  }

  // ── 6. Patch updateGCPStatus — info EXIF di tab GCP ──────
  function _patchUpdateGCPStatus() {
    if (typeof updateGCPStatus === 'undefined') return;
    var _orig = updateGCPStatus;
    updateGCPStatus = function () {
      _orig();
      var p = typeof getPhoto === 'function' && typeof currentPhotoId !== 'undefined'
        ? getPhoto(currentPhotoId) : null;
      if (!p || !p.exifGPS) return;
      var info = document.getElementById('gcpPhotoInfo');
      if (!info || info.querySelector('#exifGpsInfo')) return;
      var div = document.createElement('div');
      div.id = 'exifGpsInfo';
      div.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">' +
          '<span><b>📍 GPS EXIF Foto:</b></span>' +
          '<button id="btnUseExif" style="font-size:8px;padding:2px 7px;border-radius:3px;border:1px solid var(--in);background:rgba(88,166,255,.15);color:var(--in);cursor:pointer;font-family:\'Space Mono\',monospace">+ Pakai sebagai GCP</button>' +
        '</div>' +
        '<div style="color:var(--mu)">' + p.exifGPS.lat.toFixed(7) + ', ' + p.exifGPS.lng.toFixed(7) + '</div>' +
        '<div style="color:var(--mu);font-size:8px;margin-top:1px">⚡ Klik tombol → klik pixel di foto yang <b style="color:var(--in)">persis</b> di titik GPS ini</div>';
      info.appendChild(div);
      document.getElementById('btnUseExif').addEventListener('click', _useExifAsGCP);
    };
  }

  // ── 7. Pre-fill EXIF ke modal GCP (sekali pakai) ──────────
  function _useExifAsGCP() {
    var p = typeof getPhoto === 'function' && typeof currentPhotoId !== 'undefined'
      ? getPhoto(currentPhotoId) : null;
    if (!p || !p.exifGPS) return;
    if (typeof showToast === 'function')
      showToast('💡 Koordinat EXIF akan otomatis muncul di modal GCP.\nKlik titik tengah foto yang sesuai GPS ini.');
    var _origModal = openGCPModal;
    openGCPModal = function (x, y) {
      _origModal(x, y);
      setTimeout(function () {
        var latEl = document.getElementById('inLat');
        var lngEl = document.getElementById('inLng');
        if (latEl && !latEl.value) latEl.value = p.exifGPS.lat.toFixed(7);
        if (lngEl && !lngEl.value) lngEl.value = p.exifGPS.lng.toFixed(7);
      }, 30);
      openGCPModal = _origModal; // restore setelah sekali pakai
    };
    // Pastikan image panel tampil
    if (typeof showImagePanel === 'function' && typeof buildImagePanel === 'function') {
      showImagePanel();
      buildImagePanel(p);
    }
  }

  // ── 8. Patch enterSplitView — auto-center + search bar ───
  function _patchEnterSplitView() {
    if (typeof enterSplitView === 'undefined') return;
    var _orig = enterSplitView;
    enterSplitView = function () {
      _orig();
      setTimeout(function () {
        var p = typeof getPhoto === 'function' && typeof currentPhotoId !== 'undefined'
          ? getPhoto(currentPhotoId) : null;

        // ── 8a. Auto-center ke EXIF GPS ──────────────────
        if (p && p.exifGPS && typeof _splitMap !== 'undefined' && _splitMap) {
          var gps = p.exifGPS;
          _splitMap.setView([gps.lat, gps.lng], 18, { animate: true });

          // Marker kamera
          var camIcon = L.divIcon({
            className: '',
            html: '<div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center">' +
              '<div style="position:absolute;width:34px;height:34px;border-radius:50%;background:rgba(88,166,255,.2);border:2px solid rgba(88,166,255,.6);animation:_svPulse 1.5s infinite"></div>' +
              '<div style="position:relative;width:20px;height:20px;border-radius:50%;background:rgba(88,166,255,.9);border:2.5px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px">📷</div>' +
              '</div>',
            iconSize: [34, 34], iconAnchor: [17, 17]
          });
          var camMarker = L.marker([gps.lat, gps.lng], { icon: camIcon, zIndexOffset: 3000 })
            .bindPopup(
              '<b style="color:var(--in)">📷 Posisi Kamera (EXIF GPS)</b><br>' +
              '<span style="font-family:monospace;font-size:9px;color:var(--mu)">' + gps.lat.toFixed(7) + ', ' + gps.lng.toFixed(7) + '</span><br>' +
              '<span style="font-size:9px;color:var(--mu)">Perkiraan titik tengah foto drone</span>',
              { maxWidth: 230 }
            );
          camMarker.addTo(_splitMap).openPopup();
          // Hapus saat user klik peta (sudah mulai tandai GCP)
          _splitMap.once('click', function () {
            setTimeout(function () { try { _splitMap.removeLayer(camMarker); } catch (e) {} }, 400);
          });

          // Hint banner di panel peta
          var mapPane = document.getElementById('splitMapPane');
          if (mapPane) {
            var hint = document.createElement('div');
            hint.className = 'sv-exif-hint';
            hint.innerHTML = '<span class="sv-exif-pulse"></span>GPS EXIF terdeteksi — peta menuju lokasi foto';
            mapPane.appendChild(hint);
            setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 4500);
          }
        }

        // ── 8b. Inject search bar ke toolbar ─────────────
        _injectSearchBar(p);

      }, 160);
    };
  }

  // ── Buat & inject search bar ──────────────────────────────
  function _injectSearchBar(photo) {
    var wrap = document.getElementById('splitWrap');
    if (!wrap) return;
    var toolbar = wrap.querySelector('div[style*="bottom:0"]');
    if (!toolbar || toolbar.querySelector('.sv-search-bar')) return;

    var div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:5px;margin-right:6px;flex-shrink:0';

    // Input
    var searchWrap = document.createElement('div');
    searchWrap.className = 'sv-search-bar';
    searchWrap.title = 'Ketik/paste koordinat lat, lng atau URL Google Maps';
    var inp = document.createElement('input');
    inp.id = 'svCoordInput';
    inp.placeholder = 'lat, lng  —  paste koordinat atau URL Google Maps';
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') _svJump(); });
    searchWrap.appendChild(inp);
    div.appendChild(searchWrap);

    // Tombol Go
    var btnGo = document.createElement('button');
    btnGo.className = 'sv-search-btn';
    btnGo.textContent = '🎯 Go';
    btnGo.addEventListener('click', _svJump);
    div.appendChild(btnGo);

    // Tombol kembali ke EXIF (hanya jika foto punya GPS)
    if (photo && photo.exifGPS) {
      var btnExif = document.createElement('button');
      btnExif.className = 'sv-search-btn blue';
      btnExif.textContent = '📷 EXIF';
      btnExif.title = 'Kembali ke posisi GPS kamera: ' + photo.exifGPS.lat.toFixed(5) + ', ' + photo.exifGPS.lng.toFixed(5);
      btnExif.addEventListener('click', function () {
        if (_splitMap && photo.exifGPS) _splitMap.setView([photo.exifGPS.lat, photo.exifGPS.lng], 18, { animate: true });
      });
      div.appendChild(btnExif);
    }

    toolbar.insertBefore(div, toolbar.firstChild);
  }

  // ── Jump ke koordinat yang diketik ────────────────────────
  function _svJump() {
    var inp = document.getElementById('svCoordInput');
    if (!inp || typeof _splitMap === 'undefined' || !_splitMap) return;
    var coords = _parseCoord(inp.value);
    if (!coords) {
      inp.style.outline = '1px solid var(--er)';
      inp.style.color = 'var(--er)';
      var origPH = inp.placeholder;
      inp.placeholder = '⚠ Format tidak dikenal — coba: -0.5075, 101.4478';
      setTimeout(function () {
        inp.style.outline = '';
        inp.style.color = '';
        inp.placeholder = origPH;
      }, 2200);
      return;
    }
    _splitMap.setView([coords.lat, coords.lng], 18, { animate: true });

    // Marker sementara
    var icon = L.divIcon({
      className: '',
      html: '<div style="width:20px;height:20px;border-radius:50%;background:rgba(248,81,73,.85);border:2.5px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.6)"></div>',
      iconSize: [20, 20], iconAnchor: [10, 10]
    });
    var mk = L.marker([coords.lat, coords.lng], { icon: icon, zIndexOffset: 2500 }).addTo(_splitMap);
    mk.bindPopup('🎯 ' + coords.lat.toFixed(6) + ', ' + coords.lng.toFixed(6)).openPopup();
    setTimeout(function () { try { _splitMap.removeLayer(mk); } catch (e) {} }, 8000);
    _splitMap.once('click', function () { setTimeout(function () { try { _splitMap.removeLayer(mk); } catch (e) {} }, 300); });

    inp.value = '';
  }

  // ── 9. Batch ekstrak EXIF foto yang sudah ada ─────────────
  function _batchExtract() {
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

  // ── 10. Init semua patch setelah DOM + library siap ───────
  function _init() {
    // Tunggu sampai fungsi DroneMap tersedia (library mungkin masih loading)
    var attempts = 0;
    var ready = setInterval(function () {
      attempts++;
      if (typeof addPhoto !== 'undefined' && typeof enterSplitView !== 'undefined') {
        clearInterval(ready);
        _patchAddPhoto();
        _patchRenderPhotoList();
        _patchUpdateGCPStatus();
        _patchEnterSplitView();
        _batchExtract();
        console.log('[DroneMap Patch] Auto-Lokasi GCP aktif ✓');
      }
      if (attempts > 40) {
        clearInterval(ready);
        console.warn('[DroneMap Patch] Timeout menunggu fungsi DroneMap');
      }
    }, 250);
  }

  // Load exifr dulu, lalu init
  _loadExifr(_init);

})();
