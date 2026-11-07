// Settings → Voice & Video → Sounds: volume, preview and switch off each sound.
import { useState } from 'react';
import { SFX_LABEL, setSfxEnabled, sfx, sfxOff, sfxVolume, type SfxName } from '../lib/sfx';
import { Icon, Slider } from './ui';

export function SoundSettings() {
  const [off, setOff] = useState(() => sfxOff());
  const [volume, setVolume] = useState(() => Math.round(sfxVolume() * 100));
  return (
    <section className="settings-section">
      <h3>Sounds</h3>
      <p className="muted small">Every Venband sound is made on your device — preview them, or switch off the ones you don’t want.</p>
      <label className="sound-volume">
        <span>Volume — {volume}%</span>
        <Slider
          min={0}
          max={100}
          step={5}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            try {
              localStorage.setItem('venband:notify-volume', String(v / 100));
            } catch {
              /* storage blocked */
            }
          }}
          onPointerUp={() => sfx('notification', { force: true })}
          onKeyUp={() => sfx('notification', { force: true })}
        />
      </label>
      <ul className="sound-list">
        {(Object.keys(SFX_LABEL) as SfxName[]).map((name) => (
          <li key={name} className="sound-row">
            <button className="icon-btn" onClick={() => sfx(name, { force: true })} aria-label={`Preview: ${SFX_LABEL[name]}`} title="Preview">
              <Icon name="play" size={14} />
            </button>
            <span className="grow">{SFX_LABEL[name]}</span>
            <input
              type="checkbox"
              className="toggle"
              checked={!off.has(name)}
              onChange={(e) => {
                setSfxEnabled(name, e.target.checked);
                setOff(sfxOff());
              }}
              aria-label={`${SFX_LABEL[name]} sound`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
