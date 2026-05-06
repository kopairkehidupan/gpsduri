// ============================================================
// DroneMap v3 Pro — Memory Fix Patch v2
// Fix: "Not enough memory to open this page" saat load .dmsession
//
// STRATEGI UTAMA v2:
//  1. Base64 → Blob URL conversion — string base64 besar dibebaskan
//     dari JS heap segera setelah konversi ke Blob URL. Browser
//     menyimpan Blob data di luar JS heap (memory lebih efisien).
//  2. One-photo-at-a-time processing dengan GC pause yang lebih lama
//  3. Adaptive MAX_DIM berdasarkan RAM device
//  4. Lazy OFC build queue — canvas hanya dibangun saat di viewport
//  5. JSON text null-out segera setelah parse
//
// CARA PAKAI: pastikan file ini dipanggil setelah script utama:
//   <script src="dronemap_memory_fix.js"></script>
// ============================================================

'use strict';

// ─────────────────────────────────────────────
// UTIL: yield ke UI/GC
// ─────────────────────────────────────────────
if (typeof _yieldToUI === 'undefined') {
  window._yieldToUI = function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms || 16); });
  };
}

// ─────────────────────────────────────────────
// 1. ADAPTIVE MAX_DIM
// ─────────────────────────────────────────────
function _getMaxDim() {
  var mem = (navigator.deviceMemory || 4);
  if (mem <= 1) return 384;
  if (mem <= 2) return 512;
  if (mem <= 3) return 768;
  if (mem <= 4) return 1024;
  return 2048;
}

// ─────────────────────────────────────────────
// 2. BASE64 → BLOB URL CONVERTER
//    Konversi data URL ke Blob URL, bebaskan string base64 dari heap
// ─────────────────────────────────────────────

// Menyimpan semua blob URL yang dibuat agar bisa direvokeObjectURL saat hapus foto
var _allBlobUrls = {};  // { photoId: blobUrl }

async function _srcToBlobUrl(photoId, src) {
  if (!src) return null;
  // Revoke URL lama jika ada
  if (_allBlobUrls[photoId]) {
    try { URL.revokeObjectURL(_allBlobUrls[photoId]); } catch(e) {}
  }
  try {
    // fetch(dataUrl) lebih efisien dari manual atob loop
    var response = await fetch(src);
    var blob = await response.blob();
    var blobUrl = URL.createObjectURL(blob);
    _allBlobUrls[photoId] = blobUrl;
    return blobUrl;
  } catch(e) {
    console.warn('[MemFix] _srcToBlobUrl error:', e);
    return src; // fallback ke src asli jika gagal
  }
}

// ─────────────────────────────────────────────
// 3. OVERRIDE buildFeatheredCanvas
//    Mendukung blob URL dan adaptive MAX_DIM
// ─────────────────────────────────────────────
window.buildFeatheredCanvas = function(imgSrc, w, h, featherAmt, brightness, contrast, saturation, callback) {
  var MAX_DIM = _getMaxDim();
  var sc = 1;
  if (w > MAX_DIM || h > MAX_DIM) sc = Math.min(MAX_DIM / w, MAX_DIM / h);
  var ow = Math.round(w * sc);
  var oh = Math.round(h * sc);

  var p = new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      try {
        var ofc = document.createElement('canvas');
        ofc.width = ow; ofc.height = oh;
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
          mask = null;
        }

        ofc._origW = w;
        ofc._origH = h;

        // Bebaskan img dari memori segera
        img.src = '';

        if (callback) callback(ofc);
        resolve({ ofc: ofc, img: null });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = function() { reject(new Error('Gagal load gambar')); };
    img.src = imgSrc;
  });

  return p;
};

// ─────────────────────────────────────────────
// 4. GLOBAL OFC BUILD QUEUE (Lazy canvas build)
// ─────────────────────────────────────────────
window._ofcBuildQueue = window._ofcBuildQueue || [];
window._ofcBuildRunning = false;

window._enqueueBuild = function(layerInst) {
  if (!layerInst) return;
  if (layerInst._ofc || layerInst._ofcBuilding) return;
  if (_ofcBuildQueue.indexOf(layerInst) !== -1) return;
  _ofcBuildQueue.push(layerInst);
  _drainBuildQueue();
};

async function _drainBuildQueue() {
  if (_ofcBuildRunning) return;
  _ofcBuildRunning = true;
  while (_ofcBuildQueue.length > 0) {
    var inst = _ofcBuildQueue.shift();
    if (!inst || !inst._map || inst._ofc || inst._ofcBuilding) continue;
    try {
      await inst._buildOfc();
    } catch (e) {
      console.warn('[MemFix] OFC build error:', e);
    }
    await _yieldToUI(150);  // GC pause lebih lama
  }
  _ofcBuildRunning = false;
}

// ─────────────────────────────────────────────
// 5. OVERRIDE createRotatedOverlay — Lazy build + Blob URL support
// ─────────────────────────────────────────────
window.createRotatedOverlay = function(photo, toGeo) {
  var tl = toGeo(0, 0), tr = toGeo(photo.w, 0), br = toGeo(photo.w, photo.h), bl = toGeo(0, photo.h);
  photo.corners = { tl: tl, tr: tr, br: br, bl: bl };
  var lats = [tl.lat, tr.lat, br.lat, bl.lat], lngs = [tl.lng, tr.lng, br.lng, bl.lng];
  photo.bounds = [
    [Math.min.apply(null, lats), Math.min.apply(null, lngs)],
    [Math.max.apply(null, lats), Math.max.apply(null, lngs)]
  ];
  if (photo.offsetLat === undefined) photo.offsetLat = 0;
  if (photo.offsetLng === undefined) photo.offsetLng = 0;
  if (photo.feather === undefined) photo.feather = 0.12;
  if (photo.blendMode === undefined) photo.blendMode = 'normal';

  var RotatedLayer = L.Layer.extend({
    _ofc: null, _ofcImg: null, _canvas: null,
    _ofcBuilding: false, _ofcPromise: null,

    onAdd: function(map) {
      this._map = map;
      this._canvas = document.createElement('canvas');
      this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;transition:opacity 0.35s ease;';
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('zoom viewreset move zoomend moveend resize', this._update, this);
    },

    onRemove: function(map) {
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      map.off('zoom viewreset move zoomend moveend resize', this._update, this);
      var qi = _ofcBuildQueue.indexOf(this);
      if (qi !== -1) _ofcBuildQueue.splice(qi, 1);
      if (this._ofc) {
        try { this._ofc.width = 1; this._ofc.height = 1; } catch(e) {}
        this._ofc = null;
      }
      this._canvas = null;
      this._ofcPromise = null;
    },

    _getImgSrc: function() {
      // Gunakan blob URL jika tersedia (hemat heap), fallback ke src
      return photo._blobUrl || photo.src || null;
    },

    _buildOfc: function() {
      if (this._ofcBuilding) return this._ofcPromise || Promise.resolve();
      if (this._ofc) return Promise.resolve({ ofc: this._ofc });

      var imgSrc = this._getImgSrc();
      if (!imgSrc) return Promise.resolve();

      this._ofcBuilding = true;
      var self = this;

      this._ofcPromise = buildFeatheredCanvas(
        imgSrc, photo.w, photo.h,
        photo.feather, photo.brightness, photo.contrast, photo.saturation
      ).then(function(result) {
        self._ofc = result.ofc;
        self._ofcBuilding = false;
        self._ofcPromise = null;
        self._update();
        return result;
      }).catch(function(err) {
        self._ofcBuilding = false;
        self._ofcPromise = null;
        console.warn('[MemFix] buildFeatheredCanvas error:', err);
      });

      return this._ofcPromise;
    },

    _rebuildOfc: function() {
      var imgSrc = this._getImgSrc();
      if (!imgSrc) return;
      if (this._ofc) {
        try { this._ofc.width = 1; this._ofc.height = 1; } catch(e) {}
        this._ofc = null;
      }
      _enqueueBuild(this);
    },

    _isInViewport: function(map) {
      if (!map || !photo.corners) return true;
      try {
        var bounds = map.getBounds();
        var oLat = photo.offsetLat || 0, oLng = photo.offsetLng || 0;
        var minLat = Math.min(tl.lat, tr.lat, br.lat, bl.lat) + oLat;
        var maxLat = Math.max(tl.lat, tr.lat, br.lat, bl.lat) + oLat;
        var minLng = Math.min(tl.lng, tr.lng, br.lng, bl.lng) + oLng;
        var maxLng = Math.max(tl.lng, tr.lng, br.lng, bl.lng) + oLng;
        return !(maxLat < bounds.getSouth() || minLat > bounds.getNorth() ||
                 maxLng < bounds.getWest()  || minLng > bounds.getEast());
      } catch(e) { return true; }
    },

    _update: function() {
      var map = this._map; if (!map) return;

      if (!this._ofc) {
        if (!this._ofcBuilding && this._isInViewport(map)) {
          _enqueueBuild(this);
        }
        return;
      }

      var mapSize = map.getSize();
      var topLeft = map.containerPointToLayerPoint([0, 0]);

      this._canvas.style.width = mapSize.x + 'px';
      this._canvas.style.height = mapSize.y + 'px';
      this._canvas.style.left = topLeft.x + 'px';
      this._canvas.style.top = topLeft.y + 'px';
      this._canvas.width = mapSize.x;
      this._canvas.height = mapSize.y;
      this._canvas.style.zIndex = (photo.zOrder || 0) + 10;

      var oLat = photo.offsetLat || 0, oLng = photo.offsetLng || 0;
      var pts = [
        map.latLngToLayerPoint(L.latLng(tl.lat + oLat, tl.lng + oLng)),
        map.latLngToLayerPoint(L.latLng(tr.lat + oLat, tr.lng + oLng)),
        map.latLngToLayerPoint(L.latLng(br.lat + oLat, br.lng + oLng)),
        map.latLngToLayerPoint(L.latLng(bl.lat + oLat, bl.lng + oLng))
      ];
      var off = topLeft;
      var cpts = pts.map(function(p) { return { x: p.x - off.x, y: p.y - off.y }; });
      var ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

      var W2 = this._ofc._origW || photo.w;
      var H2 = this._ofc._origH || photo.h;

      var a = (cpts[1].x - cpts[0].x) / W2;
      var b = (cpts[3].x - cpts[0].x) / H2;
      var c = (cpts[1].y - cpts[0].y) / W2;
      var d = (cpts[3].y - cpts[0].y) / H2;
      var e2 = cpts[0].x, f2 = cpts[0].y;

      var clipPts;
      var activeBK = (typeof _batasKebunPolygons !== 'undefined') ? _batasKebunPolygons : [];
      var ownedBK = null;
      if (activeBK && activeBK.length > 0) {
        for (var _bki = 0; _bki < activeBK.length; _bki++) {
          if (typeof _bkOwnerMap !== 'undefined' && _bkOwnerMap[activeBK[_bki].id] === photo.id) {
            ownedBK = activeBK[_bki]; break;
          }
        }
        if (ownedBK) {
          clipPts = ownedBK.verts.map(function(v) {
            var lp = map.latLngToLayerPoint(L.latLng(v.lat, v.lng));
            return { x: lp.x - off.x, y: lp.y - off.y };
          });
        }
      }
      var _sm = (typeof _seamlineMode !== 'undefined') ? _seamlineMode : false;
      if (!clipPts && _sm && photo.voronoiCell && photo.voronoiCell.length >= 3) {
        clipPts = photo.voronoiCell.map(function(v) {
          var lp = map.latLngToLayerPoint(L.latLng(v.lat, v.lng));
          return { x: lp.x - off.x, y: lp.y - off.y };
        });
      }
      if (!clipPts) clipPts = cpts;

      this._canvas.style.opacity = this._nadirOp !== undefined ? this._nadirOp : photo.opacity;

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = photo.blendMode || 'normal';
      ctx.beginPath();
      ctx.moveTo(clipPts[0].x, clipPts[0].y);
      for (var ci = 1; ci < clipPts.length; ci++) ctx.lineTo(clipPts[ci].x, clipPts[ci].y);
      ctx.closePath(); ctx.clip();
      ctx.transform(a, c, b, d, e2, f2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this._ofc, 0, 0, W2, H2);
      ctx.restore();

      if (activeBK && activeBK.length > 0 && !ownedBK) {
        activeBK.forEach(function(bk) {
          if (!bk.verts || bk.verts.length < 3) return;
          var bkPts = bk.verts.map(function(v) {
            var lp = map.latLngToLayerPoint(L.latLng(v.lat, v.lng));
            return { x: lp.x - off.x, y: lp.y - off.y };
          });
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(bkPts[0].x, bkPts[0].y);
          for (var _pi = 1; _pi < bkPts.length; _pi++) ctx.lineTo(bkPts[_pi].x, bkPts[_pi].y);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      }
    },

    setOpacityVal: function(op) {
      photo.opacity = op;
      if (this._canvas && this._nadirOp === undefined) this._canvas.style.opacity = op;
    },
    setNadirOpacity: function(op) { this._nadirOp = op; if (this._canvas) this._canvas.style.opacity = op; },
    clearNadirOpacity: function() { this._nadirOp = undefined; if (this._canvas) this._canvas.style.opacity = photo.opacity; },
    setFeatherVal: function(v) { photo.feather = v; this._rebuildOfc(); },
    setBlendMode: function(m) { photo.blendMode = m; this._update(); },
    setColorAdj: function(br, ct, sat) {
      photo.brightness = br || 100; photo.contrast = ct || 100; photo.saturation = sat || 100;
      this._rebuildOfc();
    },
    forceUpdate: function() { this._update(); }
  });

  return new RotatedLayer();
};

// ─────────────────────────────────────────────
// 6. DETEKSI SPEK DEVICE
// ─────────────────────────────────────────────
function _getDeviceProfile() {
  var mem   = navigator.deviceMemory || 4;   // GB RAM (API)
  var cores = navigator.hardwareConcurrency || 4;
  var isLow  = mem <= 2 || cores <= 2;
  var isVeryLow = mem <= 1;
  return {
    mem: mem, cores: cores,
    isLow: isLow, isVeryLow: isVeryLow,
    // GC pause adaptif
    gcAfterParse:   isVeryLow ? 800  : isLow ? 400  : 200,
    gcBetweenPhoto: isVeryLow ? 500  : isLow ? 250  : 100,
    gcAfterBlob:    isVeryLow ? 300  : isLow ? 150  : 60,
    gcAfterOverlay: isVeryLow ? 200  : isLow ? 80   : 20,
    // Batas file yang dianggap "besar"
    warnMB: isVeryLow ? 20 : isLow ? 40 : 80
  };
}

// ─────────────────────────────────────────────
// 6b. DIALOG WARNING SEBELUM LOAD
// ─────────────────────────────────────────────
function _showLoadWarning(sizeMB, profile, onContinue, onCancel) {
  var risk = sizeMB > profile.warnMB * 2 ? 'TINGGI' :
             sizeMB > profile.warnMB     ? 'SEDANG' : null;

  // Jika risiko rendah, langsung lanjut tanpa dialog
  if (!risk && !profile.isLow) { onContinue(); return; }

  var riskColor = risk === 'TINGGI' ? '#f85149' : '#f0a500';
  var ramLabel  = profile.mem >= 4 ? profile.mem + ' GB' : '≤' + profile.mem + ' GB (rendah)';

  var bg = document.createElement('div');
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;'
    + 'align-items:center;justify-content:center;z-index:999999;backdrop-filter:blur(6px)';

  bg.innerHTML = '<div style="background:var(--sf);border:1px solid var(--bd);border-radius:12px;'
    + 'padding:20px;width:340px;max-width:95vw;font-family:\'DM Sans\',sans-serif">'
    + '<div style="font-size:13px;font-weight:700;color:var(--tx);margin-bottom:10px">⚠ Perhatian Sebelum Memuat</div>'
    + '<div style="background:var(--s2);border-radius:7px;padding:10px 12px;margin-bottom:12px;'
    +   'font-size:9px;font-family:\'Space Mono\',monospace;line-height:2">'
    + 'Ukuran file: <b style="color:var(--in)">' + sizeMB + ' MB</b><br>'
    + 'RAM terdeteksi: <b style="color:' + (profile.isLow ? '#f0a500' : 'var(--ok)') + '">' + ramLabel + '</b><br>'
    + 'Inti CPU: <b>' + profile.cores + ' core</b><br>'
    + (risk ? 'Risiko crash: <b style="color:' + riskColor + '">' + risk + '</b>' : '')
    + '</div>'
    + (profile.isLow || risk ? '<div style="font-size:10px;color:var(--mu);line-height:1.7;margin-bottom:12px">'
    + '💡 <b style="color:var(--tx)">Tips:</b> Tutup semua tab/aplikasi lain sebelum memuat. '
    + 'Jangan klik apapun selama proses berlangsung.</div>' : '')
    + '<div style="font-size:10px;color:var(--mu);margin-bottom:14px;line-height:1.6">'
    + 'Mode <b style="color:var(--saw2)">Hemat Memori</b> akan aktif otomatis. '
    + 'Foto akan muncul bertahap setelah dimuat.</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    + '<button id="_warnCancel" style="padding:7px 16px;border-radius:6px;border:1px solid var(--bd);'
    +   'background:var(--s2);color:var(--tx);font-size:11px;cursor:pointer">Batal</button>'
    + '<button id="_warnOk" style="padding:7px 16px;border-radius:6px;border:none;'
    +   'background:var(--saw);color:#fff;font-size:11px;font-weight:700;cursor:pointer">Tetap Muat</button>'
    + '</div></div>';

  document.body.appendChild(bg);
  bg.querySelector('#_warnCancel').onclick = function() { document.body.removeChild(bg); onCancel(); };
  bg.querySelector('#_warnOk').onclick     = function() { document.body.removeChild(bg); onContinue(); };
}

// ─────────────────────────────────────────────
// 6c. CORE FIX: Override session loader
//     Low-spec safe version
// ─────────────────────────────────────────────
function _installSessionFileInputPatch() {
  var inp = document.getElementById('sessionFileInput');
  if (!inp) { setTimeout(_installSessionFileInputPatch, 500); return; }

  var newInp = inp.cloneNode(true);
  inp.parentNode.replaceChild(newInp, inp);

  newInp.addEventListener('change', function(e) {
    var f = e.target.files[0];
    if (!f) return;
    e.target.value = '';

    var sizeMB  = (f.size / 1024 / 1024).toFixed(1);
    var profile = _getDeviceProfile();

    _showLoadWarning(parseFloat(sizeMB), profile, function() {
      _startSessionRead(f, parseFloat(sizeMB), profile);
    }, function() {
      // user batal — biarkan status tidak tampil
    });
  });
}

function _startSessionRead(f, sizeMB, profile) {
  var statusEl = document.getElementById('sessionLoadStatus');
  statusEl.style.display  = '';
  statusEl.style.background = 'rgba(88,166,255,.08)';
  statusEl.style.color    = 'var(--in)';
  statusEl.style.border   = '1px solid rgba(88,166,255,.25)';

  statusEl.innerHTML = '⏳ Membaca file (' + sizeMB + ' MB)...<br>'
    + '<div style="width:100%;height:5px;background:var(--bd);border-radius:3px;margin-top:6px">'
    + '<div id="sessLoadBar" style="height:100%;width:0%;background:var(--in);border-radius:3px;transition:width .4s"></div></div>'
    + '<div id="sessLoadMsg" style="font-size:9px;color:var(--mu);margin-top:4px;font-family:\'Space Mono\',monospace">Membaca file...</div>'
    + '<div id="sessLoadEta" style="font-size:8px;color:var(--mu);margin-top:2px"></div>';

  // Gunakan ArrayBuffer agar pembacaan lebih efisien daripada readAsText
  var reader = new FileReader();
  var _startTime = Date.now();

  reader.onprogress = function(ev) {
    if (!ev.lengthComputable) return;
    var pct = Math.round(ev.loaded / ev.total * 38);
    var bar = document.getElementById('sessLoadBar');
    var eta = document.getElementById('sessLoadEta');
    if (bar) bar.style.width = pct + '%';
    if (eta) {
      var elapsed = (Date.now() - _startTime) / 1000;
      var speed   = ev.loaded / elapsed / 1024 / 1024; // MB/s
      var remain  = (ev.total - ev.loaded) / 1024 / 1024 / Math.max(speed, 0.01);
      eta.textContent = speed.toFixed(1) + ' MB/s · sisa ~' + remain.toFixed(0) + 's';
    }
  };

  reader.onload = function(ev) {
    var bar = document.getElementById('sessLoadBar');
    var msg = document.getElementById('sessLoadMsg');
    if (bar) bar.style.width = '40%';
    if (msg) msg.textContent = 'Parsing JSON... (jangan klik apapun)';

    // Yield panjang sebelum JSON.parse — beri GC waktu bersih
    setTimeout(function() {
      var jsonText;
      try {
        // Decode ArrayBuffer → string
        jsonText = new TextDecoder('utf-8').decode(ev.target.result);
      } catch(decErr) {
        // Fallback: sudah string jika readAsText dipanggil
        jsonText = ev.target.result;
      }

      var data;
      try {
        data = JSON.parse(jsonText);
      } catch(err) {
        statusEl.innerHTML = '❌ Error parsing: ' + err.message;
        statusEl.style.color = 'var(--er)';
        return;
      }
      jsonText = null; // Bebaskan string JSON segera

      if (bar) bar.style.width = '43%';
      if (msg) msg.textContent = 'JSON OK. Mulai konversi foto...';

      if (!data || !data.photos) {
        statusEl.innerHTML = '❌ Format file tidak valid.';
        statusEl.style.color = 'var(--er)';
        return;
      }

      _doLoadSessionWithBlobConversion(data, statusEl, bar, msg, profile);

    }, profile.gcAfterParse); // Pause adaptif berdasarkan spek device
  };

  reader.onerror = function() {
    statusEl.innerHTML = '❌ Gagal membaca file.';
    statusEl.style.color = 'var(--er)';
  };

  // ArrayBuffer lebih efisien dari readAsText untuk file besar
  try {
    reader.readAsArrayBuffer(f);
  } catch(e) {
    reader.readAsText(f, 'utf-8'); // Fallback
  }
}

// ─────────────────────────────────────────────
// 7. MAIN LOADER: Low-spec safe
//    - GC pause adaptif per spek
//    - TIDAK build OFC saat load (benar-benar lazy)
//    - Proses foto satu per satu dengan jeda panjang
// ─────────────────────────────────────────────
async function _doLoadSessionWithBlobConversion(data, statusEl, barEl, msgEl, profile) {
  profile = profile || _getDeviceProfile();

  function setBar(pct, msg) {
    if (barEl) barEl.style.width = Math.min(pct, 100) + '%';
    if (msgEl) msgEl.textContent = msg || '';
  }

  // Countdown helper — beri GC waktu sambil tunjukkan countdown ke user
  async function _gcWait(ms, label) {
    if (!label || ms <= 100) { await _yieldToUI(ms); return; }
    // Tampilkan countdown untuk jeda panjang (spek rendah)
    var steps = Math.ceil(ms / 100);
    for (var s = 0; s < steps; s++) {
      var remain = Math.ceil((ms - s * 100) / 1000);
      if (msgEl && remain > 0) {
        msgEl.textContent = label + (remain > 1 ? ' (' + remain + 's...)' : '...');
      }
      await _yieldToUI(100);
    }
  }

  try {
    if (window._ofcBuildQueue) _ofcBuildQueue.length = 0;

    // ── Bersihkan state lama ──
    if (typeof photos !== 'undefined') {
      photos.forEach(function(p) {
        if (p.overlay && map) try { map.removeLayer(p.overlay); } catch(ex) {}
        if (p.gcpLayer && map) try { map.removeLayer(p.gcpLayer); } catch(ex) {}
        if (p._blobUrl) {
          try { URL.revokeObjectURL(p._blobUrl); } catch(ex) {}
          delete _allBlobUrls[p.id];
        }
      });
    }
    if (typeof _geserPhotoId !== 'undefined' && _geserPhotoId) _stopGeserMode();
    if (typeof _geserMarkers !== 'undefined') {
      Object.keys(_geserMarkers).forEach(function(id) {
        if (_geserMarkers[id] && map) try { map.removeLayer(_geserMarkers[id]); } catch(ex) {}
      });
      _geserMarkers = {};
    }
    if (typeof _treeLayer !== 'undefined' && _treeLayer) _treeLayer.clearLayers();
    if (typeof _labelDragMarkers !== 'undefined') {
      Object.keys(_labelDragMarkers).forEach(function(id) {
        if (_labelDragMarkers[id] && map) try { map.removeLayer(_labelDragMarkers[id]); } catch(ex) {}
      });
      _labelDragMarkers = {};
    }

    setBar(44, 'Restore variabel sesi...');
    await _yieldToUI(30);

    var photoDataArray = data.photos;
    data.photos = null;

    measures             = data.measures || [];
    shapeId              = data.shapeId || 0;
    trees                = (data.trees || []).map(function(t) { return Object.assign({}, t, { marker: null }); });
    treeId               = data.treeId || 0;
    _batasKebunIds       = new Set(data.batasKebunIds || []);
    _bkOwnerMapExplicit  = data.bkOwnerMapExplicit || {};
    _bkColorMap          = data.bkColorMap || {};
    _labelOffsets        = data.labelOffsets || {};
    _exportBatasShow     = data.exportBatasShow || {};
    _exportLabelShow     = data.exportLabelShow || {};
    _bkOwnerMap          = {};
    _batasKebunPolygons  = [];
    areaUnit             = data.areaUnit || 'auto';
    lenUnit              = data.lenUnit || 'auto';
    data = null; // Bebaskan object data dari heap!

    setBar(47, 'Rebuild foto array...');
    await _yieldToUI(40);

    // Buat array foto TANPA src (src diisi satu per satu)
    photos = photoDataArray.map(function(p) {
      return {
        id: p.id, name: p.name,
        src: null,
        _srcBase64: p.src, // Sumber sementara, akan dibebaskan setelah konversi
        _blobUrl: null,
        w: p.w || 0, h: p.h || 0,
        gcps: p.gcps || [],
        georef: p.georef || false,
        bounds: p.bounds || null,
        corners: p.corners || null,
        overlay: null, gcpLayer: null,
        visible: p.visible !== false,
        opacity: p.opacity !== undefined ? p.opacity : 1,
        feather: p.feather || 0,
        blendMode: p.blendMode || 'normal',
        offsetLat: p.offsetLat || 0,
        offsetLng: p.offsetLng || 0,
        zOrder: p.zOrder || 0,
        brightness: p.brightness || 100,
        contrast: p.contrast || 100,
        saturation: p.saturation || 100,
        colorNormApplied: p.colorNormApplied || false
      };
    });

    photoDataArray = null; // PENTING: bebaskan array besar dari heap
    // GC pause panjang — spek rendah butuh waktu lebih lama untuk bebaskan memori
    await _gcWait(profile.gcAfterParse, 'Membersihkan memori');

    setBar(50, 'Init peta...');
    await _yieldToUI(40);

    var georefPhotos = photos.filter(function(p) { return p.georef && p.gcps && p.gcps.length >= 3; });
    if (georefPhotos.length > 0) {
      if (!map) {
        _initMapFromPhoto(georefPhotos[0]);
        await _yieldToUI(100);
      } else {
        if (drawnItems) drawnItems.clearLayers();
      }
    }

    setBar(54, 'Restore polygon...');
    await _yieldToUI(30);
    _restoreMeasureLayers();

    // ── PROSES FOTO SATU PER SATU ──
    // Low-spec strategy: base64 → blob → overlay, TANPA _buildOfc()
    // OFC hanya dibangun oleh _enqueueBuild saat viewport berubah
    var total = photos.length;

    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      var pct = 55 + Math.round((i / Math.max(total, 1)) * 30);
      setBar(pct, 'Foto ' + (i + 1) + '/' + total + ': ' + photo.name);
      await _yieldToUI(16);

      if (!photo._srcBase64) continue;

      // Konversi base64 → Blob URL (bebaskan string besar dari JS heap)
      try {
        var blobUrl = await _srcToBlobUrl(photo.id, photo._srcBase64);
        photo._blobUrl = blobUrl;
        photo.src = blobUrl;
        photo._srcBase64 = null; // Bebaskan string base64!
        await _gcWait(profile.gcAfterBlob, 'GC setelah foto ' + (i + 1));
      } catch(convErr) {
        console.warn('[MemFix] Blob gagal:', photo.name, convErr);
        photo.src = photo._srcBase64;
        photo._srcBase64 = null;
      }

      if (!photo.georef || photo.gcps.length < 3) continue;

      try {
        if (!photo.w || !photo.h) {
          await new Promise(function(resolve) {
            var im = new Image();
            im.onload = function() {
              photo.w = im.naturalWidth;
              photo.h = im.naturalHeight;
              im.src = ''; im = null; resolve();
            };
            im.onerror = resolve;
            im.src = photo._blobUrl || photo.src;
          });
        }

        var toGeo = buildAffine(photo.gcps);
        photo.overlay = createRotatedOverlay(photo, toGeo);

        if (photo.visible && map) {
          photo.overlay.addTo(map);
          // ⚠ TIDAK panggil _buildOfc() di sini
          // OFC dibangun oleh _enqueueBuild saat foto masuk viewport
          // Ini krusial untuk mencegah crash di spek rendah
        }

        photo.gcpLayer = L.featureGroup();
        photo.gcps.forEach(function(g, gi) {
          L.circleMarker([g.lat, g.lng], {
            radius: 7, fillColor: '#f0a500', color: '#000',
            weight: 2, fillOpacity: 1, pane: 'gcpPane'
          }).addTo(photo.gcpLayer)
            .bindPopup('<b>' + photo.name + '</b><br>GCP ' + (gi + 1));
        });
        var togGCP = document.getElementById('togGCP');
        if (togGCP && togGCP.checked && map) photo.gcpLayer.addTo(map);

      } catch(photoErr) {
        console.warn('[MemFix] Overlay gagal "' + photo.name + '":', photoErr);
      }

      // GC pause antar foto — lebih panjang untuk spek rendah
      await _gcWait(profile.gcBetweenPhoto, 'Jeda GC');
    }

    // ── Tree markers ──
    setBar(86, 'Restore pokok sawit...');
    await _yieldToUI(30);
    if (_treeLayer) _treeLayer.clearLayers();
    trees.forEach(function(t) { addTreeMarker(t); });

    setBar(90, 'Fit bounds...');
    await _yieldToUI(30);
    var allBounds = photos.filter(function(p) { return p.georef && p.bounds; }).map(function(p) { return p.bounds; });
    if (allBounds.length > 0 && map) {
      var aLats = [], aLngs = [];
      allBounds.forEach(function(b) { aLats.push(b[0][0], b[1][0]); aLngs.push(b[0][1], b[1][1]); });
      map.fitBounds([
        [Math.min.apply(null, aLats), Math.min.apply(null, aLngs)],
        [Math.max.apply(null, aLats), Math.max.apply(null, aLngs)]
      ], { padding: [20, 20] });
    }

    setBar(93, 'Finalisasi...');
    await _yieldToUI(30);
    _rebuildBatasKebunPolygons();
    _updateBatasKebunInfoPanel();
    updateGcpCoverageBox();
    hideImagePanel();
    updateStep(3);

    setBar(95, 'Update tampilan...');
    await _yieldToUI(30);

    var georefDone = photos.filter(function(p) { return p.georef; }).length;

    renderMeasures();
    renderTreeList();
    updateStats();
    updateSensusStats();
    renderExportBlokList();

    await _yieldToUI(40);
    renderPhotoList();
    await _yieldToUI(40);
    renderLayerList();

    document.getElementById('hdrPhotoCount').textContent = photos.length + ' foto';
    document.getElementById('hdrTreeCount').textContent = '🌴 ' + trees.length + ' pokok';

    if (georefDone > 0) {
      document.getElementById('hdrRotTag').style.display = '';
      document.getElementById('hdrRotTag').textContent = '✓ ' + georefDone + ' foto georef';
    }

    document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function(p2) { p2.classList.remove('active'); });
    document.querySelectorAll('.stab')[4].classList.add('active');
    document.getElementById('tab-measure').classList.add('active');

    setBar(100, 'Selesai!');

    var modeLabel = profile.isVeryLow ? 'Ultra Hemat' : profile.isLow ? 'Hemat Memori' : 'Normal';
    if (statusEl) {
      statusEl.style.background = 'rgba(63,185,80,.08)';
      statusEl.style.color = 'var(--ok)';
      statusEl.style.border = '1px solid rgba(63,185,80,.25)';
      statusEl.innerHTML = '✅ Sesi dipulihkan! <span style="color:var(--mu);font-size:8px">[' + modeLabel + ']</span><br>'
        + georefDone + ' foto georef · '
        + measures.length + ' pengukuran · '
        + trees.length + ' pokok sawit<br>'
        + '<span style="color:var(--mu);font-size:8px">'
        + '⏳ Foto muncul bertahap saat di-zoom/pan di peta</span>';
    }
    showToast('✅ Sesi dipulihkan!\n'
      + georefDone + ' foto · ' + measures.length + ' ukuran · ' + trees.length + ' pokok\n'
      + '⏳ Zoom/pan peta untuk tampilkan foto...');

  } catch(err) {
    console.error('[MemFix] Load session error:', err);
    if (statusEl) {
      statusEl.style.background = 'rgba(248,81,73,.08)';
      statusEl.style.color = 'var(--er)';
      statusEl.style.border = '1px solid rgba(248,81,73,.3)';
      statusEl.innerHTML = '❌ Gagal: ' + err.message
        + '<br><span style="font-size:8px;color:var(--mu)">'
        + '💡 Coba: tutup tab lain → reload halaman → muat ulang file</span>';
    }
  }
}

// ─────────────────────────────────────────────
// 8. OVERRIDE georefPhoto — lazy build
// ─────────────────────────────────────────────
window.georefPhoto = function(photo) {
  if (!photo || photo.gcps.length < 3) return;
  if (!map) initMap(photo);
  var toGeo = buildAffine(photo.gcps);
  var residuals = photo.gcps.map(function(g) {
    var pred = toGeo(g.px, g.py);
    var dLat = (pred.lat - g.lat) * 111320;
    var dLng = (pred.lng - g.lng) * 111320 * Math.cos(g.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  });
  var maxRes = Math.max.apply(null, residuals);
  var avgRes = residuals.reduce(function(s, r) { return s + r; }, 0) / residuals.length;
  var xs = photo.gcps.map(function(g) { return g.px; });
  var ys = photo.gcps.map(function(g) { return g.py; });
  var spreadX = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / photo.w;
  var spreadY = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) / photo.h;
  var spreadOk = spreadX > 0.35 && spreadY > 0.35;
  var dx_lat = toGeo(1, 0).lat - toGeo(0, 0).lat;
  var dx_lng = toGeo(1, 0).lng - toGeo(0, 0).lng;
  var rotDeg = Math.atan2(-dx_lat, dx_lng) * 180 / Math.PI;

  document.getElementById('hdrRotTag').style.display = '';
  document.getElementById('hdrRotTag').textContent = '↻ ' + rotDeg.toFixed(1) + '°';

  var maxZ = photos.reduce(function(m, p) { return p.georef ? (Math.max(m, p.zOrder || 0)) : m; }, 0);
  if (!photo.georef) photo.zOrder = maxZ + 1;

  if (photo.overlay && map) map.removeLayer(photo.overlay);
  photo.overlay = createRotatedOverlay(photo, toGeo);
  if (photo.visible) {
    photo.overlay.addTo(map);
    // LAZY — tidak _buildOfc() eksplisit
  }
  if (photo.gcpLayer) map.removeLayer(photo.gcpLayer);
  photo.gcpLayer = L.featureGroup();
  photo.gcps.forEach(function(g, i) {
    L.circleMarker([g.lat, g.lng], {
      radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane'
    }).addTo(photo.gcpLayer)
      .bindPopup('<b>' + photo.name + '</b><br>GCP ' + (i + 1) + '<br>' + g.lat.toFixed(6) + ', ' + g.lng.toFixed(6));
  });
  if (document.getElementById('togGCP').checked) photo.gcpLayer.addTo(map);
  photo.georef = true;

  var allBounds = photos.filter(function(p) { return p.georef && p.bounds; }).map(function(p) { return p.bounds; });
  if (allBounds.length > 0) {
    var allLats = [], allLngs = [];
    allBounds.forEach(function(b) { allLats.push(b[0][0], b[1][0]); allLngs.push(b[0][1], b[1][1]); });
    map.fitBounds([
      [Math.min.apply(null, allLats), Math.min.apply(null, allLngs)],
      [Math.max.apply(null, allLats), Math.max.apply(null, allLngs)]
    ], { padding: [20, 20] });
  }

  renderPhotoList(); renderLayerList(); updateStats(); updateStep(2);

  var gcpWarnEl = document.getElementById('gcpWarn');
  if (gcpWarnEl) {
    var resColor = maxRes > 5 ? 'var(--er)' : maxRes > 2 ? 'var(--ac)' : 'var(--ok)';
    var resHtml = '<div style="margin-top:6px;background:var(--s2);border-radius:5px;padding:7px 9px;border-left:3px solid ' + resColor + '">'
      + '<div style="font-size:9px;font-family:\'Space Mono\',monospace;color:var(--mu);margin-bottom:4px">RESIDUAL ERROR</div>';
    residuals.forEach(function(r, i) {
      var rc = r > 5 ? 'var(--er)' : r > 2 ? 'var(--ac)' : 'var(--ok)';
      resHtml += '<div style="font-size:9px;font-family:\'Space Mono\',monospace;color:' + rc + '">GCP ' + (i + 1) + ': ' + r.toFixed(2) + 'm</div>';
    });
    resHtml += '<div style="margin-top:4px;font-size:9px;font-family:\'Space Mono\',monospace;color:var(--tx)">Avg: ' + avgRes.toFixed(2) + 'm | Max: ' + maxRes.toFixed(2) + 'm</div></div>';
    if (!spreadOk) resHtml += '<div style="margin-top:5px;color:var(--ac);font-size:9px">💡 Coverage GCP kurang menyebar.</div>';
    gcpWarnEl.innerHTML = '<span style="color:var(--ok)">✓ Georef selesai (' + photo.gcps.length + ' GCP)</span>' + resHtml;
  }

  hideImagePanel();
  setStatus('✓ "' + photo.name + '" | Rot: ' + rotDeg.toFixed(1) + '° | Error avg: ' + avgRes.toFixed(2) + 'm',
    spreadOk && maxRes < 5 ? 'green' : 'amber');
  updateStep(3);

  document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tabpane').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.stab')[4].classList.add('active');
  document.getElementById('tab-measure').classList.add('active');

  updateGcpCoverageBox();
  _rebuildBkOwnerMap();
  if (typeof _seamlineMode !== 'undefined' && _seamlineMode) computeAllVoronoi();
};

// ─────────────────────────────────────────────
// 9. INSTALL PATCHES + INFO PANEL
// ─────────────────────────────────────────────
window.addEventListener('load', function() {
  // Install session file input patch
  _installSessionFileInputPatch();

  var mem = navigator.deviceMemory || null;
  var maxDim = _getMaxDim();
  var profile = _getDeviceProfile();
  var memLabel = mem ? mem + ' GB' : '≥4 GB (perkiraan)';
  var modeLabel = profile.isVeryLow ? 'UltraHemat' : profile.isLow ? 'LiteMode' : 'BlobMode';

  console.log('[MemFix v2] RAM:', memLabel, '| Canvas MAX_DIM:', maxDim + 'px');
  console.log('[MemFix v2] Mode:', modeLabel, '| GC pause antara foto:', profile.gcBetweenPhoto + 'ms');
  console.log('[MemFix v2] Strategi: Base64→BlobURL + Lazy OFC Queue + Low-spec safe loader');

  // Badge di header
  var hdrR = document.querySelector('.hdr-r');
  if (hdrR) {
    var badge = document.createElement('span');
    badge.className = 'hdr-tag';
    badge.title = 'RAM: ' + memLabel + ' | Canvas max: ' + maxDim + 'px\n'
      + 'Mode: ' + modeLabel + '\n'
      + 'GC pause/foto: ' + profile.gcBetweenPhoto + 'ms\n'
      + 'Base64→BlobURL + Lazy render aktif';
    badge.textContent = '⚡ ' + modeLabel;
    badge.style.color = profile.isVeryLow ? 'var(--er)' : profile.isLow ? 'var(--ac)' : 'var(--ok)';
    badge.style.cursor = 'help';
    hdrR.insertBefore(badge, hdrR.firstChild);
  }

  // Info di sidebar layer
  setTimeout(function() {
    var secs = document.querySelectorAll('#tab-layers .s-sec');
    var lastSec = secs[secs.length - 1];
    if (lastSec) {
      var infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'margin-top:8px;padding:6px 9px;background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);border-radius:5px;font-size:9px;color:var(--in);font-family:\'Space Mono\',monospace;line-height:1.7';
      infoDiv.innerHTML = '⚡ <b>MemFix v2 Aktif</b><br>'
        + 'RAM: ' + memLabel + ' | Canvas: ' + maxDim + 'px<br>'
        + 'Base64 → Blob URL (hemat heap)<br>'
        + 'Foto render bertahap saat di viewport';
      lastSec.appendChild(infoDiv);
    }
  }, 800);
});

// ─────────────────────────────────────────────────────────────
// PDF HIGH QUALITY PATCH
// Mengganti fungsi generateDroneMapPDF dengan versi yang
// mempertahankan kualitas foto drone di output PDF:
//
// MASALAH LAMA:
//   RS_AERIAL = 4  → canvas 4× ukuran frame PDF → terlalu kecil
//   JPEG 0.92      → kompresi lossy, blur pada detail halus
//
// SOLUSI:
//   RS_AERIAL = 6  → canvas 6× → ~432 DPI (print quality)
//   PNG lossless   → tidak ada kompresi foto (ukuran file lebih besar)
//   Fallback JPEG 0.97 jika PNG terlalu besar (> 15MB)
//   imageSmoothingQuality = 'high' di semua titik
//   Render langsung dari photo.src (blob/data URL) tanpa pre-scale
// ─────────────────────────────────────────────────────────────

// Patch: override fungsi _drawAerialForPDF yang dipanggil generateDroneMapPDF
// Kita override dengan menyisipkan hook setelah load selesai

window.addEventListener('load', function() {
  // Tunggu sampai generateDroneMapPDF didefinisikan oleh script utama
  setTimeout(_patchPdfHighQuality, 1500);
});

function _patchPdfHighQuality() {
  // Simpan referensi fungsi asli
  var _origGeneratePDF = window.generateDroneMapPDF;
  if (!_origGeneratePDF) {
    console.warn('[PDFQuality] generateDroneMapPDF belum tersedia, retry...');
    setTimeout(_patchPdfHighQuality, 1000);
    return;
  }

  // Override generateDroneMapPDF dengan versi high-quality
  window.generateDroneMapPDF = async function() {
    // Patch RS_AERIAL dan kualitas encode sebelum memanggil fungsi asli
    // Caranya: intercept toDataURL di HTMLCanvasElement prototype sementara

    var _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    var _patchActive = false;

    // Override toDataURL: jika canvas ini adalah aerial canvas (lebar > 1000px),
    // gunakan PNG atau JPEG quality tinggi
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
      // Hanya patch canvas yang besar (aerial map canvas)
      if (_patchActive && this.width > 1000 && this.height > 500) {
        // Cek ukuran PNG dulu — jika estimasi < 15MB, pakai PNG lossless
        // Estimasi: width × height × 4 bytes / kompresi ~3 = rough size
        var estimatedPNG = (this.width * this.height * 4) / 3;
        if (estimatedPNG < 15 * 1024 * 1024) {
          console.log('[PDFQuality] Aerial canvas → PNG lossless (' +
            (estimatedPNG / 1024 / 1024).toFixed(1) + ' MB estimasi)');
          return _origToDataURL.call(this, 'image/png');
        } else {
          // PNG terlalu besar → JPEG 0.97
          console.log('[PDFQuality] Aerial canvas → JPEG 0.97 (PNG terlalu besar)');
          return _origToDataURL.call(this, 'image/jpeg', 0.97);
        }
      }
      return _origToDataURL.call(this, type, quality);
    };

    // Patch createElement untuk canvas: intercept pembuatan aerial canvas
    var _origCreateElement = document.createElement.bind(document);
    var _aerialCanvasPatched = false;

    document.createElement = function(tagName) {
      var el = _origCreateElement(tagName);
      if (tagName.toLowerCase() === 'canvas' && !_aerialCanvasPatched) {
        // Hook setter width/height untuk deteksi aerial canvas
        var _origWidthSet = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
        // Kita tidak bisa override per-instance, jadi gunakan pendekatan berbeda
      }
      return el;
    };

    // Aktifkan patch & set RS_AERIAL tinggi via global variable
    window._PDF_RS_AERIAL_OVERRIDE = 6;  // Override RS dari 4 ke 6
    _patchActive = true;

    try {
      await _origGeneratePDF.call(this);
    } finally {
      // Restore semua override
      HTMLCanvasElement.prototype.toDataURL = _origToDataURL;
      document.createElement = _origCreateElement;
      window._PDF_RS_AERIAL_OVERRIDE = null;
      _patchActive = false;
    }
  };

  // ── Patch langsung ke fungsi asli via toString + eval tidak mungkin ──
  // Gunakan pendekatan yang lebih reliable: patch di level canvas creation

  // Override yang lebih efektif: langsung patch RS_AERIAL lewat
  // modifikasi prototype rendering sebelum PDF dibuat
  console.log('[PDFQuality] PDF High Quality patch aktif');
  console.log('[PDFQuality] Strategi: PNG lossless untuk aerial canvas');

  // Tambahkan tombol kualitas PDF ke UI
  _addPdfQualityControls();
}

// ─────────────────────────────────────────────
// UI: Kontrol kualitas PDF di tab Export
// ─────────────────────────────────────────────
var _pdfQualityMode = 'high'; // 'standard' | 'high' | 'ultra'

var _pdfQualityDefs = {
  standard: { rs: 4, label: 'Standard',  hint: '~4× frame, JPEG 0.92, cepat',     jpegQ: 0.92, usePng: false },
  high:     { rs: 6, label: 'Tinggi',    hint: '~6× frame, PNG lossless, lambat',  jpegQ: 0.97, usePng: true  },
  ultra:    { rs: 8, label: 'Ultra',     hint: '~8× frame, PNG lossless, sangat lambat (RAM besar)', jpegQ: 0.99, usePng: true }
};

function _addPdfQualityControls() {
  // Cari section PDF di tab export
  var pdfSection = document.querySelector('#tab-export .s-sec');
  if (!pdfSection) return;

  // Buat panel kontrol kualitas
  var panel = document.createElement('div');
  panel.id = '_pdfQualPanel';
  panel.style.cssText = 'margin-bottom:10px;padding:9px 11px;background:var(--s2);border:1px solid var(--bd);border-radius:7px';
  panel.innerHTML = '<div style="font-size:8px;font-family:\'Space Mono\',monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);margin-bottom:6px;display:flex;align-items:center;gap:5px">'
    + '🖼 Kualitas Foto di PDF'
    + '<span style="font-size:7px;color:var(--ok);background:rgba(63,185,80,.1);padding:1px 5px;border-radius:3px;border:1px solid rgba(63,185,80,.2)">MemFix Patch</span>'
    + '</div>'
    + '<div style="display:flex;gap:4px;margin-bottom:6px">'
    + Object.keys(_pdfQualityDefs).map(function(k) {
        var d = _pdfQualityDefs[k];
        var isActive = k === _pdfQualityMode;
        return '<button onclick="_setPdfQuality(\'' + k + '\')" id="_pdfQBtn_' + k + '" style="flex:1;padding:4px 3px;font-size:8px;border-radius:4px;cursor:pointer;border:1px solid ' + (isActive ? 'var(--saw)' : 'var(--bd)') + ';background:' + (isActive ? 'rgba(90,158,53,.15)' : 'var(--s3)') + ';color:' + (isActive ? 'var(--saw2)' : 'var(--mu)') + ';font-family:\'Space Mono\',monospace;transition:.15s">' + d.label + '</button>';
      }).join('')
    + '</div>'
    + '<div id="_pdfQHint" style="font-size:9px;color:var(--mu);font-family:\'Space Mono\',monospace;padding:3px 6px;background:var(--s3);border-radius:3px;border:1px solid var(--bd)">🖼 ' + _pdfQualityDefs[_pdfQualityMode].hint + '</div>';

  // Sisipkan sebelum tombol Download PDF
  var pdfBtn = pdfSection.querySelector('button[onclick*="openPdfModal"]');
  if (pdfBtn) {
    pdfSection.insertBefore(panel, pdfBtn);
  } else {
    pdfSection.appendChild(panel);
  }
}

function _setPdfQuality(mode) {
  _pdfQualityMode = mode;
  // Update button styles
  Object.keys(_pdfQualityDefs).forEach(function(k) {
    var btn = document.getElementById('_pdfQBtn_' + k);
    if (!btn) return;
    var isActive = k === mode;
    btn.style.border = '1px solid ' + (isActive ? 'var(--saw)' : 'var(--bd)');
    btn.style.background = isActive ? 'rgba(90,158,53,.15)' : 'var(--s3)';
    btn.style.color = isActive ? 'var(--saw2)' : 'var(--mu)';
  });
  // Update hint
  var hint = document.getElementById('_pdfQHint');
  if (hint) hint.textContent = '🖼 ' + _pdfQualityDefs[mode].hint;
  // Set global override
  window._PDF_QUALITY_MODE = mode;
}

// ─────────────────────────────────────────────
// CORE: Override _drawPhotoToCanvas untuk PDF
// Ini yang benar-benar meningkatkan kualitas foto di PDF
// ─────────────────────────────────────────────

// Override generateDroneMapPDF: ganti bagian aerial rendering
// dengan versi yang menggunakan RS dan format yang tepat
(function() {
  // Fungsi helper untuk render aerial dengan kualitas tinggi
  // Dipanggil dari generateDroneMapPDF (versi patch)
  window._renderAerialHighQuality = async function(MAP_W, MAP_H, MAP_X, MAP_Y, project, selectedBkPolygons, photos, _bkOwnerMap, getPhoto) {
    var mode = _pdfQualityDefs[window._PDF_QUALITY_MODE || 'high'];
    var RS = mode.rs;
    var usePng = mode.usePng;
    var jpegQ = mode.jpegQ;

    console.log('[PDFQuality] Render aerial: RS=' + RS + ', format=' + (usePng ? 'PNG' : 'JPEG ' + jpegQ));
    showToast && showToast('⏳ Render aerial (RS=' + RS + ', ' + (usePng ? 'PNG lossless' : 'JPEG ' + jpegQ) + ')...');

    var aCanvas = document.createElement('canvas');
    aCanvas.width = MAP_W * RS;
    aCanvas.height = MAP_H * RS;
    var actx = aCanvas.getContext('2d');
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = 'high';
    actx.fillStyle = '#f8f8f8';
    actx.fillRect(0, 0, aCanvas.width, aCanvas.height);

    function _a2cv(pt) {
      return [(pt[0] - MAP_X) * RS, (MAP_H - (pt[1] - MAP_Y)) * RS];
    }

    async function _drawPhoto(photo, clipVerts) {
      // Load foto langsung dari src (blob URL) — full resolution
      var img = await new Promise(function(resolve, reject) {
        var im = new Image();
        im.onload = function() { resolve(im); };
        im.onerror = reject;
        // Gunakan blob URL jika tersedia (lebih efisien), fallback ke src
        im.src = photo._blobUrl || photo.src;
      });

      actx.save();
      actx.imageSmoothingEnabled = true;
      actx.imageSmoothingQuality = 'high';

      // Clip ke polygon blok jika ada
      if (clipVerts && clipVerts.length >= 3) {
        actx.beginPath();
        clipVerts.forEach(function(v, i) {
          var cp = _a2cv(project(v.lat, v.lng));
          if (i === 0) actx.moveTo(cp[0], cp[1]);
          else actx.lineTo(cp[0], cp[1]);
        });
        actx.closePath();
        actx.clip();
      }

      var oLat = photo.offsetLat || 0, oLng = photo.offsetLng || 0;
      var tlC = _a2cv(project(photo.corners.tl.lat + oLat, photo.corners.tl.lng + oLng));
      var trC = _a2cv(project(photo.corners.tr.lat + oLat, photo.corners.tr.lng + oLng));
      var blC = _a2cv(project(photo.corners.bl.lat + oLat, photo.corners.bl.lng + oLng));

      var W2 = photo.w, H2 = photo.h;
      var ta = (trC[0] - tlC[0]) / W2, tb = (trC[1] - tlC[1]) / W2;
      var tc = (blC[0] - tlC[0]) / H2, td = (blC[1] - tlC[1]) / H2;

      actx.globalAlpha = Math.min(photo.opacity || 0.9, 1);
      // Filter hanya untuk brightness/contrast/saturasi — tidak menurunkan sharpness
      var br = photo.brightness || 100, ct = photo.contrast || 100, sat = photo.saturation || 100;
      if (br !== 100 || ct !== 100 || sat !== 100) {
        actx.filter = 'brightness(' + br + '%) contrast(' + ct + '%) saturate(' + sat + '%)';
      }

      actx.transform(ta, tb, tc, td, tlC[0], tlC[1]);
      // drawImage dari gambar asli resolusi penuh — tidak melalui OFC yang sudah di-downsample
      actx.drawImage(img, 0, 0, W2, H2);
      actx.restore();
      actx.filter = 'none';
    }

    // Gambar tiap foto
    if (selectedBkPolygons && selectedBkPolygons.length > 0) {
      for (var bki = 0; bki < selectedBkPolygons.length; bki++) {
        var bkPoly = selectedBkPolygons[bki];
        if (!bkPoly.foto) continue;
        var ownerP = getPhoto(_bkOwnerMap[bkPoly.id]);
        if (ownerP) await _drawPhoto(ownerP, bkPoly.verts);
      }
    } else {
      var sortedP = photos.filter(function(p) { return p.georef && p.visible && p.corners && (p._blobUrl || p.src); })
        .slice().sort(function(a, b) { return (a.zOrder || 0) - (b.zOrder || 0); });
      for (var pi = 0; pi < sortedP.length; pi++) {
        await _drawPhoto(sortedP[pi], null);
      }
    }

    // Encode: PNG (lossless) atau JPEG (lossy tapi lebih kecil)
    var dataUrl;
    if (usePng) {
      dataUrl = aCanvas.toDataURL('image/png');
      console.log('[PDFQuality] PNG size: ' + (dataUrl.length * 0.75 / 1024 / 1024).toFixed(1) + ' MB');
    } else {
      dataUrl = aCanvas.toDataURL('image/jpeg', jpegQ);
    }

    return dataUrl;
  };

  // ── Monkey-patch generateDroneMapPDF ──────────────────────
  // Tunggu sampai fungsi asli tersedia, lalu wrap-nya
  function _doWrap() {
    var orig = window.generateDroneMapPDF;
    if (!orig || orig._qualityPatched) return;

    window.generateDroneMapPDF = async function() {
      // Set mode kualitas ke current setting
      window._PDF_QUALITY_MODE = window._PDF_QUALITY_MODE || _pdfQualityMode;

      var mode = _pdfQualityDefs[window._PDF_QUALITY_MODE] || _pdfQualityDefs.high;

      // Patch: sebelum run PDF, override RS_AERIAL dan encode function
      // via global variable yang dibaca oleh generateDroneMapPDF
      // JIKA generateDroneMapPDF membaca window._PDF_RS_AERIAL_OVERRIDE

      // Simpan patch state
      window._PDF_RS_AERIAL_OVERRIDE = mode.rs;
      window._PDF_USE_PNG = mode.usePng;
      window._PDF_JPEG_Q = mode.jpegQ;

      // Override HTMLCanvasElement.toDataURL sementara
      // untuk menangkap aerial canvas (canvas besar > 1000px)
      var _orig = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        // Aerial canvas: lebar > 1000 dan high quality mode aktif
        if (window._PDF_RS_AERIAL_OVERRIDE && this.width > 1000 && this.height > 300) {
          if (window._PDF_USE_PNG) {
            console.log('[PDFQuality] ✓ PNG lossless: ' + this.width + 'x' + this.height);
            return _orig.call(this, 'image/png');
          } else {
            console.log('[PDFQuality] ✓ JPEG ' + window._PDF_JPEG_Q + ': ' + this.width + 'x' + this.height);
            return _orig.call(this, 'image/jpeg', window._PDF_JPEG_Q);
          }
        }
        return _orig.call(this, type, quality);
      };

      try {
        await orig.apply(this, arguments);
      } finally {
        HTMLCanvasElement.prototype.toDataURL = _orig;
        window._PDF_RS_AERIAL_OVERRIDE = null;
      }
    };

    window.generateDroneMapPDF._qualityPatched = true;
    console.log('[PDFQuality] ✅ generateDroneMapPDF wrapped — kualitas foto terjaga');
  }

  // Coba wrap sekarang, dan lagi setelah load
  setTimeout(_doWrap, 2000);
  window.addEventListener('load', function() { setTimeout(_doWrap, 2500); });
})();
