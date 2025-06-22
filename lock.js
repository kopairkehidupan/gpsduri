// Daftar IP yang diizinkan (ganti dengan IP perangkat Anda)
const ALLOWED_IPS = [
    '192.168.195.97',  // Contoh IP komputer 1
    '192.168.1.101',  // Contoh IP komputer 2
    '123.123.123.123' // Contoh IP publik
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
        uploadBtn.onclick = function(e) {
            e.preventDefault();
            alert('Akses ditolak: Hanya perangkat tertentu yang dapat mengupload data.');
        };
    }

    // Tombol Hapus
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.classList.add('disabled');
        btn.onclick = function(e) {
            e.preventDefault();
            alert('Akses ditolak: Hanya perangkat tertentu yang dapat menghapus data.');
        };
    });
}

// Style untuk tombol disabled
const style = document.createElement('style');
style.textContent = `
    .disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }
`;
document.head.appendChild(style);

// Jalankan pengecekan saat halaman dimuat
document.addEventListener('DOMContentLoaded', async function() {
    const hasAccess = await checkIP();
    
    if (!hasAccess) {
        disableButtons();
        
        // Tambahkan notifikasi di konsol untuk debugging
        console.warn('Akses dibatasi: IP perangkat tidak terdaftar');
    }
});
