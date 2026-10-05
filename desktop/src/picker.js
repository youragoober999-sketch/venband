'use strict';
let sources = [];
let kind = 'screen';
let selected = null;
const grid = document.getElementById('grid');
function render() {
  grid.textContent = '';
  for (const s of sources.filter((x) => x.kind === kind)) {
    const b = document.createElement('button');
    b.className = `src${selected === s.id ? ' sel' : ''}`;
    const img = document.createElement('img');
    img.src = s.thumb;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = s.name;
    b.append(img, label);
    b.addEventListener('click', () => {
      selected = s.id;
      document.getElementById('share').disabled = false;
      render();
    });
    b.addEventListener('dblclick', () => window.venbandPicker.choose(s.id));
    grid.append(b);
  }
}
window.venbandPicker.onSources((list) => {
  sources = Array.isArray(list) ? list : [];
  render();
});
for (const k of ['screen', 'window'])
  document.getElementById(`t-${k}`).addEventListener('click', (e) => {
    kind = k;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === e.currentTarget));
    render();
  });
document.getElementById('share').addEventListener('click', () => selected && window.venbandPicker.choose(selected));
document.getElementById('cancel').addEventListener('click', () => window.venbandPicker.choose(null));
