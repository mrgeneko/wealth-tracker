#!/bin/bash
xvfb-run node /usr/src/app/scrape_investing_com_monitor.js "$1" "/usr/src/app/logs"