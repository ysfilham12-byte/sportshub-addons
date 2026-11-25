import { catalogs } from './catalogs.js';
import { languages } from './languages.js';

const templateUrl = 'https://raw.githubusercontent.com/reelhumann-glitch/sportshub/main/aiostreams-template.json';
const $ = selector => document.querySelector(selector);
const sections = [...document.querySelectorAll('[data-step]')];
const progress = [...document.querySelectorAll('#progress li')];
const choices = $('#catalog-options');
const languageOptions = $('#language-options');
const notice = $('#notice');
let step = 0;

function addCheckbox(container, value, name, checked = false) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = value;
  box.checked = checked;
  label.append(box, name);
  container.append(label);
}
for (const catalog of catalogs) {
  addCheckbox($(catalog.league ? '#league-list' : '#catalog-list'), catalog.id, catalog.name, !catalog.league);
}
for (const [code, name] of languages) addCheckbox($('#language-list'), code, name);

const checked = name => document.querySelector(`input[name="${name}"]:checked`).value;
const selected = container => [...container.querySelectorAll('input:checked')].map(box => box.value);
const custom = () => checked('catalog-mode') === 'custom';

function refresh() {
  $('#source-setup').hidden = checked('source') !== 'setup';
  $('#catalog-options').hidden = !custom();
  $('#custom-deploy').hidden = !custom();
  $('#catalog-value-wrap').hidden = !custom();
  $('#catalog-value').value = custom() ? selected(choices).join(',') : '';
  const language = checked('language');
  const allowUnknown = language === 'english' || language === 'selected';
  languageOptions.hidden = language !== 'selected';
  $('#unknown-option').hidden = !allowUnknown;
  $('#language-deploy').hidden = language === 'preferred';
  $('#language-value-wrap').hidden = language === 'preferred';
  const codes = language === 'selected' ? selected(languageOptions) : [language];
  if (allowUnknown && $('#unknown-language').checked) codes.push('unknown');
  $('#language-value').value = codes.join(',');
  $('#back').hidden = step === 0;
  $('#next').hidden = step === sections.length - 1;
  sections.forEach((section, index) => { section.hidden = index !== step; });
  progress.forEach((item, index) => {
    if (index === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function move(delta) {
  notice.textContent = '';
  if (delta > 0 && step === 1 && custom() && !selected(choices).length) {
    notice.textContent = 'Select at least one catalog to continue.';
    choices.querySelector('input').focus();
    return;
  }
  if (delta > 0 && step === 1 && checked('language') === 'selected' && !selected(languageOptions).length) {
    notice.textContent = 'Select at least one language to continue.';
    languageOptions.querySelector('input').focus();
    return;
  }
  step += delta;
  refresh();
  sections[step].querySelector('h2').focus();
}

function manifestLink() {
  try {
    const url = new URL($('#worker-url').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/manifest.json') ? path : `${path}/manifest.json`;
    return url.href;
  } catch {
    return '';
  }
}

async function copy(text, message) {
  if (!text) {
    notice.textContent = 'Enter the HTTPS address of your Cloudflare Worker first.';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    notice.textContent = message;
  } catch {
    notice.textContent = `Copy this value manually. ${text}`;
  }
}

$('#back').addEventListener('click', () => move(-1));
$('#next').addEventListener('click', () => move(1));
document.querySelector('.panel').addEventListener('change', () => {
  notice.textContent = '';
  refresh();
});
$('#worker-url').addEventListener('input', () => { $('#manifest-preview').textContent = manifestLink(); });
$('[data-copy=template]').addEventListener('click', () => copy(templateUrl, 'Template URL copied.'));
$('[data-copy=catalogs]').addEventListener('click', () => copy($('#catalog-value').value, 'Catalog value copied.'));
$('[data-copy=language]').addEventListener('click', () => copy($('#language-value').value, 'Language setting copied.'));
$('[data-copy=manifest]').addEventListener('click', () => copy(manifestLink(), 'Install link copied.'));
refresh();
