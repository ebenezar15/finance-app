import { useUI } from '../store/ui';

type Downloads = { save: (r: { filename: string; data: Blob | string }) => Promise<{ status: string }> };
type Host = { use?: (name: string) => Promise<unknown> };

const EMBED = import.meta.env.VITE_EMBED === '1';

/**
 * Saves a generated file. In the installed app this is a normal browser download; in the
 * shared single-file build the host blocks those, so the file goes through the host's
 * `downloads` capability, which asks the viewer to confirm.
 */
export async function saveFile(filename: string, data: Blob): Promise<boolean> {
  if (!EMBED) {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  // Hosts only allow common extensions, so custom ones (e.g. .tandem) are saved as .json.
  const safeName = filename.replace(/\.tandem$/, '.json');
  const downloads = (await (window as unknown as { claude?: Host }).claude?.use?.('downloads')) as Downloads | null | undefined;
  if (!downloads) {
    useUI.getState().toast('Saving files isn’t available in this view. Open Tandem in your own browser to export.');
    return false;
  }
  try {
    await downloads.save({ filename: safeName, data });
    return true;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'rate_limited') useUI.getState().toast('A save is already waiting for you. Finish that one first.');
    else if (code !== 'declined') useUI.getState().toast('That file couldn’t be saved here.');
    return false;
  }
}
