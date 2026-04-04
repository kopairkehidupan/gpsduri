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

satelliteLayer.addTo(map);

var baseMaps = {
  "OpenStreetMap": osmLayer,
  "Satellite": satelliteLayer,
  "Topographic": topoLayer,
  "CartoDB Light": cartoDBLight,
  "CartoDB Dark": cartoDBDark
};

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
    
    const id = 'drawn-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    drawnLayerCounters[layerType] = (drawnLayerCounters[layerType] || 0) + 1;
    
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
    
    const group = L.featureGroup();
    group.addLayer(layer);
    
    attachLayerClickEvent(layer, id);
    
    let bounds = null;
    if (layer.getBounds) {
        bounds = layer.getBounds();
    } else if (layer.getLatLng) {
        const latlng = layer.getLatLng();
        bounds = L.latLngBounds([latlng, latlng]);
    }
    
    const metaDefaults = {};
    
    if (layerType === 'polyline') {
        metaDefaults.color = '#ee00ff';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';
        metaDefaults.fillOpacity = 0.4;
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    } else if (layerType === 'polygon' || layerType === 'rectangle') {
        metaDefaults.color = '#000000';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';
        metaDefaults.fillOpacity = 0.4;
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    } else {
        metaDefaults.color = '#000000';
        metaDefaults.weight = 3;
        metaDefaults.fillColor = '#ee00ff';
        metaDefaults.fillOpacity = 0.8;
        metaDefaults.dashArray = null;
        metaDefaults.markerSymbol = 'circle';
    }
    
    uploadedFiles[id] = {
        name: defaultName,
        fileType: 'drawn',
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
        includeInTotal: true
    };
    
    if (layer.setStyle) {
        layer.setStyle({
            color: metaDefaults.color,
            weight: metaDefaults.weight,
            fillColor: metaDefaults.fillColor,
            fillOpacity: metaDefaults.fillOpacity,
            dashArray: metaDefaults.dashArray
        });
    }
    
    editableLayers.addLayer(layer);
    
    addFileCard(id, {
        name: defaultName,
        summary: layerType.charAt(0).toUpperCase() + layerType.slice(1) + ' (Drawn)',
        fileType: 'drawn'
    });
    
    if (layerType === 'polygon') {
        updateMapLabels(id);
    }
    
    setTimeout(function() {
        openRename(id);
    }, 300);
});

map.on(L.Draw.Event.EDITED, function(e) {
  var layers = e.layers;
  layers.eachLayer(function(editedLayer) {
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      meta.group.eachLayer(function(layer) {
        if (layer === editedLayer) found = true;
      });
      if (found) {
        attachLayerClickEvent(editedLayer, id);
        updateMapLabels(id);
        if (lastSelectedId === id) updatePropertiesStats(id);
      }
    });
  });
});

map.on(L.Draw.Event.DELETED, function(e) {
  var layers = e.layers;
  layers.eachLayer(function(deletedLayer) {
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      var layerToRemove = null;
      meta.group.eachLayer(function(layer) {
        if (layer === deletedLayer) { found = true; layerToRemove = layer; }
      });
      if (found && layerToRemove) {
        meta.group.removeLayer(layerToRemove);
        updateMapLabels(id);
        if (lastSelectedId === id) updatePropertiesStats(id);
      }
    });
  });
  cleanupOrphanLabels();
});

map.on('draw:editvertex', function(e) {
  Object.keys(uploadedFiles).forEach(function(id) {
    var meta = uploadedFiles[id];
    var found = false;
    meta.group.eachLayer(function(layer) {
      if (layer === e.layer) found = true;
    });
    if (found) {
      if (meta._updateTimeout) clearTimeout(meta._updateTimeout);
      meta._updateTimeout = setTimeout(function() {
        updateMapLabels(id);
        if (lastSelectedId === id) updatePropertiesStats(id);
      }, 100);
    }
  });
});

// --- State ---
var uploadedFiles = {};
var lastSelectedId = null;
var labelLayers = {};

var drawnLayerCounters = {
    polygon: 0, polyline: 0, rectangle: 0, marker: 0
};

// --- Helpers ---
function createGroupFromGeoJSON(geojson, styleMeta, fileId){
  styleMeta = styleMeta || {};
  var group = L.featureGroup();
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
          icon: L.divIcon({ className:'custom-marker', html:html, iconSize:[12,12], iconAnchor:[6,6] })
        });
      }
    }
  });

  base.eachLayer(function(layer){
    if (fileId) attachLayerClickEvent(layer, fileId);
    group.addLayer(layer);
  });

  return group;
}

function attachLayerClickEvent(layer, fileId) {
  layer.on('click', function(e) {
    L.DomEvent.stopPropagation(e);
    openProperties(fileId);
  });
}

function geojsonToGpx(geojson, name, metadata){
  var esc = function(s){ return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="MiniMapGIS" xmlns:miniarcgis="http://miniarcgis.local/gpx/1/0">\n';
  xml += '<name>' + esc(name||'export') + '</name>\n';
  
  if (metadata) {
    xml += '<metadata>\n<extensions>\n';
    xml += '  <miniarcgis:layerName>' + esc(metadata.name) + '</miniarcgis:layerName>\n';
    xml += '  <miniarcgis:includeInTotal>' + (metadata.includeInTotal ? 'true' : 'false') + '</miniarcgis:includeInTotal>\n';
    if (metadata.manualArea && metadata.manualArea > 0) {
      xml += '  <miniarcgis:manualArea>' + metadata.manualArea + '</miniarcgis:manualArea>\n';
    }
    xml += '  <miniarcgis:style>\n';
    xml += '    <miniarcgis:color>' + esc(metadata.color || '#0077ff') + '</miniarcgis:color>\n';
    xml += '    <miniarcgis:weight>' + (metadata.weight || 3) + '</miniarcgis:weight>\n';
    xml += '    <miniarcgis:fillColor>' + esc(metadata.fillColor || '#ee00ff') + '</miniarcgis:fillColor>\n';
    xml += '    <miniarcgis:fillOpacity>' + (metadata.fillOpacity || 0.4) + '</miniarcgis:fillOpacity>\n';
    xml += '    <miniarcgis:dashArray>' + esc(metadata.dashArray || '') + '</miniarcgis:dashArray>\n';
    xml += '    <miniarcgis:markerSymbol>' + esc(metadata.markerSymbol || 'circle') + '</miniarcgis:markerSymbol>\n';
    xml += '  </miniarcgis:style>\n';
    xml += '  <miniarcgis:label>\n';
    xml += '    <miniarcgis:show>' + (metadata.labelSettings.show ? 'true' : 'false') + '</miniarcgis:show>\n';
    xml += '    <miniarcgis:blockName>' + esc(metadata.labelSettings.blockName) + '</miniarcgis:blockName>\n';
    xml += '    <miniarcgis:textColor>' + esc(metadata.labelSettings.textColor) + '</miniarcgis:textColor>\n';
    xml += '    <miniarcgis:textSize>' + (metadata.labelSettings.textSize || 12) + '</miniarcgis:textSize>\n';
    xml += '    <miniarcgis:offsetX>' + (metadata.labelSettings.offsetX || 0) + '</miniarcgis:offsetX>\n';
    xml += '    <miniarcgis:offsetY>' + (metadata.labelSettings.offsetY || 0) + '</miniarcgis:offsetY>\n';
    xml += '  </miniarcgis:label>\n';
    xml += '</extensions>\n</metadata>\n';
  }

  geojson.features.forEach(function(f){
    var geom = f.geometry;
    if(!geom) return;
    if(geom.type === 'Point'){
      var c = geom.coordinates;
      xml += '<wpt lat="'+c[1]+'" lon="'+c[0]+'"><name>' + (esc(f.properties && f.properties.name || 'pt')) + '</name></wpt>\n';
    } else if(geom.type === 'LineString'){
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'polyline')) + '</name>';
      xml += '<type>polyline</type><trkseg>\n';
      geom.coordinates.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if(geom.type === 'Polygon'){
      var ring = geom.coordinates[0];
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'polygon')) + '</name>';
      xml += '<type>polygon</type><trkseg>\n';
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

function el(q){ return document.querySelector(q); }
function elAll(q){ return Array.from(document.querySelectorAll(q)); }

// ===== FILE TYPE BADGE HELPER =====
function getFileTypeBadge(fileType) {
  var badges = {
    gpx:   '<span class="file-type-badge badge-gpx">GPX</span>',
    json:  '<span class="file-type-badge badge-json">JSON</span>',
    kml:   '<span class="file-type-badge badge-kml">KML</span>',
    drawn: '<span class="file-type-badge badge-drawn">Drawn</span>'
  };
  return badges[fileType] || '';
}

// Build file card in sidebar
function addFileCard(id, meta){
  var ul = el('#fileList');
  var li = document.createElement('li'); li.className='file-card'; li.id='file-'+id;

  var header = document.createElement('div'); header.className='file-header';
  var chk = document.createElement('input'); chk.type='checkbox'; chk.checked=true;
  chk.onchange = function(){ toggleFile(id, chk.checked); };

  // Badge tipe file
  var badgeEl = document.createElement('div');
  badgeEl.innerHTML = getFileTypeBadge(meta.fileType || 'gpx');

  var title = document.createElement('div'); title.className='file-title'; title.innerText = meta.name;
  title.onclick = function(){ openRename(id); };

  var actions = document.createElement('div'); actions.className='file-actions';
  var btnZoom = document.createElement('button'); btnZoom.className='btn-small'; btnZoom.innerText='Zoom'; btnZoom.onclick=function(e){ e.stopPropagation(); zoomFile(id); };
  var btnStyle = document.createElement('button'); btnStyle.className='btn-small'; btnStyle.innerText='Style'; btnStyle.onclick=function(e){ e.stopPropagation(); openProperties(id); };
  var btnExport = document.createElement('button'); btnExport.className='btn-small'; btnExport.innerText='Export'; btnExport.onclick=function(e){ e.stopPropagation(); exportAllFor(id); };
  var btnDel = document.createElement('button'); btnDel.className='btn-small'; btnDel.innerText='Delete'; btnDel.onclick=function(e){ e.stopPropagation(); deleteFile(id); };

  actions.appendChild(btnZoom); actions.appendChild(btnStyle); actions.appendChild(btnExport); actions.appendChild(btnDel);
  header.appendChild(chk);
  header.appendChild(badgeEl);
  header.appendChild(title);
  header.appendChild(actions);
  li.appendChild(header);

  var folder = document.createElement('div'); folder.className='folder-contents';
  var info = document.createElement('div'); info.className='muted';
  info.innerText = meta.summary || '';
  folder.appendChild(info);
  
  var totalControl = document.createElement('div');
  totalControl.style.cssText = 'margin-top:6px;font-size:11px;display:flex;align-items:center;gap:4px;';
  
  var totalCheckbox = document.createElement('input');
  totalCheckbox.type = 'checkbox';
  totalCheckbox.id = 'totalCheck-' + id;
  totalCheckbox.checked = uploadedFiles[id] ? uploadedFiles[id].includeInTotal : true;
  totalCheckbox.onchange = function(e) {
    e.stopPropagation();
    if (uploadedFiles[id]) uploadedFiles[id].includeInTotal = totalCheckbox.checked;
  };
  
  var totalLabel = document.createElement('label');
  totalLabel.htmlFor = 'totalCheck-' + id;
  totalLabel.innerText = '📊 Hitung dalam Total Luas';
  totalLabel.style.cssText = 'cursor:pointer;user-select:none;';
  
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
    if(show){ map.addLayer(layer); editableLayers.addLayer(layer); }
    else { map.removeLayer(layer); editableLayers.removeLayer(layer); }
  });
  if (show) {
    updateMapLabels(id);
  } else {
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
    }
  }
}

function zoomFile(id){ var meta = uploadedFiles[id]; if(!meta) return; if(meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

function deleteFile(id){
  if(!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if(!meta) return;
  meta.group.eachLayer(function(l){ map.removeLayer(l); editableLayers.removeLayer(l); });
  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
    delete labelLayers[id];
  }
  delete uploadedFiles[id];
  var node = document.getElementById('file-'+id); if(node) node.remove();
  if(lastSelectedId === id) closeProperties();
}

function openRename(id){
  var card = document.getElementById('file-'+id); if(!card) return;
  var title = card.querySelector('.file-title');
  var old = title.innerText;
  var input = document.createElement('input'); input.type='text'; input.value = old; input.style.flex='1';
  title.replaceWith(input);
  input.focus();
  input.onkeydown = function(e){
    if(e.key === 'Enter') finishRename(id, input.value);
    if(e.key === 'Escape') cancelRename(id, old);
  };
  input.onblur = function(){ finishRename(id, input.value); };
}

function finishRename(id, val){
  val = (val||'').trim() || uploadedFiles[id].name;
  var meta = uploadedFiles[id];
  meta.name = val;
  meta.labelSettings.blockName = val.replace('.gpx', '');
  var card = document.getElementById('file-'+id);
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className='file-title'; title.innerText = val; title.onclick = function(){ openRename(id); };
  input.replaceWith(title);
  if(lastSelectedId === id) el('#propName').value = val;
  updateMapLabels(id);
}

function cancelRename(id, old){
  var card = document.getElementById('file-'+id); if(!card) return;
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className='file-title'; title.innerText = old; title.onclick = function(){ openRename(id); };
  input.replaceWith(title);
}

// --- Properties panel ---
function openProperties(id){
  var meta = uploadedFiles[id]; if(!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;

  updatePropertiesStats(id);
  
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) len += turf.length(f, {units:'meters'}) * 1000;
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) area += turf.area(f);
  });
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';

  el('#styleStrokeColor').value = meta.color || '#0077ff';
  el('#styleStrokeWidth').value = meta.weight || 3;
  el('#strokeWidthVal').innerText = meta.weight || 3;
  el('#styleFillColor').value = meta.fillColor || (meta.color || '#0077ff');
  el('#styleFillOpacity').value = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
  el('#fillOpacityVal').innerText = el('#styleFillOpacity').value;
  el('#styleDash').value = meta.dashArray || '';
  el('#styleMarker').value = meta.markerSymbol || 'circle';

  el('#labelShow').checked = meta.labelSettings.show;
  el('#labelTextColor').value = meta.labelSettings.textColor;
  el('#labelTextSize').value = meta.labelSettings.textSize;
  el('#labelSizeVal').innerText = meta.labelSettings.textSize;
  
  var gj2 = meta.group.toGeoJSON();
  var hasPolyline = false, hasPolygon = false;
  gj2.features.forEach(function(f) {
    if (!f.geometry) return;
    var type = f.geometry.type;
    if (type === 'LineString' || type === 'MultiLineString') hasPolyline = true;
    else if (type === 'Polygon' || type === 'MultiPolygon') hasPolygon = true;
  });
  
  var fillColorRow = document.querySelector('#styleFillColor').closest('.row');
  if (hasPolyline && !hasPolygon) {
    if (fillColorRow) fillColorRow.style.display = 'none';
  } else {
    if (fillColorRow) fillColorRow.style.display = 'flex';
  }
  
  if (typeof meta.labelSettings.offsetX === 'undefined') {
    meta.labelSettings.offsetX = 0;
    meta.labelSettings.offsetY = 0;
  }
  
  updateMapLabels(id);
}

function updatePropertiesStats(id) {
  var meta = uploadedFiles[id]; if (!meta) return;
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) len += turf.length(f, {units:'meters'}) * 1000;
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) area += turf.area(f);
  });
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';
}

function updateMapLabels(id) {
  var meta = uploadedFiles[id];
  if (!meta || !meta.labelSettings.show) {
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
      labelLayers[id] = [];
    }
    return;
  }

  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
  }
  labelLayers[id] = [];

  var gj = meta.group.toGeoJSON();
  gj.features.forEach(function(f, featureIdx) {
    if (!f.geometry || f.geometry.type !== 'Polygon') return;
    
    var centroid = turf.centroid(f);
    var area = turf.area(f);
    var areaHa = (area / 10000).toFixed(2);
    
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
    
    var labelMarker = L.marker([labelLat, labelLng], {
      icon: L.divIcon({ className: 'label-marker', html: labelHtml, iconSize: null, iconAnchor: [0, 0] }),
      draggable: true
    });
    
    labelMarker.on('dragend', function(e) {
      var newLatLng = e.target.getLatLng();
      var originalCentroid = centroid.geometry.coordinates;
      meta.labelSettings.offsetX = newLatLng.lng - originalCentroid[0];
      meta.labelSettings.offsetY = newLatLng.lat - originalCentroid[1];
    });
    
    labelMarker.addTo(map);
    labelLayers[id].push(labelMarker);
  });
}

function cleanupOrphanLabels() {
  Object.keys(labelLayers).forEach(function(id) {
    var meta = uploadedFiles[id];
    if (!meta) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
        delete labelLayers[id];
      }
      return;
    }
    var hasLayers = false;
    meta.group.eachLayer(function() { hasLayers = true; });
    if (!hasLayers) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) { map.removeLayer(layer); });
        labelLayers[id] = [];
      }
    }
  });
}

function closeProperties(){ lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

el('#styleStrokeWidth').oninput = function(){ el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function(){ el('#fillOpacityVal').innerText = this.value; };
el('#labelTextSize').oninput = function(){ el('#labelSizeVal').innerText = this.value; };

el('#resetLabelPosition').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.labelSettings.offsetX = 0;
  meta.labelSettings.offsetY = 0;
  updateMapLabels(lastSelectedId);
  alert('Posisi label direset ke tengah polygon.');
};

el('#applyStyle').onclick = function(){
  if(!lastSelectedId) return alert('Pilih layer dulu.');
  var meta = uploadedFiles[lastSelectedId];
  
  var newName = el('#propName').value.trim() || meta.name;
  meta.name = newName;
  
  var card = document.getElementById('file-'+lastSelectedId);
  if(card) card.querySelector('.file-title').innerText = newName;
  
  meta.color = el('#styleStrokeColor').value;
  meta.weight = parseInt(el('#styleStrokeWidth').value);
  meta.fillColor = el('#styleFillColor').value;
  meta.fillOpacity = parseFloat(el('#styleFillOpacity').value);
  meta.dashArray = el('#styleDash').value || null;
  meta.markerSymbol = el('#styleMarker').value || 'circle';

  meta.group.eachLayer(function(layer){
    if(layer.setStyle){
      var geoJsonLayer = layer.toGeoJSON();
      var geomType = geoJsonLayer.geometry ? geoJsonLayer.geometry.type : null;
      if (geomType === 'LineString' || geomType === 'MultiLineString') {
        layer.setStyle({ color: meta.color, weight: meta.weight, dashArray: meta.dashArray });
      } else {
        layer.setStyle({ color: meta.color, weight: meta.weight, dashArray: meta.dashArray, fillColor: meta.fillColor, fillOpacity: meta.fillOpacity });
      }
    }
    if(layer.setRadius) layer.setStyle({ color: meta.color, fillColor: meta.fillColor });
  });
  
  var existingOffsetX = meta.labelSettings.offsetX || 0;
  var existingOffsetY = meta.labelSettings.offsetY || 0;
  
  meta.labelSettings = {
    show: el('#labelShow').checked,
    blockName: newName.replace('.gpx', ''),
    textColor: el('#labelTextColor').value,
    textSize: parseInt(el('#labelTextSize').value),
    offsetX: existingOffsetX,
    offsetY: existingOffsetY
  };
  
  updateMapLabels(lastSelectedId);
  
  meta.group.eachLayer(function(layer){
    if (map.hasLayer(layer)) layer.redraw ? layer.redraw() : null;
  });
  
  alert('Semua perubahan (nama, style, label) diterapkan!');
};

el('#revertStyle').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.color = '#000000';
  meta.weight = 3;
  meta.fillColor = '#ee00ff';
  meta.fillOpacity = 0.4;
  meta.dashArray = null;
  meta.markerSymbol = 'circle';
  meta.labelSettings = {
    show: true,
    blockName: meta.name.replace('.gpx', ''),
    textColor: '#000000',
    textSize: 12,
    offsetX: meta.labelSettings.offsetX || 0,
    offsetY: meta.labelSettings.offsetY || 0
  };
  openProperties(lastSelectedId);
  el('#applyStyle').click();
};

// Export buttons
el('#exportGeojson').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    gj.features.forEach(function(feature) {
        if (!feature.properties) feature.properties = {};
        feature.properties._layerName = meta.name;
        feature.properties._includeInTotal = meta.includeInTotal;
        feature.properties._style = { color: meta.color, weight: meta.weight, fillColor: meta.fillColor, fillOpacity: meta.fillOpacity, dashArray: meta.dashArray, markerSymbol: meta.markerSymbol };
        feature.properties._label = { show: meta.labelSettings.show, blockName: meta.labelSettings.blockName, textColor: meta.labelSettings.textColor, textSize: meta.labelSettings.textSize, offsetX: meta.labelSettings.offsetX, offsetY: meta.labelSettings.offsetY };
        if (meta.manualArea && meta.manualArea > 0) feature.properties._manualArea = meta.manualArea;
    });
    var blob = new Blob([JSON.stringify(gj, null, 2)], {type:'application/json'}); 
    saveAs(blob, (meta.name||'layer') + '.geojson');  
};

el('#exportGpx').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    var gpx = geojsonToGpx(gj, meta.name, meta);
    saveAs(new Blob([gpx],{type:'application/gpx+xml'}), (meta.name||'layer') + '.gpx'); 
};

el('#exportKml').onclick = function(){ 
    if(!lastSelectedId) return; 
    var meta = uploadedFiles[lastSelectedId]; 
    var gj = meta.group.toGeoJSON(); 
    gj.features.forEach(function(feature) {
        if (!feature.properties) feature.properties = {};
        feature.properties.LayerName = meta.name;
        feature.properties.IncludeInTotal = meta.includeInTotal ? 'Yes' : 'No';
        feature.properties.StrokeColor = meta.color;
        feature.properties.StrokeWeight = meta.weight;
        feature.properties.FillColor = meta.fillColor;
        feature.properties.FillOpacity = meta.fillOpacity;
        feature.properties.DashArray = meta.dashArray || '';
        feature.properties.LabelShow = meta.labelSettings.show ? 'Yes' : 'No';
        feature.properties.LabelBlockName = meta.labelSettings.blockName;
        feature.properties.LabelTextColor = meta.labelSettings.textColor;
        feature.properties.LabelTextSize = meta.labelSettings.textSize;
        if (meta.manualArea && meta.manualArea > 0) feature.properties.ManualArea = meta.manualArea;
        feature.properties.MarkerSymbol = meta.markerSymbol || 'circle';
        feature.properties.LabelOffsetX = meta.labelSettings.offsetX || 0;
        feature.properties.LabelOffsetY = meta.labelSettings.offsetY || 0;
    });
    var kml = tokml(gj); 
    saveAs(new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}), (meta.name||'layer') + '.kml'); 
};

el('#deleteLayer').onclick = function(){ if(!lastSelectedId) return deleteFile(lastSelectedId); };

function exportAllFor(id){ openProperties(id); }

// ===== PARSE METADATA DARI GPX EXTENSIONS =====
function parseGpxMetadata(dom) {
  try {
    var metadataEl = dom.querySelector('metadata extensions');
    if (!metadataEl) return null;
    
    function getTagValue(tagName, defaultValue) {
      var el = metadataEl.querySelector(tagName);
      return el ? el.textContent.trim() : defaultValue;
    }
    function getBoolValue(tagName, defaultValue) {
      var val = getTagValue(tagName, '');
      if (val === 'true') return true;
      if (val === 'false') return false;
      return defaultValue;
    }
    function getNumValue(tagName, defaultValue) {
      var val = getTagValue(tagName, '');
      var num = parseFloat(val);
      return isNaN(num) ? defaultValue : num;
    }
    
    var metadata = {
      name: getTagValue('layerName', null),
      includeInTotal: getBoolValue('includeInTotal', true),
      manualArea: getNumValue('manualArea', undefined),
      color: getTagValue('color', '#0077ff'),
      weight: getNumValue('weight', 3),
      fillColor: getTagValue('fillColor', '#ee00ff'),
      fillOpacity: getNumValue('fillOpacity', 0.4),
      dashArray: getTagValue('dashArray', null) || null,
      markerSymbol: getTagValue('markerSymbol', 'circle'),
      labelSettings: {
        show: getBoolValue('show', true),
        blockName: getTagValue('blockName', ''),
        textColor: getTagValue('textColor', '#000000'),
        textSize: getNumValue('textSize', 12),
        offsetX: getNumValue('offsetX', 0),
        offsetY: getNumValue('offsetY', 0)
      }
    };
    
    if (!metadata.name && !metadata.color) return null;
    return metadata;
    
  } catch (error) {
    console.error('Error parsing GPX metadata:', error);
    return null;
  }
}

// ===== RESTORE METADATA DARI GEOJSON =====
// Digunakan saat import file GeoJSON yang pernah di-export dari Mini MapGIS
function restoreMetadataFromGeoJSON(geojson) {
  if (!geojson || !geojson.features || geojson.features.length === 0) return null;
  
  const firstFeature = geojson.features[0];
  const props = firstFeature.properties || {};
  
  if (props._style && props._label) {
    return {
      name: props._layerName || null,
      includeInTotal: props._includeInTotal !== false,
      manualArea: props._manualArea || undefined,
      color:       props._style.color       || '#000000',
      weight:      props._style.weight      || 3,
      fillColor:   props._style.fillColor   || '#ee00ff',
      fillOpacity: props._style.fillOpacity !== undefined ? props._style.fillOpacity : 0.4,
      dashArray:   props._style.dashArray   || null,
      markerSymbol:props._style.markerSymbol|| 'circle',
      labelSettings: {
        show:      props._label.show !== false,
        blockName: props._label.blockName || '',
        textColor: props._label.textColor || '#000000',
        textSize:  props._label.textSize  || 12,
        offsetX:   props._label.offsetX   || 0,
        offsetY:   props._label.offsetY   || 0
      }
    };
  }
  return null;
}

// ===== DETEKSI TIPE GEOMETRY =====
function detectGeometryTypes(geojson) {
  var hasPolyline = false, hasPolygon = false;
  (geojson.features || []).forEach(function(f) {
    if (!f.geometry) return;
    var t = f.geometry.type;
    if (t === 'LineString' || t === 'MultiLineString') hasPolyline = true;
    if (t === 'Polygon'    || t === 'MultiPolygon')    hasPolygon  = true;
  });
  return { hasPolyline: hasPolyline, hasPolygon: hasPolygon };
}

// ===== DEFAULT META BERDASARKAN GEOMETRY =====
function buildDefaultMeta(hasPolyline, hasPolygon) {
  if (hasPolyline && !hasPolygon) {
    return { color:'#ee00ff', weight:3, fillColor:'#ee00ff', fillOpacity:0.4, dashArray:null, markerSymbol:'circle' };
  }
  return { color:'#000000', weight:3, fillColor:'#ee00ff', fillOpacity:0.4, dashArray:null, markerSymbol:'circle' };
}

// ===== FINALIZE: Simpan ke state dan render ke peta =====
function finalizeLayer(id, geojson, metaDefaults, layerName, fileType, allBounds) {
  geojson = convertLineToPolygonGeoJSON(geojson);

  var group = createGroupFromGeoJSON(geojson, metaDefaults, id);
  var bounds = group.getBounds();

  uploadedFiles[id] = {
    name: layerName,
    fileType: fileType,
    group: group,
    bounds: bounds,
    color:        metaDefaults.color,
    weight:       metaDefaults.weight,
    fillColor:    metaDefaults.fillColor,
    fillOpacity:  metaDefaults.fillOpacity,
    dashArray:    metaDefaults.dashArray,
    markerSymbol: metaDefaults.markerSymbol,
    labelSettings: metaDefaults.labelSettings || {
      show: true,
      blockName: layerName.replace(/\.(gpx|json|geojson|kml)$/i, ''),
      textColor: '#000000',
      textSize: 12,
      offsetX: 0,
      offsetY: 0
    },
    includeInTotal: metaDefaults.includeInTotal !== false,
    manualArea: metaDefaults.manualArea
  };

  group.eachLayer(function(l){
    map.addLayer(l);
    editableLayers.addLayer(l);
  });

  var displayName = layerName.replace(/\.(gpx|json|geojson|kml)$/i, '');
  addFileCard(id, {
    name: displayName,
    summary: bounds && bounds.isValid() ? 'Bounds available' : 'No bounds',
    fileType: fileType
  });
  // Sync displayed title with clean name
  uploadedFiles[id].name = displayName;
  var card = document.getElementById('file-' + id);
  if (card) {
    var titleEl = card.querySelector('.file-title');
    if (titleEl) titleEl.innerText = displayName;
  }
  uploadedFiles[id].labelSettings.blockName = displayName;

  if (bounds && bounds.isValid()) allBounds.push(bounds);

  // Tampilkan label untuk polygon
  updateMapLabels(id);
}

// ===== UPLOAD HANDLER (mendukung GPX, JSON/GeoJSON, KML) =====
el('#btnUpload').onclick = function(){
  var fi = el('#gpxFile');
  if(!fi.files || fi.files.length === 0) return alert('Pilih file terlebih dahulu.');

  var files = Array.from(fi.files);
  var totalFiles = files.length;
  var processedFiles = 0;
  var allBounds = [];

  var progressDiv = el('#uploadProgress');
  var progressText = el('#progressText');
  if(progressDiv){ progressDiv.style.display = 'block'; progressText.innerText = '0/' + totalFiles; }

  function onFileDone() {
    processedFiles++;
    if(progressText) progressText.innerText = processedFiles + '/' + totalFiles;

    if(processedFiles === totalFiles) {
      if(allBounds.length > 0) {
        var combinedBounds = allBounds[0];
        for(var i = 1; i < allBounds.length; i++) combinedBounds.extend(allBounds[i]);
        map.fitBounds(combinedBounds);
      }
      if(progressDiv) setTimeout(function(){ progressDiv.style.display = 'none'; }, 1000);
      alert('Berhasil upload ' + totalFiles + ' file!');
      fi.value = '';
    }
  }

  files.forEach(function(file, index) {
    var ext = file.name.split('.').pop().toLowerCase();
    var id  = Date.now() + '-' + index + '-' + Math.floor(Math.random()*1000);
    var reader = new FileReader();

    // ===== GPX =====
    if (ext === 'gpx') {
      reader.onload = function(){
        try {
          var dom = new DOMParser().parseFromString(reader.result, 'text/xml');
          var geojson = toGeoJSON.gpx(dom);

          var savedMeta = parseGpxMetadata(dom);
          var types = detectGeometryTypes(geojson);
          var metaDefaults = savedMeta || buildDefaultMeta(types.hasPolyline, types.hasPolygon);
          var layerName = savedMeta && savedMeta.name ? savedMeta.name : file.name;

          finalizeLayer(id, geojson, metaDefaults, layerName, 'gpx', allBounds);
          onFileDone();
        } catch(e) {
          console.error('Error parsing GPX:', file.name, e);
          alert('Gagal parse GPX: ' + file.name);
          onFileDone();
        }
      };
      reader.onerror = function(){ console.error('Read error:', file.name); onFileDone(); };
      reader.readAsText(file);
    }

    // ===== JSON / GEOJSON =====
    else if (ext === 'json' || ext === 'geojson') {
      reader.onload = function(){
        try {
          var geojson = JSON.parse(reader.result);

          // Normalisasi: jika bukan FeatureCollection
          if (geojson.type === 'Feature') {
            geojson = { type: 'FeatureCollection', features: [geojson] };
          } else if (geojson.type !== 'FeatureCollection') {
            // Mungkin plain geometry
            geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
          }

          // Coba restore metadata dari export Mini MapGIS sebelumnya
          var savedMeta = restoreMetadataFromGeoJSON(geojson);
          var types = detectGeometryTypes(geojson);
          var metaDefaults = savedMeta || buildDefaultMeta(types.hasPolyline, types.hasPolygon);
          var layerName = (savedMeta && savedMeta.name) ? savedMeta.name : file.name;

          finalizeLayer(id, geojson, metaDefaults, layerName, 'json', allBounds);
          onFileDone();
        } catch(e) {
          console.error('Error parsing GeoJSON:', file.name, e);
          alert('Gagal parse JSON/GeoJSON: ' + file.name + '\n' + e.message);
          onFileDone();
        }
      };
      reader.onerror = function(){ console.error('Read error:', file.name); onFileDone(); };
      reader.readAsText(file);
    }

    // ===== KML =====
    else if (ext === 'kml') {
      reader.onload = function(){
        try {
          var dom = new DOMParser().parseFromString(reader.result, 'text/xml');

          // Cek parse error
          var parseError = dom.querySelector('parsererror');
          if (parseError) throw new Error('XML tidak valid: ' + parseError.textContent.substring(0, 100));

          var geojson = toGeoJSON.kml(dom);

          var types = detectGeometryTypes(geojson);
          var metaDefaults = buildDefaultMeta(types.hasPolyline, types.hasPolygon);
          var layerName = file.name;

          // Coba ambil nama dari <name> root KML
          var kmlNameEl = dom.querySelector('Document > name, kml > name');
          if (kmlNameEl && kmlNameEl.textContent.trim()) {
            metaDefaults.kmlDocName = kmlNameEl.textContent.trim();
          }

          finalizeLayer(id, geojson, metaDefaults, layerName, 'kml', allBounds);
          onFileDone();
        } catch(e) {
          console.error('Error parsing KML:', file.name, e);
          alert('Gagal parse KML: ' + file.name + '\n' + e.message);
          onFileDone();
        }
      };
      reader.onerror = function(){ console.error('Read error:', file.name); onFileDone(); };
      reader.readAsText(file);
    }

    // ===== FORMAT TIDAK DIKENAL =====
    else {
      alert('Format tidak didukung: .' + ext + '\nFormat yang didukung: .gpx, .json, .geojson, .kml');
      onFileDone();
    }
  });
};

map.on('click', function(){ /* keep panel open */ });
document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ closeProperties(); } });

function convertLineToPolygonGeoJSON(gj) {
    if (!gj || !gj.features) return gj;
    var newFeatures = [];
    gj.features.forEach(function (f) {
        if (!f.geometry) return;
        if (f.geometry.type === "LineString") {
            var coords = f.geometry.coordinates;
            if (coords.length >= 4) {
                var firstPoint = coords[0];
                var lastPoint = coords[coords.length - 1];
                var isClosed = (
                    Math.abs(firstPoint[0] - lastPoint[0]) < 0.000001 && 
                    Math.abs(firstPoint[1] - lastPoint[1]) < 0.000001
                );
                if (isClosed) {
                    newFeatures.push({
                        type: "Feature",
                        properties: f.properties || {},
                        geometry: { type: "Polygon", coordinates: [coords] }
                    });
                } else {
                    newFeatures.push(f);
                }
            } else {
                newFeatures.push(f);
            }
        } else {
            newFeatures.push(f);
        }
    });
    return { type: "FeatureCollection", features: newFeatures };
}

// ===== PDF EXPORT =====
var pdfSettings = { title: "PETA AREAL KEBUN", subtitle: "" };

document.getElementById("btnPrintPdf").onclick = function() {
  const gj = editableLayers.toGeoJSON();
  if (!gj || !gj.features || gj.features.length === 0) {
    alert("Tidak ada data untuk dicetak.");
    return;
  }
  showPdfModal();
};

function showPdfModal() {
  const modal = document.getElementById('pdfModal');
  document.getElementById('pdfTitle').value    = pdfSettings.title || "PETA AREAL KEBUN";
  document.getElementById('pdfSubtitle').value = pdfSettings.subtitle || "";
  generateAreaInputs();
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('pdfTitle').focus(), 100);
}

function generateAreaInputs() {
  const container = document.getElementById('areaInputsContainer');
  container.innerHTML = '';
  
  Object.keys(uploadedFiles).forEach(id => {
    const card = document.getElementById('file-' + id);
    if (!card) return;
    const checkbox = card.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;
    
    const meta = uploadedFiles[id];
    const layerGj = meta.group.toGeoJSON();
    let gpsArea = 0;
    layerGj.features.forEach(f => {
      if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
        gpsArea += turf.area(f);
    });
    const gpsAreaHa = (gpsArea / 10000).toFixed(2);
    const manualArea = meta.manualArea || '';
    
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px;padding:8px;background:white;border-radius:4px;border:1px solid #ddd;';
    
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = 'flex:1;font-size:13px;font-weight:600;color:#333;';
    nameLabel.innerText = meta.name.replace(/\.(gpx|json|geojson|kml)$/i, '');
    
    const areaInput = document.createElement('input');
    areaInput.type = 'number'; areaInput.step = '0.01';
    areaInput.placeholder = gpsAreaHa + ' Ha (GPS)';
    areaInput.value = manualArea;
    areaInput.id = 'manualArea-' + id;
    areaInput.style.cssText = 'width:120px;padding:6px;font-size:13px;border:1px solid #ccc;border-radius:4px;text-align:right;';
    
    const haLabel = document.createElement('span');
    haLabel.innerText = 'Ha'; haLabel.style.cssText = 'font-size:13px;color:#666;';
    
    const gpsInfo = document.createElement('div');
    gpsInfo.style.cssText = 'font-size:11px;color:#999;width:90px;text-align:right;';
    gpsInfo.innerText = 'GPS: ' + gpsAreaHa + ' Ha';
    
    row.appendChild(nameLabel); row.appendChild(areaInput); row.appendChild(haLabel); row.appendChild(gpsInfo);
    container.appendChild(row);
  });
  
  if (container.children.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center;padding:20px;color:#999;font-size:13px;';
    emptyMsg.innerText = 'Tidak ada polygon yang dicentang untuk dicetak.';
    container.appendChild(emptyMsg);
  }
}

document.getElementById('btnAutoFillAreas').onclick = function() {
  Object.keys(uploadedFiles).forEach(id => {
    const card = document.getElementById('file-' + id); if (!card) return;
    const checkbox = card.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;
    const meta = uploadedFiles[id];
    const input = document.getElementById('manualArea-' + id); if (!input) return;
    const layerGj = meta.group.toGeoJSON();
    let gpsArea = 0;
    layerGj.features.forEach(f => {
      if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
        gpsArea += turf.area(f);
    });
    input.value = (gpsArea / 10000).toFixed(2);
  });
  alert('Luas GPS telah diisi otomatis ke semua input!');
};

function hidePdfModal() { document.getElementById('pdfModal').style.display = 'none'; }

document.getElementById('btnCancelPdf').onclick = function() { hidePdfModal(); };

document.getElementById('btnConfirmPdf').onclick = function() {
  const titleInput    = document.getElementById('pdfTitle');
  const subtitleInput = document.getElementById('pdfSubtitle');
  const titleValue = titleInput.value.trim();
  if (!titleValue) { alert('Title harus diisi!'); titleInput.focus(); return; }
  
  pdfSettings.title    = titleValue;
  pdfSettings.subtitle = subtitleInput.value.trim();
  
  Object.keys(uploadedFiles).forEach(id => {
    const input = document.getElementById('manualArea-' + id);
    if (input) {
      const manualValue = input.value.trim();
      if (manualValue && !isNaN(parseFloat(manualValue))) {
        uploadedFiles[id].manualArea = parseFloat(manualValue);
      } else {
        delete uploadedFiles[id].manualArea;
      }
    }
  });
  
  hidePdfModal();
  exportPdfFromLayers();
};

document.getElementById('pdfTitle').addEventListener('input', function(e) { this.value = this.value.toUpperCase(); });
document.getElementById('pdfTitle').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('pdfSubtitle').focus(); });
document.getElementById('pdfSubtitle').addEventListener('input', function(e) { this.value = this.value.toUpperCase(); });
document.getElementById('pdfSubtitle').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('btnConfirmPdf').click(); });

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('pdfModal');
    if (modal.style.display === 'flex') hidePdfModal();
  }
});

document.getElementById('pdfModal').addEventListener('click', function(e) {
  if (e.target === this) hidePdfModal();
});

async function exportPdfFromLayers() {
    const { PDFDocument, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]);

    const visibleFiles = {};
    const allFeatures = [];
    
    Object.keys(uploadedFiles).forEach(id => {
        const card = document.getElementById('file-' + id); if (!card) return;
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            visibleFiles[id] = uploadedFiles[id];
            const layerGj = uploadedFiles[id].group.toGeoJSON();
            if (layerGj && layerGj.features) allFeatures.push(...layerGj.features);
        }
    });
    
    if (allFeatures.length === 0) { alert("Tidak ada data yang dicentang untuk dicetak."); return; }
    
    const gj = { type: "FeatureCollection", features: allFeatures };
    const bbox = turf.bbox(gj);
    const [minX, minY, maxX, maxY] = bbox;

    const mapWidth = 500, mapHeight = 450, mapOffsetX = 50, mapOffsetY = 80;

    function project([lng, lat]) {
        const dx = maxX - minX, dy = maxY - minY;
        const scale = Math.min(mapWidth / dx, mapHeight / dy) * 0.9;
        const centerX = mapOffsetX + mapWidth / 2, centerY = mapOffsetY + mapHeight / 2;
        return [centerX + (lng - (minX + maxX) / 2) * scale, centerY + (lat - (minY + maxY) / 2) * scale];
    }

    page.drawRectangle({ x: mapOffsetX, y: mapOffsetY, width: mapWidth, height: mapHeight, borderColor: rgb(0,0,0), borderWidth: 2 });

    const gridColor = rgb(0.7, 0.7, 0.7);
    const numGridLines = 4;
    for (let i = 0; i <= numGridLines; i++) {
        const lng = minX + (maxX - minX) * (i / numGridLines);
        const [x] = project([lng, minY]);
        page.drawLine({ start:{x, y:mapOffsetY}, end:{x, y:mapOffsetY+mapHeight}, thickness:0.5, color:gridColor, dashArray:[3,3] });
        page.drawText(lng.toFixed(4) + "°E", { x: x-20, y: mapOffsetY-15, size:8, color:rgb(0,0,0) });
    }
    for (let i = 0; i <= numGridLines; i++) {
        const lat = minY + (maxY - minY) * (i / numGridLines);
        const [, y] = project([minX, lat]);
        page.drawLine({ start:{x:mapOffsetX, y}, end:{x:mapOffsetX+mapWidth, y}, thickness:0.5, color:gridColor, dashArray:[3,3] });
        page.drawText(lat.toFixed(4) + "°N", { x: mapOffsetX-45, y: y-3, size:8, color:rgb(0,0,0) });
    }
    
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? { r:parseInt(result[1],16)/255, g:parseInt(result[2],16)/255, b:parseInt(result[3],16)/255 } : {r:0,g:0.5,b:1};
    }
    
    function drawDashedLine(page, x1, y1, x2, y2, dashPattern, thickness, color) {
        const dx=x2-x1, dy=y2-y1, lineLength=Math.sqrt(dx*dx+dy*dy);
        if(lineLength===0) return;
        const unitX=dx/lineLength, unitY=dy/lineLength;
        let currentPos=0, patternIndex=0, isDash=true;
        while(currentPos<lineLength){
            const segmentLength=dashPattern[patternIndex%dashPattern.length];
            const endPos=Math.min(currentPos+segmentLength,lineLength);
            if(isDash){
                page.drawLine({ start:{x:x1+unitX*currentPos, y:y1+unitY*currentPos}, end:{x:x1+unitX*endPos, y:y1+unitY*endPos}, thickness, color, opacity:1 });
            }
            currentPos=endPos; patternIndex++; isDash=!isDash;
        }
    }
    
    Object.keys(visibleFiles).forEach(id => {
        const meta = visibleFiles[id];
        const layerGj = meta.group.toGeoJSON();
        const strokeRgb = hexToRgb(meta.color || '#0077ff');
        const fillRgb   = hexToRgb(meta.fillColor || meta.color || '#0077ff');
        const strokeColor = rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b);
        const fillColor   = rgb(fillRgb.r,   fillRgb.g,   fillRgb.b);
        const lineWidth   = meta.weight || 3;
        const fillOpacity = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
        
        layerGj.features.forEach(f => {
            if (!f.geometry) return;
            const type = f.geometry.type;
        
            if (type === "Polygon") {
                f.geometry.coordinates.forEach((ring, ringIdx) => {
                    if (ringIdx !== 0) return;
                    const allY = ring.map(c => project(c)[1]);
                    const minYPoly=Math.min(...allY), maxYPoly=Math.max(...allY);
                    for(let fillY=minYPoly; fillY<=maxYPoly; fillY+=1){
                        const intersections=[];
                        for(let i=0;i<ring.length-1;i++){
                            const [x1,y1]=project(ring[i]), [x2,y2]=project(ring[i+1]);
                            if((y1<=fillY&&fillY<=y2)||(y2<=fillY&&fillY<=y1)){
                                if(y2!==y1){ const t=(fillY-y1)/(y2-y1); intersections.push(x1+t*(x2-x1)); }
                            }
                        }
                        intersections.sort((a,b)=>a-b);
                        for(let j=0;j<intersections.length-1;j+=2){
                            if(intersections[j+1]!==undefined){
                                page.drawLine({start:{x:intersections[j],y:fillY},end:{x:intersections[j+1],y:fillY},thickness:1,color:fillColor,opacity:fillOpacity*0.6});
                            }
                        }
                    }
                    const dashPattern=meta.dashArray||'', isDashed=dashPattern.length>0;
                    if(isDashed){
                        const dashValues=dashPattern.split(',').map(v=>parseFloat(v.trim()));
                        for(let i=0;i<ring.length-1;i++){
                            const [x1,y1]=project(ring[i]),[x2,y2]=project(ring[i+1]);
                            drawDashedLine(page,x1,y1,x2,y2,dashValues,lineWidth,strokeColor);
                        }
                        const [xF,yF]=project(ring[0]),[xL,yL]=project(ring[ring.length-1]);
                        drawDashedLine(page,xL,yL,xF,yF,dashValues,lineWidth,strokeColor);
                    } else {
                        for(let i=0;i<ring.length-1;i++){
                            const [x1,y1]=project(ring[i]),[x2,y2]=project(ring[i+1]);
                            page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:lineWidth,color:strokeColor,opacity:1});
                        }
                        const [xF,yF]=project(ring[0]),[xL,yL]=project(ring[ring.length-1]);
                        page.drawLine({start:{x:xL,y:yL},end:{x:xF,y:yF},thickness:lineWidth,color:strokeColor,opacity:1});
                    }
                    
                    if (meta.labelSettings && meta.labelSettings.show) {
                        const centroid=turf.centroid(f);
                        const offsetX=meta.labelSettings.offsetX||0, offsetY=meta.labelSettings.offsetY||0;
                        const labelCoords=[centroid.geometry.coordinates[0]+offsetX, centroid.geometry.coordinates[1]+offsetY];
                        const [centX,centY]=project(labelCoords);
                        const blockName=meta.labelSettings.blockName||meta.name.replace(/\.(gpx|json|geojson|kml)$/i,'');
                        const labelTextColor=hexToRgb(meta.labelSettings.textColor||'#000000');
                        const labelSize=5;
                        const polyBounds=turf.bbox(f);
                        const [pMinX,pMinY]=project([polyBounds[0],polyBounds[1]]);
                        const [pMaxX,pMaxY]=project([polyBounds[2],polyBounds[3]]);
                        const polyWidth=Math.abs(pMaxX-pMinX), polyHeight=Math.abs(pMaxY-pMinY);
                        if(Math.min(polyWidth,polyHeight)<15) return;
                        const textWidth=blockName.length*(labelSize*0.5), textHeight=labelSize*1.4;
                        if(textWidth>polyWidth*0.9||textHeight>polyHeight*0.9) return;
                        page.drawRectangle({x:centX-textWidth/2-3,y:centY-textHeight/2,width:textWidth+6,height:textHeight,color:rgb(1,1,1),opacity:0.9});
                        page.drawRectangle({x:centX-textWidth/2-3,y:centY-textHeight/2,width:textWidth+6,height:textHeight,borderColor:rgb(0,0,0),borderWidth:0.5});
                        page.drawText(blockName,{x:centX-(textWidth/2),y:centY-(labelSize/2),size:labelSize,color:rgb(labelTextColor.r,labelTextColor.g,labelTextColor.b)});
                    }
                });
            } else if (type === "LineString") {
                const dashPattern=meta.dashArray||'', isDashed=dashPattern.length>0;
                if(isDashed){
                    const dashValues=dashPattern.split(',').map(v=>parseFloat(v.trim()));
                    for(let i=0;i<f.geometry.coordinates.length-1;i++){
                        const [x1,y1]=project(f.geometry.coordinates[i]),[x2,y2]=project(f.geometry.coordinates[i+1]);
                        drawDashedLine(page,x1,y1,x2,y2,dashValues,lineWidth,strokeColor);
                    }
                } else {
                    for(let i=0;i<f.geometry.coordinates.length-1;i++){
                        const [x1,y1]=project(f.geometry.coordinates[i]),[x2,y2]=project(f.geometry.coordinates[i+1]);
                        page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:lineWidth,color:strokeColor,opacity:1});
                    }
                }
            }
        });
    });
    
    const sidebarX=570, sidebarWidth=240, centerX=sidebarX+(sidebarWidth/2);
    let yPos=mapOffsetY+mapHeight;
    
    const hasSubtitle=pdfSettings.subtitle&&pdfSettings.subtitle.length>0;
    const box1Top=yPos;
    if(hasSubtitle){
        yPos-=18;
        const titleWidth=pdfSettings.title.length*8;
        page.drawText(pdfSettings.title,{x:centerX-(titleWidth/2),y:yPos,size:14,color:rgb(0,0,0)});
        yPos-=20;
        const subtitleWidth=pdfSettings.subtitle.length*6;
        page.drawText(pdfSettings.subtitle,{x:centerX-(subtitleWidth/2),y:yPos,size:10,color:rgb(0.4,0.4,0.4)});
        yPos-=15;
    } else {
        const boxHeight=50, titleY=yPos-(boxHeight/2)+7;
        const titleWidth=pdfSettings.title.length*8;
        page.drawText(pdfSettings.title,{x:centerX-(titleWidth/2),y:titleY,size:14,color:rgb(0,0,0)});
        yPos-=boxHeight;
    }
    const box1Bottom=yPos-10;
    
    const box2Top=yPos;
    yPos-=20;
    const compassCenterX=sidebarX+60, compassCenterY=yPos-20;
    page.drawCircle({x:compassCenterX,y:compassCenterY,size:20,borderColor:rgb(0,0,0),borderWidth:1.5});
    page.drawLine({start:{x:compassCenterX,y:compassCenterY},end:{x:compassCenterX,y:compassCenterY+16},thickness:2.5,color:rgb(0,0,0)});
    page.drawLine({start:{x:compassCenterX,y:compassCenterY+16},end:{x:compassCenterX-5,y:compassCenterY+11},thickness:2.5,color:rgb(0,0,0)});
    page.drawLine({start:{x:compassCenterX,y:compassCenterY+16},end:{x:compassCenterX+5,y:compassCenterY+11},thickness:2.5,color:rgb(0,0,0)});
    page.drawText("U",{x:compassCenterX-4,y:compassCenterY+22,size:11,color:rgb(0,0,0)});
    
    const scaleCenterX=sidebarX+165, scaleY=compassCenterY;
    const realDist=turf.distance([minX,minY],[maxX,minY],{units:'meters'});
    const realDistCm=realDist*100, pdfScaleCm=mapWidth*2.54/72;
    let scaleRatio=Math.round(realDistCm/pdfScaleCm);
    if(scaleRatio<1000){ scaleRatio=Math.round(scaleRatio/100)*100; }
    else { const rem=scaleRatio%1000; scaleRatio=rem>=500?Math.ceil(scaleRatio/1000)*1000:Math.floor(scaleRatio/1000)*1000; }
    const scaleText="Skala 1 : "+scaleRatio.toLocaleString('id-ID');
    const scaleTextWidth=scaleText.length*5;
    page.drawText(scaleText,{x:scaleCenterX-(scaleTextWidth/2),y:scaleY+5,size:10,color:rgb(0,0,0)});
    yPos-=55;
    const box2Bottom=yPos;
    page.drawRectangle({x:sidebarX,y:box2Bottom,width:sidebarWidth,height:box2Top-box2Bottom,borderColor:rgb(0,0,0),borderWidth:1.5});
    yPos-=15;
    
    const box3Top=yPos;
    yPos-=15;
    const headerWidth="KETERANGAN:".length*6.5;
    page.drawText("KETERANGAN:",{x:centerX-headerWidth/2,y:yPos,size:11,color:rgb(0,0,0)});
    yPos-=22;
    
    const fileIds=Object.keys(visibleFiles);
    const totalFilesCount=fileIds.length;
    const lineHeight=13, maxLegendItems=16;
    const useDoubleColumn=totalFilesCount>maxLegendItems;
    const itemsPerColumn=useDoubleColumn?Math.ceil(totalFilesCount/2):totalFilesCount;
    const legendStartY=yPos, paddingX=12;
    
    fileIds.forEach((id,index)=>{
        const meta=uploadedFiles[id];
        let itemX=sidebarX+paddingX, itemY=legendStartY-(index%itemsPerColumn)*lineHeight;
        if(useDoubleColumn&&index>=itemsPerColumn){ itemX=sidebarX+paddingX+118; itemY=legendStartY-((index-itemsPerColumn)%itemsPerColumn)*lineHeight; }
        
        const layerGj=meta.group.toGeoJSON();
        let hasPolyline=false, hasPolygon=false;
        layerGj.features.forEach(f=>{ if(!f.geometry)return; const t=f.geometry.type; if(t==='LineString'||t==='MultiLineString')hasPolyline=true; if(t==='Polygon'||t==='MultiPolygon')hasPolygon=true; });
        
        const strokeRgb=hexToRgb(meta.color||'#0077ff');
        const strokeColor=rgb(strokeRgb.r,strokeRgb.g,strokeRgb.b);
        
        if(hasPolyline&&!hasPolygon){
            const lineY=itemY-3.5, dashPattern=meta.dashArray||'', isDashed=dashPattern.length>0;
            if(isDashed){
                let currentX=itemX; const endX=itemX+13, dashLen=3, gapLen=2;
                while(currentX<endX){ const segEnd=Math.min(currentX+dashLen,endX); page.drawLine({start:{x:currentX,y:lineY},end:{x:segEnd,y:lineY},thickness:2,color:strokeColor,opacity:1}); currentX=segEnd+gapLen; }
            } else {
                page.drawLine({start:{x:itemX,y:lineY},end:{x:itemX+13,y:lineY},thickness:2,color:strokeColor,opacity:1});
            }
        } else {
            const fillRgb=hexToRgb(meta.fillColor||meta.color||'#0077ff');
            const fillColor=rgb(fillRgb.r,fillRgb.g,fillRgb.b);
            page.drawRectangle({x:itemX,y:itemY-7,width:13,height:7,color:fillColor,borderColor:strokeColor,borderWidth:0.8,opacity:meta.fillOpacity||0.4});
        }
        
        let areaHa;
        if(meta.manualArea&&meta.manualArea>0){ areaHa=meta.manualArea.toFixed(2); }
        else { let layerArea=0; layerGj.features.forEach(f=>{ if(f.geometry&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon'))layerArea+=turf.area(f); }); areaHa=(layerArea/10000).toFixed(2); }
        
        let displayName=meta.name.replace(/\.(gpx|json|geojson|kml)$/i,'');
        const maxChars=useDoubleColumn?10:18;
        if(displayName.length>maxChars) displayName=displayName.substring(0,maxChars-2)+'..';
        
        const labelText=(hasPolyline&&!hasPolygon)?displayName:displayName+" - "+areaHa+" Ha";
        const labelColor=meta.includeInTotal?rgb(0,0,0):rgb(0.5,0.5,0.5);
        page.drawText(labelText,{x:itemX+17,y:itemY-5,size:7,color:labelColor});
        if(!meta.includeInTotal) page.drawText("*",{x:itemX+17+(labelText.length*7*0.4)+2,y:itemY-5,size:9,color:rgb(0.7,0,0)});
    });
    
    yPos=legendStartY-(itemsPerColumn*lineHeight)-15;
    
    let calculatedTotalArea=0;
    Object.keys(visibleFiles).forEach(id=>{
        const meta=uploadedFiles[id];
        if(meta.includeInTotal){
            if(meta.manualArea&&meta.manualArea>0){ calculatedTotalArea+=meta.manualArea; }
            else { const layerGj=meta.group.toGeoJSON(); layerGj.features.forEach(f=>{ if(f.geometry&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon'))calculatedTotalArea+=turf.area(f)/10000; }); }
        }
    });
    
    const totalHa=calculatedTotalArea.toFixed(2), totalText="Total Luas: "+totalHa+" Ha";
    const totalWidth=totalText.length*6;
    page.drawText(totalText,{x:centerX-(totalWidth/2),y:yPos,size:10,color:rgb(0,0,0)});
    yPos-=15;
    
    const box3Bottom=yPos;
    page.drawRectangle({x:sidebarX,y:box3Bottom,width:sidebarWidth,height:box3Top-box3Bottom,borderColor:rgb(0,0,0),borderWidth:1.5});
    
    const hasExcluded=Object.keys(visibleFiles).some(id=>!uploadedFiles[id].includeInTotal);
    if(hasExcluded) page.drawText("* Tidak dihitung dalam Total Luas",{x:50,y:35,size:7,color:rgb(0.5,0.5,0.5)});
    
    const now=new Date(), dateStr=now.toLocaleDateString('id-ID');
    page.drawText("Dicetak: "+dateStr,{x:50,y:20,size:8,color:rgb(0.4,0.4,0.4)});
    
    const pdfBytes=await pdfDoc.save();
    let filename="";
    if(pdfSettings.title) filename+=pdfSettings.title.replace(/ /g,'_');
    if(pdfSettings.subtitle&&pdfSettings.subtitle.length>0){ if(filename.length>0)filename+="_"; filename+=pdfSettings.subtitle.replace(/ /g,'_'); }
    if(filename.length===0) filename="PETA_AREAL";
    filename+=".pdf";
    saveAs(new Blob([pdfBytes]), filename);
}

// End of appminmapGIS.js
