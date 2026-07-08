/**
 * Yet Another Jenkins Notifier
 * Copyright (C) 2016 Guillaume Girou
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { init, Jobs, $rootScope } from './services.js';

init();

const jobEntriesContainer = document.querySelector('#jobEntries');
const jobEntryTemplate = document.querySelector('#jobEntryTemplate');
const addJobEntryButton = document.querySelector('#addJobEntry');
const urlsErrorElement = document.querySelector('#urlsError');
const urlPattern = /^https?:\/\/.+/;

$rootScope.$on('Jobs::jobs.initialized', function (event, jobs) {
  renderJobEntries(jobs);
});

NodeList.prototype.forEach = Array.prototype.forEach;

const refreshTimeInput = document.getElementById('refreshTime');
const refreshTimeSpan = document.getElementById('refreshTimeSpan');
const optionsStatusElement = document.getElementById('optionStatus');
const urlsStatusElement = document.getElementById('urlsStatus');
const shortcutInput = document.getElementById('addJobShortcut');
const resetShortcutButton = document.getElementById('resetShortcut');
const shortcutStatusElement = document.getElementById('shortcutStatus');

const defaultOptions = {
  refreshTime: 60,
  notification: 'all',
  addJobShortcut: {
    key: 'j',
    shiftKey: true,
    ctrlKey: false,
    altKey: false
  }
};

function showSavedNotification(statusElement) {
  statusElement.style.visibility = "";
  setTimeout(function () {
    statusElement.style.visibility = "hidden";
  }, 2000);
}

// Renders one row per job/view URL, prefilled with its custom name (if any).
function renderJobEntries(jobs) {
  jobEntriesContainer.innerHTML = '';
  Object.keys(jobs || {}).forEach(function (url) {
    appendJobEntryRow(url, jobs[url] && jobs[url].customName);
  });
}

function appendJobEntryRow(url, name) {
  const fragment = document.importNode(jobEntryTemplate.content, true);
  const row = fragment.querySelector('.job-entry-row');
  const urlInput = row.querySelector('.job-entry-url');
  const nameInput = row.querySelector('.job-entry-name');
  const removeButton = row.querySelector('.job-entry-remove');

  urlInput.value = url || '';
  nameInput.value = name || '';

  removeButton.addEventListener('click', function () {
    row.remove();
  });

  jobEntriesContainer.appendChild(row);
  return row;
}

function addEmptyRow() {
  const row = appendJobEntryRow('', '');
  row.querySelector('.job-entry-url').focus();
}

// Reads all rows, validating URLs. Fully empty rows are silently skipped.
// Returns the collected {url, name} entries, or null if any row is invalid.
function validateAndCollectEntries() {
  const rows = jobEntriesContainer.querySelectorAll('.job-entry-row');
  let isValid = true;
  const entries = [];

  rows.forEach(function (row) {
    const urlInput = row.querySelector('.job-entry-url');
    const nameInput = row.querySelector('.job-entry-name');
    const url = urlInput.value.trim();
    const name = nameInput.value.trim();

    if (!url && !name) {
      urlInput.classList.remove('invalid');
      return;
    }

    const isUrlValid = urlPattern.test(url);
    urlInput.classList.toggle('invalid', !isUrlValid);

    if (!isUrlValid) {
      isValid = false;
      return;
    }

    entries.push({url: url, name: name});
  });

  urlsErrorElement.style.display = isValid ? 'none' : 'block';
  return isValid ? entries : null;
}

// Format shortcut for display
function formatShortcut(shortcut) {
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key.toUpperCase());
  return parts.join(' + ');
}

// Handle shortcut input
function handleShortcutInput(e) {
  e.preventDefault();
  
  // Only allow certain modifier keys
  if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
    return;
  }

  // Only allow regular keys
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift') {
    return;
  }

  const shortcut = {
    key: e.key.toLowerCase(),
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey
  };

  shortcutInput.value = formatShortcut(shortcut);
  saveShortcut(shortcut);
}

// Save shortcut to storage
function saveShortcut(shortcut) {
  chrome.storage.local.get({options: defaultOptions}, function(objects) {
    const options = objects.options;
    options.addJobShortcut = shortcut;
    
    chrome.storage.local.set({options: options}, function() {
      if (chrome.runtime.lastError) {
        console.error('Error saving shortcut:', chrome.runtime.lastError);
      } else {
        showSavedNotification(shortcutStatusElement);
      }
    });
  });
}

// Reset shortcut to default
function resetShortcut() {
  const defaultShortcut = defaultOptions.addJobShortcut;
  shortcutInput.value = formatShortcut(defaultShortcut);
  saveShortcut(defaultShortcut);
}

// Saves options to chrome.storage.local.
function saveOptions() {
  const options = {
    refreshTime: refreshTimeInput.value,
    notification: document.querySelector('[name=notification]:checked').value
  };
  
  chrome.storage.local.get({options: defaultOptions}, function(objects) {
    options.addJobShortcut = objects.options.addJobShortcut;
    
    chrome.storage.local.set({options: options}, function () {
      if (chrome.runtime.lastError) {
        console.error('Error saving options:', chrome.runtime.lastError);
      } else {
        showSavedNotification(optionsStatusElement);
      }
    });
  });
}

// Saves job entries (url + optional custom name) to chrome.storage.local.
function saveUrls() {
  const entries = validateAndCollectEntries();

  if (!entries) {
    return;
  }

  Jobs.setUrls(entries)
    .then(renderJobEntries)
    .then(() => {
      showSavedNotification(urlsStatusElement);
    })
    .catch(error => {
      console.error('Error saving URLs:', error);
      urlsStatusElement.textContent = 'Error saving URLs: ' + error.message;
      urlsStatusElement.style.color = '#d9534f';
      urlsStatusElement.style.visibility = '';
    });
}

// Restores the preferences stored in chrome.storage.
function restoreOptions() {
  chrome.storage.local.get({options: defaultOptions}, function (objects) {
    if (chrome.runtime.lastError) {
      console.error('Error restoring options:', chrome.runtime.lastError);
      return;
    }
    
    const options = objects.options;
    document.querySelector('[name=notification]:checked').checked = false;
    document.querySelector('[name=notification][value="' + options.notification + '"]').checked = true;
    refreshTimeSpan.textContent = refreshTimeInput.value = options.refreshTime;
    
    // Restore shortcut
    if (options.addJobShortcut) {
      shortcutInput.value = formatShortcut(options.addJobShortcut);
    }
  });
}

function updateRefreshTimeSpan() {
  refreshTimeSpan.textContent = refreshTimeInput.value;
}

// Shortcut input handling
shortcutInput.addEventListener('keydown', handleShortcutInput);
shortcutInput.addEventListener('click', function() {
  this.value = 'Press keys...';
});

// Reset shortcut button
resetShortcutButton.addEventListener('click', resetShortcut);

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
});

document.querySelectorAll('input[type=radio], #refreshTime').forEach(function (element) {
  element.addEventListener('change', saveOptions);
});

document.querySelector('#saveUrls').addEventListener('click', saveUrls);
addJobEntryButton.addEventListener('click', addEmptyRow);
refreshTimeInput.addEventListener('input', updateRefreshTimeSpan);
