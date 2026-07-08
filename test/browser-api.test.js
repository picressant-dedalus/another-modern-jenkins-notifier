/**
 * Browser API Tests
 */

import { Jobs, Storage, Notification, init, $rootScope } from '../js/services.js';
import { documentReady } from '../js/popup.js';

describe('Browser API Tests', () => {
  let mockSetInterval;
  let mockClearInterval;
  let intervals;
  let cleanup;

  beforeEach(() => {
    jest.clearAllMocks();
    Jobs.jobs = {};
    cleanup = null;
    
    // Reset $rootScope options
    $rootScope.options = {
      refreshTime: 60,
      notification: 'all'
    };

    // Mock Jobs.updateAllStatus
    Jobs.updateAllStatus = jest.fn().mockResolvedValue([]);

    // Setup interval tracking
    intervals = new Set();
    mockSetInterval = jest.fn((fn, delay) => {
      const id = Symbol('interval');
      intervals.add(id);
      return id;
    });
    mockClearInterval = jest.fn(id => {
      intervals.delete(id);
    });

    // Replace global interval functions
    global.setInterval = mockSetInterval;
    global.clearInterval = mockClearInterval;

    // Mock chrome.runtime.getURL
    chrome.runtime.getURL = jest.fn(path => `chrome-extension://mock-id/${path}`);
  });

  afterEach(() => {
    // Clean up any active intervals
    if (cleanup) {
      cleanup();
    }

    // Restore global interval functions
    global.setInterval = setInterval;
    global.clearInterval = clearInterval;
  });

  describe('Background Service Worker', () => {
    test('should handle notification disable/enable correctly', async () => {
      // Initialize services with notifications enabled
      cleanup = await init();

      // Should have created an interval for checking job updates
      expect(mockSetInterval).toHaveBeenCalledWith(
        expect.any(Function),
        60000 // Default 60 seconds
      );
      expect(intervals.size).toBe(1);
      const initialIntervalId = Array.from(intervals)[0];

      // Get the interval callback
      const intervalCallback = mockSetInterval.mock.calls[0][0];
      
      // Call the interval callback to verify it updates jobs
      await intervalCallback();
      expect(Jobs.updateAllStatus).toHaveBeenCalled();

      // Disable notifications
      $rootScope.options.notification = 'none';
      $rootScope.$broadcast('Options::options.changed', $rootScope.options);

      // Should have cleared the interval and stopped checking for updates
      expect(mockClearInterval).toHaveBeenCalledWith(initialIntervalId);
      expect(intervals.size).toBe(0);

      // Re-enable notifications
      $rootScope.options.notification = 'all';
      $rootScope.$broadcast('Options::options.changed', $rootScope.options);

      // Should create new interval and resume checking for updates
      expect(mockSetInterval).toHaveBeenCalledWith(
        expect.any(Function),
        60000 // Default 60 seconds
      );
      expect(intervals.size).toBe(1);
      expect(Array.from(intervals)[0]).not.toBe(initialIntervalId);

      // Verify new interval still updates jobs
      const newIntervalCallback = mockSetInterval.mock.calls[1][0];
      await newIntervalCallback();
      expect(Jobs.updateAllStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('Options Page', () => {
    test('should handle options page navigation', async () => {
      // Set up DOM with actual popup HTML
      document.body.innerHTML = `
        <body class="container-fluid">
          <header>
            <h1 class="h4">
              Yet Another Jenkins Notifier
              <small><a id="optionsLink" href="#"><span class="glyphicon glyphicon-cog"></span></a></small>
            </h1>
          </header>
          <main>
            <div id="jobList" class="list-group"></div>
            <p class="help-block">No jobs. Please enter a url below to listen for job builds.</p>
          </main>
          <footer>
            <form id="urlForm" name="urlForm">
              <div class="input-group">
                <label class="input-group-addon" for="url">Url</label>
                <input type="url" class="form-control" id="url" name="url"
                       pattern="https?://.+"
                       placeholder="http://jenkins/"
                       autofocus tabindex="1" required>
                <span class="input-group-btn">
                    <button id="addButton" type="submit" class="btn btn-primary">
                      <span class="glyphicon glyphicon-plus"></span>
                    </button>
                  </span>
              </div>
              <div id="errorMessage" class="help-block"></div>
            </form>
          </footer>
        </body>
      `;

      // Initialize popup
      await documentReady();

      // Get options link
      const optionsLink = document.getElementById('optionsLink');
      expect(optionsLink).not.toBeNull();

      // Test modern API
      chrome.runtime.openOptionsPage = jest.fn();
      optionsLink.click();
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

      // Test fallback
      chrome.runtime.openOptionsPage = undefined;
      optionsLink.click();
      expect(chrome.tabs.create).toHaveBeenCalledWith({
        'url': 'chrome-extension://mock-id/options.html'
      });
    });
  }, 60000); // Increase timeout for options test

  describe('Popup Job List Rendering', () => {
    test('should prefer customName over name when rendering a job', async () => {
      // Set up DOM with the real popup markup, including the job templates
      document.body.innerHTML = `
        <body class="container-fluid">
          <header>
            <h1 class="h4">
              Yet Another Jenkins Notifier
              <small><a id="optionsLink" href="#"><span class="glyphicon glyphicon-cog"></span></a></small>
            </h1>
          </header>
          <main>
            <div id="jobList" class="list-group"></div>
            <p class="help-block">No jobs. Please enter a url below to listen for job builds.</p>
            <template id="jobItemTemplate">
              <div class="list-group-item">
                <div class="row">
                  <div class="col-xs-2">
                    <img data-jobstatusclass class="img-rounded avatar" alt="Jenkins" src="img/icon48.png">
                  </div>
                  <div class="col-xs-8">
                    <div class="job-title no-margin inline-block">
                      <h4>
                        <span data-jobfield="name"><!--name--></span>
                        <br>
                        <a class="small" target="_blank" data-joburl data-jobfield="url"><!--url--></a>
                      </h4>
                    </div>
                  </div>
                  <div class="col-xs-2">
                    <div class="pull-right">
                      <button type="button" class="close" aria-label="Close"><span
                        aria-hidden="true">&times;</span></button>
                      <a class="label label-danger" target="_blank" data-joburl data-joberror>
                        <span class="glyphicon glyphicon-exclamation-sign"></span>
                        Error
                      </a>
                      <p data-jobfield="status" data-jobstatusclass class="badge"><!--status--></p>
                    </div>
                  </div>
                </div>
                <ul data-id="jobs" class="list-unstyled">
                  <!--View jobs-->
                </ul>
              </div>
            </template>
            <template id="jobSubItemTemplate">
              <li class="row">
                <div class="col-xs-8">
                  <div class="job-title">
                    <a target="_blank" data-joburl data-jobfield="name"><!--name--></a>
                  </div>
                </div>
                <div class="col-xs-1">
                  <span class="small" data-lastbuildtime><!--lastBuildTime--></span>
                </div>
                <div class="col-xs-3 text-center">
                  <span data-jobfield="status" data-jobstatusclass class="badge"><!--status--></span>
                </div>
              </li>
            </template>
          </main>
          <footer>
            <form id="urlForm" name="urlForm">
              <div class="input-group">
                <label class="input-group-addon" for="url">Url</label>
                <input type="url" class="form-control" id="url" name="url"
                       pattern="https?://.+"
                       placeholder="http://jenkins/"
                       autofocus tabindex="1" required>
                <span class="input-group-btn">
                    <button id="addButton" type="submit" class="btn btn-primary">
                      <span class="glyphicon glyphicon-plus"></span>
                    </button>
                  </span>
              </div>
              <div id="errorMessage" class="help-block"></div>
            </form>
          </footer>
        </body>
      `;

      // Initialize popup, then broadcast jobs with and without a customName
      await documentReady();

      Jobs.jobs = {
        'http://jenkins/job/renamed/': {
          name: 'renamed', customName: 'Backend Team', status: 'SUCCESS', url: 'http://jenkins/job/renamed/'
        },
        'http://jenkins/job/plain/': {
          name: 'plain', status: 'SUCCESS', url: 'http://jenkins/job/plain/'
        }
      };
      $rootScope.$broadcast('Jobs::jobs.changed', Jobs.jobs);

      const items = document.querySelectorAll('#jobList > .list-group-item');
      expect(items.length).toBe(2);
      expect(items[0].querySelector('[data-jobfield="name"]').innerText).toBe('Backend Team');
      expect(items[1].querySelector('[data-jobfield="name"]').innerText).toBe('plain');
    });
  });

  describe('Cross-browser Compatibility', () => {
    test('should handle Firefox manifest', () => {
      const firefoxManifest = require('../manifest_firefox.json');
      expect(firefoxManifest.browser_specific_settings).toBeDefined();
      expect(firefoxManifest.browser_specific_settings.gecko).toBeDefined();
      expect(firefoxManifest.browser_specific_settings.gecko.id).toBeDefined();
    });

    test('should handle Chrome manifest', () => {
      const chromeManifest = require('../manifest.json');
      expect(chromeManifest.manifest_version).toBe(3);
      expect(chromeManifest.permissions).toContain('notifications');
      expect(chromeManifest.permissions).toContain('storage');
    });
  });
});
