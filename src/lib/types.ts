/**
 * Shared types for the AXTR -> Playwright conversion pipeline.
 *
 * NOTE: Microsoft has not published an official XSD for Task Recorder's
 * Recording.xml, and the schema has drifted across D365 versions and
 * control types. These types intentionally model only the fields we rely
 * on, and every field is optional so the parser can degrade gracefully
 * instead of failing on unfamiliar structures.
 */

/** Loosely-typed description of the D365 control targeted by a step. */
export interface UIElement {
  id?: string;
  name?: string;
  automationName?: string;
  controlType?: string;
  form?: string;
  path?: string;
  dataAreaId?: string;
  /** Raw attribute bag for anything we didn't explicitly model. */
  raw?: Record<string, string>;
}

/** Normalized action kind, independent of the many raw ActionType spellings D365 uses. */
export type NormalizedAction =
  | 'click'
  | 'setValue'
  | 'select'
  | 'navigate'
  | 'keyPress'
  | 'unknown';

/** A single parsed Task Recorder step. */
export interface RecordingStep {
  /** 1-based order of the step as it appears in Recording.xml. */
  index: number;
  /** Raw ActionType string as found in the XML (e.g. "SetValue", "Click"). */
  actionType?: string;
  normalizedAction: NormalizedAction;
  /** Human/localized description shown in Task Recorder, e.g. "在 "客户" 字段中输入 "1101"". */
  displayText?: string;
  /** The value typed/selected, when applicable. */
  value?: string;
  uiElement: UIElement;
}

/** Result of parsing Recording.xml: steps plus any non-fatal warnings encountered. */
export interface ParsedRecording {
  title?: string;
  steps: RecordingStep[];
  warnings: string[];
}
