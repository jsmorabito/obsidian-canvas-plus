import { App, TFile } from 'obsidian';

export const HTML_EXTENSIONS = ['html', 'htm'];

/** The folder a file sits in, as a resource URL, so relative links in the page (images, styles) resolve. */
function baseUrl(app: App, file: TFile): string {
  const url = app.vault.getResourcePath(file).split('?')[0] ?? '';
  return url.slice(0, url.lastIndexOf('/') + 1);
}

/** The base URL would turn a link to `#section` into a navigation away from the page, so those links scroll instead. */
const ANCHOR_SCRIPT = '<script>addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href^=\'#\']");'
  + 'if(!a)return;e.preventDefault();var id=decodeURIComponent(a.getAttribute("href").slice(1));'
  + 'var t=id?document.getElementById(id)||document.getElementsByName(id)[0]:document.body;if(t)t.scrollIntoView();},true)</script>';

/**
 * Show a vault HTML file in a sandboxed frame. Scripts run, but without the app's origin, so the page
 * can't reach the vault or Obsidian. Returns a function that re-reads the file.
 */
export function mountHtmlFrame(app: App, parent: HTMLElement, file: TFile): { frame: HTMLIFrameElement; reload: () => Promise<void> } {
  const frame = parent.createEl('iframe', { cls: 'ffc-html-frame' });
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
  let latest = 0;
  const reload = async (): Promise<void> => {
    const ticket = ++latest;
    const html = await app.vault.cachedRead(file);
    // A newer reload started while this one was reading.
    if (ticket !== latest) return;
    const inject = `<base href="${baseUrl(app, file)}">${ANCHOR_SCRIPT}`;
    const head = /<head(\s[^>]*)?>/i;
    frame.srcdoc = head.test(html) ? html.replace(head, (m) => m + inject) : inject + html;
  };
  return { frame, reload };
}
