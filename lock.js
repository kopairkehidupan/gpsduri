// Daftar IP yang diizinkan
const ALLOWED_IPS = [
    '192.168.195.97',  // IP komputer 1
    '192.168.1.101',   // IP komputer 2
    '123.123.123.123'  // IP publik
];

// Fungsi untuk memeriksa IP
async function checkIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (!response.ok) throw new Error('Network response was not ok');
        const { ip } = await response.json();
        return ALLOWED_IPS.includes(ip);
    } catch (error) {
        console.error('Error checking IP:', error);
        return false; // Default deny jika gagal check IP
    }
}

// Fungsi untuk mengontrol akses
async function controlAccess() {
    const hasAccess = await checkIP();
    
    if (!hasAccess) {
        // Nonaktifkan tombol Upload
        const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
        if (uploadBtn) {
            uploadBtn.classList.add('no-access');
            uploadBtn.onclick = (e) => {
                e.preventDefault();
                alert('Akses terbatas: Hanya perangkat tertentu yang dapat mengupload data.');
            };
        }

        // Nonaktifkan tombol Hapus
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.classList.add('no-access');
            const originalClick = btn.onclick;
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                alert('Akses terbatas: Hanya perangkat tertentu yang dapat menghapus data.');
            };
        });
    }
}

// Style untuk elemen terbatas
const style = document.createElement('style');
style.textContent = `
    .no-access {
        opacity: 0.5;
        cursor: not-allowed;
        position: relative;
    }
    .no-access:hover {
        opacity: 0.5 !important;
    }
    .no-access::after {
        content: "🔒";
        margin-left: 5px;
    }
`;
document.head.appendChild(style);

// Eksekusi setelah DOM siap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', controlAccess);
} else {
    controlAccess();
}
