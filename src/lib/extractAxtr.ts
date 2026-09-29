import JSZip from 'jszip';

export interface ExtractedAxtr {
  recordingXml: string;
  /** Names of all other files found in the archive (screenshots etc.), for diagnostics. */
  otherFiles: string[];
}

const RECORDING_FILE_CANDIDATES = ['recording.xml'];

/**
 * Extracts Recording.xml (case-insensitively, from any folder depth) out of
 * an .axtr file, which is a plain ZIP archive.
 */
export async function extractRecordingXmlFromAxtr(file: File | Blob): Promise<ExtractedAxtr> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(
      `无法解压该文件，请确认它是有效的 .axtr（ZIP）文件: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const allPaths = Object.keys(zip.files);
  const recordingEntryPath = allPaths.find((p) => {
    const lower = p.toLowerCase();
    return RECORDING_FILE_CANDIDATES.some((candidate) => lower === candidate || lower.endsWith('/' + candidate));
  });

  if (!recordingEntryPath) {
    throw new Error(
      `在 .axtr 压缩包中没有找到 Recording.xml。压缩包内包含的文件: ${allPaths.length > 0 ? allPaths.join(', ') : '(空)'}`
    );
  }

  const entry = zip.files[recordingEntryPath];
  const recordingXml = await entry.async('string');
  const otherFiles = allPaths.filter((p) => p !== recordingEntryPath);

  return { recordingXml, otherFiles };
}
