/**
 * DroneMap v3 Pro — Patch: Session Layer State Fix
 * =================================================
 * File  : dronemap_session_layer_patch.js
 * Pasang: <script src="dronemap_session_layer_patch.js"></script>
 *         SETELAH semua <script> utama DroneMap, sebelum </body>
 *
 * Masalah yang diperbaiki:
 *   State berikut tidak ikut disimpan ke .dmsession sehingga
 *   setelah load ulang kondisi tab Layer berbeda:
 *     - _blokStyles       : warna/tebal/pola per polygon
 *     - _measureLayerType : jenis layer (Blok, Sungai, Jalan, dll)
 *     - _legendSettings   : pengaturan legenda per layer
 *     - _manualAreaHa     : override luas manual di PDF
 *     - _pdfBatasColor, _pdfBatasThickness, _pdfBatasStyle
 *     - _pdfLabelColor, _pdfLabelSize, _pdfLabelAlign
 *     - _insetZoomLevel
 */

(function () {
  'use strict';

  // ── Tunggu sampai DroneMap siap ─────────────────────────────
  var _tries = 0;
  var _poll = setInterval(function () {
    _tries++;
    if (typeof _doSaveSessionChunked !== 'undefined' &&
        typeof _doLoadSession !== 'undefined') {
      clearInterval(_poll);
      _applyPatch();
      console.log('[Session Layer Patch] Aktif ✓');
    }
    if (_tries > 80) {
      clearInterval(_poll);
      console.error('[Session Layer Patch] Timeout — fungsi DroneMap tidak ditemukan');
    }
  }, 250);

  function _applyPatch() {

    // ════════════════════════════════════════════════════════
    // 1. PATCH _doSaveSessionChunked
    //    Sisipkan layer state ke dalam header sebelum di-encode
    // ════════════════════════════════════════════════════════
    var _origSave = _doSaveSessionChunked;

    _doSaveSessionChunked = async function (setProgress, closeOv, estimateMB) {
      // Hook: sebelum fungsi asli berjalan, tambahkan field ekstra ke header
      // Caranya: patch JSON.stringify sementara untuk menangkap header object
      var _origStringify = JSON.stringify;
      var _patched = false;

      JSON.stringify = function (val) {
        // Tangkap header object pertama yang mengandung 'version' dan 'measures'
        if (!_patched && val && typeof val === 'object' &&
            val.version && val.measures && !val.photos) {
          _patched = true;
          // Sisipkan layer state ke dalam header
          val.layerState = _collectLayerState();
        }
        return _origStringify.apply(this, arguments);
      };

      try {
        await _origSave(setProgress, closeOv, estimateMB);
      } finally {
        // Selalu restore JSON.stringify asli
        JSON.stringify = _origStringify;
      }
    };

    // ════════════════════════════════════════════════════════
    // 2. PATCH _doLoadSession (untuk file kecil < 80 MB)
    // ════════════════════════════════════════════════════════
    var _origLoad = _doLoadSession;

    _doLoadSession = function (data, statusEl) {
      // Panggil loader asli dulu
      _origLoad(data, statusEl);
      // Kemudian restore layer state jika ada
      if (data && data.layerState) {
        _applyLayerState(data.layerState);
      }
    };

    // ════════════════════════════════════════════════════════
    // 3. PATCH _doLoadSessionSequential (untuk file besar > 80 MB)
    // ════════════════════════════════════════════════════════
    var _origSeq = _doLoadSessionSequential;

    _doLoadSessionSequential = async function (data, statusEl, barEl, msgEl) {
      // Simpan layerState sebelum data.photos di-null-kan di dalam fungsi asli
      var savedLayerState = data && data.layerState ? data.layerState : null;
      await _origSeq(data, statusEl, barEl, msgEl);
      if (savedLayerState) {
        _applyLayerState(savedLayerState);
      }
    };

    console.log('[Session Layer Patch] Save & Load patched ✓');
  }

  // ════════════════════════════════════════════════════════════
  // HELPER: Kumpulkan semua layer state yang perlu disimpan
  // ════════════════════════════════════════════════════════════
  function _collectLayerState() {
    var state = {};

    // Per-polygon styles (warna batas, tebal, pola, fill, label)
    if (typeof _blokStyles !== 'undefined')
      state.blokStyles = JSON.parse(JSON.stringify(_blokStyles));

    // Jenis layer per measure (blok, sungai, jalan, dll)
    if (typeof _measureLayerType !== 'undefined')
      state.measureLayerType = JSON.parse(JSON.stringify(_measureLayerType));

    // Pengaturan legenda per layer
    if (typeof _legendSettings !== 'undefined')
      state.legendSettings = JSON.parse(JSON.stringify(_legendSettings));

    // Override luas manual di PDF
    if (typeof _manualAreaHa !== 'undefined')
      state.manualAreaHa = JSON.parse(JSON.stringify(_manualAreaHa));

    // Style global PDF
    if (typeof _pdfBatasColor !== 'undefined')   state.pdfBatasColor   = _pdfBatasColor;
    if (typeof _pdfBatasThickness !== 'undefined') state.pdfBatasThickness = _pdfBatasThickness;
    if (typeof _pdfBatasStyle !== 'undefined')   state.pdfBatasStyle   = _pdfBatasStyle;
    if (typeof _pdfLabelColor !== 'undefined')   state.pdfLabelColor   = _pdfLabelColor;
    if (typeof _pdfLabelSize !== 'undefined')    state.pdfLabelSize    = _pdfLabelSize;
    if (typeof _pdfLabelAlign !== 'undefined')   state.pdfLabelAlign   = _pdfLabelAlign;
    if (typeof _insetZoomLevel !== 'undefined')  state.insetZoomLevel  = _insetZoomLevel;

    return state;
  }

  // ════════════════════════════════════════════════════════════
  // HELPER: Terapkan layer state yang sudah disimpan
  // ════════════════════════════════════════════════════════════
  function _applyLayerState(state) {
    if (!state) return;

    try {
      // Per-polygon styles
      if (state.blokStyles && typeof _blokStyles !== 'undefined') {
        // Merge: jangan overwrite jika sudah ada (hasil dari load default)
        Object.keys(state.blokStyles).forEach(function (id) {
          _blokStyles[id] = state.blokStyles[id];
        });
      }

      // Jenis layer per measure
      if (state.measureLayerType && typeof _measureLayerType !== 'undefined') {
        Object.keys(state.measureLayerType).forEach(function (id) {
          _measureLayerType[id] = state.measureLayerType[id];
        });
      }

      // Pengaturan legenda
      if (state.legendSettings && typeof _legendSettings !== 'undefined') {
        Object.keys(state.legendSettings).forEach(function (id) {
          _legendSettings[id] = state.legendSettings[id];
        });
      }

      // Override luas manual
      if (state.manualAreaHa && typeof _manualAreaHa !== 'undefined') {
        Object.keys(state.manualAreaHa).forEach(function (id) {
          _manualAreaHa[id] = state.manualAreaHa[id];
        });
      }

      // Style global PDF
      if (state.pdfBatasColor    !== undefined && typeof _pdfBatasColor    !== 'undefined') _pdfBatasColor    = state.pdfBatasColor;
      if (state.pdfBatasThickness !== undefined && typeof _pdfBatasThickness !== 'undefined') _pdfBatasThickness = state.pdfBatasThickness;
      if (state.pdfBatasStyle    !== undefined && typeof _pdfBatasStyle    !== 'undefined') _pdfBatasStyle    = state.pdfBatasStyle;
      if (state.pdfLabelColor    !== undefined && typeof _pdfLabelColor    !== 'undefined') _pdfLabelColor    = state.pdfLabelColor;
      if (state.pdfLabelSize     !== undefined && typeof _pdfLabelSize     !== 'undefined') _pdfLabelSize     = state.pdfLabelSize;
      if (state.pdfLabelAlign    !== undefined && typeof _pdfLabelAlign    !== 'undefined') _pdfLabelAlign    = state.pdfLabelAlign;
      if (state.insetZoomLevel   !== undefined && typeof _insetZoomLevel   !== 'undefined') _insetZoomLevel   = state.insetZoomLevel;

      // Terapkan ulang style ke Leaflet layers yang sudah ada di peta
      _reapplyStylesToMap();

      // Refresh UI yang relevan
      _refreshLayerUI();

      console.log('[Session Layer Patch] Layer state berhasil dipulihkan ✓');
    } catch (e) {
      console.warn('[Session Layer Patch] Gagal menerapkan layer state:', e);
    }
  }

  // ════════════════════════════════════════════════════════════
  // Terapkan ulang _blokStyles ke semua Leaflet polygon/polyline
  // (dipanggil setelah load sesi agar warna di peta ikut berubah)
  // ════════════════════════════════════════════════════════════
  function _reapplyStylesToMap() {
    if (typeof drawnItems === 'undefined' || !drawnItems) return;
    if (typeof _blokStyles === 'undefined') return;

    drawnItems.eachLayer(function (layer) {
      var id = layer._mid;
      if (!id || !_blokStyles[id] || !layer.setStyle) return;

      var st = _blokStyles[id];

      // Cek apakah polygon BK — gunakan warna BK jika ada, override dengan blokStyle
      var isBK = (typeof _batasKebunIds !== 'undefined') && _batasKebunIds.has(id);
      var bkColor = isBK && typeof _getBkColor === 'function' ? _getBkColor(id) : null;

      var color     = st.batasColor  || (bkColor || '#5a9e35');
      var fillColor = st.fillColor   || (bkColor || '#5a9e35');
      var weight    = st.batasThickness || (isBK ? 2.5 : 2);
      var dash      = st.batasDash === 'dashed' ? '8 4' :
                      st.batasDash === 'dotted' ? '2 4' : null;

      layer.setStyle({
        color:       color,
        fillColor:   fillColor,
        weight:      weight,
        fillOpacity: isBK ? 0.18 : 0.22,
        dashArray:   dash
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  // Refresh UI komponen yang bergantung pada layer state
  // ════════════════════════════════════════════════════════════
  function _refreshLayerUI() {
    // Hanya refresh jika fungsi tersedia (page mungkin belum render tab Export)
    setTimeout(function () {
      try {
        if (typeof renderMeasures === 'function') renderMeasures();
        if (typeof _renderExportStylePanel === 'function') _renderExportStylePanel();
        if (typeof _updateLabelDragMarkers === 'function') _updateLabelDragMarkers();
        // Sinkronkan tombol inset zoom jika ada
        if (typeof _insetZoomLevel !== 'undefined') {
          var izBtn = document.getElementById('izBtn_' + _insetZoomLevel);
          if (izBtn && typeof setInsetZoom === 'function') setInsetZoom(_insetZoomLevel);
        }
      } catch (e) {
        // UI belum siap — tidak masalah, user bisa refresh manual
      }
    }, 200);
  }

})();
