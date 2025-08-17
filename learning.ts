

/**
 * @fileoverview Engine for learning user preferences and providing personalized Hip Hop production suggestions.
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import type { MusicalContext, UserSample } from './audioUtils';
import type { Prompt } from './index'; 

const SUGGESTION_MODEL = 'gemini-2.5-flash';

export interface UserAction {
  timestamp: number;
  type: UserActionDetail['type'];
  details: UserActionDetail['details'];
}

export type UserActionDetail =
  | { type: 'prompt_changed'; details: { promptId: string; oldText: string; newText: string; oldWeight: number; newWeight: number } }
  | { type: 'prompt_added'; details: { promptId: string; text: string } }
  | { type: 'prompt_removed'; details: { promptId: string; text: string } }
  | { type: 'prompt_filtered'; details: { text: string; reason: string } }
  | { type: 'settings_changed'; details: { config: any } }
  | { type: 'sample_analyzed'; details: { sampleName: string; analysis: any } }
  | { type: 'sample_analysis_failed'; details: { fileName: string; error: string } }
  | { type: 'sample_removed'; details: { sampleName: string; sampleId: string } }
  | { type: 'sample_triggered'; details: { sampleName: string; contextEnergy?: number; configVolume?: number } }
  | { type: 'generate_backing_music'; details: { promptText: string; basedOnSample: string } }
  | { type: 'lyria_error'; details: { error: string } }
  | { type: 'lyria_closed'; details: {} }
  | { type: 'lyria_connection_failed'; details: { error: string } }
  | { type: 'lyria_context_reset_due_to_scale_change', details: {oldScale?: string, newScale?: string}}
  | { type: 'playback_paused'; details: {} }
  | { type: 'playback_started'; details: { fromState: string } }
  | { type: 'playback_stopped_from_loading'; details: {} }
  | { type: 'app_reset'; details: {} }
  | { type: 'fetch_ai_suggestions_started'; details: {} }
  | { type: 'fetch_ai_suggestions_success'; details: { suggestionCount: number } }
  | { type: 'fetch_ai_suggestions_error'; details: { error: string } }
  | { type: 'export_project_clicked'; details: {} }
  | { type: 'generate_variations_clicked'; details: {} }
  | { type: 'recording_started'; details: {} }
  | { type: 'recording_stopped'; details: { duration: number } }
  | { type: 'recording_downloaded'; details: {} }
  | { type: 'recording_cleared'; details: {} }
  | { type: 'set_prompts_error'; details: { error: string; prompts: string[] } }
  | { type: 'audio_processing_error'; details: { error: string; dataPreview?: string } }
  | { type: 'smart_sample_trigger_error'; details: { error: string } };

export interface PersonalizedSuggestionItem {
  type: "sample_flip_idea" | "drum_pattern_suggestion" | "bassline_idea" | "melody_hook_idea" | "arrangement_tweak" | "fx_suggestion" | "general_hiphop_tip";
  description: string;
  // relatedSample?: string; // Optional: name of a sample this suggestion relates to
  // relatedPromptText?: string; // Optional: a Lyria prompt this suggestion relates to
}

export class LearningEngine {
  private ai: GoogleGenAI;
  public userHistory: UserAction[] = [];
  private readonly MAX_HISTORY_ITEMS = 50;

  constructor(aiInstance: GoogleGenAI) {
    this.ai = aiInstance;
  }

  public recordUserAction(actionType: UserActionDetail['type'], details: UserActionDetail['details']): void {
    const action: UserAction = { timestamp: Date.now(), type: actionType, details: details };
    this.userHistory.push(action);
    if (this.userHistory.length > this.MAX_HISTORY_ITEMS * 1.5) {
        this.userHistory = this.userHistory.slice(-this.MAX_HISTORY_ITEMS);
    }
  }

  private summarizeHistoryForPrompt(): any[] {
    const recentHistory = this.userHistory.slice(-10); // Focus on very recent actions
    return recentHistory.map(action => {
        const summary: any = { type: action.type };
        if (action.details) {
            if ((action.details as any).promptText) summary.promptText = (action.details as any).promptText.substring(0,40);
            if ((action.details as any).sampleName) summary.sampleName = (action.details as any).sampleName;
            if ((action.details as any).key) summary.key = (action.details as any).key;
            if (action.type === 'settings_changed' && (action.details as any).config) summary.changedSettingKeys = Object.keys((action.details as any).config);
        }
        return summary;
    });
  }

  async getPersonalizedSuggestions(
    currentContext: MusicalContext | null,
    currentSamples: UserSample[],
    currentPrompts: Prompt[]
  ): Promise<PersonalizedSuggestionItem[]> {
    const historySummary = this.summarizeHistoryForPrompt();
    const simplifiedSamples = currentSamples.map(s => ({
        name: s.name, hipHopSubgenres: s.metadata.hipHopSubgenres, moodTags: s.metadata.moodTags,
        instrument: s.metadata.instrumentClassification?.[0], energy: s.metadata.energyLevel, key: s.metadata.key
    }));
    const activePrompts = currentPrompts.filter(p => p.weight > 0.1).map(p => ({ text: p.text, weight: p.weight.toFixed(1) }));

    const prompt = `
You are an AI Hip Hop production coach. Based on the user's recent actions and current musical state, provide 2-3 creative and actionable Hip Hop production suggestions.
Format your response as a single, minified JSON array of objects. Each object must have a "type" and a "description".
Valid "type" values: "sample_flip_idea", "drum_pattern_suggestion", "bassline_idea", "melody_hook_idea", "arrangement_tweak", "fx_suggestion", "general_hiphop_tip".
Keep descriptions concise (1-2 sentences) and specific to Hip Hop.

User's recent history (last few actions):
${JSON.stringify(historySummary, null, 2)}

Current musical context from Lyria (if available):
${currentContext ? JSON.stringify({ energy: currentContext.energy?.toFixed(2), key: currentContext.key, scale: currentContext.scale, beatDensity: currentContext.beatDensity?.toFixed(2), bpm: currentContext.bpm?.toFixed(0) }, null, 2) : "Not available or beat is paused"}

Available user samples (name, genre, mood, main instrument, energy, key):
${JSON.stringify(simplifiedSamples, null, 2)}

Currently active Lyria prompts (text, weight):
${JSON.stringify(activePrompts, null, 2)}

Example suggestions:
- {"type": "sample_flip_idea", "description": "Try chopping the 'Soulful Loop' sample and pitching it down for a classic boom bap vibe."}
- {"type": "drum_pattern_suggestion", "description": "Add a syncopated hi-hat pattern with some 16th note triplets to give the drums more bounce."}
- {"type": "bassline_idea", "description": "A simple, deep 808 bassline following the root notes of the 'Lo-fi Keys' prompt would sound dope."}
- {"type": "arrangement_tweak", "description": "Consider a filter sweep on the main sample for your intro section to build energy."}
- {"type": "fx_suggestion", "description": "Add some vinyl crackle or a tape hiss effect for a more vintage Hip Hop feel."}

JSON Response (array of suggestion objects):
`;
    let jsonStr = "";
    try {
      const response: GenerateContentResponse = await this.ai.models.generateContent({
        model: SUGGESTION_MODEL, contents: prompt, config: { responseMimeType: "application/json" }
      });
      jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) jsonStr = match[2].trim();
      const firstBrace = jsonStr.indexOf('['); const lastBrace = jsonStr.lastIndexOf(']');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      const parsedSuggestions = JSON.parse(jsonStr) as PersonalizedSuggestionItem[];
      if (!Array.isArray(parsedSuggestions)) { console.error("Suggestions not an array:", parsedSuggestions); return [{type: "general_hiphop_tip", description: "Received an unexpected format for suggestions."}]; }
      return parsedSuggestions.filter(s => s.type && s.description);
    } catch (error) {
      console.error("Error generating Hip Hop suggestions with Gemini:", error);
      console.error("Prompt sent to Gemini for Hip Hop suggestions:", prompt);
      console.error("Cleaned JSON string for Hip Hop suggestions:", jsonStr);
      let rawResponseText = "N/A";
      if (error && (error as any).response && (error as any).response.text) rawResponseText = (error as any).response.text;
      else if (error && (error as any).message && (error as any).message.includes("text()")) rawResponseText = "Could not parse Gemini response: Likely not valid JSON.";
      console.error("Raw response text from Gemini for Hip Hop suggestions:", rawResponseText);
      return [{ type: "general_hiphop_tip", description: "Keep experimenting with different drum sounds and sample chops!" }];
    }
  }
}