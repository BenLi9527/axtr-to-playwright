import type { NormalizedAction, ParsedRecording, RecordingStep } from './types';

/** Escapes a string so it can be safely embedded inside a single-quoted TS string literal. */
function escapeForSingleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

function quote(value: string): string {
  return `'${escapeForSingleQuotedString(value)}'`;
}

/** Best-effort ARIA role guess from a D365 ControlType string, used for getByRole(). */
function guessRole(controlType: string | undefined): string | undefined {
  if (!controlType) return undefined;
  const c = controlType.toLowerCase();
  if (c.includes('button')) return 'button';
  if (c.includes('menuitem') || c.includes('menu item')) return 'menuitem';
  if (c.includes('tab')) return 'tab';
  if (c.includes('link') || c.includes('hyperlink')) return 'link';
  if (c.includes('checkbox')) return 'checkbox';
  return undefined;
}

/** Picks the best available human-readable name for a control, in priority order. */
function bestControlName(step: RecordingStep): string | undefined {
  const { uiElement } = step;
  return uiElement.automationName || uiElement.name || uiElement.id || undefined;
}

/** Renders the raw-context comment line kept for manual cross-checking. */
function rawInfoComment(step: RecordingStep): string {
  const { uiElement } = step;
  const parts: string[] = [];
  if (step.actionType) parts.push(`ActionType=${step.actionType}`);
  if (uiElement.form) parts.push(`Form=${uiElement.form}`);
  if (uiElement.controlType) parts.push(`ControlType=${uiElement.controlType}`);
  if (uiElement.path) parts.push(`Path=${uiElement.path}`);
  if (uiElement.dataAreaId) parts.push(`DataAreaId=${uiElement.dataAreaId}`);
  if (uiElement.id) parts.push(`Id=${uiElement.id}`);
  return parts.length > 0 ? `// [原始信息] ${parts.join(', ')}` : '// [原始信息] (无额外控件属性)';
}

function displayComment(step: RecordingStep): string {
  const text = step.displayText?.trim();
  return `// 步骤 ${step.index}: ${text && text.length > 0 ? text : '(无 DisplayText，请人工核对该步骤含义)'}`;
}

function genClick(step: RecordingStep): string[] {
  const name = bestControlName(step);
  const role = guessRole(step.uiElement.controlType);
  if (name) {
    if (role) {
      return [`await page.getByRole(${quote(role)}, { name: ${quote(name)} }).click();`];
    }
    return [`await page.getByText(${quote(name)}).click();`];
  }
  if (step.displayText) {
    return [
      `await page.getByText(${quote(step.displayText.trim())}).click(); // TODO: 原始控件缺少 Name/AutomationName，此处暂用 DisplayText 作为选择器，请人工确认`,
    ];
  }
  return [
    "// TODO: 缺少控件 Name/AutomationName/DisplayText，无法生成 click 选择器，请人工补充，例如: await page.getByRole('button', { name: '...' }).click();",
  ];
}

function genSetValue(step: RecordingStep): string[] {
  const name = bestControlName(step);
  const value = step.value ?? '';
  if (name) {
    return [`await page.getByLabel(${quote(name)}).fill(${quote(value)});`];
  }
  return [`// TODO: 缺少字段 Name/AutomationName，无法生成 fill 选择器，请人工补充。原始输入值: ${quote(value)}`];
}

function genSelect(step: RecordingStep): string[] {
  const name = bestControlName(step);
  const value = step.value ?? '';
  if (name) {
    return [`await page.getByLabel(${quote(name)}).selectOption(${quote(value)});`];
  }
  return [
    `// TODO: 缺少字段 Name/AutomationName，无法生成 selectOption 选择器，请人工补充。原始选择值: ${quote(value)}`,
  ];
}

function genNavigate(step: RecordingStep): string[] {
  const target = step.uiElement.form || step.uiElement.path || step.displayText || '(未知目标)';
  return [`// 打开了 D365 表单/工作区: ${target} — 未记录真实 URL，无法生成跳转代码，请人工补充导航步骤（例如手动指定 page.goto 目标地址）`];
}

function genKeyPress(step: RecordingStep): string[] {
  const key = step.value?.trim();
  if (key) {
    return [`await page.keyboard.press(${quote(key)});`];
  }
  return ['// TODO: 缺少按键值，无法生成 page.keyboard.press(...)，请人工补充'];
}

function genUnknown(step: RecordingStep): string[] {
  return [`// TODO: 未识别的操作类型 "${step.actionType ?? '(空)'}"，请人工补充对应的 Playwright 代码`];
}

const GENERATORS: Record<NormalizedAction, (step: RecordingStep) => string[]> = {
  click: genClick,
  setValue: genSetValue,
  select: genSelect,
  navigate: genNavigate,
  keyPress: genKeyPress,
  unknown: genUnknown,
};

export interface GenerateOptions {
  /** Used in the header comment / describe title, e.g. the original .axtr file name. */
  sourceFileName?: string;
}

/**
 * Converts a parsed Recording into a runnable-shaped Playwright TypeScript
 * test file (as a string). Steps we can't confidently translate become
 * comment-only TODOs instead of guessed/invalid code, per design goals:
 * never fabricate selectors or URLs we don't have evidence for.
 */
export function generatePlaywrightScript(parsed: ParsedRecording, options: GenerateOptions = {}): string {
  const { title, steps, warnings } = parsed;
  const describeTitle = title?.trim() || options.sourceFileName || 'D365 Task Recorder 录制场景';

  const lines: string[] = [];
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');
  lines.push('/**');
  lines.push(' * 本文件由 axtr-to-playwright 扩展自动生成，请勿完全依赖生成结果直接上线。');
  if (options.sourceFileName) lines.push(` * 来源文件: ${options.sourceFileName}`);
  if (title) lines.push(` * 原始录制标题: ${title}`);
  lines.push(` * 生成时间: ${new Date().toISOString()}`);
  lines.push(' *');
  lines.push(' * ⚠️ 已知局限性：Task Recorder 没有公开的官方 XSD，部分控件类型的属性可能');
  lines.push(' * 缺失或命名不一致；标记为 TODO 的步骤需要人工补充选择器/断言后才能运行。');
  if (warnings.length > 0) {
    lines.push(' *');
    lines.push(' * 解析时产生的警告:');
    for (const w of warnings) {
      lines.push(` * - ${w}`);
    }
  }
  lines.push(' */');
  lines.push('');
  lines.push(`test.describe(${quote(describeTitle)}, () => {`);
  lines.push(`  test(${quote('从 Task Recorder 录制转换的场景')}, async ({ page }) => {`);

  if (steps.length === 0) {
    lines.push('    // TODO: 未能从 Recording.xml 中解析出任何步骤，请人工核对原始 .axtr 文件。');
  } else {
    for (const step of steps) {
      lines.push('    ' + displayComment(step));
      lines.push('    ' + rawInfoComment(step));
      const generator = GENERATORS[step.normalizedAction];
      const codeLines = generator(step);
      for (const codeLine of codeLines) {
        lines.push('    ' + codeLine);
      }
      lines.push('');
    }
  }

  lines.push('  });');
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}
