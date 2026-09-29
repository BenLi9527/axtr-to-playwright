import { describe, expect, it } from 'vitest';
import { parseRecordingXml } from '../lib/parseRecording';
import { generatePlaywrightScript } from '../lib/generatePlaywright';

// Hand-written sample mimicking the general shape of a real Recording.xml.
// Deliberately includes: attribute-based fields, child-element-based fields,
// a step with a missing UIElement name (to exercise the TODO fallback path),
// and an unrecognized ActionType (to exercise the "unknown" fallback path).
const SAMPLE_RECORDING_XML = `<?xml version="1.0" encoding="utf-8"?>
<Recording Title="创建客户">
  <Steps>
    <Step ActionType="Navigate">
      <DisplayText>打开"所有客户"工作区</DisplayText>
      <UIElement Form="CustTableListPage" Path="Accounts receivable/All customers" />
    </Step>
    <Step ActionType="Click">
      <DisplayText>单击"新建"按钮</DisplayText>
      <UIElement Name="NewButton" AutomationName="New" ControlType="Button" Form="CustTableListPage" />
    </Step>
    <Step ActionType="SetValue" Value="1101">
      <DisplayText>在"客户账户"字段中输入"1101"</DisplayText>
      <UIElement Name="AccountNum" AutomationName="Customer account" ControlType="StringEdit" Form="CustTable" DataAreaId="usmf" />
    </Step>
    <Step ActionType="Select" Value="Domestic">
      <DisplayText>在"客户分组"下拉列表中选择"Domestic"</DisplayText>
      <UIElement Name="CustGroup" AutomationName="Customer group" ControlType="ComboBox" Form="CustTable" />
    </Step>
    <Step ActionType="Click">
      <DisplayText>单击"保存"</DisplayText>
      <!-- Intentionally no Name/AutomationName to exercise the TODO fallback -->
      <UIElement ControlType="Button" Form="CustTable" />
    </Step>
    <Step ActionType="SomeFutureActionType">
      <DisplayText>一个未知的新操作类型</DisplayText>
      <UIElement Form="CustTable" />
    </Step>
  </Steps>
</Recording>`;

describe('parseRecordingXml', () => {
  it('parses title and all steps from a well-formed Recording.xml', () => {
    const result = parseRecordingXml(SAMPLE_RECORDING_XML);

    expect(result.title).toBe('创建客户');
    expect(result.steps).toHaveLength(6);
    expect(result.warnings).toHaveLength(0);
  });

  it('normalizes action types correctly', () => {
    const result = parseRecordingXml(SAMPLE_RECORDING_XML);
    const actions = result.steps.map((s) => s.normalizedAction);

    expect(actions).toEqual(['navigate', 'click', 'setValue', 'select', 'click', 'unknown']);
  });

  it('extracts UIElement attributes for a step', () => {
    const result = parseRecordingXml(SAMPLE_RECORDING_XML);
    const setValueStep = result.steps[2];

    expect(setValueStep.uiElement.name).toBe('AccountNum');
    expect(setValueStep.uiElement.automationName).toBe('Customer account');
    expect(setValueStep.uiElement.controlType).toBe('StringEdit');
    expect(setValueStep.uiElement.form).toBe('CustTable');
    expect(setValueStep.uiElement.dataAreaId).toBe('usmf');
    expect(setValueStep.value).toBe('1101');
  });

  it('handles a step with a missing control name gracefully (no throw)', () => {
    const result = parseRecordingXml(SAMPLE_RECORDING_XML);
    const saveStep = result.steps[4];

    expect(saveStep.uiElement.name).toBeUndefined();
    expect(saveStep.uiElement.automationName).toBeUndefined();
    expect(saveStep.displayText).toContain('保存');
  });

  it('throws a clear error for invalid XML instead of failing silently', () => {
    expect(() => parseRecordingXml('<Recording><Step>')).toThrow(/不是合法的 XML/);
  });

  it('throws a clear error for empty input', () => {
    expect(() => parseRecordingXml('')).toThrow(/内容为空/);
  });

  it('produces a warning (not a throw) when no step nodes are found', () => {
    const result = parseRecordingXml('<Recording Title="空录制"></Recording>');
    expect(result.steps).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('generatePlaywrightScript', () => {
  it('generates a script containing imports, describe/test wrapper, and step comments', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed, { sourceFileName: 'CreateCustomer.axtr' });

    expect(script).toContain("import { test, expect } from '@playwright/test';");
    expect(script).toContain("test.describe('创建客户'");
    expect(script).toContain('步骤 1:');
    expect(script).toContain('打开"所有客户"工作区');
  });

  it('generates page.click via getByRole for a named button', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain("page.getByRole('button', { name: 'New' })");
  });

  it('generates page.fill with the recorded value for SetValue steps', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain("page.getByLabel('Customer account').fill('1101')");
  });

  it('generates page.selectOption for Select steps', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain("page.getByLabel('Customer group').selectOption('Domestic')");
  });

  it('never fabricates a URL for Navigate steps, only emits an explanatory comment', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).not.toContain('page.goto(');
    expect(script).toContain('未记录真实 URL');
    expect(script).toContain('CustTableListPage');
  });

  it('emits a TODO comment instead of a guessed selector when the control name is missing', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain('TODO: 原始控件缺少 Name/AutomationName');
  });

  it('emits a TODO comment for unrecognized action types instead of throwing', () => {
    const parsed = parseRecordingXml(SAMPLE_RECORDING_XML);
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain('未识别的操作类型 "SomeFutureActionType"');
  });

  it('produces a valid skeleton even when there are zero steps', () => {
    const parsed = parseRecordingXml('<Recording Title="空录制"></Recording>');
    const script = generatePlaywrightScript(parsed);

    expect(script).toContain('未能从 Recording.xml 中解析出任何步骤');
  });
});
