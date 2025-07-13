// Fungsi untuk menampilkan toast konfirmasi (tengah layar)
function showConfirmToast(message, confirmCallback, cancelCallback = null) {
  return new Promise((resolve) => {
    const toastContainer = document.getElementById('confirmToastContainer');
    
    // Buat elemen toast
    const toast = document.createElement('div');
    toast.className = 'toast confirm-toast';
    toast.innerHTML = `
      <div>${message}</div>
      <div class="toast-actions">
        <button class="toast-btn confirm">Ya</button>
        <button class="toast-btn cancel">Batal</button>
      </div>
    `;
    
    // Tambahkan ke container
    toastContainer.appendChild(toast);
    
    // Handle klik tombol
    const confirmBtn = toast.querySelector('.confirm');
    const cancelBtn = toast.querySelector('.cancel');
    
    function cleanup() {
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }
    
    confirmBtn.addEventListener('click', () => {
      cleanup();
      if (confirmCallback) confirmCallback();
      resolve(true);
    });
    
    cancelBtn.addEventListener('click', () => {
      cleanup();
      if (cancelCallback) cancelCallback();
      resolve(false);
    });
  });
}

// Fungsi untuk menampilkan toast informasi sederhana (kanan atas)
function showSimpleToast(message, duration = 3000) {
  const toastContainer = document.getElementById('simpleToastContainer');
  
  const toast = document.createElement('div');
  toast.className = 'toast simple-toast';
  toast.textContent = message;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
