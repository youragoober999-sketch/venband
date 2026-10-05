'use strict';
const $ = (id) => document.getElementById(id);
let failures = 0;
window.venbandUpdate.onInfo((info) => {
  $('ver').textContent = `Version ${info.version} · you have ${info.current}`;
  $('notes').textContent = info.notes || '';
});
$('go').addEventListener('click', () => {
  $('go').disabled = true;
  $('go').textContent = 'Downloading…';
  $('bar').style.display = 'block';
  $('err').textContent = '';
  window.venbandUpdate.start();
});
window.venbandUpdate.onProgress((p) => {
  $('fill').style.width = `${p}%`;
  $('go').textContent = `Downloading… ${p}%`;
});
window.venbandUpdate.onReady(() => {
  $('fill').style.width = '100%';
  $('go').textContent = 'Restarting…';
});
window.venbandUpdate.onError((msg) => {
  failures++;
  $('err').textContent = `The update didn’t download (${msg}). Check your connection and try again.`;
  $('go').disabled = false;
  $('go').textContent = 'Try again';
  // never lock anyone out because of a bad connection
  if (failures >= 2) $('later').style.display = 'block';
});
$('later').addEventListener('click', () => window.venbandUpdate.later());
