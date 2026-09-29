import { extractRecordingXmlFromAxtr } from '../lib/extractAxtr';
import { parseRecordingXml } from '../lib/parseRecording';
import { generatePlaywrightScript } from '../lib/generatePlaywright';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileNameEl = document.getElementById('file-name') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const resultSection = document.getElementById('result-section') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLTextAreaElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;

let currentScript = '';
let currentBaseName = 'recording';

function setStatus(message: string, kind: 'info' | 'error' | 'success' = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind === 'info' ? '' : kind}`.trim();
}

function showResult(script: string, baseName: string) {
  currentScript = script;
  currentBaseName = baseName;
  outputEl.value = script;
  resultSection.classList.remove('hidden');
}

function hideResult() {
  currentScript = '';
  outputEl.value = '';
  resultSection.classList.add('hidden');
}

async function handleFile(file: File) {
  fileNameEl.textContent = file.name;
  hideResult();
  setStatus('正在解压并解析 .axtr 文件…');

  const baseName = file.name.replace(/\.axtr$/i, '') || 'recording';

  try {
    const { recordingXml, otherFiles } = await extractRecordingXmlFromAxtr(file);
    const parsed = parseRecordingXml(recordingXml);
    const script = generatePlaywrightScript(parsed, { sourceFileName: file.name });

    showResult(script, baseName);

    const stepCountMsg = `已解析 ${parsed.steps.length} 个步骤（压缩包内附加文件 ${otherFiles.length} 个）。`;
    if (parsed.warnings.length > 0) {
      setStatus(`${stepCountMsg}\n存在 ${parsed.warnings.length} 条警告，详见脚本头部注释。`, 'success');
    } else {
      setStatus(`转换成功。${stepCountMsg}`, 'success');
    }
  } catch (err) {
    hideResult();
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`转换失败: ${message}`, 'error');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) {
    void handleFile(file);
  }
});

copyBtn.addEventListener('click', async () => {
  if (!currentScript) return;
  try {
    await navigator.clipboard.writeText(currentScript);
    setStatus('已复制到剪贴板。', 'success');
  } catch (err) {
    setStatus(`复制失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
});

downloadBtn.addEventListener('click', () => {
  if (!currentScript) return;
  const blob = new Blob([currentScript], { type: 'text/typescript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentBaseName}.spec.ts`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
