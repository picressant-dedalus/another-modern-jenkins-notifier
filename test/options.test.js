/**
 * Options Page Tests
 *
 * options.js has no exports (it wires itself up as a side effect on import,
 * mirroring how options.html loads it as a module script at the end of
 * <body>), so it is loaded here with `require` after the expected DOM
 * structure has been set up, following the same "load the real module"
 * approach used in browser-api.test.js.
 */

function setupOptionsDom() {
  document.body.innerHTML = `
    <fieldset>
      <p>
        <label>
          <input type="radio" name="notification" value="all" checked>
          On every build
        </label>
        <label>
          <input type="radio" name="notification" value="unstable">
          On every unstable build
        </label>
        <label>
          <input type="radio" name="notification" value="none">
          Never
        </label>
      </p>
      <p>
        <input min="5" max="120" step="5" type="range" id="refreshTime">
        <span id="refreshTimeSpan"></span>
      </p>
      <p>
        <label>
          <input type="checkbox" id="showSummary" checked>
          Show build status summary at top of popup
        </label>
      </p>
    </fieldset>
    <p style="visibility: hidden" id="optionStatus">Options saved.</p>

    <fieldset>
      <input type="text" id="addJobShortcut" readonly>
      <button id="resetShortcut">Reset to Default</button>
    </fieldset>
    <p style="visibility: hidden" id="shortcutStatus">Shortcut saved.</p>

    <fieldset>
      <div id="jobEntries"></div>
      <template id="jobEntryTemplate">
        <div class="job-entry-row">
          <input type="url" class="job-entry-url" pattern="https?://.+">
          <input type="text" class="job-entry-name">
          <input type="text" class="job-entry-group">
          <button type="button" class="job-entry-move job-entry-up" aria-label="Move up">&#8593;</button>
          <button type="button" class="job-entry-move job-entry-down" aria-label="Move down">&#8595;</button>
          <button type="button" class="job-entry-remove" aria-label="Remove">&times;</button>
        </div>
      </template>
      <div class="error" id="urlsError">Please enter valid Jenkins URLs (must start with http:// or https://)</div>
      <button id="addJobEntry" type="button">+ Add job</button>
      <button id="saveUrls" type="submit">Save urls</button>
    </fieldset>
    <p style="visibility: hidden" id="urlsStatus">Urls saved.</p>
  `;
}

function getRows() {
  return Array.from(document.querySelectorAll('#jobEntries .job-entry-row'));
}

// Flushes pending microtasks (e.g. chained `.then()` callbacks) without
// relying on the global `flushPromises` helper, which schedules a real
// `setTimeout` that never fires under the fake timers installed in
// test/setup.js.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Options Page job entries', () => {
  let Jobs;
  let $rootScope;

  beforeEach(async () => {
    jest.resetModules();
    setupOptionsDom();

    const services = require('../js/services.js');
    Jobs = services.Jobs;
    $rootScope = services.$rootScope;
    Jobs.jobs = {};

    require('../js/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await flushMicrotasks();
  });


  test('renders one row per existing job, prefilled with its custom name', () => {
    const jobs = {
      'http://jenkins.example.com/job/one/': {
        url: 'http://jenkins.example.com/job/one/',
        name: 'one',
        customName: 'My View',
        groupName: 'Team A'
      },
      'http://jenkins.example.com/job/two/': {
        url: 'http://jenkins.example.com/job/two/',
        name: 'two'
      }
    };

    $rootScope.$broadcast('Jobs::jobs.initialized', jobs);

    const rows = getRows();
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.job-entry-url').value).toBe('http://jenkins.example.com/job/one/');
    expect(rows[0].querySelector('.job-entry-name').value).toBe('My View');
    expect(rows[0].querySelector('.job-entry-group').value).toBe('Team A');
    expect(rows[1].querySelector('.job-entry-url').value).toBe('http://jenkins.example.com/job/two/');
    expect(rows[1].querySelector('.job-entry-name').value).toBe('');
    expect(rows[1].querySelector('.job-entry-group').value).toBe('');
  });

  test('adds an empty row when clicking "Add job"', () => {
    expect(getRows().length).toBe(0);

    document.getElementById('addJobEntry').click();

    expect(getRows().length).toBe(1);
    expect(getRows()[0].querySelector('.job-entry-url').value).toBe('');
  });

  test('removes a row when clicking its remove button', () => {
    document.getElementById('addJobEntry').click();
    document.getElementById('addJobEntry').click();
    expect(getRows().length).toBe(2);

    getRows()[0].querySelector('.job-entry-remove').click();

    expect(getRows().length).toBe(1);
  });

  test('flags an invalid URL and does not save', () => {
    document.getElementById('addJobEntry').click();
    const row = getRows()[0];
    row.querySelector('.job-entry-url').value = 'not-a-url';
    row.querySelector('.job-entry-name').value = 'Bad Entry';
    row.querySelector('.job-entry-group').value = 'Group X';

    Jobs.setUrls = jest.fn().mockResolvedValue({});

    document.getElementById('saveUrls').click();

    expect(row.querySelector('.job-entry-url').classList.contains('invalid')).toBe(true);
    expect(document.getElementById('urlsError').style.display).toBe('block');
    expect(Jobs.setUrls).not.toHaveBeenCalled();
  });

  test('saves entries with url and name on Save', async () => {
    document.getElementById('addJobEntry').click();
    const row = getRows()[0];
    row.querySelector('.job-entry-url').value = 'http://jenkins.example.com/job/new-view/';
    row.querySelector('.job-entry-name').value = 'New View';
    row.querySelector('.job-entry-group').value = 'Release';

    Jobs.setUrls = jest.fn().mockResolvedValue({
      'http://jenkins.example.com/job/new-view/': {
        url: 'http://jenkins.example.com/job/new-view/',
        customName: 'New View',
        groupName: 'Release'
      }
    });

    document.getElementById('saveUrls').click();
    await flushMicrotasks();

    expect(Jobs.setUrls).toHaveBeenCalledWith([
      {url: 'http://jenkins.example.com/job/new-view/', name: 'New View', group: 'Release'}
    ]);
  });

  test('saves entries in manual row order after moving', () => {
    document.getElementById('addJobEntry').click();
    document.getElementById('addJobEntry').click();
    const rows = getRows();

    rows[0].querySelector('.job-entry-url').value = 'http://jenkins.example.com/job/first/';
    rows[0].querySelector('.job-entry-name').value = 'First';
    rows[0].querySelector('.job-entry-group').value = 'A';
    rows[1].querySelector('.job-entry-url').value = 'http://jenkins.example.com/job/second/';
    rows[1].querySelector('.job-entry-name').value = 'Second';
    rows[1].querySelector('.job-entry-group').value = 'B';

    rows[1].querySelector('.job-entry-up').click();

    Jobs.setUrls = jest.fn().mockResolvedValue({});
    document.getElementById('saveUrls').click();

    expect(Jobs.setUrls).toHaveBeenCalledWith([
      {url: 'http://jenkins.example.com/job/second/', name: 'Second', group: 'B'},
      {url: 'http://jenkins.example.com/job/first/', name: 'First', group: 'A'}
    ]);
  });

  test('skips fully empty rows without flagging them invalid', () => {
    document.getElementById('addJobEntry').click();
    document.getElementById('addJobEntry').click();
    const rows = getRows();
    rows[0].querySelector('.job-entry-url').value = 'http://jenkins.example.com/job/only-one/';

    Jobs.setUrls = jest.fn().mockResolvedValue({});

    document.getElementById('saveUrls').click();

    expect(Jobs.setUrls).toHaveBeenCalledWith([
      {url: 'http://jenkins.example.com/job/only-one/', name: '', group: ''}
    ]);
    expect(document.getElementById('urlsError').style.display).toBe('none');
  });

  test('saves showSummary option when the checkbox is toggled off', () => {
    const checkbox = document.getElementById('showSummary');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    const setCall = chrome.storage.local.set.mock.calls
      .map(call => call[0])
      .reverse()
      .find(arg => arg && arg.options);

    expect(setCall).toBeDefined();
    expect(setCall.options.showSummary).toBe(false);
  });

  test('restores the showSummary checkbox from stored options', () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => cb({
      options: { refreshTime: 60, notification: 'all', showSummary: false }
    }));

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('showSummary').checked).toBe(false);
  });
});
