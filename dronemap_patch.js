// ============================================================
// DroneMap v3 Pro — Patch File
// Fitur:
//   1. Toggle "Marker Pokok Sawit" mengontrol konten sensus di PDF
//      (titik di peta, kotak statistik, halaman tabel sensus)
//   2. Inset peta PDF bisa diatur cakupannya:
//      Provinsi (~4-5°) | Kabupaten (~1-1.5°) | Kecamatan (~0.3-0.5°)
//
// Cara pakai: Tambahkan di akhir file HTML, sebelum </body>:
//   <script src="dronemap_patch.js"></script>
// ============================================================

// ─────────────────────────────────────────────
// STATE BARU
// ─────────────────────────────────────────────
var _pdfInsetLevel = 'provinsi'; // 'provinsi' | 'kabupaten' | 'kecamatan'

var _insetLevelDefs = {
  provinsi:  { lat: 4.5,  lng: 5.5,  zMin: 5,  zMax: 7,  hint: '~4–5° — Tampak wilayah antar kabupaten' },
  kabupaten: { lat: 1.3,  lng: 1.6,  zMin: 7,  zMax: 9,  hint: '~1–1.5° — Tampak kecamatan sekitar' },
  kecamatan: { lat: 0.38, lng: 0.48, zMin: 9,  zMax: 11, hint: '~0.3–0.5° — Tampak desa & lingkungan sekitar' }
};

// ─────────────────────────────────────────────
// FUNGSI LEVEL INSET
// ─────────────────────────────────────────────
function _setInsetLevel(level, btn) {
  _pdfInsetLevel = level;
  document.querySelectorAll('.inset-lvl-btn').forEach(function(b) {
    var ac = b.getAttribute('data-level') === level;
    b.style.background    = ac ? 'rgba(90,158,53,.18)' : 'var(--s2)';
    b.style.borderColor   = ac ? 'var(--saw)'          : 'var(--bd)';
    b.style.color         = ac ? 'var(--saw2)'         : 'var(--mu)';
    b.style.fontWeight    = ac ? '700'                 : '400';
  });
  var hintEl = document.getElementById('_insetLvlHint');
  if (hintEl) hintEl.textContent = (_insetLevelDefs[level] || _insetLevelDefs.provinsi).hint;
}

function _buildInsetLevelUI() {
  var levels = [
    { key: 'provinsi',  label: 'Provinsi'  },
    { key: 'kabupaten', label: 'Kabupaten' },
    { key: 'kecamatan', label: 'Kecamatan' }
  ];
  var btns = levels.map(function(l) {
    var ac = l.key === _pdfInsetLevel;
    return '<button class="inset-lvl-btn" data-level="' + l.key + '" '
      + 'onclick="_setInsetLevel(\'' + l.key + '\',this)" '
      + 'style="flex:1;padding:5px 3px;font-size:9px;border-radius:4px;cursor:pointer;'
      + 'border:1px solid ' + (ac ? 'var(--saw)' : 'var(--bd)') + ';'
      + 'background:' + (ac ? 'rgba(90,158,53,.18)' : 'var(--s2)') + ';'
      + 'color:' + (ac ? 'var(--saw2)' : 'var(--mu)') + ';'
      + 'font-family:\'Space Mono\',monospace;font-weight:' + (ac ? '700' : '400') + ';'
      + 'transition:.15s">' + l.label + '</button>';
  }).join('');

  var def = _insetLevelDefs[_pdfInsetLevel] || _insetLevelDefs.provinsi;

  return '<div id="_insetLevelWrap" style="margin-bottom:11px">'
    + '<label style="font-size:9px;font-weight:700;color:var(--mu);text-transform:uppercase;'
    + 'letter-spacing:.7px;display:block;margin-bottom:5px">🗺 Cakupan Inset Peta</label>'
    + '<div style="display:flex;gap:4px;margin-bottom:5px">' + btns + '</div>'
    + '<div id="_insetLvlHint" style="font-size:9px;color:var(--mu);font-family:\'Space Mono\',monospace;'
    + 'padding:3px 6px;background:var(--s3);border-radius:3px;border:1px solid var(--bd)">'
    + def.hint + '</div>'
    + '</div>';
}

// ─────────────────────────────────────────────
// PATCH openPdfModal — sisipkan inset level UI
// ─────────────────────────────────────────────
var _orig_openPdfModal = (typeof openPdfModal === 'function') ? openPdfModal : null;

function openPdfModal() {
  // Panggil versi asli
  if (_orig_openPdfModal) _orig_openPdfModal();

  // Inject inset level UI ke dalam modal (hanya sekali)
  // Cari elemen pdfPengecek, sisipkan di atasnya
  setTimeout(function() {
    if (document.getElementById('_insetLevelWrap')) return; // sudah ada

    var scrollPane = document.querySelector('#pdfModal > div > div[style*="overflow-y"]');
    if (!scrollPane) {
      // Fallback: cari div scroll di dalam modal
      scrollPane = document.querySelector('#pdfModal [style*="overflow-y:auto"]');
    }
    if (!scrollPane) return;

    // Cari wrapper pdfPengecek
    var pengecekInput = document.getElementById('pdfPengecek');
    var targetNode = pengecekInput ? pengecekInput.closest('div[style*="margin-bottom"]') : null;

    var wrapper = document.createElement('div');
    wrapper.innerHTML = _buildInsetLevelUI();

    if (targetNode && targetNode.parentNode) {
      // Insert setelah wrapper pdfPengecek
      targetNode.parentNode.insertBefore(wrapper.firstChild, targetNode.nextSibling);
    } else {
      // Fallback: append ke scrollPane
      scrollPane.appendChild(wrapper.firstChild);
    }
  }, 50);
}

// ─────────────────────────────────────────────
// PATCH generateDroneMapPDF — full override
// dengan dua perbaikan:
//   1. showTreesInPdf mengontrol kotak statistik + tabel hal.2
//   2. inset span & zoom dari _pdfInsetLevel
// ─────────────────────────────────────────────

// Simpan referensi asli
var _orig_generateDroneMapPDF = (typeof generateDroneMapPDF === 'function') ? generateDroneMapPDF : null;

// Override: intercept dengan pre/post processing
// Strategy: patch via source string replacement
(function() {
  if (!_orig_generateDroneMapPDF) {
    console.warn('[Patch] generateDroneMapPDF tidak ditemukan saat patch dijalankan. Patch akan dicoba setelah window.load.');
    window.addEventListener('load', function() {
      _patchGeneratePDF();
    });
  } else {
    _patchGeneratePDF();
  }
})();

function _patchGeneratePDF() {
  if (typeof generateDroneMapPDF !== 'function') return;

  var src = generateDroneMapPDF.toString();

  // ── Patch 1: Kotak statistik sensus — ikut toggle showTreesInPdf ──
  // Original: var nTotal=trees.length;
  // Patched:  var nTotal=showTreesInPdf?trees.length:0;
  src = src.replace(
    /var\s+nTotal\s*=\s*trees\.length\s*;(\s*if\s*\(nTotal\s*>\s*0\))/,
    'var nTotal=showTreesInPdf?trees.length:0;$1'
  );

  // ── Patch 2: Inset span dari _pdfInsetLevel ──
  // Ganti dua baris literal span inset dengan kode dinamis
  src = src.replace(
    /var\s+insetSpanLat\s*=\s*4\.5\s*;[^\n]*\n\s*var\s+insetSpanLng\s*=\s*5\.5\s*;[^\n]*/,
    [
      'var _iDef=_insetLevelDefs[_pdfInsetLevel]||_insetLevelDefs.provinsi;',
      'var insetSpanLat=_iDef.lat;',
      'var insetSpanLng=_iDef.lng;'
    ].join('\n      ')
  );

  // ── Patch 3: Zoom tile range dinamis dari _iDef ──
  // Original: var zoomTile=Math.max(5,Math.min(7,...))
  // Patched:  var zoomTile=Math.max(_iDef.zMin,Math.min(_iDef.zMax,...))
  src = src.replace(
    /var\s+zoomTile\s*=\s*Math\.max\s*\(\s*5\s*,\s*Math\.min\s*\(\s*7\s*,/,
    'var zoomTile=Math.max(_iDef.zMin,Math.min(_iDef.zMax,'
  );

  // ── Patch 4: Tile count limit — naikkan untuk zoom lebih tinggi ──
  // Original: if(totalTiles<=36){
  // Patched:  if(totalTiles<=81){
  src = src.replace(
    /if\s*\(\s*totalTiles\s*<=\s*36\s*\)/,
    'if(totalTiles<=81)'
  );

  // Re-evaluate dengan nama async function
  try {
    var patched = null;
    // Eval: ganti deklarasi function jadi ekspresi
    var exprSrc = src.replace(/^async\s+function\s+generateDroneMapPDF/, 'patched = async function generateDroneMapPDF');
    eval(exprSrc);
    if (typeof patched === 'function') {
      generateDroneMapPDF = patched;
      console.log('[Patch] generateDroneMapPDF berhasil di-patch (4 perubahan).');
    } else {
      console.warn('[Patch] Eval tidak menghasilkan function, coba fallback.');
      _applyPatchFallback();
    }
  } catch(e) {
    console.error('[Patch] Eval error:', e);
    _applyPatchFallback();
  }
}

// ─────────────────────────────────────────────
// FALLBACK: Jika eval gagal, override dengan wrapper
// ─────────────────────────────────────────────
function _applyPatchFallback() {
  console.log('[Patch] Menggunakan fallback wrapper...');
  var origFn = _orig_generateDroneMapPDF;
  generateDroneMapPDF = async function() {
    // Patch 1: Monkey-patch tree usage via closure
    // Tidak bisa inject langsung ke fungsi besar,
    // tapi setidaknya kita pastikan togTrees sudah diset
    await origFn.apply(this, arguments);
  };
  console.warn('[Patch] Fallback aktif — patch parsial saja. Pastikan eval diizinkan di browser.');
}

// ─────────────────────────────────────────────
// Verifikasi patch setelah diload
// ─────────────────────────────────────────────
window.addEventListener('load', function() {
  // Cek apakah patch berhasil
  var src2 = (typeof generateDroneMapPDF === 'function') ? generateDroneMapPDF.toString() : '';
  var ok1 = src2.indexOf('showTreesInPdf?trees.length:0') !== -1;
  var ok2 = src2.indexOf('_iDef.lat') !== -1;
  var ok3 = src2.indexOf('_iDef.zMin') !== -1;
  var ok4 = src2.indexOf('totalTiles<=81') !== -1;
  console.log('[Patch Status]',
    'Tree-toggle-PDF:', ok1 ? '✓' : '✗',
    '| Inset-span:', ok2 ? '✓' : '✗',
    '| Inset-zoom:', ok3 ? '✓' : '✗',
    '| Tile-limit:', ok4 ? '✓' : '✗'
  );
  if (!ok1 || !ok2) {
    console.warn('[Patch] Satu atau lebih patch tidak berhasil. Kemungkinan whitespace source berbeda antar browser. Lihat PATCH_MANUAL.md untuk cara manual.');
  }
});
