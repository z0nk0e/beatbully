/**
 * @fileoverview Engine for generating and managing Hip Hop beat arrangements.
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, GenerateContentResponse, Scale } from '@google/genai';
import type { UserSample } from './audioUtils';

const ARRANGER_MODEL = 'gemini-2.5-flash';

// Ensure only string values from the enum are used for the prompt
const VALID_LYRIA_SCALES: string[] = Object.values(Scale).filter(s => typeof s === 'string' && s !== 'SCALE_UNSPECIFIED') as string[];


export interface ArrangementSection {
  name: string; // e.g., Intro, Verse 1, Hook, Verse 2, Bridge, Breakdown, Outro
  duration: number; // in seconds
  lyriaPrompts: string[]; // Prompts for Lyria for this section
  targetEnergy?: number; // 1-10, guiding intensity
  sampleUsageSuggestions?: string[]; // e.g., "Drop 808 sample here", "Scratch sample 'Vocal Hit 1'", "Mute hi-hat loop"
  bpm?: number;
  density?: number; // 0-1
  brightness?: number; // 0-1
  scale?: Scale; // Use the Scale enum type
  temperature?: number;
  guidance?: number;
  topK?: number;
  muteBass?: boolean;
  muteDrums?: boolean;
  onlyBassAndDrums?: boolean;
  seed?: number;
}

export interface ArrangementPlan {
  sections: ArrangementSection[];
  totalDuration: number;
  overallKey?: string; // e.g., "C Minor"
  overallMood?: string; // e.g., "Chill Lo-fi", "Energetic Trap"
  hipHopSubgenre?: string; // e.g., "Boom Bap", "Trap", "Drill"
}

export class ArrangementEngine {
  private ai: GoogleGenAI;

  constructor(aiInstance: GoogleGenAI) {
    this.ai = aiInstance;
  }

  private async analyzeSampleCapabilities(samples: UserSample[]): Promise<object[]> {
    return samples.map(sample => ({
      name: sample.name,
      bpm: sample.metadata.bpm,
      key: sample.metadata.key,
      scale: sample.metadata.scale,
      sampleType: sample.metadata.sampleType,
      genreTags: sample.metadata.hipHopSubgenres, // Use hipHopSubgenres
      moodTags: sample.metadata.moodTags,
      instrumentClassification: sample.metadata.instrumentClassification,
      energyLevel: sample.metadata.energyLevel,
      rhythmicPatternDescription: sample.metadata.grooveDescription, // Use grooveDescription
      loopCharacteristics: sample.metadata.loopCharacteristics,
      timbralQualities: sample.metadata.timbralQualities,
    }));
  }

  async generateArrangement(
    samples: UserSample[],
    userPreferences: {
      targetDuration?: number;
      moodInstructions?: string;
    },
    currentPromptTexts: string[]
  ): Promise<ArrangementPlan | null> {
    const sampleCapabilities = await this.analyzeSampleCapabilities(samples);
    const defaultDuration = 90; 
    const duration = userPreferences.targetDuration || defaultDuration;
    const mood = userPreferences.moodInstructions || "A standard structure Hip Hop beat.";
    
    const validScalesStringForPrompt = VALID_LYRIA_SCALES.join(', ');

    const prompt = `
You are an expert Hip Hop music producer. Create a song arrangement plan for a Hip Hop beat as a single, minified JSON object.
Target duration: approximately ${duration} seconds.
Overall mood/instructions for the beat: ${mood}.

Available samples (use their characteristics to inform section choices, e.g., a 'Drum Loop' for a verse, 'Vocal Chop' for a hook):
${JSON.stringify(sampleCapabilities, null, 2)}

Available Lyria prompt building blocks (use these for "lyriaPrompts" in sections; you can combine them or suggest 1-2 new, highly specific Hip Hop elements if essential and distinct, e.g. "Record scratch FX", "Police siren sound effect"):
${JSON.stringify(currentPromptTexts, null, 2)}

The JSON object must follow this structure precisely:
{
  "sections": [
    {
      "name": "string (Standard Hip Hop sections: Intro, Verse 1, Hook, Verse 2, Bridge, Breakdown, Outro. Number verses/hooks if multiple)",
      "duration": "number (seconds, positive integer. Typical Hip Hop sections are 4, 8, or 16 bars. Assume 4/4 time; estimate BPM if not specified by user, default to 90 BPM for duration calculation if no other BPM info exists. Example: 8 bars at 90 BPM is ~21 seconds.)",
      "lyriaPrompts": ["array of 1-3 strings (prompt texts for Lyria for this section, draw from available blocks or suggest specific new Hip Hop sounds)"],
      "targetEnergy": "number (optional, 1-10, e.g., Intro low (2-4), Verse mid (5-7), Hook high (7-9), Outro fades)",
      "sampleUsageSuggestions": ["array of strings (optional, specific Hip Hop actions, e.g., 'Drop 808 kick pattern', 'Introduce hi-hat loop', 'Mute main sample for breakdown', 'Filter sweep on synth pad')"],
      "bpm": "number (optional, e.g., 80-100 for Boom Bap, 120-160 for Trap. Only set if changing BPM for this section, otherwise it inherits.)",
      "density": "number (optional, 0.0-1.0, Lyria beat density, e.g. lower for sparse sections like intros/breakdowns)",
      "brightness": "number (optional, 0.0-1.0, Lyria timbral brightness)",
      "scale": "string (optional, Lyria scale parameter. Must be one of: ${validScalesStringForPrompt}. Keep consistent or make intentional key changes for effect like a bridge.)",
      "temperature": "number (optional, Lyria creativity, e.g. 0.8-1.1)",
      "guidance": "number (optional, Lyria adherence to prompt, e.g. 2.5-4.5)",
      "topK": "number (optional, Lyria top-k sampling, e.g. 30-60)",
      "muteBass": "boolean (optional, for creating drops or dynamic changes)",
      "muteDrums": "boolean (optional, for breakdowns or intros)",
      "onlyBassAndDrums": "boolean (optional, e.g. for a classic Hip Hop breakdown section)",
      "seed": "number (optional, unique positive integer per section for variation or consistent if desired, max 1,000,000)"
    }
  ],
  "totalDuration": "number (sum of all section durations, aim to be close to target duration)",
  "overallKey": "string (optional, e.g., 'Am', 'C# Major', overall musical key of the arrangement based on samples/prompts)",
  "overallMood": "string (optional, a brief summary of the arrangement's intended Hip Hop vibe e.g. 'Gritty East Coast Boom Bap', 'Chill Lo-fi Study Beat')",
  "hipHopSubgenre": "string (optional, primary subgenre, e.g., 'Boom Bap', 'Trap', 'Lo-fi', 'Drill', 'Cloud Rap')"
}

Ensure all numerical values are numbers. "duration" must be positive. "lyriaPrompts" is an array of strings. Booleans must be true/false.
No explanatory text, comments, or markdown outside the JSON.
Sum of section durations should be reasonably close to target. Vary parameters (energy, density, mutes) to create a dynamic Hip Hop track.
Prioritize using existing Lyria prompts. Use sample characteristics (type, instruments, mood) to decide which samples to suggest for use in sections.
Ensure typical Hip Hop song structures (e.g., Intro -> Verse -> Hook -> Verse -> Hook -> Bridge/Breakdown -> Outro).
Section durations should make musical sense (e.g., multiples of 4 or 8 bars based on a common Hip Hop BPM like 90 or 140 if not specified).
For "scale", if you suggest a scale, it *must* be one of the provided valid Lyria scales.
`;
    let jsonStr = "";
    try {
      const response: GenerateContentResponse = await this.ai.models.generateContent({
        model: ARRANGER_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) jsonStr = match[2].trim();
      
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const parsedPlan = JSON.parse(jsonStr) as ArrangementPlan;

      if (!parsedPlan.sections || !Array.isArray(parsedPlan.sections) || parsedPlan.sections.length === 0) {
        console.error("Generated Hip Hop arrangement plan has no sections or is invalid.");
        return null;
      }
      
      // Validate and ensure enum values for Scale
      for (const section of parsedPlan.sections) {
        if (section.scale && !VALID_LYRIA_SCALES.includes(section.scale as string)) {
          console.warn(`Generated section "${section.name}" has an invalid scale "${section.scale}". Setting to undefined.`);
          section.scale = undefined; // Or set to Scale.SCALE_UNSPECIFIED if that's preferred as default
        }
      }
      return parsedPlan;

    } catch (error) {
      console.error("Error generating Hip Hop arrangement plan:", error);
      console.error("Prompt sent for Hip Hop arrangement:", prompt);
      console.error("Cleaned JSON string for Hip Hop arrangement:", jsonStr);
      console.error("Raw response text from Gemini:", (error as any)?.response?.text || "N/A");
      return null;
    }
  }
}