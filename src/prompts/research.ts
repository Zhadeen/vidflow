/**
 * Optional research prompts for remaking a winning video as an original one
 * (the "transformation" workflow): the owner pastes each into Gemini or claude.ai
 * and carries the reply to the next step. Each has bracketed blanks to fill in.
 */
export type ResearchPromptId = 'analyse' | 'rewrite' | 'packaging' | 'thumbnail';

export interface ResearchPrompt {
  id: ResearchPromptId;
  /** Button label. */
  label: string;
  /** One line telling the owner where to paste it and what comes back. */
  hint: string;
  build(script: string): string;
}

const ANALYSE = `Role: You are an expert YouTube retention strategist and script analyst.

Task: Analyse the transcript of a top-performing YouTube video. Break it down structurally so I can understand why it worked, without plagiarising it.

Input Transcript:

[PASTE TRANSCRIPT HERE]

Provide your output in the following format:

1. The Core Premise & Psychological Hook: What core desire, pain point, or curiosity gap does this video exploit in the first 30 seconds?

2. Section-by-Section Outline: Map out the video's progression (timestamp blocks, the psychological objective of each block, and how transitions are handled).

3. Retention Triggers: Identify the specific pattern interrupts, open loops, or emotional spikes used to keep viewers watching.

4. Data & Claims Check: List any core facts, statistics, or case studies used that need to be independently verified or updated.`;

const REWRITE = `Role: You are a master direct-response copywriter and elite scriptwriter for top-tier faceless and personality-driven YouTube channels.

Task: Using the structural outline below, write an entirely new, highly engaging script on the same topic.

Rules to avoid Reused Content penalties:
- Do NOT use the same phrasing, sentence structure, or vocabulary as the original transcript.
- Change the narrative angle or introduce a fresh paradigm or framework so the content is fundamentally transformative.
- Maintain a high-retention cadence: fast-paced, punchy sentences, continuous open loops, and zero fluff.

Source Topic/Outline Reference:

[INSERT STRUCTURAL OUTLINE FROM THE ANALYSIS]

Output Requirements:
- A compelling 3-part Hook (pattern interrupt + the problem + the promise).
- Body paragraphs structured with micro-cliffhangers every 40-50 seconds.
- A strong CTA (call to action) that drives engagement with my channel.
- A production notes column suggesting visual pacing (for example [B-roll], [Zoom in], [Text on screen]).`;

const PACKAGING_BODY = `Role: You are a YouTube CTR (click-through rate) optimisation specialist.

Task: Design high-converting, policy-safe packaging for this video that differentiates it completely from the original inspiration.

Provide:
1. 5 Alternative Titles: Ranging from curiosity-driven to benefit-driven, optimised for search and CTR without using clickbait or misleading phrases.
2. Thumbnail Concepts: 3 distinct visual layout ideas (foreground subject, background contrast, a text hook of 3-4 words max) that do not copy the original creator's thumbnail design.
3. Description Blueprint: A unique 3-sentence hook, timestamps, and contextual keywords that frame the video's distinct value proposition.`;

const THUMBNAIL = `Design a thumbnail in the same style as the attached reference, but the image used for mine should relate to my text. Use my text: [INSERT TEXT HERE]

(Attach the reference thumbnail to this prompt before sending.)`;

export const RESEARCH_PROMPTS: readonly ResearchPrompt[] = [
  {
    id: 'analyse',
    label: 'Copy: analyse a winning video',
    hint: 'Get the video’s transcript from Gemini first, then paste it where the prompt says. Gives you an outline of why it worked.',
    build: () => ANALYSE,
  },
  {
    id: 'rewrite',
    label: 'Copy: rewrite it as your own',
    hint: 'Paste the outline from the analysis where the prompt says. The new script goes in the box below.',
    build: () => REWRITE,
  },
  {
    id: 'packaging',
    label: 'Copy: titles and description',
    hint: 'Includes your script. Gives you 5 titles, 3 thumbnail ideas and a description.',
    build: (script) => `${PACKAGING_BODY}\n\nVideo Script Summary:\n${script.trim() || '[INSERT SCRIPT HERE]'}`,
  },
  {
    id: 'thumbnail',
    label: 'Copy: thumbnail',
    hint: 'Attach a reference thumbnail, fill in your text, and paste it into Gemini or Flow.',
    build: () => THUMBNAIL,
  },
];

export function buildResearchPrompt(id: ResearchPromptId, script: string): string {
  const found = RESEARCH_PROMPTS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown research prompt: ${id}`);
  return found.build(script);
}
