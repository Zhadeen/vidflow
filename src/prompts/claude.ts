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
