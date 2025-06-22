// Daftar IP yang diizinkan (ganti dengan IP perangkat Anda)
const ALLOWED_IPS = [
    '192.168.195.97',  // Contoh IP komputer 1
    '192.168.1.101',   // Contoh IP komputer 2
    '123.123.123.123'  // Contoh IP publik
];

// Fungsi untuk memeriksa IP pengguna
async function checkIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return ALLOWED_IPS.includes(data.ip);
    } catch (error) {
        console.error('Gagal memeriksa IP:', error);
        return false;
    }
}

// Fungsi untuk menonaktifkan tombol
function disableButtons() {
    // 1. Tombol Upload
    const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
    if (uploadBtn) {
        uploadBtn.classList.add('disabled');
        uploadBtn.addEventListener('click', function(e) {
            e.preventDefault();
            alert('Akses ditolak: Hanya perangkat tertentu yang dapat mengupload data.');
            return false;
        }, true); // Gunakan capture phase
    }

    // 2. Tombol Hapus - Solusi utama
    document.querySelectorAll('.btn-delete').forEach(btn => {
        // Hapus semua event listener yang ada
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.classList.add('disabled');
        
        // Tambahkan handler baru yang memblokir aksi
        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            alert('Akses ditolak: Hanya perangkat tertentu yang dapat menghapus data.');
            return false;
        }, true); // Gunakan capture phase
        
        // Nonaktifkan sepenuhnya
        newBtn.style.pointerEvents = 'none';
    });
}

// Style untuk tombol disabled
const style = document.createElement('style');
style.textContent = `
    .disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none !important;
    }
    .disabled:hover {
        opacity: 0.5 !important;
    }
    .btn-delete.disabled {
        background-color: #cccccc !important;
    }
`;
document.head.appendChild(style);

// Fungsi utama untuk mengontrol akses
async function initAccessControl() {
    const hasAccess = await checkIP();
    
    if (!hasAccess) {
        disableButtons();
        console.warn('Akses dibatasi: IP perangkat tidak terdaftar');
        
        // Observer untuk tombol yang mungkin muncul kemudian
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length) {
                    disableButtons();
                }
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

// Tunggu hingga DOM sepenuhnya dimuat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccessControl);
} else {
    initAccessControl();
}
