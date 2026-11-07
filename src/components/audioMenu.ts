// Right-click (or long-press) on any mic / headphone button: live input and
// output volume, voice isolation and a shortcut to the full voice settings.
import type { MouseEvent as ReactMouseEvent } from 'react';
import { getSettings, updateVoice } from '../lib/settings';
import { openSettings } from '../lib/ui';
import { openMenu, openMenuAt, type Entry } from './ContextMenu';

function entries(kind: 'input' | 'output'): Entry[] {
  const v = getSettings().voice;
  const pct = (x: number) => `${x}%`;
  return kind === 'input'
    ? [
        { type: 'header', label: 'Microphone' },
        { type: 'slider', label: 'Input volume', value: v.inputVolume, min: 0, max: 200, step: 5, format: pct, onChange: (x) => updateVoice({ inputVolume: x }) },
        { type: 'check', label: 'Voice isolation (only your voice)', checked: v.voiceIsolation, onChange: (x) => updateVoice({ voiceIsolation: x }) },
        { type: 'check', label: 'Echo cancellation', checked: v.echoCancellation, onChange: (x) => updateVoice({ echoCancellation: x }) },
        { type: 'sep' },
        { label: 'Voice & Video settings', icon: 'settings', onClick: () => openSettings('voice') },
      ]
    : [
        { type: 'header', label: 'Sound' },
        { type: 'slider', label: 'Output volume', value: v.outputVolume ?? 100, min: 0, max: 200, step: 5, format: pct, onChange: (x) => updateVoice({ outputVolume: x }) },
        { type: 'sep' },
        { label: 'Voice & Video settings', icon: 'settings', onClick: () => openSettings('voice') },
      ];
}

export function openAudioMenu(e: ReactMouseEvent | MouseEvent, kind: 'input' | 'output') {
  openMenu(e, entries(kind));
}
export function openAudioMenuAt(el: HTMLElement, kind: 'input' | 'output') {
  openMenuAt(el, entries(kind));
}
