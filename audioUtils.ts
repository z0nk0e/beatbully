

/**
 * @fileoverview Utilities and classes for real-time audio analysis and sample triggering.
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SampleAnalysis } from './index'; // Assuming SampleAnalysis is exported from index.tsx or a types file
// import { decodeAudioData as decodeRawPcmAudioData } from './utils'; // Renamed for clarity if ever needed for raw PCM


// --- INTERFACES ---

export interface MusicalContext {
  timestamp: number; // Time of analysis
  bpm?: number; // Current estimated BPM of Lyria's output
  beatDensity?: number; // Normalized measure of rhythmic activity (0-1)
  onsets?: boolean[]; // Array indicating onset detection in sub-frames of the analyzed buffer
  key?: string; // Estimated key of Lyria's output
  scale?: string; // Estimated scale
  energy?: number; // Estimated energy (0-1) of Lyria's output
  dominantFrequencies?: number[]; // Dominant frequencies in Lyria's output
  // rhythmicDensity was renamed to beatDensity
}

export interface UserSample {
  id: string;
  name: string;
  originalFile?: File;
  base64?: string;
  audioBuffer?: AudioBuffer;
  metadata: SampleAnalysis;
}

export interface PlaybackConfig {
  volume?: number; // 0-1
  pitchShift?: number; // In semitones
  timingOffset?: number; // Delay in seconds before playing
}

// --- AUDIO MIXER ---

export class AudioMixer {
  private audioContext: AudioContext;
  private masterOutput: AudioNode; // Can be context.destination or a MediaStreamAudioDestinationNode

  constructor(audioContext: AudioContext, destinationNode?: AudioNode) {
    this.audioContext = audioContext;
    this.masterOutput = destinationNode || this.audioContext.destination;
  }

  private async decodeAndStoreAudioBuffer(sample: UserSample): Promise<boolean> {
    if (sample.audioBuffer) return true; // Already decoded

    let arrayBuffer: ArrayBuffer | null = null;

    if (sample.originalFile) {
      try {
        arrayBuffer = await sample.originalFile.arrayBuffer();
      } catch (e) {
        console.error(`Error reading ArrayBuffer from originalFile for ${sample.name}:`, e);
      }
    }

    if (!arrayBuffer && sample.base64) {
      try {
        const byteString = atob(sample.base64);
        const byteArray = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
          byteArray[i] = byteString.charCodeAt(i);
        }
        arrayBuffer = byteArray.buffer;
      } catch (e) {
        console.error(`Error converting base64 to ArrayBuffer for ${sample.name}:`, e);
      }
    }

    if (arrayBuffer) {
      try {
        sample.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return true;
      } catch (e) {
        console.error(`Error decoding audio data with audioContext.decodeAudioData for ${sample.name}:`, e);
        sample.metadata.error = `Audio decoding failed: ${e instanceof Error ? e.message : String(e)}`;
        return false;
      }
    }

    sample.metadata.error = 'No audio data (file or base64) found to decode.';
    return false;
  }


  async playSample(sample: UserSample, config: PlaybackConfig = {}): Promise<void> {
    if (!sample.audioBuffer) {
      const decodedSuccessfully = await this.decodeAndStoreAudioBuffer(sample);
      if (!decodedSuccessfully || !sample.audioBuffer) {
        console.warn(`Sample ${sample.name} could not be decoded or has no AudioBuffer. Error: ${sample.metadata.error}`);
        return;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = sample.audioBuffer;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = config.volume ?? 1.0;

    if (config.pitchShift && config.pitchShift !== 0) {
      source.playbackRate.value = Math.pow(2, config.pitchShift / 12);
    }

    source.connect(gainNode).connect(this.masterOutput);
    const startTime = this.audioContext.currentTime + (config.timingOffset ?? 0);
    source.start(startTime);
  }
}

// --- AUDIO CONTEXT ANALYZER ---
const NUM_CHROMA_BINS = 12;
const KEY_TEMPLATES: Record<string, Record<string, number[]>> = {
  Major: {
    C: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], G: [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1], D: [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1],
    A: [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1], E: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0], B: [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    Gb: [0,1,0,1,1,0,1,0,1,1,0,1], Db: [1,0,1,1,0,1,0,1,0,1,1,0], Ab: [1,1,0,1,0,1,1,0,1,0,1,0], Eb: [0,1,1,0,1,1,0,1,0,1,0,1], Bb: [1,0,1,0,1,1,0,1,1,0,1,0], F: [1,0,1,0,1,1,1,0,1,0,1,0],
  },
  Minor: { // Corrected keys to use # notation for consistency
    A: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1], E: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], B: [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
    "F#": [1,1,0,1,0,1,0,1,1,0,1,0], "C#": [0,1,1,0,1,0,1,0,1,1,0,1], "G#": [1,0,1,1,0,1,0,1,0,1,1,0], "D#": [0,1,0,1,1,0,1,1,0,1,0,1], "A#": [1,1,0,1,0,1,1,0,1,0,1,0],
    D: [1,0,1,1,0,1,0,1,0,1,0,1], G: [1,0,1,0,1,1,0,1,1,0,0,1], C: [1,1,0,1,1,0,1,0,1,0,0,1], F: [1,0,1,1,0,1,1,0,1,0,1,0],
  },
};
const PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export class AudioContextAnalyzer {
  private audioContext: AudioContext;
  private analyserNode: AnalyserNode;
  private frequencyData: Uint8Array;
  private prevSpectrum: Float32Array; // For spectral flux
  private spectralFluxHistory: number[] = [];
  private readonly FLUX_HISTORY_SIZE = 30;


  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.3;
    this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.prevSpectrum = new Float32Array(this.analyserNode.frequencyBinCount);
  }

  private getFrequencySpectrum(): number[] {
    this.analyserNode.getByteFrequencyData(this.frequencyData);
    const peaks: { freq: number, amp: number }[] = [];
    const binWidth = this.audioContext.sampleRate / this.analyserNode.fftSize;
    for (let i = 0; i < this.analyserNode.frequencyBinCount; i++) {
      if (this.frequencyData[i] > 128) {
        peaks.push({ freq: i * binWidth, amp: this.frequencyData[i] });
      }
    }
    peaks.sort((a, b) => b.amp - a.amp);
    return peaks.slice(0, 5).map(p => p.freq);
  }

  private calculateEnergy(): number {
    this.analyserNode.getByteFrequencyData(this.frequencyData);
    let sum = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      sum += this.frequencyData[i];
    }
    const average = sum / this.frequencyData.length;
    return Math.min(average / 128, 1.0);
  }

  private detectOnsetsAndDensity(): { onsets: boolean[], beatDensity: number } {
    const currentSpectrum = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(currentSpectrum);

    for (let i = 0; i < currentSpectrum.length; i++) {
        currentSpectrum[i] = currentSpectrum[i] < -100 ? 0 : Math.pow(10, currentSpectrum[i] / 20);
    }

    let spectralFlux = 0;
    for (let i = 0; i < currentSpectrum.length; i++) {
        const diff = currentSpectrum[i] - this.prevSpectrum[i];
        if (diff > 0) {
            spectralFlux += diff;
        }
    }
    this.prevSpectrum.set(currentSpectrum);

    this.spectralFluxHistory.push(spectralFlux);
    if (this.spectralFluxHistory.length > this.FLUX_HISTORY_SIZE) {
        this.spectralFluxHistory.shift();
    }

    if (this.spectralFluxHistory.length === 0) {
        return { onsets: [false], beatDensity: 0 };
    }

    const meanFlux = this.spectralFluxHistory.reduce((s, v) => s + v, 0) / this.spectralFluxHistory.length;

    let variance = 0;
    for (const flux of this.spectralFluxHistory) {
        variance += Math.pow(flux - meanFlux, 2);
    }
    variance = this.spectralFluxHistory.length > 0 ? variance / this.spectralFluxHistory.length : 0;
    const stdDevFlux = Math.sqrt(variance);

    const fluxThreshold = meanFlux + (stdDevFlux * 1.5);

    const onsetDetected = spectralFlux > fluxThreshold && spectralFlux > 0.01;

    const beatDensityDenominator = meanFlux + 1e-6; // Avoid division by zero if meanFlux is 0
    const rawDensity = beatDensityDenominator === 0 ? 0 : (spectralFlux / beatDensityDenominator -1) / 5;
    const beatDensity = Math.min(1, Math.max(0, rawDensity ));


    return { onsets: [onsetDetected], beatDensity: isNaN(beatDensity) ? 0 : beatDensity };
  }

 private estimateKeyFromChroma(): { key?: string, scale?: string } {
    this.analyserNode.getByteFrequencyData(this.frequencyData);
    const chroma = new Array(NUM_CHROMA_BINS).fill(0);
    const binWidth = this.audioContext.sampleRate / this.analyserNode.fftSize;

    for (let i = 0; i < this.analyserNode.frequencyBinCount; i++) {
        const freq = i * binWidth;
        if (freq === 0) continue;
        const midiNote = 69 + 12 * Math.log2(freq / 440);
        const pitchClass = Math.round(midiNote) % NUM_CHROMA_BINS;

        if (pitchClass >=0 && pitchClass < NUM_CHROMA_BINS) {
             chroma[pitchClass] += this.frequencyData[i];
        }
    }

    const sum = chroma.reduce((s, val) => s + val, 0);
    if (sum === 0) return { key: undefined, scale: undefined };
    const normalizedChroma = chroma.map(val => val / sum);

    let bestMatch = { key: undefined as string | undefined, scale: undefined as string | undefined, score: -1 };

    for (const scaleName in KEY_TEMPLATES) {
        for (const keyName in KEY_TEMPLATES[scaleName]) {
            const template = KEY_TEMPLATES[scaleName][keyName];
            let score = 0;
            for (let i = 0; i < NUM_CHROMA_BINS; i++) {
                score += normalizedChroma[i] * template[i];
            }
            if (score > bestMatch.score) {
                bestMatch = { key: keyName, scale: scaleName, score };
            }
        }
    }
    return { key: bestMatch.key, scale: bestMatch.scale };
}


  public async analyzeRealTimeContext(inputBuffer: AudioBuffer): Promise<MusicalContext> {
    const defaultContext: MusicalContext = {
        timestamp: Date.now(),
        dominantFrequencies: [],
        energy: 0,
        key: undefined,
        scale: undefined,
        onsets: [false],
        beatDensity: 0,
    };

    if (inputBuffer == null) { // Checks for undefined or null
        console.warn("AudioContextAnalyzer: Received null or undefined inputBuffer for analysis.");
        return defaultContext;
    }
    if (inputBuffer.length === 0) { // Then check for length if it's a valid object
        console.warn("AudioContextAnalyzer: Received an empty inputBuffer (length 0) for analysis.");
        return defaultContext;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = inputBuffer;

    const internalAnalyserInput = this.audioContext.createGain();
    source.connect(internalAnalyserInput);
    internalAnalyserInput.connect(this.analyserNode);
    source.start();

    await new Promise(resolve => setTimeout(resolve, inputBuffer.duration * 1000 + 50));

    try {
        source.stop();
    } catch (e) {
        // Ignore
    }
    try {
        source.disconnect();
        internalAnalyserInput.disconnect();
    } catch (e) {
        // Ignore
    }

    const onsetInfo = this.detectOnsetsAndDensity();
    const keyInfo = this.estimateKeyFromChroma();

    return {
      timestamp: Date.now(),
      dominantFrequencies: this.getFrequencySpectrum(),
      energy: this.calculateEnergy(),
      key: keyInfo.key,
      scale: keyInfo.scale,
      onsets: onsetInfo.onsets,
      beatDensity: onsetInfo.beatDensity,
    };
  }
}


// --- CONTEXT AWARE LYRIA SESSION ---

export class ContextAwareLyriaSession {
  private audioContext: AudioContext;
  private audioBufferQueue: AudioBuffer[] = [];
  private readonly maxBufferDurationSecs = 2.0;
  private readonly analysisIntervalMs = 500;
  private contextAnalyzer: AudioContextAnalyzer;
  private onContextUpdateCallback: (context: MusicalContext) => void;
  private lastAnalysisTime = 0;
  private accumulatedBufferLength = 0;


  constructor(
    audioContext: AudioContext,
    onContextUpdate: (context: MusicalContext) => void
  ) {
    this.audioContext = audioContext;
    this.contextAnalyzer = new AudioContextAnalyzer(audioContext);
    this.onContextUpdateCallback = onContextUpdate;
  }

  public handleNewLyriaAudioBuffer(lyriaBuffer: AudioBuffer): void {
    if (lyriaBuffer == null || lyriaBuffer.length === 0) { // Guard against invalid buffers
        console.warn("ContextAwareLyriaSession: Received invalid Lyria audio buffer.");
        return;
    }
    this.audioBufferQueue.push(lyriaBuffer);
    this.accumulatedBufferLength += lyriaBuffer.length;

    let currentBufferedDuration = this.accumulatedBufferLength / this.audioContext.sampleRate;
    while (currentBufferedDuration > this.maxBufferDurationSecs && this.audioBufferQueue.length > 0) {
      const oldestBuffer = this.audioBufferQueue.shift();
      if (oldestBuffer) {
        this.accumulatedBufferLength -= oldestBuffer.length;
        currentBufferedDuration = this.accumulatedBufferLength / this.audioContext.sampleRate;
      }
    }

    const now = Date.now();
    if (now - this.lastAnalysisTime > this.analysisIntervalMs && this.audioBufferQueue.length > 0) {
      this.performAnalysis();
      this.lastAnalysisTime = now;
    }
  }

  private combineAudioChunks(buffers: AudioBuffer[]): AudioBuffer | null {
    if (!buffers || buffers.length === 0) return null;

    const validBuffers = buffers.filter(b => b && b.length > 0);
    if (validBuffers.length === 0) return null;

    const totalLength = validBuffers.reduce((sum, buf) => sum + buf.length, 0);
    if (totalLength === 0) return null;

    const numChannels = validBuffers[0].numberOfChannels;
    const sampleRate = validBuffers[0].sampleRate;

    const combinedBuffer = this.audioContext.createBuffer(numChannels, totalLength, sampleRate);

    let offset = 0;
    for (const buffer of validBuffers) {
      for (let channel = 0; channel < numChannels; channel++) {
        combinedBuffer.copyToChannel(buffer.getChannelData(channel), channel, offset);
      }
      offset += buffer.length;
    }
    return combinedBuffer;
  }

  private async performAnalysis(): Promise<void> {
    if (this.audioBufferQueue.length === 0) return;

    const currentQueueSnapshot = [...this.audioBufferQueue];
    if (currentQueueSnapshot.length === 0) return;

    const bufferToAnalyze = this.combineAudioChunks(currentQueueSnapshot);

    if (bufferToAnalyze == null) {
        // console.warn("ContextAwareLyriaSession.performAnalysis: bufferToAnalyze is null or undefined. Skipping analysis.");
        return;
    }
    if (bufferToAnalyze.length === 0) {
        // console.warn("ContextAwareLyriaSession.performAnalysis: bufferToAnalyze has length 0. Skipping analysis.");
        return;
    }

    try {
      const context = await this.contextAnalyzer.analyzeRealTimeContext(bufferToAnalyze);
      this.onContextUpdateCallback(context);
    } catch (e) {
      console.error("Error during real-time context analysis:", e);
    }
  }
}


// --- SMART SAMPLE TRIGGER ---

export class SmartSampleTrigger {
  private samples: UserSample[] = [];
  private audioMixer: AudioMixer;
  private lastTriggerTimes: Map<string, number> = new Map();
  private onSampleTriggeredCallback?: (sample: UserSample, context: MusicalContext, config: PlaybackConfig) => void;

  constructor(
    initialSamples: UserSample[],
    audioMixer: AudioMixer,
    onSampleTriggeredCallback?: (sample: UserSample, context: MusicalContext, config: PlaybackConfig) => void
    ) {
    this.updateSamples(initialSamples);
    this.audioMixer = audioMixer;
    this.onSampleTriggeredCallback = onSampleTriggeredCallback;
  }

  public updateSamples(newSamples: UserSample[]): void {
    this.samples = [...newSamples];
  }

  private getPitchClass(keyName?: string): number | undefined {
      if (!keyName) return undefined;

      const upperKeyName = keyName.toUpperCase();
      let normalizedKeyName = upperKeyName;

      // Handle 'S' for sharp, e.g., FS -> F#
      if (upperKeyName.length === 2 && upperKeyName.endsWith("S")) {
        normalizedKeyName = upperKeyName.charAt(0) + "#";
      } else if (upperKeyName.length === 3 && upperKeyName.endsWith("S") && upperKeyName.charAt(1) === '#') { // F#S -> F## (unlikely but robust)
        normalizedKeyName = upperKeyName.charAt(0) + "##"; // Note: PITCH_CLASS_NAMES doesn't handle double sharps/flats
      }


      normalizedKeyName = normalizedKeyName
          .replace("SHARP", "#")
          .replace("FLAT", "B") // General flat, will be refined
          .replace(/DB/g, "C#") // Use regex with /g for all occurrences if ever needed
          .replace(/EB/g, "D#")
          .replace(/FB/g, "E")  // Fb is E
          .replace(/GB/g, "F#")
          .replace(/AB/g, "G#")
          .replace(/BB/g, "A#")
          .replace(/CB/g, "B"); // Cb is B

      // If, after specific flat replacements, it's still Xb, it's complex (e.g. "Fb" already became "E")
      // This primarily handles cases like "F SHARP", "Db", etc.

      const pcIndex = PITCH_CLASS_NAMES.indexOf(normalizedKeyName);
      if (pcIndex !== -1) return pcIndex;

      // Fallback for single letter flats that weren't common enharmonics (e.g. D FLAT -> D# is not standard, D FLAT is C#)
      // This part is tricky because "FLAT" was generically replaced with "B"
      // This logic might need more refinement if varied flat notations are common
      if (normalizedKeyName.endsWith("B") && normalizedKeyName.length === 2) {
        const noteWithoutFlat = normalizedKeyName.charAt(0);
        const originalNoteIndex = PITCH_CLASS_NAMES.indexOf(noteWithoutFlat);
        if (originalNoteIndex !== -1) {
          return (originalNoteIndex - 1 + NUM_CHROMA_BINS) % NUM_CHROMA_BINS;
        }
      }
      return undefined;
  }

  private getSemitoneDifference(pc1: number, pc2: number): number {
      let diff = pc2 - pc1;
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      return diff;
  }


  private calculateKeyCompatibility(contextKey?: string, contextScale?: string, sampleKey?: string, sampleScale?: string): { score: number, pitchShiftSemitones: number } {
    if (!contextKey || !sampleKey || !contextScale || !sampleScale) return { score: 0.5, pitchShiftSemitones: 0 };

    const contextPitchClass = this.getPitchClass(contextKey);
    const samplePitchClass = this.getPitchClass(sampleKey);

    let pitchShiftSemitones = 0;
    if (contextPitchClass !== undefined && samplePitchClass !== undefined) {
        pitchShiftSemitones = this.getSemitoneDifference(samplePitchClass, contextPitchClass);
    }

    let score = 0.3;
    const shiftedSamplePitchClass = samplePitchClass !== undefined ? (samplePitchClass + pitchShiftSemitones + 12) % 12 : undefined;

    if (contextPitchClass !== undefined && shiftedSamplePitchClass !== undefined && contextPitchClass === shiftedSamplePitchClass) {
        score = (contextScale.toLowerCase() === sampleScale.toLowerCase()) ? 1.0 : 0.8;
    } else if (contextScale.toLowerCase() === sampleScale.toLowerCase()) {
        score = 0.7;
    } else if (contextPitchClass !== undefined && shiftedSamplePitchClass !== undefined) {
        score = 0.5;
    }

    return { score, pitchShiftSemitones };
  }

  private calculateEnergyMatch(contextEnergy?: number, sampleEnergy?: number): number {
    if (contextEnergy === undefined || sampleEnergy === undefined) return 0.5;
    const normalizedSampleEnergy = (sampleEnergy -1) / 9;
    const diff = Math.abs(contextEnergy - normalizedSampleEnergy);
    return Math.max(0, 1 - diff * 1.5);
  }

  private calculateRhythmicFit(contextDensity?: number, sampleGrooveDesc?: string): number {
    if (contextDensity === undefined) return 0.5;

    let score = 0.5;
    if (sampleGrooveDesc) {
        const desc = sampleGrooveDesc.toLowerCase();
        if (desc.includes("sparse") || desc.includes("minimal") || desc.includes("ambient")) {
          score = (1 - contextDensity) * 0.8 + 0.1;
        } else if (desc.includes("dense") || desc.includes("complex") || desc.includes("active") || desc.includes("driving")) {
          score = contextDensity * 0.8 + 0.1;
        } else if (desc.includes("percussive") || desc.includes("rhythmic")) {
           score = 0.6 + contextDensity * 0.2;
        }
    } else {
        score = 0.5 - Math.abs(contextDensity - 0.5);
    }
    return Math.max(0, Math.min(1, score));
  }

  private async shouldTriggerSample(sample: UserSample, context: MusicalContext): Promise<{ trigger: boolean, pitchShift: number }> {
    // Only auto-trigger one-shots and FX. Do not trigger loops, breaks, or melodic phrases.
    const sampleType = sample.metadata.sampleType;
    if (sampleType !== 'one-shot' && sampleType !== 'fx') {
      return { trigger: false, pitchShift: 0 };
    }
    
    const minInterval = sample.metadata.minimumIntervalMs ?? 3000;
    const lastTriggerTime = this.lastTriggerTimes.get(sample.id) || 0;
    if (Date.now() - lastTriggerTime < minInterval) {
      return { trigger: false, pitchShift: 0 };
    }

    const keyCompat = this.calculateKeyCompatibility(context.key, context.scale, sample.metadata.key, sample.metadata.scale);
    const energyCompat = this.calculateEnergyMatch(context.energy, sample.metadata.energyLevel);
    const rhythmCompat = this.calculateRhythmicFit(context.beatDensity, sample.metadata.grooveDescription);

    const totalScore = (keyCompat.score * 0.4) + (energyCompat * 0.3) + (rhythmCompat * 0.3);

    return { trigger: totalScore > 0.7, pitchShift: keyCompat.pitchShiftSemitones };
  }

  private calculatePlaybackConfig(sample: UserSample, context: MusicalContext, pitchShiftSemitones: number): PlaybackConfig {
    let volume = 0.7;
    if (sample.metadata.suggestedHipHopUses?.includes("background") || sample.metadata.moodTags?.includes("ambient")) {
        volume = 0.4;
    }

    if (context.energy !== undefined) {
      if (context.energy < 0.3) {
          volume *= 0.7;
      } else if (context.energy > 0.7) {
          volume *= 1.1;
      }
    }
    volume = Math.max(0.1, Math.min(1.0, volume));


    return {
      volume: volume,
      pitchShift: pitchShiftSemitones,
    };
  }

  public async evaluateAndTrigger(musicContext: MusicalContext): Promise<void> {
    const eligibleSamples = [];
    for (const sample of this.samples) {
        const {trigger, pitchShift} = await this.shouldTriggerSample(sample, musicContext);
        if (trigger) {
            eligibleSamples.push({sample, pitchShift});
        }
    }

    for (const {sample, pitchShift} of eligibleSamples) {
        const playbackConfig = this.calculatePlaybackConfig(sample, musicContext, pitchShift);
        await this.audioMixer.playSample(sample, playbackConfig);
        this.lastTriggerTimes.set(sample.id, Date.now());
        this.onSampleTriggeredCallback?.(sample, musicContext, playbackConfig);
    }
  }
}