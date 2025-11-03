// Глобальные переменные
let currentSection = 'main';
let currentDeleteAction = null;
let currentUser = null;

// Состояние сортировки
let driversData = [];
let vehiclesData = [];
let violationsData = [];
let driversSorted = false;
let vehiclesSorted = false;
let violationsSorted = false;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    showSection('main');
    checkAuth();
    loadStatistics();
    loadDrivers();
    loadVehicles();
    loadViolations();
    
    // Обработчики форм
    document.getElementById('addDriverForm').addEventListener('submit', addDriver);
    document.getElementById('addVehicleForm').addEventListener('submit', addVehicle);
    document.getElementById('addViolationForm').addEventListener('submit', addViolation);
    document.getElementById('searchForm').addEventListener('submit', searchDrivers);

    // Авторизация
    document.getElementById('loginForm').addEventListener('submit', login);
    document.getElementById('registerForm').addEventListener('submit', register);
    
    // Обработчики форм редактирования
    document.getElementById('editDriverForm').addEventListener('submit', updateDriver);
    document.getElementById('editVehicleForm').addEventListener('submit', updateVehicle);
    document.getElementById('editViolationForm').addEventListener('submit', updateViolation);
    
    // Обработчик подтверждения удаления
    document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

    // Клик по аватару для открытия профиля
    const badge = document.getElementById('authUserBadge');
    if (badge) {
        badge.addEventListener('click', () => {
            if (!currentUser) return;
            openProfileModal();
        });
    }

    // Сабмит профиля
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', saveProfile);
    }

    // Обработчик выбора файла аватара
    const avatarFile = document.getElementById('profileAvatarFile');
    if (avatarFile) {
        avatarFile.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => startCropper(reader.result);
            reader.readAsDataURL(file);
        });
    }
});

// Переключение секций
function showSection(sectionName) {
    // Скрыть все секции
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Показать выбранную секцию
    document.getElementById(sectionName).classList.add('active');
    currentSection = sectionName;
    
    // Обновить данные при переходе
    if (sectionName === 'main') {
        loadStatistics();
    } else if (sectionName === 'drivers') {
        loadDrivers();
    } else if (sectionName === 'vehicles') {
        loadVehicles();
    } else if (sectionName === 'violations') {
        loadViolations();
    } else if (sectionName === 'statistics') {
        loadStatistics();
    } else if (sectionName === 'users') {
        loadUsers();
    }
}

// ==== Простой кроппер на canvas ====
let cropState = { image: null, imgEl: null, scale: 1, dx: 0, dy: 0, dragging: false, startX: 0, startY: 0 };

function startCropper(dataUrl) {
    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        cropState = { image: dataUrl, imgEl: img, scale: 1, dx: 0, dy: 0, dragging: false, startX: 0, startY: 0 };
        drawCrop();
        openModal('cropModal');
    };
    img.src = dataUrl;
    // Навешиваем события
    canvas.onmousedown = (e) => { cropState.dragging = true; cropState.startX = e.offsetX; cropState.startY = e.offsetY; };
    canvas.onmouseup = () => { cropState.dragging = false; };
    canvas.onmouseleave = () => { cropState.dragging = false; };
    canvas.onmousemove = (e) => {
        if (!cropState.dragging) return;
        const dx = e.offsetX - cropState.startX;
        const dy = e.offsetY - cropState.startY;
        cropState.startX = e.offsetX;
        cropState.startY = e.offsetY;
        cropState.dx += dx;
        cropState.dy += dy;
        drawCrop();
    };
    canvas.onwheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.05 : 0.95;
        cropState.scale = Math.max(0.2, Math.min(8, cropState.scale * delta));
        drawCrop();
    };
}

function drawCrop() {
    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = cropState.imgEl;
    if (!img) return;

    const iw = img.width * cropState.scale;
    const ih = img.height * cropState.scale;
    const x = (canvas.width - iw) / 2 + cropState.dx;
    const y = (canvas.height - ih) / 2 + cropState.dy;
    ctx.drawImage(img, x, y, iw, ih);

    // Рамка квадратного кропа
    ctx.strokeStyle = '#00d1ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
}

function confirmCrop() {
    const canvas = document.getElementById('cropCanvas');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 512; // итоговый размер
    tempCanvas.height = 512;
    const tctx = tempCanvas.getContext('2d');

    // Рассчитываем исходные координаты в изображении
    const img = cropState.imgEl;
    const scale = cropState.scale;
    const iw = img.width * scale;
    const ih = img.height * scale;
    const x = (canvas.width - iw) / 2 + cropState.dx;
    const y = (canvas.height - ih) / 2 + cropState.dy;

    // Соответствие области вывода tempCanvas к области на исходном img
    // Берем область canvas (0..canvas.width,height), маппим в исходные координаты
    const sx = (-x) / scale;
    const sy = (-y) / scale;
    const sSize = canvas.width / scale; // так как квадрат

    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, 512, 512);
    tctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, 512, 512);

    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);

    // Отрисуем превью и подставим в URL
    const preview = document.getElementById('profileAvatarPreview');
    preview.innerHTML = `<img src="${dataUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    document.getElementById('profileAvatarUrl').value = dataUrl;
    closeModal('cropModal');
}
// ===== Авторизация (frontend) =====
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        currentUser = data.user;
        updateAuthUI();
    } catch {}
}

function updateAuthUI() {
    const authUserBadge = document.getElementById('authUserBadge');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const protectedSections = ['drivers','vehicles','violations'];

    if (currentUser) {
        // Определяем инициал(ы) из имени или email
        const nameSource = currentUser.name && currentUser.name.trim() ? currentUser.name : (currentUser.email || 'U');
        const initials = nameSource
            .split(/[\s.@_-]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(p => p[0]?.toUpperCase())
            .join('') || 'U';

        authUserBadge.style.display = 'flex';
        const avatarHtml = currentUser.avatar ? `<img src="${currentUser.avatar}" alt="avatar" class="user-avatar" style="object-fit:cover;"/>` : `<span class="user-avatar">${initials}</span>`;
        authUserBadge.innerHTML = `${avatarHtml}<span>${nameSource}</span>`;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
    } else {
        authUserBadge.style.display = 'none';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        // При выходе переносим на главную, если были в защищенном разделе
        if (protectedSections.includes(currentSection)) {
            showSection('main');
        }
    }

    // Скрываем формы добавления и действия без авторизации
    const forms = [
        document.getElementById('addDriverForm'),
        document.getElementById('addVehicleForm'),
        document.getElementById('addViolationForm')
    ];
    forms.forEach(form => { if (form) form.style.display = currentUser ? 'grid' : 'none'; });

    // Кнопки редактирования/удаления
    document.querySelectorAll('.btn-edit, .btn-delete').forEach(btn => {
        btn.style.display = currentUser ? 'inline-block' : 'none';
    });

    // Доступ к разделу Пользователи только админам (скрываем кнопку и раздел)
    const usersNavBtn = Array.from(document.querySelectorAll('.main-nav button'))
        .find(b => b.getAttribute('onclick') === "showSection('users')");
    if (usersNavBtn) {
        usersNavBtn.style.display = currentUser && currentUser.role === 'admin' ? 'inline-block' : 'none';
    }
    const usersSection = document.getElementById('users');
    if (usersSection) {
        if (!currentUser || currentUser.role !== 'admin') {
            if (currentSection === 'users') showSection('main');
        }
    }
}

// ===== Профиль =====
function openProfileModal() {
    const preview = document.getElementById('profileAvatarPreview');
    const nameInput = document.getElementById('profileName');
    const phoneInput = document.getElementById('profilePhone');
    const addressInput = document.getElementById('profileAddress');
    const avatarUrlInput = document.getElementById('profileAvatarUrl');

    const nameSource = currentUser?.name || currentUser?.email || 'U';
    const initials = nameSource.split(/[\s.@_-]+/).filter(Boolean).slice(0,2).map(p=>p[0]?.toUpperCase()).join('') || 'U';

    if (currentUser?.avatar) {
        preview.innerHTML = '';
        preview.style.background = 'transparent';
        preview.style.color = 'transparent';
        preview.style.overflow = 'hidden';
        preview.style.display = 'inline-flex';
        preview.style.alignItems = 'center';
        preview.style.justifyContent = 'center';
        preview.innerHTML = `<img src="${currentUser.avatar}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    } else {
        preview.textContent = initials;
    }

    nameInput.value = currentUser?.name || '';
    phoneInput.value = currentUser?.phone || '';
    addressInput.value = currentUser?.address || '';
    avatarUrlInput.value = currentUser?.avatar || '';

    openModal('profileModal');
}

async function saveProfile(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('profileName').value || null,
        phone: document.getElementById('profilePhone').value || null,
        address: document.getElementById('profileAddress').value || null,
        avatar: document.getElementById('profileAvatarUrl').value || null
    };
    try {
        const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) return showAlert(data.error || 'Ошибка сохранения профиля', 'error');
        currentUser = data.user;
        updateAuthUI();
        closeModal('profileModal');
        showAlert('Профиль обновлен', 'success');
    } catch (e) {
        showAlert('Ошибка сети', 'error');
    }
}

async function login(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (!res.ok) return showAlert(data.error || 'Ошибка входа', 'error');
        currentUser = data.user;
        showAlert('Вы вошли в систему', 'success');
        updateAuthUI();
        showSection('main');
    } catch (e) {
        showAlert('Ошибка сети', 'error');
    }
}

async function register(e) {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
        const data = await res.json();
        if (!res.ok) return showAlert(data.error || 'Ошибка регистрации', 'error');
        currentUser = data.user;
        showAlert('Регистрация прошла успешно', 'success');
        updateAuthUI();
        showSection('main');
    } catch (e) {
        showAlert('Ошибка сети', 'error');
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        currentUser = null;
        updateAuthUI();
        showAlert('Вы вышли из системы', 'success');
    } catch {}
}

// Загрузка статистики
async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        const data = await response.json();
        
        // Обновляем главную страницу
        document.getElementById('drivers-count').textContent = data.drivers?.count || 0;
        document.getElementById('vehicles-count').textContent = data.vehicles?.count || 0;
        document.getElementById('violations-count').textContent = data.violations?.count || 0;
        document.getElementById('fines-total').textContent = `${(data.violations?.total_fines || 0).toLocaleString()} руб.`;
        
        // Обновляем страницу статистики
        if (currentSection === 'statistics') {
            let statsHtml = `
                <p>Всего водителей: <strong>${data.drivers?.count || 0}</strong></p>
                <p>Всего автомобилей: <strong>${data.vehicles?.count || 0}</strong></p>
                <p>Всего нарушений: <strong>${data.violations?.count || 0}</strong></p>
                <p>Общая сумма штрафов: <strong>${(data.violations?.total_fines || 0).toLocaleString()} руб.</strong></p>
            `;
            document.getElementById('generalStats').innerHTML = statsHtml;
            
            // Показываем последние нарушения
            if (data.recentViolations) {
                let violationsHtml = data.recentViolations.length > 0 ? 
                    data.recentViolations.map(violation => `
                        <div style="border-bottom: 1px solid #eee; padding: 0.5rem 0;">
                            <strong>${violation.full_name}</strong> - ${violation.violation_type}<br>
                            <small>${violation.license_plate} | ${violation.fine_amount} руб.</small>
                        </div>
                    `).join('') : '<p>Нет нарушений</p>';
                
                document.getElementById('recentViolations').innerHTML = violationsHtml;
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

// Загрузка водителей
async function loadDrivers() {
    try {
        const response = await fetch('/api/drivers');
        const drivers = await response.json();
        driversData = drivers;
        
        renderDriversTable();
        updateAuthUI();
    } catch (error) {
        console.error('Ошибка загрузки водителей:', error);
        document.getElementById('driversList').innerHTML = '<p class="alert error">Ошибка загрузки данных</p>';
    }
}

// Отрисовка таблицы водителей
function renderDriversTable() {
    let drivers = driversSorted ? [...driversData].sort((a, b) => {
        const nameA = (a.full_name || '').toLowerCase();
        const nameB = (b.full_name || '').toLowerCase();
        return nameA.localeCompare(nameB, 'ru');
    }) : driversData;
    
    let html = '';
    if (drivers.length > 0) {
        html = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>ФИО</th>
                        <th>Номер прав</th>
                        <th>Адрес</th>
                        <th>Телефон</th>
                        <th>Дата регистрации</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${drivers.map(driver => `
                        <tr>
                            <td>${driver.id}</td>
                            <td>${driver.full_name}</td>
                            <td>${driver.license_number}</td>
                            <td>${driver.address || '-'}</td>
                            <td>${driver.phone || '-'}</td>
                            <td>${new Date(driver.created_date).toLocaleDateString()}</td>
                            <td class="actions">
                                <button class="btn-edit" onclick="editDriver(${driver.id})" title="Редактировать">✏️</button>
                                <button class="btn-delete" onclick="deleteDriver(${driver.id})" title="Удалить">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        html = '<p>Нет зарегистрированных водителей</p>';
    }
    
    document.getElementById('driversList').innerHTML = html;
    updateAuthUI();
}

// Сортировка водителей
function sortDrivers() {
    driversSorted = !driversSorted;
    const btn = document.getElementById('sortDriversBtn');
    btn.textContent = driversSorted ? '🔤 Отменить сортировку' : '🔤 Сортировать по алфавиту';
    btn.style.background = driversSorted ? '#28a745' : '#6c757d';
    renderDriversTable();
}

// Добавление водителя
async function addDriver(event) {
    event.preventDefault();
    
    const formData = {
        fullName: document.getElementById('driverName').value,
        licenseNumber: document.getElementById('driverLicense').value,
        address: document.getElementById('driverAddress').value,
        phone: document.getElementById('driverPhone').value
    };
    
    try {
        const response = await fetch('/api/drivers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Водитель успешно добавлен!', 'success');
            document.getElementById('addDriverForm').reset();
            driversSorted = false;
            const btn = document.getElementById('sortDriversBtn');
            if (btn) {
                btn.textContent = '🔤 Сортировать по алфавиту';
                btn.style.background = '#6c757d';
            }
            loadDrivers();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Загрузка автомобилей
async function loadVehicles() {
    try {
        const response = await fetch('/api/vehicles');
        const vehicles = await response.json();
        vehiclesData = vehicles;
        
        renderVehiclesTable();
        updateAuthUI();
    } catch (error) {
        console.error('Ошибка загрузки автомобилей:', error);
        document.getElementById('vehiclesList').innerHTML = '<p class="alert error">Ошибка загрузки данных</p>';
    }
}

// Отрисовка таблицы автомобилей
function renderVehiclesTable() {
    let vehicles = vehiclesSorted ? [...vehiclesData].sort((a, b) => {
        const plateA = (a.license_plate || '').toLowerCase();
        const plateB = (b.license_plate || '').toLowerCase();
        return plateA.localeCompare(plateB, 'ru');
    }) : vehiclesData;
    
    let html = '';
    if (vehicles.length > 0) {
        html = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Госномер</th>
                        <th>Марка</th>
                        <th>Модель</th>
                        <th>Год</th>
                        <th>Владелец</th>
                        <th>Дата регистрации</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${vehicles.map(vehicle => `
                        <tr>
                            <td>${vehicle.id}</td>
                            <td>${vehicle.license_plate}</td>
                            <td>${vehicle.brand}</td>
                            <td>${vehicle.model}</td>
                            <td>${vehicle.year || '-'}</td>
                            <td>${vehicle.owner_name || `ID: ${vehicle.owner_id}`}</td>
                            <td>${new Date(vehicle.created_date).toLocaleDateString()}</td>
                            <td class="actions">
                                <button class="btn-edit" onclick="editVehicle(${vehicle.id})" title="Редактировать">✏️</button>
                                <button class="btn-delete" onclick="deleteVehicle(${vehicle.id})" title="Удалить">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        html = '<p>Нет зарегистрированных автомобилей</p>';
    }
    
    document.getElementById('vehiclesList').innerHTML = html;
    updateAuthUI();
}

// Сортировка автомобилей
function sortVehicles() {
    vehiclesSorted = !vehiclesSorted;
    const btn = document.getElementById('sortVehiclesBtn');
    btn.textContent = vehiclesSorted ? '🔤 Отменить сортировку' : '🔤 Сортировать по алфавиту';
    btn.style.background = vehiclesSorted ? '#28a745' : '#6c757d';
    renderVehiclesTable();
}

// Добавление автомобиля
async function addVehicle(event) {
    event.preventDefault();
    
    // Очищаем предыдущие ошибки
    clearFieldErrors();
    
    const licensePlate = document.getElementById('vehiclePlate').value.trim().toUpperCase();
    const brand = document.getElementById('vehicleBrand').value.trim();
    const model = document.getElementById('vehicleModel').value.trim();
    const year = parseInt(document.getElementById('vehicleYear').value) || null;
    const ownerId = parseInt(document.getElementById('vehicleOwnerId').value);
    
    // Валидация на фронтенде
    if (!licensePlate) {
        showFieldError('licensePlate', 'Госномер обязателен для заполнения');
        return;
    }
    
    if (!brand) {
        showFieldError('brand', 'Марка обязательна для заполнения');
        return;
    }
    
    if (!model) {
        showFieldError('model', 'Модель обязательна для заполнения');
        return;
    }
    
    if (!ownerId || isNaN(ownerId)) {
        showFieldError('ownerId', 'ID владельца обязателен и должен быть числом');
        return;
    }
    
    const formData = {
        licensePlate: licensePlate,
        brand: brand,
        model: model,
        year: year,
        ownerId: ownerId
    };
    
    try {
        const response = await fetch('/api/vehicles', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Автомобиль успешно добавлен!', 'success');
            document.getElementById('addVehicleForm').reset();
            vehiclesSorted = false;
            const btn = document.getElementById('sortVehiclesBtn');
            if (btn) {
                btn.textContent = '🔤 Сортировать по алфавиту';
                btn.style.background = '#6c757d';
            }
            loadVehicles();
            loadStatistics();
        } else {
            // Показываем ошибку рядом с полем
            if (result.field) {
                showFieldError(result.field, result.error);
            } else {
                showAlert('Ошибка: ' + result.error, 'error');
            }
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Загрузка нарушений
async function loadViolations() {
    try {
        const response = await fetch('/api/violations');
        const violations = await response.json();
        violationsData = violations;
        
        renderViolationsTable();
        updateAuthUI();
    } catch (error) {
        console.error('Ошибка загрузки нарушений:', error);
        document.getElementById('violationsList').innerHTML = '<p class="alert error">Ошибка загрузки данных</p>';
    }
}

// Отрисовка таблицы нарушений
function renderViolationsTable() {
    let violations = violationsSorted ? [...violationsData].sort((a, b) => {
        const typeA = (a.violation_type || '').toLowerCase();
        const typeB = (b.violation_type || '').toLowerCase();
        return typeA.localeCompare(typeB, 'ru');
    }) : violationsData;
    
    let html = '';
    if (violations.length > 0) {
        html = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Водитель</th>
                        <th>Автомобиль</th>
                        <th>Тип нарушения</th>
                        <th>Штраф</th>
                        <th>Статус</th>
                        <th>Дата</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${violations.map(violation => `
                        <tr>
                            <td>${violation.id}</td>
                            <td>${violation.full_name || `ID: ${violation.driver_id}`}</td>
                            <td>${violation.license_plate ? `${violation.license_plate} (${violation.brand} ${violation.model})` : `ID: ${violation.vehicle_id}`}</td>
                            <td>${violation.violation_type}</td>
                            <td>${violation.fine_amount} руб.</td>
                            <td>${violation.status}</td>
                            <td>${new Date(violation.violation_date).toLocaleDateString()}</td>
                            <td class="actions">
                                <button class="btn-edit" onclick="editViolation(${violation.id})" title="Редактировать">✏️</button>
                                <button class="btn-delete" onclick="deleteViolation(${violation.id})" title="Удалить">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        html = '<p>Нет зарегистрированных нарушений</p>';
    }
    
    document.getElementById('violationsList').innerHTML = html;
    updateAuthUI();
}

// Сортировка нарушений
function sortViolations() {
    violationsSorted = !violationsSorted;
    const btn = document.getElementById('sortViolationsBtn');
    btn.textContent = violationsSorted ? '🔤 Отменить сортировку' : '🔤 Сортировать по алфавиту';
    btn.style.background = violationsSorted ? '#28a745' : '#6c757d';
    renderViolationsTable();
}

// Добавление нарушения
async function addViolation(event) {
    event.preventDefault();
    
    const formData = {
        driverId: parseInt(document.getElementById('violationDriverId').value),
        vehicleId: parseInt(document.getElementById('violationVehicleId').value),
        violationType: document.getElementById('violationType').value,
        fineAmount: parseFloat(document.getElementById('violationFine').value)
    };
    
    try {
        const response = await fetch('/api/violations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Нарушение успешно добавлено!', 'success');
            document.getElementById('addViolationForm').reset();
            violationsSorted = false;
            const btn = document.getElementById('sortViolationsBtn');
            if (btn) {
                btn.textContent = '🔤 Сортировать по алфавиту';
                btn.style.background = '#6c757d';
            }
            loadViolations();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Поиск водителей
async function searchDrivers(event) {
    event.preventDefault();
    
    const searchType = document.getElementById('searchType').value;
    const searchValue = document.getElementById('searchValue').value;
    
    try {
        const response = await fetch(`/api/search/drivers?type=${searchType}&value=${encodeURIComponent(searchValue)}`);
        const drivers = await response.json();
        
        let html = '';
        if (drivers.length > 0) {
            html = `
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>ФИО</th>
                            <th>Номер прав</th>
                            <th>Адрес</th>
                            <th>Телефон</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${drivers.map(driver => `
                            <tr>
                                <td>${driver.id}</td>
                                <td>${driver.full_name}</td>
                                <td>${driver.license_number}</td>
                                <td>${driver.address || '-'}</td>
                                <td>${driver.phone || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html = '<p>Водители не найдены</p>';
        }
        
        document.getElementById('searchResults').innerHTML = html;
    } catch (error) {
        console.error('Ошибка поиска:', error);
        document.getElementById('searchResults').innerHTML = '<p class="alert error">Ошибка поиска</p>';
    }
}

// Вспомогательная функция для показа уведомлений
function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${type}`;
    alertDiv.textContent = message;
    
    // Добавляем уведомление в начало активной секции
    const currentSection = document.querySelector('.section.active');
    currentSection.insertBefore(alertDiv, currentSection.firstChild);
    
    // Удаляем уведомление через 5 секунд
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Функции для работы с ошибками полей
function showFieldError(fieldName, message) {
    // Маппинг названий полей на ID элементов
    const fieldMapping = {
        'licensePlate': 'vehiclePlate',
        'ownerId': 'vehicleOwnerId',
        'brand': 'vehicleBrand',
        'model': 'vehicleModel',
        'fullName': 'driverName',
        'licenseNumber': 'driverLicense'
    };
    
    const fieldId = fieldMapping[fieldName] || fieldName;
    const field = document.getElementById(fieldId);
    
    if (field) {
        // Добавляем класс ошибки
        field.classList.add('field-error');
        
        // Удаляем предыдущую ошибку для этого поля
        const existingError = field.parentNode.querySelector('.field-error-message');
        if (existingError) {
            existingError.remove();
        }
        
        // Создаем сообщение об ошибке
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error-message';
        errorDiv.textContent = message;
        
        // Вставляем сообщение после поля
        field.parentNode.insertBefore(errorDiv, field.nextSibling);
        
        // Фокусируемся на поле с ошибкой
        field.focus();
    } else {
        // Если поле не найдено, показываем общее уведомление
        showAlert('Ошибка: ' + message, 'error');
    }
}

function clearFieldErrors() {
    // Убираем классы ошибок со всех полей
    document.querySelectorAll('.field-error').forEach(field => {
        field.classList.remove('field-error');
    });
    
    // Удаляем все сообщения об ошибках
    document.querySelectorAll('.field-error-message').forEach(error => {
        error.remove();
    });
}

// Функции для работы с модальными окнами
function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Функции редактирования водителей
async function editDriver(id) {
    try {
        const response = await fetch('/api/drivers');
        const drivers = await response.json();
        const driver = drivers.find(d => d.id === id);
        
        if (driver) {
            document.getElementById('editDriverId').value = driver.id;
            document.getElementById('editDriverName').value = driver.full_name;
            document.getElementById('editDriverLicense').value = driver.license_number;
            document.getElementById('editDriverAddress').value = driver.address || '';
            document.getElementById('editDriverPhone').value = driver.phone || '';
            openModal('editDriverModal');
        }
    } catch (error) {
        showAlert('Ошибка загрузки данных водителя', 'error');
    }
}

async function updateDriver(event) {
    event.preventDefault();
    
    const id = document.getElementById('editDriverId').value;
    const formData = {
        fullName: document.getElementById('editDriverName').value,
        licenseNumber: document.getElementById('editDriverLicense').value,
        address: document.getElementById('editDriverAddress').value,
        phone: document.getElementById('editDriverPhone').value
    };
    
    try {
        const response = await fetch(`/api/drivers/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Водитель успешно обновлен!', 'success');
            closeModal('editDriverModal');
            loadDrivers();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

async function deleteDriver(id) {
    currentDeleteAction = () => deleteDriverConfirm(id);
    document.getElementById('deleteConfirmMessage').textContent = 'Вы уверены, что хотите удалить этого водителя?';
    openModal('deleteConfirmModal');
}

async function deleteDriverConfirm(id) {
    try {
        const response = await fetch(`/api/drivers/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Водитель успешно удален!', 'success');
            closeModal('deleteConfirmModal');
            loadDrivers();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Функции редактирования автомобилей
async function editVehicle(id) {
    try {
        const response = await fetch('/api/vehicles');
        const vehicles = await response.json();
        const vehicle = vehicles.find(v => v.id === id);
        
        if (vehicle) {
            document.getElementById('editVehicleId').value = vehicle.id;
            document.getElementById('editVehiclePlate').value = vehicle.license_plate;
            document.getElementById('editVehicleBrand').value = vehicle.brand;
            document.getElementById('editVehicleModel').value = vehicle.model;
            document.getElementById('editVehicleYear').value = vehicle.year || '';
            document.getElementById('editVehicleOwnerId').value = vehicle.owner_id;
            openModal('editVehicleModal');
        }
    } catch (error) {
        showAlert('Ошибка загрузки данных автомобиля', 'error');
    }
}

async function updateVehicle(event) {
    event.preventDefault();
    
    const id = document.getElementById('editVehicleId').value;
    const formData = {
        licensePlate: document.getElementById('editVehiclePlate').value,
        brand: document.getElementById('editVehicleBrand').value,
        model: document.getElementById('editVehicleModel').value,
        year: parseInt(document.getElementById('editVehicleYear').value) || null,
        ownerId: parseInt(document.getElementById('editVehicleOwnerId').value)
    };
    
    try {
        const response = await fetch(`/api/vehicles/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Автомобиль успешно обновлен!', 'success');
            closeModal('editVehicleModal');
            loadVehicles();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

async function deleteVehicle(id) {
    currentDeleteAction = () => deleteVehicleConfirm(id);
    document.getElementById('deleteConfirmMessage').textContent = 'Вы уверены, что хотите удалить этот автомобиль?';
    openModal('deleteConfirmModal');
}

async function deleteVehicleConfirm(id) {
    try {
        const response = await fetch(`/api/vehicles/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Автомобиль успешно удален!', 'success');
            closeModal('deleteConfirmModal');
            loadVehicles();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Функции редактирования нарушений
async function editViolation(id) {
    try {
        const response = await fetch('/api/violations');
        const violations = await response.json();
        const violation = violations.find(v => v.id === id);
        
        if (violation) {
            document.getElementById('editViolationId').value = violation.id;
            document.getElementById('editViolationDriverId').value = violation.driver_id;
            document.getElementById('editViolationVehicleId').value = violation.vehicle_id;
            document.getElementById('editViolationType').value = violation.violation_type;
            document.getElementById('editViolationFine').value = violation.fine_amount;
            document.getElementById('editViolationStatus').value = violation.status;
            openModal('editViolationModal');
        }
    } catch (error) {
        showAlert('Ошибка загрузки данных нарушения', 'error');
    }
}

async function updateViolation(event) {
    event.preventDefault();
    
    const id = document.getElementById('editViolationId').value;
    const formData = {
        driverId: parseInt(document.getElementById('editViolationDriverId').value),
        vehicleId: parseInt(document.getElementById('editViolationVehicleId').value),
        violationType: document.getElementById('editViolationType').value,
        fineAmount: parseFloat(document.getElementById('editViolationFine').value),
        status: document.getElementById('editViolationStatus').value
    };
    
    try {
        const response = await fetch(`/api/violations/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Нарушение успешно обновлено!', 'success');
            closeModal('editViolationModal');
            loadViolations();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

async function deleteViolation(id) {
    currentDeleteAction = () => deleteViolationConfirm(id);
    document.getElementById('deleteConfirmMessage').textContent = 'Вы уверены, что хотите удалить это нарушение?';
    openModal('deleteConfirmModal');
}

async function deleteViolationConfirm(id) {
    try {
        const response = await fetch(`/api/violations/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Нарушение успешно удалено!', 'success');
            closeModal('deleteConfirmModal');
            loadViolations();
            loadStatistics();
        } else {
            showAlert('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Ошибка сети: ' + error.message, 'error');
    }
}

// Функция подтверждения удаления
function confirmDelete() {
    if (currentDeleteAction) {
        currentDeleteAction();
        currentDeleteAction = null;
    }
}

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// ===================== Пользователи =====================
// Загрузка пользователей
async function loadUsers() {
    try {
        const res = await fetch('/api/users');
        if (res.status === 401) {
            showAlert('Требуется авторизация', 'error');
            return;
        }
        const users = await res.json();
        let html = '';
        if (users.length > 0) {
            html = `
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Email</th>
                            <th>Имя</th>
                            <th>Дата</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(u => `
                            <tr>
                                <td>${u.id}</td>
                                <td>${u.email}</td>
                                <td>${u.name || '-'}</td>
                                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                                <td class="actions">
                                    <button class="btn-delete" onclick="deleteUser(${u.id})" title="Удалить" ${currentUser && currentUser.id === u.id ? 'disabled' : ''}>🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html = '<p>Пользователи не найдены</p>';
        }
        document.getElementById('usersList').innerHTML = html;
        updateAuthUI();
    } catch (e) {
        document.getElementById('usersList').innerHTML = '<p class="alert error">Ошибка загрузки пользователей</p>';
    }
}

async function deleteUser(id) {
    if (!currentUser) return showAlert('Требуется авторизация', 'error');
    if (id === currentUser.id) return showAlert('Нельзя удалить себя', 'error');
    currentDeleteAction = () => deleteUserConfirm(id);
    document.getElementById('deleteConfirmMessage').textContent = 'Вы уверены, что хотите удалить этого пользователя?';
    openModal('deleteConfirmModal');
}

async function deleteUserConfirm(id) {
    try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return showAlert(data.error || 'Ошибка удаления', 'error');
        showAlert('Пользователь удален', 'success');
        closeModal('deleteConfirmModal');
        loadUsers();
    } catch (e) {
        showAlert('Ошибка сети', 'error');
    }
}