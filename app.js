/*
 * Application logic for the Password CSV Compare tool.
 *
 * This script handles:
 *  - Internationalisation (EN/FR) with runtime language switching
 *  - Reading CSV files from the user's device (100 % client side)
 *  - Parsing the CSV content into objects using a simple CSV parser
 *  - Normalising URL and username fields and extracting root domains
 *  - Detecting column names to map arbitrary CSV formats to the expected fields
 *  - Comparing two lists of credentials and identifying missing entries
 *  - Displaying a summary and a preview table of missing entries
 *  - Generating a CSV ready for import into Apple Passwords
 *  - Registering a service worker for offline support
 */

(function () {
  'use strict';

  // Translation strings. Each entry can be a string or a function returning a string.
  const translations = {
    fr: {
      title: 'Comparer CSV Passwords',
      dashlaneLabel: 'Importez le fichier Dashlane (.csv)',
      appleLabel: 'Importez le fichier Apple Passwords (.csv)',
      compareBtn: 'Comparer',
      summaryDash: (n) => `Dashlane : ${n} entrées`,
      summaryApple: (n) => `Apple : ${n} entrées`,
      summaryMissing: (n) => `Manquants : ${n} entrées`,
      previewTitle: 'Entrées manquantes',
      exportBtn: 'Télécharger le CSV',
      privacyMsg: 'Vos mots de passe ne quittent jamais cet appareil.',
      strictOn: 'Comparaison stricte (URL + identifiant)',
      strictOff: 'Comparaison par domaine + identifiant',
      toggleLang: 'EN',
      tableHeaders: ['Titre', 'URL', 'Identifiant', 'Mot de passe', 'Notes']
    },
    en: {
      title: 'Password CSV Compare',
      dashlaneLabel: 'Import Dashlane file (.csv)',
      appleLabel: 'Import Apple Passwords file (.csv)',
      compareBtn: 'Compare',
      summaryDash: (n) => `Dashlane: ${n} entries`,
      summaryApple: (n) => `Apple: ${n} entries`,
      summaryMissing: (n) => `Missing: ${n} entries`,
      previewTitle: 'Missing entries',
      exportBtn: 'Download CSV',
      privacyMsg: 'Your passwords never leave this device.',
      strictOn: 'Strict compare (URL + username)',
      strictOff: 'Compare by domain + username',
      toggleLang: 'FR',
      tableHeaders: ['Title', 'URL', 'Username', 'Password', 'Notes']
    }
  };

  // Keep track of the current language; default to French per PRD.
  let currentLang = 'fr';

  // Cache DOM elements for re-use.
  const appTitleEl = document.getElementById('app-title');
  const dashlaneLabelEl = document.getElementById('dashlane-label');
  const appleLabelEl = document.getElementById('apple-label');
  const compareBtn = document.getElementById('compare-btn');
  const exportBtn = document.getElementById('export-btn');
  const summarySection = document.getElementById('summary-section');
  const summaryDashEl = document.getElementById('summary-dash');
  const summaryAppleEl = document.getElementById('summary-apple');
  const summaryMissingEl = document.getElementById('summary-missing');
  const previewSection = document.getElementById('preview-section');
  const previewTitleEl = document.getElementById('preview-title');
  const tableContainer = document.getElementById('table-container');
  const exportSection = document.getElementById('export-section');
  const privacyMsgEl = document.getElementById('privacy-msg');
  const strictToggle = document.getElementById('strict-toggle');
  const strictLabel = document.getElementById('strict-label');
  const toggleLangBtn = document.getElementById('toggle-lang');
  const dashFileInput = document.getElementById('dashlane-file');
  const appleFileInput = document.getElementById('apple-file');

  // Internal state: lists of parsed entries.
  let dashEntries = [];
  let appleEntries = [];
  let missingEntries = [];

  /*
   * Update all translatable texts on the page according to currentLang.
   */
  function updateLangTexts() {
    const tr = translations[currentLang];
    appTitleEl.textContent = tr.title;
    dashlaneLabelEl.textContent = tr.dashlaneLabel;
    appleLabelEl.textContent = tr.appleLabel;
    compareBtn.textContent = tr.compareBtn;
    exportBtn.textContent = tr.exportBtn;
    previewTitleEl.textContent = tr.previewTitle;
    privacyMsgEl.textContent = tr.privacyMsg;
    toggleLangBtn.textContent = tr.toggleLang;
    // strict toggle label depends on the current state
    strictLabel.textContent = strictToggle.checked ? tr.strictOn : tr.strictOff;
    // update summary if lists already loaded
    updateSummary();
    // update table headers if the preview is visible
    if (!previewSection.classList.contains('hidden') && missingEntries.length > 0) {
      renderTable(missingEntries);
    }
  }

  /*
   * CSV parser.
   * Splits the input text into an array of rows, each row being an array of fields.
   * Handles quoted values, escaped quotes and newline characters inside quotes.
   */
  function parseCSV(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        // Escaped quote
        if (inQuotes && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(field);
        field = '';
      } else if ((c === '\n' || c === '\r') && !inQuotes) {
        // End of line
        // handle CRLF
        if (c === '\r' && text[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    // Add the last field/row if necessary
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /*
   * Define synonyms for each expected column to enable flexible mapping.
   * Keys are our internal property names; values are arrays of strings that may appear in CSV headers.
   */
  const FIELD_SYNONYMS = {
    title: ['title', 'name', 'nom', 'item', 'account'],
    url: ['url', 'website', 'site', 'address', 'webaddress', 'adresse'],
    username: ['username', 'login', 'email', 'e-mail', 'user', 'utilisateur'],
    password: ['password', 'motdepasse', 'passcode'],
    notes: ['notes', 'note', 'remarks', 'comment', 'commentaires', 'remarques'],
    otpAuth: ['otp', 'totp', 'twofactor', 'otpAuth']
  };

  /*
   * Given an array of header names, returns a mapping from column index to our internal field name.
   * Unknown headers are ignored. If multiple columns map to the same field, the first one wins.
   */
  function detectMapping(headers) {
    const map = {};
    const usedProps = new Set();
    headers.forEach((header, idx) => {
      const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const prop in FIELD_SYNONYMS) {
        const synonyms = FIELD_SYNONYMS[prop];
        for (const syn of synonyms) {
          if (normalized.includes(syn.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
            if (!usedProps.has(prop)) {
              map[idx] = prop;
              usedProps.add(prop);
            }
            return;
          }
        }
      }
    });
    return map;
  }

  /*
   * Ensure a URL starts with https:// and remove trailing slashes.
   */
  function normaliseUrl(url) {
    if (!url) return '';
    let trimmed = url.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }
    // remove trailing slash
    trimmed = trimmed.replace(/\/$/, '');
    return trimmed;
  }

  /*
   * Extract the registrable domain from a URL. This basic implementation
   * takes the last two segments of the hostname, unless the second-level
   * TLD is a common registry like "co" or "com", in which case it uses three.
   */
  function extractDomain(urlString) {
    try {
      const url = new URL(urlString);
      const host = url.hostname.toLowerCase();
      const parts = host.split('.');
      if (parts.length <= 2) {
        return host;
      }
      const secondLevelTlds = ['co', 'com', 'gov', 'ac', 'edu', 'net', 'org'];
      const last = parts[parts.length - 1];
      const secondLast = parts[parts.length - 2];
      if (secondLevelTlds.includes(secondLast)) {
        // e.g. example.co.uk -> take last three parts
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    } catch (err) {
      // In case of invalid URL, fallback to empty string
      return '';
    }
  }

  /*
   * Parse a File object into a list of credential objects.
   */
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve([]);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const rows = parseCSV(text);
        if (!rows.length) {
          resolve([]);
          return;
        }
        const headers = rows[0].map((h) => (h || '').trim());
        const mapping = detectMapping(headers);
        const list = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          // skip empty rows
          if (row.every((cell) => cell === '')) continue;
          const obj = {
            title: '',
            url: '',
            username: '',
            password: '',
            notes: '',
            otpAuth: '',
            domain: ''
          };
          // Map fields
          for (let col = 0; col < row.length; col++) {
            const prop = mapping[col];
            if (!prop) continue;
            obj[prop] = row[col] || '';
          }
          // Normalise URL and domain
          obj.url = normaliseUrl(obj.url);
          obj.domain = extractDomain(obj.url);
          // Lowercase username if it looks like an email
          if (obj.username && /@/.test(obj.username)) {
            obj.username = obj.username.toLowerCase();
          }
          list.push(obj);
        }
        resolve(list);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    });
  }

  /*
   * Enable or disable the Compare button depending on whether both lists have been loaded.
   */
  function updateCompareButton() {
    compareBtn.disabled = !(dashEntries.length && appleEntries.length);
  }

  /*
   * Compare two lists of credential objects and return the entries present in listA but absent from listB.
   * If strict is true, compare by full URL and username; otherwise compare by domain and username.
   */
  function computeMissing(listA, listB, strict) {
    const set = new Set();
    listB.forEach((entry) => {
      const key = strict
        ? `${entry.url.toLowerCase()}|${(entry.username || '').toLowerCase()}`
        : `${entry.domain.toLowerCase()}|${(entry.username || '').toLowerCase()}`;
      set.add(key);
    });
    const missing = [];
    listA.forEach((entry) => {
      const key = strict
        ? `${entry.url.toLowerCase()}|${(entry.username || '').toLowerCase()}`
        : `${entry.domain.toLowerCase()}|${(entry.username || '').toLowerCase()}`;
      if (!set.has(key)) {
        missing.push(entry);
      }
    });
    return missing;
  }

  /*
   * Update the summary lines with the number of entries in each list and missing entries.
   */
  function updateSummary() {
    const tr = translations[currentLang];
    summaryDashEl.textContent = tr.summaryDash(dashEntries.length);
    summaryAppleEl.textContent = tr.summaryApple(appleEntries.length);
    summaryMissingEl.textContent = tr.summaryMissing(missingEntries.length);
  }

  /*
   * Render a table of missing entries into the tableContainer element.
   */
  function renderTable(entries) {
    // Clear previous table
    tableContainer.innerHTML = '';
    if (!entries || entries.length === 0) {
      return;
    }
    const tr = translations[currentLang];
    const headers = tr.tableHeaders;
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    entries.forEach((entry) => {
      const row = document.createElement('tr');
      [entry.title, entry.url, entry.username, entry.password, entry.notes].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val || '';
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    tableContainer.appendChild(table);
  }

  /*
   * Perform the comparison and update the UI accordingly.
   */
  function performComparison() {
    const strict = strictToggle.checked;
    missingEntries = computeMissing(dashEntries, appleEntries, strict);
    summarySection.classList.remove('hidden');
    previewSection.classList.remove('hidden');
    exportSection.classList.remove('hidden');
    updateSummary();
    renderTable(missingEntries);
  }

  /*
   * Generate a CSV string from the missing entries list in Apple Passwords format.
   */
  function generateCsv(entries) {
    const lines = [];
    // Apple Passwords expected header
    lines.push('title,url,username,password,notes,otpAuth');
    const escape = (value) => {
      if (value == null) return '';
      const str = String(value);
      if (/[,"\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    entries.forEach((entry) => {
      const row = [
        escape(entry.title),
        escape(entry.url),
        escape(entry.username),
        escape(entry.password),
        escape(entry.notes),
        '' // otpAuth blank
      ];
      lines.push(row.join(','));
    });
    return lines.join('\r\n');
  }

  /*
   * Export the missing entries as a CSV file and trigger a download.
   */
  function exportCsvFile() {
    if (!missingEntries.length) return;
    const csvContent = generateCsv(missingEntries);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `missing-passwords-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Event listeners
  dashFileInput.addEventListener('change', () => {
    const file = dashFileInput.files[0];
    parseFile(file)
      .then((list) => {
        dashEntries = list;
        updateCompareButton();
        // Hide preview when new file loaded
        summarySection.classList.add('hidden');
        previewSection.classList.add('hidden');
        exportSection.classList.add('hidden');
      })
      .catch((err) => {
        console.error('Failed to parse Dashlane file', err);
        dashEntries = [];
      });
  });

  appleFileInput.addEventListener('change', () => {
    const file = appleFileInput.files[0];
    parseFile(file)
      .then((list) => {
        appleEntries = list;
        updateCompareButton();
        summarySection.classList.add('hidden');
        previewSection.classList.add('hidden');
        exportSection.classList.add('hidden');
      })
      .catch((err) => {
        console.error('Failed to parse Apple file', err);
        appleEntries = [];
      });
  });

  compareBtn.addEventListener('click', () => {
    performComparison();
  });

  strictToggle.addEventListener('change', () => {
    // Update label for strict toggle and rerun comparison if lists already loaded
    const tr = translations[currentLang];
    strictLabel.textContent = strictToggle.checked ? tr.strictOn : tr.strictOff;
    if (dashEntries.length && appleEntries.length) {
      performComparison();
    }
  });

  exportBtn.addEventListener('click', () => {
    exportCsvFile();
  });

  toggleLangBtn.addEventListener('click', () => {
    currentLang = currentLang === 'fr' ? 'en' : 'fr';
    updateLangTexts();
  });

  // Initial text update
  updateLangTexts();

  // Register service worker if supported
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('service-worker.js')
        .catch((err) => {
          console.error('Service worker registration failed:', err);
        });
    });
  }
})();