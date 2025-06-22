ript
// Daftar IP yang diizinkan (ganti dengan IP perangkat Anda)
const ALLOWED_IPS = [
    '192.168.195.97',  // Contoh IP komputer 1
    '192.168.1.101',   // Contoh IP komputer 2
    '123.123.123.123'  // Contoh IP publik
];

// Fungsi untuk memeriksa IP pengguna
async function checkIP() {
    try {
        // Mendapatkan IP pengguna
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        const userIP = data.ip;
        
        // Cek apakah IP ada di daftar yang diizinkan
        return ALLOWED_IPS.includes(userIP);
    } catch (error) {
        console.error('Gagal memeriksa IP:', error);
        return false;
    }
}

// Fungsi untuk menonaktifkan tombol
function disableButtons() {
    // Tombol Upload
    const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
    if (uploadBtn) {
        uploadBtn.classList.add('disabled');
        uploadBtn.addEventListener('click', function(e) {
            e.preventDefault();
            alert('Akses ditolak: Hanya perangkat tertentu yang dapat mengupload data.');
        });
    }

    // Tombol Hapus - Perubahan utama di sini
    document.querySelectorAll('.btn-delete').forEach(btn => {
        const originalOnClick = btn.onclick; // Simpan fungsi asli
        
        btn.classList.add('disabled');
        btn.addEventListener('click', function(e) {
            if (btn.classList.contains('disabled')) {
                e.preventDefault();
                e.stopImmediatePropagation(); // Menghentikan event bubbling
                alert('Akses ditolak: Hanya perangkat tertentu yang dapat menghapus data.');
                return false;
            }
            
            // Jika tidak disabled, jalankan fungsi asli
            if (originalOnClick) {
                originalOnClick.call(this, e);
            }
        });
    });
}

// Style untuk tombol disabled
const style = document.createElement('style');
style.textContent = `
    .disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .disabled:hover {
        opacity: 0.5 !important;
    }
`;
document.head.appendChild(style);

// Jalankan pengecekan saat halaman dimuat
document.addEventListener('DOMContentLoaded', async function() {
    const hasAccess = await checkIP();
    
    if (!hasAccess) {
        disableButtons();
        console.warn('Akses dibatasi: IP perangkat tidak terdaftar');
    } else {
        console.log('Akses diizinkan untuk IP ini');
    }
});

// Pastikan kode ini dijalankan SETELAH tombol-tombol dibuat/dirender
// Jika tombol dibuat secara dinamis, gunakan MutationObserver:
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length) {
            checkIP().then(hasAccess => {
                if (!hasAccess) disableButtons();
            });
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
