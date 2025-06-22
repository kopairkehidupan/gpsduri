// Konfigurasi
const IP_CONFIG = {
    allowedIPs: ['192.168.195.97', '123.123.123.123'],
    apiEndpoints: [
        'https://api.ipify.org?format=json',
        'https://ipinfo.io/json',
        'https://ipapi.co/json'
    ],
    accessDeniedMessage: 'Akses terbatas: Fitur ini hanya tersedia untuk perangkat tertentu',
    debugMode: true // Set ke false untuk production
};

// Fungsi untuk mendapatkan IP dengan fallback
async function getIP() {
    // Coba dapatkan IP lokal terlebih dahulu
    try {
        const response = await fetch('http://localhost:3000/ip'); // Endpoint lokal
        if (response.ok) {
            const data = await response.json();
            return data.ip;
        }
    } catch (e) {
        console.log('Gagal mendapatkan IP dari server lokal');
    }

    // Fallback ke API publik
    for (const endpoint of IP_CONFIG.apiEndpoints) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) {
                const data = await response.json();
                return data.ip || data.ipAddress;
            }
        } catch (error) {
            console.error(`Error fetching from ${endpoint}:`, error);
        }
    }
    
    return null;
}

// Fungsi utama untuk memeriksa akses
async function checkAccess() {
    try {
        const currentIP = await getIP();
        console.log('IP yang terdeteksi:', currentIP);
        
        if (!currentIP) {
            console.warn('Tidak dapat mendeteksi IP');
            return false;
        }

        // Periksa apakah IP termasuk yang diizinkan
        const isAllowed = IP_CONFIG.allowedIPs.some(ip => {
            // Bandingkan full IP atau hanya bagian terakhir
            return currentIP === ip || currentIP.endsWith(ip.split('.').pop());
        });

        console.log('Akses diizinkan:', isAllowed);
        return isAllowed;
    } catch (error) {
        console.error('Error dalam checkAccess:', error);
        return false;
    }
}

// Fungsi untuk menonaktifkan elemen
function disableElement(element) {
    if (!element || element.classList.contains('restricted-access')) return;
    
    const newElement = element.cloneNode(true);
    element.parentNode.replaceChild(newElement, element);
    
    newElement.classList.add('restricted-access');
    newElement.style.pointerEvents = 'none';
    
    newElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert(IP_CONFIG.accessDeniedMessage);
        return false;
    }, true);
}

// Fungsi untuk mengatur akses
async function setupAccessControl() {
    const hasAccess = await checkAccess();
    
    if (!hasAccess) {
        console.log('Membatasi akses...');
        
        // Tambahkan style
        const style = document.createElement('style');
        style.textContent = `
            .restricted-access {
                opacity: 0.6;
                cursor: not-allowed !important;
                pointer-events: none !important;
                position: relative;
            }
            .restricted-access::after {
                content: "🔒";
                position: absolute;
                right: 5px;
                top: 50%;
                transform: translateY(-50%);
            }
        `;
        document.head.appendChild(style);
        
        // Nonaktifkan tombol
        const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
        if (uploadBtn) disableElement(uploadBtn);

        document.querySelectorAll('.btn-delete').forEach(btn => {
            disableElement(btn);
        });
    } else {
        console.log('Memberikan akses penuh');
    }
}

// Jalankan saat halaman selesai dimuat
document.addEventListener('DOMContentLoaded', () => {
    // Tunggu 1 detik untuk memastikan elemen sudah ada
    setTimeout(setupAccessControl, 1000);
});

// Observer untuk menangani elemen yang dimuat dinamis
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length) {
            setupAccessControl();
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
