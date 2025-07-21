// Fungsi untuk membuka koneksi IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KebunDatabase', 1);
    
    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject(event.target.error);
    };
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Buat object store jika belum ada
      if (!db.objectStoreNames.contains('aktual')) {
        db.createObjectStore('Aktual', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('budget')) {
        db.createObjectStore('Budget', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prodActual')) {
        db.createObjectStore('prodActual', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prodBudget')) {
        db.createObjectStore('prodBudget', { keyPath: 'id' });
      }
    };
  });
}

// Fungsi untuk mendapatkan data dari IndexedDB
async function getDataFromDB(storeName, key) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error(`Error getting data from ${storeName}:`, error);
    return [];
  }
}

// Fungsi untuk menampilkan detail data saat blok dipilih
async function showBlockDetails(blockCode, kebun, divisi) {
  const dataDetails = document.getElementById('dataDetails');
  dataDetails.style.display = 'block';
  
  // Ambil semua data yang diperlukan
  const [prodActualData, prodBudgetData, costActualData, costBudgetData] = await Promise.all([
    getDataFromDB('prodActual'),
    getDataFromDB('prodBudget'),
    getDataFromDB('Aktual'),
    getDataFromDB('Budget')
  ]);
  
  // Filter data berdasarkan blok, kebun, dan divisi
  const filterData = (data, block, kebun, divisi) => {
    return data.filter(item => 
      item.Blok === block && 
      item.Kebun === kebun && 
      item.Divisi === divisi.replace(' ', '_')
    );
  };
  
  const filteredProdActual = filterData(prodActualData, blockCode, kebun, divisi);
  const filteredProdBudget = filterData(prodBudgetData, blockCode, kebun, divisi);
  const filteredCostActual = filterData(costActualData, blockCode, kebun, divisi);
  const filteredCostBudget = filterData(costBudgetData, blockCode, kebun, divisi);
  
  // Tampilkan data produksi
  displayProductionData(filteredProdBudget[0], filteredProdActual[0]);
  
  // Tampilkan data biaya
  displayCostData(filteredCostBudget[0], filteredCostActual[0]);
  
  // Scroll ke bagian detail data
  dataDetails.scrollIntoView({ behavior: 'smooth' });
}

// Fungsi untuk menampilkan data produksi
function displayProductionData(budgetData, actualData) {
  const prodBudgetDiv = document.getElementById('prodBudgetData');
  const prodActualDiv = document.getElementById('prodActualData');
  const comparisonDiv = document.getElementById('prodComparison');
  
  if (budgetData) {
    prodBudgetDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Luas (Ha):</span>
        <span class="value">${budgetData.Luas || budgetData['Luas (Ha)'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Budget Produksi (Kg):</span>
        <span class="value">${budgetData['Budget Produksi (Kg)'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Budget Ton/Ha:</span>
        <span class="value">${budgetData['Budget Ton/Ha'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Budget Tonase (Ton):</span>
        <span class="value">${budgetData['Budget Tonase (Ton)'] || '-'}</span>
      </div>
    `;
  } else {
    prodBudgetDiv.innerHTML = '<p>Tidak ada data budget produksi</p>';
  }
  
  if (actualData) {
    prodActualDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Luas (Ha):</span>
        <span class="value">${actualData.Luas || actualData['Luas (Ha)'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Actual Produksi (Kg):</span>
        <span class="value">${actualData['Actual Produksi (Kg)'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Actual Ton/Ha:</span>
        <span class="value">${actualData['Actual Ton/Ha'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Actual Tonase (Ton):</span>
        <span class="value">${actualData['Actual Tonase (Ton)'] || '-'}</span>
      </div>
    `;
  } else {
    prodActualDiv.innerHTML = '<p>Tidak ada data aktual produksi</p>';
  }
  
  // Tampilkan perbandingan jika kedua data ada
  if (budgetData && actualData) {
    const budgetTonHa = parseFloat(budgetData['Budget Ton/Ha']) || 0;
    const actualTonHa = parseFloat(actualData['Actual Ton/Ha']) || 0;
    const difference = actualTonHa - budgetTonHa;
    const percentage = budgetTonHa !== 0 ? (difference / budgetTonHa * 100) : 0;
    
    comparisonDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Selisih Ton/Ha:</span>
        <span class="value ${difference >= 0 ? 'comparison-positive' : 'comparison-negative'}">
          ${difference.toFixed(2)} (${percentage.toFixed(2)}%)
        </span>
      </div>
      <div class="data-item">
        <span class="label">Status:</span>
        <span class="value ${difference >= 0 ? 'comparison-positive' : 'comparison-negative'}">
          ${difference >= 0 ? 'Melebihi Target' : 'Di Bawah Target'}
        </span>
      </div>
    `;
  } else {
    comparisonDiv.innerHTML = '<p>Tidak dapat membandingkan data</p>';
  }
}

// Fungsi untuk menampilkan data biaya
function displayCostData(budgetData, actualData) {
  const costBudgetDiv = document.getElementById('costBudgetData');
  const costActualDiv = document.getElementById('costActualData');
  const costComparisonDiv = document.getElementById('costComparison');
  
  if (budgetData) {
    costBudgetDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Objek Kerja:</span>
        <span class="value">${budgetData['Objek Kerja'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Biaya (Rp):</span>
        <span class="value">${formatCurrency(budgetData['Biaya (Rp)'])}</span>
      </div>
      <div class="data-item">
        <span class="label">HK:</span>
        <span class="value">${budgetData.HK || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Luas (Ha):</span>
        <span class="value">${budgetData.Luas || budgetData['Luas (Ha)'] || '-'}</span>
      </div>
    `;
  } else {
    costBudgetDiv.innerHTML = '<p>Tidak ada data budget biaya</p>';
  }
  
  if (actualData) {
    costActualDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Objek Kerja:</span>
        <span class="value">${actualData['Objek Kerja'] || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Biaya (Rp):</span>
        <span class="value">${formatCurrency(actualData['Biaya (Rp)'])}</span>
      </div>
      <div class="data-item">
        <span class="label">HK:</span>
        <span class="value">${actualData.HK || '-'}</span>
      </div>
      <div class="data-item">
        <span class="label">Hasil (Ha):</span>
        <span class="value">${actualData['Hasil (Ha)'] || '-'}</span>
      </div>
    `;
  } else {
    costActualDiv.innerHTML = '<p>Tidak ada data aktual biaya</p>';
  }
  
  // Tampilkan perbandingan jika kedua data ada
  if (budgetData && actualData) {
    const budgetCost = parseFloat(budgetData['Biaya (Rp)']) || 0;
    const actualCost = parseFloat(actualData['Biaya (Rp)']) || 0;
    const difference = actualCost - budgetCost;
    const percentage = budgetCost !== 0 ? (difference / budgetCost * 100) : 0;
    
    costComparisonDiv.innerHTML = `
      <div class="data-item">
        <span class="label">Selisih Biaya:</span>
        <span class="value ${difference <= 0 ? 'comparison-positive' : 'comparison-negative'}">
          ${formatCurrency(difference)} (${percentage.toFixed(2)}%)
        </span>
      </div>
      <div class="data-item">
        <span class="label">Status:</span>
        <span class="value ${difference <= 0 ? 'comparison-positive' : 'comparison-negative'}">
          ${difference <= 0 ? 'Di Bawah Budget' : 'Melebihi Budget'}
        </span>
      </div>
    `;
  } else {
    costComparisonDiv.innerHTML = '<p>Tidak dapat membandingkan data</p>';
  }
}

// Fungsi untuk memformat mata uang
function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '-';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(amount);
}
