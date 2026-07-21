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

import { init, _, Jobs, $rootScope, buildNotifier } from './services.js';

function keepServiceWorkerAlive() {
  chrome.runtime.sendMessage({ type: 'keepAlive' });
  setTimeout(keepServiceWorkerAlive, 15000);
}

export async function documentReady() {
  try {
    await init();
    keepServiceWorkerAlive();

    const optionsLink = document.getElementById('optionsLink');
    const urlForm = document.getElementById('urlForm');
    const urlInput = document.getElementById('url');
    const addButton = document.getElementById('addButton');
    const errorMessage = document.getElementById('errorMessage');
    const jobList = document.getElementById('jobList');
    const summaryList = document.getElementById('summary');
    const jobItemTemplate = document.getElementById('jobItemTemplate');
    const jobSubItemTemplate = document.getElementById('jobSubItemTemplate');
    const summaryItemTemplate = document.getElementById('summaryItemTemplate');
    const noJobsMessage = document.querySelector('.help-block');

    // Maps each summary group key to its top rendered element for quick scrolling.
    const summaryTargets = new Map();

    optionsLink.addEventListener('click', openOptionsPage);
    urlForm.addEventListener('submit', addUrl);
    urlForm.addEventListener('input', validateForm);

    validateForm();
    placeholderRotate();

    // Initial render
    renderJobs(Jobs.jobs);

    $rootScope.$on('Jobs::jobs.initialized', function (_, jobs) {
      renderJobs(jobs);
      Jobs.updateAllStatus().then(buildNotifier);
    });
    
    $rootScope.$on('Jobs::jobs.changed', function (_, jobs) {
      renderJobs(jobs);
    });

    $rootScope.$on('Options::options.changed', function () {
      renderSummary(buildRenderGroups(Jobs.jobs));
    });

    function openOptionsPage() {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({'url': chrome.runtime.getURL('options.html')});
      }
    }

    function addUrl(event) {
      event.preventDefault();

      const url = urlInput.value;
      if (!url) return;

      Jobs.add(url)
        .then(() => {
          urlInput.value = '';
          validateForm();
          return Jobs.updateStatus(url);
        })
        .catch(error => {
          errorMessage.innerText = 'Error adding URL: ' + error.message;
          errorMessage.classList.remove('hidden');
        });
    }

    function validateForm() {
      const isFormInvalid = !urlForm.checkValidity();
      const isUrlInvalid = urlInput.validity.typeMismatch;

      addButton.disabled = isFormInvalid;
      urlForm.classList.toggle('has-error', isFormInvalid && urlInput.value);
      errorMessage.classList.toggle('hidden', !isUrlInvalid);
      errorMessage.innerText = urlInput.validationMessage;
    }

    function placeholderRotate() {
      const placeholderUrls = [
        'http://jenkins/ for all jobs',
        'http://jenkins/job/my_job/ for one job',
        'http://jenkins/job/my_view/ for view jobs'
      ];

      let i = 0;
      urlInput.placeholder = placeholderUrls[0];
      window.setInterval(function () {
        urlInput.placeholder = placeholderUrls[++i % placeholderUrls.length];
      }, 5000);
    }

    function removeUrlClick(event) {
      const url = event.currentTarget.dataset.url;
      Jobs.remove(url);
    }

    function renderJobs(jobs) {
      // Clear existing job list
      while (jobList.firstChild) {
        if (jobList.firstChild.nodeName !== 'TEMPLATE') {
          jobList.firstChild.remove();
        }
      }

      summaryTargets.clear();

      // Show/hide no jobs message
      noJobsMessage.style.display = (!jobs || Object.keys(jobs).length === 0) ? 'block' : 'none';

      // If no jobs, return early
      if (!jobs || Object.keys(jobs).length === 0) {
        renderSummary([]);
        return;
      }

      var groups = buildRenderGroups(jobs);
      renderGroupedJobs(groups);
      renderSummary(groups);
    }

    function normalizeJobUrl(url) {
      return (url || '').replace(/\/+$/, '');
    }

    function displayName(url, job) {
      return (job && (job.customName || job.name)) || url;
    }

    // Build popup groups while preserving monitored-link order.
    function buildRenderGroups(jobs) {
      const groups = [];
      const byKey = new Map();

      Object.keys(jobs || {}).forEach(function (url) {
        const job = jobs[url];
        const rawGroup = (job && job.groupName || '').trim();
        const key = rawGroup ? 'group:' + rawGroup : 'url:' + url;

        if (!byKey.has(key)) {
          const group = {
            key: key,
            name: rawGroup || displayName(url, job),
            hasExplicitName: !!rawGroup,
            items: []
          };
          byKey.set(key, group);
          groups.push(group);
        }

        byKey.get(key).items.push({ url: url, job: job });
      });

      return groups;
    }

    function renderGroupedJobs(groups) {
      if (!jobItemTemplate) {
        return;
      }

      groups.forEach(function (group) {
        let targetElement = null;

        if (group.hasExplicitName) {
          const header = document.createElement('div');
          header.className = 'job-group-title text-muted small';
          header.textContent = group.name;
          jobList.appendChild(header);
          targetElement = header;
        }

        group.items.forEach(function (item) {
          const newNode = document.importNode(jobItemTemplate.content, true);
          jobList.appendChild(newNode);
          const jobNode = jobList.lastElementChild;
          renderJobOrView(jobNode, item.url, item.job);
          if (!targetElement) {
            targetElement = jobNode;
          }
        });

        if (targetElement) {
          summaryTargets.set(group.key, targetElement);
        }
      });
    }

    // Aggregates statuses for a group with dedup by Jenkins job URL.
    function countGroupStatuses(group) {
      const counts = { success: 0, warning: 0, danger: 0 };
      const seen = new Set();
      let fallbackIndex = 0;

      group.items.forEach(function (item) {
        const job = item.job || {};
        const targets = job.jobs ? Object.keys(job.jobs).map(k => job.jobs[k]) : [job];

        targets.forEach(function (target) {
          const statusKey = target && target.statusClass;
          if (!counts.hasOwnProperty(statusKey)) {
            return;
          }

          const dedupeUrl = normalizeJobUrl(target && target.url);
          const dedupeKey = dedupeUrl || ('missing-url-' + (++fallbackIndex));
          if (seen.has(dedupeKey)) {
            return;
          }

          seen.add(dedupeKey);
          counts[statusKey]++;
        });
      });

      return counts;
    }

    function renderSummary(groups) {
      if (!summaryList || !summaryItemTemplate) {
        return;
      }

      const show = $rootScope.options && $rootScope.options.showSummary !== false;
      const hasGroups = groups && groups.length > 0;

      // Clear existing summary rows (keep the template)
      while (summaryList.firstChild) {
        if (summaryList.firstChild.nodeName !== 'TEMPLATE') {
          summaryList.firstChild.remove();
        }
      }

      summaryList.classList.toggle('hidden', !show || !hasGroups);

      if (!show || !hasGroups) {
        return;
      }

      groups.forEach(function (group) {
        const newNode = document.importNode(summaryItemTemplate.content, true);
        summaryList.appendChild(newNode);
        renderSummaryItem(summaryList.lastElementChild, group);
      });
    }

    function renderSummaryItem(node, group) {
      if (!group) return;

      const counts = countGroupStatuses(group);

      _.forEach(node.querySelectorAll('[data-summaryname]'), function (el) {
        el.innerText = group.name;
        el.title = group.name;
      });

      _.forEach(node.querySelectorAll('[data-summaryfield]'), function (el) {
        el.innerText = String(counts[el.dataset.summaryfield]);
      });

      _.forEach(node.querySelectorAll('[data-summarycount]'), function (el) {
        el.onclick = function () {
          const target = summaryTargets.get(group.key);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        };
      });
    }

    function renderJobOrView(node, url, job) {
      renderJob(node, url, job);

      const closeButton = node.querySelector('button.close');
      closeButton.dataset.url = url;
      closeButton.addEventListener('click', removeUrlClick);

      const subJobs = node.querySelector('[data-id="jobs"]');
      subJobs.classList.toggle('hidden', !job.jobs);
      if (job.jobs) {
        renderRepeat(subJobs, jobSubItemTemplate, job.jobs, renderJob);
      }
    }

    const DURATION_TIME = [
      {short: "y", long: "year", breakdown: 320 * 24 * 60 * 60, divisor: 365 * 24 * 60 * 60},
      {short: "mo.", long: "month", breakdown: 26 * 24 * 60 * 60, divisor: 30 * 24 * 60 * 60},
      {short: "d", long: "day", breakdown: 22 * 60 * 60, divisor: 24 * 60 * 60},
      {short: "h", long: "hour", breakdown: 45 * 60, divisor: 60 * 60},
      {short: "m", long: "minute", breakdown: 45, divisor: 60},
      {short: "s", long: "second", breakdown: 0, divisor: 1}
    ];

    function fromNow(date) {
      if (!date) {
        return {
          short: "",
          long: "",
          fullDate: ""
        };
      }

      date = new Date(date);
      const diff = Math.floor((new Date().getTime() - date.getTime()) / 1000);

      for (let i = 0; i < DURATION_TIME.length; i++) {
        const unit = DURATION_TIME[i];
        if (diff >= unit.breakdown) {
          const nb = Math.round(diff / unit.divisor);
          return {
            short: `${nb}${unit.short}`,
            long: `${nb} ${unit.long}${nb >= 2 ? "s ago" : " ago"}`,
            fullDate: date.toLocaleString()
          };
        }
      }
    }

    function renderJob(node, url, job) {
      if (!job) return;

      node.classList.toggle('building', job.building);

      _.forEach(node.querySelectorAll('[data-jobfield]'), function (el) {
        var field = el.dataset.jobfield;
        var value = field === 'name' ? (job.customName || job.name) : job[field];
        el.innerText = value || '';
      });

      _.forEach(node.querySelectorAll('[data-lastbuildtime]'), function (el) {
        const texts = fromNow(job.lastBuildTime);
        el.innerText = texts.short;
        el.title = texts.fullDate;
      });

      _.forEach(node.querySelectorAll('[data-jobstatusclass]'), function (el) {
        el.className = el.className.replace(/ alert-.*$/, '').replace(/ ?$/, ' alert-' + (job.statusClass || ''));
      });

      _.forEach(node.querySelectorAll('[data-joberror]'), function (el) {
        el.classList.toggle('hidden', !job.error);
        el.setAttribute('title', job.error ? 'Error: ' + job.error : '');
      });

      _.forEach(node.querySelectorAll('a[data-joburl]'), function (el) {
        el.href = job.url || '#';
      });
    }

    function renderRepeat(container, template, obj, render) {
      if (!container || !template || !obj || !render) return;

      const keys = Object.keys(obj || {});

      for (let i = 0; i < keys.length; i++) {
        if (i < container.children.length) {
          render(container.children[i], keys[i], obj[keys[i]]);
        } else {
          const newNode = document.importNode(template.content, true);
          container.appendChild(newNode);
          render(container.lastElementChild, keys[i], obj[keys[i]]);
        }
      }

      while (container.children.length > keys.length) {
        container.lastElementChild.remove();
      }
    }

  } catch (error) {
    document.body.innerHTML = `<div class="alert alert-danger">Error initializing: ${error.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', documentReady);
