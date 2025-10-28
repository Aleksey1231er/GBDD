# PowerShell скрипт для запуска сервера ГИБДД
param(
    [switch]$Help,
    [switch]$Install,
    [switch]$Status,
    [switch]$Stop
)

if ($Help) {
    Write-Host "🚓 Скрипт управления сервером ГИБДД" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Использование:" -ForegroundColor Yellow
    Write-Host "  .\start-server.ps1              # Запустить сервер"
    Write-Host "  .\start-server.ps1 -Install     # Установить зависимости"
    Write-Host "  .\start-server.ps1 -Status      # Проверить статус"
    Write-Host "  .\start-server.ps1 -Stop        # Остановить сервер"
    Write-Host "  .\start-server.ps1 -Help        # Показать эту справку"
    exit
}

if ($Install) {
    Write-Host "📦 Устанавливаем зависимости..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Зависимости установлены успешно!" -ForegroundColor Green
    } else {
        Write-Host "❌ Ошибка установки зависимостей!" -ForegroundColor Red
        exit 1
    }
    exit
}

if ($Status) {
    $process = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "🟢 Сервер запущен (PID: $($process.Id))" -ForegroundColor Green
        Write-Host "🌐 Доступен по адресу: http://localhost:3000" -ForegroundColor Cyan
    } else {
        Write-Host "🔴 Сервер не запущен" -ForegroundColor Red
    }
    exit
}

if ($Stop) {
    $process = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Name "node" -Force
        Write-Host "🛑 Сервер остановлен" -ForegroundColor Yellow
    } else {
        Write-Host "ℹ️ Сервер не был запущен" -ForegroundColor Blue
    }
    exit
}

# Проверяем Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion найден" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js не установлен!" -ForegroundColor Red
    Write-Host "Скачайте и установите Node.js с https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Нажмите Enter для выхода"
    exit 1
}

# Проверяем зависимости
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Устанавливаем зависимости..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Ошибка установки зависимостей!" -ForegroundColor Red
        Read-Host "Нажмите Enter для выхода"
        exit 1
    }
}

# Получаем IP-адрес
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "🚀 Запускаем сервер ГИБДД..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🌐 Локальный доступ: http://localhost:3000" -ForegroundColor Green
if ($ipAddress) {
    Write-Host "🌐 Сетевой доступ: http://$ipAddress:3000" -ForegroundColor Green
}
Write-Host "🛑 Для остановки нажмите Ctrl+C" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Запускаем сервер
npm start
