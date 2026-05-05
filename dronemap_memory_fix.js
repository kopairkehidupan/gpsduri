// ============================================================
// DroneMap v3 Pro — Memory Fix Patch
// Fix: "Aw, Snap! Out of Memory" saat load .dmsession
//
// Strategi:
//  1. Adaptive MAX_DIM — resolusi canvas berdasarkan RAM device
//  2. Lazy OFC Build Queue — canvas hanya dibangun saat foto
//     masuk ke viewport, satu per satu, dengan GC pause antar build
//  3. Viewport culling — foto di luar viewport tidak diproses
//  4. Load session: hapus JSON string dari memori ASAP setelah parse
//
// Cara pakai: tambahkan SEBELUM </body> di file HTML DroneMap:
//   <script src="dronemap_memory_fix.js"></script>
// ============================================================

// ─────────────────────────────────────────────
// 1. ADAPTIVE MAX_DIM
// ─────────────────────────────────────────────
function _getMaxDim() {
  // navigator.deviceMemory: Chrome saja, dalam GB
  var mem = (navigator.deviceMemory || 4);
  if (mem <= 1) return 384;   // ≤1GB RAM  → 384px canvas
  if (mem <= 2) return 512;   // ≤2GB RAM  → 512px canvas
  if (mem <= 3) return 768;   // ≤3GB RAM  → 768px canvas
  if (mem <= 4) return 1024;  // ≤4GB RAM  → 1024px canvas
  return 2048;                // >4GB RAM  → 2048px (original)
}

// Override buildFeatheredCanvas — ganti MAX_DIM dengan _getMaxDim()
var _origBuildFeatheredCanvas = (typeof buildFeatheredCanvas === 'function') ? buildFeatheredCanvas : null;

function buildFeatheredCanvas(imgSrc, w, h, featherAmt, brightness, contrast, saturation, callback) {
  var MAX_DIM = _getMaxDim(); // ← Adaptive, bukan hardcoded 2048
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

        // Bebaskan image dari memori segera setelah digambar ke canvas
        img.src = '';
        img = null;

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
}

// ─────────────────────────────────────────────
// 2. GLOBAL OFC BUILD QUEUE
//    Serialisasi semua permintaan build canvas
//    → hanya 1 foto yang diproses di satu waktu
// ─────────────────────────────────────────────
var _ofcBuildQueue = [];       // Antrian layer yang perlu canvas
var _ofcBuildRunning = false;  // Apakah sedang ada build berjalan

function _enqueueBuild(layerInst) {
  // Sudah ada di antrian, sedang build, atau sudah punya canvas → skip
  if (!layerInst) return;
  if (layerInst._ofc || layerInst._ofcBuilding) return;
  if (_ofcBuildQueue.indexOf(layerInst) !== -1) return;
  _ofcBuildQueue.push(layerInst);
  _drainBuildQueue();
}

async function _drainBuildQueue() {
  if (_ofcBuildRunning) return; // Sudah ada drain loop berjalan
  _ofcBuildRunning = true;
  while (_ofcBuildQueue.length > 0) {
    var inst = _ofcBuildQueue.shift();
    // Validasi: masih aktif dan belum punya canvas
    if (!inst || !inst._map || inst._ofc || inst._ofcBuilding) continue;
    try {
      await inst._buildOfc();
    } catch (e) {
      console.warn('[MemFix] OFC build error:', e);
    }
    // GC pause: beri waktu browser membebaskan memori sebelum build berikutnya
    await _yieldToUI(120);
  }
  _ofcBuildRunning = false;
}

// ─────────────────────────────────────────────
// 3. OVERRIDE createRotatedOverlay
//    Ganti fungsi utama dengan versi Lazy-Build
// ─────────────────────────────────────────────
var _origCreateRotatedOverlay = (typeof createRotatedOverlay === 'function') ? createRotatedOverlay : null;

function createRotatedOverlay(photo, toGeo) {
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
    _ofcBuilding: false,
    _ofcPromise: null,

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
      // Hapus dari antrian build jika ada
      var qi = _ofcBuildQueue.indexOf(this);
      if (qi !== -1) _ofcBuildQueue.splice(qi, 1);
      if (this._ofc) {
        try { this._ofc.width = 1; this._ofc.height = 1; } catch(e) {}
        this._ofc = null;
      }
      this._ofcImg = null;
      this._canvas = null;
      this._ofcPromise = null;
    },

    _buildOfc: function() {
      if (this._ofcBuilding) return this._ofcPromise;
      if (this._ofc) return Promise.resolve({ ofc: this._ofc, img: this._ofcImg });

      this._ofcBuilding = true;
      var self = this;

      this._ofcPromise = buildFeatheredCanvas(
        photo.src, photo.w, photo.h,
        photo.feather, photo.brightness, photo.contrast, photo.saturation
      ).then(function(result) {
        self._ofc = result.ofc;
        self._ofcImg = result.img;
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
      if (!photo.src) return;
      if (this._ofc) {
        try { this._ofc.width = 1; this._ofc.height = 1; } catch(e) {}
        this._ofc = null;
      }
      // Rebuild via queue
      _enqueueBuild(this);
    },

    // ═══════════════════════════════════════════
    // _update: LAZY BUILD — canvas hanya dibangun
    //          saat foto masuk viewport, via queue
    // ═══════════════════════════════════════════
    _update: function() {
      var map = this._map; if (!map) return;

      if (!this._ofc) {
        // Foto belum punya canvas — cek apakah masuk viewport
        if (!this._ofcBuilding && this._isInViewport(map)) {
          _enqueueBuild(this);
        }
        return; // Tidak render sampai canvas siap
      }

      // === Canvas siap → render ===
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
          if ((typeof _bkOwnerMap !== 'undefined') && _bkOwnerMap[activeBK[_bki].id] === photo.id) {
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
      if (!clipPts) { clipPts = cpts; }

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

      // Destination-out untuk BK yang bukan owner
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

    // ═══════════════════════════════════════════
    // _isInViewport: cek apakah foto ada di area
    //                yang sedang tampil di layar
    // ═══════════════════════════════════════════
    _isInViewport: function(map) {
      if (!map || !photo.corners) return true; // Default true jika tidak bisa cek
      try {
        var bounds = map.getBounds();
        var oLat = photo.offsetLat || 0, oLng = photo.offsetLng || 0;
        var minLat = Math.min(tl.lat, tr.lat, br.lat, bl.lat) + oLat;
        var maxLat = Math.max(tl.lat, tr.lat, br.lat, bl.lat) + oLat;
        var minLng = Math.min(tl.lng, tr.lng, br.lng, bl.lng) + oLng;
        var maxLng = Math.max(tl.lng, tr.lng, br.lng, bl.lng) + oLng;
        // Intersect check
        return !(maxLat < bounds.getSouth() || minLat > bounds.getNorth() ||
                 maxLng < bounds.getWest()  || minLng > bounds.getEast());
      } catch(e) {
        return true; // Jika error, build saja (aman)
      }
    },

    setOpacityVal: function(op) {
      photo.opacity = op;
      if (this._canvas && this._nadirOp === undefined) this._canvas.style.opacity = op;
    },
    setNadirOpacity: function(op) {
      this._nadirOp = op;
      if (this._canvas) this._canvas.style.opacity = op;
    },
    clearNadirOpacity: function() {
      this._nadirOp = undefined;
      if (this._canvas) this._canvas.style.opacity = photo.opacity;
    },
    setFeatherVal: function(v) { photo.feather = v; this._rebuildOfc(); },
    setBlendMode: function(m) { photo.blendMode = m; this._update(); },
    setColorAdj: function(br, ct, sat) {
      photo.brightness = br || 100; photo.contrast = ct || 100; photo.saturation = sat || 100;
      this._rebuildOfc();
    },
    forceUpdate: function() { this._update(); }
  });

  return new RotatedLayer();
}

// ─────────────────────────────────────────────
// 4. OVERRIDE _doLoadSession — hapus eager build
//    Canvas akan dibangun lazily oleh _update
// ─────────────────────────────────────────────
var _origDoLoadSession = (typeof _doLoadSession === 'function') ? _doLoadSession : null;

function _doLoadSession(data, statusEl) {
  // Bersihkan state lama
  photos.forEach(function(p) {
    if (p.overlay && map) try { map.removeLayer(p.overlay); } catch(e) {}
    if (p.gcpLayer && map) try { map.removeLayer(p.gcpLayer); } catch(e) {}
  });
  if (typeof _geserPhotoId !== 'undefined' && _geserPhotoId) _stopGeserMode();
  Object.keys(typeof _geserMarkers !== 'undefined' ? _geserMarkers : {}).forEach(function(id) {
    if (_geserMarkers[id] && map) try { map.removeLayer(_geserMarkers[id]); } catch(e) {}
  });
  if (typeof _geserMarkers !== 'undefined') _geserMarkers = {};
  if (_treeLayer) _treeLayer.clearLayers();
  Object.keys(typeof _labelDragMarkers !== 'undefined' ? _labelDragMarkers : {}).forEach(function(id) {
    if (_labelDragMarkers[id] && map) try { map.removeLayer(_labelDragMarkers[id]); } catch(e) {}
  });
  if (typeof _labelDragMarkers !== 'undefined') _labelDragMarkers = {};

  photos = data.photos.map(function(p) { return Object.assign({}, p, { overlay: null, gcpLayer: null }); });
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

  var georefPhotos = photos.filter(function(p) { return p.georef && p.gcps && p.gcps.length >= 3; });
  if (georefPhotos.length > 0) {
    if (!map) {
      var refP = georefPhotos[0];
      var toGeo0 = buildAffine(refP.gcps);
      var c0 = toGeo0(refP.w / 2, refP.h / 2);
      map = L.map('mapPanel', { zoomControl: true }).setView([c0.lat, c0.lng], 17);
      baseTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Design By Erik Simarmata', maxZoom: 22, maxNativeZoom: 19 }).addTo(map);
      map.createPane('gcpPane');
      map.getPane('gcpPane').style.zIndex = 650;
      map.getPane('gcpPane').style.pointerEvents = 'none';
      drawnItems = new L.FeatureGroup().addTo(map);
      _treeLayer = L.featureGroup().addTo(map);
      var drawCtrl = new L.Control.Draw({ position: 'topright', edit: { featureGroup: drawnItems, remove: true }, draw: { polygon: { showArea: true, shapeOptions: { color: '#5a9e35', weight: 2, fillOpacity: .14 } }, polyline: { shapeOptions: { color: '#58a6ff', weight: 3 } }, rectangle: { shapeOptions: { color: '#3fb950', weight: 2, fillOpacity: .12 } }, circle: false, circlemarker: false, marker: { icon: L.divIcon({ className: '', html: '<div style="width:10px;height:10px;background:#5a9e35;border:2px solid #000;border-radius:50%;margin-top:-4px;margin-left:-4px"></div>' }) } } });
      map.addControl(drawCtrl);
      map.on(L.Draw.Event.CREATED, function(e) { onDrawCreated(e); _lastPolygonLayer = e.layer; });
      map.on(L.Draw.Event.EDITED, refreshMeasures);
      map.on(L.Draw.Event.DELETED, function(e) { e.layers.eachLayer(function(l) { if (l._mid) measures = measures.filter(function(m) { return m.id !== l._mid; }); }); renderMeasures(); updateStats(); });
      map.on(L.Draw.Event.DRAWSTART, function() { _drawActive = true; }); map.on(L.Draw.Event.DRAWSTOP, function() { _drawActive = false; });
      map.on(L.Draw.Event.EDITSTART, function() { _drawActive = true; }); map.on(L.Draw.Event.EDITSTOP, function() { _drawActive = false; });
      map.on(L.Draw.Event.DELETESTART, function() { _drawActive = true; }); map.on(L.Draw.Event.DELETESTOP, function() { _drawActive = false; });
      map.on('mousemove', function(e) { document.getElementById('cursorCoord').textContent = e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6); });
      map.on('click', function(e) { if (_treeMode !== 'add' || _drawActive) return; addTree(e.latlng.lat, e.latlng.lng); });
    } else {
      if (drawnItems) drawnItems.clearLayers();
    }

    // ⚡ LAZY: addTo(map) tanpa _buildOfc() — canvas dibangun saat foto masuk viewport
    georefPhotos.forEach(function(photo) {
      var toGeo = buildAffine(photo.gcps);
      photo.overlay = createRotatedOverlay(photo, toGeo);
      if (photo.visible !== false && map) {
        photo.overlay.addTo(map);
        // TIDAK memanggil _buildOfc() — Lazy queue yang akan handle ini
      }
      photo.gcpLayer = L.featureGroup();
      photo.gcps.forEach(function(g, i) {
        L.circleMarker([g.lat, g.lng], { radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane' })
          .addTo(photo.gcpLayer).bindPopup('<b>' + photo.name + '</b><br>GCP ' + (i + 1));
      });
      var togGCP = document.getElementById('togGCP');
      if (togGCP && togGCP.checked && map) photo.gcpLayer.addTo(map);
    });

    measures.forEach(function(m) {
      var layer = null;
      if (m.type === 'polygon' && m.coords && m.coords.length >= 3) {
        var lls = m.coords.map(function(c) { return [c[1], c[0]]; });
        var isBK = _batasKebunIds.has(m.id);
        var col = isBK ? (_bkColorMap[m.id] || '#e74c3c') : '#5a9e35';
        layer = L.polygon(lls, { color: col, fillColor: col, weight: isBK ? 2.5 : 2, fillOpacity: isBK ? 0.18 : 0.14 });
        layer.bindPopup('<b>' + m.label + '</b><br>Luas: ' + fmtArea(m.area) + '<br>Keliling: ' + fmtLen(m.perim));
      } else if (m.type === 'line' && m.coords && m.coords.length >= 2) {
        var lls2 = m.coords.map(function(c) { return [c[1], c[0]]; });
        layer = L.polyline(lls2, { color: '#58a6ff', weight: 3 });
        layer.bindPopup('<b>' + m.label + '</b><br>Panjang: ' + fmtLen(m.len));
      } else if (m.type === 'marker' && m.lat !== undefined) {
        layer = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: '<div style="width:10px;height:10px;background:#5a9e35;border:2px solid #000;border-radius:50%;margin-top:-4px;margin-left:-4px"></div>' }) });
        layer.bindPopup('<b>' + m.label + '</b><br>' + m.lat.toFixed(6) + ', ' + m.lng.toFixed(6));
      }
      if (layer) { layer._mid = m.id; if (drawnItems) drawnItems.addLayer(layer); }
    });

    var allBounds = georefPhotos.filter(function(p) { return p.bounds; }).map(function(p) { return p.bounds; });
    if (allBounds.length > 0 && map) {
      var aLats = [], aLngs = [];
      allBounds.forEach(function(b) { aLats.push(b[0][0], b[1][0]); aLngs.push(b[0][1], b[1][1]); });
      // fitBounds akan trigger _update pada semua overlay → _enqueueBuild → lazy load
      map.fitBounds([[Math.min.apply(null, aLats), Math.min.apply(null, aLngs)], [Math.max.apply(null, aLats), Math.max.apply(null, aLngs)]], { padding: [20, 20] });
    }

    if (_treeLayer) _treeLayer.clearLayers();
    trees.forEach(function(t) { addTreeMarker(t); });

    _rebuildBatasKebunPolygons();
    _updateBatasKebunInfoPanel();
    updateGcpCoverageBox();
    hideImagePanel();
    updateStep(3);
  }

  renderPhotoList(); renderLayerList(); renderMeasures();
  renderTreeList(); updateStats(); updateSensusStats();
  renderExportBlokList();
  document.getElementById('hdrPhotoCount').textContent = photos.length + ' foto';
  document.getElementById('hdrTreeCount').textContent = '🌴 ' + trees.length + ' pokok';
  if (georefPhotos && georefPhotos.length > 0) {
    document.getElementById('hdrRotTag').style.display = '';
    document.getElementById('hdrRotTag').textContent = '✓ ' + georefPhotos.length + ' foto georef';
  }

  document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tabpane').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.stab')[4].classList.add('active');
  document.getElementById('tab-measure').classList.add('active');

  if (statusEl) {
    statusEl.style.display = '';
    statusEl.style.background = 'rgba(63,185,80,.08)';
    statusEl.style.color = 'var(--ok)';
    statusEl.style.border = '1px solid rgba(63,185,80,.25)';
    var georefCount = georefPhotos ? georefPhotos.length : 0;
    statusEl.innerHTML = '✅ Sesi dipulihkan!<br>' + georefCount + ' foto georef · ' + measures.length + ' pengukuran · ' + trees.length + ' pokok sawit<br>'
      + '<span style="color:var(--mu);font-size:8px">Foto rendering secara bertahap (lazy load)...</span>';
  }
  showToast('✅ Sesi berhasil dipulihkan!\n' + (georefPhotos ? georefPhotos.length : 0) + ' foto, ' + measures.length + ' pengukuran, ' + trees.length + ' pokok\n⏳ Foto merender secara bertahap...');
}

// ─────────────────────────────────────────────
// 5. OVERRIDE _doLoadSessionSequential
//    Hapus await _buildOfc — pakai lazy queue
// ─────────────────────────────────────────────
var _origDoLoadSessionSequential = (typeof _doLoadSessionSequential === 'function') ? _doLoadSessionSequential : null;

async function _doLoadSessionSequential(data, statusEl, barEl, msgEl) {
  function setBar(pct, msg) {
    if (barEl) barEl.style.width = pct + '%';
    if (msgEl) msgEl.textContent = msg || '';
  }

  try {
    // Bersihkan state lama
    photos.forEach(function(p) {
      if (p.overlay && map) try { map.removeLayer(p.overlay); } catch(e) {}
      if (p.gcpLayer && map) try { map.removeLayer(p.gcpLayer); } catch(e) {}
    });
    if (typeof _geserPhotoId !== 'undefined' && _geserPhotoId) _stopGeserMode();
    if (typeof _geserMarkers !== 'undefined') {
      Object.keys(_geserMarkers).forEach(function(id) {
        if (_geserMarkers[id] && map) try { map.removeLayer(_geserMarkers[id]); } catch(e) {}
      });
      _geserMarkers = {};
    }
    if (_treeLayer) _treeLayer.clearLayers();
    if (typeof _labelDragMarkers !== 'undefined') {
      Object.keys(_labelDragMarkers).forEach(function(id) {
        if (_labelDragMarkers[id] && map) try { map.removeLayer(_labelDragMarkers[id]); } catch(e) {}
      });
      _labelDragMarkers = {};
    }
    // Kosongkan antrian build lama
    _ofcBuildQueue.length = 0;

    setBar(50, 'Restore variabel...');
    await _yieldToUI(30);

    var photoDataArray = data.photos;
    data.photos = null; // Bebaskan referensi segera

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
    data = null; // Bebaskan data object dari memori

    setBar(53, 'Rebuild foto array...');
    await _yieldToUI(30);

    photos = photoDataArray.map(function(p) {
      return {
        id: p.id, name: p.name,
        src: p.src,              // ← Simpan src untuk PDF export
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
    photoDataArray = null; // Bebaskan segera — data besar!
    await _yieldToUI(100); // GC pause yang lebih lama setelah array besar dibebaskan

    setBar(56, 'Init peta...');
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

    setBar(60, 'Restore polygon...');
    await _yieldToUI(20);
    _restoreMeasureLayers();

    // ⚡ LAZY LOAD: Proses foto satu per satu tapi TIDAK bangun canvas
    //              Canvas akan dibangun otomatis oleh _update saat foto masuk viewport
    var total = photos.length;
    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      var pct = 60 + Math.round((i / Math.max(total, 1)) * 28);
      setBar(pct, 'Setup foto ' + (i + 1) + '/' + total + ': ' + photo.name);
      await _yieldToUI(16);

      if (!photo.src || !photo.georef || photo.gcps.length < 3) continue;

      try {
        if (!photo.w || !photo.h) {
          // Dapatkan dimensi foto tanpa menyimpan gambar di memori lama
          await new Promise(function(resolve) {
            var imgTmp = new Image();
            imgTmp.onload = function() {
              photo.w = imgTmp.naturalWidth;
              photo.h = imgTmp.naturalHeight;
              imgTmp.src = ''; // Bebaskan segera
              imgTmp = null;
              resolve();
            };
            imgTmp.onerror = resolve;
            imgTmp.src = photo.src;
          });
        }

        var toGeo = buildAffine(photo.gcps);
        photo.overlay = createRotatedOverlay(photo, toGeo);

        if (photo.visible && map) {
          photo.overlay.addTo(map);
          // ⚡ TIDAK await _buildOfc() di sini
          // Canvas akan dibangun lazy oleh queue saat foto terlihat di viewport
        }

        photo.gcpLayer = L.featureGroup();
        photo.gcps.forEach(function(g, gi) {
          L.circleMarker([g.lat, g.lng], { radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane' })
            .addTo(photo.gcpLayer).bindPopup('<b>' + photo.name + '</b><br>GCP ' + (gi + 1));
        });
        var togGCP = document.getElementById('togGCP');
        if (togGCP && togGCP.checked && map) photo.gcpLayer.addTo(map);

      } catch (photoErr) {
        console.warn('[MemFix] Gagal setup foto "' + photo.name + '":', photoErr);
      }

      await _yieldToUI(20); // GC pause antar foto
    }

    // Tree markers
    setBar(89, 'Restore pokok sawit...');
    await _yieldToUI(20);
    if (_treeLayer) _treeLayer.clearLayers();
    trees.forEach(function(t) { addTreeMarker(t); });

    // fitBounds — akan trigger _update pada overlay → _enqueueBuild → lazy rendering
    setBar(91, 'Fit bounds peta...');
    await _yieldToUI(20);
    var allBounds = photos.filter(function(p) { return p.georef && p.bounds; }).map(function(p) { return p.bounds; });
    if (allBounds.length > 0 && map) {
      var aLats = [], aLngs = [];
      allBounds.forEach(function(b) { aLats.push(b[0][0], b[1][0]); aLngs.push(b[0][1], b[1][1]); });
      map.fitBounds([[Math.min.apply(null, aLats), Math.min.apply(null, aLngs)], [Math.max.apply(null, aLats), Math.max.apply(null, aLngs)]], { padding: [20, 20] });
    }

    setBar(93, 'Finalisasi...');
    await _yieldToUI(20);
    _rebuildBatasKebunPolygons();
    _updateBatasKebunInfoPanel();
    updateGcpCoverageBox();
    hideImagePanel();
    updateStep(3);

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
    document.querySelectorAll('.tabpane').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('.stab')[4].classList.add('active');
    document.getElementById('tab-measure').classList.add('active');

    setBar(100, 'Selesai!');

    if (statusEl) {
      statusEl.style.background = 'rgba(63,185,80,.08)';
      statusEl.style.color = 'var(--ok)';
      statusEl.style.border = '1px solid rgba(63,185,80,.25)';
      statusEl.innerHTML = '✅ Sesi dipulihkan!<br>' + georefDone + ' foto georef · ' + measures.length + ' pengukuran · ' + trees.length + ' pokok sawit<br>'
        + '<span style="color:var(--mu);font-size:8px">Foto merender bertahap (hemat memori aktif)</span>';
    }
    showToast('✅ Sesi berhasil dipulihkan!\n' + georefDone + ' foto, ' + measures.length + ' pengukuran, ' + trees.length + ' pokok\n⏳ Foto merender secara bertahap...');

  } catch (err) {
    console.error('[MemFix] Load session error:', err);
    if (statusEl) {
      statusEl.style.background = 'rgba(248,81,73,.08)';
      statusEl.style.color = 'var(--er)';
      statusEl.style.border = '1px solid rgba(248,81,73,.3)';
      statusEl.innerHTML = '❌ Gagal: ' + err.message + '<br><span style="font-size:8px;color:var(--mu)">Coba tutup tab lain &amp; reload</span>';
    }
  }
}

// ─────────────────────────────────────────────
// 6. PATCH georefPhoto — pakai lazy queue
// ─────────────────────────────────────────────
var _origGeorefPhoto = (typeof georefPhoto === 'function') ? georefPhoto : null;

function georefPhoto(photo) {
  if (!photo || photo.gcps.length < 3) return;
  if (!map) initMap(photo);
  var toGeo = buildAffine(photo.gcps);
  var residuals = photo.gcps.map(function(g) {
    var pred = toGeo(g.px, g.py);
    var dLat = (pred.lat - g.lat) * 111320, dLng = (pred.lng - g.lng) * 111320 * Math.cos(g.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  });
  var maxRes = Math.max.apply(null, residuals), avgRes = residuals.reduce(function(s, r) { return s + r; }, 0) / residuals.length;
  var xs = photo.gcps.map(function(g) { return g.px; }), ys = photo.gcps.map(function(g) { return g.py; });
  var spreadX = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / photo.w;
  var spreadY = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) / photo.h;
  var spreadOk = spreadX > 0.35 && spreadY > 0.35;
  var dx_lat = toGeo(1, 0).lat - toGeo(0, 0).lat, dx_lng = toGeo(1, 0).lng - toGeo(0, 0).lng;
  var rotDeg = Math.atan2(-dx_lat, dx_lng) * 180 / Math.PI;
  document.getElementById('hdrRotTag').style.display = '';
  document.getElementById('hdrRotTag').textContent = '↻ ' + rotDeg.toFixed(1) + '°';
  var maxZ = photos.reduce(function(m, p) { return p.georef ? (Math.max(m, p.zOrder || 0)) : m; }, 0);
  if (!photo.georef) photo.zOrder = maxZ + 1;
  if (photo.overlay && map) map.removeLayer(photo.overlay);
  photo.overlay = createRotatedOverlay(photo, toGeo);
  if (photo.visible) {
    photo.overlay.addTo(map);
    // ⚡ Lazy: tidak _buildOfc() eksplisit — queue handle via _update
  }
  if (photo.gcpLayer) map.removeLayer(photo.gcpLayer);
  photo.gcpLayer = L.featureGroup();
  photo.gcps.forEach(function(g, i) {
    L.circleMarker([g.lat, g.lng], { radius: 7, fillColor: '#f0a500', color: '#000', weight: 2, fillOpacity: 1, pane: 'gcpPane' })
      .addTo(photo.gcpLayer)
      .bindPopup('<b>' + photo.name + '</b><br>GCP ' + (i + 1) + '<br>' + g.lat.toFixed(6) + ', ' + g.lng.toFixed(6));
  });
  if (document.getElementById('togGCP').checked) photo.gcpLayer.addTo(map);
  photo.georef = true;
  var allBounds = photos.filter(function(p) { return p.georef && p.bounds; }).map(function(p) { return p.bounds; });
  if (allBounds.length > 0) {
    var allLats = [], allLngs = [];
    allBounds.forEach(function(b) { allLats.push(b[0][0], b[1][0]); allLngs.push(b[0][1], b[1][1]); });
    map.fitBounds([[Math.min.apply(null, allLats), Math.min.apply(null, allLngs)], [Math.max.apply(null, allLats), Math.max.apply(null, allLngs)]], { padding: [20, 20] });
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
  setStatus('✓ "' + photo.name + '" | Rot: ' + rotDeg.toFixed(1) + '° | Error avg: ' + avgRes.toFixed(2) + 'm', spreadOk && maxRes < 5 ? 'green' : 'amber');
  updateStep(3);
  document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tabpane').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.stab')[4].classList.add('active');
  document.getElementById('tab-measure').classList.add('active');
  updateGcpCoverageBox();
  _rebuildBkOwnerMap();
  if (typeof _seamlineMode !== 'undefined' && _seamlineMode) computeAllVoronoi();
}

// ─────────────────────────────────────────────
// 7. INFO PANEL: tampilkan info memori di UI
// ─────────────────────────────────────────────
window.addEventListener('load', function() {
  var mem = navigator.deviceMemory || null;
  var maxDim = _getMaxDim();
  var memLabel = mem ? mem + ' GB' : 'tidak diketahui';
  var dimLabel = maxDim + 'px';
  console.log('[MemFix] Device RAM:', memLabel, '| Canvas MAX_DIM:', dimLabel);
  console.log('[MemFix] Lazy OFC build queue aktif — foto merender saat masuk viewport');

  // Tambahkan badge info ke header
  var hdrR = document.querySelector('.hdr-r');
  if (hdrR) {
    var badge = document.createElement('span');
    badge.className = 'hdr-tag';
    badge.title = 'RAM: ' + memLabel + ' | Canvas max: ' + dimLabel + '\nLazy render aktif — hemat memori';
    badge.textContent = mem && mem <= 4 ? '⚡ HeritMode' : '⚡ LazyRender';
    badge.style.color = mem && mem <= 2 ? 'var(--ac)' : 'var(--ok)';
    badge.style.cursor = 'help';
    hdrR.insertBefore(badge, hdrR.firstChild);
  }

  // Tampilkan info di tab Layer (Visibilitas Layer section)
  setTimeout(function() {
    var togSection = document.querySelector('#tab-layers .s-sec:last-child');
    if (togSection) {
      var infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'margin-top:8px;padding:6px 9px;background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);border-radius:5px;font-size:9px;color:var(--in);font-family:\'Space Mono\',monospace;line-height:1.7';
      infoDiv.innerHTML = '⚡ <b>Lazy Render Aktif</b><br>'
        + 'RAM: ' + memLabel + ' | Canvas: ' + dimLabel + '<br>'
        + 'Foto merender saat masuk viewport.<br>'
        + '<span style="color:var(--mu)">Pan peta untuk trigger render.</span>';
      togSection.appendChild(infoDiv);
    }
  }, 500);
});
