@echo off
echo ========================================
echo    Запуск сервера ГИБДД
echo ========================================
echo.

REM Проверяем, установлен ли Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ОШИБКА: Node.js не установлен!
    echo Скачайте и установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

REM Проверяем, установлены ли зависимости
if not exist "node_modules" (
    echo Устанавливаем зависимости...
    npm install
    if %errorlevel% neq 0 (
        echo ОШИБКА: Не удалось установить зависимости!
        pause
        exit /b 1
    )
)

echo Запускаем сервер...
echo.
echo Для остановки нажмите Ctrl+C
echo.

REM Запускаем сервер
npm start

pause
