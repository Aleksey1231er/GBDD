const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
// Экспорт документов
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } = require('docx');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Конфиг
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRES = '7d';

// Инициализация базы данных
const db = new sqlite3.Database('./data/gibdd.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключение к SQLite базе данных установлено');
        initDatabase();
    }
});

// Инициализация таблиц
function initDatabase() {
    const driversTable = `
        CREATE TABLE IF NOT EXISTS drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            license_number TEXT UNIQUE NOT NULL,
            address TEXT,
            phone TEXT,
            created_date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const vehiclesTable = `
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_plate TEXT UNIQUE NOT NULL,
            brand TEXT NOT NULL,
            model TEXT NOT NULL,
            year INTEGER,
            owner_id INTEGER,
            created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES drivers (id)
        )
    `;

    const violationsTable = `
        CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id INTEGER,
            vehicle_id INTEGER,
            violation_type TEXT NOT NULL,
            fine_amount DECIMAL(10,2),
            violation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'Не оплачен',
            FOREIGN KEY (driver_id) REFERENCES drivers (id),
            FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
        )
    `;

    const usersTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT,
            avatar TEXT,
            address TEXT,
            phone TEXT,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.run(driversTable);
    db.run(vehiclesTable);
    db.run(violationsTable);
    db.run(usersTable);

    // Добавляем отсутствующие колонки, если таблица уже существовала
    const addColumn = (column, type) => {
        db.run(`ALTER TABLE users ADD COLUMN ${column} ${type}`, (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.warn('Ошибка добавления колонки', column, err.message);
            }
        });
    };
    addColumn('avatar', 'TEXT');
    addColumn('address', 'TEXT');
    addColumn('phone', 'TEXT');
    addColumn('role', 'TEXT');

    // Инициализация администратора через переменные окружения (опционально)
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
        const pwdHash = bcrypt.hashSync(adminPassword, 10);
        db.get(`SELECT id FROM users WHERE email = ?`, [adminEmail.trim().toLowerCase()], (err, row) => {
            if (err) return;
            if (row) {
                db.run(`UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?`, [pwdHash, row.id]);
            } else {
                db.run(`INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'admin')`, [adminEmail.trim().toLowerCase(), pwdHash, 'Admin']);
            }
        });
    }

    // Добавляем тестовые данные
    addTestData();
}
// ================== Авторизация ==================
function signToken(user) {
    return jwt.sign({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, address: user.address, phone: user.phone, role: user.role || 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function setAuthCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

function clearAuthCookie(res) {
    res.clearCookie('token');
}

function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, function() {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен' });
        next();
    });
}

// Регистрация
app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });

    const passwordHash = bcrypt.hashSync(password, 10);
    const sql = `INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)`;
    db.run(sql, [email.trim().toLowerCase(), passwordHash, name || null], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }
            return res.status(500).json({ error: err.message });
        }
        const user = { id: this.lastID, email: email.trim().toLowerCase(), name: name || null, avatar: null, address: null, phone: null, role: 'user' };
        const token = signToken(user);
        setAuthCookie(res, token);
        return res.json({ user });
    });
});

// Вход
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
    db.get(`SELECT * FROM users WHERE email = ?`, [email.trim().toLowerCase()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(400).json({ error: 'Неверные учетные данные' });
        const ok = bcrypt.compareSync(password, row.password_hash);
        if (!ok) return res.status(400).json({ error: 'Неверные учетные данные' });
        const user = { id: row.id, email: row.email, name: row.name, avatar: row.avatar, address: row.address, phone: row.phone, role: row.role || 'user' };
        const token = signToken(user);
        setAuthCookie(res, token);
        return res.json({ user });
    });
});

// Выход
app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
});

// Текущий пользователь
app.get('/api/auth/me', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ user: null });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return res.json({ user: { id: payload.id, email: payload.email, name: payload.name, avatar: payload.avatar || null, address: payload.address || null, phone: payload.phone || null, role: payload.role || 'user' } });
    } catch (e) {
        return res.json({ user: null });
    }
});

// ===== Пользователи (админ-функционал базовый) =====
// Список пользователей (только админ)
app.get('/api/users', requireAdmin, (req, res) => {
    const sql = `SELECT id, email, name, created_at FROM users ORDER BY id DESC`;
    db.all(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Профиль текущего пользователя: обновление основных данных
app.put('/api/profile', requireAuth, (req, res) => {
    const { name, address, phone, avatar } = req.body;
    let avatarToSave = avatar || null;
    try {
        if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
            const match = avatar.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
            if (match) {
                const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
                const base64 = match[3];
                const buffer = Buffer.from(base64, 'base64');
                const uploadsDir = path.join(__dirname, 'public', 'uploads');
                if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
                const filepath = path.join(uploadsDir, filename);
                fs.writeFileSync(filepath, buffer);
                avatarToSave = `/uploads/${filename}`;
            }
        }
    } catch (e) {
        return res.status(400).json({ error: 'Не удалось сохранить изображение' });
    }
    const sql = `UPDATE users SET name = ?, address = ?, phone = ?, avatar = ? WHERE id = ?`;
    db.run(sql, [name || null, address || null, phone || null, avatarToSave || null, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        // Возвращаем свежие данные пользователя
        db.get(`SELECT id, email, name, avatar, address, phone FROM users WHERE id = ?`, [req.user.id], (e, row) => {
            if (e) return res.status(500).json({ error: e.message });
            const token = signToken(row);
            setAuthCookie(res, token);
            res.json({ user: row });
        });
    });
});

// Удаление пользователя (только админ, нельзя удалить себя)
app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === parseInt(req.user.id)) {
        return res.status(400).json({ error: 'Нельзя удалить собственного пользователя' });
    }
    db.run(`DELETE FROM users WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json({ ok: true });
    });
});

function addTestData() {
    // Проверяем, есть ли уже данные
    db.get("SELECT COUNT(*) as count FROM drivers", (err, row) => {
        if (err) return;
        
        if (row.count === 0) {
            const testDrivers = [
                ['Иванов Иван Иванович', 'АВ123456', 'г. Москва, ул. Ленина, 1', '+79161234567'],
                ['Петров Петр Петрович', 'ВС654321', 'г. Москва, ул. Пушкина, 10', '+79167654321']
            ];

            testDrivers.forEach(driver => {
                db.run(
                    "INSERT INTO drivers (full_name, license_number, address, phone) VALUES (?, ?, ?, ?)",
                    driver
                );
            });

            const testVehicles = [
                ['А123БВ77', 'Lada', 'Vesta', 2020, 1],
                ['В456СЕ77', 'Kia', 'Rio', 2021, 2]
            ];

            testVehicles.forEach(vehicle => {
                db.run(
                    "INSERT INTO vehicles (license_plate, brand, model, year, owner_id) VALUES (?, ?, ?, ?, ?)",
                    vehicle
                );
            });

            console.log('Тестовые данные добавлены');
        }
    });
}

// API Routes

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Получить всех водителей
app.get('/api/drivers', (req, res) => {
    db.all("SELECT * FROM drivers ORDER BY id DESC", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Добавить водителя (требуется авторизация)
app.post('/api/drivers', requireAuth, (req, res) => {
    const { fullName, licenseNumber, address, phone } = req.body;
    
    db.run(
        "INSERT INTO drivers (full_name, license_number, address, phone) VALUES (?, ?, ?, ?)",
        [fullName, licenseNumber, address, phone],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, message: 'Водитель успешно добавлен' });
        }
    );
});

// Получить все автомобили
app.get('/api/vehicles', (req, res) => {
    const sql = `
        SELECT v.*, d.full_name as owner_name 
        FROM vehicles v 
        LEFT JOIN drivers d ON v.owner_id = d.id 
        ORDER BY v.id DESC
    `;
    
    db.all(sql, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Добавить автомобиль (требуется авторизация)
app.post('/api/vehicles', requireAuth, (req, res) => {
    const { licensePlate, brand, model, year, ownerId } = req.body;
    
    db.run(
        "INSERT INTO vehicles (license_plate, brand, model, year, owner_id) VALUES (?, ?, ?, ?, ?)",
        [licensePlate, brand, model, year, ownerId],
        function(err) {
            if (err) {
                // Обработка специфических ошибок
                if (err.message.includes('UNIQUE constraint failed: vehicles.license_plate')) {
                    res.status(400).json({ 
                        error: 'Автомобиль с таким госномером уже существует',
                        field: 'licensePlate'
                    });
                } else if (err.message.includes('FOREIGN KEY constraint failed')) {
                    res.status(400).json({ 
                        error: 'Водитель с указанным ID не найден',
                        field: 'ownerId'
                    });
                } else {
                    res.status(500).json({ error: err.message });
                }
                return;
            }
            res.json({ id: this.lastID, message: 'Автомобиль успешно добавлен' });
        }
    );
});

// Добавить нарушение (требуется авторизация)
app.post('/api/violations', requireAuth, (req, res) => {
    const { driverId, vehicleId, violationType, fineAmount } = req.body;
    
    db.run(
        "INSERT INTO violations (driver_id, vehicle_id, violation_type, fine_amount) VALUES (?, ?, ?, ?)",
        [driverId, vehicleId, violationType, fineAmount],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, message: 'Нарушение успешно добавлено' });
        }
    );
});

// Поиск водителей
app.get('/api/search/drivers', (req, res) => {
    const { type, value } = req.query;
    
    let sql = "SELECT * FROM drivers WHERE ";
    if (type === 'name') {
        sql += "full_name LIKE ?";
    } else {
        sql += "license_number LIKE ?";
    }
    
    db.all(sql, [`%${value}%`], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Получить статистику
app.get('/api/statistics', (req, res) => {
    const queries = {
        drivers: "SELECT COUNT(*) as count FROM drivers",
        vehicles: "SELECT COUNT(*) as count FROM vehicles",
        violations: "SELECT COUNT(*) as count, SUM(fine_amount) as total_fines FROM violations",
        recentViolations: `
            SELECT v.*, d.full_name, ve.license_plate 
            FROM violations v 
            LEFT JOIN drivers d ON v.driver_id = d.id 
            LEFT JOIN vehicles ve ON v.vehicle_id = ve.id 
            ORDER BY v.violation_date DESC LIMIT 5
        `
    };

    const results = {};
    let completed = 0;

    for (const [key, query] of Object.entries(queries)) {
        db.get(query, (err, row) => {
            if (!err) results[key] = row;
            completed++;
            
            if (completed === Object.keys(queries).length) {
                res.json(results);
            }
        });
    }
});

// Получить все нарушения
app.get('/api/violations', (req, res) => {
    const sql = `
        SELECT v.*, d.full_name, ve.license_plate, ve.brand, ve.model 
        FROM violations v 
        LEFT JOIN drivers d ON v.driver_id = d.id 
        LEFT JOIN vehicles ve ON v.vehicle_id = ve.id 
        ORDER BY v.violation_date DESC
    `;
    
    db.all(sql, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Обновить водителя (требуется авторизация)
app.put('/api/drivers/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { fullName, licenseNumber, address, phone } = req.body;
    
    db.run(
        "UPDATE drivers SET full_name = ?, license_number = ?, address = ?, phone = ? WHERE id = ?",
        [fullName, licenseNumber, address, phone, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Водитель успешно обновлен' });
        }
    );
});

// Удалить водителя (требуется авторизация)
app.delete('/api/drivers/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM drivers WHERE id = ?", [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Водитель успешно удален' });
    });
});

// Обновить автомобиль (требуется авторизация)
app.put('/api/vehicles/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { licensePlate, brand, model, year, ownerId } = req.body;
    
    db.run(
        "UPDATE vehicles SET license_plate = ?, brand = ?, model = ?, year = ?, owner_id = ? WHERE id = ?",
        [licensePlate, brand, model, year, ownerId, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Автомобиль успешно обновлен' });
        }
    );
});

// Удалить автомобиль (требуется авторизация)
app.delete('/api/vehicles/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Автомобиль успешно удален' });
    });
});

// Обновить нарушение (требуется авторизация)
app.put('/api/violations/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { driverId, vehicleId, violationType, fineAmount, status } = req.body;
    
    db.run(
        "UPDATE violations SET driver_id = ?, vehicle_id = ?, violation_type = ?, fine_amount = ?, status = ? WHERE id = ?",
        [driverId, vehicleId, violationType, fineAmount, status, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Нарушение успешно обновлено' });
        }
    );
});

// Удалить нарушение (требуется авторизация)
app.delete('/api/violations/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM violations WHERE id = ?", [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Нарушение успешно удалено' });
    });
});

// ===================== Экспорт документов =====================
// Универсальный эндпоинт экспорта: принимает колонки и строки, возвращает файл указанного формата
app.post('/api/export', (req, res) => {
    try {
        const { title, format, columns, rows } = req.body || {};
        if (!Array.isArray(columns) || !Array.isArray(rows)) {
            return res.status(400).json({ error: 'Некорректные данные для экспорта' });
        }
        const safeTitle = String(title || 'export').replace(/[^\wа-яА-Я\- _]+/g, '').trim() || 'export';

        if (format === 'txt') {
            const header = columns.map(c => c.title).join('\t');
            const lines = rows.map(r => columns.map(c => (r[c.key] ?? '').toString().replace(/\n/g, ' ')).join('\t'));
            const content = [header, ...lines].join('\n');
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
            return res.send(content);
        }

        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            const asciiNamePdf = 'export.pdf';
            const utfNamePdf = encodeURIComponent(`${safeTitle}.pdf`);
            res.setHeader('Content-Disposition', `attachment; filename="${asciiNamePdf}"; filename*=UTF-8''${utfNamePdf}`);
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            doc.pipe(res);
            doc.fontSize(16).text(title || 'Экспорт данных', { align: 'left' });
            doc.moveDown();

            // Простейшая табличная отрисовка: заголовки + строки с разделителями
            const colWidths = columns.map(() => Math.floor((doc.page.width - doc.page.margins.left - doc.page.margins.right) / columns.length));
            const drawRow = (cells, isHeader) => {
                cells.forEach((cell, idx) => {
                    const text = String(cell ?? '');
                    const opts = { width: colWidths[idx], continued: idx < cells.length - 1 };
                    if (isHeader) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
                    doc.fontSize(10).text(text, opts);
                });
                doc.moveDown(0.5);
            };
            try {
                drawRow(columns.map(c => c.title), true);
                rows.forEach(r => drawRow(columns.map(c => r[c.key] ?? ''), false));
            } catch (e) {
                console.error('PDF export error:', e);
                doc.text('Ошибка формирования PDF');
            }

            doc.end();
            return;
        }

        if (format === 'docx') {
            try {
                const tableRows = [];
                // Header (bold)
                tableRows.push(new TableRow({
                    children: columns.map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(c.title || ''), bold: true })] })] }))
                }));
                // Body
                rows.forEach(r => {
                    tableRows.push(new TableRow({
                        children: columns.map(c => new TableCell({ children: [new Paragraph(String(r[c.key] ?? ''))] }))
                    }));
                });
                const docx = new Document({
                    sections: [
                        {
                            properties: {},
                            children: [
                                new Paragraph({ children: [new TextRun({ text: title || 'Экспорт данных', bold: true, size: 28 })] }),
                                new Paragraph({ text: ' ' }),
                                new Table({ rows: tableRows })
                            ]
                        }
                    ]
                });
                Packer.toBuffer(docx).then(buffer => {
                    const buf = Buffer.from(buffer);
                    const asciiName = 'export.docx';
                    const utfName = encodeURIComponent(`${safeTitle}.docx`);
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${utfName}`);
                    res.setHeader('Content-Length', String(buf.length));
                    res.send(buf);
                }).catch((err) => {
                    console.error('DOCX pack error:', err);
                    res.status(500).json({ error: 'Ошибка формирования DOCX' });
                });
            } catch (e) {
                console.error('DOCX export error:', e);
                return res.status(500).json({ error: 'Ошибка формирования DOCX' });
            }
            return;
        }

        return res.status(400).json({ error: 'Неподдерживаемый формат' });
    } catch (e) {
        console.error('Export endpoint error:', e);
        return res.status(500).json({ error: 'Ошибка экспорта' });
    }
});

// Функция для получения IP-адреса
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Запуск сервера
const HOST = '0.0.0.0'; // Слушаем на всех интерфейсах
app.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    
    console.log('='.repeat(50));
    console.log('🚓 Сервер ГИБДД успешно запущен!');
    console.log('='.repeat(50));
    console.log(`🏠 Локальный доступ: http://localhost:${PORT}`);
    console.log(`🌐 Сетевой доступ:   http://${localIP}:${PORT}`);
    console.log('='.repeat(50));
    console.log('📱 Для доступа с других устройств:');
    console.log(`   1. Убедитесь, что устройства в одной сети`);
    console.log(`   2. Откройте порт ${PORT} в брандмауэре`);
    console.log(`   3. Используйте адрес: http://${localIP}:${PORT}`);
    console.log('='.repeat(50));
    console.log('🛑 Для остановки нажмите Ctrl+C');
    console.log('');
});