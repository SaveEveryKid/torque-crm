#!/bin/bash
# Torque CRM: double-click to start. Leave this window open while you use it.
cd "$(dirname "$0")"
[ -d node_modules ] || { echo "First run: installing Torque CRM. This takes a minute..."; npm install; }
npm start
