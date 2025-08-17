

/**
 * @fileoverview Hip Hop Beat Production Studio with AI assistance.
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {css, CSSResultGroup, html, LitElement, svg} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';

import {
  GoogleGenAI,
  type LiveMusicGenerationConfig,
  type LiveMusicServerMessage,
  type LiveMusicSession,
  type GenerateContentResponse,
  type WeightedPrompt,
  Scale,
} from '@google/genai';
import {decode, decodeAudioData, fileToBase64} from './utils';
import {
  AudioMixer,
  ContextAwareLyriaSession,
  SmartSampleTrigger,
  type UserSample,
  type MusicalContext,
  type PlaybackConfig,
} from './audioUtils';
import { LearningEngine, type PersonalizedSuggestionItem, type UserActionDetail } from './learning';
import { ExportEngine } from './export';


const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY,
});
const LYRIA_MODEL = 'lyria-realtime-exp'; // This model is tied to the deprecated Lyria API
const ANALYSIS_MODEL = 'gemini-2.5-flash';

export interface Prompt {
  readonly promptId: string;
  readonly color: string;
  text: string;
  weight: number;
}

type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

function throttle(func: (...args: any[]) => void, delay: number) {
  let lastCall = 0;
  return (...args: any[]) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    if (timeSinceLastCall >= delay) {
      func(...args);
      lastCall = now;
    }
  };
}

const HIPHOP_PROMPT_TEXT_PRESETS = [
  "Chopped Amen Break", "Heavy 808 Sub Bass", "Lo-fi Vinyl Crackle", "Jazzy Rhodes Chords", 
  "Soulful Vocal Chop", "Trap Hi-Hat Rolls", "G-Funk Synth Whine", "Orchestral Stab Hit",
  "Reggae Dub FX", "Mobb Deep Piano Riff", "Boom Bap Snare Crack", "Dark Ambient Pad",
  "Record Scratch Transition", "Funky Wah Guitar Lick"
];

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FED766', '#F0B67F',
  '#9900FF', '#FF9F1C', '#2AB7CA', '#F7D6E0', '#D9B2FF',
  '#C44D58', '#3DCC91', '#E9AFA3', '#FFD166', '#06D6A0'
];


function getUnusedRandomColor(usedColors: string[]): string {
  const availableColors = COLORS.filter((c) => !usedColors.includes(c));
  if (availableColors.length === 0) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return availableColors[Math.floor(Math.random() * availableColors.length)];
}

export interface SampleAnalysis {
  bpm?: number;
  timeSignature?: string; // e.g., "4/4"
  key?: string; // e.g., "Am", "C#maj"
  scale?: string; // e.g., "Minor", "Major", "Dorian"
  sampleType?: "one-shot" | "loop" | "breakbeat" | "tonal phrase" | "fx";
  instrumentClassification?: string[]; // e.g., "Kick Drum", "Snare Hit", "Piano Loop", "Vocal Chop", "Synth Bass"
  hipHopSubgenres?: string[]; // e.g., "Boom Bap", "Trap", "Lo-Fi", "Drill", "Cloud Rap"
  moodTags?: string[]; // e.g., "Dark", "Chill", "Energetic", "Soulful", "Gritty"
  grooveDescription?: string; // e.g., "Swung 16ths", "Straight 8ths", "MPC-like quantization", "Off-kilter"
  creativeChoppingIdeas?: string[]; // e.g., "Reverse and pitch down for a transition", "Slice into 16ths for a stutter effect"
  suggestedHipHopUses?: string[]; // e.g., "Main Loop for Boom Bap", "Snare Layer in Trap", "Melodic Chop for Hook"
  energyLevel?: number; // 1-10
  harmonicContentDescription?: string; // e.g., "Soulful 7th chords", "Dissonant texture", "Simple minor progression"
  timbralQualities?: string[]; // e.g., "Dusty", "Clean Punch", "Warm Analog", "Distorted"
  loopCharacteristics?: {
    isLoop: boolean;
    durationBars?: number; // If it's a loop, how many bars (e.g. 2, 4, 8)
  };
  minimumIntervalMs?: number; // For SmartSampleTrigger (one-shots), in ms
  error?: string;
}


@customElement('weight-slider')
class WeightSlider extends LitElement {
  static override styles = css`
    :host { /* Existing styles, confirm they fit the new theme */
      cursor: ns-resize; position: relative; height: 100%; display: flex;
      justify-content: center; flex-direction: column; align-items: center; padding: 5px;
    }
    .scroll-container { width: 100%; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .value-display { font-size: 1.1vmin; color: #B0B0B0; margin: 0.3vmin 0; user-select: none; text-align: center; font-family: 'Roboto Mono', monospace; }
    .slider-container { position: relative; width: 12px; height: 100%; background-color: #181818; border-radius: 6px; box-shadow: inset 0 0 3px rgba(0,0,0,0.5); border: 1px solid #303030; }
    #thumb { position: absolute; bottom: 0; left: 0; width: 100%; border-radius: 6px; box-shadow: 0 0 5px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); }
  `;
  @property({type: Number}) value = 0; @property({type: String}) color = '#000';
  @query('.scroll-container') private scrollContainer!: HTMLDivElement;
  private dragStartPos = 0; private dragStartValue = 0; private containerBounds: DOMRect | null = null;
  constructor() { super(); this.handlePointerDown = this.handlePointerDown.bind(this); this.handlePointerMove = this.handlePointerMove.bind(this); this.handleTouchMove = this.handleTouchMove.bind(this); this.handlePointerUp = this.handlePointerUp.bind(this); }
  private handlePointerDown(e: PointerEvent) { e.preventDefault(); this.containerBounds = this.scrollContainer.getBoundingClientRect(); this.dragStartPos = e.clientY; this.dragStartValue = this.value; document.body.classList.add('dragging'); window.addEventListener('pointermove', this.handlePointerMove); window.addEventListener('touchmove', this.handleTouchMove, { passive: false }); window.addEventListener('pointerup', this.handlePointerUp, {once: true}); this.updateValueFromPosition(e.clientY); }
  private handlePointerMove(e: PointerEvent) { this.updateValueFromPosition(e.clientY); }
  private handleTouchMove(e: TouchEvent) { e.preventDefault(); this.updateValueFromPosition(e.touches[0].clientY); }
  private handlePointerUp() { window.removeEventListener('pointermove', this.handlePointerMove); document.body.classList.remove('dragging'); this.containerBounds = null; }
  private handleWheel(e: WheelEvent) { e.preventDefault(); const delta = e.deltaY; this.value = Math.max(0, Math.min(2, this.value + delta * -0.005)); this.dispatchInputEvent(); }
  private updateValueFromPosition(clientY: number) { if (!this.containerBounds) return; const trackHeight = this.containerBounds.height; const relativeY = clientY - this.containerBounds.top; const normalizedValue = 1 - Math.max(0, Math.min(trackHeight, relativeY)) / trackHeight; this.value = normalizedValue * 2; this.dispatchInputEvent(); }
  private dispatchInputEvent() { this.dispatchEvent(new CustomEvent<number>('input', {detail: this.value})); }
  override render() { const thumbHeightPercent = (this.value / 2) * 100; const thumbStyle = styleMap({ height: `${thumbHeightPercent}%`, backgroundColor: this.color, display: this.value > 0.01 ? 'block' : 'none', }); const displayValue = this.value.toFixed(2); return html` <div class="scroll-container" @pointerdown=${this.handlePointerDown} @wheel=${this.handleWheel}> <div class="slider-container"> <div id="thumb" style=${thumbStyle}></div> </div> <div class="value-display">${displayValue}</div> </div> `; }
}

class IconButton extends LitElement {
  static override styles = css`
    :host { position: relative; display: flex; align-items: center; justify-content: center; pointer-events: none; }
    :host(:hover) svg { transform: scale(1.1); filter: drop-shadow(0 0 8px var(--accent-glow, #FF6B6B77)); } /* Enhanced glow */
    svg { width: 100%; height: 100%; transition: transform 0.15s ease-out, filter 0.15s ease-out; }
    .hitbox { pointer-events: all; position: absolute; width: 70%; height: 70%; top: 15%; left: 15%; border-radius: 50%; cursor: pointer; }
  ` as CSSResultGroup;
  protected renderIcon() { return svg``; }
  private renderSVG() { return html` <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"> <style> :host { --accent-glow: ${this instanceof PlayPauseButton && this.playbackState === 'playing' ? '#FF4D4D99' : '#4DA6FF99'}; } </style> <circle cx="40" cy="40" r="35" fill="#2A2A2A"/> <circle cx="40" cy="40" r="33" fill="#1C1C1C" stroke="#404040" stroke-width="1.2"/> ${this.renderIcon()} </svg>`; }
  override render() { return html`${this.renderSVG()}<div class="hitbox"></div>`; }
}

@customElement('play-pause-button')
export class PlayPauseButton extends IconButton {
  @property({type: String}) playbackState: PlaybackState = 'stopped';
  static override styles = [ IconButton.styles, css` .loader { stroke: #D0D0D0; stroke-width: 4; stroke-linecap: round; animation: spin linear 1s infinite; transform-origin: center; transform-box: fill-box; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(359deg); } } `, ] as CSSResultGroup;
  private renderPause() { return svg`<rect x="28" y="25" width="8" height="30" fill="#D0D0D0" rx="2"/><rect x="44" y="25" width="8" height="30" fill="#D0D0D0" rx="2"/>`; }
  private renderPlay() { return svg`<polygon points="32,25 56,40 32,55" fill="#D0D0D0"/>`; }
  private renderLoading() { return svg`<circle class="loader" cx="40" cy="40" r="12" fill="none" stroke-dasharray="56.55 24.24"/>`; }
  override renderIcon() { if (this.playbackState === 'playing') return this.renderPause(); else if (this.playbackState === 'loading') return this.renderLoading(); else return this.renderPlay(); }
}

@customElement('reset-button')
export class ResetButton extends IconButton {
  private renderResetIcon() { return svg`<path d="M63.32,23.49A27,27,0,0,0,23.49,16.68M16.68,56.51A27,27,0,0,0,56.51,63.32M58.14,40A18.14,18.14,0,1,1,40,21.86" fill="none" stroke="#D0D0D0" stroke-width="4.5" stroke-linecap="round"/><polyline points="23.49 16.68 16.68 16.68 16.68 23.49" fill="none" stroke="#D0D0D0" stroke-width="4.5" stroke-linecap="round"/><polyline points="56.51 63.32 63.32 63.32 63.32 56.51" fill="none" stroke="#D0D0D0" stroke-width="4.5" stroke-linecap="round"/>`; }
  override renderIcon() { return this.renderResetIcon(); }
}

@customElement('add-prompt-button')
export class AddPromptButton extends IconButton {
  private renderAddIcon() { return svg`<line x1="40" y1="25" x2="40" y2="55" stroke="#D0D0D0" stroke-width="6" stroke-linecap="round"/><line x1="25" y1="40" x2="55" y2="40" stroke="#D0D0D0" stroke-width="6" stroke-linecap="round"/>`; }
  override renderIcon() { return this.renderAddIcon(); }
}

@customElement('toast-message')
class ToastMessage extends LitElement {
  static override styles = css` /* Styles largely unchanged, ensure they fit the new theme */
    .toast { font-family: 'Inter', sans-serif; line-height: 1.6; position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: #282828; color: #E0E0E0; padding: 12px 20px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 15px; min-width: 250px; max-width: 90vw; box-shadow: 0 4px 15px rgba(0,0,0,0.5); transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.4s ease-out; z-index: 1000; opacity: 0; transform: translate(-50%, 100px); border: 1px solid #383838;}
    .toast.showing { opacity: 1; transform: translate(-50%, 0); } .message {flex-grow: 1;}
    button { background: none; border: none; color: #A0A0A0; cursor: pointer; font-size: 1.6em; padding:0 .3em; line-height: 1; } button:hover { color: #FFF; }
  `;
  @property({type: String}) message = ''; @property({type: Boolean}) showing = false; private timeoutId?: number;
  override render() { return html`<div class=${classMap({showing: this.showing, toast: true})}><div class="message">${this.message}</div><button @click=${this.hide} aria-label="Close toast message">✕</button></div>`; }
  show(message: string, duration: number = 4000) { this.message = message; this.showing = true; clearTimeout(this.timeoutId); this.timeoutId = window.setTimeout(() => this.hide(), duration); }
  hide() { this.showing = false; }
}

@customElement('prompt-controller')
class PromptController extends LitElement {
  static override styles = css` /* Updated prompt controller styles */
    .prompt { position: relative; height: 100%; width: 100%; display: flex; flex-direction: column; align-items: center; box-sizing: border-box; overflow: hidden; background-color: #2A2A2A; border-radius: 8px; box-shadow: 0 3px 6px rgba(0,0,0,0.3); border: 1px solid #383838; }
    .remove-button { position: absolute; top: 0.6vmin; right: 0.6vmin; background: #404040; color: #B0B0B0; border: none; border-radius: 50%; width: 2.4vmin; height: 2.4vmin; font-size: 1.4vmin; display: flex; align-items: center; justify-content: center; line-height: 1; cursor: pointer; opacity: 0.7; transition: all 0.2s; z-index: 10; }
    .remove-button:hover { opacity: 1; background-color: #FF4D4D; color: #fff; transform: scale(1.1); }
    weight-slider { max-height: calc(100% - 6vmin); flex: 1; min-height: 7vmin; width: 100%; box-sizing: border-box; overflow: hidden; margin: 1vmin 0 0.5vmin; }
    .controls { display: flex; flex-direction: column; flex-shrink: 0; align-items: center; gap: 0.2vmin; width: calc(100% - 1.6vmin); height: 5vmin; padding: 0 0.8vmin; box-sizing: border-box; margin-bottom: 0.8vmin; }
    #text { font-family: 'Inter', sans-serif; font-size: 1.4vmin; width: 100%; flex-grow: 1; max-height: 100%; padding: 0.5vmin; box-sizing: border-box; text-align: center; word-wrap: break-word; overflow-y: auto; border: 1px solid #383838; outline: none; -webkit-font-smoothing: antialiased; color: #D0D0D0; background-color: #222222; border-radius: 4px; scrollbar-width: thin; scrollbar-color: #555 #222; }
    #text:focus { border-color: #FF6B6B; box-shadow: 0 0 0 1px #FF6B6B88; background-color: #282828; }
    #text::-webkit-scrollbar { width: 5px; } #text::-webkit-scrollbar-track { background: #222; border-radius: 3px; } #text::-webkit-scrollbar-thumb { background-color: #555; border-radius: 3px; }
    :host([filtered='true']) #text { background: #7A1D1D; color: #FFCFCF; border: 1px solid #FF4D4D; }
  `;
  @property({type: String, reflect: true}) promptId = ''; @property({type: String}) text = ''; @property({type: Number}) weight = 0; @property({type: String}) color = '';
  @query('weight-slider') private weightInput!: WeightSlider; @query('#text') private textInput!: HTMLSpanElement;
  private handleTextKeyDown(e: KeyboardEvent) { if (e.key === 'Enter') { e.preventDefault(); this.updateText(); (e.target as HTMLElement).blur(); } }
  private dispatchPromptChange() { this.dispatchEvent(new CustomEvent<Prompt>('prompt-changed', { detail: { promptId: this.promptId, text: this.text, weight: this.weight, color: this.color, }})); }
  private updateText() { const newText = this.textInput.textContent?.trim(); if (newText === '') { this.textInput.textContent = this.text; return; } if (newText !== this.text) { this.text = newText!; this.dispatchPromptChange(); } }
  private updateWeight() { this.weight = this.weightInput.value; this.dispatchPromptChange(); }
  private dispatchPromptRemoved() { this.dispatchEvent(new CustomEvent<string>('prompt-removed', { detail: this.promptId, bubbles: true, composed: true, })); }
  override render() { return html`<div class="prompt"> <button class="remove-button" @click=${this.dispatchPromptRemoved} title="Remove Prompt">✕</button> <weight-slider .value=${this.weight} color=${this.color} @input=${this.updateWeight}></weight-slider> <div class="controls"> <span id="text" spellcheck="false" contenteditable="plaintext-only" @keydown=${this.handleTextKeyDown} @blur=${this.updateText}>${this.text}</span> </div> </div>`; }
}

@customElement('settings-controller')
class SettingsController extends LitElement { // Styles updated for new theme
  static override styles = css`
    :host { display: block; padding: 1.2vmin; background-color: #252525; color: #D0D0D0; box-sizing: border-box; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 1.2vmin; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #555 #252525; border: 1px solid #333; max-height: 16vmin; transition: max-height 0.3s ease-out; }
    :host([showadvanced]) { max-height: 40vmin; }
    :host::-webkit-scrollbar { width: 6px; } :host::-webkit-scrollbar-track { background: #252525; border-radius: 3px; } :host::-webkit-scrollbar-thumb { background-color: #555; border-radius: 3px; }
    .setting { margin-bottom: 0.8vmin; display: flex; flex-direction: column; gap: 0.3vmin; }
    label { font-weight: normal; display: flex; justify-content: space-between; align-items: center; white-space: nowrap; user-select: none; color: #B8B8B8; }
    label span:last-child { font-weight: normal; color: #D0D0D0; min-width: 2.5em; text-align: right; font-family: 'Roboto Mono', monospace; }
    input[type='range'] { --track-height: 5px; --track-bg: #1C1C1C; --track-border-radius: 2.5px; --thumb-size: 12px; --thumb-bg: #FF8787; --thumb-border-radius: 50%; --thumb-box-shadow: 0 0 3px rgba(0,0,0,0.4); --value-percent: 0%; -webkit-appearance: none; appearance: none; width: 100%; height: var(--track-height); background: transparent; cursor: pointer; margin: 0.3vmin 0; border: none; padding: 0; vertical-align: middle; }
    input[type='range']::-webkit-slider-runnable-track { width: 100%; height: var(--track-height); cursor: pointer; border: none; background: linear-gradient(to right, var(--thumb-bg) var(--value-percent), var(--track-bg) var(--value-percent)); border-radius: var(--track-border-radius); }
    input[type='range']::-moz-range-track { width: 100%; height: var(--track-height); cursor: pointer; background: var(--track-bg); border-radius: var(--track-border-radius); border: none; }
    input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; height: var(--thumb-size); width: var(--thumb-size); background: var(--thumb-bg); border-radius: var(--thumb-border-radius); box-shadow: var(--thumb-box-shadow); cursor: pointer; margin-top: calc((var(--thumb-size) - var(--track-height)) / -2); }
    input[type='range']::-moz-range-thumb { height: var(--thumb-size); width: var(--thumb-size); background: var(--thumb-bg); border-radius: var(--thumb-border-radius); box-shadow: var(--thumb-box-shadow); cursor: pointer; border: none; }
    input[type='number'], input[type='text'], select { background-color: #303030; color: #D0D0D0; border: 1px solid #484848; border-radius: 4px; padding: 0.5vmin; font-size: 1.2vmin; font-family: inherit; box-sizing: border-box; }
    input[type='number'] { width: 6em; } input[type='text'] { width: 100%; } input[type='text']::placeholder { color: #777; }
    input[type='number']:focus, input[type='text']:focus, select:focus { outline: none; border-color: #FF8787; box-shadow: 0 0 0 1px #FF878788; }
    select { width: 100%; } select option { background-color: #303030; color: #D0D0D0; }
    .checkbox-setting { flex-direction: row; align-items: center; gap: 0.6vmin; margin-top: 0.4vmin; }
    .checkbox-setting label { font-weight: normal; color: #B8B8B8;}
    input[type='checkbox'] { cursor: pointer; accent-color: #FF8787; width: 1.3vmin; height: 1.3vmin; }
    .core-settings-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(14vmin, 1fr)); gap: 1.2vmin; margin-bottom: 0.8vmin; }
    .core-settings-row .setting { min-width: 0; }
    .advanced-toggle { cursor: pointer; margin: 1.2vmin 0 0.4vmin 0; color: #999; text-decoration: underline; user-select: none; font-size: 1.1vmin; width: fit-content; }
    .advanced-toggle:hover { color: #D0D0D0; }
    .advanced-settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(14vmin, 1fr)); gap: 1.2vmin 1.8vmin; overflow: hidden; max-height: 0; opacity: 0; transition: max-height 0.3s ease-out, opacity 0.3s ease-out; }
    .advanced-settings.visible { max-height: 45vmin; opacity: 1; }
    hr.divider { display: none; border: none; border-top: 1px solid #383838; margin: 1.2vmin 0; width: 100%; }
    :host([showadvanced]) hr.divider { display: block; }
    .auto-row { display: flex; align-items: center; gap: 0.4vmin; margin-top:0.2vmin;}
    .setting[auto='true'] input[type='range'] { pointer-events: none; filter: grayscale(80%) opacity(60%); }
    .auto-row span { margin-left: auto; font-family: 'Roboto Mono', monospace; font-size: 1vmin; color: #A0A0A0;}
    .auto-row label { font-size: 1.1vmin; cursor: pointer; } .auto-row input[type='checkbox'] { margin: 0; }
  `;
  private readonly defaultConfig: LiveMusicGenerationConfig = { temperature: 1.0, topK: 40, guidance: 3.0, density: 0.5, brightness: 0.5, };
  @state() private config: LiveMusicGenerationConfig = {...this.defaultConfig, density: undefined, brightness: undefined};
  @state() showAdvanced = false; @state() autoDensity = true; @state() lastDefinedDensity: number | undefined = this.defaultConfig.density;
  @state() autoBrightness = true; @state() lastDefinedBrightness: number | undefined = this.defaultConfig.brightness;
  public resetToDefaults() { this.config = {...this.defaultConfig, density: undefined, brightness: undefined}; this.autoDensity = true; this.lastDefinedDensity = this.defaultConfig.density; this.autoBrightness = true; this.lastDefinedBrightness = this.defaultConfig.brightness; this.dispatchSettingsChange(); this.requestUpdate(); }
  public setFullConfig(newConfig: LiveMusicGenerationConfig) { const mergedConfig = { ...this.config, ...newConfig }; if (newConfig.density !== undefined) { this.autoDensity = false; this.lastDefinedDensity = newConfig.density; mergedConfig.density = newConfig.density; } else { this.autoDensity = true; mergedConfig.density = undefined; } if (newConfig.brightness !== undefined) { this.autoBrightness = false; this.lastDefinedBrightness = newConfig.brightness; mergedConfig.brightness = newConfig.brightness; } else { this.autoBrightness = true; mergedConfig.brightness = undefined; } this.config = mergedConfig; this.dispatchSettingsChange(); this.requestUpdate(); }
  private updateSliderBackground(inputEl: HTMLInputElement) { if (inputEl.type !== 'range') return; const min = Number(inputEl.min) || 0; const max = Number(inputEl.max) || 100; const value = Number(inputEl.value); const percentage = ((value - min) / (max - min)) * 100; inputEl.style.setProperty('--value-percent', `${percentage}%`); }
  private handleInputChange(e: Event) { const target = e.target as HTMLInputElement; const key = target.id as keyof LiveMusicGenerationConfig | 'auto-density' | 'auto-brightness'; let value: string | number | boolean | undefined | Scale = target.value; if (target.type === 'number' || target.type === 'range') { value = target.value === '' ? undefined : Number(target.value); if (target.type === 'range') this.updateSliderBackground(target); } else if (target.type === 'checkbox') value = target.checked; else if (target.type === 'select-one') { const selectElement = target as unknown as HTMLSelectElement; if (selectElement.value === "" || selectElement.options[selectElement.selectedIndex]?.disabled || selectElement.value === 'SCALE_UNSPECIFIED') value = undefined; else value = target.value as Scale; } const newConfig = {...this.config}; if (key === 'auto-density') { this.autoDensity = Boolean(value); newConfig.density = this.autoDensity ? undefined : this.lastDefinedDensity ?? 0.5; } else if (key === 'auto-brightness') { this.autoBrightness = Boolean(value); newConfig.brightness = this.autoBrightness ? undefined : this.lastDefinedBrightness ?? 0.5; } else if (key === 'density' && typeof value === 'number') { this.lastDefinedDensity = value; if (!this.autoDensity) newConfig.density = value; } else if (key === 'brightness' && typeof value === 'number') { this.lastDefinedBrightness = value; if (!this.autoBrightness) newConfig.brightness = value; } else { (newConfig as any)[key] = value; } this.config = newConfig; this.dispatchSettingsChange(); }
  override updated(changedProperties: Map<string | symbol, unknown>) { super.updated(changedProperties); this.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((slider: HTMLInputElement) => { const key = slider.id as keyof LiveMusicGenerationConfig; let sliderValue: number | undefined; if (key === 'density') sliderValue = this.autoDensity ? (this.config.density ?? this.lastDefinedDensity ?? 0.5) : (this.lastDefinedDensity ?? 0.5); else if (key === 'brightness') sliderValue = this.autoBrightness ? (this.config.brightness ?? this.lastDefinedBrightness ?? 0.5) : (this.lastDefinedBrightness ?? 0.5); else sliderValue = this.config[key] as number | undefined; if (typeof sliderValue === 'number') slider.value = String(sliderValue); else if (this.defaultConfig[key] !== undefined && typeof this.defaultConfig[key] === 'number') slider.value = String(this.defaultConfig[key]); this.updateSliderBackground(slider); }); }
  private dispatchSettingsChange() { const detailToSend: Partial<LiveMusicGenerationConfig> = {}; for (const key in this.config) { const configKey = key as keyof LiveMusicGenerationConfig; if (this.config[configKey] !== undefined) (detailToSend as any)[configKey] = this.config[configKey]; } if (this.autoDensity) detailToSend.density = undefined; if (this.autoBrightness) detailToSend.brightness = undefined; this.dispatchEvent(new CustomEvent<LiveMusicGenerationConfig>('settings-changed', { detail: detailToSend as LiveMusicGenerationConfig, bubbles: true, composed: true, })); }
  private toggleAdvancedSettings() { this.showAdvanced = !this.showAdvanced; this.setAttribute('showadvanced', this.showAdvanced ? '' : null); }
  override render() { const cfg = this.config; const advancedClasses = classMap({ 'advanced-settings': true, 'visible': this.showAdvanced }); const scaleMap = new Map<string, Scale>([ ['Auto Key', Scale.SCALE_UNSPECIFIED], ['C Maj / A Min', Scale.C_MAJOR_A_MINOR], ['C# Maj / A# Min', Scale.D_FLAT_MAJOR_B_FLAT_MINOR], ['D Maj / B Min', Scale.D_MAJOR_B_MINOR], ['D# Maj / C Min', Scale.E_FLAT_MAJOR_C_MINOR], ['E Maj / C# Min', Scale.E_MAJOR_D_FLAT_MINOR], ['F Maj / D Min', Scale.F_MAJOR_D_MINOR], ['F# Maj / D# Min', Scale.G_FLAT_MAJOR_E_FLAT_MINOR], ['G Maj / E Min', Scale.G_MAJOR_E_MINOR], ['G# Maj / F Min', Scale.A_FLAT_MAJOR_F_MINOR], ['A Maj / F# Min', Scale.A_MAJOR_G_FLAT_MINOR], ['A# Maj / G Min', Scale.B_FLAT_MAJOR_G_MINOR], ['B Maj / G# Min', Scale.B_MAJOR_A_FLAT_MINOR], ]); return html` <div class="core-settings-row"> <div class="setting"> <label for="temperature">Temp<span>${(cfg.temperature ?? this.defaultConfig.temperature!).toFixed(1)}</span></label> <input type="range" id="temperature" min="0" max="2" step="0.1" .value=${(cfg.temperature ?? this.defaultConfig.temperature!).toString()} @input=${this.handleInputChange} /> </div> <div class="setting"> <label for="guidance">Guidance<span>${(cfg.guidance ?? this.defaultConfig.guidance!).toFixed(1)}</span></label> <input type="range" id="guidance" min="1" max="8" step="0.1" .value=${(cfg.guidance ?? this.defaultConfig.guidance!).toString()} @input=${this.handleInputChange} /> </div> <div class="setting"> <label for="topK">Top K<span>${cfg.topK ?? this.defaultConfig.topK!}</span></label> <input type="range" id="topK" min="1" max="100" step="1" .value=${(cfg.topK ?? this.defaultConfig.topK!).toString()} @input=${this.handleInputChange} /> </div> </div> <hr class="divider" /> <div class=${advancedClasses}> <div class="setting"> <label for="seed">Seed</label> <input type="number" id="seed" .value=${cfg.seed ?? ''} @input=${this.handleInputChange} placeholder="Auto" /> </div> <div class="setting"> <label for="bpm">BPM</label> <input type="number" id="bpm" min="40" max="200" .value=${cfg.bpm ?? ''} @input=${this.handleInputChange} placeholder="Auto" /> </div> <div class="setting" auto=${this.autoDensity}> <label for="density">Beat Density</label> <input type="range" id="density" min="0" max="1" step="0.05" .value=${(this.autoDensity ? (cfg.density ?? this.lastDefinedDensity ?? 0.5) : (this.lastDefinedDensity ?? 0.5)).toString()} @input=${this.handleInputChange} ?disabled=${this.autoDensity}/> <div class="auto-row"><input type="checkbox" id="auto-density" .checked=${this.autoDensity} @input=${this.handleInputChange} /><label for="auto-density">Auto</label><span>${(this.lastDefinedDensity ?? 0.5).toFixed(2)}</span></div> </div> <div class="setting" auto=${this.autoBrightness}> <label for="brightness">Timbre Brightness</label> <input type="range" id="brightness" min="0" max="1" step="0.05" .value=${(this.autoBrightness ? (cfg.brightness ?? this.lastDefinedBrightness ?? 0.5) : (this.lastDefinedBrightness ?? 0.5)).toString()} @input=${this.handleInputChange} ?disabled=${this.autoBrightness}/> <div class="auto-row"><input type="checkbox" id="auto-brightness" .checked=${this.autoBrightness} @input=${this.handleInputChange} /><label for="auto-brightness">Auto</label><span>${(this.lastDefinedBrightness ?? 0.5).toFixed(2)}</span></div> </div> <div class="setting"> <label for="scale">Key/Scale</label> <select id="scale" .value=${cfg.scale || Scale.SCALE_UNSPECIFIED} @change=${this.handleInputChange}> ${[...scaleMap.entries()].map(([displayName, enumValue]) => html`<option value=${enumValue} ?selected=${cfg.scale === enumValue}>${displayName}</option>`)} </select> </div> <div class="setting"> <div class="checkbox-setting"><input type="checkbox" id="muteBass" .checked=${!!cfg.muteBass} @change=${this.handleInputChange} /><label for="muteBass">Mute Bass</label></div> <div class="checkbox-setting"><input type="checkbox" id="muteDrums" .checked=${!!cfg.muteDrums} @change=${this.handleInputChange} /><label for="muteDrums">Mute Drums</label></div> <div class="checkbox-setting"><input type="checkbox" id="onlyBassAndDrums" .checked=${!!cfg.onlyBassAndDrums} @change=${this.handleInputChange} /><label for="onlyBassAndDrums">Drums & Bass Only</label></div> </div> </div> <div class="advanced-toggle" @click=${this.toggleAdvancedSettings}> ${this.showAdvanced ? 'Hide' : 'Show'} Advanced Lyria Controls </div> `; }
}


@customElement('prompt-dj')
class PromptDj extends LitElement {
  static override styles = css`
    :host {
      height: 100vh; width: 100vw; display: flex; flex-direction: row; 
      box-sizing: border-box; background-color: #121212; color: #E0E0E0;
      font-family: 'Inter', sans-serif; overflow: hidden;
    }
    #background { /* Fullscreen, subtle animated gradient */
      position: fixed; top:0; left:0; height: 100%; width: 100%; z-index: -1;
      background: linear-gradient(45deg, #1a1a1a, #202025, #1a1a1a);
      background-size: 400% 400%;
      animation: gradientBG 25s ease infinite;
    }
    @keyframes gradientBG { 0% {background-position: 0% 50%;} 50% {background-position: 100% 50%;} 100% {background-position: 0% 50%;} }

    .panel {
      padding: 1.2vmin; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.2vmin;
      overflow-y: auto; scrollbar-width: thin; scrollbar-color: #404040 #202020;
      height: 100vh; /* Ensure panels take full height */
    }
    .panel-header { border-bottom: 2px solid #FF6B6B; margin-bottom: 1vmin; }
    .panel-header h2 { color: #FF6B6B; margin-top:0; margin-bottom:0.8vmin; font-size: 1.8vmin;}

    .left-panel { width: 28vw; min-width: 280px; background-color: rgba(30,30,30,0.85); border-right: 1px solid #282828; }
    .center-panel { flex-grow: 1; background-color: rgba(24,24,24,0.8); padding-top:0; } /* Center panel might not need its own top padding if sections handle it */
    .right-panel { width: 25vw; min-width: 260px; background-color: rgba(30,30,30,0.85); border-left: 1px solid #282828; }
    
    .section-container {
      background-color: rgba(40,40,40,0.7); border-radius: 6px; padding: 1.2vmin;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3); border: 1px solid #303030;
      display: flex; flex-direction: column; gap: 1vmin;
    }
    .section-container h3 { /* Using H3 for sub-sections within panels */
      margin: 0 0 1vmin 0; font-size: 1.5vmin; color: #FF8787; /* Lighter accent */
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
      padding-bottom: 0.5vmin; border-bottom: 1px solid #383838;
    }
    
    .styled-button, .button-like-label { /* Main interactive buttons */
      background: linear-gradient(145deg, #FF6B6B, #E05252); color: #FFFFFF; font-weight: 600;
      padding: 0.7vmin 1.3vmin; border: none; border-radius: 5px; cursor: pointer;
      font-size: 1.3vmin; transition: all 0.15s ease-out; text-align: center;
      display: inline-flex; align-items: center; justify-content: center; gap: 0.6vmin;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2), inset 0 -1px 1px rgba(0,0,0,0.1);
      text-shadow: 0 1px 1px rgba(0,0,0,0.2);
    }
    .styled-button:hover, .button-like-label:hover { background: linear-gradient(145deg, #FF8787, #F06A6A); transform: translateY(-1px); box-shadow: 0 3px 6px rgba(0,0,0,0.25), inset 0 -1px 1px rgba(0,0,0,0.1); }
    .styled-button:active { transform: translateY(0px); background: linear-gradient(145deg, #E05252, #D04242); box-shadow: 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 1px rgba(0,0,0,0.2); }
    .styled-button:disabled { background: #484848; color: #777; cursor: not-allowed; transform: none; box-shadow: none; text-shadow: none; }
    .styled-button .loading-spinner { width: 1.3em; height: 1.3em; border-top-color: #FFFFFF; border-color: #FFFFFF55 #FFFFFF55 #FFFFFF55 #FFFFFF;}

    /* Sample Lab */
    .sample-controls { display: flex; flex-direction: column; gap: 0.8vmin; margin-bottom: 1vmin; }
    .sample-controls input[type="file"] { display: none; }
    .sample-controls .file-name { color: #A0A0A0; font-style: italic; font-size:1.1vmin; white-space: nowrap; overflow:hidden; text-overflow: ellipsis;}
    .analysis-results, .arrangement-status-display, .suggestions-display {
      background-color: #1E1E1E; padding: 1vmin; border-radius: 4px; font-size: 1.2vmin;
      max-height: 18vmin; overflow-y: auto; border: 1px solid #282828;
    }
    .analysis-results p, .arrangement-status-display p, .suggestions-display li { margin: 0.3vmin 0; line-height: 1.4; font-size: 1.15vmin; }
    .analysis-results strong, .arrangement-status-display strong, .suggestions-display strong { color: #FF8787; font-weight: 600; }
    .uploaded-samples-list ul { list-style: none; padding: 0; margin: 0; max-height: 15vmin; overflow-y: auto; }
    .uploaded-samples-list li { background-color: #333; padding: 0.5vmin 0.8vmin; margin-bottom: 0.4vmin; border-radius: 3px; font-size: 1.1vmin; display: flex; justify-content: space-between; align-items: center; }
    .uploaded-samples-list .sample-name { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 0.8vmin;}
    .uploaded-samples-list .sample-key-bpm { font-size: 0.9vmin; color: #888; white-space:nowrap; }
    .uploaded-samples-list .remove-sample-button { background: #444; color: #aaa; border:none; border-radius:3px; padding: 0.2vmin 0.5vmin; font-size: 1.1vmin; cursor:pointer; transition: background-color 0.15s;}
    .uploaded-samples-list .remove-sample-button:hover { background: #E74C3C; color: #fff;}

    /* Beat Control Center */
    .beat-control-center-container { display: flex; flex-direction: column; flex-grow: 1; gap:1vmin; /* Allows settings and playback controls to stack nicely */}
    .prompts-area { display: flex; align-items: stretch; justify-content: center; flex-grow: 1; min-height: 22vmin; gap: 1.2vmin; }
    #prompts-container { display: flex; flex-direction: row; align-items: stretch; flex-grow: 1; gap: 1.2vmin; padding: 0.8vmin; overflow-x: auto; background-color: #1E1E1E; border-radius: 6px; border: 1px solid #2F2F2F; min-height: 18vmin; }
    #prompts-container::before, #prompts-container::after { content: ''; flex-basis: 0.8vmin; flex-shrink:0; }
    prompt-controller { min-width: 12vmin; max-width: 15vmin; height: 100%; flex: 0 0 auto; }
    .add-prompt-button-container { display: flex; align-items: center; justify-content: center; padding-left: 0.8vmin; }
    add-prompt-button { width: 6vmin; height: 6vmin; }
    .main-playback-controls { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1.5vmin; padding: 1.5vmin 0; background-color: rgba(32,32,32,0.7); border-radius: 8px; margin-top:1vmin; box-shadow: 0 -1px 8px rgba(0,0,0,0.2); }
    .playback-buttons { display: flex; justify-content: center; align-items: center; gap: 1.5vmin; }
    play-pause-button, reset-button { width: 8vmin; height: 8vmin; }
    #settings-container { width: 100%; margin-top:1vmin; }

    /* Beat Progression Tracker */
    .progression-tracker {
      width: 100%;
      padding: 0.8vmin 1vmin;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 0.5vmin;
      margin-bottom: 1vmin;
    }
    .progression-label {
      font-family: 'Roboto Mono', monospace;
      font-size: 1.2vmin;
      color: #A0A0A0;
      display: flex;
      justify-content: space-between;
    }
    .progression-bar {
      width: 100%;
      height: 6px;
      appearance: none;
      -webkit-appearance: none;
      border: none;
      border-radius: 3px;
      background-color: #181818;
      overflow: hidden;
    }
    .progression-bar::-webkit-progress-bar {
      background-color: #181818;
      border-radius: 3px;
    }
    .progression-bar::-webkit-progress-value {
      background: linear-gradient(90deg, #FF6B6B, #F0B67F);
      border-radius: 3px;
      transition: width 0.2s linear;
    }
    .progression-bar::-moz-progress-bar {
      background: linear-gradient(90deg, #FF6B6B, #F0B67F);
      border-radius: 3px;
    }

    /* AI Coach & Session Tools (Right Panel) */
    .ai-coach-container, .session-tools-container {flex-shrink: 0;} /* Prevent shrinking */
    .ai-assistant-controls, .recording-controls, .export-controls { display: flex; flex-wrap: wrap; gap: 0.8vmin; align-items: center; }
    .recording-controls .download-link { font-size: 1.2vmin; padding: 0.6vmin 1vmin; }
    .recording-controls button {font-size: 1.2vmin; padding: 0.6vmin 1vmin;}
    .recording-dot { width: 0.7vmin; height: 0.7vmin; background-color: #E74C3C; border-radius: 50%; display: inline-block; margin-right: 0.4vmin; animation: pulse 1.2s infinite ease-in-out; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  `;

  @property({type: Object, attribute: false}) private prompts: Map<string, Prompt>;
  private nextPromptId: number;
  private session!: LiveMusicSession;
  private readonly sampleRate = 48000;
  private audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: this.sampleRate});
  private outputNode: GainNode = this.audioContext.createGain();
  private nextStartTime = 0;
  private readonly bufferTime = 2; 
  @state() private playbackState: PlaybackState = 'stopped';
  @property({type: Object}) private filteredPrompts = new Set<string>();
  private connectionError = true;

  @state() private userSamples: UserSample[] = [];
  @state() private lastUploadedFileForAnalysis: File | null = null;
  @state() private currentSampleAnalysisResult: SampleAnalysis | null = null;
  @state() private isAnalyzingSample = false;
  @state() private currentMusicalContext: MusicalContext | null = null;
  
  @state() private learningEngine: LearningEngine | null = null;
  @state() private exportEngine: ExportEngine | null = null;
  @state() private personalizedSuggestions: PersonalizedSuggestionItem[] = [];
  @state() private isFetchingSuggestions: boolean = false;

  @state() private isRecording: boolean = false;
  @state() private recordedAudioURL: string | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private captureNode!: MediaStreamAudioDestinationNode;
  
  private mainSpeakerGain!: GainNode;
  private mixerTapPoint!: GainNode;
  
  // Dynamic Beat Progression
  @state() private progressionTime = 0;
  @state() private progressionTimerId: number | null = null;
  private readonly progressionCycleDuration = 300; // 5 minutes
  private readonly progressionPrompts = [
    { id: 'prog_A', text: 'Foundation of the beat, driving hip hop rhythm, core drum and bass elements, verse structure' },
    { id: 'prog_B', text: 'Melodic and complex layers, busier percussion, harmonic instruments for a hook or bridge section' },
    { id: 'prog_C', text: 'Fully Structured Hiphop Beat' },
  ];
  private progressionWeights = { prog_A: 2.0, prog_B: 0.0, prog_C: 1.0 };


  @query('toast-message') private toastMessage!: ToastMessage;
  @query('settings-controller') private settingsController!: SettingsController;
  @query('#sampleFileInput') private sampleFileInput!: HTMLInputElement;
  
  private audioMixer!: AudioMixer;
  private contextAwareSession!: ContextAwareLyriaSession;
  private smartSampleTrigger!: SmartSampleTrigger;

  constructor(prompts: Map<string, Prompt>) {
    super();
    this.prompts = prompts;
    this.nextPromptId = this.prompts.size;
    this.mainSpeakerGain = this.audioContext.createGain();
    this.mainSpeakerGain.connect(this.audioContext.destination);
    this.captureNode = this.audioContext.createMediaStreamDestination();
    this.outputNode.connect(this.mainSpeakerGain);  
    this.outputNode.connect(this.captureNode);     
    this.mixerTapPoint = this.audioContext.createGain();
    this.mixerTapPoint.connect(this.mainSpeakerGain); 
    this.mixerTapPoint.connect(this.captureNode);   
    this.audioMixer = new AudioMixer(this.audioContext, this.mixerTapPoint);
    this.initializeLearningEngine();
    this.initializeExportEngine();
    // Deprecation warning
    setTimeout(() => this.toastMessage?.show("Note: Lyria real-time generation uses an older API and may be unstable.", 6000), 1000);
  }

  private initializeLearningEngine() { this.learningEngine = new LearningEngine(ai); }
  private initializeExportEngine() { this.exportEngine = new ExportEngine(); }

  override async firstUpdated() {
    this.smartSampleTrigger = new SmartSampleTrigger(
        this.userSamples, this.audioMixer,
        (sample, context, config) => this.recordAction('sample_triggered', { sampleName: sample.name, contextEnergy: context.energy, configVolume: config.volume })
    );
    await this.connectToSession(); 
    if (this.session && !this.connectionError) { this.setSessionPrompts(); }
  }

  private recordAction(actionType: UserActionDetail['type'], details: UserActionDetail['details']) {
    this.learningEngine?.recordUserAction(actionType, details);
  }

  private async connectToSession() {
    this.playbackState = 'loading';
    try {
      this.session = await ai.live.music.connect({
        model: LYRIA_MODEL, 
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
             if (e.setupComplete) {
              this.connectionError = false;
              if (this.playbackState === 'loading' && this.audioContext.state === 'running') {
                if (this.nextStartTime > 0) this.playbackState = 'playing'; else this.playbackState = 'paused';
              }
            }
            if (e.filteredPrompt) {
               const { text, filteredReason } = e.filteredPrompt;
               if (typeof text === 'string') { this.filteredPrompts = new Set([...this.filteredPrompts, text]); }
               else { console.warn("Filtered prompt text is not a string:", text); }
               const reasonMsg = typeof filteredReason === 'string' ? filteredReason : "A prompt was filtered for an unspecified reason.";
               this.toastMessage.show(reasonMsg); 
               this.recordAction('prompt_filtered', {text: text ?? 'N/A', reason: filteredReason ?? 'N/A'});
            }
            if (e.serverContent?.audioChunks?.[0]?.data) {
              const firstChunk = e.serverContent.audioChunks[0];
              if (typeof firstChunk.data === 'string' && firstChunk.data.length > 0) {
                try {
                    const decodedBytes = decode(firstChunk.data);
                    if (decodedBytes.length > 0) {
                        const audioBuffer = await decodeAudioData(decodedBytes, this.audioContext, this.sampleRate, 2);
                        if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
                        this.playbackState = 'playing';
                        if (this.contextAwareSession) this.contextAwareSession.handleNewLyriaAudioBuffer(audioBuffer);
                        else console.warn('contextAwareSession not initialized for audio chunk.');

                        const source = this.audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(this.outputNode); 

                        if (this.nextStartTime === 0) this.nextStartTime = this.audioContext.currentTime + this.bufferTime;
                        if (this.nextStartTime < this.audioContext.currentTime) {
                            this.toastMessage.show('Lyria stream lagging, readjusting...');
                            this.playbackState = 'loading';
                            this.nextStartTime = this.audioContext.currentTime + 0.2;
                        }
                        source.start(Math.max(this.nextStartTime, this.audioContext.currentTime));
                        this.nextStartTime += audioBuffer.duration;
                    }
                } catch (decodeError: any) {
                    this.toastMessage.show(`Audio processing error: ${decodeError.message || 'Unknown'}`);
                    this.recordAction('audio_processing_error', {error: decodeError.message, dataPreview: firstChunk.data.substring(0,50)});
                }
              }
            }
          },
          onerror: (e: ErrorEvent) => { 
            console.error('Lyria Session Error:', JSON.stringify(e)); this.connectionError = true; this.stopAudio();
            this.toastMessage.show('Lyria error. Try restarting audio.'); this.recordAction('lyria_error', { error: JSON.stringify(e) });
          },
          onclose: (e: CloseEvent) => {
            console.log('Lyria Session Closed.'); this.connectionError = true;
            if (this.playbackState !== 'stopped') { this.stopAudio(); this.toastMessage.show('Lyria connection closed. Restart audio.');}
            this.recordAction('lyria_closed', {});
          },
        },
      });
      if(this.audioContext.state === 'suspended') await this.audioContext.resume();
      this.contextAwareSession = new ContextAwareLyriaSession(this.audioContext, this.handleMusicalContextUpdate.bind(this));
      if (this.session && !this.connectionError) {
        try { this.session.play(); } 
        catch (sessionError: any) { this.toastMessage.show(`Lyria session play error: ${sessionError.message}`); this.connectionError = true; }
      }
    } catch (err: any) {
        this.toastMessage.show(`Lyria connection failed (API might be deprecated): ${err.message || 'Unknown'}`);
        this.playbackState = 'stopped'; this.connectionError = true;
        this.recordAction('lyria_connection_failed', { error: err.message });
    }
  }

  private handleMusicalContextUpdate(context: MusicalContext) {
    this.currentMusicalContext = context;
    if (this.smartSampleTrigger) {
        this.smartSampleTrigger.evaluateAndTrigger(context).catch(error => {
            this.toastMessage.show(`Smart sample trigger error: ${error instanceof Error ? error.message : String(error)}`);
            this.recordAction('smart_sample_trigger_error', { error: error instanceof Error ? error.message : String(error) });
        });
    }
  }

  private startProgressionTimer() {
    this.stopProgressionTimer(); // Ensure no multiple timers
    if (this.progressionTime >= this.progressionCycleDuration) {
      this.progressionTime = 0; // Loop back if needed
    }
    const startTime = Date.now() - (this.progressionTime * 1000);

    this.progressionTimerId = window.setInterval(() => {
      const elapsedMs = Date.now() - startTime;
      this.progressionTime = (elapsedMs / 1000);

      if (this.progressionTime >= this.progressionCycleDuration) {
        this.progressionTime = this.progressionCycleDuration; // Cap it
        this.stopProgressionTimer();
        this.toastMessage.show("5-minute beat evolution complete. Reset or play again to start a new cycle.");
      }
      
      const angle = (this.progressionTime / this.progressionCycleDuration) * 2 * Math.PI;
      const weight_A = (Math.cos(angle) + 1); // Ranges from 2 -> 0 -> 2
      const weight_B = (-Math.cos(angle) + 1); // Ranges from 0 -> 2 -> 0
      const weight_C = (weight_B / 2) + 1; // Ranges from 1 -> 2 -> 1
      
      this.progressionWeights.prog_A = weight_A;
      this.progressionWeights.prog_B = weight_B;
      this.progressionWeights.prog_C = weight_C;

      this.setSessionPrompts();
    }, 250);
  }

  private stopProgressionTimer() {
    if (this.progressionTimerId) {
      clearInterval(this.progressionTimerId);
      this.progressionTimerId = null;
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private setSessionPrompts = throttle(async () => { 
    if (!this.session || this.connectionError) return;
    
    const userPrompts: WeightedPrompt[] = Array.from(this.prompts.values())
      .filter((p) => !this.filteredPrompts.has(p.text) && p.weight > 0.01)
      .map(p => ({ text: p.text, weight: p.weight }));

    const internalPrompts: WeightedPrompt[] = this.progressionPrompts.map(p => ({
      text: p.text,
      weight: this.progressionWeights[p.id as keyof typeof this.progressionWeights]
    }));
    
    const activeInternalPrompts = internalPrompts.filter(p => p.weight > 0.01);
    const promptsToSend = [...userPrompts, ...activeInternalPrompts];

    try { await this.session.setWeightedPrompts({ weightedPrompts: promptsToSend }); }
    catch (e: any) { this.toastMessage.show(`Error setting Lyria prompts: ${e.message}.`); this.recordAction('set_prompts_error', {error: e.message, prompts: promptsToSend.map(p => p.text)}); this.connectionError = true; this.pauseAudio(); }
  }, 200);

  private dispatchPromptsChange() { this.dispatchEvent(new CustomEvent('prompts-changed', {detail: this.prompts})); }
  private handlePromptChanged(e: CustomEvent<Prompt>) { 
    const {promptId, text, weight} = e.detail; const prompt = this.prompts.get(promptId);
    if (!prompt) return;
    const oldText = prompt.text; const oldWeight = prompt.weight;
    prompt.text = text; prompt.weight = weight;
    this.prompts = new Map(this.prompts.set(promptId, prompt));
    this.recordAction('prompt_changed', {promptId, oldText, newText: text, oldWeight, newWeight: weight});
    this.setSessionPrompts(); this.requestUpdate(); this.dispatchPromptsChange();
  }
  private makeBackground() { 
    const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
    const MAX_WEIGHT = 0.5; const MAX_ALPHA = 0.15; const bg: string[] = []; // Reduced alpha, more subtle effect
    [...this.prompts.values()].forEach((p, i) => {
      const alphaPct = clamp01(p.weight / MAX_WEIGHT) * MAX_ALPHA;
      const alpha = Math.round(alphaPct * 0xff).toString(16).padStart(2, '0');
      const stop = p.weight / 2.5; // Wider, softer spread
      const x = (i % 4) / 3; 
      const y = Math.floor(i / 4) / 2.5;
      const s = `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${p.color}${alpha} 0px, ${p.color}00 ${stop * 120}%)`; // Larger stop %
      bg.push(s);
    });
    return bg.join(', ');
  }
  private async handlePlayPause() { 
    if (this.playbackState === 'playing') {
      this.pauseAudio();
      this.recordAction('playback_paused', {});
    } else if (this.playbackState === 'paused' || this.playbackState === 'stopped') {
      if (this.connectionError || !this.session) {
        await this.connectToSession();
      } else {
        this.loadAudio();
      }
      this.recordAction('playback_started', {fromState: this.playbackState});
    } else if (this.playbackState === 'loading') {
      this.stopAudio();
      this.recordAction('playback_stopped_from_loading', {});
    }
  }
  private pauseAudio() { 
    this.stopProgressionTimer();
    if (this.session && !this.connectionError) { try { this.session.pause(); } catch (e: any) { this.toastMessage.show(`Lyria pause error: ${e.message}.`); this.connectionError = true; }}
    this.playbackState = 'paused';
    if (this.audioContext.state !== 'closed') { this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime); this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1); }
  }
  private async loadAudio() { 
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    if (this.session && !this.connectionError) { try { this.session.play(); } catch (e: any) { this.toastMessage.show(`Lyria play error: ${e.message}.`); this.connectionError = true; this.playbackState = 'stopped'; return; }}
    else if (this.connectionError || !this.session) { await this.connectToSession(); return; }
    this.playbackState = 'loading';
    this.startProgressionTimer();
    if (this.audioContext.state !== 'closed') { this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime); this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1); }
  }
  private stopAudio() { 
    if (this.session && !this.connectionError) { try { this.session.stop(); } catch (e: any) { this.toastMessage.show(`Lyria stop error: ${e.message}.`); }}
    this.playbackState = 'stopped';
    this.stopProgressionTimer();
    this.progressionTime = 0;
    if (this.audioContext.state !== 'closed') { this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime); this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1); setTimeout(() => { if (this.audioContext.state !== 'closed' && this.outputNode.gain.value === 0) this.outputNode.gain.setValueAtTime(1, this.audioContext.currentTime); }, 150); }
    this.nextStartTime = 0;
    if (this.isRecording) this.handleStopRecording();
  }
  private ensurePromptExists(text: string, targetWeight = 0): Prompt {
    const existingPrompt = Array.from(this.prompts.values()).find(p => p.text.toLowerCase() === text.toLowerCase());
    if (existingPrompt) { existingPrompt.weight = targetWeight; this.prompts.set(existingPrompt.promptId, existingPrompt); this.requestUpdate(); this.dispatchPromptsChange(); return existingPrompt; }
    const newPromptId = `prompt-${this.nextPromptId++}`; const usedColors = [...this.prompts.values()].map((p) => p.color);
    const newPrompt: Prompt = { promptId: newPromptId, text: text, weight: targetWeight, color: getUnusedRandomColor(usedColors) };
    this.prompts.set(newPromptId, newPrompt); this.requestUpdate(); this.dispatchPromptsChange(); return newPrompt;
  }
  private async handleAddPrompt() { 
    const newPrompt = this.ensurePromptExists("New Beat Color", 0.5);
    this.recordAction('prompt_added', {promptId: newPrompt.promptId, text: newPrompt.text});
    await this.setSessionPrompts(); await this.updateComplete;
    const newPromptElement = this.renderRoot.querySelector<PromptController>(`prompt-controller[promptId="${newPrompt.promptId}"]`);
    if (newPromptElement) { newPromptElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      const textSpan = newPromptElement.shadowRoot?.querySelector<HTMLSpanElement>('#text');
      if (textSpan) { textSpan.focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(textSpan); selection?.removeAllRanges(); selection?.addRange(range); }
    }
  }
  private handlePromptRemoved(e: CustomEvent<string>) { 
    e.stopPropagation(); const promptIdToRemove = e.detail; const promptToRemove = this.prompts.get(promptIdToRemove);
    if (promptToRemove) { this.prompts.delete(promptIdToRemove); this.prompts = new Map(this.prompts); this.recordAction('prompt_removed', {promptId: promptIdToRemove, text: promptToRemove.text}); this.setSessionPrompts(); this.dispatchPromptsChange(); }
  }
  private handlePromptsContainerWheel(e: WheelEvent) { 
    const container = e.currentTarget as HTMLElement; if (e.deltaY !== 0 && !(e.target instanceof HTMLSpanElement && (e.target as HTMLSpanElement).id === 'text' && (e.target as HTMLSpanElement).scrollHeight > (e.target as HTMLSpanElement).clientHeight)) { e.preventDefault(); container.scrollLeft += e.deltaY; }
  } // Allow vertical scroll on text input if content overflows
  private updateSettings = throttle(async (e_or_config: CustomEvent<LiveMusicGenerationConfig> | LiveMusicGenerationConfig) => { 
    if (this.session && !this.connectionError) {
      const configToSet = (e_or_config as CustomEvent<LiveMusicGenerationConfig>).detail !== undefined ? (e_or_config as CustomEvent<LiveMusicGenerationConfig>).detail : e_or_config as LiveMusicGenerationConfig;
      try { await this.session.setMusicGenerationConfig({ musicGenerationConfig: configToSet }); this.recordAction('settings_changed', {config: configToSet}); }
      catch (e: any) { this.toastMessage.show(`Lyria settings error: ${e.message}.`); this.connectionError = true; }
    }
  }, 200);
  private async handleReset() { 
    this.stopAudio();
    this.stopProgressionTimer();
    this.progressionTime = 0;
    this.progressionWeights = { prog_A: 2.0, prog_B: 0.0, prog_C: 1.0 };
    this.currentSampleAnalysisResult = null; this.lastUploadedFileForAnalysis = null; this.userSamples = [];
    if (this.smartSampleTrigger) this.smartSampleTrigger.updateSamples([]);
    this.personalizedSuggestions = []; this.handleClearRecording();
    if (this.connectionError || !this.session) await this.connectToSession();
    if (this.session && !this.connectionError) { try { this.session.resetContext(); this.session.setMusicGenerationConfig({ musicGenerationConfig: {} }); } catch (e: any) { this.toastMessage.show(`Lyria reset error: ${e.message}.`); this.connectionError = true; }}
    this.prompts = getStoredPrompts(true); this.dispatchPromptsChange();
    if (this.session && !this.connectionError) await this.setSessionPrompts();
    this.settingsController.resetToDefaults(); this.recordAction('app_reset', {});
  }
  private handleFileChange(e: Event) { 
    const target = e.target as HTMLInputElement; if (target.files && target.files[0]) { this.lastUploadedFileForAnalysis = target.files[0]; this.currentSampleAnalysisResult = null; this.analyzeUploadedSample(); }
  }
  private async analyzeUploadedSample() {
    if (!this.lastUploadedFileForAnalysis) return;
    this.isAnalyzingSample = true; this.currentSampleAnalysisResult = null;
    const fileName = this.lastUploadedFileForAnalysis.name;
    try {
      const base64Audio = await fileToBase64(this.lastUploadedFileForAnalysis);
      const audioPart = { inlineData: { mimeType: this.lastUploadedFileForAnalysis.type || 'audio/mpeg', data: base64Audio } };
      const textPart = { text: `Analyze this audio sample for Hip Hop music production. Provide response as a single, minified JSON object. Keys: "bpm" (number, 60-180), "key" (string, e.g., "Am", "C#maj"), "scale" (string, e.g., "Minor", "Major"), "sampleType" (enum: "one-shot", "loop", "breakbeat", "tonal phrase", "fx"), "instrumentClassification" (array of strings, e.g., "Kick Drum", "Piano Loop"), "hipHopSubgenres" (array of strings, e.g., "Boom Bap", "Trap", "Lo-Fi"), "moodTags" (array of strings, e.g., "Dark", "Soulful"), "grooveDescription" (string, e.g., "Swung 16ths", "Heavy MPC groove"), "creativeChoppingIdeas" (array of 1-2 strings, e.g., "Slice on transients and rearrange", "Pitch down and add reverb for texture"), "suggestedHipHopUses" (array of 1-2 strings, e.g., "Main melody for a Lo-Fi beat", "Percussion layer for Trap"), "energyLevel" (number, 1-10), "loopCharacteristics" (object, {"isLoop": boolean, "durationBars": number (e.g. 2, 4, 8 if loop and BPM detected)}), "minimumIntervalMs" (number, for one-shots, 50-5000, default 500). Only this JSON. If a field is not determinable, use null or omit. Ensure BPM is reasonable for Hip Hop.` };
      const response: GenerateContentResponse = await ai.models.generateContent({ model: ANALYSIS_MODEL, contents: [{parts: [audioPart, textPart]}], config: { responseMimeType: "application/json" }});
      let jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s; const match = jsonStr.match(fenceRegex); if (match && match[2]) jsonStr = match[2].trim();
      const firstBrace = jsonStr.indexOf('{'); const lastBrace = jsonStr.lastIndexOf('}'); if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      const analysisResult = JSON.parse(jsonStr) as SampleAnalysis;
      this.currentSampleAnalysisResult = analysisResult;
      const newSample: UserSample = { id: `sample-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, name: fileName, originalFile: this.lastUploadedFileForAnalysis, base64: base64Audio, metadata: { ...analysisResult, minimumIntervalMs: analysisResult.minimumIntervalMs ?? 500 }};
      this.userSamples = [...this.userSamples, newSample];
      if (this.smartSampleTrigger) this.smartSampleTrigger.updateSamples(this.userSamples);
      this.toastMessage.show(`Sample "${newSample.name}" analyzed & added to your lab.`);
      this.recordAction('sample_analyzed', {sampleName: newSample.name, analysis: analysisResult});
    } catch (error: any) { this.currentSampleAnalysisResult = {error: `Analysis failed: ${error.message || 'Unknown'}`}; this.toastMessage.show(`Sample analysis failed: ${error.message || 'Unknown'}`); this.recordAction('sample_analysis_failed', {fileName: fileName, error: error.message});
    } finally { this.isAnalyzingSample = false; if (this.sampleFileInput) this.sampleFileInput.value = ''; }
  }
  private handleRemoveSample(sampleId: string) { 
    const sampleToRemove = this.userSamples.find(s => s.id === sampleId);
    if (sampleToRemove) { this.userSamples = this.userSamples.filter(s => s.id !== sampleId); if (this.smartSampleTrigger) this.smartSampleTrigger.updateSamples(this.userSamples); this.toastMessage.show('Sample removed.'); this.recordAction('sample_removed', {sampleName: sampleToRemove.name, sampleId: sampleId});}
  }
  private async handleInspireLyriaBeat() { 
    const latestUserSample = this.userSamples.length > 0 ? this.userSamples[this.userSamples.length - 1] : null;
    const analysisToUse = latestUserSample ? latestUserSample.metadata : this.currentSampleAnalysisResult;
    if (!analysisToUse || analysisToUse.error) { this.toastMessage.show('Upload and analyze a sample first to inspire a beat.'); return; }
    const { key, scale: sampleScale, bpm, hipHopSubgenres, moodTags, instrumentClassification, sampleType } = analysisToUse; 
    
    let basePrompt = "Hip Hop beat";
    if (hipHopSubgenres && hipHopSubgenres.length > 0) basePrompt = `${hipHopSubgenres[0]} beat`;
    else if (moodTags && moodTags.length > 0) basePrompt = `${moodTags[0]} Hip Hop groove`;
    else if (instrumentClassification && instrumentClassification.length > 0) basePrompt = `${instrumentClassification[0]} based Hip Hop rhythm`;
    
    let fullPromptText = basePrompt;
    if (key && sampleScale) fullPromptText += ` in ${key} ${sampleScale}`;
    if (bpm) fullPromptText += ` around ${bpm} BPM`;
    if (sampleType === 'loop' || sampleType === 'breakbeat') fullPromptText += " with a prominent loop";
    else if (sampleType === 'one-shot') fullPromptText += " featuring distinct one-shot sounds";

    const inspiredPrompt = this.ensurePromptExists(fullPromptText, 1.7); // Give it high weight
    const newPrompts = new Map(this.prompts); 
    newPrompts.forEach((p) => { if (p.promptId !== inspiredPrompt.promptId) p.weight = Math.min(p.weight, 0.15); }); // Drastically reduce others
    inspiredPrompt.weight = 1.7; newPrompts.set(inspiredPrompt.promptId, inspiredPrompt); this.prompts = newPrompts;
    
    this.toastMessage.show(`Inspiring Lyria beat: ${fullPromptText}`);
    this.recordAction('generate_backing_music', {promptText: fullPromptText, basedOnSample: latestUserSample?.name || 'last_analysis'});
    await this.setSessionPrompts(); this.dispatchPromptsChange();
    if (this.playbackState === 'stopped' || this.playbackState === 'paused') this.loadAudio();
    this.requestUpdate();
  }
  private async handleFetchAISuggestions() { 
    if (!this.learningEngine) { this.toastMessage.show("AI Coach not ready."); return; }
    this.isFetchingSuggestions = true; this.personalizedSuggestions = []; this.recordAction('fetch_ai_suggestions_started', {});
    try {
      const suggestions = await this.learningEngine.getPersonalizedSuggestions(this.currentMusicalContext, this.userSamples, Array.from(this.prompts.values()));
      this.personalizedSuggestions = suggestions;
      if (suggestions.length === 0) this.toastMessage.show("No specific production tips right now. Keep cookin' that fire!");
      this.recordAction('fetch_ai_suggestions_success', {suggestionCount: suggestions.length});
    } catch (error: any) { this.toastMessage.show(`Failed to get beat tips: ${error.message}`); this.recordAction('fetch_ai_suggestions_error', {error: error.message});
    } finally { this.isFetchingSuggestions = false; }
  }
  private handleStartRecording() { 
    if (this.isRecording || !this.captureNode) return;
    try { this.mediaRecorder = new MediaRecorder(this.captureNode.stream, { mimeType: 'audio/webm; codecs=opus' }); }
    catch (e) { console.warn("WebM Opus not supported, trying audio/ogg", e); try { this.mediaRecorder = new MediaRecorder(this.captureNode.stream, { mimeType: 'audio/ogg; codecs=opus' }); }
      catch (e2) { console.warn("audio/ogg Opus not supported, trying default", e2); try { this.mediaRecorder = new MediaRecorder(this.captureNode.stream); }
        catch (e3) { this.toastMessage.show("Recording API not supported on this browser."); console.error("MediaRecorder error:", e3); return; }}}
    this.audioChunks = []; this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data);};
    this.mediaRecorder.onstop = () => { if (this.audioChunks.length > 0) { const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' }); this.recordedAudioURL = URL.createObjectURL(audioBlob); this.toastMessage.show("Beat recorded! Download link available."); } else this.toastMessage.show("Recording stopped. No audio data captured."); this.isRecording = false; this.requestUpdate(); };
    this.mediaRecorder.start(); this.isRecording = true; this.recordedAudioURL = null; this.toastMessage.show("Recording session..."); this.recordAction('recording_started', {});
  }
  private handleStopRecording() { if (!this.isRecording || !this.mediaRecorder) return; this.mediaRecorder.stop(); this.recordAction('recording_stopped', {duration: this.audioContext.currentTime });}
  private handleDownloadRecording() { if (!this.recordedAudioURL) return; const a = document.createElement('a'); a.href = this.recordedAudioURL; a.download = `PromptDJ_Beat_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.${this.mediaRecorder?.mimeType.split('/')[1].split(';')[0] || 'webm'}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); this.recordAction('recording_downloaded', {});}
  private handleClearRecording() { if (this.recordedAudioURL) { URL.revokeObjectURL(this.recordedAudioURL); this.recordedAudioURL = null; } this.audioChunks = []; if (this.isRecording) this.handleStopRecording(); this.isRecording = false; this.recordAction('recording_cleared', {});}
  private async handleGenerateVariations() { if (!this.exportEngine) { this.toastMessage.show("Variation Engine not available."); return; } this.recordAction('generate_variations_clicked', {}); const appState = { prompts: Array.from(this.prompts.values()), samples: this.userSamples.map(s => s.name), settings: this.settingsController['config'] }; const message = await this.exportEngine.generateVariations(appState, 3); this.toastMessage.show(message); }
  
  private renderCurrentAnalysis() {
    if (this.isAnalyzingSample && this.lastUploadedFileForAnalysis) return html`<p><div class="loading-spinner" role="status" aria-label="Analyzing sample"></div> Analyzing "${this.lastUploadedFileForAnalysis.name}" for Hip Hop vibes...</p>`;
    if (!this.currentSampleAnalysisResult && this.userSamples.length === 0) return html`<p>Drop a sample (loop, one-shot, break) to get its Hip Hop DNA.</p>`;
    if (this.currentSampleAnalysisResult) {
        if (this.currentSampleAnalysisResult.error) return html`<p class="error">Analysis Error: ${this.currentSampleAnalysisResult.error}</p>`;
        const { bpm, key, scale, sampleType, instrumentClassification, hipHopSubgenres, moodTags, grooveDescription, creativeChoppingIdeas, suggestedHipHopUses, energyLevel, timbralQualities, loopCharacteristics } = this.currentSampleAnalysisResult;
        return html`
          ${sampleType ? html`<p><strong>Type:</strong> ${sampleType}</p>` : ''}
          ${bpm ? html`<p><strong>BPM:</strong> ${bpm}</p>` : ''}
          ${key && scale ? html`<p><strong>Key/Scale:</strong> ${key} ${scale}</p>` : ''}
          ${energyLevel ? html`<p><strong>Energy:</strong> ${energyLevel}/10</p>` : ''}
          ${instrumentClassification && instrumentClassification.length > 0 ? html`<p><strong>Sounds Like:</strong> ${instrumentClassification.join(', ')}</p>` : ''}
          ${hipHopSubgenres && hipHopSubgenres.length > 0 ? html`<p><strong>Subgenre(s):</strong> ${hipHopSubgenres.join(', ')}</p>` : ''}
          ${moodTags && moodTags.length > 0 ? html`<p><strong>Mood(s):</strong> ${moodTags.join(', ')}</p>` : ''}
          ${timbralQualities && timbralQualities.length > 0 ? html`<p><strong>Timbre:</strong> ${timbralQualities.join(', ')}</p>` : ''}
          ${grooveDescription ? html`<p><strong>Groove:</strong> ${grooveDescription}</p>` : ''}
          ${loopCharacteristics?.isLoop && loopCharacteristics.durationBars ? html`<p><strong>Loop:</strong> Yes, ${loopCharacteristics.durationBars} bars</p>` : loopCharacteristics?.isLoop === false ? html`<p><strong>Loop:</strong> No (One-shot)</p>`: ''}
          ${suggestedHipHopUses && suggestedHipHopUses.length > 0 ? html`<p><strong>Suggested Use:</strong> ${suggestedHipHopUses.join('; ')}</p>` : ''}
          ${creativeChoppingIdeas && creativeChoppingIdeas.length > 0 ? html`<p><strong>Flip Ideas:</strong> ${creativeChoppingIdeas.join('; ')}</p>` : ''}
        `;
    }
    return html`<p>Analysis of your last sample will show up here, fam.</p>`;
  }

  override render() {
    const bg = styleMap({ backgroundImage: this.makeBackground() });
    return html`
      <div id="background" style=${bg}></div>
      
      <div class="panel left-panel">
        <div class="panel-header"><h2>Sample Lab</h2></div>
        <div class="section-container sample-lab-container">
          <h3>Load & Analyze Your Sounds</h3>
          <div class="sample-controls">
            <input type="file" id="sampleFileInput" accept="audio/*" @change=${this.handleFileChange} />
            <label for="sampleFileInput" class="button-like-label" role="button" tabindex="0">Upload Audio Sample</label>
            ${this.lastUploadedFileForAnalysis ? html`<span class="file-name" title=${this.lastUploadedFileForAnalysis.name}>${this.lastUploadedFileForAnalysis.name}</span>` : ''}
          </div>
          <div class="analysis-results" aria-live="polite">
            ${this.renderCurrentAnalysis()}
          </div>
          <button class="styled-button" @click=${this.handleInspireLyriaBeat} 
            ?disabled=${this.isAnalyzingSample || (this.userSamples.length === 0 && !this.currentSampleAnalysisResult) || (this.currentSampleAnalysisResult?.error && this.userSamples.every(s => s.metadata.error)) }
            title="Use the last analyzed sample's vibe to kickstart a Lyria beat">
            ${this.isAnalyzingSample ? html`<div class="loading-spinner"></div>Analyzing...`:'Inspire Lyria Beat'}
          </button>
          ${this.userSamples.length > 0 ? html`
            <div class="uploaded-samples-list">
              <h4>Your Sample Stash (${this.userSamples.length})</h4>
              <ul>
                ${this.userSamples.map(sample => html`
                  <li>
                    <span class="sample-name" title=${sample.name}>${sample.name}</span>
                    <span class="sample-key-bpm">
                      ${sample.metadata.key || ''}${sample.metadata.scale ? ' '+sample.metadata.scale.substring(0,3) : ''} / ${sample.metadata.bpm ? `${sample.metadata.bpm}BPM` : ''}
                    </span>
                    <button class="remove-sample-button" @click=${() => this.handleRemoveSample(sample.id)} title="Remove sample">✕</button>
                  </li>`)}
              </ul>
            </div>` : ''}
        </div>
      </div>

      <div class="panel center-panel">
        <div class="section-container beat-control-center-container">
          <div class="panel-header" style="text-align:center; border-bottom-width:3px; margin-bottom:1vmin;"><h2 style="font-size:2vmin; color: #fff; border:none;">Beat Control Center</h2></div>
            <div class="prompts-area">
              <div id="prompts-container" @prompt-removed=${this.handlePromptRemoved} @wheel=${this.handlePromptsContainerWheel}>
                ${this.renderPrompts()}
              </div>
              <div class="add-prompt-button-container">
                <add-prompt-button @click=${this.handleAddPrompt} title="Add New Beat Element"></add-prompt-button>
              </div>
            </div>
            <div id="settings-container">
              <settings-controller @settings-changed=${this.updateSettings}></settings-controller>
            </div>
             <div class="main-playback-controls">
                <div class="progression-tracker">
                  <div class="progression-label">5-Min Beat Evolution: <span>${this.formatTime(this.progressionTime)}</span> / <span>5:00</span></div>
                  <progress class="progression-bar" max=${this.progressionCycleDuration} .value=${this.progressionTime}></progress>
                </div>
                <div class="playback-buttons">
                  <play-pause-button @click=${this.handlePlayPause} .playbackState=${this.playbackState} title=${this.playbackState === 'playing' ? 'Pause Live Beat' : 'Play Live Beat'}></play-pause-button>
                  <reset-button @click=${this.handleReset} title="Reset Beat & Session"></reset-button>
                </div>
            </div>
        </div>
      </div>

      <div class="panel right-panel">
        <div class="panel-header"><h2>AI Coach &amp; Tools</h2></div>
         <div class="section-container ai-coach-container">
          <h3>AI Production Coach</h3>
          <div class="ai-assistant-controls">
            <button class="styled-button" @click=${this.handleFetchAISuggestions} ?disabled=${this.isFetchingSuggestions}>
              ${this.isFetchingSuggestions ? html`<div class="loading-spinner"></div> Getting Tips...` : 'Get Beat Tips'}
            </button>
          </div>
          ${this.personalizedSuggestions.length > 0 ? html`
            <div class="suggestions-display" aria-live="polite">
              <h4>Fresh Ideas:</h4>
              <ul>${this.personalizedSuggestions.map(s => html`<li><strong>${s.type.replace(/_/g, ' ')}:</strong> ${s.description}</li>`)}</ul>
            </div>
          ` : this.isFetchingSuggestions ? '' : html`<p style="font-size:1.1vmin; color:#888; text-align:center; margin-top:1vmin;">Ask the AI Coach for tips on your current beat!</p>`}
        </div>

        <div class="section-container session-tools-container">
            <h3>Session Tools</h3>
            <div class="recording-controls">
              ${!this.isRecording ? html`
                  <button class="styled-button" @click=${this.handleStartRecording} ?disabled=${this.playbackState === 'stopped' || this.connectionError}>Record Session</button>
              ` : html`
                  <button class="styled-button" @click=${this.handleStopRecording} style="background-color: #E74C3C;"><span class="recording-dot"></span>Stop Recording</button>
              `}
              ${this.recordedAudioURL ? html`
                  <a class="download-link styled-button" href=${this.recordedAudioURL} @click=${this.handleDownloadRecording} download="PromptDJ_Beat.webm" style="background-color:#3498DB;">Download Beat</a>
                  <button class="styled-button" @click=${this.handleClearRecording} style="background-color: #777;">Clear Recording</button>
              ` : ''}
            </div>
            <div class="export-controls" style="margin-top:1vmin;">
                 <button class="styled-button" @click=${this.handleGenerateVariations} title="Generate variations (placeholder)">Generate Variations</button>
            </div>
        </div>
      </div>
      <toast-message></toast-message>
    `;
  }

  private renderPrompts() {
    return [...this.prompts.values()].map((prompt) => {
      return html`<prompt-controller
        .promptId=${prompt.promptId}
        ?filtered=${this.filteredPrompts.has(prompt.text)}
        .text=${prompt.text}
        .weight=${prompt.weight}
        .color=${prompt.color}
        @prompt-changed=${this.handlePromptChanged}>
      </prompt-controller>`;
    });
  }
}

function gen(parent: HTMLElement) {
  const initialPrompts = getStoredPrompts();
  const pdj = new PromptDj(initialPrompts);
  parent.appendChild(pdj);
  pdj.addEventListener('prompts-changed', (e: Event) => {
    const customEvent = e as CustomEvent<Map<string, Prompt>>;
    setStoredPrompts(customEvent.detail);
  });
}

function getStoredPrompts(forceDefaults = false): Map<string, Prompt> {
  if (!forceDefaults) {
    const {localStorage} = window;
    const storedPrompts = localStorage.getItem('prompts-hiphop-dj'); // Changed storage key
    if (storedPrompts) {
      try {
        const prompts = JSON.parse(storedPrompts) as Prompt[];
        // Ensure loaded prompts have valid colors if new colors were added
        return new Map(prompts.map((prompt, i) => [prompt.promptId, {...prompt, color: prompt.color || getUnusedRandomColor(prompts.slice(0,i).map(p=>p.color))  }]));
      } catch (e) { console.error('Failed to parse stored Hip Hop prompts', e); }
    }
  }
  console.log(forceDefaults ? 'Forcing default Hip Hop prompts.' : 'No stored Hip Hop prompts, creating presets.');
  const numDefaultPrompts = Math.min(4, HIPHOP_PROMPT_TEXT_PRESETS.length); // Use Hip Hop presets
  const shuffledPresetTexts = [...HIPHOP_PROMPT_TEXT_PRESETS].sort(() => Math.random() - 0.5);
  const defaultPrompts: Prompt[] = [];
  const usedColors: string[] = [];
  for (let i = 0; i < numDefaultPrompts; i++) {
    const text = shuffledPresetTexts[i];
    const color = getUnusedRandomColor(usedColors); usedColors.push(color);
    defaultPrompts.push({ promptId: `prompt-${i}`, text, weight: 0, color });
  }
  const promptsToActivate = [...defaultPrompts].sort(() => Math.random() - 0.5);
  const numToActivate = Math.min(2, defaultPrompts.length);
  for (let i = 0; i < numToActivate; i++) {
    if (promptsToActivate[i]) promptsToActivate[i].weight = Math.random() * 0.6 + 0.4; // Random initial weight
  }
  return new Map(defaultPrompts.map((p) => [p.promptId, p]));
}

function setStoredPrompts(prompts: Map<string, Prompt>) {
  const storedPrompts = JSON.stringify([...prompts.values()]);
  const {localStorage} = window;
  localStorage.setItem('prompts-hiphop-dj', storedPrompts); // Changed storage key
}

function main(container: HTMLElement) { gen(container); }
main(document.body);

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj': PromptDj;
    'prompt-controller': PromptController;
    'settings-controller': SettingsController;
    'add-prompt-button': AddPromptButton;
    'play-pause-button': PlayPauseButton;
    'reset-button': ResetButton;
    'weight-slider': WeightSlider;
    'toast-message': ToastMessage;
  }
}