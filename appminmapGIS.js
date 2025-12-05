// --- Initialization ---
var map = L.map('map').setView([0.5,101.4],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:22}).addTo(map);

// ===== BASEMAP LAYERS =====
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: 'Erik Simarmata'
});

var cartoDBLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var cartoDBDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

// Tambahkan default layer (OpenStreetMap)
osmLayer.addTo(map);

// ===== LAYER CONTROL =====
var baseMaps = {
  "OpenStreetMap": osmLayer,
  "Satellite": satelliteLayer,
  "Topographic": topoLayer,
  "CartoDB Light": cartoDBLight,
  "CartoDB Dark": cartoDBDark
};

// Tambahkan Layer Control ke peta
L.control.layers(baseMaps, null, {
  position: 'topright',
  collapsed: true
}).addTo(map);

// Editable group for Leaflet.draw
var editableLayers = new L.FeatureGroup().addTo(map);

var drawControl = new L.Control.Draw({
  edit:{ featureGroup: editableLayers },
  draw:{ polygon:true, polyline:true, rectangle:true, marker:true, circle:false }
});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED, function(e){ 
    const layer = e.layer;
    const layerType = e.layerType;
    
    // Generate unique ID
    const id = 'drawn-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // Increment counter
    drawnLayerCounters[layerType] = (drawnLayerCounters[layerType] || 0) + 1;
    
    // Tentukan nama default dengan counter
    let defaultName = '';
    if (layerType === 'polygon') {
        defaultName = 'Polygon ' + drawnLayerCounters[layerType];
    } else if (layerType === 'polyline') {
        defaultName = 'Polyline ' + drawnLayerCounters[layerType];
    } else if (layerType === 'rectangle') {
        defaultName = 'Rectangle ' + drawnLayerCounters[layerType];
    } else if (layerType === 'marker') {
        defaultName = 'Marker ' + drawnLayerCounters[layerType];
    } else {
        defaultName = 'Layer Baru';
    }
    
    // Buat FeatureGroup baru untuk layer ini
    const group = L.featureGroup();
    group.addLayer(layer);
    
    // Attach click event
    attachLayerClickEvent(layer, id);
    
    // Hitung bounds
    let bounds = null;
    if (layer.getBounds) {
        bounds = layer.getBounds();
    } else if (layer.getLatLng) {
        const latlng = layer.getLatLng();
        bounds = L.latLngBounds([latlng, latlng]);
    }
    
    // Default style settings
    // ===== DETEKSI: Polyline vs Polygon =====
    const metaDefaults = {};
    
    if (layerType === 'polyline') {
        // POLYLINE: Gunakan warna pink (sama dengan polygon)
        metaDefaults.color = '#ee00ff';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';  // Tidak digunakan
        metaDefaults.fillOpacity = 0.4;       // Tidak digunakan
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    } else if (layerType === 'polygon' || layerType === 'rectangle') {
        // POLYGON: Border hitam, fill pink
        metaDefaults.color = '#000000';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';
        metaDefaults.fillOpacity = 0.4;
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    } else {
        // MARKER: Default
        metaDefaults.color = '#000000';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';
        metaDefaults.fillOpacity = 0.8;
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    }
    
    uploadedFiles[id] = {
        name: defaultName,
        group: group,
        bounds: bounds,
        color: metaDefaults.color,
        weight: metaDefaults.weight,
        fillColor: metaDefaults.fillColor,
        fillOpacity: metaDefaults.fillOpacity,
        dashArray: metaDefaults.dashArray,
        markerSymbol: metaDefaults.markerSymbol,
        labelSettings: {
            show: true,
            blockName: defaultName,
            textColor: '#000000',
            textSize: 12,
            offsetX: 0,
            offsetY: 0
        },
        isDrawn: true,
        includeInTotal: true  // ← BARU: Default dihitung dalam total
    };
    
    // ===== APPLY STYLE LANGSUNG KE LAYER =====
    if (layer.setStyle) {
        layer.setStyle({
            color: metaDefaults.color,
            weight: metaDefaults.weight,
            fillColor: metaDefaults.fillColor,
            fillOpacity: metaDefaults.fillOpacity,
            dashArray: metaDefaults.dashArray
        });
    }
    
    // Tambahkan ke editableLayers
    editableLayers.addLayer(layer);
    
    // Tambahkan card di file list
    addFileCard(id, {
        name: defaultName,
        summary: layerType.charAt(0).toUpperCase() + layerType.slice(1) + ' (Drawn)'
    });
    
    // Update labels jika polygon
    if (layerType === 'polygon') {
        updateMapLabels(id);
    }
    
    console.log('Layer drawn added to file list:', defaultName);
    console.log('Layer style applied:', {
        color: metaDefaults.color,
        fillColor: metaDefaults.fillColor,
        fillOpacity: metaDefaults.fillOpacity
    });
    
    // Auto-open rename untuk layer baru
    setTimeout(function() {
        openRename(id);
    }, 300);
});

// ===== TAMBAHAN BARU: Event listener untuk edit layer =====
map.on(L.Draw.Event.EDITED, function(e) {
  var layers = e.layers;
  
  layers.eachLayer(function(editedLayer) {
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      
      meta.group.eachLayer(function(layer) {
        if (layer === editedLayer) {
          found = true;
        }
      });
      
      if (found) {
        console.log('Layer edited for file:', meta.name);
        
        // Re-attach click event setelah edit
        attachLayerClickEvent(editedLayer, id);
        
        updateMapLabels(id);
        
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }
    });
  });
});

map.on(L.Draw.Event.DELETED, function(e) {
  var layers = e.layers;
  
  // Cari layer mana yang dihapus dan hapus labelnya
  layers.eachLayer(function(deletedLayer) {
    // Cari uploadedFile mana yang mengandung layer ini
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      var layerToRemove = null;
      
      meta.group.eachLayer(function(layer) {
        if (layer === deletedLayer) {
          found = true;
          layerToRemove = layer;
        }
      });
      
      if (found && layerToRemove) {
        // Hapus layer dari group
        meta.group.removeLayer(layerToRemove);
        
        // Update label untuk file ini
        console.log('Layer deleted for file:', meta.name);
        updateMapLabels(id);
        
        // Update stats di properties panel jika sedang dibuka
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }
    });
  });
  
  // PENTING: Bersihkan label yang orphan setelah delete
  cleanupOrphanLabels();
});

// Event untuk vertex drag (real-time update)
map.on('draw:editvertex', function(e) {
  // Cari layer yang sedang di-edit
  Object.keys(uploadedFiles).forEach(function(id) {
    var meta = uploadedFiles[id];
    var found = false;
    
    meta.group.eachLayer(function(layer) {
      if (layer === e.layer) {
        found = true;
      }
    });
    
    if (found) {
      // Delay update agar tidak terlalu sering (throttle)
      if (meta._updateTimeout) clearTimeout(meta._updateTimeout);
      
      meta._updateTimeout = setTimeout(function() {
        updateMapLabels(id);
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }, 100); // Update setiap 100ms
    }
  });
});

// --- State ---
var uploadedFiles = {}; // id -> { name, group:LayerGroup, bounds, color, weight, fillColor, fillOpacity, dashArray, markerSymbol }
var lastSelectedId = null;
var labelLayers = {}; // id -> array of label markers

// Counter untuk nama default layer yang digambar
var drawnLayerCounters = {
    polygon: 0,
    polyline: 0,
    rectangle: 0,
    marker: 0
};

// --- Helpers: create group from GeoJSON, adding each sublayer to a LayerGroup ---
// --- Helpers: create group from GeoJSON, adding each sublayer to a LayerGroup ---
function createGroupFromGeoJSON(geojson, styleMeta, fileId){
  styleMeta = styleMeta || {};

  // HARUS FeatureGroup supaya ada getBounds()
  var group = L.featureGroup();

  // Buat GeoJSON layer sementara
  var base = L.geoJSON(geojson, {
    style: function(f){
      return {
        color: styleMeta.color || '#0077ff',
        weight: styleMeta.weight || 3,
        dashArray: styleMeta.dashArray || null,
        fillColor: styleMeta.fillColor || (styleMeta.color || '#0077ff'),
        fillOpacity: styleMeta.fillOpacity || 0.4
      };
    },
    pointToLayer: function(f,latlng){
      var symbol = styleMeta.markerSymbol || 'circle';

      if(symbol === 'circle'){
        return L.circleMarker(latlng,{
          radius:5,
          color: styleMeta.color || '#0077ff',
          fillColor: styleMeta.fillColor || (styleMeta.color||'#0077ff'),
          fillOpacity: styleMeta.fillOpacity || 0.8
        });
      } else {
        var html = '<div style="width:12px;height:12px;border-radius:2px;background:'+ 
                    (styleMeta.color||'#0077ff') +'"></div>';

        return L.marker(latlng,{
          icon: L.divIcon({
            className:'custom-marker',
            html:html,
            iconSize:[12,12],
            iconAnchor:[6,6]
          })
        });
      }
    }
  });

  // PENTING: pindahkan SEMUA sublayer geojson ke FeatureGroup
  base.eachLayer(function(layer){
    // Attach click event jika fileId tersedia
    if (fileId) {
      attachLayerClickEvent(layer, fileId);
    }
    group.addLayer(layer);
  });

  return group;
}

// --- Helper: Attach click event to layers ---
function attachLayerClickEvent(layer, fileId) {
  layer.on('click', function(e) {
    L.DomEvent.stopPropagation(e); // Prevent map click event
    console.log('Layer clicked, opening properties for:', fileId);
    openProperties(fileId);
  });
}

// --- Helper: Attach click event to layers ---
function attachLayerClickEvent(layer, fileId) {
  layer.on('click', function(e) {
    L.DomEvent.stopPropagation(e); // Prevent map click event
    console.log('Layer clicked, opening properties for:', fileId);
    openProperties(fileId);
  });
}

// --- Utility: simple GPX exporter for GeoJSON (points as wpt, lines/polygons as trk) ---
function geojsonToGpx(geojson, name, metadata){
  var esc = function(s){ return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="MiniMapGIS" xmlns:miniarcgis="http://miniarcgis.local/gpx/1/0">\n';
  xml += '<name>' + esc(name||'export') + '</name>\n';
  
  // ===== METADATA LAYER LENGKAP (sebagai extensions) =====
  if (metadata) {
    xml += '<metadata>\n';
    xml += '  <extensions>\n';
    
    // Nama layer
    xml += '    <miniarcgis:layerName>' + esc(metadata.name) + '</miniarcgis:layerName>\n';
    
    // Pengaturan total luas
    xml += '    <miniarcgis:includeInTotal>' + (metadata.includeInTotal ? 'true' : 'false') + '</miniarcgis:includeInTotal>\n';
    
    // Luas manual (jika ada)
    if (metadata.manualArea && metadata.manualArea > 0) {
      xml += '    <miniarcgis:manualArea>' + metadata.manualArea + '</miniarcgis:manualArea>\n';
    }
    
    // Style settings
    xml += '    <miniarcgis:style>\n';
    xml += '      <miniarcgis:color>' + esc(metadata.color || '#0077ff') + '</miniarcgis:color>\n';
    xml += '      <miniarcgis:weight>' + (metadata.weight || 3) + '</miniarcgis:weight>\n';
    xml += '      <miniarcgis:fillColor>' + esc(metadata.fillColor || '#ee00ff') + '</miniarcgis:fillColor>\n';
    xml += '      <miniarcgis:fillOpacity>' + (metadata.fillOpacity || 0.4) + '</miniarcgis:fillOpacity>\n';
    xml += '      <miniarcgis:dashArray>' + esc(metadata.dashArray || '') + '</miniarcgis:dashArray>\n';
    xml += '      <miniarcgis:markerSymbol>' + esc(metadata.markerSymbol || 'circle') + '</miniarcgis:markerSymbol>\n';
    xml += '    </miniarcgis:style>\n';
    
    // Label settings
    xml += '    <miniarcgis:label>\n';
    xml += '      <miniarcgis:show>' + (metadata.labelSettings.show ? 'true' : 'false') + '</miniarcgis:show>\n';
    xml += '      <miniarcgis:blockName>' + esc(metadata.labelSettings.blockName) + '</miniarcgis:blockName>\n';
    xml += '      <miniarcgis:textColor>' + esc(metadata.labelSettings.textColor) + '</miniarcgis:textColor>\n';
    xml += '      <miniarcgis:textSize>' + (metadata.labelSettings.textSize || 12) + '</miniarcgis:textSize>\n';
    xml += '      <miniarcgis:offsetX>' + (metadata.labelSettings.offsetX || 0) + '</miniarcgis:offsetX>\n';
    xml += '      <miniarcgis:offsetY>' + (metadata.labelSettings.offsetY || 0) + '</miniarcgis:offsetY>\n';
    xml += '    </miniarcgis:label>\n';
    
    xml += '  </extensions>\n';
    xml += '</metadata>\n';
  }

  geojson.features.forEach(function(f){
    var geom = f.geometry;
    if(!geom) return;
    if(geom.type === 'Point'){
      var c = geom.coordinates;
      xml += '<wpt lat="'+c[1]+'" lon="'+c[0]+'"><name>' + (esc(f.properties && f.properties.name || 'pt')) + '</name></wpt>\n';
    } else if(geom.type === 'LineString'){
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'polyline')) + '</name>';
      xml += '<type>polyline</type>'; // ← Tandai sebagai polyline
      xml += '<trkseg>\n';
      geom.coordinates.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if(geom.type === 'Polygon'){
      // export outer ring as track
      var ring = geom.coordinates[0];
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'polygon')) + '</name>';
      xml += '<type>polygon</type>'; // ← Tandai sebagai polygon
      xml += '<trkseg>\n';
      ring.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if(geom.type === 'MultiLineString'){
      geom.coordinates.forEach(function(line){
        xml += '<trk><trkseg>\n';
        line.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
        xml += '</trkseg></trk>\n';
      });
    }
  });

  xml += '</gpx>';
  return xml;
}

// --- UI helpers ---
function el(q){ return document.querySelector(q); }
function elAll(q){ return Array.from(document.querySelectorAll(q)); }

// Build file card in sidebar
function addFileCard(id, meta){
  var ul = el('#fileList');
  var li = document.createElement('li'); li.className='file-card'; li.id='file-'+id;

  // header row
  var header = document.createElement('div'); header.className='file-header';
  var chk = document.createElement('input'); chk.type='checkbox'; chk.checked=true;
  chk.onchange = function(){ toggleFile(id, chk.checked); };
  var title = document.createElement('div'); title.className='file-title'; title.innerText = meta.name;
  title.onclick = function(){ openRename(id); };

  var actions = document.createElement('div'); actions.className='file-actions';
  var btnZoom = document.createElement('button'); btnZoom.className='btn-small'; btnZoom.innerText='Zoom'; btnZoom.onclick=function(e){ e.stopPropagation(); zoomFile(id); };
  var btnStyle = document.createElement('button'); btnStyle.className='btn-small'; btnStyle.innerText='Style'; btnStyle.onclick=function(e){ e.stopPropagation(); openProperties(id); };
  var btnExport = document.createElement('button'); btnExport.className='btn-small'; btnExport.innerText='Export'; btnExport.onclick=function(e){ e.stopPropagation(); exportAllFor(id); };
  var btnDel = document.createElement('button'); btnDel.className='btn-small'; btnDel.innerText='Delete'; btnDel.onclick=function(e){ e.stopPropagation(); deleteFile(id); };

  actions.appendChild(btnZoom); actions.appendChild(btnStyle); actions.appendChild(btnExport); actions.appendChild(btnDel);
  header.appendChild(chk); header.appendChild(title); header.appendChild(actions);
  li.appendChild(header);

  // folder contents (infos)
  var folder = document.createElement('div'); folder.className='folder-contents';
  var info = document.createElement('div'); info.className='muted';
  info.innerText = meta.summary || '';
  folder.appendChild(info);
  
  // ===== TAMBAHAN BARU: Checkbox Hitung Luas =====
  var totalControl = document.createElement('div');
  totalControl.style.marginTop = '6px';
  totalControl.style.fontSize = '11px';
  totalControl.style.display = 'flex';
  totalControl.style.alignItems = 'center';
  totalControl.style.gap = '4px';
  
  var totalCheckbox = document.createElement('input');
  totalCheckbox.type = 'checkbox';
  totalCheckbox.id = 'totalCheck-' + id;
  totalCheckbox.checked = uploadedFiles[id] ? uploadedFiles[id].includeInTotal : true;
  totalCheckbox.onchange = function(e) {
    e.stopPropagation();
    if (uploadedFiles[id]) {
      uploadedFiles[id].includeInTotal = totalCheckbox.checked;
      console.log(uploadedFiles[id].name + ' includeInTotal:', totalCheckbox.checked);
    }
  };
  
  var totalLabel = document.createElement('label');
  totalLabel.htmlFor = 'totalCheck-' + id;
  totalLabel.innerText = '📊 Hitung dalam Total Luas';
  totalLabel.style.cursor = 'pointer';
  totalLabel.style.userSelect = 'none';
  
  totalControl.appendChild(totalCheckbox);
  totalControl.appendChild(totalLabel);
  folder.appendChild(totalControl);
  
  li.appendChild(folder);
  ul.appendChild(li);
}

// Toggle display/hide file
function toggleFile(id, show){
  var meta = uploadedFiles[id]; if(!meta) return;
  
  meta.group.eachLayer(function(layer){
    if(show){ 
      map.addLayer(layer); 
      editableLayers.addLayer(layer); 
    } else { 
      map.removeLayer(layer); 
      editableLayers.removeLayer(layer); 
    }
  });
  
  // Toggle label juga
  if (show) {
    updateMapLabels(id);
  } else {
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) {
        map.removeLayer(layer);
      });
    }
  }
}

// Zoom to file
function zoomFile(id){ var meta = uploadedFiles[id]; if(!meta) return; if(meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

// delete file
function deleteFile(id){
  if(!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if(!meta) return;
  
  // Hapus semua layer dari peta
  meta.group.eachLayer(function(l){ 
    map.removeLayer(l); 
    editableLayers.removeLayer(l); 
  });
  
  // PENTING: Hapus semua label
  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) {
      map.removeLayer(layer);
    });
    delete labelLayers[id];
  }
  
  delete uploadedFiles[id];
  var node = document.getElementById('file-'+id); 
  if(node) node.remove();
  if(lastSelectedId === id) closeProperties();
}

// open rename inline
function openRename(id){
  var card = document.getElementById('file-'+id);
  if(!card) return;
  var title = card.querySelector('.file-title');
  var old = title.innerText;
  var input = document.createElement('input'); input.type='text'; input.value = old; input.style.flex='1';
  title.replaceWith(input);
  input.focus();
  input.onkeydown = function(e){
    if(e.key === 'Enter'){ finishRename(id, input.value); }
    if(e.key === 'Escape'){ cancelRename(id, old); }
  };
  input.onblur = function(){ finishRename(id, input.value); };
}

function finishRename(id, val){
  val = (val||'').trim() || uploadedFiles[id].name;
  var meta = uploadedFiles[id];
  
  // Update nama layer
  meta.name = val;
  
  // AUTO UPDATE LABEL BLOCK NAME
  meta.labelSettings.blockName = val.replace('.gpx', '');
  
  var card = document.getElementById('file-'+id);
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className='file-title'; title.innerText = val; title.onclick = function(){ openRename(id); };
  input.replaceWith(title);
  
  // Update properties header if open
  if(lastSelectedId === id) el('#propName').value = val;
  
  // Refresh labels di peta
  updateMapLabels(id);
}

function cancelRename(id, old){ var card = document.getElementById('file-'+id); if(!card) return; var input = card.querySelector('input[type=text]'); var title = document.createElement('div'); title.className='file-title'; title.innerText = old; title.onclick = function(){ openRename(id); }; input.replaceWith(title); }

// --- Properties panel ---
function openProperties(id){
  var meta = uploadedFiles[id]; if(!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;

  // Update stats menggunakan helper function
  updatePropertiesStats(id);
  
  // stats: counts, length, area
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) len += turf.length(f, {units:'meters'}) * 1000; // turf.length returns km, convert m
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) area += turf.area(f);
  });
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';

  // style controls set to current meta
  el('#styleStrokeColor').value = meta.color || '#0077ff';
  el('#styleStrokeWidth').value = meta.weight || 3;
  el('#strokeWidthVal').innerText = meta.weight || 3;
  el('#styleFillColor').value = meta.fillColor || (meta.color || '#0077ff');
  el('#styleFillOpacity').value = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
  el('#fillOpacityVal').innerText = el('#styleFillOpacity').value;
  el('#styleDash').value = meta.dashArray || '';
  el('#styleMarker').value = meta.markerSymbol || 'circle';

  // Load label settings
  el('#labelShow').checked = meta.labelSettings.show;
  el('#labelTextColor').value = meta.labelSettings.textColor;
  el('#labelTextSize').value = meta.labelSettings.textSize;
  el('#labelSizeVal').innerText = meta.labelSettings.textSize;
  
  // ===== BARU: Deteksi tipe geometry dan hide/show fill controls =====
  var gj = meta.group.toGeoJSON();
  var hasPolyline = false;
  var hasPolygon = false;
  
  gj.features.forEach(function(f) {
    if (!f.geometry) return;
    var type = f.geometry.type;
    if (type === 'LineString' || type === 'MultiLineString') {
      hasPolyline = true;
    } else if (type === 'Polygon' || type === 'MultiPolygon') {
      hasPolygon = true;
    }
  });
  
  // Sembunyikan fill controls jika pure polyline
  var fillColorRow = document.querySelector('#styleFillColor').closest('.row');
  if (hasPolyline && !hasPolygon) {
    if (fillColorRow) fillColorRow.style.display = 'none';
    console.log('Hide fill controls for polyline');
  } else {
    if (fillColorRow) fillColorRow.style.display = 'flex';
  }
  
  // Pastikan offsetX dan offsetY ada (untuk backward compatibility)
  if (typeof meta.labelSettings.offsetX === 'undefined') {
    meta.labelSettings.offsetX = 0;
    meta.labelSettings.offsetY = 0;
  }
  
  // Update labels on map
  updateMapLabels(id);
}

// Fungsi helper untuk update statistics di properties panel
function updatePropertiesStats(id) {
  var meta = uploadedFiles[id];
  if (!meta) return;
  
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) {
      len += turf.length(f, {units:'meters'}) * 1000;
    }
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) {
      area += turf.area(f);
    }
  });
  
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';
}

// Tambahkan setelah fungsi openProperties (sekitar baris 230)

// Fungsi untuk membuat/update label di peta
function updateMapLabels(id) {
  var meta = uploadedFiles[id];
  if (!meta || !meta.labelSettings.show) {
    // Hapus label jika ada
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) {
        map.removeLayer(layer);
      });
      labelLayers[id] = [];
    }
    return;
  }

  // Hapus label lama
  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) {
      map.removeLayer(layer);
    });
  }
  labelLayers[id] = [];

  var gj = meta.group.toGeoJSON();
  gj.features.forEach(function(f, featureIdx) {
    if (!f.geometry || f.geometry.type !== 'Polygon') return;
    
    var centroid = turf.centroid(f);
    var area = turf.area(f);
    var areaHa = (area / 10000).toFixed(2);
    
    // Gunakan offset jika ada (dalam derajat geografis)
    var offsetX = meta.labelSettings.offsetX || 0;
    var offsetY = meta.labelSettings.offsetY || 0;
    var labelLat = centroid.geometry.coordinates[1] + offsetY;
    var labelLng = centroid.geometry.coordinates[0] + offsetX;
    
    var labelHtml = '<div style="' +
      'background:rgba(255,255,255,0.8);' +
      'padding:4px 8px;' +
      'border:1px solid #000;' +
      'border-radius:4px;' +
      'text-align:center;' +
      'white-space:nowrap;' +
      'font-weight:600;' +
      'color:' + meta.labelSettings.textColor + ';' +
      'font-size:' + meta.labelSettings.textSize + 'px;' +
      'cursor:move;' +
      '">' +
      meta.labelSettings.blockName + '<br>' +
      areaHa + ' Ha' +
      '</div>';
    
    var labelMarker = L.marker(
      [labelLat, labelLng],
      {
        icon: L.divIcon({
          className: 'label-marker',
          html: labelHtml,
          iconSize: null,
          iconAnchor: [0, 0]
        }),
        draggable: true
      }
    );
    
    // Event saat label di-drag
    labelMarker.on('dragend', function(e) {
      var newLatLng = e.target.getLatLng();
      var originalCentroid = centroid.geometry.coordinates;
      
      // Hitung offset baru dalam derajat
      var newOffsetX = newLatLng.lng - originalCentroid[0];
      var newOffsetY = newLatLng.lat - originalCentroid[1];
      
      // Simpan offset
      meta.labelSettings.offsetX = newOffsetX;
      meta.labelSettings.offsetY = newOffsetY;
      
      console.log('Label moved. New offset:', newOffsetX, newOffsetY);
    });
    
    labelMarker.addTo(map);
    labelLayers[id].push(labelMarker);
  });
}

// Fungsi untuk membersihkan label yang tidak ada layer-nya
function cleanupOrphanLabels() {
  Object.keys(labelLayers).forEach(function(id) {
    var meta = uploadedFiles[id];
    
    // Jika file sudah tidak ada, hapus labelnya
    if (!meta) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) {
          map.removeLayer(layer);
        });
        delete labelLayers[id];
      }
      return;
    }
    
    // Jika group kosong (semua layer dihapus), hapus label
    var hasLayers = false;
    meta.group.eachLayer(function() { hasLayers = true; });
    
    if (!hasLayers) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) {
          map.removeLayer(layer);
        });
        labelLayers[id] = [];
      }
    }
  });
}

function closeProperties(){ lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

// style controls live display
el('#styleStrokeWidth').oninput = function(){ el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function(){ el('#fillOpacityVal').innerText = this.value; };

// Tambahkan setelah baris el('#styleFillOpacity').oninput

// Label controls live display
el('#labelTextSize').oninput = function(){ el('#labelSizeVal').innerText = this.value; };

// Reset label position
el('#resetLabelPosition').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.labelSettings.offsetX = 0;
  meta.labelSettings.offsetY = 0;
  updateMapLabels(lastSelectedId);
  alert('Posisi label direset ke tengah polygon.');
};

// apply ALL (style + label) to lastSelectedId
// apply ALL (nama + style + label) to lastSelectedId
el('#applyStyle').onclick = function(){
  if(!lastSelectedId) return alert('Pilih layer dulu.');
  var meta = uploadedFiles[lastSelectedId];
  
  // ===== APPLY NAMA LAYER =====
  var newName = el('#propName').value.trim() || meta.name;
  meta.name = newName;
  
  // Update nama di sidebar card
  var card = document.getElementById('file-'+lastSelectedId);
  if(card) card.querySelector('.file-title').innerText = newName;
  
  // ===== APPLY STYLE =====
  meta.color = el('#styleStrokeColor').value;
  meta.weight = parseInt(el('#styleStrokeWidth').value);
  meta.fillColor = el('#styleFillColor').value;
  meta.fillOpacity = parseFloat(el('#styleFillOpacity').value);
  meta.dashArray = el('#styleDash').value || null;
  meta.markerSymbol = el('#styleMarker').value || 'circle';

  // apply styles to each sublayer
  meta.group.eachLayer(function(layer){
      if(layer.setStyle){
        // CEK: Apakah ini Polyline atau Polygon?
        var geoJsonLayer = layer.toGeoJSON();
        var geomType = geoJsonLayer.geometry ? geoJsonLayer.geometry.type : null;
        
        if (geomType === 'LineString' || geomType === 'MultiLineString') {
          // POLYLINE: Hanya set color, weight, dashArray (TIDAK ADA fill)
          layer.setStyle({ 
            color: meta.color, 
            weight: meta.weight, 
            dashArray: meta.dashArray 
          });
          console.log('Applied POLYLINE style:', meta.color, meta.weight);
        } else {
          // POLYGON: Set semua termasuk fill
          layer.setStyle({ 
            color: meta.color, 
            weight: meta.weight, 
            dashArray: meta.dashArray, 
            fillColor: meta.fillColor, 
            fillOpacity: meta.fillOpacity 
          });
          console.log('Applied POLYGON style:', meta.color, meta.fillColor);
        }
      }
      // for markers drawn as CircleMarker
      if(layer.setRadius){
        layer.setStyle({ color: meta.color, fillColor: meta.fillColor });
      }
  });
  
  // ===== APPLY LABEL =====
  // Preserve offset jika sudah ada
  var existingOffsetX = meta.labelSettings.offsetX || 0;
  var existingOffsetY = meta.labelSettings.offsetY || 0;
  
  meta.labelSettings = {
    show: el('#labelShow').checked,
    blockName: newName.replace('.gpx', ''), // AUTO dari nama layer yang baru
    textColor: el('#labelTextColor').value,
    textSize: parseInt(el('#labelTextSize').value),
    offsetX: existingOffsetX,
    offsetY: existingOffsetY
  };
  
  // Update labels on map
  updateMapLabels(lastSelectedId);
  
  // ===== FORCE REFRESH LAYER DI PETA =====
  meta.group.eachLayer(function(layer){
    // Remove dan re-add layer untuk force refresh
    if (map.hasLayer(layer)) {
      layer.redraw ? layer.redraw() : null; // Untuk path layers
    }
  });
  
  alert('Semua perubahan (nama, style, label) diterapkan!');

  console.log('Style applied to layer:', {
      id: lastSelectedId,
      name: meta.name,
      color: meta.color,
      fillColor: meta.fillColor,
      fillOpacity: meta.fillOpacity
  });
};

// revert ALL (style + label) to defaults
el('#revertStyle').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  
  // ===== RESET STYLE =====
  meta.color = '#000000';
  meta.weight = 3;
  meta.fillColor = '#ee00ff';
  meta.fillOpacity = 0.4;
  meta.dashArray = null;
  meta.markerSymbol = 'circle';
  
  // ===== RESET LABEL =====
  meta.labelSettings = {
    show: true,
    blockName: meta.name.replace('.gpx', ''),
    textColor: '#000000',
    textSize: 12,
    offsetX: meta.labelSettings.offsetX || 0,  // Keep position
    offsetY: meta.labelSettings.offsetY || 0
  };
  
  // Refresh properties panel
  openProperties(lastSelectedId);
  
  // Apply changes
  el('#applyStyle').click();
};

// Export buttons
el('#exportGeojson').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    
    // ===== TAMBAHKAN METADATA KE SETIAP FEATURE =====
    gj.features.forEach(function(feature) {
        if (!feature.properties) feature.properties = {};
        
        // Simpan metadata layer
        feature.properties._layerName = meta.name;
        feature.properties._includeInTotal = meta.includeInTotal;
        
        // Simpan style settings
        feature.properties._style = {
            color: meta.color,
            weight: meta.weight,
            fillColor: meta.fillColor,
            fillOpacity: meta.fillOpacity,
            dashArray: meta.dashArray,
            markerSymbol: meta.markerSymbol
        };
        
        // Simpan label settings
        feature.properties._label = {
            show: meta.labelSettings.show,
            blockName: meta.labelSettings.blockName,
            textColor: meta.labelSettings.textColor,
            textSize: meta.labelSettings.textSize,
            offsetX: meta.labelSettings.offsetX,
            offsetY: meta.labelSettings.offsetY
        };

        // ===== SIMPAN LUAS MANUAL (jika ada) =====
        if (meta.manualArea && meta.manualArea > 0) {
            feature.properties._manualArea = meta.manualArea;
        }
    });
    
    var blob = new Blob([JSON.stringify(gj, null, 2)], {type:'application/json'}); 
    saveAs(blob, (meta.name||'layer') + '.geojson');  
};
el('#exportGpx').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    var gpx = geojsonToGpx(gj, meta.name, meta); // ← TAMBAHKAN metadata
    saveAs(new Blob([gpx],{type:'application/gpx+xml'}), (meta.name||'layer') + '.gpx'); 
};
el('#exportKml').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    
    // ===== TAMBAHKAN METADATA KE PROPERTIES (tokml akan convert ke ExtendedData) =====
    gj.features.forEach(function(feature) {
        if (!feature.properties) feature.properties = {};
        
        // Metadata layer
        feature.properties.LayerName = meta.name;
        feature.properties.IncludeInTotal = meta.includeInTotal ? 'Yes' : 'No';
        
        // Style settings
        feature.properties.StrokeColor = meta.color;
        feature.properties.StrokeWeight = meta.weight;
        feature.properties.FillColor = meta.fillColor;
        feature.properties.FillOpacity = meta.fillOpacity;
        feature.properties.DashArray = meta.dashArray || '';
        
        // Label settings
        feature.properties.LabelShow = meta.labelSettings.show ? 'Yes' : 'No';
        feature.properties.LabelBlockName = meta.labelSettings.blockName;
        feature.properties.LabelTextColor = meta.labelSettings.textColor;
        feature.properties.LabelTextSize = meta.labelSettings.textSize;

        // ===== SIMPAN LUAS MANUAL (jika ada) =====
        if (meta.manualArea && meta.manualArea > 0) {
            feature.properties.ManualArea = meta.manualArea;
        }
        
        // Simpan marker symbol
        feature.properties.MarkerSymbol = meta.markerSymbol || 'circle';
        
        // Simpan label offset
        feature.properties.LabelOffsetX = meta.labelSettings.offsetX || 0;
        feature.properties.LabelOffsetY = meta.labelSettings.offsetY || 0;
    });
    
    var kml = tokml(gj); 
    saveAs(new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}), (meta.name||'layer') + '.kml'); 
};
el('#deleteLayer').onclick = function(){ if(!lastSelectedId) return deleteFile(lastSelectedId); };

// export all action from card (opens properties then triggers export dialog)
function exportAllFor(id){
  openProperties(id);
  // user can click desired export button
}

// ===== FUNGSI BARU: Parse metadata dari GPX extensions =====
function parseGpxMetadata(dom) {
  try {
    // Cari <extensions> di dalam <metadata>
    var metadataEl = dom.querySelector('metadata extensions');
    if (!metadataEl) {
      console.log('No metadata extensions found in GPX');
      return null;
    }
    
    // Helper function untuk get text dari element
    function getTagValue(tagName, defaultValue) {
      var el = metadataEl.querySelector(tagName);
      return el ? el.textContent.trim() : defaultValue;
    }
    
    // Helper function untuk get boolean
    function getBoolValue(tagName, defaultValue) {
      var val = getTagValue(tagName, '');
      if (val === 'true') return true;
      if (val === 'false') return false;
      return defaultValue;
    }
    
    // Helper function untuk get number
    function getNumValue(tagName, defaultValue) {
      var val = getTagValue(tagName, '');
      var num = parseFloat(val);
      return isNaN(num) ? defaultValue : num;
    }
    
    // Parse semua metadata
    var metadata = {
      name: getTagValue('layerName', null),
      includeInTotal: getBoolValue('includeInTotal', true),
      manualArea: getNumValue('manualArea', undefined),
      
      // Style
      color: getTagValue('color', '#0077ff'),
      weight: getNumValue('weight', 3),
      fillColor: getTagValue('fillColor', '#ee00ff'),
      fillOpacity: getNumValue('fillOpacity', 0.4),
      dashArray: getTagValue('dashArray', null) || null,
      markerSymbol: getTagValue('markerSymbol', 'circle'),
      
      // Label
      labelSettings: {
        show: getBoolValue('show', true),
        blockName: getTagValue('blockName', ''),
        textColor: getTagValue('textColor', '#000000'),
        textSize: getNumValue('textSize', 12),
        offsetX: getNumValue('offsetX', 0),
        offsetY: getNumValue('offsetY', 0)
      }
    };
    
    // Validasi: Jika tidak ada data penting, return null
    if (!metadata.name && !metadata.color) {
      return null;
    }
    
    console.log('Successfully parsed GPX metadata:', metadata);
    return metadata;
    
  } catch (error) {
    console.error('Error parsing GPX metadata:', error);
    return null;
  }
}

el('#btnUpload').onclick = function(){
  var fi = el('#gpxFile');
  if(!fi.files || fi.files.length === 0) return alert('Pilih file GPX.');

  var files = Array.from(fi.files);
  var totalFiles = files.length;
  var processedFiles = 0;
  var allBounds = [];

  // Tampilkan progress
  var progressDiv = el('#uploadProgress');
  var progressText = el('#progressText');
  if(progressDiv) {
    progressDiv.style.display = 'block';
    progressText.innerText = '0/' + totalFiles;
  }

  console.log('Mulai upload ' + totalFiles + ' file...');

  files.forEach(function(file, index) {
    var reader = new FileReader();

    reader.onload = function(){
      try {
        var dom = new DOMParser().parseFromString(reader.result, 'text/xml');
        var geojson = toGeoJSON.gpx(dom);
        geojson = convertLineToPolygonGeoJSON(geojson);
    
        var id = Date.now() + '-' + index + '-' + Math.floor(Math.random()*1000);
    
        // ===== PARSE METADATA DARI GPX (jika ada) =====
        var savedMetadata = parseGpxMetadata(dom);
        
        // ===== DETEKSI GEOMETRY TYPE =====
        var hasPolyline = false;
        var hasPolygon = false;
        
        geojson.features.forEach(function(f) {
          if (!f.geometry) return;
          var type = f.geometry.type;
          if (type === 'LineString' || type === 'MultiLineString') {
            hasPolyline = true;
          } else if (type === 'Polygon' || type === 'MultiPolygon') {
            hasPolygon = true;
          }
        });
        
        // ===== SET METADATA: PRIORITASKAN SAVED, FALLBACK KE DEFAULT =====
        var metaDefaults;
        
        if (savedMetadata) {
          // ===== ADA METADATA TERSIMPAN: GUNAKAN METADATA LAMA =====
          console.log('Using saved metadata from GPX:', savedMetadata);
          metaDefaults = savedMetadata;
        } else {
          // ===== TIDAK ADA METADATA: GUNAKAN DEFAULT (GPX MENTAH) =====
          console.log('No saved metadata, using defaults');
          
          if (hasPolyline && !hasPolygon) {
            // Pure polyline file → gunakan warna polygon (pink) untuk polyline
            metaDefaults = {
              color: '#ee00ff',
              weight: 3,
              fillColor: '#ee00ff',
              fillOpacity: 0.4,
              dashArray: null,
              markerSymbol: 'circle'
            };
          } else {
            // File berisi polygon atau campuran → gunakan warna default normal
            metaDefaults = {
              color: '#000000',
              weight: 3,
              fillColor: '#ee00ff',
              fillOpacity: 0.4,
              dashArray: null,
              markerSymbol: 'circle'
            };
          }
        }
        
        console.log('Using metadata:', metaDefaults);
        
        var group = createGroupFromGeoJSON(geojson, metaDefaults, id);
        var bounds = group.getBounds();
    
        uploadedFiles[id] = {
          name: savedMetadata ? savedMetadata.name : file.name,
          group: group,
          bounds: bounds,
          color: metaDefaults.color,
          weight: metaDefaults.weight,
          fillColor: metaDefaults.fillColor,
          fillOpacity: metaDefaults.fillOpacity,
          dashArray: metaDefaults.dashArray,
          markerSymbol: metaDefaults.markerSymbol,
          labelSettings: savedMetadata ? savedMetadata.labelSettings : {
            show: true,
            blockName: file.name.replace('.gpx', ''),
            textColor: '#000000',
            textSize: 12,
            offsetX: 0,
            offsetY: 0
          },
          includeInTotal: savedMetadata ? savedMetadata.includeInTotal : true,
          manualArea: savedMetadata ? savedMetadata.manualArea : undefined  // ← RESTORE LUAS MANUAL
        };

        group.eachLayer(function(l){
          map.addLayer(l);
          editableLayers.addLayer(l);
        });

        addFileCard(id, {
          name: file.name,
          summary: (bounds && bounds.isValid() ? "Bounds available" : "No bounds")
        });

        if(bounds && bounds.isValid()) {
          allBounds.push(bounds);
        }

        processedFiles++;
        
        // Update progress
        if(progressText) {
          progressText.innerText = processedFiles + '/' + totalFiles;
        }
        
        console.log('File ' + processedFiles + '/' + totalFiles + ' berhasil: ' + file.name);

        if(processedFiles === totalFiles) {
          if(allBounds.length > 0) {
            var combinedBounds = allBounds[0];
            for(var i = 1; i < allBounds.length; i++) {
              combinedBounds.extend(allBounds[i]);
            }
            map.fitBounds(combinedBounds);
          }
          
          // Sembunyikan progress
          if(progressDiv) {
            setTimeout(function() {
              progressDiv.style.display = 'none';
            }, 1000);
          }
          
          alert('Berhasil upload ' + totalFiles + ' file!');
          fi.value = '';
        }

      } catch(error) {
        console.error('Error processing file ' + file.name + ':', error);
        processedFiles++;
        
        if(progressText) {
          progressText.innerText = processedFiles + '/' + totalFiles;
        }
        
        if(processedFiles === totalFiles) {
          if(progressDiv) progressDiv.style.display = 'none';
          alert('Upload selesai dengan beberapa error. Cek console.');
          fi.value = '';
        }
      }
    };

    reader.onerror = function() {
      console.error('Error reading file: ' + file.name);
      processedFiles++;
      
      if(progressText) {
        progressText.innerText = processedFiles + '/' + totalFiles;
      }
      
      if(processedFiles === totalFiles) {
        if(progressDiv) progressDiv.style.display = 'none';
        alert('Upload selesai dengan beberapa error. Cek console.');
        fi.value = '';
      }
    };

    reader.readAsText(file);
  });
};

// close properties if click outside
map.on('click', function(){ /* keep panel open to edit; optionally close */ });

// Optional: keyboard Esc closes props
document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ closeProperties(); } });

function convertLineToPolygonGeoJSON(gj) {
    if (!gj || !gj.features) return gj;

    var newFeatures = [];

    gj.features.forEach(function (f) {
        if (!f.geometry) return;

        // ===== BIARKAN LINESTRING TETAP LINESTRING =====
        // Hanya konversi ke Polygon jika koordinat awal == koordinat akhir (closed line)
        if (f.geometry.type === "LineString") {
            var coords = f.geometry.coordinates;

            if (coords.length >= 4) { // Minimal 4 titik untuk polygon valid
                var firstPoint = coords[0];
                var lastPoint = coords[coords.length - 1];
                
                // CEK: Apakah LineString ini CLOSED (ujung bertemu)?
                var isClosed = (
                    Math.abs(firstPoint[0] - lastPoint[0]) < 0.000001 && 
                    Math.abs(firstPoint[1] - lastPoint[1]) < 0.000001
                );
                
                if (isClosed) {
                    // Jika closed → jadikan Polygon
                    newFeatures.push({
                        type: "Feature",
                        properties: f.properties || {},
                        geometry: {
                            type: "Polygon",
                            coordinates: [coords]
                        }
                    });
                } else {
                    // Jika NOT closed → TETAP LineString
                    newFeatures.push(f);
                }
            } else {
                // Kurang dari 4 titik → tetap LineString
                newFeatures.push(f);
            }
        } else {
            // Bukan LineString → langsung push
            newFeatures.push(f);
        }
    });

    return {
        type: "FeatureCollection",
        features: newFeatures
    };
}

// Fungsi untuk restore metadata dari GeoJSON yang di-import
function restoreMetadataFromGeoJSON(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) {
        return null;
    }
    
    // Ambil metadata dari feature pertama
    const firstFeature = geojson.features[0];
    const props = firstFeature.properties || {};
    
    if (props._style && props._label) {
        return {
            name: props._layerName || 'Imported Layer',
            includeInTotal: props._includeInTotal !== false,
            style: props._style,
            label: props._label
        };
    }
    
    return null;
}

// ===== TAMBAHKAN DI AKHIR app.js (sebelum // End of app.js) =====

// Variable untuk menyimpan judul PDF
var pdfSettings = {
  title: "PETA AREAL KEBUN",
  subtitle: ""
};

// Event handler untuk tombol Print PDF
document.getElementById("btnPrintPdf").onclick = function() {
  // Cek apakah ada data
  const gj = editableLayers.toGeoJSON();
  if (!gj || !gj.features || gj.features.length === 0) {
    alert("Tidak ada data untuk dicetak.");
    return;
  }
  
  // Tampilkan modal
  showPdfModal();
};

// Fungsi untuk menampilkan modal
function showPdfModal() {
  const modal = document.getElementById('pdfModal');
  const titleInput = document.getElementById('pdfTitle');
  const subtitleInput = document.getElementById('pdfSubtitle');
  
  // Set nilai default (title wajib, subtitle kosong)
  titleInput.value = pdfSettings.title || "PETA AREAL KEBUN";
  subtitleInput.value = pdfSettings.subtitle || "";
  
  // ===== GENERATE INPUT LUAS PER BLOK =====
  generateAreaInputs();
  
  // Tampilkan modal
  modal.style.display = 'flex';
  
  // Focus ke input pertama
  setTimeout(() => titleInput.focus(), 100);
}

// ===== FUNGSI BARU: Generate input luas untuk setiap file yang dicentang =====
function generateAreaInputs() {
  const container = document.getElementById('areaInputsContainer');
  container.innerHTML = ''; // Clear existing inputs
  
  // Filter hanya file yang dicentang
  Object.keys(uploadedFiles).forEach(id => {
    const card = document.getElementById('file-' + id);
    if (!card) return;
    
    const checkbox = card.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return; // Skip jika tidak dicentang
    
    const meta = uploadedFiles[id];
    
    // Hitung luas dari GPS
    const layerGj = meta.group.toGeoJSON();
    let gpsArea = 0;
    layerGj.features.forEach(f => {
      if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
        gpsArea += turf.area(f);
      }
    });
    const gpsAreaHa = (gpsArea / 10000).toFixed(2);
    
    // Ambil luas manual jika sudah ada (dari input sebelumnya)
    const manualArea = meta.manualArea || '';
    
    // Buat row input
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:10px; align-items:center; margin-bottom:8px; padding:8px; background:white; border-radius:4px; border:1px solid #ddd;';
    
    // Nama blok
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = 'flex:1; font-size:13px; font-weight:600; color:#333;';
    nameLabel.innerText = meta.name.replace('.gpx', '');
    
    // Input luas manual
    const areaInput = document.createElement('input');
    areaInput.type = 'number';
    areaInput.step = '0.01';
    areaInput.placeholder = gpsAreaHa + ' Ha (GPS)';
    areaInput.value = manualArea;
    areaInput.id = 'manualArea-' + id;
    areaInput.style.cssText = 'width:120px; padding:6px; font-size:13px; border:1px solid #ccc; border-radius:4px; text-align:right;';
    
    // Label "Ha"
    const haLabel = document.createElement('span');
    haLabel.innerText = 'Ha';
    haLabel.style.cssText = 'font-size:13px; color:#666;';
    
    // Info GPS area (kecil)
    const gpsInfo = document.createElement('div');
    gpsInfo.style.cssText = 'font-size:11px; color:#999; width:90px; text-align:right;';
    gpsInfo.innerText = 'GPS: ' + gpsAreaHa + ' Ha';
    
    row.appendChild(nameLabel);
    row.appendChild(areaInput);
    row.appendChild(haLabel);
    row.appendChild(gpsInfo);
    
    container.appendChild(row);
  });
  
  // Jika tidak ada file yang dicentang
  if (container.children.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center; padding:20px; color:#999; font-size:13px;';
    emptyMsg.innerText = 'Tidak ada polygon yang dicentang untuk dicetak.';
    container.appendChild(emptyMsg);
  }
}

// ===== FUNGSI BARU: Auto fill luas dari GPS =====
document.getElementById('btnAutoFillAreas').onclick = function() {
  Object.keys(uploadedFiles).forEach(id => {
    const card = document.getElementById('file-' + id);
    if (!card) return;
    
    const checkbox = card.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;
    
    const meta = uploadedFiles[id];
    const input = document.getElementById('manualArea-' + id);
    if (!input) return;
    
    // Hitung luas dari GPS
    const layerGj = meta.group.toGeoJSON();
    let gpsArea = 0;
    layerGj.features.forEach(f => {
      if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
        gpsArea += turf.area(f);
      }
    });
    const gpsAreaHa = (gpsArea / 10000).toFixed(2);
    
    // Set nilai input
    input.value = gpsAreaHa;
  });
  
  alert('Luas GPS telah diisi otomatis ke semua input!');
};

// Fungsi untuk menyembunyikan modal
function hidePdfModal() {
  const modal = document.getElementById('pdfModal');
  modal.style.display = 'none';
}

// Event handler untuk tombol Batal
document.getElementById('btnCancelPdf').onclick = function() {
  hidePdfModal();
};

// Event handler untuk tombol Cetak PDF
document.getElementById('btnConfirmPdf').onclick = function() {
  // Ambil nilai dari input
  const titleInput = document.getElementById('pdfTitle');
  const subtitleInput = document.getElementById('pdfSubtitle');
  
  // VALIDASI: Title wajib diisi
  const titleValue = titleInput.value.trim();
  if (!titleValue || titleValue.length === 0) {
    alert('Title harus diisi!');
    titleInput.focus();
    return; // Stop execution
  }
  
  pdfSettings.title = titleValue;
  pdfSettings.subtitle = subtitleInput.value.trim();
  
  // ===== SIMPAN LUAS MANUAL KE METADATA =====
  Object.keys(uploadedFiles).forEach(id => {
    const input = document.getElementById('manualArea-' + id);
    if (input) {
      const manualValue = input.value.trim();
      if (manualValue && manualValue.length > 0 && !isNaN(parseFloat(manualValue))) {
        uploadedFiles[id].manualArea = parseFloat(manualValue);
      } else {
        // Kosongkan jika input kosong (gunakan GPS)
        delete uploadedFiles[id].manualArea;
      }
    }
  });
  
  // Sembunyikan modal
  hidePdfModal();
  
  // Mulai generate PDF
  exportPdfFromLayers();
};

// Event handler untuk Enter key di input
// Auto UPPERCASE untuk Title
document.getElementById('pdfTitle').addEventListener('input', function(e) {
  this.value = this.value.toUpperCase();
});

document.getElementById('pdfTitle').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    document.getElementById('pdfSubtitle').focus();
  }
});

// Auto UPPERCASE untuk Subtitle
document.getElementById('pdfSubtitle').addEventListener('input', function(e) {
  this.value = this.value.toUpperCase();
});

document.getElementById('pdfSubtitle').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    document.getElementById('btnConfirmPdf').click();
  }
});

// Event handler untuk Escape key (tutup modal)
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('pdfModal');
    if (modal.style.display === 'flex') {
      hidePdfModal();
    }
  }
});

// Event handler untuk klik di luar modal (tutup modal)
document.getElementById('pdfModal').addEventListener('click', function(e) {
  if (e.target === this) {
    hidePdfModal();
  }
});

async function exportPdfFromLayers() {
    const { PDFDocument, rgb } = PDFLib;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]); // A4 landscape

    // ===== FILTER HANYA FILE YANG DICENTANG =====
    const visibleFiles = {};
    const allFeatures = [];
    
    Object.keys(uploadedFiles).forEach(id => {
        const card = document.getElementById('file-' + id);
        if (!card) return;
        
        const checkbox = card.querySelector('input[type="checkbox"]');
        
        // Hanya proses jika checkbox dicentang
        if (checkbox && checkbox.checked) {
            visibleFiles[id] = uploadedFiles[id];
            
            // Ambil semua features dari file ini
            const layerGj = uploadedFiles[id].group.toGeoJSON();
            if (layerGj && layerGj.features) {
                allFeatures.push(...layerGj.features);
            }
        }
    });
    
    // Cek apakah ada data yang visible
    if (allFeatures.length === 0) {
        alert("Tidak ada data yang dicentang untuk dicetak.");
        return;
    }
    
    // Buat GeoJSON gabungan dari file yang visible
    const gj = {
        type: "FeatureCollection",
        features: allFeatures
    };

    // --------- Hitung bounding box ---------
    const bbox = turf.bbox(gj);
    const [minX, minY, maxX, maxY] = bbox;

    // Area peta
    const mapWidth = 500;
    const mapHeight = 450;
    const mapOffsetX = 50;
    const mapOffsetY = 80;

    function project([lng, lat]) {
        const dx = maxX - minX;
        const dy = maxY - minY;
        const scale = Math.min(mapWidth / dx, mapHeight / dy) * 0.9;
        const centerX = mapOffsetX + mapWidth / 2;
        const centerY = mapOffsetY + mapHeight / 2;
        const x = centerX + (lng - (minX + maxX) / 2) * scale;
        const y = centerY + (lat - (minY + maxY) / 2) * scale;
        return [x, y];
    }

    // --------- Border Peta ---------
    page.drawRectangle({
        x: mapOffsetX,
        y: mapOffsetY,
        width: mapWidth,
        height: mapHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 2
    });

    // --------- Grid Koordinat ---------
    const gridColor = rgb(0.7, 0.7, 0.7);
    const numGridLines = 4;
    
    // Vertical grid lines - LANGSUNG KE BORDER
    for (let i = 0; i <= numGridLines; i++) {
        const lng = minX + (maxX - minX) * (i / numGridLines);
        const [x] = project([lng, minY]); // Hanya ambil x position
        
        // Gambar garis dari BOTTOM BORDER ke TOP BORDER
        page.drawLine({
            start: { x, y: mapOffsetY },  // Bottom border
            end: { x, y: mapOffsetY + mapHeight },  // Top border
            thickness: 0.5,
            color: gridColor,
            dashArray: [3, 3]
        });
        
        const lngLabel = lng.toFixed(4) + "°E";
        page.drawText(lngLabel, { x: x - 20, y: mapOffsetY - 15, size: 8, color: rgb(0, 0, 0) });
    }
    
    // Horizontal grid lines - LANGSUNG KE BORDER
    for (let i = 0; i <= numGridLines; i++) {
        const lat = minY + (maxY - minY) * (i / numGridLines);
        const [, y] = project([minX, lat]); // Hanya ambil y position
        
        // Gambar garis dari LEFT BORDER ke RIGHT BORDER
        page.drawLine({
            start: { x: mapOffsetX, y },  // Left border
            end: { x: mapOffsetX + mapWidth, y },  // Right border
            thickness: 0.5,
            color: gridColor,
            dashArray: [3, 3]
        });
        
        const latLabel = lat.toFixed(4) + "°N";
        page.drawText(latLabel, { x: mapOffsetX - 45, y: y - 3, size: 8, color: rgb(0, 0, 0) });
    }
    
    // --------- Helper Functions ---------
    
    // Helper: konversi hex color ke RGB
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 0.5, b: 1 };
    }
    
    // Helper: gambar garis dengan dash pattern
    function drawDashedLine(page, x1, y1, x2, y2, dashPattern, thickness, color) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        
        if (lineLength === 0) return;
        
        const unitX = dx / lineLength;
        const unitY = dy / lineLength;
        
        let currentPos = 0;
        let patternIndex = 0;
        let isDash = true;
        
        while (currentPos < lineLength) {
            const segmentLength = dashPattern[patternIndex % dashPattern.length];
            const endPos = Math.min(currentPos + segmentLength, lineLength);
            
            if (isDash) {
                const startX = x1 + unitX * currentPos;
                const startY = y1 + unitY * currentPos;
                const endX = x1 + unitX * endPos;
                const endY = y1 + unitY * endPos;
                
                page.drawLine({
                    start: { x: startX, y: startY },
                    end: { x: endX, y: endY },
                    thickness: thickness,
                    color: color,
                    opacity: 1
                });
            }
            
            currentPos = endPos;
            patternIndex++;
            isDash = !isDash;
        }
    }
    
    // --------- Gambar Polygon & Polyline ---------
    let totalArea = 0;
    
    // HANYA LOOP UNTUK FILE YANG VISIBLE (DICENTANG)
    Object.keys(visibleFiles).forEach(id => {
        const meta = visibleFiles[id];
        const layerGj = meta.group.toGeoJSON();
        
        const strokeRgb = hexToRgb(meta.color || '#0077ff');
        const fillRgb = hexToRgb(meta.fillColor || meta.color || '#0077ff');
        const strokeColor = rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b);
        const fillColor = rgb(fillRgb.r, fillRgb.g, fillRgb.b);
        const lineWidth = meta.weight || 3;
        const fillOpacity = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
        
        layerGj.features.forEach(f => {
            if (!f.geometry) return;
            const type = f.geometry.type;
        
            // ---- POLYGON ----
            if (type === "Polygon") {
                const area = turf.area(f);
                totalArea += area;
    
                f.geometry.coordinates.forEach((ring, ringIdx) => {
                    if (ringIdx !== 0) return;
                    
                    // Gambar fill
                    const allY = ring.map(c => project(c)[1]);
                    const minYPoly = Math.min(...allY);
                    const maxYPoly = Math.max(...allY);
                    
                    for(let fillY = minYPoly; fillY <= maxYPoly; fillY += 1) {
                        const intersections = [];
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            
                            if((y1 <= fillY && fillY <= y2) || (y2 <= fillY && fillY <= y1)) {
                                if(y2 !== y1) {
                                    const t = (fillY - y1) / (y2 - y1);
                                    const xInt = x1 + t * (x2 - x1);
                                    intersections.push(xInt);
                                }
                            }
                        }
                        
                        intersections.sort((a, b) => a - b);
                        for(let j = 0; j < intersections.length - 1; j += 2) {
                            if(intersections[j + 1] !== undefined) {
                                page.drawLine({
                                    start: { x: intersections[j], y: fillY },
                                    end: { x: intersections[j + 1], y: fillY },
                                    thickness: 1,
                                    color: fillColor,
                                    opacity: fillOpacity * 0.6
                                });
                            }
                        }
                    }
                    
                    // Gambar border dengan support dash pattern
                    const dashPattern = meta.dashArray || '';
                    const isDashed = dashPattern.length > 0;
    
                    if (isDashed) {
                        const dashValues = dashPattern.split(',').map(v => parseFloat(v.trim()));
                        
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            drawDashedLine(page, x1, y1, x2, y2, dashValues, lineWidth, strokeColor);
                        }
                        
                        const [xFirst, yFirst] = project(ring[0]);
                        const [xLast, yLast] = project(ring[ring.length - 1]);
                        drawDashedLine(page, xLast, yLast, xFirst, yFirst, dashValues, lineWidth, strokeColor);
                        
                    } else {
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            
                            page.drawLine({
                                start: { x: x1, y: y1 },
                                end: { x: x2, y: y2 },
                                thickness: lineWidth,
                                color: strokeColor,
                                opacity: 1
                            });
                        }
                        
                        const [xFirst, yFirst] = project(ring[0]);
                        const [xLast, yLast] = project(ring[ring.length - 1]);
                        page.drawLine({
                            start: { x: xLast, y: yLast },
                            end: { x: xFirst, y: yFirst },
                            thickness: lineWidth,
                            color: strokeColor,
                            opacity: 1
                        });
                    }
                    
                    // ===== LABEL DI DALAM POLYGON =====
                    if (meta.labelSettings && meta.labelSettings.show) {
                        const centroid = turf.centroid(f);
                        const offsetX = meta.labelSettings.offsetX || 0;
                        const offsetY = meta.labelSettings.offsetY || 0;
                        const labelCoords = [
                            centroid.geometry.coordinates[0] + offsetX,
                            centroid.geometry.coordinates[1] + offsetY
                        ];
                        const [centX, centY] = project(labelCoords);
                        
                        const blockName = meta.labelSettings.blockName || meta.name.replace('.gpx', '');
                        const labelTextColor = hexToRgb(meta.labelSettings.textColor || '#000000');
                        
                        // ===== UKURAN FONT LEBIH KECIL =====
                        const labelSize = 5;  // 
                        
                        // Hitung ukuran polygon di layar (pixel)
                        const polyBounds = turf.bbox(f);
                        const [polyMinX, polyMinY, polyMaxX, polyMaxY] = polyBounds;
                        const [pMinX, pMinY] = project([polyMinX, polyMinY]);
                        const [pMaxX, pMaxY] = project([polyMaxX, polyMaxY]);
                        const polyWidth = Math.abs(pMaxX - pMinX);
                        const polyHeight = Math.abs(pMaxY - pMinY);
                        const polySize = Math.min(polyWidth, polyHeight);
                        
                        // Skip polygon yang terlalu kecil
                        if (polySize < 15) {
                            console.log('Polygon terlalu kecil untuk label:', blockName);
                            return;
                        }
                        
                        const labelText = blockName;
                        const textWidth = labelText.length * (labelSize * 0.5);
                        const textHeight = labelSize * 1.4;
                        
                        // CEK: Apakah label muat di dalam polygon?
                        if (textWidth > polyWidth * 0.9 || textHeight > polyHeight * 0.9) {
                            console.log('Label terlalu besar untuk polygon:', blockName);
                            return;
                        }
                        
                        // Background kotak putih
                        page.drawRectangle({
                            x: centX - textWidth/2 - 3,
                            y: centY - textHeight/2,
                            width: textWidth + 6,
                            height: textHeight,
                            color: rgb(1, 1, 1),
                            opacity: 0.9
                        });
                        
                        // Border kotak
                        page.drawRectangle({
                            x: centX - textWidth/2 - 3,
                            y: centY - textHeight/2,
                            width: textWidth + 6,
                            height: textHeight,
                            borderColor: rgb(0, 0, 0),
                            borderWidth: 0.5
                        });
                        
                        // Teks nama blok (centered - dengan font lebih kecil)
                        page.drawText(labelText, {
                            x: centX - (textWidth / 2),
                            y: centY - (labelSize / 2),
                            size: labelSize,  // ← Menggunakan labelSize baru (5)
                            color: rgb(labelTextColor.r, labelTextColor.g, labelTextColor.b)
                        });
                    }
                });
            }
        
            // ---- LINESTRING ----
            else if (type === "LineString") {
                const dashPattern = meta.dashArray || '';
                const isDashed = dashPattern.length > 0;
                
                if (isDashed) {
                    const dashValues = dashPattern.split(',').map(v => parseFloat(v.trim()));
                    
                    for(let i = 0; i < f.geometry.coordinates.length - 1; i++){
                        const [x1, y1] = project(f.geometry.coordinates[i]);
                        const [x2, y2] = project(f.geometry.coordinates[i + 1]);
                        drawDashedLine(page, x1, y1, x2, y2, dashValues, lineWidth, strokeColor);
                    }
                } else {
                    for(let i = 0; i < f.geometry.coordinates.length - 1; i++){
                        const [x1, y1] = project(f.geometry.coordinates[i]);
                        const [x2, y2] = project(f.geometry.coordinates[i + 1]);
                        
                        page.drawLine({
                            start: { x: x1, y: y1 },
                            end: { x: x2, y: y2 },
                            thickness: lineWidth,
                            color: strokeColor,
                            opacity: 1
                        });
                    }
                }
            }
        });
    });
    
    // ========================================
    // SIDEBAR KANAN: Title, Kompas, Skala, Legenda
    // ========================================
    
    const sidebarX = 570;
    const sidebarWidth = 240;
    const centerX = sidebarX + (sidebarWidth / 2);
    
    // MULAI DARI POSISI YANG SAMA DENGAN TOP BORDER PETA
    let yPos = mapOffsetY + mapHeight; // Hapus pengurangan -15
    
    // ========== KOTAK 1: TITLE & SUBTITLE (CENTER) ==========
    const box1Top = yPos;
    
    // CEK: Apakah subtitle ada atau tidak
    const hasSubtitle = pdfSettings.subtitle && pdfSettings.subtitle.length > 0;
    
    if (hasSubtitle) {
        // ===== ADA SUBTITLE: Layout Normal =====
        yPos -= 18;
        
        // Title (centered horizontal, top position)
        const titleText = pdfSettings.title;
        const titleWidth = titleText.length * 8;
        page.drawText(titleText, { 
            x: centerX - (titleWidth / 2), 
            y: yPos, 
            size: 14, 
            color: rgb(0, 0, 0) 
        });
        
        yPos -= 20;
        
        // Subtitle (centered horizontal, below title)
        const subtitleWidth = pdfSettings.subtitle.length * 6;
        page.drawText(pdfSettings.subtitle, { 
            x: centerX - (subtitleWidth / 2), 
            y: yPos, 
            size: 10, 
            color: rgb(0.4, 0.4, 0.4) 
        });
        
        yPos -= 15;
        
    } else {
        // ===== TIDAK ADA SUBTITLE: Title di Tengah Vertikal =====
        
        // Tinggi kotak title (estimasi)
        const boxHeight = 50; // Tinggi kotak yang akan dibuat
        
        // Hitung posisi tengah vertikal kotak
        const titleY = yPos - (boxHeight / 2) + 7; // +7 untuk centering text baseline
        
        // Title (centered horizontal DAN vertical)
        const titleText = pdfSettings.title;
        const titleWidth = titleText.length * 8;
        page.drawText(titleText, { 
            x: centerX - (titleWidth / 2), 
            y: titleY, 
            size: 14, 
            color: rgb(0, 0, 0) 
        });
        
        // Sesuaikan yPos untuk bottom kotak
        yPos -= boxHeight;
    }
    
    const box1Bottom = yPos - 10;
    
    // ========== KOTAK 2: KOMPAS & SKALA (CENTER) ==========
    const box2Top = yPos;
    yPos -= 20;
    
    // KOMPAS (centered left)
    const compassCenterX = sidebarX + 60;
    const compassCenterY = yPos - 20;
    
    page.drawCircle({
        x: compassCenterX,
        y: compassCenterY,
        size: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY },
        end: { x: compassCenterX, y: compassCenterY + 16 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY + 16 },
        end: { x: compassCenterX - 5, y: compassCenterY + 11 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY + 16 },
        end: { x: compassCenterX + 5, y: compassCenterY + 11 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawText("U", { x: compassCenterX - 4, y: compassCenterY + 22, size: 11, color: rgb(0, 0, 0) });
    
    // SKALA (text only, centered)
    const scaleCenterX = sidebarX + 165;
    const scaleY = compassCenterY;
    
    // Hitung skala rasio
    const realDist = turf.distance([minX, minY], [maxX, minY], {units: 'meters'});
    const pixelDist = mapWidth;
    
    // Konversi ke cm
    const realDistCm = realDist * 100; // meter ke cm
    const pdfScaleCm = pixelDist * 2.54 / 72; // pixels ke cm (asumsi 72 DPI)
    
    // Hitung rasio skala (1 cm di peta = X cm di lapangan)
    let scaleRatio = Math.round(realDistCm / pdfScaleCm);
    
    // PEMBULATAN KE RIBUAN TERDEKAT
    // Jika >= 500 bulatkan ke atas, jika < 500 bulatkan ke bawah
    const remainder = scaleRatio % 1000;
    // PEMBULATAN KE RIBUAN TERDEKAT
    if (scaleRatio < 1000) {
        // Jika skala < 1000, tetap gunakan nilai asli tanpa pembulatan ribuan
        scaleRatio = Math.round(scaleRatio / 100) * 100; // Bulatkan ke ratusan
    } else {
        const remainder = scaleRatio % 1000;
        if (remainder >= 500) {
            scaleRatio = Math.ceil(scaleRatio / 1000) * 1000;
        } else {
            scaleRatio = Math.floor(scaleRatio / 1000) * 1000;
        }
    }
    
    // Format dengan pemisah ribuan
    const scaleText = "Skala 1 : " + scaleRatio.toLocaleString('id-ID');
    
    // Label SKALA (centered, line 1)
    const scaleTextWidth = scaleText.length * 5;
    page.drawText(scaleText, { 
        x: scaleCenterX - (scaleTextWidth / 2), 
        y: scaleY + 5, 
        size: 10, 
        color: rgb(0, 0, 0) 
    });
    
    yPos -= 55;
    
    const box2Bottom = yPos;
    page.drawRectangle({
        x: sidebarX,
        y: box2Bottom,
        width: sidebarWidth,
        height: box2Top - box2Bottom,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    yPos -= 15;
    
    // ========== KOTAK 3: KETERANGAN (CENTER HEADER) ==========
    const box3Top = yPos;
    yPos -= 15;
    
    // Header KETERANGAN (centered)
    const headerWidth = "KETERANGAN:".length * 6.5;
    page.drawText("KETERANGAN:", { x: centerX - headerWidth / 2, y: yPos, size: 11, color: rgb(0, 0, 0) });
    
    yPos -= 22;
    
    const fileIds = Object.keys(visibleFiles);
    const totalFiles = fileIds.length;
    const lineHeight = 13;
    const maxLegendItems = 16;
    const useDoubleColumn = totalFiles > maxLegendItems;
    const itemsPerColumn = useDoubleColumn ? Math.ceil(totalFiles / 2) : totalFiles;
    
    const legendStartY = yPos;
    const paddingX = 12;
    
    fileIds.forEach((id, index) => {
        const meta = uploadedFiles[id];
        
        let itemX = sidebarX + paddingX;
        let itemY = legendStartY - (index % itemsPerColumn) * lineHeight;
        
        if (useDoubleColumn && index >= itemsPerColumn) {
            itemX = sidebarX + paddingX + 118;
            itemY = legendStartY - ((index - itemsPerColumn) % itemsPerColumn) * lineHeight;
        }
        
        // ===== DETEKSI GEOMETRY TYPE =====
        const layerGj = meta.group.toGeoJSON();
        let hasPolyline = false;
        let hasPolygon = false;
        
        layerGj.features.forEach(f => {
            if (!f.geometry) return;
            const type = f.geometry.type;
            if (type === 'LineString' || type === 'MultiLineString') {
                hasPolyline = true;
            } else if (type === 'Polygon' || type === 'MultiPolygon') {
                hasPolygon = true;
            }
        });
        
        const strokeRgb = hexToRgb(meta.color || '#0077ff');
        const strokeColor = rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b);
        
        // ===== GAMBAR SYMBOL SESUAI TIPE =====
        if (hasPolyline && !hasPolygon) {
            // POLYLINE: Gambar GARIS horizontal
            const lineY = itemY - 3.5; // Tengah vertikal dari box (7px height / 2)
            
            // Cek apakah ada dash pattern
            const dashPattern = meta.dashArray || '';
            const isDashed = dashPattern.length > 0;
            
            if (isDashed) {
                // Gambar garis dashed (simplified untuk legenda)
                const dashLength = 3;
                const gapLength = 2;
                let currentX = itemX;
                const endX = itemX + 13;
                
                while (currentX < endX) {
                    const segmentEnd = Math.min(currentX + dashLength, endX);
                    page.drawLine({
                        start: { x: currentX, y: lineY },
                        end: { x: segmentEnd, y: lineY },
                        thickness: 2,
                        color: strokeColor,
                        opacity: 1
                    });
                    currentX = segmentEnd + gapLength;
                }
            } else {
                // Gambar garis solid
                page.drawLine({
                    start: { x: itemX, y: lineY },
                    end: { x: itemX + 13, y: lineY },
                    thickness: 2,
                    color: strokeColor,
                    opacity: 1
                });
            }
        } else {
            // POLYGON: Gambar KOTAK dengan fill
            const fillRgb = hexToRgb(meta.fillColor || meta.color || '#0077ff');
            const fillColor = rgb(fillRgb.r, fillRgb.g, fillRgb.b);
            
            page.drawRectangle({
                x: itemX,
                y: itemY - 7,
                width: 13,
                height: 7,
                color: fillColor,
                borderColor: strokeColor,
                borderWidth: 0.8,
                opacity: meta.fillOpacity || 0.4
            });
        }
        
        // ===== GUNAKAN LUAS MANUAL JIKA ADA, JIKA TIDAK GUNAKAN GPS =====
        let areaHa;
        
        if (meta.manualArea && meta.manualArea > 0) {
            // Gunakan luas manual
            areaHa = meta.manualArea.toFixed(2);
        } else {
            // Hitung dari GPS
            let layerArea = 0;
            layerGj.features.forEach(f => {
                if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                    layerArea += turf.area(f);
                }
            });
            areaHa = (layerArea / 10000).toFixed(2);
        }
        
        // Truncate name
        let displayName = meta.name.replace('.gpx', '');
        const maxChars = useDoubleColumn ? 10 : 18;
        if (displayName.length > maxChars) {
            displayName = displayName.substring(0, maxChars - 2) + '..';
        }
        
        // ===== TEXT LABEL: Tampilkan area hanya untuk polygon =====
        let labelText;
        if (hasPolyline && !hasPolygon) {
            // Polyline: Hanya nama (tanpa area)
            labelText = displayName;
        } else {
            // Polygon: Nama + area
            labelText = displayName + " - " + areaHa + " Ha";
        }
        
        const labelColor = meta.includeInTotal ? rgb(0, 0, 0) : rgb(0.5, 0.5, 0.5);
        
        page.drawText(labelText, { 
            x: itemX + 17, 
            y: itemY - 5, 
            size: 7,
            color: labelColor
        });
        
        // Tambahkan tanda * jika TIDAK dihitung
        if (!meta.includeInTotal) {
            page.drawText("*", { 
                x: itemX + 17 + (labelText.length * 7 * 0.4) + 2, 
                y: itemY - 5, 
                size: 9,
                color: rgb(0.7, 0, 0)
            });
        }
    });
    
    yPos = legendStartY - (itemsPerColumn * lineHeight) - 15;
    
    // ===== HITUNG TOTAL LUAS MENGGUNAKAN LUAS MANUAL (jika ada) =====
    let calculatedTotalArea = 0;
    
    Object.keys(visibleFiles).forEach(id => {
        const meta = uploadedFiles[id];
        
        // Hanya hitung jika includeInTotal = true
        if (meta.includeInTotal) {
            if (meta.manualArea && meta.manualArea > 0) {
                // Gunakan luas manual (sudah dalam Ha)
                calculatedTotalArea += meta.manualArea;
            } else {
                // Hitung dari GPS (convert ke Ha)
                const layerGj = meta.group.toGeoJSON();
                layerGj.features.forEach(f => {
                    if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                        calculatedTotalArea += turf.area(f) / 10000;
                    }
                });
            }
        }
    });
    
    // Total Luas (centered)
    const totalHa = calculatedTotalArea.toFixed(2);
    const totalText = "Total Luas: " + totalHa + " Ha";
    const totalWidth = totalText.length * 6;
    page.drawText(totalText, { 
        x: centerX - (totalWidth / 2), 
        y: yPos, 
        size: 10, 
        color: rgb(0, 0, 0)
    });
    
    yPos -= 15;
    
    const box3Bottom = yPos;
    page.drawRectangle({
        x: sidebarX,
        y: box3Bottom,
        width: sidebarWidth,
        height: box3Top - box3Bottom,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    // ========== FOOTER ==========
    // Keterangan tanda * (jika ada file yang tidak dihitung)
    const hasExcluded = Object.keys(visibleFiles).some(id => !uploadedFiles[id].includeInTotal);
    
    if (hasExcluded) {
        page.drawText("* Tidak dihitung dalam Total Luas", { 
            x: 50, 
            y: 35, 
            size: 7, 
            color: rgb(0.5, 0.5, 0.5) 
        });
    }
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID');
    page.drawText("Dicetak: " + dateStr, { 
        x: 50, 
        y: 20, 
        size: 8, 
        color: rgb(0.4, 0.4, 0.4) 
    });
  
    const pdfBytes = await pdfDoc.save();

    // Generate nama file dari title + subtitle
    let filename = "";
    
    if (pdfSettings.title) {
        filename += pdfSettings.title.replace(/ /g, '_');
    }
    
    if (pdfSettings.subtitle && pdfSettings.subtitle.length > 0) {
        if (filename.length > 0) filename += "_";
        filename += pdfSettings.subtitle.replace(/ /g, '_');
    }
    
    // Fallback jika kosong
    if (filename.length === 0) {
        filename = "PETA_AREAL";
    }
    
    // Tambahkan ekstensi .pdf
    filename += ".pdf";
    
    saveAs(new Blob([pdfBytes]), filename);
}

// End of app.js
