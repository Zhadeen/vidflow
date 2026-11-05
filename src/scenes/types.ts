export interface Scene {
  id: string; // 'scene-01'
  slide: number; // 1-based
  start: number | null; // seconds
  end: number | null;
  sentence: string;
  concept: string;
  textOverlay: string;
  imagePrompt: string;
  motionPrompt: string; // filled by defaultMotionPrompt when missing
  motionPromptIsDefault: boolean;
}

export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParseResult {
  scenes: Scene[];
  issues: ParseIssue[];
}
