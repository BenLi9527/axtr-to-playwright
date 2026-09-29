import type { NormalizedAction, ParsedRecording, RecordingStep, UIElement } from './types';

/**
 * Tolerant parser for D365 Task Recorder's Recording.xml.
 *
 * Design notes:
 * - There is no official published XSD, and real-world Recording.xml files
 *   vary by D365 version / control type (attributes vs. child elements,
 *   different casing, extra/missing fields). We therefore avoid relying on
 *   a strict schema and instead:
 *     1. Search the whole document for elements that look like "steps"
 *        regardless of nesting depth or exact tag name.
 *     2. For each candidate field, try several attribute names AND child
 *        element names before giving up.
 *     3. Never throw for a single malformed step — collect a warning and
 *        keep going, so one bad node doesn't abort the whole file.
 */

const STEP_TAG_NAMES = ['step', 'uiaction', 'recordedstep', 'action'];
const UI_ELEMENT_TAG_NAMES = ['uielement', 'control', 'element', 'target'];

/** Recursively collects all elements anywhere under `root` whose local tag name matches one of `names` (case-insensitive). */
function findAllByTagNames(root: Element | Document, names: string[]): Element[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const result: Element[] = [];
  const stack: Element[] = [];
  const initial = root instanceof Document ? root.documentElement : root;
  if (initial) stack.push(initial);

  while (stack.length > 0) {
    const el = stack.pop()!;
    const localName = (el.localName || el.tagName || '').toLowerCase();
    if (wanted.has(localName)) {
      result.push(el);
    }
    for (let i = 0; i < el.children.length; i++) {
      stack.push(el.children[i]);
    }
  }
  // Preserve document order (stack-based DFS above visits in reverse sibling order).
  result.reverse();
  return result;
}

/** Finds the first direct or nested child element matching one of `names` (case-insensitive, local name). */
function findChild(el: Element, names: string[]): Element | undefined {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    const localName = (child.localName || child.tagName || '').toLowerCase();
    if (wanted.has(localName)) return child;
  }
  return undefined;
}

/** Gets an attribute value trying multiple casings/spellings, or falls back to a same-named child element's text content. */
function getField(el: Element, names: string[]): string | undefined {
  for (const name of names) {
    const attr = el.getAttribute(name);
    if (attr !== null && attr !== undefined && attr.trim() !== '') return attr.trim();
  }
  const child = findChild(el, names);
  if (child && child.textContent && child.textContent.trim() !== '') {
    return child.textContent.trim();
  }
  return undefined;
}

function collectRawAttributes(el: Element): Record<string, string> {
  const raw: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    raw[attr.name] = attr.value;
  }
  return raw;
}

function parseUIElement(stepEl: Element): UIElement {
  const uiEl = findChild(stepEl, UI_ELEMENT_TAG_NAMES) ?? stepEl;
  return {
    id: getField(uiEl, ['Id', 'ID', 'ControlId', 'ControlName']),
    name: getField(uiEl, ['Name', 'ControlName']),
    automationName: getField(uiEl, ['AutomationName', 'AutomationId']),
    controlType: getField(uiEl, ['ControlType', 'Type']),
    form: getField(uiEl, ['Form', 'FormName']),
    path: getField(uiEl, ['Path', 'ControlPath', 'NavigationPath']),
    dataAreaId: getField(uiEl, ['DataAreaId', 'DataAreaID', 'Company']),
    raw: collectRawAttributes(uiEl),
  };
}

function normalizeAction(actionType: string | undefined): NormalizedAction {
  if (!actionType) return 'unknown';
  const a = actionType.toLowerCase();
  if (a.includes('click') || a.includes('press button') || a.includes('button')) return 'click';
  if (a.includes('select') || a.includes('lookup') || a.includes('combobox') || a.includes('dropdown')) return 'select';
  if (a.includes('setvalue') || a.includes('settext') || a.includes('input') || a === 'type' || a.includes('typetext')) return 'setValue';
  if (a.includes('navigate') || a.includes('open') || a.includes('launch') || a.includes('workspace') || a.includes('menuitem')) return 'navigate';
  if (a.includes('key')) return 'keyPress';
  return 'unknown';
}

/**
 * Parses a Recording.xml string into a normalized list of steps.
 * Never throws for structural oddities in individual steps; instead records
 * a warning and best-effort output. Throws only if the XML itself cannot be
 * parsed at all (not well-formed) or contains no recognizable step nodes.
 */
export function parseRecordingXml(xmlText: string): ParsedRecording {
  const warnings: string[] = [];

  if (!xmlText || xmlText.trim() === '') {
    throw new Error('Recording.xml 内容为空。');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Recording.xml 不是合法的 XML: ${parserError.textContent?.trim() ?? '未知解析错误'}`);
  }

  if (!doc.documentElement) {
    throw new Error('Recording.xml 中没有找到根元素。');
  }

  const title =
    getField(doc.documentElement, ['Title', 'Name', 'RecordingName']) ??
    doc.documentElement.getAttribute('Title') ??
    undefined;

  const stepEls = findAllByTagNames(doc, STEP_TAG_NAMES);

  if (stepEls.length === 0) {
    warnings.push(
      '在 Recording.xml 中没有找到任何可识别的步骤节点（Step/UIAction 等），生成的脚本可能为空。请人工核对原始文件结构。'
    );
  }

  const steps: RecordingStep[] = stepEls.map((stepEl, i) => {
    const index = i + 1;
    let actionType: string | undefined;
    let displayText: string | undefined;
    let value: string | undefined;
    let uiElement: UIElement = {};

    try {
      actionType = getField(stepEl, ['ActionType', 'Action', 'Type']);
      displayText = getField(stepEl, ['DisplayText', 'Description', 'Caption']);
      value = getField(stepEl, ['Value', 'NewValue', 'Text', 'InputValue']);
      uiElement = parseUIElement(stepEl);
    } catch (err) {
      warnings.push(
        `第 ${index} 步解析时发生局部错误，已跳过缺失字段: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return {
      index,
      actionType,
      normalizedAction: normalizeAction(actionType),
      displayText,
      value,
      uiElement,
    };
  });

  return { title, steps, warnings };
}
