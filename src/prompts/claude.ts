/**
 * The "Mother Prompt": the owner pastes this (with his script appended) into
 * claude.ai, and Claude replies with a CSV scene file that parseSceneFile reads.
 */
const INSTRUCTIONS = `You are a storyboard artist for short explainer videos. Turn the script at the bottom of this message into a scene file, one row per scene.

OUTPUT FORMAT
Reply with exactly one CSV code block and nothing else: no greeting, no notes, no text before or after it. Put every value in double quotes. The first line is this exact header:

Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt

COLUMNS
- Slide: "Slide 01", "Slide 02", "Slide 03" and so on, in order.
- Timecode: "MM:SS - MM:SS", for example "00:00 - 00:04". Timecodes are continuous: the end of each scene is the start of the next. The first scene starts at 00:00.
- Sentence: the exact words spoken in that scene, copied from the script without changes.
- Concept: 3 to 6 words naming the idea of the scene.
- Text Overlay: 1 to 3 punchy words in UPPERCASE to show on screen.
- Image Prompt: describes what is in the picture: the subject, the action, the emotion, the camera angle, the setting, the props and the lighting. Call the main character "the hero".
- Motion Prompt: 1 to 2 sentences describing only what moves in a short video clip that starts from that picture (the hero, props, light, camera). Do not describe anything that is not moving.

SCENE RULES
- Cover the whole script in order. You must never skip a sentence.
- A long sentence (roughly 15 words or more) must be split into 2 or 3 scenes, each carrying the exact words spoken in its part.
- Every scene lasts 3 to 6 seconds. Work out the length from the words in its Sentence at about 2.3 words per second, and make the timecodes add up.
- Make each picture different from the one before it: vary the camera angle, the setting and the action so the video stays interesting.

IMAGE PROMPT RULES
- Do not include any art style, medium or look. Never write words such as stickman, cartoon, 2D, 3D, realistic, whiteboard, illustration, sketch, photo, render, or an aspect ratio. The video tool adds the style.
- Do not describe the hero's appearance (face, body, clothes, colours). Only say what the hero is doing and feeling. Always refer to the hero as "the hero".

Now write the CSV for this script.`;

export function buildClaudePrompt(script: string): string {
  return `${INSTRUCTIONS}\n\nSCRIPT:\n${script}`;
}

/**
 * The "rapid-beat" variant: a new picture roughly every 6 spoken words (2 to 3
 * seconds). It asks for a single Prompt column; parseSceneFile reads that as the
 * picture prompt and fills in a default motion prompt.
 */
const RAPID_INSTRUCTIONS = `You are an AI Storyboard and Prompt Generator for high-retention video production.

TASK: Analyze the provided video script, break down sentences into rapid micro-beats of approximately every 6 words (roughly 2–3 seconds per beat), and generate a complete visual storyboard in CSV format ready for direct batch generation.

STRICT PRODUCTION RULES:

STRICT ~6-WORD PACING & SCRIPT CHUNKING:
- NEVER skip any word, sentence, or thought from the script.
- Break every sentence down into sequential visual beats of roughly 6 words (typically 5 to 7 words per slide):
  - A 6-word sentence = 1 slide (~6 words)
  - A 12-word sentence = 2 slides (~6 words each)
  - An 18-word sentence = 3 slides (~6 words each)
  - A 24-word sentence = 4 slides (~6 words each)
- Each 6-word micro-beat must have its own dedicated visual transition, camera angle, action, or visual metaphor to maintain maximum viewer retention.
- In the "Sentence" column, output the EXACT ~6-word segment/phrase spoken during that slide (preserving full script continuity word-for-word).

TIMECODE & PACING CALCULATION:
- Spoken voiceover rate is ~2.2 to 2.5 words per second, meaning each 6-word chunk lasts roughly 2 to 3 seconds.
- Continuous, sequential timecodes. Format: "MM:SS - MM:SS" (e.g., "00:00 - 00:03", "00:03 - 00:05", "00:05 - 00:08").
- Seamless continuity: the end time of one slide must be the exact start time of the next slide with no gaps or overlaps.

STYLE-NEUTRAL & HERO-READY PROMPTS:
- DO NOT include art style, render engine, or medium keywords (NO "2D cartoon", NO "cel shading", NO "3D Pixar CGI", NO "vector outlines", NO "--ar 16:9"). Visual style is injected separately.
- DO NOT specify fixed physical character features (hair color, clothing, face details). Character consistency is handled separately.
- Whenever the main character appears, strictly refer to them as "the hero protagonist" (e.g., "The hero protagonist opening a vintage lockbox with intense curiosity").
- Detail each prompt using: subject, micro-action, camera framing (extreme close-up, Dutch angle, wide shot, macro shot), environment, lighting mood, props, and visual metaphors.

EXACT CSV OUTPUT FORMAT:
- Output MUST be ONE single, valid RFC-4180 compliant CSV code block.
- All column values MUST be wrapped in double quotes ("...").
- Header row must be EXACTLY: Slide,Timecode,Sentence,Concept,Text Overlay,Prompt
- Columns:
  - Slide: "Slide 01", "Slide 02", "Slide 03"... (zero-padded, sequential)
  - Timecode: "MM:SS - MM:SS" (approx. 2–3s intervals matching the ~6 words)
  - Sentence: The exact ~6-word spoken segment from the script.
  - Concept: A 3-5 word summary of the shot's core visual idea.
  - Text Overlay: 1-3 punchy, high-impact uppercase words (e.g., "THE SECRET", "HIDDEN TRAP", "STEP ONE").
  - Prompt: Style-neutral, vivid cinematic description of the 6-word beat.`;

export function buildRapidBeatPrompt(script: string): string {
  return `${RAPID_INSTRUCTIONS}\n\nSCRIPT:\n${script}`;
}
