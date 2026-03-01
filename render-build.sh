#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install

# Install Chrome for Puppeteer dependencies on Render
# Since Puppeteer uses Chrome, this script ensures all libraries are loaded.
npx puppeteer browsers install chrome
