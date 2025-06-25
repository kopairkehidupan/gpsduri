const SHEET_ID = "1yq0ULYXGRiKKQugUOFcvodW9vPm8EDrYxl1yXKvi2rI";

// Handle POST request (untuk upload data)
function doPost(e) {
  let data;
  
  if (e.postData.type === "application/json") {
    data = JSON.parse(e.postData.contents);
  } else if (e.parameter.data) {
    data = JSON.parse(e.parameter.data);
  } else {
    return createResponse(400, {status: 'error', message: 'Invalid request format'});
  }

  try {
    if (!data.kebun || !data.divisi || !data.blok || !data.files || data.files.length === 0) {
      throw new Error('Missing required fields');
    }
    
    const timestamp = new Date();
    const folderPath = `${data.kebun}/${data.divisi}/${data.blok}`;

    // Create folder structure
    const root = DriveApp.getRootFolder();
    const kebunFolder = getOrCreateFolder(root, data.kebun);
    const divisiFolder = getOrCreateFolder(kebunFolder, data.divisi);
    const blokFolder = getOrCreateFolder(divisiFolder, data.blok);
    blokFolder.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);

    // Log to spreadsheet
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    
    const uploadedFiles = [];
    
    // Upload semua file
    for (const fileData of data.files) {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(fileData.data), 
        "application/octet-stream", 
        fileData.name
      );
      const file = blokFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
      
      // Tentukan jenis file berdasarkan nama
      const fileType = fileData.name.toLowerCase().includes('track') ? 'TRACK' : 
                      fileData.name.toLowerCase().includes('waypoint') ? 'WAYPOINT' : 
                      'UNKNOWN';
      
      sheet.appendRow([
        timestamp, 
        data.kebun, 
        data.divisi, 
        data.blok, 
        fileType, 
        file.getName(), 
        file.getUrl(),
        folderPath
      ]);
      
      uploadedFiles.push({
        name: file.getName(),
        url: file.getUrl(),
        type: fileType
      });
    }

    return createResponse(200, {
      status: 'success',
      message: `Uploaded ${uploadedFiles.length} files successfully!`,
      files: uploadedFiles,
      folder: folderPath
    });

  } catch (error) {
    console.error('Server error:', error);
    return createResponse(500, {
      status: 'error',
      message: `Upload failed: ${error.message}`
    });
  }
}

// Tambahkan di bagian paling atas setelah SHEET_ID
const DEPLOYMENT_ID = 'AKfycbyEEr70Qbi_ETP3AAlavRQXb2ZTcU5IGcKP8grLHDERQCEI364Jw1gTI9yESuP-zjwH0A';
const ALLOWED_ORIGIN = 'https://kopairkehidupan.github.io';

// Ganti fungsi doGet dengan ini:
function doGet(e) {
  console.log('Received parameters:', e.parameters);
  try {
    let result;
    const action = e.parameter.action;
    
    if (action === 'deleteBlok') {
      result = deleteBlokData(e.parameter.kebun, e.parameter.divisi, e.parameter.blok);
    } 
    else if (action === 'getFiles') {
      result = {
        status: 'success',
        data: getFilesData(e.parameter.kebun || '', e.parameter.divisi || '', e.parameter.blok || '')
      };
    }
    else if (action === 'getFile') {
      try {
        const file = DriveApp.getFileById(e.parameter.fileId);
        return ContentService.createTextOutput(file.getBlob().getDataAsString())
          .setMimeType(ContentService.MimeType.TEXT);
      } catch (error) {
        result = { status: 'error', message: error.message };
      }
    }
    else {
      result = {
        status: 'info',
        message: 'Available endpoints:',
        endpoints: [
          'GET /?action=getFiles&kebun={kebun}&divisi={divisi}&blok={blok}',
          'GET /?action=getFile&fileId={fileId}',
          'GET /?action=deleteBlok&kebun={kebun}&divisi={divisi}&blok={blok}'
        ]
      };
    }
    
    // Return sebagai JSON dengan CORS headers
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.message
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }
}

// Fungsi untuk menghapus data blok
function deleteBlokData(kebun, divisi, blok) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Simpan file dan baris yang akan dihapus
  const filesToDelete = [];
  const rowsToDelete = [];
  
  // Cari data yang sesuai (dari bawah ke atas)
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (row[1] === kebun && row[2] === divisi && row[3] === blok) {
      try {
        const fileUrl = row[6];
        const fileId = extractFileIdFromUrl(fileUrl);
        if (fileId) filesToDelete.push(fileId);
      } catch (e) {
        console.warn(`Error processing file URL: ${row[6]}`, e);
      }
      rowsToDelete.push(i + 1); // +1 karena header
    }
  }
  
  // Validasi jika tidak ada data yang ditemukan
  if (rowsToDelete.length === 0) {
    return {
      status: 'error',
      message: 'Tidak ditemukan data untuk blok ini'
    };
  }
  
  // Hapus baris dari sheet (dari bawah ke atas)
  rowsToDelete.sort((a, b) => b - a).forEach(rowIndex => {
    sheet.deleteRow(rowIndex);
  });
  
  // Hapus file dari Drive
  let deletedFilesCount = 0;
  const uniqueFileIds = [...new Set(filesToDelete)]; // Hindari duplikat
  uniqueFileIds.forEach(fileId => {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      deletedFilesCount++;
    } catch (e) {
      console.warn(`Gagal menghapus file ${fileId}`, e);
    }
  });
  
  // Hapus folder blok JIKA kosong
  try {
    const blokFolderPath = `${kebun}/${divisi}/${blok}`;
    const blokFolder = getFolderByPath(blokFolderPath);
    
    if (blokFolder) {
      // Cek apakah folder sudah kosong
      if (!blokFolder.getFiles().hasNext()) {
        blokFolder.setTrashed(true);
        
        // Cek folder divisi
        const divisiFolder = blokFolder.getParents().next();
        if (!divisiFolder.getFiles().hasNext() && !divisiFolder.getFolders().hasNext()) {
          divisiFolder.setTrashed(true);
          
          // Cek folder kebun
          const kebunFolder = divisiFolder.getParents().next();
          if (!kebunFolder.getFiles().hasNext() && !kebunFolder.getFolders().hasNext()) {
            kebunFolder.setTrashed(true);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error saat membersihkan folder:', e);
  }
  
  return {
    status: 'success',
    message: `Menghapus ${rowsToDelete.length} record dan ${deletedFilesCount} file`,
    details: {
      kebun: kebun,
      divisi: divisi,
      blok: blok,
      deleted_records: rowsToDelete.length,
      deleted_files: deletedFilesCount
    }
  };
}

// ========== HELPER FUNCTIONS ========== //

// Membuat response dengan CORS headers
function createResponse(statusCode, data) {
  const response = ContentService.createTextOutput(JSON.stringify(data));
  response.setMimeType(ContentService.MimeType.JSON);
  
  // Set CORS headers
  response.setHeaders({
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  
  return response;
}

// Membuat atau mendapatkan folder
function getOrCreateFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

// Mendapatkan folder berdasarkan nama (tanpa membuat baru)
function getFolderByName(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

// Mendapatkan folder berdasarkan path
function getFolderByPath(path) {
  let folder = DriveApp.getRootFolder();
  const parts = path.split('/').filter(part => part.trim() !== '');
  
  for (const part of parts) {
    const folders = folder.getFoldersByName(part);
    if (!folders.hasNext()) return null;
    folder = folders.next();
  }
  
  return folder;
}

// Ekstrak file ID dari URL
function extractFileIdFromUrl(url) {
  const match = url.match(/\/file\/d\/([^\/]+)/) || url.match(/id=([^&]+)/);
  return match ? match[1] : null;
}

// Mendapatkan data file dari spreadsheet
function getFilesData(kebun, divisi, blok) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const result = [];
  
  // Lewati header
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowData = {};
    
    // Mapping data ke headers
    for (let j = 0; j < headers.length; j++) {
      rowData[headers[j]] = row[j];
    }
    
    // Filter data jika parameter diberikan
    if ((!kebun || rowData['Kebun'] === kebun) &&
        (!divisi || rowData['Divisi'] === divisi) &&
        (!blok || rowData['Blok'] === blok)) {
      result.push(rowData);
    }
  }
  
  return result;
}
