@echo off
rem Torque CRM: double-click to start. Leave this window open while you use it.
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing Torque CRM. This takes a minute...
  call npm install
)
call npm start
