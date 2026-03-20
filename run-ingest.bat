@echo off
title Movie Search Ingest Runner

:loop
echo ============================
echo %date% %time% - Ingest started
echo ============================

curl -H "Authorization: Bearer nderod_cron" http://localhost:3000/api/cron/ingest

echo.
echo Waiting 2 minutes...
timeout /t 60 /nobreak >nul

goto loop