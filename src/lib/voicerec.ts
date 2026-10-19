// Voice message recorder: records audio, shows live waveform, exports MP3.
import lamejs from 'lamejs';

export interface VoiceRecorder {
  start: () => Promise<void>;
  stop: () => Promise<File>;
  cancel: () => void;
  getWaveform: () => number[]; // 0..1 amplitudes
  isRecording: () => boolean;
}

export function createVoiceRecorder(onLevel?: (level: number) => void): VoiceRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let recording = false;
  let analyser: AnalyserNode | null = null;
  let audioCtx: AudioContext | null = null;
  let raf: number | null = null;
  let levels: number[] = [];

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
      levels.push(avg);
      if (levels.length > 60) levels.shift();
      onLevel?.(avg);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.start();
    recording = true;
  }

  async function stop(): Promise<File> {
    return new Promise((resolve) => {
      if (!mediaRecorder) { resolve(new File([], 'voice.mp3')); return; }
      mediaRecorder.onstop = async () => {
        if (raf) cancelAnimationFrame(raf);
        const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
        // decode to PCM
        const ab = await blob.arrayBuffer();
        const ctx = new AudioContext();
        const audioBuffer = await ctx.decodeAudioData(ab);
        const pcm = audioBuffer.getChannelData(0);
        // encode to mp3
        const sampleRate = audioBuffer.sampleRate;
        const encoder = new (lamejs as any).Mp3Encoder(1, sampleRate, 128);
        const mp3Chunks: Int8Array[] = [];
        const blockSize = 1152;
        for (let i = 0; i < pcm.length; i += blockSize) {
          const slice = pcm.subarray(i, i + blockSize);
          const int16 = new Int16Array(slice.length);
          for (let j = 0; j < slice.length; j++) int16[j] = Math.max(-32768, Math.min(32767, slice[j] * 32767));
          const mp3buf = encoder.encodeBuffer(int16);
          if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
        }
        const end = encoder.flush();
        if (end.length > 0) mp3Chunks.push(end);
        const mp3Blob = new Blob(mp3Chunks.map((b) => new Uint8Array(b)), { type: 'audio/mp3' });
        const file = new File([mp3Blob], `voice-${Date.now()}.mp3`, { type: 'audio/mp3' });
        // cleanup
        stream?.getTracks().forEach((t) => t.stop());
        audioCtx?.close();
        ctx.close();
        recording = false;
        resolve(file);
      };
      mediaRecorder.stop();
    });
  }

  function cancel() {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
      if (raf) cancelAnimationFrame(raf);
      recording = false;
    }
    chunks = [];
  }

  return {
    start,
    stop,
    cancel,
    getWaveform: () => [...levels],
    isRecording: () => recording,
  };
}