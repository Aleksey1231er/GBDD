const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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
            approval_status TEXT DEFAULT 'approved',
            created_by INTEGER,
            approved_by INTEGER,
            approved_at DATETIME,
            FOREIGN KEY (driver_id) REFERENCES drivers (id),
            FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
            FOREIGN KEY (created_by) REFERENCES users (id),
            FOREIGN KEY (approved_by) REFERENCES users (id)
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
            is_deleted INTEGER DEFAULT 0,
            deleted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.run(driversTable);
    db.run(vehiclesTable);
    db.run(usersTable);
    db.run(violationsTable);

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
    addColumn('is_deleted', 'INTEGER DEFAULT 0');
    addColumn('deleted_at', 'DATETIME');

    const addViolationColumn = (column, type, postQuery) => {
        db.run(`ALTER TABLE violations ADD COLUMN ${column} ${type}`, (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.warn('Ошибка добавления колонки нарушений', column, err.message);
            } else if (!err && postQuery) {
                db.run(postQuery, () => {});
            }
        });
    };
    addViolationColumn('approval_status', "TEXT DEFAULT 'approved'", "UPDATE violations SET approval_status = 'approved' WHERE approval_status IS NULL");
    addViolationColumn('created_by', 'INTEGER', null);
    addViolationColumn('approved_by', 'INTEGER', null);
    addViolationColumn('approved_at', 'DATETIME', null);

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
    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }
    db.get(
        `SELECT id, email, name, avatar, address, phone, role, is_deleted FROM users WHERE id = ?`,
        [payload.id],
        (err, row) => {
            if (err) return res.status(500).json({ error: 'Ошибка проверки пользователя' });
            if (!row || row.is_deleted) {
                clearAuthCookie(res);
                return res.status(401).json({ error: 'Пользователь деактивирован' });
            }
            req.user = {
                id: row.id,
                email: row.email,
                name: row.name,
                avatar: row.avatar,
                address: row.address,
                phone: row.phone,
                role: row.role || 'user'
            };
            next();
        }
    );
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
        if (row.is_deleted) return res.status(403).json({ error: 'Учетная запись деактивирована администратором' });
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
        db.get(
            `SELECT id, email, name, avatar, address, phone, role, is_deleted FROM users WHERE id = ?`,
            [payload.id],
            (err, row) => {
                if (err || !row || row.is_deleted) {
                    clearAuthCookie(res);
                    return res.json({ user: null });
                }
                return res.json({
                    user: {
                        id: row.id,
                        email: row.email,
                        name: row.name,
                        avatar: row.avatar || null,
                        address: row.address || null,
                        phone: row.phone || null,
                        role: row.role || 'user'
                    }
                });
            }
        );
    } catch (e) {
        clearAuthCookie(res);
        return res.json({ user: null });
    }
});

// ===== Пользователи (админ-функционал базовый) =====
// Список пользователей (только админ)
app.get('/api/users', requireAdmin, (req, res) => {
    const sql = `
        SELECT id, email, name, role, address, phone, created_at, is_deleted, deleted_at
        FROM users
        ORDER BY is_deleted ASC, id DESC
    `;
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
        db.get(`SELECT id, email, name, avatar, address, phone, role FROM users WHERE id = ?`, [req.user.id], (e, row) => {
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
    db.get(`SELECT id, is_deleted FROM users WHERE id = ?`, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Пользователь не найден' });
        if (row.is_deleted) return res.status(400).json({ error: 'Пользователь уже деактивирован' });
        db.run(`UPDATE users SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ ok: true, message: 'Пользователь деактивирован' });
        });
    });
});

app.patch('/api/users/:id/restore', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT id, is_deleted FROM users WHERE id = ?`, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Пользователь не найден' });
        if (!row.is_deleted) return res.status(400).json({ error: 'Пользователь уже активен' });
        db.run(`UPDATE users SET is_deleted = 0, deleted_at = NULL WHERE id = ?`, [id], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ ok: true, message: 'Пользователь восстановлен' });
        });
    });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { email, name, role, address, phone } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
    if (!normalizedEmail) return res.status(400).json({ error: 'Email обязателен' });
    const safeRole = role === 'admin' ? 'admin' : 'user';

    db.get(`SELECT id, is_deleted FROM users WHERE id = ?`, [id], (err, userRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!userRow) return res.status(404).json({ error: 'Пользователь не найден' });
        db.get(`SELECT id FROM users WHERE email = ? AND id <> ?`, [normalizedEmail, id], (dupErr, dupRow) => {
            if (dupErr) return res.status(500).json({ error: dupErr.message });
            if (dupRow) return res.status(400).json({ error: 'Пользователь с таким email уже существует' });

            db.run(
                `UPDATE users
                 SET email = ?, name = ?, role = ?, address = ?, phone = ?
                 WHERE id = ?`,
                [
                    normalizedEmail,
                    name ? name.trim() : null,
                    safeRole,
                    address ? address.trim() : null,
                    phone ? phone.trim() : null,
                    id
                ],
                function(updateErr) {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    db.get(
                        `SELECT id, email, name, role, address, phone, created_at, is_deleted, deleted_at
                         FROM users WHERE id = ?`,
                        [id],
                        (finalErr, updatedRow) => {
                            if (finalErr) return res.status(500).json({ error: finalErr.message });
                            res.json({ ok: true, user: updatedRow });
                        }
                    );
                }
            );
        });
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
    if (!driverId || !vehicleId || !violationType) {
        return res.status(400).json({ error: 'Необходимо указать водителя, автомобиль и тип нарушения' });
    }

    const driver = Number(driverId);
    const vehicle = Number(vehicleId);
    if (!Number.isFinite(driver) || !Number.isFinite(vehicle)) {
        return res.status(400).json({ error: 'Некорректные идентификаторы водителя или автомобиля' });
    }

    const isAdmin = req.user.role === 'admin';
    const approvalStatus = isAdmin ? 'approved' : 'pending';
    const statusValue = isAdmin ? 'Не оплачен' : 'Ожидает утверждения';
    const approvedBy = isAdmin ? req.user.id : null;
    const approvedAt = isAdmin ? new Date().toISOString() : null;
    const fineValue = typeof fineAmount === 'number' && Number.isFinite(fineAmount) ? fineAmount : null;

    db.run(
        `INSERT INTO violations (driver_id, vehicle_id, violation_type, fine_amount, status, created_by, approval_status, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [driver, vehicle, violationType, fineValue, statusValue, req.user.id, approvalStatus, approvedBy, approvedAt],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const message = isAdmin ? 'Нарушение успешно добавлено' : 'Нарушение отправлено на утверждение администратору';
            res.json({ id: this.lastID, message, approvalStatus });
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
        violations: "SELECT COUNT(*) as count, SUM(fine_amount) as total_fines FROM violations WHERE approval_status = 'approved'",
        recentViolations: `
            SELECT v.*, d.full_name, ve.license_plate 
            FROM violations v 
            LEFT JOIN drivers d ON v.driver_id = d.id 
            LEFT JOIN vehicles ve ON v.vehicle_id = ve.id 
            WHERE v.approval_status = 'approved'
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
        SELECT 
            v.*, 
            d.full_name, 
            ve.license_plate, 
            ve.brand, 
            ve.model,
            creator.name AS creator_name,
            creator.email AS creator_email,
            approver.name AS approver_name,
            approver.email AS approver_email
        FROM violations v 
        LEFT JOIN drivers d ON v.driver_id = d.id 
        LEFT JOIN vehicles ve ON v.vehicle_id = ve.id 
        LEFT JOIN users creator ON creator.id = v.created_by
        LEFT JOIN users approver ON approver.id = v.approved_by
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

    db.get(`SELECT * FROM violations WHERE id = ?`, [id], (err, violation) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!violation) return res.status(404).json({ error: 'Нарушение не найдено' });

        const isAdmin = req.user.role === 'admin';
        const isCreator = violation.created_by && Number(violation.created_by) === Number(req.user.id);
        if (!isAdmin) {
            if (!isCreator) {
                return res.status(403).json({ error: 'Недостаточно прав для редактирования нарушения' });
            }
            if (violation.approval_status !== 'pending') {
                return res.status(403).json({ error: 'Редактирование возможно только до утверждения администратора' });
            }
        }

        const normalizeInt = (value, fallback) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        };
        const normalizeNumber = (value, fallback) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        };

        const targetDriver = normalizeInt(driverId, violation.driver_id);
        const targetVehicle = normalizeInt(vehicleId, violation.vehicle_id);
        const targetType = violationType ?? violation.violation_type;
        const targetFine = normalizeNumber(fineAmount, violation.fine_amount);
        const targetStatus = isAdmin ? (status || violation.status) : 'Ожидает утверждения';

        let targetApproval = violation.approval_status || 'approved';
        let targetApprovedBy = violation.approved_by || null;
        let targetApprovedAt = violation.approved_at || null;
        if (!isAdmin) {
            targetApproval = 'pending';
            targetApprovedBy = null;
            targetApprovedAt = null;
        }

        db.run(
            `UPDATE violations
             SET driver_id = ?, vehicle_id = ?, violation_type = ?, fine_amount = ?, status = ?, approval_status = ?, approved_by = ?, approved_at = ?
             WHERE id = ?`,
            [targetDriver, targetVehicle, targetType, targetFine, targetStatus, targetApproval, targetApprovedBy, targetApprovedAt, id],
            function(updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                res.json({ message: 'Нарушение успешно обновлено' });
            }
        );
    });
});

// Удалить нарушение (требуется авторизация)
app.delete('/api/violations/:id', requireAuth, (req, res) => {
    const { id } = req.params;

    db.get(`SELECT * FROM violations WHERE id = ?`, [id], (err, violation) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!violation) return res.status(404).json({ error: 'Нарушение не найдено' });

        const isAdmin = req.user.role === 'admin';
        const isCreator = violation.created_by && Number(violation.created_by) === Number(req.user.id);
        if (!isAdmin) {
            if (!isCreator || violation.approval_status !== 'pending') {
                return res.status(403).json({ error: 'Удаление доступно только администратору или автору до утверждения' });
            }
        }

        db.run("DELETE FROM violations WHERE id = ?", [id], function(deleteErr) {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });
            res.json({ message: 'Нарушение успешно удалено' });
        });
    });
});

app.patch('/api/violations/:id/approve', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM violations WHERE id = ?`, [id], (err, violation) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!violation) return res.status(404).json({ error: 'Нарушение не найдено' });
        if (violation.approval_status === 'approved') {
            return res.status(400).json({ error: 'Нарушение уже утверждено' });
        }

        const statusValue = violation.status && violation.status !== 'Ожидает утверждения'
            ? violation.status
            : 'Не оплачен';
        const approvedAt = new Date().toISOString();

        db.run(
            `UPDATE violations
             SET approval_status = 'approved', approved_by = ?, approved_at = ?, status = ?
             WHERE id = ?`,
            [req.user.id, approvedAt, statusValue, id],
            function(updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                res.json({ message: 'Нарушение утверждено', approvedAt, status: statusValue });
            }
        );
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