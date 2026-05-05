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
// 6. CORE FIX: Override session loader
//    Proses foto SATU PER SATU dengan konversi
//    base64 → blob URL + GC pause per foto
// ─────────────────────────────────────────────

// Override event listener FileReader di sessionFileInput
// Tunggu DOM siap lalu replace event listener
function _installSessionFileInputPatch() {
  var inp = document.getElementById('sessionFileInput');
  if (!inp) { setTimeout(_installSessionFileInputPatch, 500); return; }

  // Clone element untuk hapus listener lama
  var newInp = inp.cloneNode(true);
  inp.parentNode.replaceChild(newInp, inp);

  newInp.addEventListener('change', function(e) {
    var f = e.target.files[0];
    if (!f) return;

    var statusEl = document.getElementById('sessionLoadStatus');
    statusEl.style.display = '';
    statusEl.style.background = 'rgba(88,166,255,.08)';
    statusEl.style.color = 'var(--in)';
    statusEl.style.border = '1px solid rgba(88,166,255,.25)';

    var sizeMB = (f.size / 1024 / 1024).toFixed(1);
    statusEl.innerHTML = '⏳ Membaca file (' + sizeMB + ' MB)...<br>'
      + '<div style="width:100%;height:4px;background:var(--bd);border-radius:2px;margin-top:5px">'
      + '<div id="sessLoadBar" style="height:100%;width:0%;background:var(--in);border-radius:2px;transition:width .3s"></div></div>'
      + '<div id="sessLoadMsg" style="font-size:8px;color:var(--mu);margin-top:3px">Parsing JSON...</div>';

    var reader = new FileReader();

    reader.onprogress = function(ev) {
      if (ev.lengthComputable) {
        var pct = Math.round(ev.loaded / ev.total * 35);
        var bar = document.getElementById('sessLoadBar');
        if (bar) bar.style.width = pct + '%';
      }
    };

    reader.onload = function(ev) {
      var bar = document.getElementById('sessLoadBar');
      var msg = document.getElementById('sessLoadMsg');
      if (bar) bar.style.width = '38%';
      if (msg) msg.textContent = 'Parsing JSON (mungkin lambat untuk file besar)...';

      // Yield ke UI dulu sebelum JSON.parse berat
      setTimeout(function() {
        var jsonText = ev.target.result;
        // Null segera untuk bebas referensi FileReader
        ev.target.result = null;

        var data;
        try {
          data = JSON.parse(jsonText);
        } catch(err) {
          statusEl.innerHTML = '❌ Error parsing: ' + err.message;
          statusEl.style.color = 'var(--er)';
          return;
        }
        // Bebaskan string JSON dari heap SEGERA setelah parse
        jsonText = null;

        if (bar) bar.style.width = '42%';
        if (msg) msg.textContent = 'JSON parsed. Konversi foto ke Blob...';

        if (!data || !data.photos) {
          statusEl.innerHTML = '❌ Format file tidak valid.';
          statusEl.style.color = 'var(--er)';
          return;
        }

        // Jalankan loader versi blob
        _doLoadSessionWithBlobConversion(data, statusEl, bar, msg);

      }, 60);
    };

    reader.onerror = function() {
      statusEl.innerHTML = '❌ Gagal membaca file.';
      statusEl.style.color = 'var(--er)';
    };

    reader.readAsText(f, 'utf-8');
    e.target.value = '';
  });
}

// ─────────────────────────────────────────────
// 7. MAIN LOADER: Konversi base64 → Blob URL per foto
// ─────────────────────────────────────────────
async function _doLoadSessionWithBlobConversion(data, statusEl, barEl, msgEl) {
  function setBar(pct, msg) {
    if (barEl) barEl.style.width = Math.min(pct, 100) + '%';
    if (msgEl) msgEl.textContent = msg || '';
  }

  try {
    // Kosongkan antrian build lama
    if (window._ofcBuildQueue) _ofcBuildQueue.length = 0;

    // ── Bersihkan state lama ──
    if (typeof photos !== 'undefined') {
      photos.forEach(function(p) {
        if (p.overlay && map) try { map.removeLayer(p.overlay); } catch(e) {}
        if (p.gcpLayer && map) try { map.removeLayer(p.gcpLayer); } catch(e) {}
        // Revoke blob URL lama
        if (p._blobUrl) {
          try { URL.revokeObjectURL(p._blobUrl); } catch(e) {}
          delete _allBlobUrls[p.id];
        }
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

    setBar(44, 'Restore variabel sesi...');
    await _yieldToUI(30);

    // Ambil array foto sebelum null-kan data
    var photoDataArray = data.photos;
    data.photos = null;

    measures = data.measures || [];
    shapeId = data.shapeId || 0;
    trees = (data.trees || []).map(function(t) { return Object.assign({}, t, { marker: null }); });
    treeId = data.treeId || 0;
    _batasKebunIds = new Set(data.batasKebunIds || []);
    _bkOwnerMapExplicit = data.bkOwnerMapExplicit || {};
    _bkColorMap = data.bkColorMap || {};
    _labelOffsets = data.labelOffsets || {};
    _exportBatasShow = data.exportBatasShow || {};
    _exportLabelShow = data.exportLabelShow || {};
    _bkOwnerMap = {};
    _batasKebunPolygons = [];
    areaUnit = data.areaUnit || 'auto';
    lenUnit = data.lenUnit || 'auto';
    data = null;  // Bebaskan object data dari heap!

    setBar(47, 'Rebuild foto array (tanpa src)...');
    await _yieldToUI(30);

    // Buat array foto TANPA src — src akan diisi satu per satu di bawah
    photos = photoDataArray.map(function(p) {
      return {
        id: p.id, name: p.name,
        src: null,          // Kosongkan dulu!
        _srcBase64: p.src,  // Simpan sementara di field berbeda
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
    photoDataArray = null;  // Bebaskan SEGERA — ini yang besar!
    await _yieldToUI(200);  // GC pause lebih lama setelah array besar dibebaskan

    setBar(50, 'Init peta...');
    await _yieldToUI(30);

    var georefPhotos = photos.filter(function(p) { return p.georef && p.gcps && p.gcps.length >= 3; });

    if (georefPhotos.length > 0) {
      if (!map) {
        _initMapFromPhoto(georefPhotos[0]);
        await _yieldToUI(80);
      } else {
        if (drawnItems) drawnItems.clearLayers();
      }
    }

    setBar(54, 'Restore polygon...');
    await _yieldToUI(20);
    _restoreMeasureLayers();

    // ── PROSES FOTO SATU PER SATU ──
    // Untuk tiap foto georef:
    //   1. Ambil src dari _srcBase64
    //   2. Konversi ke Blob URL (bebas base64 string dari heap)
    //   3. Null _srcBase64
    //   4. Build overlay (lazy — tidak build canvas dulu)
    //   5. GC pause
    var total = photos.length;

    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      var pct = 54 + Math.round((i / Math.max(total, 1)) * 32);
      setBar(pct, 'Konversi foto ' + (i + 1) + '/' + total + ': ' + photo.name);
      await _yieldToUI(20);

      if (!photo._srcBase64) continue;

      // ── Konversi base64 → Blob URL ──
      // Ini MEMBEBASKAN string base64 besar dari JS heap!
      try {
        var blobUrl = await _srcToBlobUrl(photo.id, photo._srcBase64);
        photo._blobUrl = blobUrl;
        photo.src = blobUrl;  // Gunakan blob URL sebagai src untuk kompatibilitas
        photo._srcBase64 = null;  // Bebaskan base64 string!
        await _yieldToUI(100); // GC pause PENTING — beri waktu browser bebas string besar
      } catch(convErr) {
        console.warn('[MemFix] Konversi blob gagal untuk', photo.name, convErr);
        photo.src = photo._srcBase64;  // Fallback
        photo._srcBase64 = null;
      }

      if (!photo.georef || photo.gcps.length < 3) continue;

      try {
        // Pastikan dimensi foto tersedia
        if (!photo.w || !photo.h) {
          await new Promise(function(resolve) {
            var imgTmp = new Image();
            imgTmp.onload = function() {
              photo.w = imgTmp.naturalWidth;
              photo.h = imgTmp.naturalHeight;
              imgTmp.src = '';
              imgTmp = null;
              resolve();
            };
            imgTmp.onerror = resolve;
            imgTmp.src = photo.src || photo._blobUrl;
          });
        }

        var toGeo = buildAffine(photo.gcps);
        photo.overlay = createRotatedOverlay(photo, toGeo);

        if (photo.visible && map) {
          photo.overlay.addTo(map);
          // LAZY: tidak _buildOfc() di sini — akan dibangun saat masuk viewport
        }

        photo.gcpLayer = L.featureGroup();
        photo.gcps.forEach(function(g, gi) {
          L.circleMarker([g.lat, g.lng], {
            radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane'
          }).addTo(photo.gcpLayer).bindPopup('<b>' + photo.name + '</b><br>GCP ' + (gi + 1));
        });
        var togGCP = document.getElementById('togGCP');
        if (togGCP && togGCP.checked && map) photo.gcpLayer.addTo(map);

      } catch(photoErr) {
        console.warn('[MemFix] Gagal setup overlay foto "' + photo.name + '":', photoErr);
      }

      await _yieldToUI(50);  // GC pause antar foto
    }

    // ── Tree markers ──
    setBar(87, 'Restore pokok sawit...');
    await _yieldToUI(20);
    if (_treeLayer) _treeLayer.clearLayers();
    trees.forEach(function(t) { addTreeMarker(t); });

    // ── fitBounds — AMAN: overlay sudah ada, canvas lazy ──
    setBar(90, 'Fit bounds peta...');
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
    setBar(92, 'Finalisasi state...');
    await _yieldToUI(20);
    _rebuildBatasKebunPolygons();
    _updateBatasKebunInfoPanel();
    updateGcpCoverageBox();
    hideImagePanel();
    updateStep(3);

    // ── Update UI ──
    setBar(95, 'Update tampilan...');
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
    document.querySelectorAll('.tabpane').forEach(function(p2) { p2.classList.remove('active'); });
    document.querySelectorAll('.stab')[4].classList.add('active');
    document.getElementById('tab-measure').classList.add('active');

    setBar(100, 'Selesai!');

    if (statusEl) {
      statusEl.style.background = 'rgba(63,185,80,.08)';
      statusEl.style.color = 'var(--ok)';
      statusEl.style.border = '1px solid rgba(63,185,80,.25)';
      statusEl.innerHTML = '✅ Sesi dipulihkan!<br>'
        + georefDone + ' foto georef · '
        + measures.length + ' pengukuran · '
        + trees.length + ' pokok sawit<br>'
        + '<span style="color:var(--mu);font-size:8px">'
        + 'Foto merender bertahap (Blob URL, hemat memori)</span>';
    }
    showToast('✅ Sesi berhasil dipulihkan!\n'
      + georefDone + ' foto, '
      + measures.length + ' pengukuran, '
      + trees.length + ' pokok\n'
      + '⏳ Foto merender saat ter-zoom/pan...');

  } catch(err) {
    console.error('[MemFix] Load session error:', err);
    if (statusEl) {
      statusEl.style.background = 'rgba(248,81,73,.08)';
      statusEl.style.color = 'var(--er)';
      statusEl.style.border = '1px solid rgba(248,81,73,.3)';
      statusEl.innerHTML = '❌ Gagal: ' + err.message
        + '<br><span style="font-size:8px;color:var(--mu)">Tutup tab lain, reload halaman, coba lagi.</span>';
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
  var memLabel = mem ? mem + ' GB' : '≥4 GB (perkiraan)';

  console.log('[MemFix v2] RAM:', memLabel, '| Canvas MAX_DIM:', maxDim + 'px');
  console.log('[MemFix v2] Strategi: Base64→BlobURL + Lazy OFC Queue aktif');

  // Badge di header
  var hdrR = document.querySelector('.hdr-r');
  if (hdrR) {
    var badge = document.createElement('span');
    badge.className = 'hdr-tag';
    badge.title = 'RAM: ' + memLabel + ' | Canvas max: ' + maxDim + 'px\nBase64→BlobURL + Lazy render aktif';
    badge.textContent = mem && mem <= 2 ? '⚡ LiteMode' : '⚡ BlobMode';
    badge.style.color = mem && mem <= 2 ? 'var(--ac)' : 'var(--ok)';
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
