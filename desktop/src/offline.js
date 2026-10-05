'use strict';
const target = new URLSearchParams(location.search).get('to') || 'https://www.venband.com/channels/@me';
const go = () => {
  // only ever go back to Venband
  if (/^https:\/\/(www\.)?venband\.com\//.test(target) || /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(target)) location.href = target;
};
document.getElementById('retry').addEventListener('click', go);
let left = 15;
setInterval(() => {
  left--;
  document.getElementById('next').textContent = `Trying again in ${left}s`;
  if (left <= 0) {
    left = 15;
    if (navigator.onLine) go();
  }
}, 1000);
window.addEventListener('online', go);
