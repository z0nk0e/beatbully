/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {Blob} from '@google/genai';

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // convert float32 -1 to 1 to int16 -32768 to 32767
    int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
  }

  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000', // Lyria expects 16kHz, ensure this aligns if used for Lyria input
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  if (!data || data.byteLength === 0) {
    console.warn('decodeAudioData: Received empty or null audio data. Returning silent buffer.');
    return ctx.createBuffer(numChannels, 1, sampleRate); // Minimal silent buffer
  }

  // Expect 2 bytes per sample value (16-bit)
  const bytesPerSampleValue = 2;
  if (data.byteLength % (bytesPerSampleValue * numChannels) !== 0) {
    console.error(
      `decodeAudioData: Data byteLength (${data.byteLength}) is not consistent with 16-bit PCM for ${numChannels} channels. Returning silent buffer.`
    );
    return ctx.createBuffer(numChannels, 1, sampleRate);
  }

  const samplesPerChannel = data.byteLength / bytesPerSampleValue / numChannels;
  if (samplesPerChannel === 0) {
    console.warn('decodeAudioData: Calculated zero samples per channel. Returning silent buffer.');
    return ctx.createBuffer(numChannels, 1, sampleRate);
  }
  
  const audioBuffer = ctx.createBuffer(
    numChannels,
    samplesPerChannel,
    sampleRate,
  );

  // Ensure data.buffer is correctly aligned for Int16Array view.
  // Int16Array requires the buffer's byteOffset to be a multiple of 2.
  // data.byteOffset is relative to data.buffer.
  if (data.byteOffset % bytesPerSampleValue !== 0) {
      console.error(`decodeAudioData: Uint8Array data is not aligned for Int16Array view (byteOffset ${data.byteOffset} must be even). Returning silent buffer.`);
      return ctx.createBuffer(numChannels, 1, sampleRate);
  }

  const int16Array = new Int16Array(data.buffer, data.byteOffset, data.byteLength / bytesPerSampleValue);
  
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < samplesPerChannel; i++) {
      const sampleIndex = i * numChannels + channel;
      if (sampleIndex < int16Array.length) {
        // Normalize Int16 to Float32 range (-1.0 to 1.0)
        channelData[i] = int16Array[sampleIndex] / 32768.0; 
      } else {
        // This case should be ideally prevented by the initial byteLength and samplesPerChannel checks.
        console.error(`decodeAudioData: sampleIndex out of bounds. Index: ${sampleIndex}, Int16Array length: ${int16Array.length}. This indicates a miscalculation.`);
        channelData[i] = 0; 
      }
    }
  }
  return audioBuffer;
}


async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export {createBlob, decode, decodeAudioData, encode, fileToBase64};